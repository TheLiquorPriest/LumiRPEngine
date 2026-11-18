// What the Undo tests of the play views share: a chat on a starter world with one turn played and the play service over its store, a press
// that is taken back at once with the state read before and after, and the state of a world read for what it is: without a thing's tombstone
// (an Undo makes a thing gone, never takes its id back), the books' own journals and totals (an Undo posts the other way, so the journal keeps
// both lines), an account at nothing, an empty record and the counter that keeps ids apart. Every chat, person and place here is invented.

import { Database } from "bun:sqlite";
import { LiveHub, WriteQueue } from "../../src/app";
import type { WorldState } from "../../src/engine/state";
import { shippedTexts } from "../../src/iface/index";
import { STARTER_WORLDS } from "../../src/packs/index";
import { PlayService } from "../../src/play";
import type { TapAnswer, TapAsk } from "../../src/play/service";
import { TAP_DEFAULTS } from "../../src/play/settings";
import { hashJson } from "../../src/shared/hash";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import { migrateStore, openStore, type Report, type Store, storedWorlds, type UserStore } from "../../src/store";
import type { ChangeRow } from "../../src/store/types";
import { Requests } from "../../src/turn/requests";
import { HARNESS_MIGRATIONS } from "../../src/turn/tables";
import type { StateView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { CHAT, GUIDANCE, registry, USER } from "./bed";

/** A chat on a starter world as the Undo tests drive it. */
export interface Rig {
  /** The store, whose environment and due list a test reads; `s` is its one user. */
  store: Store;
  s: UserStore;
  doc: WorldDoc;
  writes: WriteQueue;
  /** The engine's state of the world at the chat's head. */
  world(): WorldState;
  tap(ask: TapAsk): Promise<TapAnswer>;
  undo(id: string | null): Promise<TapAnswer>;
  /** A turn of events a reply tells of, applied as the engine's own: each one's change, whether it applied or not. */
  record(events: readonly LedgerEvent[]): Promise<ChangeRow[]>;
  /** One change taken back (the Undo of a change of a reply's turn), with what it left. */
  take(change: number): Promise<{ left: Report[] }>;
  /** The chat's state view at its head, as the page reads it. */
  view(): Promise<StateView>;
}

/** A chat on a starter world, one turn played, and the play service over its store. */
export async function rig(pov?: string, template = "modern_slice_of_life"): Promise<Rig> {
  const db = new Database(":memory:");
  migrateStore(db);
  for (const step of HARNESS_MIGRATIONS) db.run(step.sql);
  const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
  const writes = new WriteQueue(db, 10);
  const live = new LiveHub({ queueEvents: 64, now: () => 0 });
  const requests = new Requests(db, writes, () => undefined);
  const lumiverse = () => {
    throw new Error("The rig has no Lumiverse to put a message in.");
  };
  const log = () => undefined;
  const service = new PlayService({ store, writes, live, db, guidance: GUIDANCE, texts: () => shippedTexts(), turning: () => false, settings: async () => ({ dueItems: 50, editOps: 64, taps: TAP_DEFAULTS, map: MAP_DEFAULTS }), requests, lumiverse, writeChatSetting: async () => {}, log: { debug: log, info: log, warn: log, error: log } });
  const make = STARTER_WORLDS[template];
  if (make === undefined) throw new Error(`no starter world ${template}`);
  const doc = make(template, template);
  if (pov !== undefined) doc.pov = pov;
  const revision = hashJson(doc);
  const s = store.user(USER);
  await writes.run(() => {
    s.putWorld(revision, doc);
    s.createChat({ id: CHAT, world: doc.id, revision });
  });
  const begun = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "normal" }), "a turn");
  await writes.run(() => s.tieTurn(begun.id, { message: "msg-1", hash: "hash-1" }), "tying the turn");
  let replies = 1;
  return {
    store,
    s,
    doc,
    writes,
    world: () => s.headState(CHAT).state.world,
    view: () => service.state(USER, CHAT, null),
    tap: (ask) => service.tap(USER, CHAT, ask),
    undo: async (id) => {
      if (id === null) throw new Error("the tap gave no Undo");
      return await service.undoEdit(USER, CHAT, id);
    },
    async record(events) {
      const turn = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "normal" }), "a turn");
      const { changes } = await writes.run(() => s.addChanges(turn.id, events.map((e) => ({ lane: "engine" as const, op: e.type, value: e as unknown as JsonValue, by: "gm", source: "prose" as const }))), "its changes");
      replies += 1;
      await writes.run(() => s.tieTurn(turn.id, { message: `msg-${replies}`, hash: `hash-${replies}` }), "tying the turn");
      return changes;
    },
    take: (change) => writes.run(() => s.undo(change), "an undo"),
  };
}

