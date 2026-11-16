// What else time brings due besides schedules: a future's arrival, a need crossing its line, an effect ending, and each kept to the part asked about.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { timeDue } from "../../src/store/due";
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
