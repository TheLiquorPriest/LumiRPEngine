// The write path every engine tool shares. A call's operations are worked out in order on a working
// copy of the state at its turn, by today's own engine (its item ops, effects, moves and handlers),
// each operation's events kept apart; then everything is recorded in one write through the queue,
// each change with its lane and provenance. The answer says what changed (each touched thing as it
// was and as it is now), what it now looks like in the tree, and any reports.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { hashParts } from "../shared/hash";
import type { DomainId, EntityId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { FINANCE_EVENTS } from "../shared/finance";
import { formatMoney, type PlaceDef, type WorldDoc } from "../shared/world";
import { calendarOf, formatClock } from "../engine/calendar";
import { materializeIfNeeded } from "../engine/materialize";
import { own } from "../engine/pack-kit";
import { playedWorld } from "../engine/places-in-play";
import type { Advice, Rejection } from "../engine/registry";
import type { EntityState, WorldState } from "../engine/state";
import { Working } from "../engine/working";
import { clockRecorded } from "../store/blank";
import { type ChangeInput, type ChangeRow, JoinedTurnError, type Lane, StoreInputError, type StoreState } from "../store/types";
import type { TreeView } from "../store/view";
import type { Call, KeptReport, Reply } from "./kit";
import { fromNow } from "./ops-time";
import { Reading, type Unreadable } from "./reading";
import { citeOf, FILLED_IN, type Provenance, provenanceData } from "./source";
import type { Lines } from "./texts";

/** One piece of advice kept with an operation: a code with values, and the change (an index into the draft's inputs) it advised on. */
export interface AdviceKept {
  code: string;
  values?: Record<string, JsonValue>;
  input: number;
}

/** One operation's part of a draft: what it is, its lane and provenance, and where its changes sit among the draft's. */
export interface Recorded {
  n: number;
  op: string;
  lane: Lane;
  prov: Provenance;
  /** Indexes into the draft's inputs. */
  inputs: number[];
  /** What the engine advised on its changes: the events applied all the same. */
  advice: AdviceKept[];
  /** The reports its work made, as data with their words (`Reply.kept`), for the store to keep with its changes and list as unsettled. */
  reports: KeptReport[];
  /** What the operation made, by id: a spawned person or thing. */
  made?: string;
}

/**
 * Whether the event at `i` is the economy's bookkeeping for a party it keeps no accounts for
 * (`l1Move`): the band and typical worth that party's money is taken to start from (an anchor, at
 * the world's default band where nothing gives one), and the band a payment moves it to, set right
 * after its anchor. The engine works both out from the world's tables; no call says either.
 */
export function bookkeeping(events: readonly LedgerEvent[], i: number): boolean {
  const ev = events[i];
  if (ev === undefined) return false;
  if (ev.type === FINANCE_EVENTS.anchor) return true;
  const anchor = events[i - 1];
  return ev.type === "set" && ev.field === "wealth" && anchor !== undefined && anchor.type === FINANCE_EVENTS.anchor && "data" in anchor && anchor.data.entity === ev.entity && anchor.data.band === ev.value;
}

/** A call's operations worked out on a copy of the state, before anything is recorded. */
export class Draft {
  readonly w: Working;
  readonly inputs: ChangeInput[] = [];
  readonly recorded: Recorded[] = [];
  /** Store operations worked out beside the engine's state (the horizon), in order. */
  readonly storeState: { horizon: string[] };
  /** The events the engine filled in from the world itself (`fill`), by identity, with the provenance each is recorded with, whichever operation records them. */
  private readonly filled = new Map<LedgerEvent, Provenance>();
  /** Advice that came with an operation, not with one of its events, by the operation's number, until the operation is recorded. */
  private readonly advised = new Map<number, Advice[]>();
  /** The engine's refusals the work met, by code. */
  private readonly refusals = new Map<string, Rejection>();
  /** The answer being made, when the work has one: advice becomes a report in it as the operation is recorded. */
  reply: Reply | null = null;
  /** The last handler of the engine's that threw while this draft was worked out: a fault, which the answer says is one. */
  fault: { op: string; error: unknown } | null = null;

  constructor(
    readonly base: Reading,
    readonly call: Call,
  ) {
    this.w = new Working(base.registry, base.doc, base.state.world);
    this.storeState = { horizon: [...base.state.horizon] };
  }

  /** A reading over the draft as it stands: names made by an earlier operation are found by a later one. */
  reading(): Reading {
    return this.base.over({ ...this.base.state, world: this.w.state, horizon: this.storeState.horizon }, this.w.ctx);
  }

  /** An error of the engine's own, met as a handler ran: logged by the store's sink, and kept so the call is answered as a fault. */
  private broke(op: string, error: unknown): void {
    this.fault = { op, error };
    this.call.deps.env.failed?.({ op, error, turn: this.call.scope.turn ?? "", change: null });
  }

  /**
   * Applies events in order on the working copy; the first that does not apply undoes the rest and is returned. A handler that throws
   * is an error in the engine, not in the story: the working copy is put back the same way, the error goes to the store's own sink
   * (`FoldEnv.failed`: the log and the live view), and the rejection carries only the code `failed`, which the answers file words.
   * Each refusal is kept (`refusedBy`), so an answer that names its code gives the engine's reason and choices with it.
   */
  applyAll(events: readonly LedgerEvent[]): Rejection | null {
    const mark = this.w.lightMark();
    for (const ev of events) {
      let rejection: Rejection | null;
      try {
        rejection = this.w.apply(ev);
      } catch (error) {
        this.w.restore(mark);
        this.broke(ev.type, error);
        return { code: "failed", reason: "" };
      }
      if (rejection) {
        this.w.restore(mark);
        return this.note(rejection);
      }
    }
    return null;
  }

  /** Keeps a refusal of the engine's, by its code, so the answer that names the code can give its reason and choices (`refusedBy`). It is returned. */
  note(rejection: Rejection): Rejection {
    this.refusals.set(rejection.code, rejection);
    return rejection;
  }

  /** The engine's own refusal with this code, as the work on this draft last met it; undefined when none was. */
  refusedBy(code: string): Rejection | undefined {
    return this.refusals.get(code);
  }

  /**
   * Fills in a part of someone's or something's detail from the world itself, as today's engine
   * does where nobody has yet (`materializeIfNeeded`: an account's authored opening, or values drawn
   * from the world's tables): no call said any of it, so each of its events is recorded as a change
   * of its own, with `FILLED_IN`, whichever operation records it. A handler that throws is met as in
   * `applyAll`.
   */
  fill(n: number, entity: EntityId, domain: DomainId, prov: Provenance = FILLED_IN): Rejection | null {
    const mark = this.w.lightMark();
    try {
      materializeIfNeeded(this.base.registry, this.w, entity, domain, this.seed(n));
    } catch (error) {
      this.w.restore(mark);
      this.broke("materialize", error);
      return { code: "failed", reason: "" };
    }
    for (const ev of this.w.events.slice(mark.events)) this.filled.set(ev, prov);
    return null;
  }

  /**
   * Applies what the engine works out from the world itself as the economy would post it (an
   * account's authored opening), each event recorded as a change of its own with `prov` (`FILLED_IN`
   * when none is given: assumed, from the default), as `fill` records what it fills in; a world's
   * authored value is given its own, established. What does not apply undoes the rest and is returned.
   */
  fillWith(events: readonly LedgerEvent[], prov: Provenance = FILLED_IN): Rejection | null {
    const at = this.w.events.length;
    const bad = this.applyAll(events);
    if (bad) return bad;
    for (const ev of this.w.events.slice(at)) this.filled.set(ev, prov);
    return null;
  }

  /** Marks events an item op hands back as filled in from the world (`ItemOpApplied.filled`) to be recorded apart from the call's own, with `prov` (`FILLED_IN`: assumed, from the default, when none is given). */
  markFilled(events: readonly LedgerEvent[], prov: Provenance = FILLED_IN): void {
    for (const ev of events) this.filled.set(ev, prov);
  }

  /**
   * Records the events applied since `from` as one operation's changes. Events that came with no
   * unit of their own become one unit, so a later path keeps or drops the operation whole, as
   * today's GM edits are; what was filled in (`fill`) stays a change of its own, out of that unit.
   * The economy's bookkeeping for a party it keeps no accounts for stays in the unit it came in,
   * and is recorded with `FILLED_IN` too (`bookkeeping`).
   */
  record(n: number, op: string, lane: Lane, prov: Provenance, from: number, extra: { made?: string } = {}): Recorded {
    const events = this.w.events.slice(from);
    const own = events.filter((e) => !this.filled.has(e));
    const loose = own.length > 1 && own.every((e) => e.group === undefined);
    const group = loose ? `op:${hashParts(this.call.callId, String(n), JSON.stringify(own)).slice(0, 10)}` : undefined;
    const rec: Recorded = { n, op, lane, prov, inputs: [], advice: [], reports: [], ...(extra.made !== undefined ? { made: extra.made } : {}) };
    events.forEach((ev, i) => {
      const filledWith = this.filled.get(ev);
      if (filledWith !== undefined) this.push(rec, lane, filledWith, { op: ev.type, value: ev as unknown as JsonValue });
      else this.push(rec, lane, bookkeeping(events, i) ? FILLED_IN : prov, { op: ev.type, value: (group ? { ...ev, group } : ev) as unknown as JsonValue });
      // What its validator advised of the event, kept with the change it advised on.
      const advised = this.w.advice[from + i];
      if (advised) this.advise(rec, advised, rec.inputs.length - 1);
    });
    for (const advised of this.advised.get(n) ?? []) this.advise(rec, advised, rec.inputs.length - 1);
    this.advised.delete(n);
    this.recorded.push(rec);
    return rec;
  }

  /** Advice that comes with an operation rather than with one of its events (what an item op hands back): kept for the operation `n` when it is recorded. */
  adviseOp(n: number, advice: Advice): void {
    const list = this.advised.get(n) ?? [];
    list.push(advice);
    this.advised.set(n, list);
  }

  /** One piece of advice kept with an operation and said in the answer as a report: the line named by its code, else the general one. */
  private advise(rec: Recorded, advice: Advice, input: number): void {
    rec.advice.push({ code: advice.code, ...(advice.values !== undefined ? { values: advice.values } : {}), input });
    const reply = this.reply;
    if (reply === null) return;
    // The advice's own values come last: a bent rule's `code` is the rule's, the line named by the advice's code.
    const fields = { n: rec.n, op: rec.op, code: advice.code, ...(advice.values ?? {}) };
    if (reply.says(advice.code)) reply.report(advice.code, fields);
    else reply.report("advised", fields);
  }

  /** Keeps with each recorded operation the reports its work made (`Reply.report`): data, with its words, for the store to list with the change. */
  keepReports(reply: Reply): void {
    for (const rec of this.recorded) rec.reports = reply.kept.filter((r) => r.n === rec.n);
  }

  /** Records one of the store's own operations (the horizon), or a change the store's fact store applies (a fact, `src/store/facts.ts`). */
  recordStoreOp(n: number, opName: string, lane: Lane, prov: Provenance, change: Pick<ChangeInput, "op" | "value">): Recorded {
    const rec: Recorded = { n, op: opName, lane, prov, inputs: [], advice: [], reports: [] };
    this.push(rec, lane, prov, change);
    this.recorded.push(rec);
    return rec;
  }

  /** One change of an operation, with who made it, its lane, its provenance and what it cites. */
  private push(rec: Recorded, lane: Lane, prov: Provenance, change: Pick<ChangeInput, "op" | "value">): void {
    rec.inputs.push(this.inputs.length);
    this.inputs.push({ lane, op: change.op, value: change.value, by: this.call.agent.id, standing: prov.standing, precision: prov.precision, source: prov.source?.from ?? null, cite: citeOf(prov), job: this.call.agent.job ?? null });
  }

  /** A seed for what an operation draws (a made thing's id, a level-up's dice): the turn, the call and the operation. */
  seed(n: number): string {
    return hashParts("rpe.iface", this.base.turn?.id ?? this.call.scope.chat, this.call.callId, String(n));
  }
}

/** What recording a draft came to. */
export interface Committed {
  rows: ChangeRow[];
  state: StoreState;
}

/** What working a call out inside its write came to: what the work gave, and what was recorded (null when it gave nothing to record, or the scope could not take it: `gone`). */
export interface Worked<T> {
  out: T;
  done: Committed | null;
  /** Why the write was not recorded when its scope could not take it: its turn's staged changes were dropped, its job has ended, or its turn was joined to another. */
  gone?: Unreadable;
}

/**
 * Works a call out and records it in one write through the queue, which runs one write at a time.
 * `work` runs inside the write, so it reads the state as it stands then: a call made at the same
 * time as another of the turn is worked out on what the other left, never on the state both read
 * before either was recorded. The draft it gives is recorded on that same state; none records nothing.
 * A turn dropped, a job ended or a turn joined to another by the time it records is told (`gone`), never thrown.
 */
export async function commit<T>(call: Call, work: () => { out: T; draft: Draft | null }): Promise<Worked<T>> {
  const { store, writes } = call.deps;
  return writes.run((): Worked<T> => {
    const { out, draft } = work();
    if (draft === null) return { out, done: null };
    const turn = draft.base.turn;
    if (turn === null) throw new Error("a draft is recorded only on a turn");
    try {
      if (draft.inputs.length === 0) return { out, done: { rows: [], state: store.stateFor(turn.id, call.agent.job ?? null).state } };
      const { changes, state } = store.addChanges(turn.id, draft.inputs);
      return { out, done: { rows: changes, state } };
    } catch (error) {
      if (error instanceof JoinedTurnError) return { out, done: null, gone: { missing: "joined", id: error.turn, into: error.joined } };
      if (!(error instanceof StoreInputError)) throw error;
      // What the store refuses for what is no longer there: a turn dropped with its staged changes, or a job that has ended.
      if (store.turn(turn.id)?.status === "dropped") return { out, done: null, gone: { missing: "gone", id: turn.id, what: "turn" } };
      const job = call.agent.job;
      if (job !== undefined) return { out, done: null, gone: { missing: "gone", id: job, what: "job" } };
      throw error;
    }
  }, call.tool);
}

// ---------------------------------------------------------------- what changed

/** A value as an answer shows it: a string as it is, a list of plain values joined, anything else as JSON. */
function shown(v: JsonValue | undefined): JsonValue {
  if (v === undefined) return null;
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.map((x) => String(x)).join(", ");
  return v;
}

/** Every entity id an event names, wherever it names it. */
function idsIn(value: unknown, entities: Readonly<Record<string, unknown>>, out: Set<string>): void {
  if (typeof value === "string") {
    if (Object.hasOwn(entities, value)) out.add(value);
  } else if (Array.isArray(value)) for (const v of value) idsIn(v, entities, out);
  else if (isRecord(value)) for (const [k, v] of Object.entries(value)) if (k !== "type" && k !== "group") idsIn(v, entities, out);
}

/** An entity's relations, by type, each as the names it points at. */
function relationsOf(e: EntityState, name: (id: string) => string): Record<string, string> {
  const by: Record<string, string[]> = {};
  for (const r of e.relations) (by[r.type] ??= []).push(name(r.to));
  return Object.fromEntries(Object.entries(by).map(([type, names]) => [type, names.sort().join(", ")]));
}

/** What a thing is, as a diff compares it: its name, tier and life, its fields, its relations, and its account's balance. */
function aspects(id: string, state: WorldState, doc: WorldDoc, name: (id: string) => string): Record<string, JsonValue> {
  const e = own(state.entities, id);
  if (!e) return {};
  const out: Record<string, JsonValue> = { name: e.name, tier: e.tier };
  if (e.life !== undefined) out.life = e.life;
  for (const [k, v] of Object.entries(e.fields)) out[k] = shown(v);
  for (const [k, v] of Object.entries(relationsOf(e, name))) out[`${k}`] = v;
  const posted = state.accounts[id];
  if (posted !== undefined) out.balance = formatMoney(posted, doc.currency);
  return out;
}

/** What a place is, as a diff compares it: its name, the place it is in, and its fields. */
function placeAspects(def: PlaceDef | undefined, name: (id: string) => string): Record<string, JsonValue> {
  if (!def) return {};
  const out: Record<string, JsonValue> = { name: def.name };
  if (def.parent !== undefined) out.in = name(def.parent);
  for (const [k, v] of Object.entries(def.fields)) out[k] = shown(v);
  return out;
}

/** What changed of one thing or place, by the keys that differ: null when none does. */
function diffEntry(at: string, name: string, was: Record<string, JsonValue>, now: Record<string, JsonValue>, isNew: boolean): JsonObject | null {
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => JSON.stringify(was[k] ?? null) !== JSON.stringify(now[k] ?? null));
  if (keys.length === 0) return null;
  const entry: JsonObject = { at, name };
  if (isNew) entry.new = true;
  else entry.was = Object.fromEntries(keys.map((k) => [k, was[k] ?? null]));
  entry.now = Object.fromEntries(keys.map((k) => [k, now[k] ?? null]));
  return entry;
}

