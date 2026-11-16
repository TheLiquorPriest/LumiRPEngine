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
import { apartHost, applyEvent, applyMarker, tiesOf, validateEvent, validMarkerBody } from "../engine/events";
import type { ReadContext, Touch } from "../engine/registry";
import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { forgetWhereabouts } from "../engine/whereabouts";
import { initialState } from "../engine/world-state";
import { CLOCK_SET, setsClock } from "./blank";
import { applyFact } from "./facts";
import { PRECISIONS, STORE_OPS, type Lane, type NotApplied, type Precision, type Report, type Source, type Standing, type StoreState } from "./types";
import { claim, knownWrites, thawWorld, tryUnit } from "./working";
import type { AreaOutcome, AreaPart, Areas } from "./areas";

/** A handler that threw while a change applied: the change's turn, and its id once it is kept (null before). */
export interface FoldFailure {
  op: string;
  error: unknown;
  turn: string;
  change: number | null;
}

/** What a fold reads besides the changes: the engine's registry, world documents by revision, and the areas the store opened with. */
export interface FoldEnv {
  registry: Registry;
  worlds: (revision: RevisionId) => WorldDoc | undefined;
  /** The areas whose operations (`<area>.<op>`) fold beside the engine's; none: no area's. */
  areas?: Areas;
  /**
   * Told when an engine handler, or a pack's code the fold calls (its read context, what its event touches), throws: an error in the
   * engine, whose text is for people (the log, the live view), never for a model.
   */
  failed?: (failure: FoldFailure) => void;
}

/** How a change came to be, as its row records it: how exact, how sure, from where. Absent: none given. */
export interface Provenance {
  precision?: Precision | null;
  standing?: Standing | null;
  source?: Source | null;
}

/** A change as the fold reads it. */
export interface StoredChange extends Provenance {
  id: number;
  op: string;
  lane: Lane;
  value: JsonValue;
  by: string | null;
  /** What its source cites; absent: none. */
  cite?: JsonValue | null;
  /** Whether it applied when it was recorded, on its own path. */
  applied: boolean;
}

/** A job's change, with the turn that started the job: recorded with that turn, it takes effect later (plan §10.9). */
export interface JobChange extends StoredChange {
  turn: string;
  /** The number on the path of the turn that started the job. */
  from: number;
}

/** His own change (plan §6.3 l.632): of no turn, kept with its chat and the moment it took effect (a job of his: when the job ended). */
export interface OwnerChange extends StoredChange {
  chat: string;
  at: number;
  /** One written again after an import forgot its chat (`restoreOwn`): the depth of its chat's turn it stands just before; null: placed by `at`. */
  placed: number | null;
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
  /** Jobs' changes that take effect just before this turn: the first on the path to begin after their job ended. */
  jobs?: readonly JobChange[];
  /** His own changes that take effect just before this turn, after the jobs': the first on his chat's path to begin after each. */
  owner?: readonly OwnerChange[];
}

/**
 * Applies his own changes where they take effect (before the turn numbered `n`, or after a path's end), each checked as any change
 * placed anew is; what did not apply, listed. They belong to no turn: their marks name none.
 */
export function applyOwner(env: FoldEnv, state: StoreState, owner: readonly OwnerChange[], n: number): NotApplied[] {
  const items = owner.map((c): Item => ({ op: c.op, value: c.value, turn: "", n, by: c.by, cite: c.cite ?? null, change: c.id, precision: c.precision ?? null, standing: c.standing ?? null, source: c.source ?? null }));
  const out: NotApplied[] = [];
  applyChecked(env, state, items, new Set()).forEach((o, k) => {
    const c = owner[k];
    if (!o.applied && c) out.push(notAppliedOf(env, c, "", o.reports));
  });
  return out;
}

/** What applying one change came to. */
export interface Outcome {
  applied: boolean;
  reports: Report[];
}

/** One change to apply, with what the fold keeps beside the state. */
export interface Item extends Provenance {
  op: string;
  value: JsonValue;
  turn: string;
  n: number;
  by: string | null;
  cite?: JsonValue | null;
  /** The change's id once it is kept; null (or absent) before. */
  change?: number | null;
}

