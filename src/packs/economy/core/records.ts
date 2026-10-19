// What the holdings module keeps per party in its part of the economy slice (DESIGN §27.8):
// realised gains and investment income by calendar year, the latest sales, and the basis of what
// is held outside lots (a property, a business stake). Reducers write these; views and the yearly
// investment tax read them.

import type { EntityId } from "../../../shared/ids";
import { safeKey, type JsonValue } from "../../../shared/json";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { numOf, objOf, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import { holdingsRecord, holdingsSlice } from "./assets";

/** Realised sales kept per party for the dashboards. */
const REALISED_KEPT = 24;

export interface GainRecord {
  term: "short" | "long";
  gain: number;
  proceeds: number;
  basis: number;
  label: string;
  qty: number;
  /** A gain on the sale of the party's home, which the yearly tax may exclude. */
  home?: boolean;
}

/** Splits an amount by worth shares (percent), each part rounded; parties by id. */
export function byShare(shares: Readonly<Record<EntityId, number>>, cents: number): { party: EntityId; cents: number }[] {
  return Object.entries(shares)
    .filter(([, pct]) => pct > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([party, pct]) => ({ party, cents: Math.round((cents * pct) / 100) }));
}

function yearOf(world: ReadContext["world"], clock: number): string {
  return String(dateAt(calendarOf(world), clock).year);
}

/** Adds a realised gain to the party's year (`gains[party][year]`) and to their latest sales. */
export function recordGain(state: WorldState, world: ReadContext["world"], party: EntityId, g: GainRecord): void {
  if (!safeKey(party)) return;
  const year = yearOf(world, state.clock);
  const gains = holdingsRecord(state, "gains");
  const mine = objOf(own(gains, party));
  const y = objOf(own(mine, year));
  mine[year] = { ...y, [g.term]: numOf(y[g.term]) + g.gain, proceeds: numOf(y.proceeds) + g.proceeds, basis: numOf(y.basis) + g.basis, ...(g.home ? { home: numOf(y.home) + g.gain } : {}) };
  gains[party] = mine;
  const realised = holdingsRecord(state, "realised");
  const list = Array.isArray(own(realised, party)) ? (own(realised, party) as JsonValue[]) : [];
  realised[party] = [...list.slice(-(REALISED_KEPT - 1)), { at: state.clock, label: g.label, qty: g.qty, proceeds: g.proceeds, basis: g.basis, gain: g.gain, term: g.term }];
}

/** A party's realised gains in a year: short and long term, the part on selling their home, proceeds and basis. */
export function gainsIn(state: Readonly<WorldState>, party: EntityId, year: number): { short: number; long: number; home: number; proceeds: number; basis: number } {
  const y = objOf(own(objOf(own(objOf(holdingsSlice(state).gains), party)), String(year)));
  return { short: numOf(y.short), long: numOf(y.long), home: numOf(y.home), proceeds: numOf(y.proceeds), basis: numOf(y.basis) };
}

/** The years a party has gains or income recorded in, oldest first. */
export function recordedYears(state: Readonly<WorldState>, party: EntityId): number[] {
  const years = new Set<number>();
  for (const key of ["gains", "income"] as const) for (const y of Object.keys(objOf(own(objOf(holdingsSlice(state)[key]), party)))) if (/^-?\d+$/.test(y)) years.add(Number(y));
  return [...years].sort((a, b) => a - b);
}

/** The parties with gains or income recorded. */
export function recordedParties(state: Readonly<WorldState>): EntityId[] {
  const out = new Set<EntityId>();
  for (const key of ["gains", "income"] as const) for (const p of Object.keys(objOf(holdingsSlice(state)[key]))) out.add(p);
  return [...out].sort();
}

/** A party's latest sales, newest first. */
export function realisedSales(state: Readonly<WorldState>, party: EntityId): { at: number; label: string; qty: number; proceeds: number; basis: number; gain: number; term: string }[] {
  const list = own(objOf(holdingsSlice(state).realised), party);
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => objOf(v))
    .map((o) => ({ at: numOf(o.at), label: typeof o.label === "string" ? o.label : "", qty: numOf(o.qty), proceeds: numOf(o.proceeds), basis: numOf(o.basis), gain: numOf(o.gain), term: typeof o.term === "string" ? o.term : "short" }))
    .reverse();
}

export const INCOME_KINDS = ["dividend", "interest", "profit"] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

/** Adds income to a party's year, by kind (`income[party][year][kind]`). */
export function recordIncome(state: WorldState, world: ReadContext["world"], party: EntityId, kind: IncomeKind, cents: number): void {
  if (!safeKey(party) || cents === 0) return;
  const year = yearOf(world, state.clock);
  const income = holdingsRecord(state, "income");
  const mine = objOf(own(income, party));
  const y = objOf(own(mine, year));
  mine[year] = { ...y, [kind]: numOf(y[kind]) + cents };
  income[party] = mine;
}

/** A party's investment income in a year, by kind. */
export function incomeIn(state: Readonly<WorldState>, party: EntityId, year: number): Record<IncomeKind, number> {
  const y = objOf(own(objOf(own(objOf(holdingsSlice(state).income), party)), String(year)));
  return { dividend: numOf(y.dividend), interest: numOf(y.interest), profit: numOf(y.profit) };
}

/**
 * What a party paid for its share of something held outside lots (a property, a business stake)
 * and since when, as play recorded it (`basis[entity][party]`); null when play recorded none.
 */
export function basisRecord(state: Readonly<WorldState>, entity: EntityId, party: EntityId): { basis: number; since: number | null } | null {
  const r = own(objOf(own(objOf(holdingsSlice(state).basis), entity)), party);
  if (r === undefined) return null;
  const o = objOf(r);
  return { basis: numOf(o.basis), since: typeof o.since === "number" ? o.since : null };
}

/** Sets (or, with null, clears) a party's basis record for an entity. */
export function setBasisRecord(state: WorldState, entity: EntityId, party: EntityId, value: { basis: number; since: number | null } | null): void {
  if (!safeKey(entity) || !safeKey(party)) return;
  const all = holdingsRecord(state, "basis");
  const mine = objOf(own(all, entity));
  if (value === null) delete mine[party];
  else mine[party] = { basis: value.basis, ...(value.since !== null ? { since: value.since } : {}) };
  all[entity] = mine;
}
