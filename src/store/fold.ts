// The new fold (plan §6.3): state at a point is a starting state plus the changes along a path,
// applied in order by the engine's own handlers. It reuses today's apply logic as it is: each
// event type's validator and reducer from the registry (`validateEvent`, `applyEvent`), the rule
// that a unit of grouped events lands whole or not at all, with today's helpers for units kept
// apart and units tied to others (`apartHost`, `tiesOf`), and today's marker code (`applyMarker`).
// What it does not carry is everything today's fold needs because it distrusts its own storage:
// path hashes over message texts, tombstones, pauses, Keep overlays and requests worked out again.
//
// A turn standing on the path it was made on, with nothing added before it since its changes were
// recorded, folds as it was recorded: each change that applied then applies again, unchecked, as
// today's fold re-applies a record that re-converges (validation is a function of the state). Any
// other turn is checked change by change, and a change that no longer applies is listed, never
// dropped silently. Nothing here throws on a change, and nothing refuses one.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { RevisionId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import { apartHost, applyEvent, applyMarker, tiesOf, TIED_DROP, validateEvent, validMarkerBody } from "../engine/events";
import type { ReadContext } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { initialState } from "../engine/world-state";
import { STORE_OPS, type Lane, type NotApplied, type Report, type StoreState } from "./types";

/** What a fold reads besides the changes: the engine's registry, and world documents by revision. */
export interface FoldEnv {
  registry: Registry;
  worlds: (revision: RevisionId) => WorldDoc | undefined;
}

/** A change as the fold reads it. */
export interface StoredChange {
  id: number;
  op: string;
  lane: Lane;
  value: JsonValue;
  by: string | null;
  /** Whether it applied when it was recorded, on its own path. */
  applied: boolean;
}

/** One turn of a path to fold. */
export interface FoldStep {
  node: string;
  turn: string;
  /** Its number on the path (1 for the first turn). */
  n: number;
  /** Whether this node is the one the turn was made on. */
  own: boolean;
  changes: readonly StoredChange[];
}

/** What applying one change came to. */
export interface Outcome {
  applied: boolean;
  reports: Report[];
}

/** One change to apply, with what the fold keeps beside the state. */
export interface Item {
  op: string;
  value: JsonValue;
  turn: string;
  n: number;
  by: string | null;
}

/** The state a chat starts from: the world revision's own, as today's engine builds it. */
export function initialStoreState(env: FoldEnv, revision: RevisionId): StoreState | null {
  const world = env.worlds(revision);
  if (!world) return null;
  return { world: initialState(world, revision, env.registry), horizon: [], notes: {}, touched: {} };
}

const isStoreOp = (op: string): boolean => op.startsWith("store.");

/** The event a change carries, or null for a store operation or a value that is not one. */
export function eventOf(op: string, value: JsonValue): LedgerEvent | null {
  if (isStoreOp(op) || !isRecord(value) || value.type !== op) return null;
  return value as unknown as LedgerEvent;
}

function failed(e: unknown): Report {
  return { code: "failed", text: `its handler failed: ${e instanceof Error ? e.message : String(e)}` };
}

const noWorld = (revision: string): Report => ({ code: "unknown_revision", text: `the world revision ${revision} is not available` });

/**
 * One read context per state, as today's `Working` keeps one while it applies event after event:
 * the context reads the state it was made over, which the fold changes in place, and reads the world
 * as the chat plays it again whenever that changes. A change of the revision in force makes a new one.
 */
const contexts = new WeakMap<WorldState, { env: FoldEnv; revision: string; ctx: ReadContext }>();

function contextOf(env: FoldEnv, world: WorldState): ReadContext | null {
  const kept = contexts.get(world);
  if (kept && kept.env === env && kept.revision === world.revision) return kept.ctx;
  const doc = env.worlds(world.revision);
  if (!doc) return null;
  const ctx = env.registry.context(doc, world);
  contexts.set(world, { env, revision: world.revision, ctx });
  return ctx;
}

/** Keeps which turn last touched what an applied event declares it writes (`touches`), and the world for time. */
function markTouched(env: FoldEnv, state: StoreState, ev: LedgerEvent, item: Item): void {
  const mark = { turn: item.turn, n: item.n };
  if (ev.type === "clock" || ev.type === "timelapse") state.touched.world = mark;
  const touches = env.registry.get(ev.type)?.touches?.(ev) ?? [];
  for (const t of touches) state.touched[`entity:${t.entity}`] = mark;
}

