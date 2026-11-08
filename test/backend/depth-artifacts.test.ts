// Agent artifacts the views reach (DEPTH-PLAN §1.4, §9.1; conformance finding 9): each play's private
// take rides in its turn's record, and GM → Depth → Turn reads it there, in the order the scene played
// it, with the beat it played and what it had just lived.

import { describe, expect, test } from "bun:test";
import { sceneView, type SceneViewRt } from "../../src/backend/depth/scene/scene-view";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import type { LedgerCore } from "../../src/engine/ledger/journal";
import { mindTakeEvent } from "../../src/shared/character-engine";
import type { Rec } from "../../src/shared/ledger";
import { blobHash } from "../../src/shared/stores";
import { type Beat, beatEvent } from "../../src/shared/story";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const world = modernUsWorld("w", "R");
const state = startState(world);

describe("GM → Depth → Turn", () => {
  test("each play's take shows with the beat it played, what it had just lived, and its text", async () => {
    const said: Beat = { id: "b1", at: 600, order: 0, place: "cafe", actors: ["maya"], act: "said", about: [], what: blobHash("Maya says they're closed."), surface: blobHash("Maya, back turned, says they're closed."), exposure: [{ who: world.pov, channel: "hearing", reach: "whole" }], by: { turn: "t1", decided: "character" } };
    const played = mindTakeEvent({ who: "maya", at: 600, lived: ["b0"], beat: "b1", take: "Not him again. Say we're closed and don't turn around." });
    const watched = mindTakeEvent({ who: "jordan", at: 601, lived: ["b1"], take: "She's lying. Why?" });
    const texts = new Map<string, string>([...Object.entries(played.blobs), ...Object.entries(watched.blobs)]);
    const rec = { v: 1, defHash: "r", seq: 7, swipeHash: { hash: "h", len: 1 }, path: "p", seed: "s", pre: 3, events: [beatEvent(said), played.event, watched.event], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} } as unknown as Rec;
    const observed: ChainMessage[] = [
      { id: "m1", isUser: true, swipeId: 0, swipes: ["Coffee?"], ledger: null },
      { id: "m2", isUser: false, swipeId: 0, swipes: ["“We're closed.”"], ledger: { v: 1, swipes: { "0": rec }, markers: [] } },
    ];
    const core = { chain: (o: ChainMessage[]) => o, journal: { tombstones: [] } } as unknown as LedgerCore;
    const rt: SceneViewRt = {
      ledger: {
        with: async (_chat, _user, op) => {
          await op(core, observed);
        },
      },
      blobs: { get: async (_user, hash) => texts.get(hash) ?? null },
      inspector: { load: async () => ({ userId: "u", records: [] }) },
      host: { chats: { messages: async () => [] }, connections: { list: async () => [] } },
    };
    const view = await sceneView(rt, { state, world }, "c", "u");
    expect(view.takes.map((t) => [t.who, t.beat, t.lived, t.text])).toEqual([
      ["maya", 1, 1, "Not him again. Say we're closed and don't turn around."],
      ["jordan", null, 1, "She's lying. Why?"],
    ]);
  });

  test("each model call shows its connection by name, as Settings shows it, and by its id only once Lumiverse no longer has it (LIVE3 lane 1b)", async () => {
    // The live case: every call showed its connection as c7c0f78d-…, never DeepSeek (d0a scratch).
    const said: Beat = { id: "b1", at: 600, order: 0, place: "cafe", actors: ["maya"], act: "said", about: [], what: blobHash("Maya says they're closed."), surface: blobHash("Maya, back turned, says they're closed."), exposure: [{ who: world.pov, channel: "hearing", reach: "whole" }], by: { turn: "t1", decided: "character" } };
    const rec = { v: 1, defHash: "r", seq: 7, swipeHash: { hash: "h", len: 1 }, path: "p", seed: "s", pre: 1, events: [beatEvent(said)], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} } as unknown as Rec;
    const observed: ChainMessage[] = [
      { id: "m1", isUser: true, swipeId: 0, swipes: ["Coffee?"], ledger: null },
      { id: "m2", isUser: false, swipeId: 0, swipes: ["“We're closed.”"], ledger: { v: 1, swipes: { "0": rec }, markers: [] } },
    ];
    const core = { chain: (o: ChainMessage[]) => o, journal: { tombstones: [] } } as unknown as LedgerCore;
    const calls = [
      { role: "author", connection: "c7c0f78d-1111", model: "deepseek-v4-flash", requestId: null, ms: 4000 },
      { role: "check", connection: "c7c0f78d-1111", model: "deepseek-v4-flash", requestId: null, ms: 900 },
      { role: "pov", connection: "deleted-2222", model: "deepseek-v4-flash", requestId: null, ms: 700 },
    ];
    const rt: SceneViewRt = {
      ledger: {
        with: async (_chat, _user, op) => {
          await op(core, observed);
        },
      },
      blobs: { get: async () => null },
      inspector: { load: async () => ({ userId: "u", records: [{ id: "g1", at: 0, activation: "confirmed", sections: [], budget: { sections: 0, used: 0 }, forced: [], provenance: { calls, turnMs: 9000, firstContentMs: 2000, reply: { messageId: "m2", swipeId: 0 } } }] }) },
      host: { chats: { messages: async () => [] }, connections: { list: async () => [{ id: "c7c0f78d-1111", name: "DeepSeek (d0a scratch)" }] } },
    };
    const view = await sceneView(rt, { state, world }, "c", "u");
    expect(view.provenance?.calls.map((c) => [c.role, c.connection])).toEqual([
      ["author", "DeepSeek (d0a scratch)"],
      ["check", "DeepSeek (d0a scratch)"],
      ["pov", "deleted-2222"],
    ]);
  });
});
