// Winding up and merging companies (ORG-SPEC §3.13, Phase 5; DESIGN §27.10): the money half, which
// the orgs pack's `orgs.wind_up` and `orgs.merge` call and finish with what is the organization's own
// (its people, positions and delegations, its History), all one unit.
//
// Winding up begins by stopping a company trading: its jobs end, its standing payments end, it takes
// no walk-in custom and pays out no profit, and it is marked winding up. It finishes by settling it:
// its holdings sold at the day's market (and, where its plan sells, its real estate and its stakes at
// their value), every account's cash gathered in one, the last wages its staff are owed paid as their
// payday would pay them, its unemployment tax, what its suppliers and the sales tax it collected are
// owed, the invoices billed to it, a corporation's income tax still owed, its overdrafts,
// loans and cards paid; what it is owed written off; what it still holds handed to its owners by share
// (things and vehicles to one of them); the leases it rents ended; the rest of its cash paid out to
// its owners by share, each realising their gain against what they put in; its accounts closed; and it
// dissolved. A company that can't pay what it owes isn't wound up, and nothing is written.
//
// Merging folds one company into another: its holders take the survivor's units at a ratio (by value
// unless one is said) and any cash the survivor pays, carrying their basis over to the units; it pays
// what it owes its suppliers and in taxes (a corporation's income tax still owed among them); its
// accounts, holdings, property, stakes, things, staff, invoices, places and the standing payments it
// makes or takes become the survivor's, and it is dissolved as merged. Kept instead, the survivor
// takes all of it as its subsidiary and nothing else moves. Each step runs on one working state, so
// each sees the last.

import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { opaqueId } from "../../../shared/hash";
import { countsUnits, listingIn, moveUnits, ownersIn, ownersJson, ROLE_RIGHTS, unitsOf, withUnitShares, worthShares, type MergeOption, type MergeView, type Owner, type WindAsset, type WindingView, type WindLine, type WindPayout } from "../../../shared/finance";
import { DISSOLVED_FIELD, MERGED_INTO_FIELD, POWER_WORDS, WINDING_FIELD, type OrgPower, type WindProperty } from "../../../shared/org";
import type { FieldDef } from "../../../shared/world";
import { calendarOf, clockAt, dayIndexOfText } from "../../../engine/calendar";
import { dayWords, dissolvedOn, mayAct, orgTypeOf, placesOf, windingUpSince } from "../../../engine/org";
import { labelOf, numOf, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { isGone } from "../../../engine/scope";
import { COMPANY_KIND } from "../../../engine/selector";
import { Working } from "../../../engine/working";
import { closeAccount } from "./actions";
import { dateText, reject } from "./assets";
import { operatingAccount } from "./books";
import { invoiceIds, invoiceSettled, isBusiness, readInvoice, settlePosting } from "./business";
import { allJobs, payerOf, payrollPosting, type Job } from "./employment";
import { flowOfEntity } from "./flows";
import { acquisition, basisOf, disposal } from "./gains";
import { accountOfHolding, holdingIds, holdingShare, holdingValue, trade } from "./holdings";
import { hiddenFrom } from "./model";
import type { FinanceApi, FinanceKind, FinanceRegistry, FlowPosting } from "./module";
import { moveLeases, propertyIds, propertyValue, sellProperty } from "./property";
import { openingEvent } from "./process";
import { counted, decisionRefusal } from "./shares";
import { businessIds as companyIds, orgValue, sellStake } from "./stakes";
import { sCorpRefusal, structureOf, taxStillOwed } from "./taxes";
import { UNEMPLOYMENT_ACCRUED } from "./unemployment";

/** What a step said, for the History the orgs pack writes: its words, and the people they name. */
export interface WindSaid {
  text: string;
  names: EntityId[];
}

/** The money half of winding up or merging: its events, worked out on one working state, and what it said. */
export interface WindResult {
  events: LedgerEvent[];
  said: WindSaid[];
}

/** How a company winds up (§3.13): begin (stop trading) or finish (settle, pay out, dissolve, after beginning when it hasn't); its real estate and stakes handed out or sold; who gets its things (else its largest holder). */
export interface WindPlan {
  stage: "begin" | "finish";
  property: WindProperty;
  to: EntityId;
}

/** A merger's terms (§3.13): the survivor's units a unit of the merged company (absent: by value), the cash its holders get in all and the survivor's account it comes from, kept as a subsidiary or folded in, and the survivor's position each of the merged company's positions becomes. */
export interface MergeTerms {
  ratio?: number;
  cash?: number;
  from?: EntityId;
  keep: boolean;
  positions: Readonly<Record<string, string>>;
}

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Who decides for `business` when `by` acts (§3.13): themselves, or an organization holding it that they govern, the first with the power and more than its threshold of the votes; `party` "" for the GM (no `by`); else why no one they speak for may, `doing` heading the words ("Winding up"). */
    "economy.decider": (ctx: ReadContext, by: EntityId, business: EntityId, power: OrgPower, doing: string) => { party: EntityId } | Rejection;
  }
  interface ServiceMap {
    /** The money half of winding up a company (§3.13): its stage's events and what they said, or why it can't be wound up. */
    "economy.wind_up": (ctx: ReadContext, business: EntityId, plan: WindPlan) => WindResult | Rejection;
    /** The money half of merging `business` into `into` (§3.13): its events and what they said, or why they can't merge. */
    "economy.merge": (ctx: ReadContext, business: EntityId, into: EntityId, terms: MergeTerms) => WindResult | Rejection;
  }
}

/** The business fields winding up and merging write (§3.13), each set only by them or the GM. */
const WIND_FIELDS: Record<string, FieldDef> = {
  [WINDING_FIELD]: { type: "text", label: "Winding up since (YYYY-MM-DD)", domain: "money", level: 3 },
  [DISSOLVED_FIELD]: { type: "text", label: "Dissolved on (YYYY-MM-DD)", domain: "money", level: 3 },
  [MERGED_INTO_FIELD]: { type: "ref", label: "Merged into", ref: COMPANY_KIND, domain: "money", level: 3 },
};

/** The money foundation's own kinds, which keep their holders on an `owners` list, never a single `owner`. */
const MONEY_KINDS: readonly FinanceKind[] = ["account", "card", "flow", "trust", "business", "job", "holding", "property", "invoice"];

function isRejection<T>(v: T | Rejection): v is Rejection {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "code" in v && "reason" in v;
}

/** Today as a field writes a day (`YYYY-MM-DD`). */
function today(ctx: ReadContext): string {
  return dateText(ctx.world, ctx.state.clock);
}

/** Whether a company is listed on a market (its `listing`, as `listingIn` reads it): winding up and merging wait until it is delisted. */
function listed(ctx: ReadContext, business: EntityId): boolean {
  const fields = own(ctx.state.entities, business)?.fields;
  return fields !== undefined && listingIn(fields) !== null;
}

/** Why `business` can't be wound up or merged now: it isn't a company still in the world, it was dissolved, it is listed, or its money is below Money 3. */
function standingProblem(ctx: ReadContext, business: EntityId): Rejection | null {
  const name = labelOf(ctx, business);
  if (!isBusiness(ctx, business) || isGone(ctx.state, business)) return reject("not_business", `${name} isn't a company`);
  const dissolved = dissolvedOn(ctx.state, business);
  if (dissolved !== null) return reject("dissolved", `${name} was dissolved on ${dayWords(ctx.world, dissolved)}`);
  if (listed(ctx, business)) return reject("listed", `${name} is listed on the market: delist it first`);
  if (ctx.levelOf(business, "money") < 3) return reject("level", `${name} is wound up or merged from Money 3`);
  return null;
}