/** Applies one event with today's reducer, without checking it; a reducer that throws is reported. */
function applyOne(env: FoldEnv, state: StoreState, ev: LedgerEvent, item: Item): Outcome {
  const ctx = contextOf(env, state.world);
  if (!ctx) return { applied: false, reports: [noWorld(state.world.revision)] };
  try {
    applyEvent(env.registry, ev, state.world, ctx);
  } catch (e) {
    return { applied: false, reports: [failed(e)] };
  }
  markTouched(env, state, ev, item);
  return { applied: true, reports: [] };
}

/** Whether an event may apply to this state, by today's validator (its type's own check and every pack's guard). */
function checkOne(env: FoldEnv, world: WorldState, ev: LedgerEvent): Report | null {
  const ctx = contextOf(env, world);
  if (!ctx) return noWorld(world.revision);
  try {
    const r = validateEvent(env.registry, ev, ctx);
    // The store's readers are the Author, the GM and the user: the reason that names everyone.
    return r ? { code: r.code, text: r.gm ?? r.reason } : null;
  } catch (e) {
    return failed(e);
  }
}

/** Whether a unit applies whole, tried on a copy as today's fold tries one: the first reason it does not, or null. */
function trial(env: FoldEnv, state: StoreState, unit: readonly LedgerEvent[]): Report | null {
  const scratch = structuredClone(state.world);
  for (const ev of unit) {
    const found = checkOne(env, scratch, ev);
    if (found) return found;
    const ctx = contextOf(env, scratch);
    if (!ctx) return noWorld(scratch.revision);
    try {
      applyEvent(env.registry, ev, scratch, ctx);
    } catch (e) {
      return failed(e);
    }
  }
  return null;
}

/** Applies a store operation; its shape was checked when it was recorded. */
function applyStoreOp(env: FoldEnv, state: StoreState, item: Item): Outcome {
  const v = isRecord(item.value) ? item.value : {};
  switch (item.op) {
    case STORE_OPS.horizon:
      state.horizon = Array.isArray(v.list) ? v.list.filter((x): x is string => typeof x === "string") : [];
      return { applied: true, reports: [] };
    case STORE_OPS.note: {
      const at = typeof v.at === "string" ? v.at : "";
      const text = typeof v.text === "string" ? v.text : "";
      if (text === "") delete state.notes[at];
      else state.notes[at] = { text, by: item.by, turn: item.turn };
      return { applied: true, reports: [] };
    }
    case STORE_OPS.marker: {
      const body = validMarkerBody(item.value);
      if (!body) return { applied: false, reports: [{ code: "bad_marker", text: "not a marker" }] };
      if (body.kind === "migrate" && !env.worlds(body.to)) return { applied: false, reports: [noWorld(body.to)] };
      try {
        const notes = applyMarker(state.world, body, { worlds: env.worlds, types: env.registry });
        state.touched.world = { turn: item.turn, n: item.n };
        return { applied: true, reports: notes.map((text) => ({ code: "note", text })) };
      } catch (e) {
        return { applied: false, reports: [failed(e)] };
      }
    }
    default:
      return { applied: false, reports: [{ code: "no_handler", text: `nothing applies ${item.op}` }] };
  }
}

/** Applies changes as they were recorded: each one that applied then, unchecked. */
export function applyUnchecked(env: FoldEnv, state: StoreState, items: readonly Item[]): Outcome[] {
  return items.map((item) => {
    const ev = eventOf(item.op, item.value);
    if (ev) return applyOne(env, state, ev, item);
    return isStoreOp(item.op) ? applyStoreOp(env, state, item) : { applied: false, reports: [{ code: "no_handler", text: `${item.op} carries no event` }] };
  });
}

/**
 * Applies changes checked one by one with today's validators, in order. A run of events that share
 * a group is one unit and lands whole or not at all; a unit kept apart lands only with the unit it
 * stands with; a unit tied to one that did not land does not land either (today's rules, with
 * today's helpers). `fell` holds the groups that did not land so far in the turn, and grows.
 */
