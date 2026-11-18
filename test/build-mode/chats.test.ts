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

  test("a world that is deleted leaves its chats with their record and the revision they played, playing no world, and a world can be attached to them again", async () => {
    const { bed, service } = rig();
    const s = bed.store.user(USER);
    const first = await service.create(USER, "Fernwick", "fantasy_town");
    const other = await service.create(USER, "Hollowmere", "mystery_manor");
    const lonely = await service.create(USER, "Nobody's", "fantasy_town");
    await bed.writes.run(() => s.createChat({ id: "c" }), "a chat that plays no world");
    const turn = await bed.writes.run(() => s.beginTurn({ chat: "c", kind: "normal" }), "a turn");
    await bed.writes.run(() => s.addChanges(turn.id, [tick(5)]), "its changes");
    await service.chats.attach(USER, first.world.id, "c");
    await bed.writes.run(() => s.tieTurn(turn.id, { message: "m1", hash: "h1", date: 1 }), "the turn is tied to its reply");
    expect(s.headState("c").state.world.revision).toBe(first.revision);
    // Which chats play it is what deleting it must name beforehand.
    expect((await service.chats.chatsOf(USER, { world: first.world.id })).map((c) => c.chat)).toEqual(["c"]);

    await service.remove(USER, first.world.id);
    // The world is gone from his worlds; the chat plays none, keeps its record and the revision it played, and the revision is still there to read.
    expect((await service.list(USER)).map((w) => w.id).sort()).toEqual([lonely.world.id, other.world.id].sort());
    expect(s.chat("c")?.world).toBeNull();
    expect(s.headState("c").state.world.revision).toBe(first.revision);
    expect(bed.store.env.worlds(first.revision)?.name).toBe("Fernwick");
    // A world no chat plays goes whole, its revisions too.
    await service.remove(USER, lonely.world.id);
    expect(s.worldRevisions(lonely.world.id)).toEqual([]);

    // It takes a world again, from the revision it plays.
    const attached = await service.chats.attach(USER, other.world.id, "c");
    expect(attached).toMatchObject({ attached: true, revision: other.revision });
    expect(s.chat("c")?.world).toBe(other.world.id);
    expect(s.headState("c").state.world.revision).toBe(other.revision);
    expect((await service.chats.chatsOf(USER, { world: other.world.id })).map((c) => c.chat)).toEqual(["c"]);
  });
});
