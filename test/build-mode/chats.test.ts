// A world's chats, attaching and moving a chat on from its next turn: his own changes, which the running turn does not see.

import { describe, expect, test } from "bun:test";
import { LiveHub } from "../../src/app";
import { BLANK_REVISION, type ChangeInput } from "../../src/store";
import { WorldService } from "../../src/worlds/service";
import { makeBed, USER } from "./bed";

const tick = (minutes: number): ChangeInput => ({ lane: "engine", op: "clock", value: { type: "clock", minutes, cause: "tick" }, by: "gm", source: "gm" });

function rig() {
  const bed = makeBed();
  const running = new Set<string>();
  // Lumiverse has every chat but "ghost".
  const service = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log, chats: { live: new LiveHub({ queueEvents: 16, now: () => 0 }), turning: (_user, chat) => running.has(chat), name: async (chat) => `Chat ${chat}`, has: async (chat) => chat !== "ghost" } });
  return { bed, service, running };
}

describe("a world's chats", () => {
  test("attach during a run: the running turn has no world, the next plays the revision; an Upgrade then moves it on, and its Undo takes it back", async () => {
    const { bed, service, running } = rig();
    const s = bed.store.user(USER);
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    const world = made.world.id;
    await bed.writes.run(() => s.createChat({ id: "c" }), "a chat that plays no world");
    const first = await bed.writes.run(() => s.beginTurn({ chat: "c", kind: "normal" }), "a turn");
    await bed.writes.run(() => s.addChanges(first.id, [tick(5)]), "its changes");
    running.add("c");
    const attached = await service.chats.attach(USER, world, "c");
    expect(attached).toMatchObject({ attached: true, revision: made.revision, waiting: true });
    expect(s.chat("c")?.world).toBe(world);
    // The turn that runs keeps the state it started with; the next one plays the world.
    expect(s.stateAt(first.id).state.world.revision).toBe(BLANK_REVISION);
    await bed.writes.run(() => s.tieTurn(first.id, { message: "m1", hash: "h1", date: 1 }), "the turn is tied to its reply");
    running.delete("c");
    expect(s.headState("c").state.world.revision).toBe(made.revision);
    expect((await service.chats.chatsOf(USER, { world })).map((c) => [c.chat, c.name, c.revision, c.behind])).toEqual([["c", "Chat c", made.revision, false]]);
    // Attached again, to a chat that plays it: nothing is written.
    expect((await service.chats.attach(USER, world, "c")).attached).toBe(false);

    // The world goes on: a new revision, which the chat is behind.
    await service.draft(USER, world, { op: "put", collection: "kinds", id: "lamplighter", value: { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} } });
    const next = await service.commit(USER, world, { base: made.revision, source: "build" });
    expect((await service.chats.chatsOf(USER, { chat: "c" })).map((c) => [c.behind, c.head])).toEqual([[true, next.revision]]);
    const preview = await service.chats.preview(USER, "c", next.revision);
    expect({ from: preview.from, to: preview.to }).toEqual({ from: made.revision, to: next.revision });
    const moved = await service.chats.upgrade(USER, "c", next.revision);
    expect(moved).toMatchObject({ revision: next.revision, applied: true });
    expect(s.headState("c").state.world.revision).toBe(next.revision);
    expect((await service.chats.chatsOf(USER, { chat: "c" })).map((c) => c.behind)).toEqual([false]);

    expect(await service.chats.undoUpgrade(USER, "c", moved.edit ?? "")).toEqual({ undone: true, words: "" });
    expect(s.headState("c").state.world.revision).toBe(made.revision);
    expect((await service.chats.undoUpgrade(USER, "c", moved.edit ?? "")).undone).toBe(false);
  });

  test("a world is not attached to a chat Lumiverse does not have among the user's: it is refused in words and nothing is kept", async () => {
    const { bed, service } = rig();
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    await expect(service.chats.attach(USER, made.world.id, "ghost")).rejects.toThrow("not one of your chats in Lumiverse");
    expect(bed.store.user(USER).chat("ghost")).toBeNull();
    expect(await service.chats.chatsOf(USER, { chat: "ghost" })).toEqual([]);
  });
});
