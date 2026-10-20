// Businesses (DESIGN §26.2): a business is a party with its own accounts and books. A purchase at a
// place it trades at pays it, with sales tax collected and remitted monthly; walk-in customers from
// outside the world bring it takings on its trading days; it pays its suppliers monthly for what it
// sold; it issues invoices, paid as flows, that go late with a fee; it pays its staff (`employment`)
// and its expenses (flows its owners set up); and it pays its owners by draws, or distributions by
// share. Every money movement here goes through the foundation's flows and postings.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent, PostingLine } from "../../../shared/ledger";
import type { EntityDef, FieldDef } from "../../../shared/world";
import { INVOICE_STATES, type AlertLine, type BusinessView, type Flow, type FlowSchedule, type Invoice, type InvoiceState, type JournalLine, type OwnerLine } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { calendarOf, clockAt, clockOfLocal, dateAt, dayIndexOf, formatClock, MINUTES_PER_DAY } from "../../../engine/calendar";
import { labelOf, numOf, objOf, optionalQuery, optionalService, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { isGone, kindIs, placeOfEntity, placeWithin } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { addToBooks, addToPayables, businessBooks, firstBookedMonth, monthBook, monthOf, monthsBetween, operatingAccount, payablesOf } from "./books";
import { allJobs, businessAt, businessIds, jobBlocks, jobView, placesOf, type Job } from "./employment";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { hiddenFrom, managesParty, opaqueId, unpricedCap } from "./model";
import { corporateTax, salesTaxAccount, salesTaxOn, salesTaxPct, structureOf, taxExempt, taxRegionOf } from "./taxes";

/** The foundation's invoice kind (`kinds.ts`): one invoice a business issued. */
export const INVOICE_KIND = "invoice";

/** What the work module adds to the foundation's `business` kind. */
const BUSINESS_FIELDS: Record<string, FieldDef> = {
  daily_sales: { type: "money", label: "Walk-in takings a trading day", min: 0, domain: "money", level: 3 },
  sales_spread_pct: { type: "number", label: "Takings vary by up to ± %", min: 0, max: 100, default: 30, domain: "money", level: 3 },
  trading_days: { type: "list", of: "number", label: "Trading days (0 is Sunday)", domain: "money", level: 3 },
};

/** Net terms on an invoice when its business sets none. */
const INVOICE_DAYS = 30;
/** A late invoice takes its fee again for every this many days it stays unpaid. */
const LATE_FEE_EVERY = 30;
/** When the day's walk-in takings are counted, local time. */
const CLOSING = "17:00";
/** Recent sales kept per business, for its dashboard. */
const SALES_KEPT = 20;

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/** Bookkeeping in the same unit as a payment: one group, so a view that drops the payment drops it too. */
function unit(events: readonly LedgerEvent[], extra: readonly LedgerEvent[]): LedgerEvent[] {
  const all = [...events, ...extra];
  if (all.length < 2) return all;
  const group = events.find((e) => e.group)?.group ?? `work:${hashParts(JSON.stringify(all)).slice(0, 10)}`;
  return all.map((e) => ({ ...e, group }));
}

// ---------------------------------------------------------------- reading businesses

export function isBusiness(ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): boolean {
  const e = own(ctx.state.entities, id);
  return !!e && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, e.kind, "business");
}

/** The share of a sale a business keeps, percent; the rest is the cost of the goods. All of it when no margin is set. */
function marginOf(state: Readonly<WorldState>, business: EntityId): number {
  return Math.min(100, Math.max(0, numOf(own(state.entities, business)?.fields.margin_pct, 100)));
}

/** The days of the week a business trades: its own list, else Monday to Friday. */
function tradingDays(state: Readonly<WorldState>, business: EntityId): number[] {
  const v = own(state.entities, business)?.fields.trading_days;
  const days = Array.isArray(v) ? v.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6) : [];
  return days.length > 0 ? days : [1, 2, 3, 4, 5];
}

// ---------------------------------------------------------------- sales

/**
 * `economy.sale`: a sale a business made, booked: its price, the tax it collected (owed until it is
 * remitted), the cost of the goods (owed to its suppliers until they are paid), and the line on its
 * dashboard. Its posting travels beside it in one unit.
 */
export const SALE: EventTypeDef<PackEvent> = {
  type: "economy.sale",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "business")) && typeof e.data.cents === "number" ? null : reject("bad_event", "a sale needs its business and price")),
  apply: (e, state, ctx) => {
    const business = str(e, "business");
    const cents = numOf(e.data.cents);
    const tax = numOf(e.data.tax);
    const cogs = numOf(e.data.cogs);
    addToBooks(state, business, monthOf(ctx.world, state.clock), { sales: cents, cogs, tax_collected: tax, takings: numOf(e.data.takings) });
    addToPayables(state, business, { sales_tax: tax, suppliers: cogs });
    const sales = sliceRecord(state, "economy", "sales");
    const list = Array.isArray(own(sales, business)) ? (own(sales, business) as JsonValue[]) : [];
    sales[business] = [...list.slice(-(SALES_KEPT - 1)), { at: state.clock, cents, tax, memo: str(e, "memo"), payer: str(e, "payer"), category: str(e, "category") }];
  },
  // The book of a sale is the GM's line; the player reads its posting.
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "business"))}: sale ${str(e, "payer") === "" ? "to walk-in customers" : `of ${str(e, "memo")} to ${labelOf(ctx, str(e, "payer"))}`}`),
};

/** `economy.remit`: a business paid what it owed its suppliers, or the sales tax it collected. */
export const REMIT: EventTypeDef<PackEvent> = {
  type: "economy.remit",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "business")) && (e.data.what === "sales_tax" || e.data.what === "suppliers") ? null : reject("bad_event", "a remittance needs its business and what it settles")),
  apply: (e, state, ctx) => {
    const business = str(e, "business");
    const cents = numOf(e.data.cents);
    if (e.data.what === "sales_tax") {
      addToPayables(state, business, { sales_tax: -cents });
      addToBooks(state, business, monthOf(ctx.world, state.clock), { tax_remitted: cents });
    } else addToPayables(state, business, { suppliers: -cents });
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "business"))}: ${e.data.what === "sales_tax" ? "sales tax paid" : "suppliers paid"}`),
};

/** Commission on a sale for each commission job at the business whose worker is `working`, split evenly. */
function commissions(ctx: ReadContext, business: EntityId, cents: number, working: (job: Job) => boolean): LedgerEvent[] {
  const jobs = allJobs(ctx).filter((j) => j.business === business && j.status === "active" && (j.commissionPct > 0 || j.basis === "commission") && working(j));
  if (jobs.length === 0 || cents <= 0) return [];
  const each = Math.floor(cents / jobs.length);
  return jobs.map((j, i) => ({ type: "economy.commission", data: { job: j.id, cents: i === 0 ? cents - each * (jobs.length - 1) : each, since: numOf(objOf(own(objOf(sliceOf(ctx.state, "economy").payroll), j.id)).through) } }));
}

