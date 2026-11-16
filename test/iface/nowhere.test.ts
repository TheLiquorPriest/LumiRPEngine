// Nothing is put at a place the world does not have. A horizon entry written as a reference that
// names nothing is answered as not there, with its near names; and where code chooses the place
// for something said to be somewhere in words, a recorded horizon naming a place that is not there
// is passed over. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../src/engine/places-in-play";
import { HORIZON, horizonOf } from "../../src/store";
import { rig, texts, wordsFromFiles } from "./rig";

const src = { from: "prose", message: "m-60" };

describe("never at a place that is not there", () => {
  test("a horizon entry written as a reference to a place that is not there is not there, and nothing is recorded", async () => {
    const t = await rig({}, "blank");
    const r = await t.call("world_apply", { operations: [{ op: "place", kind: "place", name: "Gull Skerry", source: src }, { op: "horizon", list: ["place:keepers_kitchen"] }] });
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.startsWith("Operation 2 (horizon): there is nothing called place:keepers_kitchen"))).toBe(true);
    expect(texts(r).some((x) => x.includes("kept on the horizon as words"))).toBe(false);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });

  test("a horizon recorded with a place that is not there sends nothing made in words to it", async () => {
    const t = await rig({}, "blank");
    const made = await t.call("world_apply", { operations: [{ op: "place", kind: "place", name: "Gull Skerry", source: src }] });
    expect(made.error).toBeUndefined();
    // As a horizon recorded before entries like this were refused, or by any other way in.
    await t.writes.run(() => t.s.addChanges(t.turn.id, [{ lane: "story", op: HORIZON.op, value: { list: [{ at: "place:keepers_kitchen", depth: "full" }] }, by: "author-1" }]));
    const person = await t.call("world_apply", { operations: [{ op: "spawn", kind: "person", name: "Ida Pell", at: "the back room", source: src }] });
    const thing = await t.call("world_apply", { operations: [{ op: "spawn", name: "Wet coat", on: "the peg by the stove", source: src }] });
    const state = t.s.stateAt(t.turn.id).state;
    const doc = t.deps.env.worlds(state.world.revision);
    if (!doc) throw new Error("no blank world");
    const places = new Set(Object.keys(playedWorld(doc, state.world).places));
    for (const r of [person, thing]) {
      // With nowhere the world has to put them, they are made at no place, their words kept, and nothing is refused.
      expect(r.error).toBeUndefined();
      wordsFromFiles(r);
    }
    for (const e of Object.values(state.world.entities)) {
      const at = e.fields.place;
      if (typeof at === "string") expect(places.has(at)).toBe(true);
    }
    expect(Object.values(state.world.entities).map((e) => e.name)).toEqual(expect.arrayContaining(["Ida Pell", "Wet coat"]));
    expect(horizonOf(t.deps.env, state).map((h) => h.at)).toEqual(["place:keepers_kitchen"]);
  });
});
