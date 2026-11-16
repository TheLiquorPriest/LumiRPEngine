// A name nothing recorded goes by is answered as not there, with its near matches, and nothing is made for it:
// only `spawn` makes. Played as the harness plays a call (checked and coerced by pi, then run). Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-2" };

/** A blank world with a scene: the rock, the kitchen, two people in the kitchen, a lamp, and the horizon on the kitchen. */
async function scene(): Promise<Rig> {
  const t = await rig({}, "blank");
  const r = await t.call("world_apply", {
    operations: [
      { op: "place", kind: "place", name: "Gull Skerry", source: SRC },
      { op: "place", kind: "place", name: "Keeper's kitchen", at: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "person", name: "Traveller", at: "Keeper's kitchen", source: SRC },
      { op: "spawn", kind: "person", name: "Marta Venn", at: "Keeper's kitchen", source: SRC },
      { op: "spawn", name: "Oil lamp", at: "Keeper's kitchen", source: SRC },
      { op: "horizon", list: ["Keeper's kitchen", "Traveller"] },
    ],
  });
  expect(r.error).toBeUndefined();
  return t;
}

/** The call as the model sent it, through pi's argument check first. */
async function play(t: Rig, operations: JsonObject[]): Promise<ToolResult> {
  return t.call("world_apply", asHarnessPasses(t.tools.get("world_apply") as HostTool, { operations }));
}

const entities = (t: Rig): number => Object.keys(t.s.stateAt(t.turn.id).state.world.entities).length;

describe("a name nothing recorded goes by", () => {
  test("in each of move, place, give, wear and store is refused with the unknown answer and the spawn line, and nothing is made", async () => {
    const t = await scene();
    const before = entities(t);
    const calls: JsonObject[] = [
      { op: "move", who: "Marta Venn", to: "Boat shed" },
      { op: "move", who: "Ghost of Odile", to: "Keeper's kitchen" },
      { op: "place", what: "hand lantern", at: "Keeper's kitchen" },
      { op: "give", what: "lantren", from: "Traveller", to: "Marta Venn", how: "given" },
      { op: "wear", what: "cloak", who: "Traveller" },
      { op: "store", what: "knife", in: "Oil lamp" },
    ];
    for (const call of calls) {
      const r = await play(t, [{ ...call, source: SRC }]);
      expect(r.error).toBe(true);
      wordsFromFiles(r);
      expect(texts(r)[0]).toContain("there is nothing called");
    }
    const near = await play(t, [{ op: "give", what: "lantren", from: "Traveller", to: "Marta Venn", how: "given", source: SRC }]);
    expect(texts(near)[0]).toContain("Oil lamp");
    expect(entities(t)).toBe(before);
  });

  test("move with an entry that is not a name is refused naming with, and spawn qty 2.5, 0 or three is refused naming qty", async () => {
    const t = await scene();
    const before = entities(t);
    // Sent as it is: the argument check would coerce a number into text first.
    const withs = await t.call("world_apply", { operations: [{ op: "move", who: "Traveller", to: "Gull Skerry", with: [7], source: SRC }] });
    expect(withs.error).toBe(true);
    expect(texts(withs)[0]).toContain("with cannot be read");
    for (const qty of [2.5, 0, "three"]) {
      const r = await t.call("world_apply", { operations: [{ op: "spawn", name: "Rope", at: "Keeper's kitchen", qty, source: SRC }] });
      expect(r.error).toBe(true);
      expect(texts(r)[0]).toContain("qty cannot be read");
    }
    expect(entities(t)).toBe(before);
  });

  test("store in the world or spawn in the groups is refused with what in takes", async () => {
    const t = await scene();
    const calls: JsonObject[] = [
      { op: "store", what: "Oil lamp", in: "world" },
      { op: "spawn", name: "Rope", in: "groups" },
    ];
    for (const call of calls) {
      const r = await play(t, [{ ...call, source: SRC }]);
      expect(r.error).toBe(true);
      expect(texts(r)[0]).toContain("a place, or someone or something that holds things");
    }
  });
});