/** The state a chat starts from: the world revision's own, as today's engine builds it, and each area's starting slice. */
export function initialStoreState(env: FoldEnv, revision: RevisionId): StoreState | null {
  const world = env.worlds(revision);
  if (!world) return null;
  const state: StoreState = { world: initialState(world, revision, env.registry), horizon: [], notes: {}, touched: {}, marks: {}, facts: {} };
  const areas = env.areas?.initial();
  if (areas && Object.keys(areas).length > 0) state.areas = areas;
  return state;
}

const isStoreOp = (op: string): boolean => op.startsWith("store.");

/** The event a change carries, or null for a store operation or a value that is not one. */
export function eventOf(op: string, value: JsonValue): LedgerEvent | null {
  if (isStoreOp(op) || !isRecord(value) || value.type !== op) return null;
  return value as unknown as LedgerEvent;
}

/** A handler, or a pack's code the fold calls, that threw: the error goes to whoever keeps the log; the report says only that it failed. */
function failed(env: FoldEnv, op: string, error: unknown, item: Pick<Item, "turn" | "change">): Report {
  env.failed?.({ op, error, turn: item.turn, change: item.change ?? null });
  return { code: "failed" };
}

/**
 * The tracks a marker set back (an Upgrade to a revision that no longer has the stage one was at), as
 * data: today's marker code journals the same in its own words, for public tracks only.
 */
function tracksReset(env: FoldEnv, was: RevisionId, world: WorldState, stages: Readonly<Record<string, string>>): Report[] {
  const before = env.worlds(was);
  const after = env.worlds(world.revision);
  const out: Report[] = [];
  for (const [id, t] of Object.entries(world.tracks)) {
    const from = stages[id];
    if (from === undefined || from === t.stage) continue;
    const def = after ? own(after.tracks, id) : undefined;
    const old = before ? own(before.tracks, id) : undefined;
    out.push({ code: "track_reset", values: { track: id, label: def?.label ?? id, from: (old ? own(old.stages, from)?.label : undefined) ?? from, to: (def ? own(def.stages, t.stage)?.label : undefined) ?? t.stage } });
  }
  return out;
}

const noWorld = (revision: string): Report => ({ code: "unknown_revision", values: { revision } });

const noHandler = (op: string): Report => ({ code: "no_handler", values: { op } });

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

/** The least exact of two precisions; one not given leaves the other. */
function lessExact(a: Precision | null, b: Precision | null): Precision | null {
  if (a === null) return b;
  if (b === null) return a;
  return PRECISIONS.indexOf(a) >= PRECISIONS.indexOf(b) ? a : b;
}

/**
 * Whether a change is an invention with no gap check or no consent (plan §10.5): its source `invented`, its cite naming no gap check,
 * or saying no one consented (`consent_by: none`).
 */
export function inventedUnchecked(source: Source | null | undefined, cite: JsonValue | null | undefined): boolean {
  if (source !== "invented") return false;
  const c = isRecord(cite) ? cite : {};
  return typeof c.gap_check !== "string" || c.gap_check === "" || c.consent_by === "none";
}

/**
 * The tree refs a change is about: the entities its event touches, an area operation's parts, a fact's or a note's level, the world
 * for a world value or a marker. None where a pack's code that says so throws (the fold reports that fault where it applies).
 */
export function aboutOf(env: Pick<FoldEnv, "registry" | "areas">, op: string, value: JsonValue): string[] {
  const v = isRecord(value) ? value : {};
  try {
    const area = env.areas?.of(op);
    if (area) return [...new Set((area.def.touches?.(value) ?? []).map((p) => p.ref))];
    if (op === STORE_OPS.fact) return typeof v.about === "string" ? [v.about] : [];
    if (op === STORE_OPS.note) return typeof v.at === "string" ? [v.at] : [];
    if (op === STORE_OPS.value || op === STORE_OPS.marker) return ["world"];
    const ev = eventOf(op, value);
    return ev ? [...new Set((env.registry.get(ev.type)?.touches?.(ev) ?? []).map((t) => `entity:${t.entity}`))] : [];
  } catch {
    return [];
  }
}

/** What did not apply of a stored change, named by its thing and its value. */
export function notAppliedOf(env: Pick<FoldEnv, "registry" | "areas">, c: Pick<StoredChange, "id" | "op" | "lane" | "value">, turn: string, reports: Report[]): NotApplied {
  return { change: c.id, turn, op: c.op, lane: c.lane, reports, about: aboutOf(env, c.op, c.value), value: c.value };
}