/** Applies events to the working state in order; the first that doesn't apply, as a rejection. */
function applied(w: Working, events: readonly LedgerEvent[]): Rejection | null {
  for (const e of events) {
    const failed = w.apply(e);
    if (failed) return failed;
  }
  return null;
}

/** Whether `party` holds all the worth of `entity` (no one else's role carries any). */
function soleHolder(api: FinanceApi, ctx: ReadContext, entity: EntityId, party: EntityId): boolean {
  const worth = api.ownersOf(ctx.state, entity).filter((o) => ROLE_RIGHTS[o.role].worth);
  return worth.length > 0 && worth.every((o) => o.party === party);
}

/** The accounts `business` holds a row on, in id order. */
function accountsNaming(api: FinanceApi, ctx: ReadContext, business: EntityId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .filter((id) => own(ctx.state.entities, id)?.kind === "account" && !isGone(ctx.state, id) && api.ownersOf(ctx.state, id).some((o) => o.party === business))
    .sort();
}

/** Its own accounts: those whose worth is all the company's. */
function ownAccounts(api: FinanceApi, ctx: ReadContext, business: EntityId): EntityId[] {
  return accountsNaming(api, ctx, business).filter((a) => soleHolder(api, ctx, a, business));
}

/** Whether an account is a debt (a loan, a card, a line of credit, a mortgage). */
function isDebt(api: FinanceApi, ctx: ReadContext, account: EntityId): boolean {
  return api.traitsOf(ctx, account)?.liability === true;
}

/**
 * Where a winding-up company gathers its cash: its operating account where that is all its own, else
 * the first own account that isn't a debt; never one another party co-owns or it only uses, whose
 * money isn't all its to pay out.
 */
function gatheringAccount(api: FinanceApi, ctx: ReadContext, business: EntityId): EntityId | null {
  const mine = ownAccounts(api, ctx, business);
  const operating = operatingAccount(api, ctx, business);
  return operating !== null && mine.includes(operating) ? operating : (mine.find((a) => !isDebt(api, ctx, a)) ?? null);
}

/** A company's worth-bearing holders by their shares, largest first, then by id. */
function holdersOf(api: FinanceApi, ctx: ReadContext, business: EntityId): { party: EntityId; share: number }[] {
  return Object.entries(worthShares(api.ownersOf(ctx.state, business)))
    .filter(([party, share]) => share > 0 && party !== business)
    .map(([party, share]) => ({ party, share }))
    .sort((a, b) => b.share - a.share || a.party.localeCompare(b.party));
}

/** Splits `cents` by shares, the last taking what rounding leaves. */
function splitByShare(cents: number, rows: readonly { party: EntityId; share: number }[]): { party: EntityId; cents: number }[] {
  const total = rows.reduce((a, r) => a + r.share, 0);
  let given = 0;
  return rows.map((r, i) => {
    const part = i === rows.length - 1 ? cents - given : total > 0 ? Math.round((cents * r.share) / total) : 0;
    given += part;
    return { party: r.party, cents: part };
  });
}

/** `units` split by shares, largest remainders first, so they add up. */
function unitsByShare(units: number, rows: readonly { party: EntityId; share: number }[]): Map<EntityId, number> {
  const total = rows.reduce((a, r) => a + r.share, 0);
  const exact = rows.map((r) => ({ party: r.party, exact: total > 0 ? (units * r.share) / total : 0 }));
  const out = new Map(exact.map((e) => [e.party, Math.floor(e.exact)]));
  let left = units - [...out.values()].reduce((a, u) => a + u, 0);
  for (const e of [...exact].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.party.localeCompare(b.party))) {
    if (left <= 0) break;
    out.set(e.party, (out.get(e.party) ?? 0) + 1);
    left--;
  }
  return out;
}

/** An owners list with `from`'s rows given to `to`, merged into `to`'s row of the same role and class. */
function rowsTo(owners: readonly Owner[], from: EntityId, to: EntityId): Owner[] {
  const out: Owner[] = [];
  for (const o of owners) {
    const party = o.party === from ? to : o.party;
    const same = out.find((x) => x.party === party && x.role === o.role && x.class === o.class);
    if (!same) {
      out.push({ ...o, party });
      continue;
    }
    if (o.share !== undefined || same.share !== undefined) same.share = Math.round(((same.share ?? 0) + (o.share ?? 0)) * 10000) / 10000;
    if (o.units !== undefined || same.units !== undefined) same.units = (same.units ?? 0) + (o.units ?? 0);
  }
  return out;
}

/** An owners list with `party`'s share of the worth handed to `rows` by their shares, each added to their own row, every other share written out as it was. */
function rowsHandedOut(owners: readonly Owner[], party: EntityId, rows: readonly { party: EntityId; share: number }[]): Owner[] {
  const shares = worthShares(owners);
  const held = shares[party] ?? 0;
  const out: Owner[] = [];
  for (const o of owners) {
    if (o.party === party || out.some((x) => x.party === o.party && x.role === o.role)) continue;
    out.push(ROLE_RIGHTS[o.role].worth ? { party: o.party, role: o.role, share: shares[o.party] ?? 0 } : { ...o });
  }
  const total = rows.reduce((a, r) => a + r.share, 0);
  for (const r of rows) {
    const part = total > 0 ? (held * r.share) / total : 0;
    const row = out.find((x) => x.party === r.party && ROLE_RIGHTS[x.role].worth);
    if (row) row.share = (row.share ?? 0) + part;
    else out.push({ party: r.party, role: "owner", share: part });
  }
  return out.map((o) => (o.share !== undefined ? { ...o, share: Math.round(o.share * 10000) / 10000 } : o));
}

// ---------------------------------------------------------------- deciding

/** Who decides for `business` with `power` when `by` acts (§3.13), or why no one they speak for may. */
export function deciderFor(ctx: ReadContext, by: EntityId, business: EntityId, power: OrgPower, doing: string): { party: EntityId } | Rejection {
  if (by === "") return { party: "" };
  const shares = worthShares(ownersIn(own(ctx.state.entities, business)?.fields ?? {}));
  const holders = Object.keys(shares)
    .filter((p) => p !== by && p !== business && (shares[p] ?? 0) > 0 && orgTypeOf(ctx, p) !== null)
    .sort();
  let first: Rejection | null = null;
  for (const party of [by, ...holders]) {
    if (party !== by && !mayAct(ctx, by, party, "org.govern").ok) continue;
    const holds = mayAct(ctx, party, business, power);
    if (!holds.ok) {
      first ??= reject("not_allowed", holds.reason);
      continue;
    }
    const why = decisionRefusal(ctx, business, party, doing);
    if (why === null) return { party };
    first ??= reject("votes", why);
  }
  return first ?? reject("not_allowed", `${labelOf(ctx, business)}: you may not ${POWER_WORDS[power]}`);
}

// ---------------------------------------------------------------- winding up: begin

/** The jobs a company employs someone in that haven't ended (begun or still to begin). */
function openJobs(ctx: ReadContext, business: EntityId): Job[] {
  return allJobs(ctx).filter((j) => j.party === business && j.status !== "ended");
}

