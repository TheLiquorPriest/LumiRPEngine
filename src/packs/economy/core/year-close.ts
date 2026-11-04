// The year close, penalty taxes and a private foundation's money (DESIGN §26.3).
//
// On 1 January each corporation and each private foundation closes the year just ended
// (`economy.year_close`), from its books while they still hold the whole of it:
// - a C corporation paying business taxes: its taxable income, the net operating loss, capital loss
//   and gifts over the 10% cap it carries forward, the dividends it paid, its earnings and profits
//   (E&P, from its `opening_ep` at the story's start), and what the penalty taxes read: its passive
//   income against its gross income, and what its five largest individual holders hold. It is
//   recorded while penalty taxes are on, or when the year leaves something to carry;
// - a private foundation (an exempt status whose row has a `payout_pct`): the average of its assets,
//   marked on each month's first (`economy.foundation_mark`); its payout, that share of them less its
//   excise; its grants, which cover last year's shortfall first; the shortfall it carries into the
//   next year; last year's still ungranted, taxed 30%; and its excise on its net investment income.
//
// Penalty taxes (the economy config's `taxes.penaltyTaxes`, off by default) are booked on 15 April
// for the year before: a personal holding company pays on its undistributed income, any other C
// corporation the accumulated earnings tax above its credit. A consent dividend
// (`economy.consent_dividend`) moves no money: the corporation counts it as paid for its year, and
// each holder takes their part as that year's dividend and adds it to their basis. A foundation's
// excise and its 30% tax are paid with its return on 15 May, with an alert before.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { AlertLine, Flow, FlowSchedule } from "../../../shared/finance";
import { calendarOf, clockAt, dateAt, dayIndexOf } from "../../../engine/calendar";
import { dissolvedOn, mayAct } from "../../../engine/org";
import { labelOf, numOf, objOf, optionalService, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { COMPANY_KIND } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { instantIn } from "./assets";
import { addToBooks, monthOf, monthsBetween, operatingAccount, totalsOf } from "./books";
import { donationsGiven, foundationTerms } from "./exempt";
import { moneyLevel } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { basisRecord, gainsIn, recordIncome, setBasisRecord } from "./records";

export const YEAR_CLOSE = "economy.year_close";
export const FOUNDATION_MARK = "economy.foundation_mark";
export const CONSENT_DIVIDEND = "economy.consent_dividend";
export const PENALTY_TAX = "economy.penalty_tax";
export const FOUNDATION_TAX = "economy.foundation_tax";
export const DIVIDEND_RECEIVED = "economy.dividend_received";

/** Years of closes kept per party: the five a gift's carryforward lasts, and the one before them. */
const YEARS_KEPT = 6;
/** Monthly marks kept per foundation: a year's, and the month before it. */
const MARKS_KEPT = 13;
/** Journal categories of a foundation's net investment income: interest (a bank's among it), dividends and royalties. */
const NII_CATEGORIES = ["interest", "dividends", "royalties"] as const;
/** Months of dividends received kept per corporation: two years and the month under way, as its books are. */
const RECEIVED_KEPT = 25;

/** The figures a C corporation's year close records (`CorporateYear`, worked out by the taxes module). */
export interface CorporateYear {
  /** Taxable income, after the dividends-received deduction, the gifts it may deduct and the NOL it used. */
  taxable: number;
  /** Federal income tax on it, as its estimated payments worked it out. */
  tax: number;
  /** The net operating loss the year made, and what it carries into the next. */
  loss: number;
  nol: number;
  /** A net capital loss carried into the next year. */
  capLoss: number;
  /** Gifts over the 10% cap carried forward, by the year they were given, oldest first. */
  gifts: { year: number; cents: number }[];
  /** Dividends it paid in the year (its distributions). */
  dividends: number;
  /** Personal holding company income (dividends, interest, royalties) and adjusted ordinary gross income. */
  passive: number;
  gross: number;
  /** The share of it, in percent, its five largest individual holders hold, directly or through others. */
  top5: number;
  /** Accumulated earnings and profits at the year's start and at its end, before its consent dividends. */
  epStart: number;
  ep: number;
}

/** What the taxes module lends the year close: a corporation's year, whether a company is taxed as a C corporation at a moment, and the share of a dividend a corporation deducts from a payer now. */
export interface YearCloseDeps {
  corporateYear(ctx: ReadContext, business: EntityId, year: number): CorporateYear | null;
  corporation(ctx: ReadContext, business: EntityId, clock: number): boolean;
  deductionPct(ctx: ReadContext, receiver: EntityId, payer: EntityId): number;
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

function economy(state: Readonly<WorldState>, key: string): JsonObject {
  return objOf(sliceOf(state, "economy")[key]);
}

/** Keeps a record's newest `kept` keys (in their sort order). */
function trimmed(record: JsonObject, kept: number): JsonObject {
  const out = { ...record };
  for (const old of Object.keys(out).sort().slice(0, Math.max(0, Object.keys(out).length - kept))) delete out[old];
  return out;
}

const monthKey = (year: number, month: number): string => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

// ---------------------------------------------------------------- records

/** A party's close of a year, as recorded; null when none was. */
export function closedYear(state: Readonly<WorldState>, party: EntityId, year: number): JsonObject | null {
  const rec = own(objOf(own(economy(state, "year_close"), party)), String(year));
  return rec === undefined ? null : objOf(rec);
}

/** A party's newest close of a year before `year`. */
export function lastClosed(state: Readonly<WorldState>, party: EntityId, year: number): { year: number; rec: JsonObject } | null {
  const years = Object.keys(objOf(own(economy(state, "year_close"), party)))
    .map(Number)
    .filter((y) => Number.isFinite(y) && y < year)
    .sort((a, b) => a - b);
  const last = years[years.length - 1];
  return last === undefined ? null : { year: last, rec: closedYear(state, party, last) ?? {} };
}

/** What a corporation carries into `year` from its last close: its net operating loss, its capital loss and its gifts over the cap still within their five years. */
export function carriedInto(state: Readonly<WorldState>, business: EntityId, year: number, giftYears: number): { nol: number; capLoss: number; gifts: { year: number; cents: number }[] } {
  const last = lastClosed(state, business, year);
  if (!last) return { nol: 0, capLoss: 0, gifts: [] };
  const gifts = (Array.isArray(last.rec.gifts) ? last.rec.gifts : []).map((g) => ({ year: numOf(objOf(g).year), cents: numOf(objOf(g).cents) })).filter((g) => g.cents > 0 && year - g.year <= giftYears);
  return { nol: Math.max(0, numOf(last.rec.nol)), capLoss: Math.max(0, numOf(last.rec.capLoss)), gifts };
}

/** The dividends a corporation received from the companies it holds a stake in over some months, and the part of them it deducts (each judged by its stake when paid). */
export function dividendsReceived(state: Readonly<WorldState>, party: EntityId, months: readonly string[]): { cents: number; deducted: number } {
  const mine = objOf(own(economy(state, "dividends_received"), party));
  let cents = 0;
  let deducted = 0;
  for (const m of months) {
    const month = objOf(own(mine, m));
    cents += numOf(month.cents);
    deducted += numOf(month.deducted);
  }
  return { cents, deducted };
}

/** The consent dividends a corporation declared for a year. */
export function consentDividends(state: Readonly<WorldState>, org: EntityId, year: number): number {
  return numOf(own(objOf(own(economy(state, "consent_dividends"), org)), String(year)));
}

/** A foundation's monthly marks, by month (`YYYY-MM`, the month that ended). */
export function foundationMarks(state: Readonly<WorldState>, org: EntityId): Record<string, number> {
  return Object.fromEntries(Object.entries(objOf(own(economy(state, "foundation_marks"), org))).map(([m, c]) => [m, numOf(c)]));
}

/** What a party's penalty tax or foundation tax for a year paid, when it has been paid. */
export function taxPaidFor(state: Readonly<WorldState>, key: "penalty_taxes" | "foundation_taxes", party: EntityId, year: number): JsonObject | null {
  const v = own(objOf(own(economy(state, key), party)), String(year));
  return v === undefined ? null : objOf(v);
}

/** Whether the world taxes corporations that keep their earnings (the economy config's `taxes.penaltyTaxes`, off by default). */
export function penaltyTaxesOn(ctx: Pick<ReadContext, "world">): boolean {
  return objOf(objOf(ctx.world.packs.economy?.config).taxes).penaltyTaxes === true;
}

// ---------------------------------------------------------------- the tables

export interface PenaltyTables {
  phc: { taxPct: number; passivePct: number; holders: number; heldPct: number };
  aet: { taxPct: number; credit: number };
}

/** The personal holding company and accumulated earnings parameters in the finance table's federal section. */
export function penaltyTables(ctx: Pick<ReadContext, "tables">): PenaltyTables {
  const fed = objOf(ctx.tables.get("economy.finance")?.rows.taxes_federal?.values);
  const phc = objOf(fed.personal_holding_company);
  const aet = objOf(fed.accumulated_earnings);
  return {
    phc: { taxPct: numOf(phc.tax_pct, 20), passivePct: numOf(phc.passive_income_pct, 60), holders: numOf(phc.holders, 5), heldPct: numOf(phc.held_pct, 50) },
    aet: { taxPct: numOf(aet.tax_pct, 20), credit: numOf(aet.credit_cents, 25_000_000) },
  };
}

// ---------------------------------------------------------------- penalty taxes

/** A corporation's penalty tax for a year, as its record and its consent dividends read: personal holding company tax where it is one, else the accumulated earnings tax above its credit. */
export interface PenaltyTax {
  kind: "phc" | "aet";
  year: number;
  /** What it kept: its taxable income less its federal tax and the dividends it paid (consent dividends among them). */
  kept: number;
  /** The accumulated earnings credit (none for a personal holding company). */
  credit: number;
  /** What the tax is on, and the tax. */
  base: number;
  cents: number;
  consent: number;
  /** Why it is a personal holding company, or isn't. */
  passivePct: number;
  top5: number;
}

export function penaltyTaxFor(ctx: Pick<ReadContext, "state" | "tables">, business: EntityId, year: number): PenaltyTax | null {
  const rec = closedYear(ctx.state, business, year);
  if (!rec) return null;
  const t = penaltyTables(ctx);
  const consent = consentDividends(ctx.state, business, year);
  const kept = numOf(rec.taxable) - numOf(rec.tax) - numOf(rec.dividends) - consent;
  const gross = numOf(rec.gross);
  const passivePct = gross > 0 ? Math.round((numOf(rec.passive) * 10000) / gross) / 100 : 0;
  const top5 = numOf(rec.top5);
  const phc = gross > 0 && passivePct + 1e-9 >= t.phc.passivePct && top5 > t.phc.heldPct;
  const credit = phc ? 0 : Math.max(0, t.aet.credit - Math.max(0, numOf(rec.epStart)));
  const base = Math.max(0, kept - credit);
  const cents = Math.round((base * (phc ? t.phc.taxPct : t.aet.taxPct)) / 100);
  return { kind: phc ? "phc" : "aet", year, kept, credit, base, cents, consent, passivePct, top5 };
}

/** A corporation's E&P at the start of a year: its last close's, less the consent dividends it declared for that year after; else its `opening_ep`. */
export function earningsAndProfits(state: Readonly<WorldState>, business: EntityId, year: number): number {
  const last = lastClosed(state, business, year);
  if (!last) return Math.round(numOf(own(state.entities, business)?.fields.opening_ep));
  return numOf(last.rec.ep) - consentDividends(state, business, last.year);
}

const PENALTY_WORDS = { phc: "Personal holding company tax", aet: "Accumulated earnings tax" } as const;

// ---------------------------------------------------------------- foundations

/** The organizations a private foundation's status covers, by id: not gone, at Money 3 or more. */
export function foundationIds(ctx: ReadContext): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => foundationTerms(ctx, id) !== null && !isGone(ctx.state, id) && moneyLevel(ctx, id) >= 3);
}

