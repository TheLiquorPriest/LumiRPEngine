// `world_apply`'s horizon as the Author met it live: a scene set in one call, with a horizon that
// holds words naming no place, person or thing. Played as the harness plays a call (checked and
// coerced by pi, then run). Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-1" };

/** Seven good operations setting the scene from nothing, as the live call did. */
const SCENE: JsonObject[] = [
  { op: "spawn", kind: "place", name: "Gull Skerry", source: SRC },
  { op: "spawn", kind: "place", name: "Keeper's kitchen", at: "Gull Skerry", source: SRC },
  { op: "spawn", kind: "room", name: "Lamp room", at: "Gull Skerry", source: SRC },
  { op: "spawn", kind: "person", name: "Ada Lorne", at: "Keeper's kitchen", source: SRC },
  { op: "spawn", kind: "person", name: "Tobin Lorne", at: "Keeper's kitchen", source: SRC },
  { op: "spawn", name: "Oil lamp", at: "Lamp room", source: SRC },
  { op: "move", who: "Tobin Lorne", to: "Lamp room", source: SRC },
];

describe("the horizon", () => {
  test("words that name no place, person or thing are kept on it as a note, said once, and the rest of the call is applied", async () => {
    const t = await rig({}, "blank");
    const tool = t.tools.get("world_apply") as HostTool;
    const call = { operations: [...SCENE, { op: "horizon", list: ["Keeper's kitchen", "the tower and its lamp", "Ada Lorne", "the storm"], source: { from: "author" } }] };
    const r = await t.call("world_apply", asHarnessPasses(tool, call));
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    expect(r.reports).toEqual(["Operation 8 (horizon): kept on the horizon as words, naming no place, person or thing: the tower and its lamp, the storm."]);
    const state = t.s.stateAt(t.turn.id).state;
    const kitchen = state.horizon[0] ?? "";
    expect(kitchen.startsWith("place:")).toBe(true);
    expect(state.horizon).toEqual([kitchen, "the tower and its lamp", "entity:ada_lorne", "the storm"]);
    expect(Object.values(state.world.entities).filter((e) => e.kind === "person")).toHaveLength(2);
  });

  test("a name that fits more than one is still asked for by its id, and nothing is recorded", async () => {
    const t = await rig({}, "blank");
    const r = await t.call("world_apply", {
      operations: [
        { op: "spawn", kind: "person", name: "Ada Lorne", source: SRC },
        { op: "spawn", kind: "person", name: "Ada Lorne", source: SRC },
        { op: "horizon", list: ["Ada Lorne"], source: { from: "author" } },
      ],
    });
    expect(r.error).toBe(true);
    wordsFromFiles(r);
    expect(texts(r)[0]).toStartWith("Operation 3 (horizon): Ada Lorne fits more than one:");
    expect(t.s.changes(t.turn.id)).toEqual([]);
  });

  test("it asks no source: sent with none in a call otherwise applied, it is neither marked nor said to be unsourced, and the call comes back clean", async () => {
    const t = await rig({}, "blank");
    const tool = t.tools.get("world_apply") as HostTool;
    const r = await t.call("world_apply", asHarnessPasses(tool, { operations: [SCENE[0] as JsonObject, SCENE[1] as JsonObject, { op: "horizon", list: ["Keeper's kitchen"] }] }));
    expect(r.error).toBeUndefined();
    expect(r.reports ?? []).toEqual([]);
    expect(r.marks ?? []).toEqual([]);
    expect(texts(r).some((x) => x.includes("marked unsourced"))).toBe(false);
    wordsFromFiles(r);
    expect(t.s.stateAt(t.turn.id).state.horizon).toHaveLength(1);
  });
});