/** The standing payments a company makes or takes (authored flows, never a lease's rent) still running: from or to it, or an account of its. */
function standingPayments(api: FinanceApi, ctx: ReadContext, business: EntityId): { id: EntityId; label: string }[] {
  const mine = new Set([business, ...accountsNaming(api, ctx, business)]);
  return Object.keys(ctx.state.entities)
    .sort()
    .flatMap((id) => {
      const e = own(ctx.state.entities, id);
      if (!e || e.kind !== "flow" || e.fields.flow_kind === "rent" || strOf(e.fields.status, "active") === "ended") return [];
      const f = flowOfEntity(ctx, id);
      return f && (mine.has(f.from) || mine.has(f.to)) ? [{ id, label: e.name }] : [];
    });
}

/** A standing payment as `viewer` may read it: one whose flow, or a side it pays from or to, they can't see reads unnamed, under an opaque id (DESIGN §7). */
function paymentShown(ctx: ReadContext, viewer: EntityId | null, p: { id: EntityId; label: string }): { id: EntityId; label: string } {
  const f = flowOfEntity(ctx, p.id);
  const sides = f ? [f.from, f.to, ...(f.splits ?? []).map((s) => s.to)] : [];
  return hiddenFrom(ctx, viewer, p.id) || sides.some((side) => hiddenFrom(ctx, viewer, side)) ? { id: opaqueId(p.id), label: "A standing payment" } : p;
}

/** Begin winding up (§3.13) on the working state: every job that hasn't ended ends today, every standing payment ends, and it is marked winding up since today. */
function begin(api: FinanceApi, w: Working, business: EntityId, said: WindSaid[]): Rejection | null {
  const ctx = w.ctx;
  const day = today(ctx);
  const jobs = openJobs(ctx, business);
  const payments = standingPayments(api, ctx, business);
  const failed = applied(w, [
    ...jobs.flatMap((j): LedgerEvent[] => [
      { type: "set", entity: j.id, field: "end", value: day },
      { type: "set", entity: j.id, field: "status", value: "ended" },
    ]),
    ...payments.flatMap((p): LedgerEvent[] => [
      { type: "set", entity: p.id, field: "status", value: "ended" },
      { type: "set", entity: p.id, field: "gone", value: true },
    ]),
    { type: "set", entity: business, field: WINDING_FIELD, value: day },
  ]);
  if (failed) return failed;
  const workers = [...new Set(jobs.map((j) => j.worker))];
  const parts = [workers.length > 0 ? `let ${workers.length === 1 ? labelOf(ctx, workers[0] ?? "") : `${workers.length} staff`} go` : null, payments.length > 0 ? `ended ${payments.length === 1 ? "a standing payment" : `${payments.length} standing payments`}` : null].filter((x): x is string => x !== null);
  said.push({ text: `Began winding up${parts.length > 0 ? `: ${parts.join(" and ")}` : ""}`, names: workers.length === 1 ? workers : [] });
  return null;
}

// ---------------------------------------------------------------- winding up: what it owes, holds and is owed

/** A posting's lines with what any of `payers` pays moved onto `to` (the account a winding-up company gathered its cash in). */
function paidFrom(lines: readonly PostingLine[], payers: ReadonlySet<string>, to: EntityId): PostingLine[] {
  const out: PostingLine[] = [];
  for (const l of lines) {
    const account = l.amount < 0 && payers.has(l.account) ? to : l.account;
    const same = out.find((x) => x.account === account);
    if (same) same.amount += l.amount;
    else out.push({ account, amount: l.amount });
  }
  return out.filter((l) => l.amount !== 0);
}

/** A paycheck winding up pays now: whose, the account its job pays from, and its posting as its payday would make it. */
interface LastPay {
  worker: EntityId;
  payer: EntityId;
  posting: FlowPosting;
}

/**
 * The paychecks a company's staff are still owed, each as its job's payroll flow would post it on
 * its next payday: for an ended job, its last (the payday that settles its end); for one still running
 * (the preview of a company that hasn't begun), its next, which its last can't be more than.
 */
function paychecksDue(api: FinanceApi, ctx: ReadContext, business: EntityId, running: boolean): LastPay[] {
  const cal = calendarOf(ctx.world);
  const flows = new Map(api.flows(ctx).map((f) => [f.id, f]));
  return allJobs(ctx).flatMap((job) => {
    if (job.party !== business || (job.status === "ended") === running) return [];
    const flow = flows.get(`pay:${job.id}`);
    if (!flow) return [];
    let until = ctx.state.clock + 62 * 1440;
    if (flow.end !== undefined) {
      try {
        until = clockAt(cal, dayIndexOfText(cal, flow.end) + 1, 0) - 1;
      } catch {
        return [];
      }
    } else if (!running) return [];
    const at = api.occurrences(ctx, flow.schedule, ctx.state.clock - 1, until, flow.start)[0];
    if (at === undefined) return [];
    const posting = payrollPosting(ctx, api, flow, at);
    return posting === null || isRejection(posting) ? [] : [{ worker: job.worker, payer: payerOf(ctx, api, job), posting }];
  });
}

/** What a paycheck costs its payer: its gross, with the employer's match and payroll tax. */
function payCost(p: LastPay): number {
  const out = -(p.posting.lines ?? []).filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0);
  return out > 0 ? out : p.posting.cents;
}

/** The debts a company would pay if it finished winding up now: wages (still running, for the preview), unemployment tax (with what those last paychecks add to it), suppliers and sales tax, invoices billed to it, income tax, and what its accounts owe. */
function debtsOf(api: FinanceApi, ctx: ReadContext, business: EntityId, gather: EntityId | null, preview: boolean, viewer: EntityId | null): WindLine[] {
  const name = (id: EntityId): string => (hiddenFrom(ctx, viewer, id) ? "someone" : labelOf(ctx, id));
  const out: WindLine[] = [];
  const pays = [...paychecksDue(api, ctx, business, false), ...(preview ? paychecksDue(api, ctx, business, true) : [])];
  for (const p of pays) out.push({ label: `Last pay: ${name(p.worker)}`, cents: payCost(p) });
  const due = optionalService(ctx, "economy.unemployment_due")?.(ctx, business) ?? null;
  // With what those last paychecks add once they are paid (their `economy.unemployment_accrued`): FUTA, the credit reduction and SUTA.
  const accruing = pays.flatMap((p) => p.posting.extra ?? []).reduce((a, e) => (e.type === UNEMPLOYMENT_ACCRUED && "data" in e ? a + numOf(e.data.futa) + numOf(e.data.reduction) + numOf(e.data.suta) : a), 0);
  const unemployment = (due?.cents ?? 0) + accruing;
  if (unemployment > 0) out.push({ label: "Unemployment tax", cents: unemployment });
  for (const what of ["suppliers", "sales_tax"] as const) {
    const p = settlePosting(ctx, api, business, what);
    if (p && p.cents > 0) out.push({ label: what === "sales_tax" ? "Sales tax it collected" : "Its suppliers", cents: p.cents });
  }
  for (const id of invoiceIds(ctx)) {
    const inv = readInvoice(ctx, id);
    if (inv && inv.party === business && inv.left > 0) out.push({ label: `Invoice from ${name(inv.business)}`, cents: inv.left });
  }
  const tax = taxStillOwed(api, ctx, business)?.cents ?? 0;
  if (tax > 0) out.push({ label: "Income tax still owed", cents: tax });
  for (const a of ownAccounts(api, ctx, business)) {
    const owed = -api.balance(ctx.state, a);
    if (owed > 0 && a !== gather) out.push({ label: isDebt(api, ctx, a) ? labelOf(ctx, a) : `${labelOf(ctx, a)}, overdrawn`, cents: owed });
  }
  return out;
}