/**
 * Keeps which turn last touched what an applied event declares it writes (`touches`), and the world
 * when it moved the clock; and, for each part it writes (a field, a relation type, an aspect, the
 * world's time), the change that wrote it last. A move of the clock that states the date and time it
 * reaches (`settingClock`) is marked as the one that last set it, too. A balance sums every posting
 * into it, so its precision is the least exact of them. Each record it writes is a new one: the
 * state's records may be another state's too.
 */
function markTouched(state: StoreState, touches: readonly Touch[], item: Item, clockMoved: boolean): void {
  const mark = { turn: item.turn, n: item.n };
  const provenance = { standing: item.standing ?? null, source: item.source ?? null, ...(inventedUnchecked(item.source, item.cite) ? { unchecked: true as const } : {}) };
  if (clockMoved) {
    state.touched.world = mark;
    const time = { ...mark, precision: item.precision ?? null, ...provenance };
    state.marks.world = { ...state.marks.world, time, ...(setsClock(item.value) ? { [CLOCK_SET]: { ...time } } : {}) };
  }
  for (const t of touches) {
    const ref = `entity:${t.entity}`;
    state.touched[ref] = mark;
    const name = "field" in t ? t.field : "rel" in t ? t.rel : t.aspect;
    const marks = state.marks[ref];
    const precision = item.precision ?? null;
    state.marks[ref] = { ...marks, [name]: { ...mark, precision: name === "posted" ? lessExact(marks?.[name]?.precision ?? null, precision) : precision, ...provenance } };
  }
}

/** What applying one event came to, its marks not kept yet: why it did not apply, or what it touches and whether the clock moved. */
type Applied = { report: Report } | { touches: readonly Touch[]; clockMoved: boolean };

/**
 * Applies one event with today's reducer, without checking it. Every call into the event's pack is guarded as the reducer is: the read
 * context made, what the event touches, the reducer itself. One that throws leaves the change not applied, reported as failed. What
 * the event writes is made the state's own first (`claim`).
 */
function applyEv(env: FoldEnv, state: StoreState, ev: LedgerEvent, item: Item): Applied {
  let ctx: ReadContext | null;
  let touches: readonly Touch[];
  try {
    ctx = contextOf(env, state.world);
    touches = env.registry.get(ev.type)?.touches?.(ev) ?? [];
  } catch (e) {
    return { report: failed(env, ev.type, e, item) };
  }
  if (!ctx) return { report: noWorld(state.world.revision) };
  claim(state.world, ev);
  const clock = state.world.clock;
  try {
    applyEvent(env.registry, ev, state.world, ctx);
  } catch (e) {
    return { report: failed(env, ev.type, e, item) };
  }
  return { touches, clockMoved: state.world.clock !== clock };
}

/** Applies one event with today's reducer, without checking it, and keeps its marks; a handler that throws is reported. */
function applyOne(env: FoldEnv, state: StoreState, ev: LedgerEvent, item: Item): Outcome {
  const a = applyEv(env, state, ev, item);
  if ("report" in a) return { applied: false, reports: [a.report] };
  markTouched(state, a.touches, item, a.clockMoved);
  return { applied: true, reports: [] };
}

/** Whether an event may apply to this state, by today's validator (its type's own check and every pack's guard). */
function checkOne(env: FoldEnv, world: WorldState, ev: LedgerEvent, item: Item): Report | null {
  try {
    const ctx = contextOf(env, world);
    if (!ctx) return noWorld(world.revision);
    const r = validateEvent(env.registry, ev, ctx);
    return r ? { code: r.code } : null;
  } catch (e) {
    return failed(env, ev.type, e, item);
  }
}

/** Whether a unit applies whole, tried on a copy of the world as today's fold tries one: the first reason it does not, or null. */
function trialOnCopy(env: FoldEnv, state: StoreState, unit: readonly LedgerEvent[], items: readonly Item[]): Report | null {
  const scratch = structuredClone(state.world);
  for (const [k, ev] of unit.entries()) {
    const item = items[k] as Item;
    const found = checkOne(env, scratch, ev, item);
    if (found) return found;
    try {
      const ctx = contextOf(env, scratch);
      if (!ctx) return noWorld(scratch.revision);
      applyEvent(env.registry, ev, scratch, ctx);
    } catch (e) {
      return failed(env, ev.type, e, item);
    }
  }
  return null;
}