/**
 * The sale hook (DESIGN §26.2, §26.3): a purchase at a place a business trades at pays the business,
 * into its operating account, with the sales tax it collects on top; anywhere else the tax goes
 * straight to the region's tax authority. Sales tax runs at the payer's level; a business below the
 * level it runs at neither collects nor remits it, so its customer's tax goes to the region too.
 */
function saleTerms(ctx: ReadContext, api: FinanceApi, sale: { payer: EntityId; place: string | null; category: string; cents: number; item: string }) {
  const seller = businessAt(ctx, sale.place);
  const business = seller !== null && seller !== sale.payer ? seller : null;
  const collects = business === null || own(ctx.state.entities, business)?.fields.collects_sales_tax !== false;
  const taxed = collects && api.feature(ctx, sale.payer, "sales_tax") && !taxExempt(ctx, sale.place, sale.category);
  const tax = taxed ? salesTaxOn(sale.cents, salesTaxPct(ctx, sale.place)) : 0;
  const authority = salesTaxAccount(api, taxRegionOf(ctx, sale.place));
  if (!business) return tax > 0 ? { tax, taxAccount: authority } : null;
  const deposit = operatingAccount(api, ctx, business);
  const held = deposit !== null && api.feature(ctx, business, "sales_tax") ? tax : 0;
  const cogs = Math.round((sale.cents * (100 - marginOf(ctx.state, business))) / 100);
  const here = (j: Job): boolean => j.workplaces.some((w) => placeWithin(ctx.world, placeOfEntity(ctx.state, j.worker), w));
  const extra: LedgerEvent[] = [{ type: "economy.sale", data: { business, cents: sale.cents, tax: held, cogs, takings: deposit ? sale.cents + held : 0, payer: sale.payer, memo: sale.item, category: sale.category } }, ...commissions(ctx, business, sale.cents, here)];
  return { seller: business, ...(deposit ? { deposit } : {}), tax, taxAccount: held > 0 && deposit ? deposit : authority, extra };
}

/**
 * Walk-in takings: a business with `daily_sales` takes that much, give or take its spread, from
 * customers outside the world at closing on each trading day, with the tax they pay on top (at the
 * business's own level). Its commission staff who worked that day share the commission.
 */
function walkInFlow(ctx: ReadContext, api: FinanceApi, business: EntityId): Flow | null {
  const daily = numOf(own(ctx.state.entities, business)?.fields.daily_sales);
  const deposit = operatingAccount(api, ctx, business);
  if (daily <= 0 || !deposit) return null;
  const closed = ctx.world.calendar.holidays.filter((h) => h.dayOff).map((h) => h.id);
  return { id: `walkin:${business}`, label: "Walk-in takings", kind: "income", from: "Walk-in customers", to: deposit, amount: { provider: "walk_in_sales", args: { business } }, schedule: { every: "week", weekdays: tradingDays(ctx.state, business), at: CLOSING, roll: "none", ...(closed.length > 0 ? { except: closed } : {}) }, shortfall: "skip", category: "sales", link: business, status: "active", source: "business" };
}

function walkInPosting(ctx: ReadContext, api: FinanceApi, business: EntityId, at: number, rng: Rng): FlowPosting | null {
  const e = own(ctx.state.entities, business);
  const deposit = operatingAccount(api, ctx, business);
  const daily = numOf(e?.fields.daily_sales);
  if (!e || !deposit || daily <= 0) return null;
  const spread = Math.min(100, Math.max(0, numOf(e.fields.sales_spread_pct, 30))) / 100;
  // A day's takings: triangular around the typical, so most days are near it.
  const cents = Math.max(0, Math.round(daily * (1 + spread * (rng.next() + rng.next() - 1))));
  if (cents === 0) return null;
  const place = placesOf(ctx, business)[0] ?? null;
  const collects = e.fields.collects_sales_tax !== false;
  const tax = collects && api.feature(ctx, business, "sales_tax") ? salesTaxOn(cents, salesTaxPct(ctx, place)) : 0;
  const cal = calendarOf(ctx.world);
  const day = dateAt(cal, at).dayIndex;
  const worked = (j: Job): boolean => jobBlocks(ctx, j, clockAt(cal, day, 0), clockAt(cal, day + 1, 0)).length > 0;
  const lines: PostingLine[] = [
    { account: api.outside(`customers:${business}`), amount: -(cents + tax) },
    { account: deposit, amount: cents + tax },
  ];
  const extra: LedgerEvent[] = [{ type: "economy.sale", data: { business, cents, tax, cogs: Math.round((cents * (100 - marginOf(ctx.state, business))) / 100), takings: 0, payer: "", memo: "Walk-in customers", category: "sales", walkin: true } }, ...commissions(ctx, business, cents, worked)];
  return { cents: cents + tax, lines, memo: "Walk-in takings", kind: "sale", category: "sales", extra };
}

/** The monthly payments that settle a business's payables: its suppliers on the 10th, the sales tax it collected on the 20th. */
function settleFlows(ctx: ReadContext, api: FinanceApi, business: EntityId): Flow[] {
  const deposit = operatingAccount(api, ctx, business);
  if (!deposit) return [];
  const out: Flow[] = [];
  if (marginOf(ctx.state, business) < 100) out.push({ id: `suppliers:${business}`, label: "Suppliers", kind: "bill", from: deposit, to: "Suppliers", amount: { provider: "settle", args: { business, what: "suppliers" } }, schedule: { every: "month", days: [10], roll: "after" }, shortfall: "skip", category: "cogs", link: business, status: "active", source: "business" });
  // The tax is paid to its region's authority, which the flow names as the account its posting pays.
  if (own(ctx.state.entities, business)?.fields.collects_sales_tax !== false) out.push({ id: `salestax:${business}`, label: "Sales tax", kind: "tax", from: deposit, to: `tax:sales:${taxRegionOf(ctx, placesOf(ctx, business)[0] ?? null)}`, amount: { provider: "settle", args: { business, what: "sales_tax" } }, schedule: { every: "month", days: [20], roll: "after" }, shortfall: "skip", category: "sales_tax", link: business, status: "active", source: "business" });
  return out;
}