/**
 * What the call changed, from the state it started on to the state recorded: each touched thing
 * with the keys that changed, as they were and as they are now; each place made or changed in the
 * world as the chat plays it; the clock (on one nobody has set, each time as how long it is from now,
 * in the answers' `lines`); quests' stages; the horizon.
 */
export function changedBetween(before: StoreState, after: StoreState, doc: WorldDoc, events: readonly JsonValue[], lines: Lines): JsonObject[] {
  const out: JsonObject[] = [];
  const ids = new Set<string>();
  for (const ev of events) {
    idsIn(ev, before.world.entities, ids);
    idsIn(ev, after.world.entities, ids);
  }
  const placesBefore = playedWorld(doc, before.world).places;
  const placesAfter = playedWorld(doc, after.world).places;
  const name = (id: string): string => own(after.world.entities, id)?.name ?? own(before.world.entities, id)?.name ?? own(placesAfter, id)?.name ?? own(placesBefore, id)?.name ?? id;
  for (const id of [...ids].sort()) {
    const entry = diffEntry(`entity:${id}`, name(id), aspects(id, before.world, doc, name), aspects(id, after.world, doc, name), own(before.world.entities, id) === undefined);
    if (entry) out.push(entry);
  }
  for (const id of [...new Set([...Object.keys(placesBefore), ...Object.keys(placesAfter)])].sort()) {
    // A place neither the draft nor play touched is the same object in both.
    if (own(placesBefore, id) === own(placesAfter, id)) continue;
    const entry = diffEntry(`place:${id}`, name(id), placeAspects(own(placesBefore, id), name), placeAspects(own(placesAfter, id), name), own(placesBefore, id) === undefined);
    if (entry) out.push(entry);
  }
  if (before.world.clock !== after.world.clock) {
    const cal = calendarOf(doc);
    const time = (clock: number): string => (clockRecorded(after) ? formatClock(cal, clock) : fromNow(lines, clock - after.world.clock));
    out.push({ at: "world", name: doc.name, was: { time: time(before.world.clock) }, now: { time: time(after.world.clock) } });
  }
  for (const [track, t] of Object.entries(after.world.tracks)) {
    const was = own(before.world.tracks, track)?.stage ?? own(doc.tracks, track)?.start;
    if (was === t.stage) continue;
    const def = own(doc.tracks, track);
    const label = (stage: string | undefined): JsonValue => (stage === undefined ? null : (own(def?.stages ?? {}, stage)?.label ?? stage));
    out.push({ at: `track:${track}`, name: def?.label ?? track, was: { stage: label(was) }, now: { stage: label(t.stage) } });
  }
  if (JSON.stringify(before.horizon) !== JSON.stringify(after.horizon)) out.push({ at: "horizon", was: { list: before.horizon }, now: { list: after.horizon } });
  return out;
}