/**
 * A foundation's close of a year: the average of its monthly marks (`december`, the one taken as the
 * year ends, among them), its payout (its `payout_pct` of them, less its excise), its grants (what it
 * gave), the part of them that covered last year's shortfall, the shortfall it carries on, last year's
 * still ungranted and the tax on it, and its excise on its net investment income (interest, dividends,
 * royalties and net gains).
 */
export function foundationYear(api: FinanceApi, ctx: ReadContext, org: EntityId, year: number, december?: number): JsonObject | null {
  const terms = foundationTerms(ctx, org);
  if (!terms) return null;
  const marks = foundationMarks(ctx.state, org);
  const values: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = monthKey(year, m);
    const v = m === 12 && december !== undefined ? december : marks[key];
    if (v !== undefined) values.push(v);
  }
  if (values.length === 0) values.push(Math.max(0, api.netWorth(ctx, org)));
  const assets = Math.round(values.reduce((a, v) => a + v, 0) / values.length);
  // What its accounts took in as interest, dividends and royalties (a bank's interest among them), and its net gains.
  const span = { from: clockAt(calendarOf(ctx.world), dayIndexOf(calendarOf(ctx.world), year, 1, 1), 0), to: clockAt(calendarOf(ctx.world), dayIndexOf(calendarOf(ctx.world), year + 1, 1, 1), 0) };
  const months = monthsBetween(ctx.world, span.from, span.to);
  let income = 0;
  for (const account of api.accountsOf(ctx, org, "worth")) for (const m of months) for (const c of NII_CATEGORIES) income += totalsOf(ctx.state, account, m)[c]?.in ?? 0;
  const g = gainsIn(ctx.state, org, year);
  const nii = income + Math.max(0, g.short + g.long);
  const excise = Math.round((nii * terms.excisePct) / 100);
  const payout = Math.max(0, Math.round((assets * terms.payoutPct) / 100) - excise);
  const given = donationsGiven(ctx.state, org, year);
  const grants = given.deductible + given.other;
  const priorShortfall = Math.max(0, numOf(closedYear(ctx.state, org, year - 1)?.shortfall));
  const toPrior = Math.min(grants, priorShortfall);
  const undistributed = priorShortfall - toPrior;
  return { foundation: true, assets, payout, grants, toPrior, shortfall: Math.max(0, payout - (grants - toPrior)), undistributed, tax: Math.round((undistributed * terms.undistributedPct) / 100), nii, excise };
}