/** What it is owed that winding up writes off: invoices it issued still open. */
function owedOf(ctx: ReadContext, business: EntityId, viewer: EntityId | null): { id: EntityId; line: WindLine }[] {
  return invoiceIds(ctx).flatMap((id) => {
    const inv = readInvoice(ctx, id);
    return inv && inv.business === business && inv.left > 0 ? [{ id, line: { label: `Invoice to ${inv.party !== null && hiddenFrom(ctx, viewer, inv.party) ? "someone" : labelOf(ctx, inv.customer)}`, cents: inv.left } }] : [];
  });
}

/** The holdings a company holds all of (held directly, or in its own accounts). */
function soleHoldings(api: FinanceApi, ctx: ReadContext, business: EntityId): EntityId[] {
  return holdingIds(ctx.state).filter((h) => {
    const account = accountOfHolding(ctx.state, h);
    return holdingShare(api, ctx.state, h, business) > 0 && soleHolder(api, ctx, account ?? h, business);
  });
}

/** The things and vehicles a company owns (its `owner`, or an `owners` list it is on), outside the money foundation's own kinds. */
function ownedThings(ctx: ReadContext, business: EntityId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && ownersIn(e.fields).some((o) => o.party === business) && !isGone(ctx.state, id) && !(MONEY_KINDS as readonly string[]).includes(e.kind);
    })
    .sort();
}

/** The properties and stakes a company holds a share of, each sold where its plan sells and it holds all of one worth something (a property only where property is followed), else handed out. */
function heldAssets(api: FinanceApi, ctx: ReadContext, business: EntityId, sell: boolean): { properties: { id: EntityId; sold: boolean }[]; stakes: { id: EntityId; sold: boolean }[] } {
  const properties = propertyIds(ctx.state)
    .filter((p) => api.shareOf(ctx.state, p, business) > 0)
    .map((id) => ({ id, sold: sell && soleHolder(api, ctx, id, business) && api.feature(ctx, business, "property") && propertyValue(ctx.state, id) > 0 }));
  const stakes = companyIds(api, ctx)
    .filter((c) => c !== business && dissolvedOn(ctx.state, c) === null && api.shareOf(ctx.state, c, business) > 0)
    .map((id) => ({ id, sold: sell && soleHolder(api, ctx, id, business) && orgValue(api, ctx, id) > 0 }));
  return { properties, stakes };
}

/** Who gets a winding-up company's things: `to` when it is a party in the world, else its largest holder. */
function thingsTo(api: FinanceApi, ctx: ReadContext, business: EntityId, to: EntityId): EntityId | null {
  if (to !== "" && to !== business && api.partyKind(ctx, to) !== null && !isGone(ctx.state, to)) return to;
  return holdersOf(api, ctx, business)[0]?.party ?? null;
}

/** What it holds besides cash and where each goes, as the preview lists them: what `viewer` can't see unnamed, under an opaque id (DESIGN §7). */
function assetsOf(api: FinanceApi, ctx: ReadContext, business: EntityId, plan: Pick<WindPlan, "property" | "to">, viewer: EntityId | null): WindAsset[] {
  const { properties, stakes } = heldAssets(api, ctx, business, plan.property === "sell");
  const recipient = thingsTo(api, ctx, business, plan.to);
  const goes = recipient === null ? "to no one" : `to ${hiddenFrom(ctx, viewer, recipient) ? "one of its owners" : labelOf(ctx, recipient)}`;
  const shown = (id: EntityId, unseen: string): Pick<WindAsset, "id" | "label"> => (hiddenFrom(ctx, viewer, id) ? { id: opaqueId(id), label: unseen } : { id, label: labelOf(ctx, id) });
  return [
    ...soleHoldings(api, ctx, business).map((h) => ({ ...shown(h, "A holding"), value: holdingValue(ctx, h), goes: "sold at the market" })),
    ...properties.map((p) => ({ ...shown(p.id, "A property"), value: Math.round((propertyValue(ctx.state, p.id) * api.shareOf(ctx.state, p.id, business)) / 100), goes: p.sold ? "sold at its value" : "to its owners by share" })),
    ...stakes.map((s) => ({ ...shown(s.id, "A stake in another company"), value: Math.round((orgValue(api, ctx, s.id) * api.shareOf(ctx.state, s.id, business)) / 100), goes: s.sold ? "sold at its value" : "to its owners by share" })),
    ...ownedThings(ctx, business).map((t) => ({ ...shown(t, "Something it owns"), value: null, goes })),
  ];
}

// ---------------------------------------------------------------- winding up: finish

/**
 * Finish winding up (§3.13) on the working state: sell, gather, pay what it owes, write off what it
 * is owed, hand out what it holds, end the leases it rents, pay out the rest by share, close its
 * accounts and dissolve it. Refused, writing nothing, when it can't pay what it owes.
 */
