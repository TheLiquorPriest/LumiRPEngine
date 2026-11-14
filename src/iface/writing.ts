// The write path every engine tool shares. A call's operations are worked out in order on a working
// copy of the state at its turn, by today's own engine (its item ops, effects, moves and handlers),
// each operation's events kept apart; then everything is recorded in one write through the queue,
// each change with its lane and provenance. The answer says what changed (each touched thing as it
// was and as it is now), what it now looks like in the tree, and any reports.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { hashParts } from "../shared/hash";
import type { EntityId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { formatMoney, type WorldDoc } from "../shared/world";
import { calendarOf, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import type { Rejection } from "../engine/registry";
import type { EntityState, WorldState } from "../engine/state";
import { Working } from "../engine/working";
import type { ChangeInput, ChangeRow, Lane, StoreState } from "../store/types";
import type { Call, Reply } from "./kit";
import { Reading } from "./reading";
import { citeOf, type Provenance, provenanceData } from "./source";

/** One operation's part of a draft: what it is, its lane and provenance, and where its changes sit among the draft's. */
export interface Recorded {
  n: number;
  op: string;
  lane: Lane;
  prov: Provenance;
  /** Indexes into the draft's inputs. */
  inputs: number[];
  /** What the operation made, by id: a spawned person or thing. */
  made?: string;
}

/** A call's operations worked out on a copy of the state, before anything is recorded. */
export class Draft {
  readonly w: Working;
  readonly inputs: ChangeInput[] = [];
  readonly recorded: Recorded[] = [];
  /** Store operations worked out beside the engine's state (the horizon), in order. */
  readonly storeState: { horizon: string[] };

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

  /** Applies events in order on the working copy; the first that does not apply undoes the rest and is returned. */
  applyAll(events: readonly LedgerEvent[]): Rejection | null {
    const mark = this.w.lightMark();
    for (const ev of events) {
      const rejection = this.w.apply(ev);
      if (rejection) {
        this.w.restore(mark);
        return rejection;
      }
    }
    return null;
  }

  /**
   * Records the events applied since `from` as one operation's changes. Events that came with no
   * unit of their own become one unit, so a later path keeps or drops the operation whole, as
   * today's GM edits are.
   */
  record(n: number, op: string, lane: Lane, prov: Provenance, from: number, extra: { made?: string } = {}): Recorded {
    const events = this.w.events.slice(from);
    const loose = events.length > 1 && events.every((e) => e.group === undefined);
    const group = loose ? `op:${hashParts(this.call.callId, String(n), JSON.stringify(events)).slice(0, 10)}` : undefined;
    const rec: Recorded = { n, op, lane, prov, inputs: [], ...(extra.made !== undefined ? { made: extra.made } : {}) };
    for (const ev of events) this.push(rec, lane, prov, { op: ev.type, value: (group ? { ...ev, group } : ev) as unknown as JsonValue });
    this.recorded.push(rec);
    return rec;
  }

  /** Records one of the store's own operations (the horizon), or a change the state lane's stores apply (a fact). */
  recordStoreOp(n: number, opName: string, lane: Lane, prov: Provenance, change: Pick<ChangeInput, "op" | "value">): Recorded {
    const rec: Recorded = { n, op: opName, lane, prov, inputs: [] };
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

/** Records a draft's changes on the call's turn, in one write through the queue. */
export async function commit(draft: Draft): Promise<Committed> {
  const turn = draft.base.turn;
  if (turn === null) throw new Error("a draft is recorded only on a turn");
  const { store, writes } = draft.call.deps;
  if (draft.inputs.length === 0) return { rows: [], state: store.stateAt(turn.id).state };
  const { changes, state } = await writes.run(() => store.addChanges(turn.id, draft.inputs), draft.call.tool);
  return { rows: changes, state };
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

/**
 * What the call changed, from the state it started on to the state recorded: each touched thing
 * with the keys that changed, as they were and as they are now; the clock; quests' stages; the
 * horizon.
 */
export function changedBetween(before: StoreState, after: StoreState, doc: WorldDoc, events: readonly JsonValue[]): JsonObject[] {
  const out: JsonObject[] = [];
  const ids = new Set<string>();
  for (const ev of events) {
    idsIn(ev, before.world.entities, ids);
    idsIn(ev, after.world.entities, ids);
  }
  const name = (id: string): string => own(after.world.entities, id)?.name ?? own(before.world.entities, id)?.name ?? own(doc.places, id)?.name ?? id;
  for (const id of [...ids].sort()) {
    const was = aspects(id, before.world, doc, name);
    const now = aspects(id, after.world, doc, name);
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => JSON.stringify(was[k] ?? null) !== JSON.stringify(now[k] ?? null));
    if (keys.length === 0) continue;
    const entry: JsonObject = { at: `entity:${id}`, name: name(id) };
    if (own(before.world.entities, id) === undefined) entry.new = true;
    else entry.was = Object.fromEntries(keys.map((k) => [k, was[k] ?? null]));
    entry.now = Object.fromEntries(keys.map((k) => [k, now[k] ?? null]));
    out.push(entry);
  }
  if (before.world.clock !== after.world.clock) {
    const cal = calendarOf(doc);
    out.push({ at: "world", name: doc.name, was: { time: formatClock(cal, before.world.clock) }, now: { time: formatClock(cal, after.world.clock) } });
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

/** The tree refs an answer shows as they now stand: each touched thing, and the place a moved one is at. */
export function touchedRefs(changed: readonly JsonObject[]): string[] {
  return changed.flatMap((c) => (typeof c.at === "string" && c.at.startsWith("entity:") ? [c.at] : []));
}

/** The answer to a draft recorded: each operation with its lane and provenance, what changed, how it now stands, and what did not apply. */
export function answerDraft(draft: Draft, done: Committed, reply: Reply, extra: { operations?: JsonObject[]; added?: ReadonlyMap<number, JsonObject> } = {}): Reply {
  const view = draft.call.deps.store.viewAt(draft.base.turn?.id ?? "");
  const changed = changedBetween(draft.base.state, done.state, draft.base.doc, draft.inputs.map((i) => i.value));
  const operations: JsonObject[] = [...(extra.operations ?? [])];
  for (const rec of draft.recorded) {
    const rows = rec.inputs.map((i) => done.rows[i]).filter((r): r is ChangeRow => r !== undefined);
    const applied = rows.every((r) => r.applied);
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
  const now = touchedRefs(changed).flatMap((ref) => {
    const node = view.node(ref);
    return node ? [{ ref: node.ref, name: node.name, what: node.what, reflection: node.reflection, values: node.values.map((v) => ({ key: v.key, value: v.value, ...(v.from !== undefined ? { from: v.from } : {}) })) } as unknown as JsonObject] : [];
  });
  reply.data({ operations, changed, now });
  reply.details = { ...reply.details, changes: done.rows.map((r) => r.id) };
  return reply;
}

/** The entity id `made` names on the draft's state, for an answer's data. */
export function madeName(draft: Draft, id: EntityId): string {
  return own(draft.w.state.entities, id)?.name ?? id;
}
