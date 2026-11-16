// A state the store changes without copying what the change does not touch (plan §6.3 l.619, §18.1 row 0.5). A state handed out
// is read, never changed; a fold, a write or a reading that changes one works on a draft made over it (`draft`), whose parts are the
// state's own until a change is about to write one (`claim`), which copies that part alone: the entity an engine change names, its
// line in the touched record, the account totals, the space and engine packs' slices the moving types keep. A change of any other type
// (a pack's, whose writes the store does not know) copies the rest once (`thaw`), and the draft is wholly its own from then on.
//
// A unit of grouped events is tried on the draft itself (`tryUnit`): what each event writes is copied first, and what was there is
// noted, so a unit that does not land whole leaves every part of the state as it was; one that lands is kept as it is. A unit holding
// a change whose writes the store does not know is tried on a copy of the world, as before.

import type { LedgerEvent } from "../shared/ledger";
import type { WorldState } from "../engine/state";
import { backWhereabouts, keepWhereabouts, markWhereabouts } from "../engine/whereabouts";
import type { StoreState } from "./types";

type Obj = Record<string, unknown>;

/** A unit's trial on a draft: the parts it copied, and each place it wrote, with what was there, to put back. */
interface Trial {
  fresh: WeakSet<object>;
  made: object[];
  undo: [Obj, string, boolean, unknown][];
}

/** What a draft owns: the parts it copied (`whole`: those copied through and through); all of it once thawed; and the unit being tried on it. */
interface Draft {
  fresh: WeakSet<object>;
  whole: WeakSet<object>;
  all: boolean;
  trial: Trial | null;
}

const drafts = new WeakMap<WorldState, Draft>();

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/**
 * A state to change, made over `base`, which stays as it is. Its world and the store's records beside it are its own objects;
 * everything inside them is the base's until a change claims it.
 */
export function draft(base: StoreState): StoreState {
  const world: WorldState = { ...base.world };
  drafts.set(world, { fresh: new WeakSet(), whole: new WeakSet(), all: false, trial: null });
  return { ...base, world, notes: { ...base.notes }, touched: { ...base.touched }, marks: { ...base.marks }, facts: { ...base.facts } };
}

/** Notes, while a unit is tried, that `parent[key]` is about to change: put back if the unit does not land. */
function note(d: Draft, parent: Obj, key: string): void {
  d.trial?.undo.push([parent, key, Object.hasOwn(parent, key), parent[key]]);
}

/**
 * `parent[key]` made the draft's to change: kept when it is already, else copied into its place (`deep`: through and through). A
 * record the draft owns that a unit writes by key (`keyed`: the entities, the touched record) is not copied for a trial: each key
 * written is noted instead. Undefined where there is none yet: the change makes it, noted.
 */
function claimed(d: Draft, parent: Obj, key: string, how: "copy" | "deep" | "keyed"): Obj | undefined {
  const was = Object.hasOwn(parent, key) ? parent[key] : undefined;
  if (!isObj(was)) {
    note(d, parent, key);
    return undefined;
  }
  const t = d.trial;
  if (t?.fresh.has(was)) return was;
  const ours = d.all || d.fresh.has(was);
  if (ours && (t === null || how === "keyed")) return was;
  note(d, parent, key);
  const copy = how === "deep" ? structuredClone(was) : Array.isArray(was) ? ([...was] as unknown as Obj) : { ...was };
  parent[key] = copy;
  if (t) {
    t.fresh.add(copy);
    t.made.push(copy);
  } else d.fresh.add(copy);
  if (how === "deep") d.whole.add(copy);
  return copy;
}

/** The entity ids an event of a core type writes (into `out`); false for any other type, whose writes the store does not know. */
function writes(ev: LedgerEvent, out: string[]): boolean {
  const e = ev as LedgerEvent & { entity?: unknown; from?: unknown; lines?: { account: string }[]; events?: LedgerEvent[] };
  switch (ev.type) {
    case "set":
    case "add":
      if (typeof e.entity === "string") out.push(e.entity);
      return true;
    case "link":
    case "unlink":
      if (typeof e.from === "string") out.push(e.from);
      return true;
    case "spawn":
      if (isObj(e.entity) && typeof e.entity.id === "string") out.push(e.entity.id);
      return true;
    case "post":
      for (const l of e.lines ?? []) out.push(l.account);
      return true;
    case "stage":
    case "clock":
    case "timelapse":
      return true;
    case "materialize":
      return (e.events ?? []).every((inner) => writes(inner, out));
    default:
      return false;
  }
}