function finish(api: FinanceApi, w: Working, business: EntityId, plan: WindPlan, said: WindSaid[]): Rejection | null {
  const bizName = labelOf(w.ctx, business);
  const holders = holdersOf(api, w.ctx, business);
  if (holders.length === 0) return reject("no_owners", `${bizName} has no owners to pay out to`);
  const money = (c: number): string => api.money(w.ctx, c);
  const run = (events: LedgerEvent[] | Rejection): Rejection | null => (isRejection(events) ? events : applied(w, events));

  // Its holdings at the market, and what its plan sells at its value: the proceeds land in its accounts.
  const { properties, stakes } = heldAssets(api, w.ctx, business, plan.property === "sell");
  for (const h of soleHoldings(api, w.ctx, business)) {
    const sold = trade(api, w.ctx, { side: "sell", party: business, holding: h });
    // A contract past its expiry or a bond past its maturity can't trade: it is worth nothing more.
    if (isRejection(sold)) continue;
    const failed = applied(w, sold);
    if (failed) return failed;
  }
  for (const p of properties.filter((x) => x.sold)) {
    const sold = sellProperty(api, w.ctx, { party: business, property: p.id, price: propertyValue(w.ctx.state, p.id) });
    if (isRejection(sold)) p.sold = false;
    else if (applied(w, sold)) return reject("declined", `${labelOf(w.ctx, p.id)} couldn't be sold`);
  }
  for (const s of stakes.filter((x) => x.sold)) {
    const sold = sellStake(api, w.ctx, { party: business, business: s.id, share: 100, price: orgValue(api, w.ctx, s.id) });
    if (isRejection(sold)) s.sold = false;
    else if (applied(w, sold)) return reject("declined", `${bizName}'s stake in ${labelOf(w.ctx, s.id)} couldn't be sold`);
  }

  // Every account's cash gathered in one.
  const gather = gatheringAccount(api, w.ctx, business);
  if (gather !== null) {
    const lines = ownAccounts(api, w.ctx, business).flatMap((a): PostingLine[] => {
      const cents = api.balance(w.ctx.state, a);
      return a === gather || isDebt(api, w.ctx, a) || cents <= 0 ? [] : [{ account: a, amount: -cents }];
    });
    if (lines.length > 0) {
      const failed = run(api.post(w.ctx, [...lines, { account: gather, amount: -lines.reduce((s, l) => s + l.amount, 0) }], { memo: `${bizName}: gathered for winding up`, kind: "transfer", category: "transfer" }));
      if (failed) return failed;
    }
  }

  // What it owes, reckoned in all before any of it is paid.
  const owing = debtsOf(api, w.ctx, business, gather, false, null).reduce((a, d) => a + d.cents, 0);
  const cash = gather === null ? 0 : api.balance(w.ctx.state, gather);
  if (owing > cash) return reject("insolvent", `${bizName} owes ${money(owing)} and holds ${money(Math.max(0, cash))}: it is ${money(owing - Math.max(0, cash))} short. Sell something first, or put money in.`);
  const pay = (lines: readonly PostingLine[], memo: string, category: string, extra: readonly LedgerEvent[] = []): Rejection | null => {
    const posted = api.post(w.ctx, [...lines], { memo, kind: "payment", category });
    return isRejection(posted) ? posted : applied(w, [...posted, ...extra]);
  };
  if (gather !== null) {
    for (const p of paychecksDue(api, w.ctx, business, false)) {
      const lines = paidFrom(p.posting.lines ?? [], new Set([p.payer]), gather);
      const failed = lines.length === 0 ? applied(w, p.posting.extra ?? []) : pay(lines, p.posting.memo ?? "Payroll", p.posting.category ?? "payroll", p.posting.extra ?? []);
      if (failed) return failed;
    }
    const due = optionalService(w.ctx, "economy.unemployment_due")?.(w.ctx, business) ?? null;
    if (due && due.cents > 0) {
      // Booked as payroll by the payment's own record, as the quarterly flow books it.
      const failed = pay(paidFrom(due.lines, new Set(due.lines.filter((l) => l.amount < 0).map((l) => l.account)), gather), "Unemployment tax", "payroll", due.events);
      if (failed) return failed;
    }
    for (const what of ["suppliers", "sales_tax"] as const) {
      const p = settlePosting(w.ctx, api, business, what);
      if (!p || p.cents <= 0 || !p.lines) continue;
      const failed = pay(paidFrom(p.lines, new Set(p.lines.filter((l) => l.amount < 0).map((l) => l.account)), gather), p.memo ?? what, p.category ?? what, p.extra ?? []);
      if (failed) return failed;
    }
    for (const id of invoiceIds(w.ctx)) {
      const inv = readInvoice(w.ctx, id);
      if (!inv || inv.party !== business || inv.left <= 0) continue;
      const deposit = operatingAccount(api, w.ctx, inv.business);
      const paid = api.pay(w.ctx, { from: gather, to: inv.business, cents: inv.left, memo: `Invoice: ${inv.memo}`, kind: "payment", category: "invoice", method: "account", ...(deposit ? { deposit } : {}) });
      const failed = isRejection(paid) ? paid : applied(w, [...paid, ...invoiceSettled(inv, inv.left)]);
      if (failed) return failed;
    }
    // Its income tax still owed, with the estimated-tax records that say which periods it settled.
    const tax = taxStillOwed(api, w.ctx, business);
    if (tax) {
      const failed = pay([{ account: gather, amount: -tax.cents }, { account: api.outside("tax:federal"), amount: tax.cents }], "Corporate income tax", "business_tax", tax.extra);
      if (failed) return failed;
    }
    for (const a of ownAccounts(api, w.ctx, business)) {
      const owed = -api.balance(w.ctx.state, a);
      if (a === gather || owed <= 0) continue;
      const failed = pay([{ account: gather, amount: -owed }, { account: a, amount: owed }], `${labelOf(w.ctx, a)} paid off`, isDebt(api, w.ctx, a) ? "loan" : "transfer");
      if (failed) return failed;
    }
  }
  if (owing > 0) said.push({ text: `Paid ${money(owing)} it owed`, names: [] });

  // What it is owed, written off.
  const owed = owedOf(w.ctx, business, null);
  if (owed.length > 0) {
    const failed = applied(
      w,
      owed.map((o): LedgerEvent => ({ type: "set", entity: o.id, field: "state", value: "void" })),
    );
    if (failed) return failed;
    said.push({ text: `Wrote off ${owed.length === 1 ? "an invoice" : `${owed.length} invoices`} owed it (${money(owed.reduce((a, o) => a + o.line.cents, 0))})`, names: [] });
  }

  // What it still holds, handed to its owners by share, each starting their basis at its value; things and vehicles to one of them.
  const inKind = new Map<EntityId, number>();
  const handOut = (entity: EntityId, next: readonly Owner[], value: number, more: readonly LedgerEvent[]): Rejection | null => {
    const parts = splitByShare(Math.round(value), holders);
    for (const x of parts) inKind.set(x.party, (inKind.get(x.party) ?? 0) + Math.max(0, x.cents));
    return applied(w, [{ type: "set", entity, field: "owners", value: ownersJson(next) as unknown as JsonValue }, ...more, ...parts.map((x) => acquisition(entity, x.party, x.cents))]);
  };
  for (const p of properties.filter((x) => !x.sold)) {
    const owners = api.ownersOf(w.ctx.state, p.id);
    const share = api.shareOf(w.ctx.state, p.id, business);
    if (share <= 0) continue;
    const next = rowsHandedOut(owners, business, holders);
    const rent = strOf(own(w.ctx.state.entities, p.id)?.fields.rent_to);
    const routed: LedgerEvent[] = rent !== "" && accountsNaming(api, w.ctx, business).includes(rent) ? [{ type: "set", entity: p.id, field: "rent_to", value: null }] : [];
    const failed = handOut(p.id, next, (propertyValue(w.ctx.state, p.id) * share) / 100, [...routed, ...moveLeases(api, w.ctx, p.id, owners.map((o) => o.party), next)]);
    if (failed) return failed;
    said.push({ text: `Handed its share of ${labelOf(w.ctx, p.id)} to its owners`, names: [] });
  }
  for (const s of stakes.filter((x) => !x.sold)) {
    const owners = api.ownersOf(w.ctx.state, s.id);
    const share = api.shareOf(w.ctx.state, s.id, business);
    if (share <= 0) continue;
    let next: Owner[] = owners;
    if (countsUnits(owners)) {
      const split = unitsByShare(unitsOf(owners, business), holders);
      for (const h of holders) next = moveUnits(next, business, h.party, split.get(h.party) ?? 0);
    } else next = rowsHandedOut(owners, business, holders);
    const failed = handOut(s.id, next, (orgValue(api, w.ctx, s.id) * share) / 100, []);
    if (failed) return failed;
    said.push({ text: `Handed its stake in ${labelOf(w.ctx, s.id)} to its owners`, names: [] });
  }
  const things = ownedThings(w.ctx, business);
  const recipient = thingsTo(api, w.ctx, business, plan.to);
  if (things.length > 0 && recipient !== null) {
    const failed = applied(
      w,
      things.map((t): LedgerEvent => ({ type: "set", entity: t, field: "owner", value: recipient })),
    );
    if (failed) return failed;
    said.push({ text: `Gave ${things.length === 1 ? labelOf(w.ctx, things[0] ?? "") : `${things.length} things`} to ${labelOf(w.ctx, recipient)}`, names: [recipient] });
  }

  // The leases it rents end today.
  const mine = new Set([business, ...accountsNaming(api, w.ctx, business)]);
  const leases = Object.keys(w.ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(w.ctx.state.entities, id);
      return !!e && e.kind === "flow" && e.fields.flow_kind === "rent" && !isGone(w.ctx.state, id) && mine.has(strOf(e.fields.from)) && strOf(e.fields.status, "active") !== "ended";
    });
  const ended = applied(
    w,
    leases.map((id): LedgerEvent => ({ type: "set", entity: id, field: "end", value: today(w.ctx) })),
  );
  if (ended) return ended;

  // The rest of its cash paid out to its owners by share; each realises their gain on all of it, except a corporation holding 80% or more of it, whose subsidiary's liquidation is no sale (§26.3, IRC section 332).
  const left = gather === null ? 0 : Math.max(0, api.balance(w.ctx.state, gather));
  const parts = splitByShare(left, holders);
  for (const part of parts) {
    if (part.cents > 0 && gather !== null) {
      const into = api.depositAccount(w.ctx, part.party);
      if (!into) return reject("no_account", `${labelOf(w.ctx, part.party)} has no account their share of ${bizName} could go to`);
      const failed = run(api.pay(w.ctx, { from: gather, to: part.party, cents: part.cents, memo: `${bizName} wound up: a share of what was left`, deposit: into, kind: "purchase", category: "investment" }));
      if (failed) return failed;
    }
    const parent = (holders.find((h) => h.party === part.party)?.share ?? 0) + 1e-9 >= 80 && api.partyKind(w.ctx, part.party) === "business" && structureOf(w.ctx.state, part.party) === "c_corp";
    const proceeds = parent ? basisOf(api, w.ctx, business, part.party).basis : part.cents + (inKind.get(part.party) ?? 0);
    const failed = applied(w, [disposal(business, part.party, 100, proceeds, `${bizName} wound up`)]);
    if (failed) return failed;
  }
  if (left > 0) for (const p of parts) said.push({ text: `Paid ${labelOf(w.ctx, p.party)} ${money(p.cents)} (${Math.round((holders.find((h) => h.party === p.party)?.share ?? 0) * 100) / 100}%) of what was left`, names: [p.party] });

  // Its accounts closed (one it shares keeps going without it), its owners gone, and it dissolved.
  for (const a of accountsNaming(api, w.ctx, business)) {
    if (!soleHolder(api, w.ctx, a, business)) {
      const failed = applied(w, [{ type: "set", entity: a, field: "owners", value: ownersJson(api.ownersOf(w.ctx.state, a).filter((o) => o.party !== business)) as unknown as JsonValue }]);
      if (failed) return failed;
      continue;
    }
    if (strOf(own(w.ctx.state.entities, a)?.fields.status, "open") === "closed") continue;
    const failed = run(closeAccount(w.ctx, a));
    if (failed) return failed;
  }
  return applied(w, [
    { type: "set", entity: business, field: "owners", value: [] },
    { type: "set", entity: business, field: DISSOLVED_FIELD, value: today(w.ctx) },
    { type: "set", entity: business, field: WINDING_FIELD, value: null },
  ]);
}