/**
 * Lands a unit whole or not at all, each event checked by today's validator on the state the events before it left. Where the store
 * knows what its events write, it is tried on the state itself, and kept where it lands (`tryUnit`); else it is tried on a copy of the
 * world and then applied. Null when it landed, with each event's outcome in `out` from `at`; else the first reason it did not, and
 * every part of the state is as it was.
 */
function landUnit(env: FoldEnv, state: StoreState, unit: readonly LedgerEvent[], items: readonly Item[], out: Outcome[], at: number): Report | null {
  if (!knownWrites(unit)) {
    const found = trialOnCopy(env, state, unit, items);
    if (found) return found;
    unit.forEach((ev, k) => {
      out[at + k] = applyOne(env, state, ev, items[k] as Item);
    });
    return null;
  }
  const applied: Extract<Applied, { touches: readonly Touch[] }>[] = [];
  const found = tryUnit(state.world, (): Report | null => {
    for (const [k, ev] of unit.entries()) {
      const item = items[k] as Item;
      const report = checkOne(env, state.world, ev, item);
      if (report) return report;
      const a = applyEv(env, state, ev, item);
      if ("report" in a) return a.report;
      applied.push(a);
    }
    return null;
  });
  if (found) return found;
  applied.forEach((a, k) => {
    markTouched(state, a.touches, items[k] as Item, a.clockMoved);
    out[at + k] = { applied: true, reports: [] };
  });
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
      if (!body) return { applied: false, reports: [{ code: "bad_marker" }] };
      if (body.kind === "migrate" && !env.worlds(body.to)) return { applied: false, reports: [noWorld(body.to)] };
      const was = state.world.revision;
      const stages = Object.fromEntries(Object.entries(state.world.tracks).map(([id, t]) => [id, t.stage]));
      // A marker may write anything of the world, and move anyone.
      thawWorld(state.world);
      try {
        applyMarker(state.world, body, { worlds: env.worlds, types: env.registry });
      } catch (e) {
        return { applied: false, reports: [failed(env, item.op, e, item)] };
      } finally {
        forgetWhereabouts(state.world);
      }
      state.touched.world = { turn: item.turn, n: item.n };
      return { applied: true, reports: tracksReset(env, was, state.world, stages) };
    }
    case STORE_OPS.fact: {
      const reports = applyFact(state, item.value, { turn: item.turn, n: item.n, by: item.by, precision: item.precision ?? null, standing: item.standing ?? null, source: item.source ?? null });
      const about = typeof v.about === "string" ? v.about : "";
      if (about !== "") state.touched[about] = { turn: item.turn, n: item.n };
      return { applied: true, reports };
    }
    case STORE_OPS.value: {
      const key = typeof v.key === "string" ? v.key : "";
      const values = { ...state.values };
      if (v.value === null || v.value === undefined) delete values[key];
      else values[key] = v.value;
      state.values = values;
      markParts(state, [{ ref: "world", part: key }], item);
      return { applied: true, reports: [] };
    }
    default:
      return { applied: false, reports: [noHandler(item.op)] };
  }
}

/** Keeps, for each part a change wrote, the turn that wrote it last and how (as `markTouched` keeps an event's). */
function markParts(state: StoreState, parts: readonly AreaPart[], item: Item): void {
  const mark = { turn: item.turn, n: item.n };
  const unchecked = inventedUnchecked(item.source, item.cite) ? { unchecked: true as const } : {};
  for (const { ref, part } of parts) {
    state.touched[ref] = mark;
    state.marks[ref] = { ...state.marks[ref], [part]: { ...mark, precision: item.precision ?? null, standing: item.standing ?? null, source: item.source ?? null, ...unchecked } };
  }
}

/**
 * Applies an area's operation (`<area>.<op>`) by its area's reducer, to the area's slice: a new slice in its place, the parts it
 * touches marked. One that no longer applies is reported as its area says; a reducer, or what it touches, that throws is a fault.
 */