function settlePosting(ctx: ReadContext, api: FinanceApi, business: EntityId, what: "suppliers" | "sales_tax"): FlowPosting | null {
  const deposit = operatingAccount(api, ctx, business);
  const cents = payablesOf(ctx.state, business)[what];
  if (!deposit || cents <= 0) return null;
  const to = what === "sales_tax" ? salesTaxAccount(api, taxRegionOf(ctx, placesOf(ctx, business)[0] ?? null)) : api.outside(`suppliers:${business}`);
  return { cents, lines: [{ account: deposit, amount: -cents }, { account: to, amount: cents }], memo: what === "sales_tax" ? "Sales tax" : "Suppliers", kind: "payment", category: what === "sales_tax" ? "sales_tax" : "cogs", extra: [{ type: "economy.remit", data: { business, what, cents } }] };
}

// ---------------------------------------------------------------- invoices

export interface InvoiceRec extends Invoice {
  /** The customer when they are a party in the world. */
  party: EntityId | null;
  paid: number;
  late_fee: number;
  /** What is still to pay, late fees included. */
  left: number;
  fees: number;
}

/** A date field as a clock reading: a number as it is, a `YYYY-MM-DD[THH:MM]` as its local time. */
function clockOf(ctx: Pick<ReadContext, "world">, v: JsonValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || v === "") return null;
  try {
    return clockOfLocal(calendarOf(ctx.world), v);
  } catch {
    return null;
  }
}

export function readInvoice(ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): InvoiceRec | null {
  const e = own(ctx.state.entities, id);
  if (!e || isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, e.kind, INVOICE_KIND)) return null;
  const f = e.fields;
  const business = strOf(f.business);
  const customer = strOf(f.customer);
  const issued = clockOf(ctx, f.issued) ?? 0;
  const cal = calendarOf(ctx.world);
  // Due on the day it names: payments run that morning, and it is late once the day is over.
  const due = clockAt(cal, dateAt(cal, clockOf(ctx, f.due) ?? issued + INVOICE_DAYS * MINUTES_PER_DAY).dayIndex, 0);
  const state: InvoiceState = (INVOICE_STATES as readonly string[]).includes(strOf(f.state)) ? (strOf(f.state) as InvoiceState) : "open";
  const cents = Math.max(0, Math.round(numOf(f.cents)));
  const lateFee = Math.max(0, Math.round(numOf(f.late_fee)));
  const paid = Math.max(0, Math.round(numOf(f.paid)));
  const party = customer !== "" && own(ctx.state.entities, customer) && !isGone(ctx.state, customer) ? customer : null;
  return { id, business, customer, party, cents, memo: strOf(f.memo, "Invoice"), issued, due, state, paid, late_fee: lateFee, left: state === "open" || state === "late" ? Math.max(0, cents + lateFee - paid) : 0, fees: Math.round(numOf(f.fees)) };
}

export function invoiceIds(ctx: Pick<ReadContext, "registry" | "world" | "state">): EntityId[] {
  return Object.keys(ctx.state.entities)
    .filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", INVOICE_KIND) && !isGone(ctx.state, id))
    .sort();
}

function allInvoices(ctx: Pick<ReadContext, "registry" | "world" | "state">): InvoiceRec[] {
  return invoiceIds(ctx).flatMap((id) => readInvoice(ctx, id) ?? []);
}

/**
 * `economy.invoice_paid`: an invoice paid, booked: revenue for the business that issued it, and a
 * bill paid for a business it was billed to. The invoice's own state changes are plain field sets
 * beside it in the unit.
 */