/** `economy.wind_up`: a company's winding up begun, or finished (begun first when it hasn't been), §3.13. */
function windUp(api: FinanceApi, ctx: ReadContext, business: EntityId, plan: WindPlan): WindResult | Rejection {
  const standing = standingProblem(ctx, business);
  if (standing) return standing;
  const winding = windingUpSince(ctx.state, business) !== null;
  if (plan.stage === "begin" && winding) return reject("winding_up", `${labelOf(ctx, business)} is winding up already`);
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const said: WindSaid[] = [];
  const failed = (winding ? null : begin(api, w, business, said)) ?? (plan.stage === "finish" ? finish(api, w, business, plan, said) : null);
  return failed ?? { events: w.events, said };
}

/** A company's winding up as its Ownership shows it to `viewer` (null: the GM), `why` null where they may wind it up; null while it trades and they may not, unless they are short only of the votes (`vote`), when it may be put to a vote. */
export function windingView(api: FinanceApi, ctx: ReadContext, business: EntityId, viewer: EntityId | null, why: string | null, vote = false): WindingView | null {
  const since = windingUpSince(ctx.state, business);
  const dissolved = dissolvedOn(ctx.state, business);
  const into = strOf(own(ctx.state.entities, business)?.fields[MERGED_INTO_FIELD]);
  const mergedInto = into === "" ? null : hiddenFrom(ctx, viewer, into) ? { id: null, name: "another company" } : { id: into, name: labelOf(ctx, into) };
  const base: WindingView = { since: since === null ? null : dayWords(ctx.world, since), dissolved: dissolved === null ? null : dayWords(ctx.world, dissolved), mergedInto, why, cash: 0, debts: [], owed: [], assets: [], staff: [], payments: [], payouts: [], short: 0, ...(vote && dissolved === null ? { vote: true } : {}) };
  if (dissolved !== null) return base;
  if (since === null && why !== null && !vote) return null;
  const name = (id: EntityId): string => (hiddenFrom(ctx, viewer, id) ? "someone" : labelOf(ctx, id));
  const gather = gatheringAccount(api, ctx, business);
  const assets = assetsOf(api, ctx, business, { property: "distribute", to: "" }, viewer);
  const cash = ownAccounts(api, ctx, business).reduce((sum, a) => (isDebt(api, ctx, a) || (a !== gather && api.balance(ctx.state, a) < 0) ? sum : sum + api.balance(ctx.state, a)), 0) + assets.reduce((a, x) => (x.goes === "sold at the market" ? a + (x.value ?? 0) : a), 0);
  const debts = debtsOf(api, ctx, business, gather, since === null, viewer);
  const owing = debts.reduce((a, d) => a + d.cents, 0);
  const holders = holdersOf(api, ctx, business);
  const payouts: WindPayout[] = splitByShare(Math.max(0, cash - owing), holders).map((p) => ({ party: hiddenFrom(ctx, viewer, p.party) ? null : p.party, name: name(p.party), share: holders.find((h) => h.party === p.party)?.share ?? 0, cents: p.cents }));
  const staff = since === null ? openJobs(ctx, business).map((j) => ({ id: hiddenFrom(ctx, viewer, j.worker) ? null : j.worker, name: name(j.worker) })) : [];
  return { ...base, cash, debts, owed: owedOf(ctx, business, viewer).map((o) => o.line), assets, staff, payments: since === null ? standingPayments(api, ctx, business).map((p) => paymentShown(ctx, viewer, p)) : [], payouts, short: Math.max(0, owing - cash) };
}

// ---------------------------------------------------------------- merging

/** A company's owners as merging counts them (in units), their units, and its value a unit. */
function unitValue(api: FinanceApi, ctx: ReadContext, business: EntityId): { owners: Owner[]; units: number; perUnit: number } {
  const owners = counted(api, ctx, business);
  const units = unitsOf(owners);
  return { owners, units, perUnit: units > 0 ? orgValue(api, ctx, business) / units : 0 };
}

