// The chat's workspace (DESIGN §4.4; AGENT-LOOP-PLAN §4): the agents' and the GM's files in this
// chat, each a path whose body is a blob (`shared/stores.ts`). The engine holds only the index,
// path → blob hash, in its state slice, and beside it the paths pinned (the files agents' prompts
// bring in, AGENT-LOOP-PLAN §4). Each turn's changes to them are `engine.ws.write`, `engine.ws.delete`
// and `engine.ws.pin` events in the turn's record, so swipes, Re-run, Re-narrate and Branches carry
// the workspace as they carry every other event, with no handling of their own. A chat that never
// wrote a file holds no index key, and one that never pinned a file no pins key, so older chats fold
// as before. Every file is every agent's to read: an earlier build's `engine.ws.readers`, which said
// whose knowledge might read one, still folds as it did into a readers index nothing reads, so a
// recorded chat replays as it was. Pure.

import { isAgentKnowledge } from "../shared/agent-tools";
import { isRecord, type JsonObject } from "../shared/json";
import type { PackEvent } from "../shared/ledger";
import { isBlobHash, isWorkspacePath } from "../shared/stores";
import type { EventTypeDef } from "./registry";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import { engineSlice } from "./scope";

/** The engine's state-slice key for the workspace's index. */
const WS_KEY = "ws";
/** The engine's state-slice key for the pinned paths, path → true. */
const PINS_KEY = "wsPins";
/** The engine's state-slice key an earlier build's file readers fold into (`engine.ws.readers`); nothing reads it. */
const READERS_KEY = "wsReaders";

/** A file written (created or replaced) with the blob `hash` as its body. */
export const WS_WRITE = "engine.ws.write";
/** A file removed from the workspace. */
export const WS_DELETE = "engine.ws.delete";
/** A file pinned or unpinned. */
export const WS_PIN = "engine.ws.pin";
/** An earlier build's: whose knowledge might read a file. Folded as it was, read by nothing. */
export const WS_READERS = "engine.ws.readers";

export function wsWrite(path: string, hash: string): PackEvent {
  return { type: WS_WRITE, data: { path, hash } };
}

export function wsDelete(path: string): PackEvent {
  return { type: WS_DELETE, data: { path } };
}

export function wsPin(path: string, pinned: boolean): PackEvent {
  return { type: WS_PIN, data: { path, pinned } };
}

/** The workspace's files in this state, path → blob hash; empty in a chat that never wrote one. A malformed entry is no file. */
export function workspaceOf(state: Readonly<WorldState>): Record<string, string> {
  const raw = engineSlice(state)[WS_KEY];
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [path, hash] of Object.entries(raw)) if (isWorkspacePath(path) && isBlobHash(hash)) out[path] = hash;
  return out;
}

/** The workspace's pinned paths in this state; empty in a chat that never pinned one. A malformed entry is no pin. */
export function workspacePins(state: Readonly<WorldState>): Record<string, true> {
  const raw = engineSlice(state)[PINS_KEY];
  const out: Record<string, true> = {};
  if (!isRecord(raw)) return out;
  for (const [path, pinned] of Object.entries(raw)) if (isWorkspacePath(path) && pinned === true) out[path] = true;
  return out;
}

/**
 * The blobs the well-formed `engine.ws.write` events among `events` name. The sweep reads it over
 * raw records from message metadata, so it takes anything and never throws: what isn't such an
 * event names nothing.
 */
export function workspaceRefs(events: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const e of events) if (isRecord(e) && e.type === WS_WRITE && isRecord(e.data) && isBlobHash(e.data.hash)) out.push(e.data.hash);
  return out;
}

/** A slice map to write into: a copy, as a state the fold shares with a snapshot may hold the one there. */
function writable(state: WorldState, key: string): JsonObject {
  const s = state.packs.engine ?? {};
  state.packs.engine = s;
  const current: JsonObject = isRecord(s[key]) ? { ...(s[key] as JsonObject) } : {};
  s[key] = current;
  return current;
}