/** Whether every event of a unit is of a type whose writes the store knows, so it can be tried in place. */
export function knownWrites(unit: readonly LedgerEvent[]): boolean {
  return unit.every((ev) => writes(ev, []));
}

/**
 * Makes what `ev` will write the draft's own, before it applies: the entities it names and their lines in the touched record, the
 * containers its type writes, and the engine and space packs' slices the moving types keep. A world no draft was made over is its
 * own throughout. An event of another type thaws the draft (outside a trial; a unit holding one is tried on a copy instead).
 */
export function claim(world: WorldState, ev: LedgerEvent): void {
  const d = drafts.get(world);
  if (!d) return;
  const w = world as unknown as Obj;
  const ids: string[] = [];
  if (!writes(ev, ids)) {
    if (d.trial) throw new Error(`a unit holding ${ev.type} is tried on a copy, not in place`);
    if (!d.all) thaw(world, d);
    return;
  }
  if (d.all && !d.trial) return;
  const entities = claimed(d, w, "entities", "keyed") as Obj;
  for (const id of ids) claimed(d, entities, id, "deep");
  for (const key of ["accounts", "tracks", "materialized"]) claimed(d, w, key, "copy");
  if (d.trial) {
    note(d, w, "clock");
    note(d, w, "revision");
  }
  const packs = claimed(d, w, "packs", "copy") as Obj;
  const engine = claimed(d, packs, "engine", "copy");
  if (engine) {
    const touched = claimed(d, engine, "touched", "keyed");
    if (touched) for (const id of ids) claimed(d, touched, id, "deep");
    claimed(d, engine, "life", "deep");
  }
  const space = claimed(d, packs, "space", "copy");
  const seen = space ? claimed(d, space, "seen", "copy") : undefined;
  if (seen) for (const part of ["places", "people", "cells"]) claimed(d, seen, part, "copy");
}

/** Makes the whole world the draft's own: every part not copied yet is copied now, once. */
function thaw(world: WorldState, d: Draft): void {
  const owned = (v: unknown): unknown => {
    if (!isObj(v) || d.whole.has(v)) return v;
    if (!d.fresh.has(v)) return structuredClone(v);
    // A part copied for a change holds the base's parts below it: those are copied.
    for (const k of Object.keys(v)) v[k] = owned(v[k]);
    return v;
  };
  const w = world as unknown as Obj;
  for (const key of Object.keys(w)) w[key] = owned(w[key]);
  d.all = true;
}

/** Makes the whole world the draft's own (a marker applies, whose writes the store does not know); a world no draft was made over is. */
export function thawWorld(world: WorldState): void {
  const d = drafts.get(world);
  if (d && !d.all) thaw(world, d);
}

/**
 * Tries a unit on the world in place: `run` applies it, and answers null when it landed whole, else why not. One that did not land
 * leaves every part of the world as it was; one that did is kept. Every event of the unit must be of a type whose writes the store
 * knows (`knownWrites`).
 */
export function tryUnit<T>(world: WorldState, run: () => T | null): T | null {
  let d = drafts.get(world);
  if (!d) {
    // A world the fold owns throughout (read from a snapshot, or made afresh): every part counts as its own.
    d = { fresh: new WeakSet(), whole: new WeakSet(), all: true, trial: null };
    drafts.set(world, d);
  }
  const trial: Trial = { fresh: new WeakSet(), made: [], undo: [] };
  d.trial = trial;
  markWhereabouts(world);
  let out: T | null;
  try {
    out = run();
  } finally {
    d.trial = null;
  }
  if (out === null) {
    for (const o of trial.made) d.fresh.add(o);
    keepWhereabouts(world);
  } else {
    for (let i = trial.undo.length - 1; i >= 0; i--) {
      const [parent, key, had, was] = trial.undo[i] as [Obj, string, boolean, unknown];
      if (had) parent[key] = was;
      else delete parent[key];
    }
    backWhereabouts(world);
  }
  return out;
}