/** The paths at which two values differ, as words, the first dozen. */
export function diffs(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 12 || a === b) return out;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) diffs(x[key], y[key], `${path}.${key}`, out);
  return out;
}

/** A value without what is empty in it: a field at nothing, an empty list or record. */
function pruned(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pruned);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    const kept = pruned(value);
    const empty = kept === null || kept === 0 || kept === false || (Array.isArray(kept) && kept.length === 0) || (typeof kept === "object" && !Array.isArray(kept) && Object.keys(kept as object).length === 0);
    if (!empty) out[key] = kept;
  }
  return out;
}

/** What a world is, as an Undo is meant to give it back (see the head of this file). */
export function essence(world: WorldState): JsonObject {
  const w = structuredClone(world) as unknown as { entities: Record<string, { fields?: JsonObject; relations?: { type: string; to: string }[] }>; accounts: Record<string, number>; packs: Record<string, JsonObject> };
  for (const [id, e] of Object.entries(w.entities)) if (e.fields?.gone === true) delete w.entities[id];
  for (const [id, v] of Object.entries(w.accounts)) if (v === 0) delete w.accounts[id];
  for (const e of Object.values(w.entities)) {
    for (const [key, value] of Object.entries(e.fields ?? {})) if (value === null) delete (e.fields as JsonObject)[key];
    // Who a thing is related to, not the order the relations were made in.
    e.relations = [...(e.relations ?? [])].sort((x, y) => JSON.stringify([x.type, x.to]).localeCompare(JSON.stringify([y.type, y.to])));
  }
  delete w.packs.engine?.touched;
  for (const key of ["journal", "totals", "seq", "adb"]) delete w.packs.economy?.[key];
  return pruned(w) as JsonObject;
}

/** What a press and its Undo came to: both answers, and the paths at which the world differs from what it was before the press (none: the Undo gave back exactly what the press changed). */
export interface PressedAndUndone {
  tap: TapAnswer;
  undo: TapAnswer | null;
  differs: string[];
}

/** A tap pressed, taken back at once, and the world read before and after. */
export async function pressed(r: Rig, ask: TapAsk): Promise<PressedAndUndone> {
  const before = essence(r.world());
  const tap = await r.tap(ask);
  if (!tap.applied || tap.undo === null) return { tap, undo: null, differs: [] };
  const undo = await r.undo(tap.undo);
  return { tap, undo, differs: diffs(before, essence(r.world())) };
}

/** An action pressed with `params`, as a panel presses it. */
export const action = (id: string, params: JsonObject): TapAsk => ({ kind: "action", action: id, params, source: "panel" });

/** The records of the list at `path` below the packs' slices (`["orgs", "motions", "alder_automotive_co"]`); none where there is no list there. */
export function listAt(r: Rig, path: readonly string[]): JsonObject[] {
  let at: unknown = r.world().packs;
  for (const step of path) at = isRecord(at) ? at[step] : undefined;
  return Array.isArray(at) ? at.filter((x): x is JsonObject => isRecord(x)) : [];
}

/** An event of a pack, as a reply tells of it. */
export const event = (type: string, data: JsonObject): LedgerEvent => ({ type, data }) as unknown as LedgerEvent;

/** What a reply's events and their Undo came to: whether each applied, whether the world changed, what was left, and where the world differs from before. */
export interface RecordedAndTaken {
  applied: boolean[];
  changed: boolean;
  left: Report[];
  differs: string[];
}

/** Events recorded as a reply's, each then taken back, newest first, and the world read before and after. */
export async function recordedAndTaken(r: Rig, events: readonly LedgerEvent[]): Promise<RecordedAndTaken> {
  const before = essence(r.world());
  const changes = await r.record(events);
  const changed = diffs(before, essence(r.world())).length > 0;
  const left: Report[] = [];
  for (const change of [...changes].reverse()) left.push(...(await r.take(change.id)).left);
  return { applied: changes.map((c) => c.applied), changed, left, differs: diffs(before, essence(r.world())) };
}