/** `economy.merge`: `business` folded into `into`, or taken whole as its subsidiary (§3.13). */
function merge(api: FinanceApi, ctx: ReadContext, business: EntityId, into: EntityId, terms: MergeTerms): WindResult | Rejection {
  const name = labelOf(ctx, business);
  const intoName = labelOf(ctx, into);
  if (business === into) return reject("same", `${name} can't merge with itself`);
  const standing = standingProblem(ctx, business) ?? standingProblem(ctx, into);
  if (standing) return standing;
  for (const id of [business, into]) if (windingUpSince(ctx.state, id) !== null) return reject("winding_up", `${labelOf(ctx, id)} is winding up`);
  const b = unitValue(api, ctx, business);
  const a = unitValue(api, ctx, into);
  const holders = holdersOf(api, ctx, business).filter((h) => h.party !== into);
  const cash = Math.max(0, Math.round(terms.cash ?? 0));
  const ratio = terms.ratio ?? (cash > 0 || holders.length === 0 ? 0 : a.perUnit > 0 ? b.perUnit / a.perUnit : Number.NaN);
  if (!Number.isFinite(ratio) || ratio < 0) return reject("bad_ratio", `${intoName} is worth nothing a unit: say how many of its units each of ${name}'s is worth, or a price`);
  const units = new Map(holders.map((h) => [h.party, Math.round(unitsOf(b.owners, h.party) * ratio)]));
  const paid = new Map(splitByShare(cash, holders).map((p) => [p.party, p.cents]));
  if (holders.length > 0 && cash === 0 && [...units.values()].every((u) => u === 0)) return reject("bad_ratio", `${name}'s holders would get nothing: say a ratio or a price`);
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const said: WindSaid[] = [];
  const money = (c: number): string => api.money(ctx, c);

  // The cash, from the survivor's own account.
  if (cash > 0) {
    const from = terms.from ?? operatingAccount(api, ctx, into);
    if (!from) return reject("no_account", `${intoName} has no account to pay from`);
    const unusable = api.mayUse(ctx, into, from, "from");
    if (unusable) return unusable;
    for (const h of holders) {
      const cents = paid.get(h.party) ?? 0;
      if (cents <= 0) continue;
      const deposit = api.depositAccount(w.ctx, h.party);
      if (!deposit) return reject("no_account", `${labelOf(ctx, h.party)} has no account the money could go to`);
      const posted = api.pay(w.ctx, { from, to: h.party, cents, memo: `For a share of ${name}`, deposit, kind: "purchase", category: "investment" });
      const failed = isRejection(posted) ? posted : applied(w, posted);
      if (failed) return failed;
    }
  }

  // Each holder's basis carried to the units they get; cash realises the rest. The survivor's own stake goes with it.
  const basis: LedgerEvent[] = [];
  for (const h of holders) {
    const was = basisOf(api, ctx, business, h.party).basis;
    const got = units.get(h.party) ?? 0;
    const cents = paid.get(h.party) ?? 0;
    const stock = got * a.perUnit;
    const carried = Math.round(was * (stock + cents > 0 ? stock / (stock + cents) : got > 0 ? 1 : 0));
    basis.push(disposal(business, h.party, 100, cents + carried, `${name} merged into ${intoName}`));
    if (got > 0) basis.push(acquisition(into, h.party, carried));
  }
  if (!terms.keep && holdersOf(api, ctx, business).some((h) => h.party === into)) basis.push(disposal(business, into, 100, basisOf(api, ctx, business, into).basis, `${name} merged into ${intoName}`));
  const failedBasis = applied(w, basis);
  if (failedBasis) return failedBasis;

  // The survivor's owners: the merged company's stake in it cancelled, the new units added.
  const issued = [...units.values()].reduce((s, u) => s + u, 0);
  if (issued > 0 || a.owners.some((o) => o.party === business)) {
    let next = a.owners.filter((o) => o.party !== business);
    for (const [party, got] of units) {
      if (got <= 0) continue;
      const row = next.find((o) => o.party === party && ROLE_RIGHTS[o.role].worth);
      next = row ? next.map((o) => (o === row ? { ...o, units: (o.units ?? 0) + got } : o)) : [...next, { party, role: "owner" as const, units: got }];
    }
    // An S corporation surviving takes only holders who may hold its shares, no more than its limit (§26.3).
    const scorp = sCorpRefusal(api, ctx, into, next.filter((o) => (o.units ?? 0) > 0 || (o.share ?? 0) > 0).map((o) => o.party));
    if (scorp) return scorp;
    const failed = applied(w, [{ type: "set", entity: into, field: "owners", value: ownersJson(withUnitShares(next)) as unknown as JsonValue }]);
    if (failed) return failed;
  }
  const deal = [issued > 0 ? `${Math.round(ratio * 10000) / 10000} of its units for each of theirs (${issued} in all)` : null, cash > 0 ? money(cash) : null].filter((x): x is string => x !== null).join(" and ");

  if (terms.keep) {
    // Kept: the survivor holds all of it, its own stake and every holder's, at what it gave for them. A company can't hold an S corporation's shares.
    const scorp = sCorpRefusal(api, ctx, business, [into]);
    if (scorp) return scorp;
    let next = b.owners;
    for (const h of holders) next = moveUnits(next, h.party, into, unitsOf(next, h.party));
    const failed = applied(w, [{ type: "set", entity: business, field: "owners", value: ownersJson(withUnitShares(next)) as unknown as JsonValue }, acquisition(business, into, Math.round(issued * a.perUnit) + cash)]);
    if (failed) return failed;
    said.push({ text: `Took over ${name} as its subsidiary${deal !== "" ? `: its holders got ${deal}` : ""}`, names: holders.map((h) => h.party) });
    return { events: w.events, said };
  }

  // Folded in: what it owes its suppliers and in taxes it pays first, from its own money.
  for (const what of ["suppliers", "sales_tax"] as const) {
    const p = settlePosting(w.ctx, api, business, what);
    if (!p || p.cents <= 0 || !p.lines) continue;
    const posted = api.post(w.ctx, p.lines, { memo: p.memo ?? what, kind: "payment", category: p.category ?? what });
    if (isRejection(posted)) return reject("insolvent", `${name} can't pay what it owes ${what === "sales_tax" ? "in sales tax" : "its suppliers"} (${money(p.cents)})`);
    const failed = applied(w, [...posted, ...(p.extra ?? [])]);
    if (failed) return failed;
  }
  const due = optionalService(w.ctx, "economy.unemployment_due")?.(w.ctx, business) ?? null;
  if (due && due.cents > 0) {
    // Booked as payroll by the payment's own record, as the quarterly flow books it.
    const posted = api.post(w.ctx, due.lines, { memo: "Unemployment tax", kind: "payment", category: "payroll" });
    if (isRejection(posted)) return reject("insolvent", `${name} can't pay its unemployment tax (${money(due.cents)})`);
    const failed = applied(w, [...posted, ...due.events]);
    if (failed) return failed;
  }
  // Its income tax still owed this year: no return files it once it is gone.
  const tax = taxStillOwed(api, w.ctx, business);
  if (tax) {
    const from = gatheringAccount(api, w.ctx, business);
    const posted = from ? api.post(w.ctx, [{ account: from, amount: -tax.cents }, { account: api.outside("tax:federal"), amount: tax.cents }], { memo: "Corporate income tax", kind: "payment", category: "business_tax" }) : null;
    if (!posted || isRejection(posted)) return reject("insolvent", `${name} can't pay its income tax (${money(tax.cents)})`);
    const failed = applied(w, [...posted, ...tax.extra]);
    if (failed) return failed;
  }

  const events: LedgerEvent[] = [];
  const setOwners = (id: EntityId, owners: readonly Owner[]): void => {
    events.push({ type: "set", entity: id, field: "owners", value: ownersJson(owners) as unknown as JsonValue });
  };
  const carryBasis = (entity: EntityId): void => {
    const was = basisOf(api, w.ctx, entity, business).basis;
    events.push(disposal(entity, business, 100, was, `${name} merged into ${intoName}`), acquisition(entity, into, was));
  };
  // Its accounts and the holdings it holds directly.
  for (const acc of accountsNaming(api, w.ctx, business)) setOwners(acc, rowsTo(api.ownersOf(w.ctx.state, acc), business, into));
  for (const h of holdingIds(w.ctx.state)) if (accountOfHolding(w.ctx.state, h) === null && api.ownersOf(w.ctx.state, h).some((o) => o.party === business)) setOwners(h, rowsTo(api.ownersOf(w.ctx.state, h), business, into));
  // Its property, its leases following, and its basis in it.
  for (const p of propertyIds(w.ctx.state)) {
    const owners = api.ownersOf(w.ctx.state, p);
    if (!owners.some((o) => o.party === business)) continue;
    const next = rowsTo(owners, business, into);
    setOwners(p, next);
    events.push(...moveLeases(api, w.ctx, p, owners.map((o) => o.party), next));
    carryBasis(p);
  }
  // Its stakes in other companies.
  for (const c of companyIds(api, w.ctx)) {
    if (c === business || c === into) continue;
    const owners = api.ownersOf(w.ctx.state, c);
    if (!owners.some((o) => o.party === business)) continue;
    setOwners(c, countsUnits(owners) ? moveUnits(owners, business, into, unitsOf(owners, business)) : rowsTo(owners, business, into));
    carryBasis(c);
  }
  // Its things and vehicles: a sole owner's become the survivor's; on an `owners` list, the survivor takes its place.
  for (const t of ownedThings(w.ctx, business)) {
    const f = own(w.state.entities, t)?.fields ?? {};
    events.push(Array.isArray(f.owners) ? { type: "set", entity: t, field: "owners", value: ownersJson(ownersIn(f).map((o) => (o.party === business ? { ...o, party: into } : o))) } : { type: "set", entity: t, field: "owner", value: into });
  }
  // Its staff, in the survivor's positions; their jobs, ended ones too (a last paycheck still due), paid by the survivor from now.
  const staff: EntityId[] = [];
  for (const job of allJobs(w.ctx)) {
    if (job.party !== business) continue;
    events.push({ type: "set", entity: job.id, field: "employer", value: into });
    const position = strOf(own(w.ctx.state.entities, job.id)?.fields.position);
    const mapped = position === "" ? undefined : terms.positions[position];
    if (mapped !== undefined && mapped !== position) events.push({ type: "set", entity: job.id, field: "position", value: mapped });
    if (job.status !== "ended") staff.push(job.worker);
  }
  // Its invoices, either way.
  for (const id of invoiceIds(w.ctx)) {
    const inv = readInvoice(w.ctx, id);
    if (!inv || (inv.state !== "open" && inv.state !== "late")) continue;
    if (inv.business === business) events.push({ type: "set", entity: id, field: "business", value: into });
    if (inv.customer === business) events.push({ type: "set", entity: id, field: "customer", value: into });
  }
  // Payments it makes or takes in its own name (a lease it rents, a client's retainer), the survivor's now: its accounts are, so a payment to it would find none of its own.
  for (const id of Object.keys(w.ctx.state.entities).sort()) {
    const e = own(w.ctx.state.entities, id);
    if (e?.kind !== "flow" || isGone(w.ctx.state, id)) continue;
    for (const side of ["from", "to", "fallback"] as const) if (strOf(e.fields[side]) === business) events.push({ type: "set", entity: id, field: side, value: into });
    const splits = Array.isArray(e.fields.splits) ? e.fields.splits : [];
    if (splits.some((s) => isRecord(s) && s.to === business)) events.push({ type: "set", entity: id, field: "splits", value: splits.map((s) => (isRecord(s) && s.to === business ? { ...s, to: into } : s)) });
    const shares = Array.isArray(e.fields.shares) ? e.fields.shares : [];
    if (shares.some((s) => isRecord(s) && s.party === business)) events.push({ type: "set", entity: id, field: "shares", value: shares.map((s) => (isRecord(s) && s.party === business ? { ...s, party: into } : s)) });
  }
  const places = placesOf(w.ctx, business);
  if (places.length > 0) events.push({ type: "set", entity: into, field: "places", value: [...new Set([...placesOf(w.ctx, into), ...places])] });
  events.push(
    { type: "set", entity: business, field: "owners", value: [] },
    { type: "set", entity: business, field: DISSOLVED_FIELD, value: today(ctx) },
    { type: "set", entity: business, field: MERGED_INTO_FIELD, value: into },
  );
  const failed = applied(w, events);
  if (failed) return failed;
  said.push({ text: `Took in ${name}${deal !== "" ? `: its holders got ${deal}` : ""}`, names: holders.map((h) => h.party) });
  if (staff.length > 0) said.push({ text: `${staff.length === 1 ? labelOf(ctx, staff[0] ?? "") : `${staff.length} staff`} came over from ${name}`, names: staff.length === 1 ? staff : [] });
  return { events: w.events, said };
}

