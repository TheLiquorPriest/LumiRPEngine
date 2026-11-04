// Gains and the tax on them (DESIGN §27.8). Lots realise their gains as they are sold (holdings.ts);
// a property or a business stake realises its own when it changes hands (`economy.dispose`, against
// what its seller paid, `economy.acquire`). At the top Money level (the `capital_gains` feature) each
// party's investment income is taxed once a year, on 15 April for the year before, as a flow: short
// gains and interest at the ordinary brackets on top of their other income, long gains and
// dividends at the long-term rates stacked above it, the net investment income tax over its
// threshold, and the region's rate. Losses net against gains, up to the table's limit comes off
// ordinary income, and the rest carries forward. Selling a home its owner lived in for two years
// excludes the table's amount of the gain. The tables give every rate and threshold; the work
// module gives a party's ordinary income and brackets (`economy.ordinary_income`,
// `economy.income_tax`), read through the registry.

import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { FILING_STATUSES, type FilingStatus, type Flow } from "../../../shared/finance";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { labelOf, numOf, objOf, optionalQuery, own, sliceOf, strOf } from "../../../engine/pack-kit";
import { passMemo } from "../../../engine/read-pass";
import type { EventTypeDef, ReadContext } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import type { AmountProvider, FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { clockOfDate, reject } from "./assets";
import { isExempt } from "./exempt";
import { basisRecord, gainsIn, incomeIn, recordGain, recordedParties, recordedYears, setBasisRecord } from "./records";
import { YEAR_MINUTES } from "./pricing";

export const TAX_PROVIDER = "investment_tax";

// ---------------------------------------------------------------- basis of what's held outside lots

/**
 * What a party's share of a property or a business stake cost them and since when: play's record,
 * else (a property) its purchase price, or its value when the world began, by their share, held
 * since its purchase date; a stake play didn't record cost nothing (a founder's), held since
 * before the story.
 */
export function basisOf(api: Pick<FinanceApi, "shareOf">, ctx: Pick<ReadContext, "world" | "state">, entity: EntityId, party: EntityId): { basis: number; since: number | null } {
  const recorded = basisRecord(ctx.state, entity, party);
  if (recorded) return recorded;
  const e = own(ctx.state.entities, entity);
  if (e?.kind !== "property") return { basis: 0, since: null };
  const authored = own(ctx.world.entities, entity)?.fields.value;
  const whole = numOf(e.fields.purchase_price, typeof authored === "number" ? authored : numOf(e.fields.value));
  return { basis: Math.round((whole * api.shareOf(ctx.state, entity, party)) / 100), since: clockOfDate(ctx.world, e.fields.purchased as JsonValue) };
}

/** Whether a property is the party's home: their `home` names it or its place. */
export function isHome(state: Readonly<WorldState>, property: EntityId, party: EntityId): boolean {
  const home = own(state.entities, party)?.fields.home;
  const place = own(state.entities, property)?.fields.place;
  return typeof home === "string" && home !== "" && (home === property || home === place);
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

function disposeEvent(api: FinanceApi): EventTypeDef<PackEvent> {
  return {
    // A party parts with `pct` percent of their share of a property or a business for `proceeds`:
    // the gain against that part of their basis is theirs for the year.
    type: "economy.dispose",
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, str(e, "entity")) || !own(ctx.state.entities, str(e, "party"))) return reject("missing_entity", "a disposal names what was sold and who sold it");
      const pct = e.data.pct;
      const proceeds = e.data.proceeds;
      if (typeof pct !== "number" || !(pct > 0 && pct <= 100)) return reject("bad_event", "a disposal is of a part of a share");
      return typeof proceeds === "number" && Number.isSafeInteger(proceeds) && proceeds >= 0 ? null : reject("bad_event", "a disposal's proceeds are a whole amount");
    },
    apply: (e, state, ctx) => {
      const entity = str(e, "entity");
      const party = str(e, "party");
      const pct = numOf(e.data.pct);
      const proceeds = numOf(e.data.proceeds);
      const b = basisOf(api, { world: ctx.world, state }, entity, party);
      const part = Math.round((b.basis * pct) / 100);
      const held = b.since === null ? Infinity : state.clock - b.since;
      const home = own(state.entities, entity)?.kind === "property" && isHome(state, entity, party) && held >= 2 * YEAR_MINUTES;
      recordGain(state, ctx.world, party, { term: held >= YEAR_MINUTES ? "long" : "short", gain: proceeds - part, proceeds, basis: part, label: strOf(e.data.label, `Sold ${labelOf(ctx, entity)}`), qty: pct / 100, ...(home ? { home: true } : {}) });
      setBasisRecord(state, entity, party, pct >= 100 ? null : { basis: b.basis - part, since: b.since });
    },
    describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "party"))} sold ${numOf(e.data.pct)}% of their share of ${labelOf(ctx, str(e, "entity"))}`),
  };
}

const acquireEvent: EventTypeDef<PackEvent> = {
  // A party pays `cents` for a share of a property or a business: it adds to their basis.
  type: "economy.acquire",
  validate: (e, ctx) => {
    if (!own(ctx.state.entities, str(e, "entity")) || !own(ctx.state.entities, str(e, "party"))) return reject("missing_entity", "an acquisition names what was bought and who bought it");
    const cents = e.data.cents;
    return typeof cents === "number" && Number.isSafeInteger(cents) && cents >= 0 ? null : reject("bad_event", "an acquisition costs a whole amount");
  },
  apply: (e, state) => {
    const r = basisRecord(state, str(e, "entity"), str(e, "party"));
    setBasisRecord(state, str(e, "entity"), str(e, "party"), { basis: (r?.basis ?? 0) + numOf(e.data.cents), since: r?.since ?? state.clock });
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "party"))} bought into ${labelOf(ctx, str(e, "entity"))}`),
};

