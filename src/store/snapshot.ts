// Snapshots by part (plan §6.3 l.619, Appendix B, D.1). A snapshot still stands every `snapshotEvery` turns along every path, one
// row per node in `snapshot`; its row holds only a list of the parts its state is made of, each named by the hash of its text, and
// the parts are stored once in `snapshot_part`, whoever's snapshot names them: the world's own values, its entities in runs of a
// fixed length in the order the world holds them, each pack's slice, and what the store keeps beside the world. A snapshot shares
// with the one before it every part that did not change, so a chat's snapshots take the room of what changed between them. Each
// part counts the snapshots that name it (the table's triggers), and goes with the last of them.
//
// A row stored before the store kept parts holds the whole state, and is read as it was.

import type { JsonObject } from "../shared/json";
import type { WorldState } from "../engine/state";
import type { NotApplied, StoreState } from "./types";

/** What a snapshot keeps: the state after its node, with what did not apply and what stood rebased on the path to it. */
export interface SnapshotDoc {
  state: StoreState;
  notApplied: NotApplied[];
  rebased: string[];
}

/** A snapshot ready to store: its row's text, and the text of each part it names. */
export interface SnapshotRows {
  manifest: string;
  parts: [hash: string, body: string][];
}

/** Entities in a run: a change to one stores its run again, a new one only the last run. */
const RUN = 64;

const hashOf = (body: string): string => `${Bun.hash(body).toString(36)}.${body.length}`;

/**
 * Runs written before, by the first entity object of each: the run's objects, its text and its hash. Objects held in memory are never
 * changed (they are frozen), so a run of the same objects is the same text; a run holding one a fold may still change is not kept.
 */
const runs = new WeakMap<object, { members: readonly unknown[]; body: string; hash: string }>();

function runOf(ids: readonly string[], entities: WorldState["entities"]): { body: string; hash: string } {
  const members = ids.map((id) => entities[id]);
  const first = members[0];
  const hit = first === undefined ? undefined : runs.get(first);
  if (hit && hit.members.length === members.length && members.every((m, i) => m === hit.members[i])) return hit;
  // The run's entries as they stand inside the entities' record, so the runs joined are the record's text.
  const body = ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(entities[id])}`).join(",");
  const made = { members, body, hash: hashOf(body) };
  if (first !== undefined && members.every((m) => Object.isFrozen(m))) runs.set(first, made);
  return made;
}

/** A snapshot of `doc`, as parts. */
export function snapshotRows(doc: SnapshotDoc): SnapshotRows {
  const parts: Record<string, string> = {};
  const given = new Map<string, string>();
  const put = (key: string, body: string, hash = hashOf(body)): void => {
    parts[key] = hash;
    given.set(hash, body);
  };
  const { world, areas, ...beside } = doc.state;
  const ids = Object.keys(world.entities);
  put("w", JSON.stringify({ ...world, entities: Math.ceil(ids.length / RUN), packs: Object.keys(world.packs) }));
  for (let r = 0; r * RUN < ids.length; r++) {
    const run = runOf(ids.slice(r * RUN, (r + 1) * RUN), world.entities);
    put(`e${r}`, run.body, run.hash);
  }
  for (const [id, slice] of Object.entries(world.packs)) put(`p:${id}`, JSON.stringify(slice));
  // Each area's slice a part of its own: one that did not change is the part before.
  for (const [id, slice] of Object.entries(areas ?? {})) put(`a:${id}`, sliceText(slice));
  put("s", JSON.stringify(areas === undefined ? beside : { ...beside, areas: Object.keys(areas) }));
  return { manifest: JSON.stringify({ parts, notApplied: doc.notApplied, rebased: doc.rebased }), parts: [...given] };
}

/** An area's slice as text: held slices are never changed (they are frozen), so one written before is the same text. */
const slices = new WeakMap<object, string>();

function sliceText(slice: object): string {
  const hit = slices.get(slice);
  if (hit !== undefined) return hit;
  const text = JSON.stringify(slice);
  if (Object.isFrozen(slice)) slices.set(slice, text);
  return text;
}

/** A snapshot row's text read whole: a list of parts (`bodies` gives each part's text by hash), or a whole state stored before parts. */
export function readSnapshot(text: string, bodies: (hashes: string[]) => Map<string, string>): SnapshotDoc {
  const doc = JSON.parse(text) as SnapshotDoc & { parts?: Record<string, string> };
  if (doc.parts === undefined) {
    // A starting state set before the store kept facts and marks holds none yet.
    doc.state.marks ??= {};
    doc.state.facts ??= {};
    return doc;
  }
  const parts = doc.parts;
  const got = bodies([...new Set(Object.values(parts))]);
  const body = (key: string): string => {
    const hash = parts[key];
    const text = hash === undefined ? undefined : got.get(hash);
    if (text === undefined) throw new Error(`a snapshot's part ${key} is not stored`);
    return text;
  };
  const world = JSON.parse(body("w")) as Omit<WorldState, "entities" | "packs"> & { entities: number; packs: string[] };
  const entries: string[] = [];
  for (let r = 0; r < world.entities; r++) {
    const run = body(`e${r}`);
    if (run !== "") entries.push(run);
  }
  const packs: Record<string, unknown> = {};
  for (const id of world.packs) packs[id] = JSON.parse(body(`p:${id}`));
  const whole = { ...world, entities: JSON.parse(`{${entries.join(",")}}`) as WorldState["entities"], packs: packs as WorldState["packs"] };
  const { areas: names, ...beside } = JSON.parse(body("s")) as Omit<StoreState, "world" | "areas"> & { areas?: string[] };
  const state: StoreState = { world: whole, ...beside };
  if (names !== undefined) state.areas = Object.fromEntries(names.map((id) => [id, JSON.parse(body(`a:${id}`)) as JsonObject]));
  return { state, notApplied: doc.notApplied, rebased: doc.rebased };
}