/** The companies `viewer` may merge `business` with (§3.13): every other company standing, unlisted and not winding up that they can see and decide for (the GM: all), with this one's units and value a unit; null once it is dissolved, winding up or listed. Short only of the votes on this one (`vote`), the merger may be put to its vote. */
export function mergeView(api: FinanceApi, ctx: ReadContext, business: EntityId, viewer: EntityId | null, why: string | null, vote = false): MergeView | null {
  if (dissolvedOn(ctx.state, business) !== null || windingUpSince(ctx.state, business) !== null || listed(ctx, business)) return null;
  const self = unitValue(api, ctx, business);
  if (why !== null && !vote) return { why, units: self.units, perUnit: self.perUnit, with: [] };
  const options: MergeOption[] = companyIds(api, ctx).flatMap((id) => {
    if (id === business || isGone(ctx.state, id) || dissolvedOn(ctx.state, id) !== null || windingUpSince(ctx.state, id) !== null || listed(ctx, id)) return [];
    if (viewer !== null && (hiddenFrom(ctx, viewer, id) || isRejection(deciderFor(ctx, viewer, id, "org.govern", "Merging")))) return [];
    const v = unitValue(api, ctx, id);
    return [{ id, name: labelOf(ctx, id), units: v.units, perUnit: v.perUnit }];
  });
  return { why, units: self.units, perUnit: self.perUnit, with: options, ...(vote ? { vote: true } : {}) };
}

/**
 * `step` on the companies' money as it stands once open: an authored account nothing has shown yet
 * opens first (as a GM correction opens one), so the reckoning sees the money the author gave it, and
 * its opening leads the events.
 */
function opened(ctx: ReadContext, parties: readonly EntityId[], step: (ctx: ReadContext) => WindResult | Rejection): WindResult | Rejection {
  const claimed = new Set<EntityId>();
  const opening = parties.flatMap((p) => openingEvent(ctx, p, claimed) ?? []);
  if (opening.length === 0) return step(ctx);
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const failed = applied(w, opening);
  if (failed) return failed;
  const result = step(w.ctx);
  return isRejection(result) ? result : { events: [...opening, ...result.events], said: result.said };
}

// ---------------------------------------------------------------- registration

/** Winding up and merging (§3.13): the business fields they write, their money as services the orgs pack's effects call, and who decides. */
export function registerWinding(r: FinanceRegistry): void {
  const { api, core } = r;
  r.fields("business", WIND_FIELDS);
  core.query("economy.decider", (ctx, by, business, power, doing) => deciderFor(ctx, by, business, power, doing));
  core.service("economy.wind_up", (ctx, business, plan) => opened(ctx, [business], (c) => windUp(api, c, business, plan)));
  core.service("economy.merge", (ctx, business, into, terms) => opened(ctx, [business, into], (c) => merge(api, c, business, into, terms)));
}
