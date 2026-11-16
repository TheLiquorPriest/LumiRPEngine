// The Author's first turn in a chat with no world: the scene a card and a first message set,
// recorded in one call; and each call a model sends that cannot be read, answered with what would
// have worked. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { playedWorld } from "../../src/engine/places-in-play";
import { horizonOf } from "../../src/store";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

const src = { from: "prose", message: "m-1" };
const ROCK = "Gull Skerry";
const KITCHEN = "Gull Skerry keeper's kitchen";
const PLACE_HINT = "A place can be made earlier in this same call: spawn with kind place and its name, before the operation that names it.";
const NOTHING_PLACE = "Nothing that is a place is recorded in this world, so there is nothing near it. world_search finds what is recorded, by words.";

describe("the first turn of a chat with no world", () => {
  test("the scene is recorded in one call: a rock, the kitchen on it, two people there, a lamp, a fact and the horizon", async () => {
    const t = await rig({}, "blank");
    const r = await t.call("world_apply", {
      operations: [
        { op: "spawn", kind: "place", name: ROCK, description: "A rock in the sea with a lighthouse on it.", source: src },
        { op: "spawn", kind: "place", name: KITCHEN, at: ROCK, source: src },
        { op: "spawn", kind: "person", name: "Ada Lorne", at: KITCHEN, source: src },
        { op: "spawn", kind: "person", name: "Tobin Lorne", source: src },
        { op: "move", who: "Tobin Lorne", to: KITCHEN, source: src },
        { op: "spawn", name: "Oil lamp", at: KITCHEN, description: "Trimmed and lit.", source: src },
        { op: "fact", about: "Ada Lorne", key: "duty", value: "Keeps the light on Gull Skerry.", source: src },
        { op: "horizon", list: [KITCHEN, "Ada Lorne", "Tobin Lorne", "Oil lamp"], source: { from: "author" } },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.reports ?? []).toEqual(["Operation 7 (fact): no lane was named, so this fact is recorded in the engine lane."]);
    expect((dataOf(r).operations as JsonObject[]).map((o) => o.applied)).toEqual(Array(8).fill(true));
    const state = t.s.stateAt(t.turn.id).state;
    const doc = t.deps.env.worlds(state.world.revision);
    if (!doc) throw new Error("no blank world");
    const places = Object.values(playedWorld(doc, state.world).places);
    const rock = places.find((p) => p.name === ROCK);
    const kitchen = places.find((p) => p.name === KITCHEN);
    expect(rock?.parent).toBeUndefined();
    expect(kitchen?.parent).toBe(rock?.id);
    const at = (name: string): unknown => Object.values(state.world.entities).find((e) => e.name === name)?.fields.place;
    for (const name of ["Ada Lorne", "Tobin Lorne", "Oil lamp"]) expect(at(name)).toBe(kitchen?.id);
    expect(state.facts["entity:ada_lorne"]?.map((f) => f.value)).toEqual(["Keeps the light on Gull Skerry."]);
    expect(horizonOf(t.deps.env, state)).toHaveLength(4);
    wordsFromFiles(r);
  });

  test("each call a model sends that cannot be read is answered with what would have worked, and records nothing", async () => {
    const t = await rig({}, "blank");
    const refused = async (args: JsonObject): Promise<string[]> => {
      const r: ToolResult = await t.call("world_apply", args);
      expect(r.error).toBe(true);
      expect(t.s.changes(t.turn.id)).toEqual([]);
      wordsFromFiles(r);
      return texts(r);
    };
    // A region made as the packs' weather region, then a place made at it, which it is not.
    const region = { op: "spawn", kind: "region", name: ROCK, source: src };
    expect(await refused({ operations: [region, { op: "spawn", kind: "place", name: KITCHEN, at: ROCK, source: src }] })).toEqual(
      expect.arrayContaining([`Operation 2 (spawn): there is nothing called ${ROCK} that is a place. By that name there is ${ROCK} [gull_skerry] (Weather region). ${NOTHING_PLACE}`, PLACE_HINT]),
    );
    // A fact with neither what it is about nor its key.
    expect(await refused({ operations: [{ op: "fact", subject: "Ada Lorne", value: "Keeps the light.", source: src }] })).toEqual([
      "Operation 1 (fact) needs about, key.",
      "fact needs about, key, value, and also takes replaces. It does not read subject.",
      "Nothing was recorded. Send the call again with that put right.",
    ]);
    // Nothing at all.
    expect(await refused({})).toEqual(["operations cannot be read. It is a list of operations, each with its op, one of: move, place, give, wear, store, pay, pass_time, set, fact, quest, relate, spawn, horizon."]);
    // Someone moved to a place nobody had made.
    expect(await refused({ operations: [{ op: "spawn", kind: "person", name: "Ada Lorne", source: src }, { op: "move", who: "Ada Lorne", to: ROCK, source: src }] })).toEqual([
      `Operation 2 (move): there is nothing called ${ROCK} that is a place. ${NOTHING_PLACE}`,
      PLACE_HINT,
      "move needs who, to, and also takes with, square, near, zone, why.",
      "Nothing was recorded. Send the call again with that put right.",
    ]);
    // The place itself, which was refused as a kind that could not be read, is now made.
    const made = await t.call("world_apply", { operations: [{ op: "spawn", kind: "place", name: ROCK, source: src }] });
    expect(made.error).toBeUndefined();
    expect((dataOf(made).changed as JsonObject[]).some((c) => c.at === "place:gull_skerry" && c.new === true)).toBe(true);
  });
});
