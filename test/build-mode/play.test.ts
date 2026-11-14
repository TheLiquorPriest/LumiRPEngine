// A world Build makes is one a chat can play: every revision Build commits is kept in RPE's store,
// and Attach sets the revision a chat plays there.

import { describe, expect, test } from "bun:test";
import type { ChangeInput } from "../../src/store";
import { storedWorlds } from "../../src/store";
import { body, type Bed, makeBed, makePage, OTHER, type Page, refusal, USER, words } from "./bed";

/** A world made from a starter template, with a kind of its own added and committed: its id and both revisions. */
async function committedWorld(page: Page): Promise<{ worldId: string; first: string; second: string }> {
  const made = body(await page.send({ type: "lre.world", op: "create", name: "Fernwick", template: "fantasy_town" }), "lre.world");
  const worldId = made.world?.id ?? "";
  const first = made.revision ?? "";
  await page.send({ type: "lre.editor", op: "put", worldId, base: first, collection: "kinds", id: "lamplighter", value: { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} } });
  const second = body(await page.send({ type: "lre.world", op: "commit", worldId, base: first }), "lre.world").revision ?? "";
  return { worldId, first, second };
}

/** One turn of the chat's, with what the engine recorded in it. */
async function playTurn(bed: Bed, chat: string, changes: ChangeInput[]) {
  const s = bed.store.user(USER);
  const turn = await bed.writes.run(() => s.beginTurn({ chat, kind: "normal" }), "a turn");
  return { turn, ...(await bed.writes.run(() => s.addChanges(turn.id, changes), "the turn's changes")) };
}

const tick = (minutes: number): ChangeInput => ({ lane: "engine", op: "clock", value: { type: "clock", minutes, cause: "tick" }, by: "gm", source: "gm" });

describe("a world Build makes is playable", () => {
  test("each revision Build commits is readable through the store's own reader", async () => {
    const bed = makeBed();
    const { worldId, first, second } = await committedWorld(makePage(bed));
    const read = storedWorlds(bed.db);
    expect(read(first)?.kinds.lamplighter).toBeUndefined();
    expect(read(second)?.kinds.lamplighter?.label).toBe("Lamplighter");
    expect(bed.store.user(USER).worldRevisions(worldId).map((r) => r.revision)).toEqual([first, second]);
  });

  test("a chat attached to a committed revision plays it", async () => {
    const bed = makeBed();
    const page = makePage(bed);
    const { worldId, second } = await committedWorld(page);
    expect(body(await page.send({ type: "lre.world", op: "attach", worldId, chatId: "chat-lantern" }), "lre.world")).toEqual({ revision: second });

    const s = bed.store.user(USER);
    expect(s.chat("chat-lantern")).toMatchObject({ world: worldId, revision: second });
    const doc = storedWorlds(bed.db)(second);
    const place = Object.keys(doc?.places ?? {})[0] ?? "";
    const pov = doc?.pov ?? "";
    const played = await playTurn(bed, "chat-lantern", [{ lane: "engine", op: "set", value: { type: "set", entity: pov, field: "place", value: place }, by: "gm", source: "gm" }]);
    expect(played.changes.map((c) => c.applied)).toEqual([true]);
    expect({ revision: played.state.world.revision, place: played.state.world.entities[pov]?.fields.place }).toEqual({ revision: second, place });
  });

  test("a chat that plays no world yet takes one at once, its turns folded again from the world's start", async () => {
    const bed = makeBed();
    const page = makePage(bed);
    const { worldId, second } = await committedWorld(page);
    const s = bed.store.user(USER);
    await bed.writes.run(() => s.createChat({ id: "chat-plain" }), "a chat RPE played on no world");
    const { turn } = await playTurn(bed, "chat-plain", [tick(30)]);
    expect(s.stateAt(turn.id).state.world.revision).not.toBe(second);

    expect(body(await page.send({ type: "lre.world", op: "attach", worldId, chatId: "chat-plain" }), "lre.world")).toEqual({ revision: second });
    const start = s.startOf(turn.id).state.world;
    const now = s.stateAt(turn.id).state.world;
    expect({ start: start.revision, revision: now.revision, clock: now.clock }).toEqual({ start: second, revision: second, clock: start.clock + 30 });
    expect(now.entities[storedWorlds(bed.db)(second)?.pov ?? ""]).toBeDefined();
  });

  test("a chat that plays a world keeps it, and the answer says what was done and why", async () => {
    const bed = makeBed();
    const page = makePage(bed);
    const { worldId, second } = await committedWorld(page);
    await page.send({ type: "lre.world", op: "attach", worldId, chatId: "chat-lantern" });
    // Attaching it again to the revision it plays is no change.
    expect(body(await page.send({ type: "lre.world", op: "attach", worldId, chatId: "chat-lantern" }), "lre.world")).toEqual({ revision: second });
    await page.send({ type: "lre.editor", op: "put", worldId, base: second, collection: "kinds", id: "ferryman", value: { id: "ferryman", label: "Ferryman", extends: "person", fields: {} } });
    const third = body(await page.send({ type: "lre.world", op: "commit", worldId, base: second }), "lre.world").revision ?? "";
    expect(third).not.toBe(second);
    const again = refusal(await page.send({ type: "lre.world", op: "attach", worldId, chatId: "chat-lantern" }));
    expect({ code: again.code, message: again.message }).toEqual({ code: "conflict", message: words("attach_kept", { world: "Fernwick", revision: second, asked: "Fernwick", to: third }) });

    const other = body(await page.send({ type: "lre.world", op: "create", name: "Saltmarsh", template: "mystery_manor" }), "lre.world");
    const elsewhere = refusal(await page.send({ type: "lre.world", op: "attach", worldId: other.world?.id ?? "", chatId: "chat-lantern" }));
    expect({ code: elsewhere.code, message: elsewhere.message }).toEqual({ code: "conflict", message: words("attach_kept", { world: "Fernwick", revision: second, asked: "Saltmarsh", to: other.revision }) });
    expect(bed.store.user(USER).chat("chat-lantern")).toMatchObject({ world: worldId, revision: second });

    // Another user can attach none of this user's worlds.
    expect(refusal(await page.send({ type: "lre.world", op: "attach", worldId, chatId: "chat-birch" }, OTHER)).code).toBe("not_found");
    expect(bed.store.user(OTHER).chat("chat-birch")).toBeNull();
  });
});