/** What a foundation's year is up to so far: last year's shortfall its grants this year still have to cover, and this year's own payout so far, at its marks to date. */
export function foundationProgress(api: FinanceApi, ctx: ReadContext, org: EntityId): { year: number; granted: number; lastShortfall: number; leftOfLast: number; payoutSoFar: number; assets: number } | null {
  const year = dateAt(calendarOf(ctx.world), ctx.state.clock).year;
  const now = foundationYear(api, ctx, org, year);
  if (!now) return null;
  const lastShortfall = Math.max(0, numOf(closedYear(ctx.state, org, year - 1)?.shortfall));
  return { year, granted: numOf(now.grants), lastShortfall, leftOfLast: Math.max(0, lastShortfall - numOf(now.grants)), payoutSoFar: numOf(now.payout), assets: numOf(now.assets) };
}

/** What a foundation owes with its return for `year` on 15 May: its excise and its tax on last year's payout still ungranted; null where it closed no such year or has paid. */
export function foundationTaxFor(ctx: Pick<ReadContext, "state">, org: EntityId, year: number): { excise: number; undistributed: number; tax: number; cents: number } | null {
  const rec = closedYear(ctx.state, org, year);
  if (!rec || rec.foundation !== true || taxPaidFor(ctx.state, "foundation_taxes", org, year)) return null;
  const excise = numOf(rec.excise);
  const tax = numOf(rec.tax);
  return { excise, undistributed: numOf(rec.undistributed), tax, cents: excise + tax };
}

