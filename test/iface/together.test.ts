// Calls of one turn made at the same moment, as the model's tool calls of one message are run: each is
// worked out on what the other left, so no answer says something the store does not hold, and two
// rolls made at once for the same person draw different dice.

import { describe, expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

const SRC = { source: { from: "prose", message: "m-30" } };

function operations(r: ToolResult): JsonObject[] {
  return dataOf(r).operations as JsonObject[];
}

describe("calls made at once", () => {
  test("two calls made at once are each worked out on what the other left, and every answer holds in the store", async () => {
    const t = await rig();
    const [a, b] = await Promise.all([
      t.call("world_apply", { operations: [{ op: "spawn", name: "Gate guard", bestiary: "town_guard", at: "market_square", ...SRC }] }),
      t.call("world_apply", { operations: [{ op: "spawn", name: "Gate guard", bestiary: "town_guard", at: "common_room", ...SRC }, { op: "give", what: "knife", to: "Gate guard", how: "handed", ...SRC }] }),
    ]);
    if (a === undefined || b === undefined) throw new Error("two answers");
    const rows = t.s.changes(t.turn.id);
    // Nothing recorded fails to apply: no call was recorded on a state another had already changed.
    expect(rows.filter((r) => !r.applied)).toEqual([]);
    const world = t.s.stateAt(t.turn.id).state.world;
    const answered = [
      { r: a, at: "market_square" },
      { r: b, at: "common_room" },
    ].filter((x) => x.r.error === undefined);
    expect(answered.length).toBeGreaterThan(0);
    for (const { r, at } of answered) {
      expect(operations(r).every((o) => o.applied === true)).toBe(true);
      const made = String(operations(r)[0]?.made);
      // The guard each answer says it made is in the store, where that call put it.
      expect(world.entities[made]?.fields.place).toBe(at);
      if (r === b) expect(world.entities.knife?.relations.some((x) => x.type === "in" && x.to === made)).toBe(true);
      wordsFromFiles(r);
    }
    // A call that could no longer be read on what the other left was refused whole: it says why, and records nothing.
    for (const r of [a, b].filter((x) => x.error === true)) {
      expect(texts(r).some((x) => x.includes("fits more than one"))).toBe(true);
      wordsFromFiles(r);
    }
    expect(Object.values(world.entities).filter((e) => e.name === "Gate guard").length).toBe(answered.length);
  });

  test("two rolls made at once for the same person draw different dice, each recorded as its answer says", async () => {
    const t = await rig();
    // Six dice each, so two different draws are all but never alike by chance.
    const [climb, knife] = await Promise.all([t.call("roll", { who: "wren", for: "the climb", dice: "6d20" }), t.call("roll", { who: "wren", for: "the knife throw", dice: "6d20" })]);
    if (climb === undefined || knife === undefined) throw new Error("two answers");
    const rolls = [climb, knife].map((r) => dataOf(r).roll as JsonObject);
    expect(rolls[0]?.dice).not.toEqual(rolls[1]?.dice);
    const rows = t.s.changes(t.turn.id);
    expect(rows.length).toBe(2);
    for (const roll of rolls) {
      const row = rows.find((r) => String(r.id) === roll.id);
      expect(((row?.value as JsonObject).data as JsonObject).dice).toEqual(roll.dice);
      expect(((row?.value as JsonObject).data as JsonObject).for).toBe(roll.for);
    }
  });
});
