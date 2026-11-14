// The fact store (plan §6.6): plain statements about a thing, `(about, key, value)` with the
// precision, standing and source of the change that carries each one. Facts are changes like any
// other: tied to their turn, staged inside it, rewound by a swipe or a delete, folded with the rest.
// One call of `addChanges` writes as many as it is given.
//
// Replacing is explicit: a fact replaces the standing fact of the same thing and the same key, and
// the fact it names. Keys are matched exactly; nothing here judges whether two statements in words
// are about the same thing. A replaced fact stays in the state, marked, so its history is kept.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { STORE_OPS, type Fact, type Precision, type Report, type Source, type Standing, type StoreState } from "./types";

/** A fact as its writer gives it. */
export interface FactInput {
  /** The tree ref of what it is about: `world`, `place:<id>`, `entity:<id>`. */
  about: string;
  /** A key the writer chooses: the same key on the same thing replaces. */
  key: string;
  /** The value in words. */
  value: string;
  /** The id of a fact this one replaces, whatever its key or what it is about. */
  replaces?: string | null;
}

/** How long a fact's id is, in hex digits after its `f-`: enough that two facts of one chat never share one. */
const ID_DIGITS = 12;

/** What a fact applies with, besides its value: the change's provenance and its turn. */
export interface FactContext {
  turn: string;
  n: number;
  by: string | null;
  precision: Precision | null;
  standing: Standing | null;
  source: Source | null;
}

/** The tree refs a fact may be about. */
export const FACT_ABOUT = /^(world|place:.+|entity:.+)$/;

/**
 * The fact store as the engine's tools hold it (`FactStore` in `src/iface/kit.ts`): the change that
 * records a fact, and the facts standing on a thing in a state, as data.
 */
export const factStore = {
  /** The change that records `fact`: the store operation and its value, with a new id. */
  change(fact: FactInput): { op: string; value: JsonObject } {
    const id = `f-${crypto.randomUUID().replaceAll("-", "").slice(0, ID_DIGITS)}`;
    const value: JsonObject = { id, about: fact.about, key: fact.key, value: fact.value };
    if (fact.replaces !== undefined && fact.replaces !== null && fact.replaces !== "") value.replaces = fact.replaces;
    return { op: STORE_OPS.fact, value };
  },
  /** The facts standing on `about`, oldest first, each with its provenance and its turn's number. */
  of(state: StoreState, about: string): JsonValue[] {
    return standing(state, about).map((f) => ({ ...f }) as unknown as JsonValue);
  },
};

/** The facts standing on `about` (a tree ref), oldest first: those no later fact replaced, with a value. */
export function standing(state: StoreState, about: string): Fact[] {
  return (state.facts[about] ?? []).filter((f) => f.replacedBy === undefined && f.value !== "");
}

/**
 * Applies a recorded fact to the state: it replaces the standing fact of the same thing and key,
 * and the fact it names. It always applies; naming a fact that is not standing is reported.
 */
export function applyFact(state: StoreState, value: JsonValue, at: FactContext): Report[] {
  const v = isRecord(value) ? value : {};
  const fact: Fact = {
    id: String(v.id),
    about: String(v.about),
    key: String(v.key),
    value: String(v.value),
    precision: at.precision,
    standing: at.standing,
    source: at.source,
    by: at.by,
    turn: at.turn,
    n: at.n,
  };
  const reports: Report[] = [];
  const retire = (f: Fact): void => {
    f.replacedBy = fact.id;
    f.replacedAt = at.n;
  };
  const list = state.facts[fact.about] ?? [];
  for (const f of list) if (f.replacedBy === undefined && (f.key === fact.key || f.id === fact.id)) retire(f);
  const named = typeof v.replaces === "string" ? v.replaces : null;
  if (named !== null) {
    const found = Object.values(state.facts)
      .flat()
      .find((f) => f.id === named && f.replacedBy === undefined);
    if (found) retire(found);
    else if (!list.some((f) => f.id === named && f.replacedBy === fact.id)) reports.push({ code: "replaces_none", values: { id: named } });
  }
  state.facts[fact.about] = [...list, fact];
  return reports;
}