export const INVOICE_PAID: EventTypeDef<PackEvent> = {
  type: "economy.invoice_paid",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "invoice")) && typeof e.data.cents === "number" ? null : reject("bad_event", "an invoice payment needs its invoice and amount")),
  apply: (e, state, ctx) => {
    const month = monthOf(ctx.world, state.clock);
    const cents = numOf(e.data.cents);
    if (own(state.entities, str(e, "business"))) addToBooks(state, str(e, "business"), month, { invoices: cents });
    const customer = str(e, "customer");
    if (own(state.entities, customer) && kindIs(ctx.registry, ctx.world, own(state.entities, customer)?.kind ?? "", "business")) addToBooks(state, customer, month, { bills: cents });
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "business"))}: invoice paid by ${own(ctx.state.entities, str(e, "customer")) ? labelOf(ctx, str(e, "customer")) : str(e, "customer")}`),
};

/** The events that mark an invoice paid in full with a payment of `cents`, and book it. */
function invoiceSettled(inv: InvoiceRec, cents: number): LedgerEvent[] {
  return [
    { type: "set", entity: inv.id, field: "paid", value: inv.paid + cents },
    { type: "set", entity: inv.id, field: "state", value: "paid" },
    { type: "economy.invoice_paid", data: { invoice: inv.id, business: inv.business, customer: inv.customer, cents } },
  ];
}

function dateText(ctx: Pick<ReadContext, "world">, day: number): string {
  const d = dateAt(calendarOf(ctx.world), clockAt(calendarOf(ctx.world), day, 0));
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * An unpaid invoice's payment as a flow: from its customer (as a bill: from an account, never wallet
 * cash), on its due date and every week after until it is paid. A customer outside the world pays on
 * the due date; one in the world pays when their money covers it.
 */
function invoiceFlow(ctx: ReadContext, api: FinanceApi, inv: InvoiceRec): Flow | null {
  if (inv.left <= 0 || !isBusiness(ctx, inv.business)) return null;
  const cal = calendarOf(ctx.world);
  const day = dateAt(cal, inv.due).dayIndex;
  return {
    id: `invoice:${inv.id}`,
    label: `Invoice: ${inv.memo}`,
    kind: "invoice",
    from: inv.party ?? inv.customer,
    to: operatingAccount(api, ctx, inv.business) ?? inv.business,
    amount: { provider: "invoice", args: { invoice: inv.id } },
    schedule: { every: "week", weekdays: [dateAt(cal, inv.due).weekday], roll: "none" },
    start: dateText(ctx, day),
    shortfall: "skip",
    category: "invoice",
    link: inv.id,
    status: "active",
    method: "account",
    source: "invoice",
  };
}

/**
 * Late invoices (Money 3+, at the issuing business's level): an invoice not paid by the end of its
 * due day goes late and takes the business's late fee, then the fee again for every 30 days more
 * it stays unpaid. The customer and the business's owners hear of it.
 */
function lateInvoices(slot: SlotInfo, ctx: ReadContext, api: FinanceApi): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const cal = calendarOf(ctx.world);
  const today = dateAt(cal, slot.end).dayIndex;
  for (const inv of allInvoices(ctx)) {
    if (inv.left <= 0 || !isBusiness(ctx, inv.business) || ctx.levelOf(inv.business, "money") < 3) continue;
    const daysLate = today - dateAt(cal, inv.due).dayIndex;
    if (daysLate < 1) continue;
    const owed = 1 + Math.floor((daysLate - 1) / LATE_FEE_EVERY);
    const pct = numOf(own(ctx.state.entities, inv.business)?.fields.late_fee_pct);
    const fees = pct > 0 ? owed : inv.fees;
    if (inv.state === "late" && fees <= inv.fees) continue;
    const fee = pct > 0 ? Math.round((inv.cents * pct * (fees - inv.fees)) / 100) : 0;
    if (inv.state !== "late") out.push({ type: "set", entity: inv.id, field: "state", value: "late" });
    if (fees > inv.fees) out.push({ type: "set", entity: inv.id, field: "fees", value: fees }, ...(fee > 0 ? [{ type: "set" as const, entity: inv.id, field: "late_fee", value: inv.late_fee + fee }] : []));
    const amount = api.money(ctx, inv.left + fee);
    // A note to the player reads as the player sees; one to anyone else only reaches the GM, who sees everyone.
    const reader = (party: EntityId): EntityId | null => (party === ctx.world.pov ? party : null);
    if (inv.party) out.push(...api.note(ctx, inv.party, "bill", `${inv.memo} from ${shownName(ctx, reader(inv.party), inv.business, "a business")} is ${daysLate} day${daysLate === 1 ? "" : "s"} late: ${amount} due.`));
    for (const o of api.ownersOf(ctx.state, inv.business)) if (o.role === "owner" || o.role === "joint") out.push(...api.note(ctx, o.party, "bill", `${inv.memo}, billed to ${inv.party ? shownName(ctx, reader(o.party), inv.party, "a customer") : inv.customer}, is ${daysLate} day${daysLate === 1 ? "" : "s"} late: ${amount} owed.`));
  }
  return out;
}

function issueInvoice(ctx: EffectContext, api: FinanceApi, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const business = strOf(args.business);
  if (!isBusiness(ctx, business)) return reject("missing_entity", `no business ${labelOf(ctx, business)}`);
  const by = strOf(args.by);
  if (by !== "" && !managesParty(ctx.state, business, by)) return reject("not_owner", `${labelOf(ctx, by)} doesn't run ${labelOf(ctx, business)}`);
  const customer = strOf(args.customer) || strOf(args.customer_name).trim();
  if (customer === "" || customer === business) return reject("bad_party", "an invoice needs someone to bill");
  const cents = typeof args.cents === "number" ? Math.round(args.cents) : NaN;
  if (!(cents > 0)) return reject("bad_amount", "an invoice needs an amount");
  // A customer outside the world pays what it is billed from money nobody in the world had, so what a
  // business bills such customers in a month is bounded by the world's cap on prices nothing lists.
  if (!own(ctx.state.entities, customer)) {
    const cap = unpricedCap(ctx.world);
    const month = monthOf(ctx.world, ctx.state.clock);
    const billed = allInvoices(ctx)
      .filter((i) => i.business === business && i.party === null && i.state !== "void" && monthOf(ctx.world, i.issued) === month)
      .reduce((a, i) => a + i.cents, 0);
    if (billed + cents > cap) return reject("over_cap", `${labelOf(ctx, business)} can bill customers outside the world at most ${api.money(ctx, cap)} a month, and has billed ${api.money(ctx, billed)}`);
  }
  const days = typeof args.days === "number" && args.days >= 0 ? Math.round(args.days) : Math.round(numOf(own(ctx.state.entities, business)?.fields.invoice_days, INVOICE_DAYS));
  const cal = calendarOf(ctx.world);
  const due = dateText(ctx, dateAt(cal, ctx.state.clock).dayIndex + days);
  const memo = strOf(args.memo).trim() || `${labelOf(ctx, business)} invoice`;
  const id = `invoice:${hashParts(ctx.rng.seed, "invoice", business, customer, String(ctx.state.clock), String(cents)).slice(0, 10)}`;
  const entity: EntityDef = { id, kind: INVOICE_KIND, name: memo, tier: "background", fields: { business, customer, cents, memo, issued: ctx.state.clock, due, state: "open", paid: 0, late_fee: 0, fees: 0 }, relations: [] };
  return [{ type: "spawn", entity }];
}

function payInvoice(ctx: EffectContext, api: FinanceApi, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const inv = readInvoice(ctx, strOf(args.invoice));
  if (!inv) return reject("missing_entity", `no invoice ${labelOf(ctx, strOf(args.invoice))}`);
  if (inv.left <= 0) return reject("settled", `${inv.memo} is ${inv.state === "void" ? "void" : "paid"}`);
  const by = strOf(args.by);
  const payer = inv.party ?? inv.customer;
  if (by !== "" && by !== inv.party && !(inv.party && isBusiness(ctx, inv.party) && managesParty(ctx.state, inv.party, by))) return reject("not_customer", `${labelOf(ctx, by)} isn't billed for ${inv.memo}`);
  const deposit = operatingAccount(api, ctx, inv.business);
  const paid = inv.party ? api.pay(ctx, { from: inv.party, to: inv.business, cents: inv.left, memo: `Invoice: ${inv.memo}`, kind: "payment", category: "invoice", method: "account", ...(deposit ? { deposit } : {}) }) : api.post(ctx, [{ account: api.outside(`customer:${payer}`), amount: -inv.left }, { account: deposit ?? api.outside(inv.business), amount: inv.left }], { memo: `Invoice: ${inv.memo}`, kind: "payment", category: "invoice", payer });
  if (!Array.isArray(paid)) return paid;
  return unit(paid, invoiceSettled(inv, inv.left));
}

function voidInvoice(ctx: EffectContext, api: FinanceApi, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const inv = readInvoice(ctx, strOf(args.invoice));
  if (!inv) return reject("missing_entity", `no invoice ${labelOf(ctx, strOf(args.invoice))}`);
  const by = strOf(args.by);
  if (by !== "" && !managesParty(ctx.state, inv.business, by)) return reject("not_owner", `${labelOf(ctx, by)} doesn't run ${labelOf(ctx, inv.business)}`);
  if (inv.state === "paid" || inv.state === "void") return reject("settled", `${inv.memo} is already ${inv.state}`);
  return [{ type: "set", entity: inv.id, field: "state", value: "void" }];
}

// ---------------------------------------------------------------- owners: draws and distributions

/**
 * `economy.payout`: an owner's draw, or a distribution of profit by share, booked. A distribution
 * books what it paid of each month's profit (`months`), so no month's profit is paid out twice; one
 * without them books it all to the month it was paid.
 */
