// What the backend keeps in memory stays bounded as chats, turns and world revisions grow, and what
// it lets go is rebuilt as it was: world revisions (a large world is several MB once parsed), open
// chats' ledgers, the views pushed to pages, and the lore an engine run read live.

import { describe, expect, test } from "bun:test";
import { OPEN_CHATS_CAP } from "../../src/backend/ledger-io";
import { VIEWS_KEPT } from "../../src/backend/push";
import { LIVE_LORES_KEPT } from "../../src/backend/runtime";
import { REVISION_CACHE_CAP } from "../../src/backend/worlds";
import type { BackendToFrontend } from "../../src/shared/protocol";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** The engine's in-memory maps a test reads (private to their classes). */
function held(rig: Rig): { slots: number; liveLores: number } {
  const ledger = rig.rt.ledger as unknown as { chats: Map<string, unknown> };
  const rt = rig.rt as unknown as { liveLores: Map<string, unknown> };
  return { slots: ledger.chats.size, liveLores: rt.liveLores.size };
}

/** The parts of a chat's view a page shows, without what a new rev or a moment changes. */
async function shown(rig: Rig, chatId: string): Promise<string> {
  const view = await rig.rt.view(chatId, rig.host.userId);
  return JSON.stringify({ revision: view.revision, status: view.status, hud: view.hud, chips: view.chips, journal: view.journal, scene: view.scene });
}

async function commit(rig: Rig, worldId: string, n: number): Promise<void> {
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "checks", id: `bound_${n}`, value: { id: `bound_${n}`, dice: "1d2", bands: [{ outcome: "fail", max: 1 }, { outcome: "success", min: 2 }] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
}

describe("memory bounds", () => {
  test("a world committed past the revision cache keeps a few revisions loaded; a chat at an evicted revision still plays it, from the one copy it pins", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    if (!run) throw new Error("no run");
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    const before = await shown(rig, chatId);
    for (let n = 0; n < REVISION_CACHE_CAP + 6; n++) await commit(rig, run.worldId, n);
    const loaded = rig.rt.worlds.loaded();
    expect(loaded.kept).toBeLessThanOrEqual(REVISION_CACHE_CAP);
    // The chat's revision left the cache, but its ledger pins it: found again, not read a second time.
    const pinned = rig.rt.worlds.cached(rig.host.userId, run.worldId, run.revision);
    expect(pinned).toBeDefined();
    expect(rig.rt.worlds.cached(rig.host.userId, run.worldId, run.revision)).toBe(pinned);
    expect(await rig.rt.revisionInPlay(chatId, rig.host.userId, run)).toEqual({ revision: run.revision });
    expect(await shown(rig, chatId)).toBe(before);
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    expect((await rig.rt.view(chatId, rig.host.userId)).revision).toBe(run.revision);
  });

  test("past the open chats kept, idle chats let go of their ledgers and open again as they were", async () => {
    const rig = new Rig();
    const chats: string[] = [];
    const views: string[] = [];
    for (let n = 0; n < OPEN_CHATS_CAP + 4; n++) {
      const chatId = await rig.worldChat();
      rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: n % 2 === 0 ? "calm" : "tense" }));
      chats.push(chatId);
      views.push(await shown(rig, chatId));
    }
    expect(held(rig).slots).toBeLessThanOrEqual(OPEN_CHATS_CAP);
    for (const [i, chatId] of chats.entries()) expect(await shown(rig, chatId)).toBe(views[i] ?? "");
    await rig.turn(chats[0] ?? "", "I look around.", "The square is quiet.");
    expect(await rig.cashOf(chats[0] ?? "")).toBeDefined();
  });

  test("a chat whose reply the engine prepared keeps its ledger while other chats open, and the reply takes that turn", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    const [ask] = rig.host.restarts.splice(0);
    expect(ask?.session).toBe("desk");
    for (let n = 0; n < OPEN_CHATS_CAP + 2; n++) rig.body(await rig.send({ type: "lre.fix", chatId: await rig.worldChat(), entity: POV, field: "mood", value: "calm" }));
    expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn: ask?.turn ?? "" }, "desk")).start).toBe(true);
    const reply = await rig.host.begin(chatId, { type: "regenerate", session: "desk" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "The square is quiet.");
    expect(rig.host.chat(chatId).messages.filter((m) => !m.isUser).at(-1)?.swipes).toEqual(["The square is quiet."]);
  });

  test("views are kept for the chats pushed lately; a page on one let go gets a snapshot, then deltas, and no rev is ever reused", async () => {
    const rig = new Rig();
    const chats: string[] = [];
    for (let n = 0; n < VIEWS_KEPT + 4; n++) {
      const chatId = await rig.worldChat();
      rig.body(await rig.send({ type: "lre.hello", chatId }, `page-${n}`));
      chats.push(chatId);
    }
    expect(rig.rt.push.kept()).toBeLessThanOrEqual(VIEWS_KEPT);
    const first = chats[0] ?? "";
    const from = rig.host.sent.length;
    rig.body(await rig.send({ type: "lre.fix", chatId: first, entity: POV, field: "mood", value: "calm" }));
    rig.body(await rig.send({ type: "lre.fix", chatId: first, entity: POV, field: "mood", value: "tense" }));
    const pushes = rig.host.sent.slice(from).filter((m): m is Extract<BackendToFrontend, { type: "lre.state.snapshot" | "lre.state.delta" }> => (m.type === "lre.state.snapshot" || m.type === "lre.state.delta") && m.chatId === first);
    expect(pushes.map((m) => m.type)).toEqual(["lre.state.snapshot", "lre.state.delta"]);
    expect(JSON.stringify(rig.latestView(first))).toContain("tense");
    // Every push takes a new rev: the let-go chat's snapshot is past every rev its pages held, and no delta's rev repeats.
    const earlier = rig.host.sent.slice(0, from).flatMap((m) => ((m.type === "lre.state.snapshot" || m.type === "lre.state.delta") && m.chatId === first ? [m.rev] : []));
    expect(pushes[0]?.rev ?? 0).toBeGreaterThan(Math.max(...earlier));
    const deltas = rig.host.sent.flatMap((m) => (m.type === "lre.state.delta" ? [m.rev] : []));
    expect(new Set(deltas).size).toBe(deltas.length);
  });

  test("an engine run's live lore is kept for the latest runs only", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    for (let t = 0; t < LIVE_LORES_KEPT + 4; t++) await rig.turn(chatId, `I look around, ${t}.`, `The square is quiet (${t}).`);
    expect(held(rig).liveLores).toBeLessThanOrEqual(LIVE_LORES_KEPT);
    expect(await rig.cashOf(chatId)).toBeDefined();
  });
});