function applyAreaOp(env: FoldEnv, state: StoreState, item: Item): Outcome {
  const found = env.areas?.of(item.op);
  if (!found) return { applied: false, reports: [noHandler(item.op)] };
  const { area, name, def } = found;
  const slice = state.areas?.[area.id] ?? area.initial?.() ?? {};
  let parts: readonly AreaPart[];
  let outcome: AreaOutcome;
  try {
    parts = def.touches?.(item.value) ?? [];
    outcome = def.apply(slice, { op: name, value: item.value, turn: item.turn, n: item.n, by: item.by, standing: item.standing ?? null, precision: item.precision ?? null, source: item.source ?? null, cite: item.cite ?? null });
  } catch (e) {
    return { applied: false, reports: [failed(env, item.op, e, item)] };
  }
  if ("applied" in outcome) return { applied: false, reports: outcome.reports };
  state.areas = { ...state.areas, [area.id]: outcome.slice };
  markParts(state, parts, item);
  return { applied: true, reports: outcome.reports ?? [] };
}

/** The event a change carries; null for a store operation, an area's, or a value that is not one. */
function eventIn(env: FoldEnv, item: Pick<Item, "op" | "value">): LedgerEvent | null {
  return env.areas?.owns(item.op) ? null : eventOf(item.op, item.value);
}

/** Applies a change that is no engine event: a store operation, or an area's. */
function applyOther(env: FoldEnv, state: StoreState, item: Item): Outcome {
  if (isStoreOp(item.op)) return applyStoreOp(env, state, item);
  if (env.areas?.owns(item.op)) return applyAreaOp(env, state, item);
  return { applied: false, reports: [noHandler(item.op)] };
}