export const PAYOUT: EventTypeDef<PackEvent> = {
  type: "economy.payout",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "business")) && typeof e.data.cents === "number" ? null : reject("bad_event", "a payout needs its business and amount")),
  apply: (e, state, ctx) => {
    const business = str(e, "business");
    const now = monthOf(ctx.world, state.clock);
    if (e.data.what === "draw") {
      addToBooks(state, business, now, { draws: numOf(e.data.cents) });
      return;
    }
    const months = Object.entries(objOf(e.data.months)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (months.length === 0) addToBooks(state, business, now, { distributions: numOf(e.data.cents) });
    for (const [month, cents] of months) addToBooks(state, business, month, { distributions: numOf(cents) });
    sliceRecord(state, "economy", "distributed")[business] = state.clock;
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "business"))}: ${e.data.what === "draw" ? "owner's draw" : "profit distributed"}`),
};

/** Whether an owner may draw on a business: an owner or joint owner; a corporation pays its owners by salary or dividends instead. */
function mayDraw(api: FinanceApi, state: Readonly<WorldState>, who: EntityId, business: EntityId): boolean {
  return structureOf(state, business) !== "c_corp" && api.ownersOf(state, business).some((o) => o.party === who && (o.role === "owner" || o.role === "joint"));
}

function ownerDraw(ctx: EffectContext, api: FinanceApi, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const business = strOf(args.business);
  const owner = strOf(args.owner) || strOf(args.by);
  if (!isBusiness(ctx, business)) return reject("missing_entity", `no business ${labelOf(ctx, business)}`);
  if (!mayDraw(api, ctx.state, owner, business)) return reject("not_owner", structureOf(ctx.state, business) === "c_corp" ? `${labelOf(ctx, business)} is a corporation: it pays its owners by salary or dividends` : `${labelOf(ctx, owner)} doesn't own ${labelOf(ctx, business)}`);
  const cents = typeof args.cents === "number" ? Math.round(args.cents) : NaN;
  if (!(cents > 0)) return reject("bad_amount", "a draw needs an amount");
  const from = operatingAccount(api, ctx, business);
  if (!from) return reject("no_account", `${labelOf(ctx, business)} has no account to draw on`);
  const paid = api.pay(ctx, { from, to: owner, cents, memo: "Owner's draw", kind: "income", category: "draw" });
  if (!Array.isArray(paid)) return paid;
  return unit(paid, [{ type: "economy.payout", data: { business, what: "draw", cents } }]);
}

/**
 * What each month's profit from the one holding `from` to the one holding `to - 1` has left to pay
 * out at `pct`: its share of the month's profit, less what distributions already paid of it.
 */
function undistributed(api: FinanceApi, ctx: ReadContext, business: EntityId, from: number, to: number, pct: number): JsonObject {
  const cal = calendarOf(ctx.world);
  const out: JsonObject = {};
  for (const month of monthsBetween(ctx.world, from, to)) {
    const [y = 0, m = 1] = month.split("-").map(Number);
    const start = clockAt(cal, dayIndexOf(cal, y, m, 1), 0);
    const b = businessBooks(api, ctx, business, start, start + 1);
    const left = Math.round((Math.max(0, b.profit) * pct) / 100) - b.distributions;
    if (left > 0) out[month] = left;
  }
  return out;
}

/**
 * A distribution from a business's operating account to its owners by their share of its worth,
 * paying `months` of its profit. Each owner's part goes where the holdings module routes their
 * stake (an account of theirs, else their deposit account); a part they reinvest stays in the
 * business and only its stake records it. Null when there is nothing to pay or no account to pay from.
 */
function distribution(ctx: ReadContext, api: FinanceApi, business: EntityId, months: JsonObject): { lines: PostingLine[]; extra: LedgerEvent[]; paid: number } | null {
  const total = Object.values(months).reduce((a: number, c) => a + numOf(c), 0);
  const from = operatingAccount(api, ctx, business);
  if (!from || total <= 0) return null;
  const owners = api.ownersOf(ctx.state, business).map((o) => ({ party: o.party, share: api.shareOf(ctx.state, business, o.party) })).filter((o) => o.share > 0);
  const shareSum = owners.reduce((a, o) => a + o.share, 0);
  if (owners.length === 0 || shareSum <= 0) return null;
  const route = optionalQuery(ctx, "economy.stake_route");
  const stakePaid = optionalService(ctx, "economy.stake_paid");
  const lines: PostingLine[] = [];
  const extra: LedgerEvent[] = [];
  let given = 0;
  let paid = 0;
  for (const [i, o] of owners.entries()) {
    const cents = i === owners.length - 1 ? total - given : Math.round((total * o.share) / shareSum);
    given += cents;
    if (cents <= 0) continue;
    const r = route?.(ctx, o.party, business) ?? null;
    const reinvest = r !== null && "reinvest" in r;
    if (!reinvest) {
      const to = r !== null && "account" in r ? r.account : (api.depositAccount(ctx, o.party) ?? api.outside(o.party));
      const line = lines.find((l) => l.account === to);
      if (line) line.amount += cents;
      else lines.push({ account: to, amount: cents });
      paid += cents;
    }
    extra.push(...(stakePaid?.(ctx, o.party, business, cents, reinvest) ?? []));
  }
  if (paid > 0) lines.unshift({ account: from, amount: -paid });
  extra.push({ type: "economy.payout", data: { business, what: "distribution", cents: total, months } });
  return { lines, extra, paid };
}

function distribute(ctx: EffectContext, api: FinanceApi, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const business = strOf(args.business);
  if (!isBusiness(ctx, business)) return reject("missing_entity", `no business ${labelOf(ctx, business)}`);
  const by = strOf(args.by);
  if (by !== "" && !managesParty(ctx.state, business, by)) return reject("not_owner", `${labelOf(ctx, by)} doesn't run ${labelOf(ctx, business)}`);
  const since = numOf(own(objOf(sliceOf(ctx.state, "economy").distributed), business), monthStart(ctx, ctx.state.clock));
  const pct = numOf(own(ctx.state.entities, business)?.fields.distribution_pct, 100);
  // A stated amount pays out of this month; otherwise the profit of every month since the last payout that no payout has paid.
  const months: JsonObject = typeof args.cents === "number" && args.cents > 0 ? { [monthOf(ctx.world, ctx.state.clock)]: Math.round(args.cents) } : undistributed(api, ctx, business, since, ctx.state.clock + 1, pct);
  if (Object.keys(months).length === 0) return reject("bad_amount", `${labelOf(ctx, business)} has no profit to distribute`);
  const d = distribution(ctx, api, business, months);
  if (!d) return reject("no_owners", `${labelOf(ctx, business)} has no owners with a share, or no account to pay from`);
  if (d.lines.length === 0) return d.extra;
  const posted = api.post(ctx, d.lines, { memo: "Profit distribution", kind: "income", category: "distribution" });
  if (!Array.isArray(posted)) return posted;
  return unit(posted, d.extra);
}

function monthStart(ctx: Pick<ReadContext, "world">, clock: number): number {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, clock);
  return clockAt(cal, dayIndexOf(cal, d.year, d.month, 1), 0);
}

