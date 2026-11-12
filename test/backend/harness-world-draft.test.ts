// This chat's own world on the harness engine (DEPTH2-PLAN §2): an author's place and path are part
// of the chat's own record, walkable in the turn that laid them and gone with that turn; a whole turn
// is undone by the user's one act on the latest reply, refused while a turn is under way; and a type
// the user set to ask first still asks, where every other change lands.

import { describe, expect, test } from "bun:test";
import type { Chip } from "../../src/shared/state-view";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { AUTHOR, beginTurn, harnessChat, noModelCalls, stateOf } from "./harness-driver";

const MILL = "the_old_mill";

type Committed = { landed: string[][]; review: string[][]; refused: { lines: string[]; reason: string }[] };

/** Presses a chip's action, as the page does: the answer, or the refusal's words. */
async function press(rig: Rig, chatId: string, chip: string, choice: string): Promise<{ refused: string } | { done: true }> {
  const answer = await rig.send({ type: "lre.chip", chatId, chip, choice });
  return answer.type === "lre.error" ? { refused: answer.message } : { done: true };
}

const footers = async (rig: Rig, chatId: string): Promise<Chip[]> => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "turn");

describe("this chat's own world", () => {
  test("an author lays a place and a path, walks it in the same turn, and a swipe takes them away", async () => {
    const { rig, chatId } = await harnessChat();
    const first = await beginTurn(rig, chatId, "I walk out to the old mill past the creek.");
    const place = (await first.answer(AUTHOR, "world_place", { name: "The Old Mill", parent: HOME, description: "A weatherboard mill on the creek." })) as { place: string; next: string };
    expect(place.place).toBe(MILL);
    // Played at once: the author's next call finds the place and the way to it.
    expect(place.next).toContain("world_keep");
    await first.answer(AUTHOR, "world_path", { from: HOME, to: "The Old Mill", minutes: 25, km: 2 });
    const route = (await first.answer(AUTHOR, "places_route", { from: HOME, to: "The Old Mill" })) as { routes: { mode: string; minutes: number }[] };
    expect(route.routes).toContainEqual(expect.objectContaining({ mode: "walk", minutes: 25 }));
    await first.answer(AUTHOR, "gm_move", { entity: "pov", to: "The Old Mill" });
    const committed = (await first.answer(AUTHOR, "commit")).committed as Committed;
    expect(committed).toMatchObject({ review: [], refused: [] });
    // The world's document has none of it: it is this chat's own, and world_made says so.
    const made = (await first.answer(AUTHOR, "world_made", { kind: "world" })) as { world: { place?: string; path?: string; change: string }[] };
    expect(made.world).toContainEqual(expect.objectContaining({ place: MILL, change: "made" }));
    expect(made.world.some((w) => w.path !== undefined && w.change === "made")).toBe(true);
    await first.finish("The mill stands grey against the alders.");
    const played = await stateOf(rig, chatId);
    expect(played.entities.pov?.fields.place).toBe(MILL);

    // A swipe plays the turn afresh: what its author laid went with the swipe it was laid in.
    const again = await beginTurn(rig, chatId, null, { type: "swipe" });
    expect(await again.refusal(AUTHOR, "places_route", { from: HOME, to: "The Old Mill" })).toContain("The Old Mill");
    await again.finish("Nobody has heard of a mill past the creek.");
    const swiped = await stateOf(rig, chatId);
    expect(swiped.entities.pov?.fields.place).toBe(HOME);
    expect(swiped.packs.engine?.world).toBeUndefined();
    noModelCalls(rig);
  });

  test("Undo takes the latest reply and its whole turn away, and is refused while a turn is under way", async () => {
    const { rig, chatId } = await harnessChat();
    const first = await beginTurn(rig, chatId, "I take the lane north.");
    await first.answer(AUTHOR, "world_place", { name: "The Old Mill", parent: HOME });
    await first.answer(AUTHOR, "commit");
    await first.finish("The lane runs north to an old mill.");
    const before = await stateOf(rig, chatId);
    const [footer] = await footers(rig, chatId);
    expect(footer?.label).toContain("1 world edit");
    expect(footer?.actions.map((a) => a.id)).toEqual(["record", "undo"]);
    expect(footer?.turns?.length).toBe(1);

    const second = await beginTurn(rig, chatId, "I follow it to the water.");
    await second.answer(AUTHOR, "world_path", { from: HOME, to: "The Old Mill", minutes: 10 });
    await second.answer(AUTHOR, "gm_move", { entity: "pov", to: "The Old Mill" });
    await second.answer(AUTHOR, "commit");
    // Mid-turn, nothing is undone: the turn is under way.
    const refused = await press(rig, chatId, footer?.id ?? "", "undo");
    expect(refused).toEqual({ refused: expect.stringContaining("A turn is under way") });
    await second.finish("The mill wheel turns in the race.");
    const moved = await stateOf(rig, chatId);
    expect(moved.entities.pov?.fields.place).toBe(MILL);
    // Only the latest reply's turn is undone.
    const [olderFooter, latest] = await footers(rig, chatId);
    expect(await press(rig, chatId, olderFooter?.id ?? "", "undo")).toEqual({ refused: expect.stringContaining("Only the latest reply") });
    expect(latest?.actions.map((a) => a.id)).toEqual(["record", "undo"]);
    expect(olderFooter?.actions.map((a) => a.id)).toEqual(["record"]);
    expect(await press(rig, chatId, latest?.id ?? "", "undo")).toEqual({ done: true });
    await rig.host.settle();
    // The reply is gone, and the world is as the turn before left it.
    expect(rig.host.chat(chatId).messages.at(-1)?.isUser).toBe(true);
    const after = await stateOf(rig, chatId);
    expect(after.entities.pov?.fields.place).toBe(before.entities.pov?.fields.place);
    expect(after.clock).toBe(before.clock);
    expect(after.packs.engine?.world).toEqual(before.packs.engine?.world);
    noModelCalls(rig);
  });

  test("a type the user set to ask first still asks; the rest lands", async () => {
    const { rig, chatId } = await harnessChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_edit: { mode: "confirm" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask about the mill.");
    await turn.answer(AUTHOR, "world_place", { name: "The Old Mill", parent: HOME });
    // Only the user's own setting asks first: nothing of it plays until they apply it.
    const committed = (await turn.answer(AUTHOR, "commit")).committed as Committed;
    expect(committed.review.length).toBe(1);
    expect(committed.landed).toEqual([]);
    expect(await turn.refusal(AUTHOR, "places_read", { place: "The Old Mill" })).toContain("The Old Mill");
    await turn.finish("Mara shrugs: maybe there was a mill once.");
    noModelCalls(rig);
  });
});