// ---------------------------------------------------------------- trusts

/** `economy.trust_distribution`: what a trust paid out to each beneficiary, for the income its distributions carry out (§26.3). Rides with the distribution. */
export const TRUST_DISTRIBUTION = "economy.trust_distribution";

function isTrust(ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): boolean {
  return kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "trust");
}

/** A grantor trust's settlor (§26.3, IRC sections 671-677): a revocable trust whose settlor is a person is theirs for income tax; null for any other party. */
export function grantorOf(ctx: Pick<ReadContext, "registry" | "world" | "state">, trust: EntityId): EntityId | null {
  const f = own(ctx.state.entities, trust)?.fields;
  const settlor = strOf(f?.settlor);
  return f?.revocable === true && settlor !== "" && settlor !== trust && isTrust(ctx, trust) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, settlor)?.kind ?? "", "person") ? settlor : null;
}

/** The grantor trusts each settlor's income tax takes in, by settlor; kept for a read pass. */
function grantorTrusts(ctx: ReadContext): Map<EntityId, EntityId[]> {
  return passMemo([ctx.state, ctx.world], "economy.grantor_trusts", () => {
    const out = new Map<EntityId, EntityId[]>();
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const settlor = isGone(ctx.state, id) ? null : grantorOf(ctx, id);
      if (settlor !== null) out.set(settlor, [...(out.get(settlor) ?? []), id]);
    }
    return out;
  });
}

/** What a trust paid each beneficiary in a year. */
export function trustDistributions(state: Readonly<WorldState>, trust: EntityId, year: number): Map<EntityId, number> {
  const y = objOf(own(objOf(own(objOf(sliceOf(state, "economy").trust_distributions), trust)), String(year)));
  return new Map(Object.entries(y).map(([party, cents]) => [party, numOf(cents)]));
}

/** Years of a trust's distributions kept: this one and the last, whose tax falls in April. */
const TRUST_YEARS_KEPT = 2;