/** The period a distribution on `at` pays from: the month, quarter or year just closed. */
function distributionPeriod(ctx: Pick<ReadContext, "world">, every: string, at: number): { from: number; to: number } {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, at);
  const months = every === "year" ? 12 : every === "quarter" ? 3 : 1;
  const firstOfMonth = (y: number, m: number): number => clockAt(cal, dayIndexOf(cal, y, m, 1), 0);
  let y = d.year;
  let m = d.month - months;
  while (m < 1) {
    m += 12;
    y--;
  }
  return { from: firstOfMonth(y, m), to: firstOfMonth(d.year, d.month) };
}

/** A business's distribution policy as a flow: its `distribution_pct` of the profit of each month, quarter or year, on the 10th after it closes. */
function distributionFlow(ctx: ReadContext, api: FinanceApi, business: EntityId): Flow | null {
  const f = own(ctx.state.entities, business)?.fields;
  const pct = numOf(f?.distribution_pct);
  const from = operatingAccount(api, ctx, business);
  if (!f || pct <= 0 || !from) return null;
  const every = strOf(f.distribution_every, "quarter");
  const schedule: FlowSchedule = every === "month" ? { every: "month", days: [10], roll: "after" } : every === "year" ? { every: "year", months: [1], days: [10], roll: "after" } : { every: "year", months: [1, 4, 7, 10], days: [10], roll: "after" };
  return { id: `distribute:${business}`, label: "Profit distribution", kind: "distribution", from, to: "Owners", amount: { provider: "distribution", args: { business } }, schedule, shortfall: "skip", category: "distribution", link: business, status: "active", source: "business" };
}

// ---------------------------------------------------------------- views

/** A name as `viewer` may read it: anyone hidden from them reads as `fallback`; the GM's views name everyone. */
function shownName(ctx: ReadContext, viewer: EntityId | null, id: string, fallback: string): string {
  if (!own(ctx.state.entities, id)) return id;
  return hiddenFrom(ctx, viewer, id) ? fallback : labelOf(ctx, id);
}

function ownerLines(ctx: ReadContext, api: FinanceApi, viewer: EntityId | null, business: EntityId): OwnerLine[] {
  return api.ownersOf(ctx.state, business).map((o) => ({ party: hiddenFrom(ctx, viewer, o.party) ? null : o.party, name: shownName(ctx, viewer, o.party, "an owner"), role: o.role, share: api.shareOf(ctx.state, business, o.party) }));
}

/** The next time a flow of this business falls due, as the dashboards print it. */
function nextDue(ctx: ReadContext, api: FinanceApi, flowId: string): string | null {
  const flow = api.flows(ctx).find((f) => f.id === flowId);
  const next = flow ? api.occurrences(ctx, flow.schedule, ctx.state.clock, ctx.state.clock + 400 * MINUTES_PER_DAY, flow.start)[0] : undefined;
  return next === undefined ? null : formatClock(calendarOf(ctx.world), next);
}

/**
 * A business on `party`'s dashboard (its own, or one it holds a role on): books this year and by
 * month, sales, invoices, staff and taxes, with names as `viewer` may read them.
 */
export function businessView(ctx: ReadContext, api: FinanceApi, business: EntityId, party: EntityId, viewer: EntityId | null): BusinessView {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const d = dateAt(cal, now);
  const yearStart = clockAt(cal, dayIndexOf(cal, d.year, 1, 1), 0);
  const year = businessBooks(api, ctx, business, yearStart, now + 1);
  const deposit = operatingAccount(api, ctx, business);
  const role = api.ownersOf(ctx.state, business).find((o) => o.party === party)?.role ?? null;
  const salesList = own(objOf(sliceOf(ctx.state, "economy").sales), business);
  const sales: JournalLine[] = (Array.isArray(salesList) ? salesList : [])
    .map((raw, i) => ({ raw: objOf(raw), i }))
    .reverse()
    .map(({ raw, i }) => ({ id: `${business}:sale:${i}`, at: formatClock(cal, numOf(raw.at)), memo: strOf(raw.memo, "Sale"), cents: numOf(raw.cents) + numOf(raw.tax), account: deposit ? labelOf(ctx, deposit) : labelOf(ctx, business), accountId: deposit ?? business, kind: "sale" as const, category: strOf(raw.category) || null, counterparty: strOf(raw.payer) === "" ? "Walk-in customers" : shownName(ctx, viewer, strOf(raw.payer), "a customer"), card: null, status: "posted" as const }));
  const invoices = allInvoices(ctx)
    .filter((i) => i.business === business || i.party === business)
    .sort((a, b) => b.issued - a.issued)
    .map((i) => ({ id: i.id, business: hiddenFrom(ctx, viewer, i.business) ? "" : i.business, customer: i.party !== null && hiddenFrom(ctx, viewer, i.party) ? "" : i.customer, cents: i.cents, memo: i.memo, issued: i.issued, due: i.due, state: i.state, paid: i.paid, late_fee: i.late_fee, ...(i.state === "late" ? { days_late: dateAt(cal, now).dayIndex - dateAt(cal, i.due).dayIndex } : {}), flow: `invoice:${i.id}`, customerName: i.party ? shownName(ctx, viewer, i.party, "a customer") : i.customer, issuedAt: formatClock(cal, i.issued), dueAt: formatClock(cal, i.due) }));
  const employees = allJobs(ctx)
    .filter((j) => j.business === business && j.status !== "ended")
    .map((j) => {
      const v = jobView(ctx, api, j, viewer);
      if (!hiddenFrom(ctx, viewer, j.worker)) return v;
      // Where their pay goes, and to whom, would name them too, and so can the job's id (`job_danny_mechanic`): its payroll's link sends the same stand-in.
      return { ...v, id: opaqueId(v.id), worker: "an employee", workerId: "", splits: [], spec: { ...v.spec, worker: "", splits: [], deductions: [] } };
    });
  const owed = payablesOf(ctx.state, business);
  const taxes: BusinessView["taxes"] = [];
  if (owed.sales_tax !== 0) taxes.push({ label: "Sales tax collected, to pay", cents: owed.sales_tax, due: nextDue(ctx, api, `salestax:${business}`) });
  if (owed.suppliers !== 0) taxes.push({ label: "Owed to suppliers", cents: owed.suppliers, due: nextDue(ctx, api, `suppliers:${business}`) });
  if (structureOf(ctx.state, business) === "c_corp" && api.feature(ctx, business, "business_tax")) taxes.push({ label: "Income tax on this year's profit", cents: corporateTax(ctx, business, year.profit), due: nextDue(ctx, api, `esttax:${business}`) });
  // The months since its books began, the chat's start or its own, and at most the last 12: before them it had nothing to book. This month counts while nothing has yet.
  const since = firstBookedMonth(api, ctx, business) ?? monthOf(ctx.world, now);
  const months = monthsBetween(ctx.world, now - 335 * MINUTES_PER_DAY, now + 1)
    .filter((m) => m >= since)
    .reverse()
    .map((m) => {
      const [y, mo] = m.split("-").map(Number);
      const from = clockAt(cal, dayIndexOf(cal, y ?? d.year, mo ?? 1, 1), 0);
      const b = businessBooks(api, ctx, business, from, from + 1);
      return { period: m, revenue: b.revenue, expenses: b.expenses, profit: b.profit };
    });
  // Where the party's share of its profit goes, when they hold one: the holdings module routes it (`economy.stake_route`).
  const routed = api.shareOf(ctx.state, business, party) > 0 ? (optionalQuery(ctx, "economy.stake_route")?.(ctx, party, business) ?? null) : undefined;
  return {
    id: business,
    name: labelOf(ctx, business),
    role,
    mayDraw: mayDraw(api, ctx.state, party, business),
    owners: ownerLines(ctx, api, viewer, business),
    accounts: api.accountsOf(ctx, business, "sees"),
    // The finance view fills these: it knows which accounts it already shows as the viewer's own.
    managed: [],
    places: placesOf(ctx, business).map((p) => ({ id: p, name: own(ctx.world.places, p)?.name ?? p })),
    books: { period: String(d.year), revenue: year.revenue, expenses: year.expenses, payroll: year.payroll, taxes: year.taxes, profit: year.profit, lines: year.lines },
    months,
    sales,
    invoices,
    employees,
    taxes,
    route: routed === undefined ? null : routed === null ? { to: null, reinvest: false } : "reinvest" in routed ? { to: null, reinvest: true } : { to: routed.account, reinvest: false },
  };
}