export function applyChecked(env: FoldEnv, state: StoreState, items: readonly Item[], fell: Set<string>): Outcome[] {
  const out: Outcome[] = new Array(items.length);
  let i = 0;
  while (i < items.length) {
    const item = items[i] as Item;
    if (!eventOf(item.op, item.value)) {
      out[i] = isStoreOp(item.op) ? applyStoreOp(env, state, item) : { applied: false, reports: [{ code: "no_handler", text: `${item.op} carries no event` }] };
      i++;
      continue;
    }
    // A run of events between store operations: today's unit rules hold inside it.
    let end = i;
    while (end < items.length && eventOf((items[end] as Item).op, (items[end] as Item).value)) end++;
    runEvents(env, state, items, i, end, fell, out);
    i = end;
  }
  return out;
}

function runEvents(env: FoldEnv, state: StoreState, items: readonly Item[], from: number, to: number, fell: Set<string>, out: Outcome[]): void {
  const events = items.slice(from, to).map((x) => eventOf(x.op, x.value) as LedgerEvent);
  const drop = (start: number, end: number, report: Report): void => {
    for (let k = start; k < end; k++) out[from + k] = { applied: false, reports: [report] };
    const group = events[start]?.group;
    if (group !== undefined && end > start) fell.add(group);
  };
  const land = (start: number, end: number): void => {
    for (let k = start; k < end; k++) out[from + k] = applyOne(env, state, events[k] as LedgerEvent, items[from + k] as Item);
  };
  let k = 0;
  while (k < events.length) {
    const group = events[k]?.group;
    let end = k + 1;
    if (group !== undefined) while (end < events.length && events[end]?.group === group) end++;
    const host = apartHost(events, [k, end]);
    if (host) {
      const together = trial(env, state, events.slice(k, host[1]));
      if (together === null) land(k, host[1]);
      else {
        drop(k, end, together);
        const alone = trial(env, state, events.slice(host[0], host[1]));
        if (alone === null) land(host[0], host[1]);
        else drop(host[0], host[1], alone);
      }
      k = host[1];
      continue;
    }
    const unit = events.slice(k, end);
    if (tiesOf(unit).some((t) => fell.has(t))) drop(k, end, { code: "tied", text: TIED_DROP });
    else if (unit.length === 1) {
      const found = checkOne(env, state.world, unit[0] as LedgerEvent);
      if (found) drop(k, end, found);
      else land(k, end);
    } else {
      const found = trial(env, state, unit);
      if (found) drop(k, end, found);
      else land(k, end);
    }
    k = end;
  }
}

/** What folding a path came to. `upto` is the newest change id folded in. */
export interface FoldResult {
  state: StoreState;
  upto: number;
  notApplied: NotApplied[];
  rebased: string[];
}

/**
 * Folds `steps` onto `start` (whose state it changes: pass a copy of anything shared). `start.upto`
 * is the newest change id already folded into the start. `visit` sees each step's state, with what
 * did not apply and what stood rebased so far.
 */
export function foldSteps(env: FoldEnv, start: { state: StoreState; upto: number }, steps: readonly FoldStep[], visit?: (step: FoldStep, state: StoreState, upto: number, notApplied: readonly NotApplied[], rebased: readonly string[]) => void): FoldResult {
  const state = start.state;
  let upto = start.upto;
  const notApplied: NotApplied[] = [];
  const rebased: string[] = [];
  for (const step of steps) {
    if (!step.own) rebased.push(step.turn);
    const first = step.changes[0]?.id ?? Number.POSITIVE_INFINITY;
    // Recorded on this very path, after everything before it: it folds as it was recorded.
    const clean = step.own && upto < first;
    const live = step.changes.filter((c) => c.applied);
    const items = live.map((c): Item => ({ op: c.op, value: c.value, turn: step.turn, n: step.n, by: c.by }));
    const outcomes = clean ? applyUnchecked(env, state, items) : applyChecked(env, state, items, new Set());
    outcomes.forEach((o, k) => {
      const c = live[k];
      if (!o.applied && c) notApplied.push({ change: c.id, turn: step.turn, op: c.op, lane: c.lane, reason: o.reports.map((r) => r.text).join("; ") });
    });
    for (const c of step.changes) if (c.id > upto) upto = c.id;
    visit?.(step, state, upto, notApplied, rebased);
  }
  return { state, upto, notApplied, rebased };
}