const trustDistributionEvent: EventTypeDef<PackEvent> = {
  type: TRUST_DISTRIBUTION,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "trust")) && Array.isArray(e.data.parts) ? null : reject("bad_event", "a trust's distribution names the trust and each beneficiary's part")),
  apply: (e, state, ctx) => {
    const trust = str(e, "trust");
    const year = String(yearAt(ctx.world, state.clock));
    const all = sliceOf(state, "economy");
    const record: JsonObject = { ...objOf(all.trust_distributions) };
    const mine: JsonObject = { ...objOf(own(record, trust)) };
    const y: JsonObject = { ...objOf(own(mine, year)) };
    for (const raw of Array.isArray(e.data.parts) ? e.data.parts : []) {
      const p = objOf(raw);
      const party = strOf(p.party);
      if (party !== "" && numOf(p.cents) > 0) y[party] = numOf(own(y, party)) + numOf(p.cents);
    }
    mine[year] = y;
    for (const old of Object.keys(mine).sort().slice(0, Math.max(0, Object.keys(mine).length - TRUST_YEARS_KEPT))) delete mine[old];
    record[trust] = mine;
    all.trust_distributions = record;
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "trust"))} distributed to its beneficiaries`),
};

/** A trust's distribution's record: each beneficiary's part, as bookkeeping riding with the payment. */
export function trustDistribution(trust: EntityId, parts: readonly { party: EntityId; cents: number }[]): LedgerEvent[] {
  const paid = parts.filter((p) => p.cents > 0);
  return paid.length > 0 ? [{ type: TRUST_DISTRIBUTION, data: { trust, parts: paid.map((p) => ({ party: p.party, cents: Math.round(p.cents) })) } }] : [];
}

/** A non-grantor trust's year as its tax reads it (`trustYear`): `through` is its share of pass-through profit, among `ordinary`. */
interface TrustYear {
  ordinary: number;
  dividends: number;
  through: number;
  dni: number;
  carried: number;
  parts: Map<EntityId, { ordinary: number; dividends: number }>;
}

/**
 * A non-grantor trust's year (§26.3, DNI simplified): its income (interest, royalties and its share of
 * pass-through profit, ordinary; dividends apart), its distributable net income (that income, gains
 * kept as its corpus's), and the part of it its distributions carry out to each beneficiary, by what
 * they were paid, up to it, with its character kept.
 */
function trustYear(ctx: ReadContext, trust: EntityId, year: number): TrustYear {
  const inc = incomeIn(ctx.state, trust, year);
  const through = Math.max(0, optionalQuery(ctx, "economy.ordinary_income")?.(ctx, trust, year).gross ?? 0);
  const ordinary = inc.interest + inc.royalty + through;
  const dni = ordinary + inc.dividend;
  const paid = [...trustDistributions(ctx.state, trust, year)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const distributed = paid.reduce((a, [, c]) => a + c, 0);
  const carried = Math.min(distributed, dni);
  const parts = new Map<EntityId, { ordinary: number; dividends: number }>();
  let given = 0;
  for (const [i, [party, cents]] of paid.entries()) {
    const part = i === paid.length - 1 ? carried - given : Math.round((carried * cents) / Math.max(1, distributed));
    given += part;
    const ord = dni > 0 ? Math.round((part * ordinary) / dni) : 0;
    parts.set(party, { ordinary: ord, dividends: part - ord });
  }
  return { ordinary, dividends: inc.dividend, through, dni, carried, parts };
}

/** What a person takes in for a year from the trusts that paid them: their part of each one's carried-out income, ordinary and dividends. */
function carriedOut(ctx: ReadContext, person: EntityId, year: number): { ordinary: number; dividends: number } {
  let ordinary = 0;
  let dividends = 0;
  for (const trust of Object.keys(objOf(sliceOf(ctx.state, "economy").trust_distributions)).sort()) {
    if (!trustDistributions(ctx.state, trust, year).has(person) || grantorOf(ctx, trust) !== null) continue;
    const part = trustYear(ctx, trust, year).parts.get(person);
    ordinary += part?.ordinary ?? 0;
    dividends += part?.dividends ?? 0;
  }
  return { ordinary, dividends };
}

// ---------------------------------------------------------------- the tax tables

interface TaxTables {
  ltcgPct: [number, number, number];
  ltcgThresholds: Record<FilingStatus, [number, number]> | null;
  niitPct: number;
  niitThreshold: Record<FilingStatus, number>;
  lossLimit: number;
  homeExclusion: Record<FilingStatus, number>;
  brackets: Record<FilingStatus, { from: number; to: number | null; pct: number }[]>;
  /** A non-grantor trust's brackets, long-term thresholds and NIIT threshold (the start of its top bracket). */
  trust: { brackets: { from: number; to: number | null; pct: number }[]; ltcg: [number, number] | null; niit: number };
}

function federal(ctx: Pick<ReadContext, "tables">): JsonObject {
  return objOf(ctx.tables.get("economy.finance")?.rows.taxes_federal?.values);
}

function byFiling(o: JsonObject, prefix: string, suffix: string): Partial<Record<FilingStatus, JsonValue>> {
  const out: Partial<Record<FilingStatus, JsonValue>> = {};
  for (const f of FILING_STATUSES) {
    const v = own(o, `${prefix}${f}${suffix}`);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

/** The investment-tax parameters in the finance table's federal section. */
export function taxTables(ctx: Pick<ReadContext, "tables">): TaxTables {
  const fed = federal(ctx);
  const ltcg = objOf(fed.capital_gains_long_term_pct);
  const bands = Array.isArray(ltcg.bands) ? ltcg.bands.map((b) => numOf(b)) : [0, 15, 20];
  const thresholds = byFiling(ltcg, "thresholds_", "_cents");
  const pair = (v: JsonValue | undefined): [number, number] | null => (Array.isArray(v) && v.length >= 2 ? [numOf(v[0]), numOf(v[1])] : null);
  const single = pair(thresholds.single);
  const niit = objOf(fed.net_investment_income_tax);
  const niitBy = byFiling(niit, "threshold_", "_cents");
  const exclusion = objOf(fed.home_sale_exclusion_cents);
  const brackets = byFiling(fed, "brackets_", "");
  const readBrackets = (v: JsonValue | undefined): { from: number; to: number | null; pct: number }[] =>
    Array.isArray(v)
      ? v.map((raw) => objOf(raw)).filter((b) => Object.keys(b).length > 0).map((b) => ({ from: numOf(b.from_cents), to: typeof b.to_cents === "number" ? b.to_cents : null, pct: numOf(b.rate_pct) }))
      : [];
  const singleBrackets = readBrackets(brackets.single);
  const record = <T>(read: (f: FilingStatus) => T): Record<FilingStatus, T> => Object.fromEntries(FILING_STATUSES.map((f) => [f, read(f)])) as Record<FilingStatus, T>;
  const trustBrackets = readBrackets(fed.brackets_trust);
  return {
    ltcgPct: [bands[0] ?? 0, bands[1] ?? 15, bands[2] ?? 20],
    ltcgThresholds: single ? record((f) => pair(thresholds[f]) ?? single) : null,
    niitPct: numOf(niit.pct),
    niitThreshold: record((f) => numOf(niitBy[f], numOf(niitBy.single, Infinity))),
    lossLimit: numOf(fed.capital_loss_limit_cents, 300000),
    homeExclusion: record((f) => numOf(own(exclusion, f), numOf(exclusion.single))),
    brackets: record((f) => {
      const own = readBrackets(brackets[f]);
      return own.length > 0 ? own : singleBrackets;
    }),
    // A world whose table predates them taxes a trust as a single filer.
    trust: { brackets: trustBrackets.length > 0 ? trustBrackets : singleBrackets, ltcg: pair(ltcg.thresholds_trust_cents) ?? single, niit: numOf(niit.threshold_trust_cents, numOf(niitBy.single, Infinity)) },
  };
}

/** Tax on `taxable` at the brackets (the work module's when it is loaded, else the table's own). */
function ordinaryTax(ctx: ReadContext, t: TaxTables, filing: FilingStatus, taxable: number): number {
  const x = Math.max(0, taxable);
  const query = optionalQuery(ctx, "economy.income_tax");
  if (query) return query(ctx, filing, x);
  return t.brackets[filing].reduce((sum, b) => sum + (Math.max(0, Math.min(x, b.to ?? Infinity) - b.from) * b.pct) / 100, 0);
}

/** How much of `[from, from + amount)` falls in `[lo, hi)`. */
function overlap(from: number, amount: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(from + amount, hi) - Math.max(from, lo));
}

/** The party's region's rate on income, percent. */
function statePct(ctx: ReadContext, party: EntityId): number {
  const configured = ctx.world.packs.economy?.config.region;
  const region = strOf(own(ctx.state.entities, party)?.fields.region, typeof configured === "string" ? configured : "us");
  return numOf(objOf(own(objOf(ctx.tables.get("economy.regions")?.rows), region)).state_income_tax_effective_pct);
}

export interface InvestmentTax {
  year: number;
  /** What's owed (negative: a refund, when a loss came off ordinary income). */
  cents: number;
  shortGains: number;
  longGains: number;
  /** Losses carried into the next year (negative or zero), short and long apart. */
  carry: { short: number; long: number };
  filing: FilingStatus;
}

/** Losses carried into `year` from the years before it. */
function carryInto(ctx: ReadContext, party: EntityId, year: number, t: TaxTables, depth = 0): { short: number; long: number } {
  const years = recordedYears(ctx.state, party).filter((y) => y < year);
  const last = years[years.length - 1];
  // Only years with records carry anything, and a loss carries at most as far back as they go.
  if (last === undefined || depth > 64) return { short: 0, long: 0 };
  return investmentTax(ctx, party, last, t, depth + 1).carry;
}

/**
 * The tax on a party's investment income for a calendar year: their gains (losses netted, the
 * carried losses first, a home's exclusion off), interest, royalties and dividends, over their
 * ordinary income. A person's takes in their grantor trusts' gains and income, and what trusts'
 * distributions carried out to them (§26.3). A grantor trust pays none: its settlor does. Any other
 * trust pays its own brackets, thresholds and NIIT threshold on what it keeps: its income less what
 * its distributions carried out, its share of pass-through profit among it (taxed nowhere else, so
 * here, unless the trust is exempt), and its gains.
 */
export function investmentTax(ctx: ReadContext, party: EntityId, year: number, t: TaxTables = taxTables(ctx), depth = 0): InvestmentTax {
  const trust = isTrust(ctx, party);
  if (trust && grantorOf(ctx, party) !== null) return { year, cents: 0, shortGains: 0, longGains: 0, carry: { short: 0, long: 0 }, filing: "single" };
  const g = { ...gainsIn(ctx.state, party, year) };
  const own0 = incomeIn(ctx.state, party, year);
  const inc = { interest: own0.interest, dividend: own0.dividend, royalty: own0.royalty };
  let kept: TrustYear | null = null;
  if (trust) {
    // What it keeps: its income less what its distributions carried out, by character.
    kept = trustYear(ctx, party, year);
    const ordinaryShare = kept.dni > 0 ? kept.ordinary / kept.dni : 0;
    const out = kept.carried;
    const keptOrdinary = kept.ordinary - Math.round(out * ordinaryShare);
    const scale = kept.ordinary > 0 ? keptOrdinary / kept.ordinary : 0;
    inc.interest = Math.round(own0.interest * scale);
    inc.royalty = Math.round(own0.royalty * scale);
    inc.dividend = kept.dividends - (out - Math.round(out * ordinaryShare));
  } else {
    for (const held of grantorTrusts(ctx).get(party) ?? []) {
      const tg = gainsIn(ctx.state, held, year);
      const ti = incomeIn(ctx.state, held, year);
      g.short += tg.short;
      g.long += tg.long;
      inc.interest += ti.interest;
      inc.dividend += ti.dividend;
      inc.royalty += ti.royalty;
    }
    const from = carriedOut(ctx, party, year);
    inc.interest += from.ordinary;
    inc.dividend += from.dividends;
  }
  const carried = carryInto(ctx, party, year, t, depth);
  const keptThrough = kept ? Math.max(0, kept.through - Math.round(kept.carried * (kept.dni > 0 ? kept.through / kept.dni : 0))) : 0;
  const ordinary = trust
    ? { gross: keptThrough, taxable: keptThrough, filing: "single" as FilingStatus }
    : (optionalQuery(ctx, "economy.ordinary_income")?.(ctx, party, year) ?? { gross: 0, taxable: 0, filing: FILING_STATUSES.includes(strOf(own(ctx.state.entities, party)?.fields.filing_status) as FilingStatus) ? (strOf(own(ctx.state.entities, party)?.fields.filing_status) as FilingStatus) : "single" });
  const filing = ordinary.filing;
  const tax = (x: number): number => (trust ? bracketsTax(t.trust.brackets, x) : ordinaryTax(ctx, t, filing, x));
  let st = g.short + carried.short;
  let lt = g.long - Math.min(Math.max(0, g.home), t.homeExclusion[filing]) + carried.long;
  // Losses of one term come off gains of the other.
  if (st < 0 && lt > 0) {
    lt += st;
    st = lt < 0 ? lt : 0;
    lt = Math.max(0, lt);
  } else if (lt < 0 && st > 0) {
    st += lt;
    lt = st < 0 ? st : 0;
    st = Math.max(0, st);
  }
  // A net loss comes off ordinary income up to the limit, short losses first; the rest carries on.
  let deduction = Math.min(t.lossLimit, Math.max(0, -(Math.min(0, st) + Math.min(0, lt))));
  const offShort = Math.min(deduction, Math.max(0, -st));
  const carry = { short: Math.min(0, st) + offShort, long: Math.min(0, lt) + (deduction - offShort) };
  deduction = Math.min(deduction, ordinary.taxable + (trust ? inc.interest + inc.royalty : 0));
  const shortGains = Math.max(0, st);
  const longGains = Math.max(0, lt);
  const base = ordinary.taxable + inc.interest + inc.royalty + shortGains - deduction;
  // A person's ordinary income is taxed as it is paid (withholding, estimated tax), so the brackets
  // here take only what this income adds on top of it; a trust's kept share of pass-through profit
  // is taxed nowhere else, so they take it too, unless the trust is exempt (its share stays untaxed).
  const ownThrough = trust && !isExempt(ctx, party) ? keptThrough : 0;
  const ordinaryPart = tax(base) - tax(ordinary.taxable - ownThrough);
  const preferential = longGains + Math.max(0, inc.dividend);
  const [, mid, top] = t.ltcgPct;
  const bands = trust ? t.trust.ltcg : t.ltcgThresholds?.[filing];
  const stackFrom = Math.max(0, base);
  const longPart = bands ? (overlap(stackFrom, preferential, bands[0], bands[1]) * mid + overlap(stackFrom, preferential, bands[1], Infinity) * top) / 100 : (preferential * mid) / 100;
  const investment = inc.interest + inc.royalty + Math.max(0, inc.dividend) + shortGains + longGains;
  const niit = (Math.min(investment, Math.max(0, ordinary.gross + investment - (trust ? t.trust.niit : t.niitThreshold[filing]))) * t.niitPct) / 100;
  const state = (Math.max(0, investment + ownThrough - deduction) * statePct(ctx, party)) / 100;
  return { year, cents: Math.round(ordinaryPart + longPart + niit + state), shortGains, longGains, carry, filing };
}

/** Tax through a bracket list (a trust's), not rounded. */
function bracketsTax(brackets: readonly { from: number; to: number | null; pct: number }[], taxable: number): number {
  const x = Math.max(0, taxable);
  return brackets.reduce((sum, b) => sum + (Math.max(0, Math.min(x, b.to ?? Infinity) - b.from) * b.pct) / 100, 0);
}

/** The year a clock reading falls in. */
function yearAt(world: ReadContext["world"], clock: number): number {
  return dateAt(calendarOf(world), clock).year;
}

/**
 * The trusts whose own yearly flow pays tax on a share of pass-through profit, this year's or last
 * (§26.3): it reaches them though they record no income of their own. Never a grantor trust (its
 * settlor's) nor an exempt one; only where the yearly tax runs for them.
 */
function throughTrusts(api: FinanceApi, ctx: ReadContext): Set<EntityId> {
  const out = new Set<EntityId>();
  const ordinary = optionalQuery(ctx, "economy.ordinary_income");
  if (!ordinary) return out;
  const year = yearAt(ctx.world, ctx.state.clock);
  for (const id of Object.keys(ctx.state.entities).sort()) {
    if (!isTrust(ctx, id) || isGone(ctx.state, id) || !api.feature(ctx, id, "capital_gains") || grantorOf(ctx, id) !== null || isExempt(ctx, id)) continue;
    if (ordinary(ctx, id, year).gross > 0 || ordinary(ctx, id, year - 1).gross > 0) out.add(id);
  }
  return out;
}

/** The yearly investment-tax flow of a party with gains or investment income recorded, a person paid by a trust or taking in a grantor trust's, or a trust that pays its own (`through`: those with a share of pass-through profit). */
function taxFlow(api: FinanceApi, ctx: ReadContext, party: EntityId, through: ReadonlySet<EntityId>): Flow | null {
  if (!own(ctx.state.entities, party) || api.partyKind(ctx, party) === "business" || !api.feature(ctx, party, "capital_gains")) return null;
  if (isTrust(ctx, party) && grantorOf(ctx, party) !== null) return null;
  if (recordedYears(ctx.state, party).length === 0 && !(grantorTrusts(ctx).get(party) ?? []).some((t) => recordedYears(ctx.state, t).length > 0) && !trustPaid(ctx.state).has(party) && !through.has(party)) return null;
  return {
    id: `investment_tax:${party}`,
    label: "Tax on investment income",
    kind: "tax",
    from: party,
    to: "tax:federal",
    amount: { provider: TAX_PROVIDER, args: { party } },
    schedule: { every: "year", months: [4], days: [15], roll: "after" },
    shortfall: "defer",
    category: "taxes",
    status: "active",
    method: "account",
    source: "investment_tax",
  };
}

/** One year's investment tax as a flow pays it: owed from the party, a refund to them. */
function taxPosting(api: FinanceApi, ctx: ReadContext, party: EntityId, at: number): FlowPosting | null {
  const year = yearAt(ctx.world, at) - 1;
  const tax = investmentTax(ctx, party, year);
  const memo = `Tax on ${year} investment income`;
  if (tax.cents > 0) return { cents: tax.cents, memo, kind: "payment", category: "taxes" };
  const deposit = api.depositAccount(ctx, party);
  if (tax.cents === 0 || !deposit) return null;
  return {
    cents: -tax.cents,
    lines: [
      { account: api.outside("tax:federal"), amount: tax.cents },
      { account: deposit, amount: -tax.cents },
    ],
    memo: `Refund of ${year} investment tax`,
    kind: "refund",
    category: "taxes",
  };
}

/** What a party's investment tax for this year comes to so far, and when it's due. */
export function taxEstimate(api: FinanceApi, ctx: ReadContext, party: EntityId): { cents: number; at: number } | null {
  if (!api.feature(ctx, party, "capital_gains")) return null;
  const year = yearAt(ctx.world, ctx.state.clock);
  const tax = investmentTax(ctx, party, year);
  if (tax.cents === 0) return null;
  const due = clockOfDate(ctx.world, `${String(year + 1).padStart(4, "0")}-04-15`);
  return due === null ? null : { cents: tax.cents, at: due };
}

/** Everyone a trust's distribution paid in the years kept. */
function trustPaid(state: Readonly<WorldState>): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const years of Object.values(objOf(sliceOf(state, "economy").trust_distributions))) for (const y of Object.values(objOf(years))) for (const party of Object.keys(objOf(y))) out.add(party);
  return out;
}

/** Gains (DESIGN §27.8): what changes hands outside lots, and the yearly tax, trusts' among it (§26.3). */
export function registerGains(r: FinanceRegistry): void {
  r.core.event(disposeEvent(r.api));
  r.core.event(acquireEvent);
  r.core.event(trustDistributionEvent);
  r.flows({
    id: "investment_tax",
    flows: (ctx) => {
      const through = throughTrusts(r.api, ctx);
      const parties = new Set<EntityId>([...recordedParties(ctx.state), ...trustPaid(ctx.state), ...grantorTrusts(ctx).keys(), ...through]);
      return [...parties].sort().flatMap((p) => taxFlow(r.api, ctx, p, through) ?? []);
    },
  });
  const provider: AmountProvider = (ctx, flow, at) => {
    const args = "provider" in flow.amount ? objOf(flow.amount.args) : {};
    return taxPosting(r.api, ctx, strOf(args.party), at);
  };
  r.amount(TAX_PROVIDER, provider);
}

/** A disposal and the buyer's acquisition, as events: bookkeeping that rides with the sale's posting. */
export function disposal(entity: EntityId, party: EntityId, pct: number, proceeds: number, label: string): LedgerEvent {
  return { type: "economy.dispose", data: { entity, party, pct: Math.min(100, Math.max(0, pct)), proceeds: Math.max(0, Math.round(proceeds)), label } };
}

export function acquisition(entity: EntityId, party: EntityId, cents: number): LedgerEvent {
  return { type: "economy.acquire", data: { entity, party, cents: Math.max(0, Math.round(cents)) } };
}