/** The businesses a party sees on its dashboard: itself, when it is one, and every business it holds a role on. */
function businessesOf(ctx: ReadContext, api: FinanceApi, party: EntityId): EntityId[] {
  if (isBusiness(ctx, party)) return [party];
  return businessIds(ctx).filter((b) => api.ownersOf(ctx.state, b).some((o) => o.party === party));
}

/** Late invoices a party owes, or that its businesses are owed, with names as `viewer` may read them. */
function invoiceAlerts(ctx: ReadContext, api: FinanceApi, party: EntityId, viewer: EntityId | null): AlertLine[] {
  const mine = businessesOf(ctx, api, party);
  const out: AlertLine[] = [];
  for (const inv of allInvoices(ctx)) {
    if (inv.state !== "late" || inv.left <= 0) continue;
    if (inv.party === party || (inv.party !== null && mine.includes(inv.party))) out.push({ tone: "neg", text: `${inv.memo} from ${shownName(ctx, viewer, inv.business, "a business")} is late: ${api.money(ctx, inv.left)} due.`, flow: `invoice:${inv.id}` });
    else if (mine.includes(inv.business)) out.push({ tone: "warn", text: `${inv.memo}, billed to ${inv.party ? shownName(ctx, viewer, inv.party, "a customer") : inv.customer}, is late: ${api.money(ctx, inv.left)} owed.`, flow: `invoice:${inv.id}` });
  }
  return out;
}

// ---------------------------------------------------------------- registration

