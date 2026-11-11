// The author's skills walked through the bridge's own turn (`harness-driver.ts`), one tool call
// after another as an author's would be: what a tool stages is committed, carded and recorded as a
// real turn's is, and the next turn reads the world the last one left. No test here scripts a model:
// every decision is a tool call the test makes as the author.

import { describe, expect, test } from "bun:test";
import { HOME } from "../support/tools";
import { turnChat } from "./harness-cast-kit";
import { AUTHOR, beginTurn, noModelCalls, stateOf } from "./harness-driver";

const MILL = "the_old_mill";

describe("building a world (the skill, walked)", () => {
  test("a place, its paths, its people: written to the world's document in one turn, played in the next", async () => {
    const { rig, chatId } = await turnChat();
    // New people and the world's document land with the turn here; as shipped both wait on the review card (`harness-cast-people.test.ts`, `harness-cast-world.test.ts`).
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { gm_spawn: { mode: "auto" }, world_document: { mode: "auto" } } } }));

    // The first turn writes the world's document: a place of the world's own, and the way to it.
    const first = await beginTurn(rig, chatId, "I ask Mara whether the old mill past the creek still stands.");
    const status = (await first.answer(AUTHOR, "world_status")) as { playing: string; head: string; behind: boolean; draft: { stored: boolean } };
    expect(status).toMatchObject({ behind: false, draft: { stored: false } });
    expect(await first.refusal(AUTHOR, "places_read", { place: "The Old Mill" })).toContain("The Old Mill");
    const place = (await first.answer(AUTHOR, "world_place", { name: "The Old Mill", parent: "port_alder", description: "A weatherboard mill on the creek, its wheel long still." })) as { place: string; next: string };
    expect(place.place).toBe(MILL);
    // Every write says the draft isn't played yet, and how it comes to be.
    expect(place.next).toContain("world_commit");
    expect(place.next).toContain("world_upgrade");
    const path = (await first.answer(AUTHOR, "world_path", { from: HOME, to: "The Old Mill", minutes: 25, km: 2 })) as { route: string };
    expect(path.route).toBe(`rt_${HOME}_${MILL}`);
    // Still the draft's alone: the chat plays what it played.
    expect(await first.refusal(AUTHOR, "places_read", { place: "The Old Mill" })).toContain("The Old Mill");
    // Asked for in order and staged like every other change: the commit, then the move to what it makes.
    await first.answer(AUTHOR, "world_commit", { note: "The old mill and the way to it" });
    await first.answer(AUTHOR, "world_upgrade");
    // Both are made when the author commits; inside a turn the move waits for the turn's end, and the answer says so.
    const made = (await first.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect(made).toMatchObject({ review: [], refused: [] });
    expect(made.landed.flat().join("\n")).toContain("turn's end");
    await first.finish('Mara nods toward the creek. "Standing, yes. Working, no."');
    expect((await stateOf(rig, chatId)).revision).not.toBe(status.playing);

    // The next turn plays it: the way is found, and people and things are made there.
    const second = await beginTurn(rig, chatId, "I walk out to the mill.");
    const route = (await second.answer(AUTHOR, "places_route", { from: HOME, to: "The Old Mill" })) as { routes: { mode: string; minutes: number; distanceKm?: number }[] };
    expect(route.routes).toContainEqual(expect.objectContaining({ mode: "walk", minutes: 25, distanceKm: 2 }));
    const person = (await second.answer(AUTHOR, "person_make", { name: "Brann", place: "The Old Mill", why: "the miller's grandson still keeps the place", fields: JSON.stringify({ occupation: "caretaker" }), holds: [{ name: "a ring of keys" }], mind: { intent: "Find out what the visitor wants with the mill." } })) as { made: { id: string }; refused?: unknown[] };
    expect(person.made.id).toBe("brann");
    expect(person.refused).toBeUndefined();
    await second.answer(AUTHOR, "item_make", { name: "a grain sack", at: "The Old Mill", why: "sacks still lie about the mill floor" });
    const landed = (await second.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect(landed).toMatchObject({ review: [], refused: [] });
    expect(landed.landed).toHaveLength(5);
    const there = (await second.answer(AUTHOR, "places_contents", { place: "The Old Mill" })) as { people: { id: string }[]; things: { name: string }[] };
    expect(there.people.map((p) => p.id)).toEqual(["brann"]);
    expect(there.things.map((t) => t.name)).toEqual(["a grain sack"]);
    await second.finish("The mill stands grey against the alders. A man with a ring of keys watches from the door.");
    const state = await stateOf(rig, chatId);
    expect(state.entities.brann).toMatchObject({ name: "Brann", fields: { place: MILL, occupation: "caretaker" } });
    noModelCalls(rig);
  });
});
