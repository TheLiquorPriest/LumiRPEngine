// What else time brings due besides schedules: a future's arrival, a need crossing its line, an effect ending, and each kept to the part asked about.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { timeDue } from "../../src/store/due";
import { STORY_STORE_AREA } from "../../src/story/fold";
import { inventedWorld, play, testStore } from "./fixtures";

describe("what time brings due besides schedules", () => {
  test("a scheduled arrival, a need crossing its line and an effect ending are listed for the span, each for its part of the tree, and nothing is changed", () => {
    const world = inventedWorld();
    const ts = testStore({ world });
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
    const from = ts.s.headState("c").state.world.clock;
    const future = { part: "future", item: "fu-1", value: { text: "Odile reaches the inn at dusk.", due: from + 120, who: ["Odile"], place: "The Lamp and Ladle" } };
    play(ts.s, "c", "m2", "Odile is expected.", 2, [{ lane: "story", op: "story.write", value: future, by: "author" }]);
    const state = structuredClone(ts.s.headState("c").state);
    state.world.entities.tam.relations.push({ type: "uses", to: "purse", until: from + 300 });
    const before = hashJson(state);
    const due = timeDue(ts.store);
    const span = { from, to: from + 16 * 60 };
    const listed = due.due(state, span, null, Number.POSITIVE_INFINITY).items.filter((i) => ["future", "ending", "need"].includes(i.kind));
    expect(listed.map((i) => [i.at - from, i.kind, i.who, i.where])).toEqual([
      [120, "future", ["odile"], "place:lamp_ladle"],
      [300, "ending", ["tam"], undefined],
      [15 * 60, "need", [world.pov], undefined],
    ]);
    expect(due.due(state, span, "entity:bram", Number.POSITIVE_INFINITY).items.filter((i) => ["future", "ending", "need"].includes(i.kind))).toEqual([]);
    expect(due.due(state, span, "entity:odile", Number.POSITIVE_INFINITY).items.map((i) => i.kind)).toEqual(["future"]);
    expect(hashJson(state)).toBe(before);
  });
});

describe("a principal out of view", () => {
  test("an intention with a time that falls in the span is listed with who, from where and to where, and nothing about them changes", () => {
    const world = inventedWorld();
    // The cast's area reads its away principals as the store asks: a fake of it, the shape alone, its time set once the clock is known.
    let until = 0;
    const cast = { id: "cast", initial: () => ({}), ops: {}, reads: { away: () => [{ id: "away:c-1", character: "c-1", name: "Odile", ref: "entity:odile", whereabouts: "on the far road", place_ref: "place:far_road", names: ["The Lamp and Ladle"], name_refs: ["place:lamp_ladle"], intention: "to reach the inn at dusk", until_at: until }] } };
    const ts = testStore({ world, areas: [STORY_STORE_AREA, cast as never] });
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
    const state = structuredClone(ts.s.headState("c").state);
    const from = state.world.clock;
    until = from + 600;
    const before = hashJson(state);
    const due = timeDue(ts.store);
    const items = (span: { from: number; to: number }, where: string | null) => due.due(state, span, where, Number.POSITIVE_INFINITY).items.filter((i) => i.kind === "arrival");
    expect(items({ from, to: from + 660 }, null).map((i) => [i.at - from, i.who, i.where, i.what])).toEqual([[600, ["odile"], "place:lamp_ladle", { character: "Odile", from: "place:far_road", to: "place:lamp_ladle", intention: "to reach the inn at dusk" }]]);
    // A span that does not hold the time lists nothing; a part of the tree it does not touch neither.
    expect(items({ from, to: from + 599 }, null)).toEqual([]);
    expect(items({ from, to: from + 660 }, "entity:bram")).toEqual([]);
    expect(hashJson(state)).toBe(before);
  });
});