// ---------------------------------------------------------------- events

/** `economy.year_close`: a party's close of a year, an assignment of the whole record, so a timelapse keeps only the last. */
export const YEAR_CLOSE_EVENT: EventTypeDef<PackEvent> = {
  type: YEAR_CLOSE,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "party")) && typeof e.data.year === "number" && typeof e.data.record === "object" && e.data.record !== null && !Array.isArray(e.data.record) ? null : ({ code: "bad_event", reason: "a year close names its party, its year and its record" } satisfies Rejection)),
  apply: (e, state) => {
    const all = sliceRecord(state, "economy", "year_close");
    const party = str(e, "party");
    all[party] = trimmed({ ...objOf(own(all, party)), [String(numOf(e.data.year))]: objOf(e.data.record) }, YEARS_KEPT);
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "party"))} closed ${numOf(e.data.year)}`),
};

/** `economy.foundation_mark`: a foundation's assets as a month ends. */
export const FOUNDATION_MARK_EVENT: EventTypeDef<PackEvent> = {
  type: FOUNDATION_MARK,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "org")) && /^\d{4}-\d{2}$/.test(str(e, "month")) && typeof e.data.cents === "number" ? null : ({ code: "bad_event", reason: "a foundation's mark names it, the month and its assets" } satisfies Rejection)),
  apply: (e, state) => {
    const all = sliceRecord(state, "economy", "foundation_marks");
    const org = str(e, "org");
    all[org] = trimmed({ ...objOf(own(all, org)), [str(e, "month")]: numOf(e.data.cents) }, MARKS_KEPT);
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "org"))}'s assets marked for ${str(e, "month")}`),
};