/** Businesses: invoices, sales and takings, settling payables, owners' draws and distributions, the books queries, views and summaries. */
export function registerBusiness(r: FinanceRegistry): void {
  const { api, core } = r;
  r.fields("business", BUSINESS_FIELDS);
  for (const def of [SALE, REMIT, INVOICE_PAID, PAYOUT]) core.event(def);

  r.sale((ctx, sale) => saleTerms(ctx, api, sale));
  r.flows({
    id: "business",
    flows: (ctx) =>
      businessIds(ctx).flatMap((b) => {
        const out: Flow[] = [...settleFlows(ctx, api, b)];
        const walkIn = walkInFlow(ctx, api, b);
        if (walkIn) out.push(walkIn);
        const dist = distributionFlow(ctx, api, b);
        if (dist) out.push(dist);
        return out;
      }),
  });
  r.flows({ id: "invoice", flows: (ctx) => allInvoices(ctx).flatMap((inv) => invoiceFlow(ctx, api, inv) ?? []) });
  r.amount("walk_in_sales", (ctx, flow, at, rng) => walkInPosting(ctx, api, strOf("provider" in flow.amount ? objOf(flow.amount.args).business : undefined, flow.link ?? ""), at, rng));
  r.amount("settle", (ctx, flow) => {
    const args = "provider" in flow.amount ? objOf(flow.amount.args) : {};
    return settlePosting(ctx, api, strOf(args.business), args.what === "sales_tax" ? "sales_tax" : "suppliers");
  });
  r.amount("invoice", (ctx, flow) => {
    const inv = readInvoice(ctx, strOf("provider" in flow.amount ? objOf(flow.amount.args).invoice : undefined, flow.link ?? ""));
    if (!inv || inv.left <= 0) return null;
    return { cents: inv.left, memo: `Invoice: ${inv.memo}`, kind: "payment", category: "invoice", extra: invoiceSettled(inv, inv.left) };
  });
  r.amount("distribution", (ctx, flow, at) => {
    const business = strOf("provider" in flow.amount ? objOf(flow.amount.args).business : undefined, flow.link ?? "");
    const f = own(ctx.state.entities, business)?.fields;
    if (!f) return null;
    const period = distributionPeriod(ctx, strOf(f.distribution_every, "quarter"), at);
    const d = distribution(ctx, api, business, undistributed(api, ctx, business, period.from, period.to, numOf(f.distribution_pct)));
    return d ? { cents: d.paid, lines: d.lines, memo: "Profit distribution", kind: "income", category: "distribution", extra: d.extra } : null;
  });
  core.process({ id: "economy.invoices", domain: "money", minLevel: 3, step: (slot, ctx) => lateInvoices(slot, ctx, api) });

  core.effect({ type: "economy.invoice_issue", args: ["business", "customer?", "customer_name?", "cents", "memo?", "days?", "by?"], resolve: (args, ctx) => issueInvoice(ctx, api, args) });
  core.effect({ type: "economy.invoice_pay", args: ["invoice", "by?"], resolve: (args, ctx) => payInvoice(ctx, api, args) });
  core.effect({ type: "economy.invoice_void", args: ["invoice", "by?"], resolve: (args, ctx) => voidInvoice(ctx, api, args) });
  core.effect({ type: "economy.owner_draw", args: ["business", "cents", "owner?", "by?"], resolve: (args, ctx) => ownerDraw(ctx, api, args) });
  core.effect({ type: "economy.distribute", args: ["business", "cents?", "by?"], resolve: (args, ctx) => distribute(ctx, api, args) });
  core.formula("may_draw", (ctx, who, business) => mayDraw(api, ctx.state, String(who ?? ""), String(business ?? "")));
  core.action({ id: "invoice_issue", label: "Send an invoice", pack: "economy", params: { business: { type: "ref", ref: "business" }, customer: { type: "ref", optional: true, label: "Bill (someone here)" }, customer_name: { type: "text", optional: true, label: "Or bill (a name)" }, amount: { type: "money" }, memo: { type: "text", optional: true, label: "For" }, days: { type: "number", optional: true, label: "Days to pay" } }, requires: ["manages(self, business)", "amount > 0", "level.money >= 3"], outcomes: { default: [{ type: "economy.invoice_issue", args: { business: "business", customer: "=params.customer", customer_name: "=params.customer_name", cents: "=amount", memo: "=params.memo", days: "=params.days", by: "self" } }] }, duration: "10", lexicon: ["send an invoice", "invoice", "bill them"], observable: "does paperwork" });
  core.action({ id: "invoice_pay", label: "Pay an invoice", pack: "economy", params: { invoice: { type: "ref", ref: INVOICE_KIND } }, requires: ["invoice.customer == self or manages(self, invoice.customer)", "invoice.state == 'open' or invoice.state == 'late'", "level.money >= 3"], outcomes: { default: [{ type: "economy.invoice_pay", args: { invoice: "invoice", by: "self" } }] }, duration: "5", lexicon: ["pay the invoice", "settle the bill"], observable: "checks their phone" });
  core.action({ id: "invoice_void", label: "Void an invoice", pack: "economy", params: { invoice: { type: "ref", ref: INVOICE_KIND } }, requires: ["manages(self, invoice.business)", "invoice.state == 'open' or invoice.state == 'late'", "level.money >= 3"], outcomes: { default: [{ type: "economy.invoice_void", args: { invoice: "invoice", by: "self" } }] }, duration: "5", lexicon: ["void the invoice", "cancel the invoice", "write it off"], observable: "does paperwork" });
  core.action({ id: "owner_draw", label: "Take an owner's draw", pack: "economy", params: { business: { type: "ref", ref: "business" }, amount: { type: "money" } }, requires: ["may_draw(self, business)", "amount > 0", "level.money >= 3"], outcomes: { default: [{ type: "economy.owner_draw", args: { business: "business", cents: "=amount", owner: "self", by: "self" } }] }, duration: "5", lexicon: ["take a draw", "pay myself", "take money out of the business"], observable: "checks their phone" });
  core.action({ id: "distribute_profit", label: "Distribute profit", pack: "economy", params: { business: { type: "ref", ref: "business" }, amount: { type: "money", optional: true, label: "Amount (else its share of the profit)" } }, requires: ["manages(self, business)", "level.money >= 3"], outcomes: { default: [{ type: "economy.distribute", args: { business: "business", cents: "=params.amount", by: "self" } }] }, duration: "10", lexicon: ["distribute profit", "pay dividends", "pay out the owners"], observable: "does paperwork" });

  core.query("economy.business_books", (ctx, business, from, to) => {
    const b = businessBooks(api, ctx, business, from, to);
    return { revenue: b.revenue, expenses: b.expenses, profit: b.profit, receivables: b.receivables, payables: b.payables };
  });
  core.query("economy.operating_account", (ctx, business) => operatingAccount(api, ctx, business));

  r.view((ctx, party, _view, viewer) => {
    const mine = businessesOf(ctx, api, party);
    const alerts = invoiceAlerts(ctx, api, party, viewer);
    return { ...(mine.length > 0 ? { businesses: mine.map((b) => businessView(ctx, api, b, party, viewer)) } : {}), ...(alerts.length > 0 ? { alerts } : {}) };
  });
  r.summary((ctx, who) => {
    const out: string[] = [];
    const now = ctx.state.clock;
    for (const b of businessesOf(ctx, api, who)) {
      if (b === who) continue;
      const month = monthBook(ctx.state, b, monthOf(ctx.world, now));
      const books = businessBooks(api, ctx, b, monthStart(ctx, now), now + 1);
      out.push(`${labelOf(ctx, b)}, which they own, has ${books.profit >= 0 ? "made" : "lost"} ${api.money(ctx, Math.abs(books.profit))} so far this month on ${api.money(ctx, books.revenue)} taken in${month.payroll > 0 ? `, ${api.money(ctx, month.payroll)} of it gone on wages` : ""}.`);
      const acct = operatingAccount(api, ctx, b);
      if (acct) out.push(`Its account holds ${api.money(ctx, api.balance(ctx.state, acct))}.`);
    }
    for (const inv of allInvoices(ctx)) {
      if (inv.left <= 0) continue;
      if (inv.party === who) out.push(`They owe ${labelOf(ctx, inv.business)} ${api.money(ctx, inv.left)} for ${inv.memo}${inv.state === "late" ? ", and it is late" : `, due ${formatClock(calendarOf(ctx.world), inv.due)}`}.`);
    }
    return out;
  });

  core.lint({
    code: "economy.business",
    check(world) {
      const issues = [];
      for (const e of Object.values(world.entities)) {
        if (e.kind === INVOICE_KIND) {
          if (typeof e.fields.business !== "string" || own(world.entities, e.fields.business)?.kind !== "business") issues.push({ severity: "error" as const, code: "economy.business", message: `Invoice ${e.name} isn't from a business.`, path: `entities.${e.id}.fields.business` });
          if (typeof e.fields.customer !== "string" || e.fields.customer === "") issues.push({ severity: "error" as const, code: "economy.business", message: `Invoice ${e.name} bills nobody.`, path: `entities.${e.id}.fields.customer` });
          if (!(typeof e.fields.cents === "number" && e.fields.cents > 0)) issues.push({ severity: "error" as const, code: "economy.business", message: `Invoice ${e.name} needs an amount.`, path: `entities.${e.id}.fields.cents` });
        }
        if (e.kind !== "business") continue;
        const places = e.fields.places;
        if (Array.isArray(places)) for (const p of places) if (typeof p !== "string" || !own(world.places, p)) issues.push({ severity: "error" as const, code: "economy.business", message: `${e.name} trades at a place that doesn't exist: ${String(p)}.`, path: `entities.${e.id}.fields.places` });
        const operating = e.fields.operating_account;
        if (typeof operating === "string" && operating !== "" && !own(world.entities, operating)) issues.push({ severity: "error" as const, code: "economy.business", message: `${e.name}'s operating account doesn't exist.`, path: `entities.${e.id}.fields.operating_account` });
        const margin = e.fields.margin_pct;
        if (margin !== undefined && !(typeof margin === "number" && margin >= 0 && margin <= 100)) issues.push({ severity: "error" as const, code: "economy.business", message: `${e.name}'s margin must be a percentage from 0 to 100.`, path: `entities.${e.id}.fields.margin_pct` });
      }
      return issues;
    },
  });
}