/** Applies changes as they were recorded: each one that applied then, unchecked. */
export function applyUnchecked(env: FoldEnv, state: StoreState, items: readonly Item[]): Outcome[] {
  return items.map((item) => {
    const ev = eventIn(env, item);
    return ev ? applyOne(env, state, ev, item) : applyOther(env, state, item);
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
    if (!eventIn(env, item)) {
      out[i] = applyOther(env, state, item);
      i++;
      continue;
    }
    // A run of events between store and area operations: today's unit rules hold inside it.
    let end = i;
    while (end < items.length && eventIn(env, items[end] as Item)) end++;
    runEvents(env, state, items, i, end, fell, out);
    i = end;
  }
  return out;
}

function runEvents(env: FoldEnv, state: StoreState, items: readonly Item[], from: number, to: number, fell: Set<string>, out: Outcome[]): void {
  const events = items.slice(from, to).map((x) => eventIn(env, x) as LedgerEvent);
  const drop = (start: number, end: number, report: Report): void => {
    for (let k = start; k < end; k++) out[from + k] = { applied: false, reports: [report] };
    const group = events[start]?.group;
    if (group !== undefined && end > start) fell.add(group);
  };
  const unitAt = (start: number, end: number): Report | null => landUnit(env, state, events.slice(start, end), items.slice(from + start, from + end), out, from + start);
  let k = 0;
  while (k < events.length) {
    const group = events[k]?.group;
    let end = k + 1;
    if (group !== undefined) while (end < events.length && events[end]?.group === group) end++;
    const host = apartHost(events, [k, end]);
    if (host) {
      const together = unitAt(k, host[1]);
      if (together !== null) {
        drop(k, end, together);
        const alone = unitAt(host[0], host[1]);
        if (alone !== null) drop(host[0], host[1], alone);
      }
      k = host[1];
      continue;
    }
    const unit = events.slice(k, end);
    if (tiesOf(unit).some((t) => fell.has(t))) drop(k, end, { code: "tied" });
    else if (unit.length === 1) {
      const item = items[from + k] as Item;
      const found = checkOne(env, state.world, unit[0] as LedgerEvent, item);
      if (found) drop(k, end, found);
      else out[from + k] = applyOne(env, state, unit[0] as LedgerEvent, item);
    } else {
      const found = unitAt(k, end);
      if (found) drop(k, end, found);
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
 * The last change on record that wrote one of the parts a job's change writes, when a turn after the job's own wrote it: its value
 * stands. A pack that throws while what its event touches is read leaves the change failed, by its report.
 */
function laterWrite(env: FoldEnv, state: StoreState, c: JobChange): number | null | Report {
  const ev = eventIn(env, c);
  const area = env.areas?.of(c.op) ?? null;
  const touched: { ref: string; part: string }[] = [];
  if (ev) {
    let touches: readonly Touch[];
    try {
      touches = env.registry.get(ev.type)?.touches?.(ev) ?? [];
    } catch (e) {
      return failed(env, ev.type, e, { turn: c.turn, change: c.id });
    }
    for (const t of touches) touched.push({ ref: `entity:${t.entity}`, part: "field" in t ? t.field : "rel" in t ? t.rel : t.aspect });
  } else if (area !== null) {
    try {
      touched.push(...(area.def.touches?.(c.value) ?? []));
    } catch (e) {
      return failed(env, c.op, e, { turn: c.turn, change: c.id });
    }
  } else if (c.op === STORE_OPS.fact && isRecord(c.value)) {
    const { about, key } = c.value;
    const later = (state.facts[String(about)] ?? []).filter((f) => f.key === key && f.replacedBy === undefined && f.n > c.from);
    return later.length > 0 ? Math.max(...later.map((f) => f.n)) : null;
  }
  let latest: number | null = null;
  for (const { ref, part } of touched) {
    const n = state.marks[ref]?.[part]?.n;
    if (n !== undefined && n > c.from && (latest === null || n > latest)) latest = n;
  }
  return latest;
}

/**
 * Applies jobs' changes where they take effect, just before a turn (plan §10.9). A unit of them that
 * a turn since the job's own has written a part of does not apply: the later value stands, and the
 * report says which turn wrote it. The rest are checked as any change placed anew is, and are marked
 * as the job's own turn's, so a job's later change is never taken for a later turn's.
 */
function applyJobs(env: FoldEnv, state: StoreState, jobs: readonly JobChange[]): Outcome[] {
  const out: Outcome[] = new Array(jobs.length);
  const unitOf = (c: JobChange): string => (isRecord(c.value) && typeof c.value.group === "string" ? `g:${c.value.group}` : `c:${c.id}`);
  const later = new Map<string, number>();
  const faulted = new Map<number, Report>();
  for (const c of jobs) {
    const at = laterWrite(env, state, c);
    if (typeof at === "object" && at !== null) faulted.set(c.id, at);
    else if (at !== null) later.set(unitOf(c), Math.max(at, later.get(unitOf(c)) ?? at));
  }
  const go: { k: number; item: Item }[] = [];
  jobs.forEach((c, k) => {
    const at = later.get(unitOf(c));
    const fault = faulted.get(c.id);
    if (fault) out[k] = { applied: false, reports: [fault] };
    else if (at !== undefined) out[k] = { applied: false, reports: [{ code: "later_value", values: { turn: at } }] };
    else go.push({ k, item: { op: c.op, value: c.value, turn: c.turn, n: c.from, by: c.by, cite: c.cite ?? null, change: c.id, precision: c.precision ?? null, standing: c.standing ?? null, source: c.source ?? null } });
  });
  applyChecked(env, state, go.map((g) => g.item), new Set()).forEach((o, i) => {
    const k = go[i]?.k;
    if (k !== undefined) out[k] = o;
  });
  return out;
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
    const jobs = step.jobs ?? [];
    if (jobs.length > 0) {
      applyJobs(env, state, jobs).forEach((o, k) => {
        const c = jobs[k];
        if (!o.applied && c) notApplied.push(notAppliedOf(env, c, c.turn, o.reports));
      });
      for (const c of jobs) if (c.id > upto) upto = c.id;
    }
    const owner = step.owner ?? [];
    if (owner.length > 0) {
      notApplied.push(...applyOwner(env, state, owner, step.n));
      for (const c of owner) if (c.id > upto) upto = c.id;
    }
    const first = step.changes[0]?.id ?? Number.POSITIVE_INFINITY;
    // Recorded on this very path, after everything before it: it folds as it was recorded.
    const clean = step.own && upto < first;
    const live = step.changes.filter((c) => c.applied);
    const items = live.map((c): Item => ({ op: c.op, value: c.value, turn: step.turn, n: step.n, by: c.by, cite: c.cite ?? null, change: c.id, precision: c.precision ?? null, standing: c.standing ?? null, source: c.source ?? null }));
    const outcomes = clean ? applyUnchecked(env, state, items) : applyChecked(env, state, items, new Set());
    outcomes.forEach((o, k) => {
      const c = live[k];
      if (!o.applied && c) notApplied.push(notAppliedOf(env, c, step.turn, o.reports));
    });
    for (const c of step.changes) if (c.id > upto) upto = c.id;
    visit?.(step, state, upto, notApplied, rebased);
  }
  return { state, upto, notApplied, rebased };
}