/** Adds to a corporation's dividends received in a month, and the part it deducts (inside an event's apply). */
function addReceived(state: WorldState, party: EntityId, month: string, cents: number, deducted: number): void {
  const all = sliceRecord(state, "economy", "dividends_received");
  const mine = { ...objOf(own(all, party)) };
  const m = objOf(own(mine, month));
  mine[month] = { cents: numOf(m.cents) + cents, deducted: numOf(m.deducted) + deducted };
  all[party] = trimmed(mine, RECEIVED_KEPT);
}

/** `economy.dividend_received`: a corporation's dividend from a company it holds a stake in, with the part of it the dividends-received deduction takes off, by its stake then. Rides with the payout. */
export const DIVIDEND_RECEIVED_EVENT: EventTypeDef<PackEvent> = {
  type: DIVIDEND_RECEIVED,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "party")) && own(ctx.state.entities, str(e, "source")) && typeof e.data.cents === "number" && e.data.cents > 0 && typeof e.data.deducted === "number" ? null : ({ code: "bad_event", reason: "a dividend received names its receiver, its payer, its amount and what is deducted of it" } satisfies Rejection)),
  apply: (e, state, ctx) => addReceived(state, str(e, "party"), monthOf(ctx.world, state.clock), numOf(e.data.cents), numOf(e.data.deducted)),
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "party"))} received a dividend from ${labelOf(ctx, str(e, "source"))}`),
};

/** A dividend a corporation receives from a company it holds a stake in, with the share of it it deducts (`pct`), as bookkeeping riding with the payout; nothing for any other receiver. */
export function dividendReceived(ctx: Pick<ReadContext, "registry" | "world" | "state">, party: EntityId, source: EntityId, cents: number, pct: number): LedgerEvent[] {
  const whole = Math.round(cents);
  return whole > 0 && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, party)?.kind ?? "", "business") ? [{ type: DIVIDEND_RECEIVED, data: { party, source, cents: whole, deducted: Math.round((whole * pct) / 100) } }] : [];
}

/** `economy.consent_dividend`: a corporation's consent dividend for a year: counted as paid, and each holder's part their dividend for that year and more basis in their stake. No money moves. */
export const CONSENT_DIVIDEND_EVENT: EventTypeDef<PackEvent> = {
  type: CONSENT_DIVIDEND,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "org")) && typeof e.data.year === "number" && typeof e.data.cents === "number" && e.data.cents > 0 && Array.isArray(e.data.parts) ? null : ({ code: "bad_event", reason: "a consent dividend names its corporation, its year, its amount and each holder's part" } satisfies Rejection)),
  apply: (e, state, ctx) => {
    const org = str(e, "org");
    const year = numOf(e.data.year);
    const all = sliceRecord(state, "economy", "consent_dividends");
    const mine = { ...objOf(own(all, org)) };
    mine[String(year)] = numOf(own(mine, String(year))) + numOf(e.data.cents);
    all[org] = trimmed(mine, YEARS_KEPT);
    for (const raw of Array.isArray(e.data.parts) ? e.data.parts : []) {
      const p = objOf(raw);
      const party = strOf(p.party);
      const cents = Math.round(numOf(p.cents));
      if (!own(state.entities, party) || cents <= 0) continue;
      recordIncome(state, ctx.world, party, "dividend", cents, year);
      const r = basisRecord(state, org, party);
      setBasisRecord(state, org, party, { basis: (r?.basis ?? 0) + cents, since: r?.since ?? null });
      if (kindIs(ctx.registry, ctx.world, own(state.entities, party)?.kind ?? "", "business")) addReceived(state, party, monthKey(year, 12), cents, Math.round((cents * numOf(p.deductPct)) / 100));
    }
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "org"))}: consent dividend for ${numOf(e.data.year)}`),
};