/** `engine.ws.write {path, hash}`: the file at `path` now has the blob `hash` as its body; writing the body it has changes nothing. */
export const wsWriteEvent: EventTypeDef<PackEvent> = {
  type: WS_WRITE,
  validate: (e) => {
    if (!isWorkspacePath(e.data.path)) return { code: "bad_event", reason: "a workspace file's path is names joined by /" };
    return isBlobHash(e.data.hash) ? null : { code: "bad_event", reason: "a workspace file's body is a blob's hash" };
  },
  apply: (e, state) => {
    if (isWorkspacePath(e.data.path) && isBlobHash(e.data.hash)) writable(state, WS_KEY)[e.data.path] = e.data.hash;
  },
  // Agent and GM bookkeeping, not a fact of the story: the player's Journal has no line for it.
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `workspace file ${String(e.data.path)} written`),
};

/** `engine.ws.delete {path}`: the file at `path` is gone, and its pin with it (and the readers an earlier build named). Refused when there is none, so a carried fix whose file is gone drops with a note. */
export const wsDeleteEvent: EventTypeDef<PackEvent> = {
  type: WS_DELETE,
  validate: (e, ctx) => {
    if (!isWorkspacePath(e.data.path)) return { code: "bad_event", reason: "a workspace file's path is names joined by /" };
    return own(workspaceOf(ctx.state), e.data.path) !== undefined ? null : { code: "missing_file", reason: `no workspace file ${e.data.path}` };
  },
  apply: (e, state) => {
    if (!isWorkspacePath(e.data.path)) return;
    delete writable(state, WS_KEY)[e.data.path];
    // Only a chat that pinned or shared something holds pins or readers to drop: one that never did gains no key.
    if (isRecord(state.packs.engine?.[PINS_KEY])) delete writable(state, PINS_KEY)[e.data.path];
    if (isRecord(state.packs.engine?.[READERS_KEY])) delete writable(state, READERS_KEY)[e.data.path];
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `workspace file ${String(e.data.path)} deleted`),
};

/** `engine.ws.pin {path, pinned}`: the file at `path` is pinned, or no longer. Refused when there is no such file. */
export const wsPinEvent: EventTypeDef<PackEvent> = {
  type: WS_PIN,
  validate: (e, ctx) => {
    if (!isWorkspacePath(e.data.path)) return { code: "bad_event", reason: "a workspace file's path is names joined by /" };
    if (typeof e.data.pinned !== "boolean") return { code: "bad_event", reason: "a pin is on or off" };
    return own(workspaceOf(ctx.state), e.data.path) !== undefined ? null : { code: "missing_file", reason: `no workspace file ${e.data.path}` };
  },
  apply: (e, state) => {
    if (!isWorkspacePath(e.data.path) || typeof e.data.pinned !== "boolean") return;
    const pins = writable(state, PINS_KEY);
    if (e.data.pinned) pins[e.data.path] = true;
    else delete pins[e.data.path];
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `workspace file ${String(e.data.path)} ${e.data.pinned === true ? "pinned" : "unpinned"}`),
};

/**
 * `engine.ws.readers {path, readers}`, an earlier build's: whose knowledge might read the file at
 * `path`. Every file is every agent's to read now, so nothing writes one; a recorded one still
 * validates and folds as it did, into an index nothing reads, so the chat replays as it was.
 */
export const wsReadersEvent: EventTypeDef<PackEvent> = {
  type: WS_READERS,
  validate: (e, ctx) => {
    if (!isWorkspacePath(e.data.path)) return { code: "bad_event", reason: "a workspace file's path is names joined by /" };
    if (!isAgentKnowledge(e.data.readers)) return { code: "bad_event", reason: "a file's readers are the player character's, everyone's or the GM's knowledge" };
    return own(workspaceOf(ctx.state), e.data.path) !== undefined ? null : { code: "missing_file", reason: `no workspace file ${e.data.path}` };
  },
  apply: (e, state) => {
    if (!isWorkspacePath(e.data.path) || !isAgentKnowledge(e.data.readers)) return;
    if (e.data.readers !== "gm") writable(state, READERS_KEY)[e.data.path] = e.data.readers;
    else if (isRecord(state.packs.engine?.[READERS_KEY])) delete writable(state, READERS_KEY)[e.data.path];
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `workspace file ${String(e.data.path)} read with ${e.data.readers === "pov" ? "the player character's" : e.data.readers === "everyone" ? "everyone's" : "the GM's"} knowledge`),
};