/** The tree refs an answer shows as they now stand: each touched thing and place. */
export function touchedRefs(changed: readonly JsonObject[]): string[] {
  return changed.flatMap((c) => (typeof c.at === "string" && (c.at.startsWith("entity:") || c.at.startsWith("place:")) ? [c.at] : []));
}

/**
 * The answer to a draft recorded: each operation with its lane and provenance, what changed, how it now stands, and what did not apply.
 * A turn joined to another after the write was recorded still says what it recorded; in place of how things now stand it says the fact
 * (`turn_joined`), since nothing reads the turn it was joined to here.
 */
export function answerDraft(draft: Draft, done: Committed, reply: Reply, extra: { operations?: JsonObject[]; added?: ReadonlyMap<number, JsonObject> } = {}): Reply {
  const store = draft.call.deps.store;
  let view: TreeView | null = null;
  try {
    view = store.viewAt(draft.base.turn?.id ?? "");
  } catch (error) {
    if (!(error instanceof JoinedTurnError)) throw error;
    reply.line("turn_joined", { id: error.turn, into: error.joined });
  }
  const changed = changedBetween(draft.base.state, done.state, draft.base.doc, draft.inputs.map((i) => i.value), draft.base.lines);
  const operations: JsonObject[] = [...(extra.operations ?? [])];
  for (const rec of draft.recorded) {
    const rows = rec.inputs.map((i) => done.rows[i]).filter((r): r is ChangeRow => r !== undefined);
    // An operation that recorded nothing did not apply.
    const applied = rows.length > 0 && rows.every((r) => r.applied);
    const entry: JsonObject = { n: rec.n, op: rec.op, lane: rec.lane, applied, ...provenanceData(rec.prov) };
    if (rec.made !== undefined) entry.made = rec.made;
    Object.assign(entry, extra.added?.get(rec.n) ?? {});
    if (rows.length > 0) entry.changes = rows.map((r) => r.id);
    operations.push(entry);
    for (const r of rows) {
      for (const rep of r.reports) {
        // The store's own codes are said by their own lines (`store_<code>`), with their values; a
        // code of today's engine's checks says why the change did not apply.
        const line = `store_${rep.code}`;
        if (reply.says(line)) reply.report(line, { n: rec.n, op: rec.op, ...(rep.values ?? {}) });
        else if (!r.applied) reply.report("not_applied", { n: rec.n, op: rec.op, code: rep.code });
      }
    }
  }
  operations.sort((a, b) => Number(a.n) - Number(b.n));
  const now =
    view === null
      ? []
      : touchedRefs(changed).flatMap((ref) => {
          const node = view.node(ref);
          return node ? [{ ref: node.ref, name: node.name, what: node.what, reflection: node.reflection, values: node.values.map((v) => ({ key: v.key, value: v.value, ...(v.from !== undefined ? { from: v.from } : {}) })) } as unknown as JsonObject] : [];
        });
  reply.data({ operations, changed, now });
  reply.details = { ...reply.details, changes: done.rows.map((r) => r.id) };
  return reply;
}