/** `economy.penalty_tax`: a corporation's PHC tax or AET for a year, paid: booked as its income tax. Rides with the payment. */
export const PENALTY_TAX_EVENT: EventTypeDef<PackEvent> = {
  type: PENALTY_TAX,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "party")) && typeof e.data.year === "number" && typeof e.data.cents === "number" ? null : ({ code: "bad_event", reason: "a penalty tax names its payer, its year and its amount" } satisfies Rejection)),
  apply: (e, state, ctx) => {
    const party = str(e, "party");
    const all = sliceRecord(state, "economy", "penalty_taxes");
    all[party] = trimmed({ ...objOf(own(all, party)), [String(numOf(e.data.year))]: { kind: str(e, "kind"), cents: numOf(e.data.cents) } }, YEARS_KEPT);
    addToBooks(state, party, monthOf(ctx.world, state.clock), { business_tax: numOf(e.data.cents) });
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "party"))}: ${str(e, "kind") === "phc" ? "personal holding company tax" : "accumulated earnings tax"} for ${numOf(e.data.year)}`),
};

/** `economy.foundation_tax`: a foundation's excise and 30% tax for a year, paid. Rides with the payment. */
export const FOUNDATION_TAX_EVENT: EventTypeDef<PackEvent> = {
  type: FOUNDATION_TAX,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "org")) && typeof e.data.year === "number" && typeof e.data.cents === "number" ? null : ({ code: "bad_event", reason: "a foundation's tax names it, its year and its amount" } satisfies Rejection)),
  apply: (e, state) => {
    const org = str(e, "org");
    const all = sliceRecord(state, "economy", "foundation_taxes");
    all[org] = trimmed({ ...objOf(own(all, org)), [String(numOf(e.data.year))]: { excise: numOf(e.data.excise), tax: numOf(e.data.tax), cents: numOf(e.data.cents) } }, YEARS_KEPT);
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "org"))}: foundation taxes for ${numOf(e.data.year)}`),
};

// ---------------------------------------------------------------- the close itself

/** Whether a corporation's close records anything worth keeping: penalty taxes on, something carried, or a close before it. */
function worthKeeping(ctx: ReadContext, business: EntityId, rec: CorporateYear): boolean {
  return penaltyTaxesOn(ctx) || rec.nol > 0 || rec.capLoss > 0 || rec.gifts.length > 0 || lastClosed(ctx.state, business, Number.POSITIVE_INFINITY) !== null;
}

/** On each month's first at midnight, every foundation's mark for the month just ended; on 1 January, the year's closes. */
function closeStep(api: FinanceApi, deps: YearCloseDeps, ctx: ReadContext, slot: SlotInfo): LedgerEvent[] {
  const at = instantIn(ctx, slot, 0);
  if (!at || at.date.day !== 1) return [];
  const { year: y, month: m } = at.date;
  const ended = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const out: LedgerEvent[] = [];
  const foundations = foundationIds(ctx);
  const marks = new Map<EntityId, number>();
  for (const id of foundations) {
    const cents = Math.max(0, Math.round(api.netWorth(ctx, id)));
    marks.set(id, cents);
    out.push({ type: FOUNDATION_MARK, data: { org: id, month: monthKey(ended.year, ended.month), cents } });
  }
  if (m !== 1) return out;
  const year = y - 1;
  for (const id of foundations) {
    const rec = foundationYear(api, ctx, id, year, marks.get(id));
    if (rec) out.push({ type: YEAR_CLOSE, data: { party: id, year, record: rec } });
  }
  const cal = calendarOf(ctx.world);
  const yearStart = clockAt(cal, dayIndexOf(cal, year, 1, 1), 0);
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || !kindIs(ctx.registry, ctx.world, e.kind, COMPANY_KIND) || foundationTerms(ctx, id) !== null || !api.feature(ctx, id, "business_tax")) continue;
    // A company wound up before the year began closes none; one wound up during it closes the months it traded.
    const gone = dissolvedOn(ctx.state, id);
    if (gone !== null && gone < monthKey(year, 1)) continue;
    if (!deps.corporation(ctx, id, at.at - 1) && !deps.corporation(ctx, id, yearStart)) continue;
    const rec = deps.corporateYear(ctx, id, year);
    if (rec && worthKeeping(ctx, id, rec)) out.push({ type: YEAR_CLOSE, data: { party: id, year, record: rec as unknown as JsonObject } });
  }
  return out;
}

/** The yearly schedule of a return paid in `month` on the 15th, rolled to the next business day. */
const returnSchedule = (month: number): FlowSchedule => ({ every: "year", months: [month], days: [15], roll: "after" });

/** The account an organization pays its taxes from: its operating account, else its deposit account. */
function payerOf(api: FinanceApi, ctx: ReadContext, org: EntityId): EntityId | null {
  return operatingAccount(api, ctx, org) ?? api.depositAccount(ctx, org);
}

/** `economy.consent_dividend` as the effect resolves it: a C corporation, by whoever governs it (none asked of the GM), for this year or, until its return is filed on 15 April, the last. */
function consentEvents(api: FinanceApi, deps: YearCloseDeps, ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const by = strOf(a.by);
  const cents = Math.round(numOf(a.cents));
  const e = own(ctx.state.entities, org);
  if (!e || isGone(ctx.state, org) || !kindIs(ctx.registry, ctx.world, e.kind, COMPANY_KIND)) return { code: "not_company", reason: `${labelOf(ctx, org)} isn't a company` };
  if (!deps.corporation(ctx, org, ctx.state.clock)) return { code: "not_corporation", reason: `Only a C corporation that pays income tax declares a consent dividend; ${labelOf(ctx, org)} isn't one` };
  if (!(cents > 0)) return { code: "bad_amount", reason: "a consent dividend is more than nothing" };
  if (by !== "" && by !== org) {
    const may = mayAct(ctx, by, org, "org.govern");
    if (!may.ok) return { code: "not_allowed", reason: may.reason };
  }
  const now = dateAt(calendarOf(ctx.world), ctx.state.clock);
  const filing = now.month < 4 || (now.month === 4 && now.day <= 15);
  const year = typeof a.year === "number" && Number.isFinite(a.year) && a.year > 0 ? Math.round(a.year) : filing ? now.year - 1 : now.year;
  if (year !== now.year && !(year === now.year - 1 && filing)) return { code: "bad_year", reason: `A consent dividend counts for this year (${now.year}) or, until its return is filed on 15 April, the last` };
  if (taxPaidFor(ctx.state, "penalty_taxes", org, year)) return { code: "filed", reason: `${labelOf(ctx, org)}'s return for ${year} is filed already` };
  const holders = api
    .ownersOf(ctx.state, org)
    .map((o) => ({ party: o.party, share: api.shareOf(ctx.state, org, o.party) }))
    .filter((o, i, all) => o.share > 0 && all.findIndex((x) => x.party === o.party) === i);
  const total = holders.reduce((s, h) => s + h.share, 0);
  if (holders.length === 0 || total <= 0) return { code: "no_owners", reason: `${labelOf(ctx, org)} has no holders to consent` };
  let given = 0;
  const parts = holders.map((h, i) => {
    const part = i === holders.length - 1 ? cents - given : Math.round((cents * h.share) / total);
    given += part;
    // A corporate holder deducts its part as any dividend from a company it holds a stake in.
    return { party: h.party, cents: part, ...(api.partyKind(ctx, h.party) === "business" ? { deductPct: deps.deductionPct(ctx, h.party, org) } : {}) };
  });
  const text = `Declared a consent dividend of ${api.money(ctx, cents)} for ${year}: no money moves, and each holder takes their part as income`;
  const line = by !== "" && by !== org ? (optionalService(ctx, "orgs.acted")?.(ctx, { org, by, power: "org.govern", text }) ?? []) : [];
  return [{ type: CONSENT_DIVIDEND, data: { org, year, cents, parts } }, ...line];
}

/** The year close, penalty taxes, consent dividends and a private foundation's payout and taxes. */
export function registerYearClose(r: FinanceRegistry, deps: YearCloseDeps): void {
  const { api, core } = r;
  for (const ev of [YEAR_CLOSE_EVENT, FOUNDATION_MARK_EVENT, DIVIDEND_RECEIVED_EVENT, CONSENT_DIVIDEND_EVENT, PENALTY_TAX_EVENT, FOUNDATION_TAX_EVENT]) core.event(ev);
  core.process({ id: "economy.year_close", domain: "money", minLevel: 3, step: (slot, ctx) => closeStep(api, deps, ctx, slot) });
  r.flows({
    id: "year_close",
    flows: (ctx) => {
      const out: Flow[] = [];
      const penalties = penaltyTaxesOn(ctx);
      for (const id of Object.keys(objOf(sliceOf(ctx.state, "economy").year_close)).sort()) {
        if (!own(ctx.state.entities, id) || isGone(ctx.state, id)) continue;
        const payer = payerOf(api, ctx, id);
        if (foundationTerms(ctx, id) !== null) out.push({ id: `foundation_tax:${id}`, label: "Foundation excise tax", kind: "tax", from: payer ?? id, to: "tax:federal", amount: { provider: "foundation_tax", args: { org: id } }, schedule: returnSchedule(5), shortfall: "defer", category: "excise_tax", link: id, status: "active", source: "year_close" });
        else if (penalties && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", COMPANY_KIND)) out.push({ id: `penalty_tax:${id}`, label: "Tax on kept earnings", kind: "tax", from: payer ?? id, to: "tax:federal", amount: { provider: "penalty_tax", args: { party: id } }, schedule: returnSchedule(4), shortfall: "defer", category: "business_tax", link: id, status: "active", source: "year_close" });
      }
      return out;
    },
  });
  r.amount("penalty_tax", (ctx, flow, at): FlowPosting | null => {
    const party = strOf(("provider" in flow.amount ? objOf(flow.amount.args) : {}).party);
    const year = dateAt(calendarOf(ctx.world), at).year - 1;
    if (!penaltyTaxesOn(ctx) || !own(ctx.state.entities, party) || taxPaidFor(ctx.state, "penalty_taxes", party, year)) return null;
    const tax = penaltyTaxFor(ctx, party, year);
    const payer = payerOf(api, ctx, party);
    if (!tax || tax.cents <= 0 || !payer) return null;
    const memo = `${PENALTY_WORDS[tax.kind]}, ${year}`;
    return { cents: tax.cents, lines: [{ account: payer, amount: -tax.cents }, { account: api.outside("tax:federal"), amount: tax.cents }], memo, kind: "payment", category: "business_tax", extra: [{ type: PENALTY_TAX, data: { party, year, kind: tax.kind, cents: tax.cents } }] };
  });
  r.amount("foundation_tax", (ctx, flow, at): FlowPosting | null => {
    const org = strOf(("provider" in flow.amount ? objOf(flow.amount.args) : {}).org);
    const year = dateAt(calendarOf(ctx.world), at).year - 1;
    const due = foundationTaxFor(ctx, org, year);
    const payer = payerOf(api, ctx, org);
    if (!due || due.cents <= 0 || !payer) return null;
    return { cents: due.cents, lines: [{ account: payer, amount: -due.cents }, { account: api.outside("tax:federal"), amount: due.cents }], memo: `Foundation excise tax, ${year}`, kind: "payment", category: "excise_tax", extra: [{ type: FOUNDATION_TAX, data: { org, year, excise: due.excise, tax: due.tax, cents: due.cents } }] };
  });
  // A foundation's page warns of its taxes falling due and of a payout still to grant.
  r.view((ctx, party) => {
    if (foundationTerms(ctx, party) === null) return {};
    const alerts: AlertLine[] = [];
    const year = dateAt(calendarOf(ctx.world), ctx.state.clock).year;
    const due = foundationTaxFor(ctx, party, year - 1);
    if (due && due.cents > 0) alerts.push({ tone: "warn", text: `Foundation taxes for ${year - 1}, ${api.money(ctx, due.cents)}, fall due on 15 May: ${api.money(ctx, due.excise)} on its investment income${due.tax > 0 ? ` and ${api.money(ctx, due.tax)} on ${api.money(ctx, due.undistributed)} of ${year - 2}'s payout it never granted` : ""}.`, flow: `foundation_tax:${party}` });
    const progress = foundationProgress(api, ctx, party);
    if (progress && progress.leftOfLast > 0) alerts.push({ tone: "warn", text: `Grant ${api.money(ctx, progress.leftOfLast)} more by 31 Dec ${year} to meet ${year - 1}'s payout, or 30% of what's left is due with the next return.` });
    return alerts.length > 0 ? { alerts } : {};
  });
  core.effect({ type: "economy.consent_dividend", args: ["org", "cents", "year?", "by?"], gm: true, resolve: (a, ctx) => consentEvents(api, deps, ctx, a) });
  core.action({
    id: "consent_dividend",
    label: "Declare a consent dividend",
    description: "For a C corporation you govern: its holders agree to count an amount as a dividend paid for the year, with no money moving, so the corporation keeps its cash but owes no tax on keeping its earnings (the accumulated earnings and personal holding company taxes). Each holder takes their part as income for that year and adds it to what their shares cost them.",
    pack: "economy",
    params: { org: { type: "ref", ref: COMPANY_KIND, label: "The corporation" }, amount: { type: "money" }, year: { type: "number", optional: true, label: "The tax year (this one, or last year's until its return on 15 April)" } },
    requires: ["level.money >= 3", "amount > 0", "may(self, org, 'org.govern')"],
    outcomes: { default: [{ type: "economy.consent_dividend", args: { org: "org", cents: "=amount", year: "=params.year", by: "actor" } }] },
    duration: "15",
    lexicon: ["declare a consent dividend", "consent dividend", "treat it as a dividend paid", "clear the accumulated earnings tax"],
    observable: "signs a tax election",
  });
}
