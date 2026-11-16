// `on` is a relation of its own (plan §8.2): the lantern on the table shares its square and goes where
// the table goes, with no container's rule and no report; a thing in a chest is in it; someone may be
// on something. Through `world_apply` as a model meets it. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { placeOfEntity } from "../../../src/engine/scope";
import { gridMoves, mapLines, shippedTexts } from "../../../src/iface/index";
import { INN, worldWith } from "./fixtures";
import { rig } from "../rig";

const src = { from: "prose", message: "m-7" };

async function table() {
  return rig({ grid: gridMoves(await mapLines(shippedTexts())) }, worldWith(INN));
}

describe("on is not in", () => {
  test("a lantern placed on the long table shares its square, moves with it and reports nothing; a lantern in a chest is in it", async () => {
    const t = await table();
    const entity = (id: string) => t.s.stateAt(t.turn.id).state.world.entities[id];
    const set = await t.call("world_apply", { operations: [{ op: "place", what: "lantern", at: "common_room", source: src }, { op: "place", what: "lantern", on: "long_table", source: src }] });
    expect(set.error).toBeUndefined();
    expect(set.reports).toBeUndefined();
    expect(entity("lantern")?.relations).toEqual([{ type: "on", to: "long_table" }]);
    const moved = await t.call("world_apply", { operations: [{ op: "move", who: "long_table", to: "cellar", source: src }] });
    expect(moved.error).toBeUndefined();
    expect(placeOfEntity(t.s.stateAt(t.turn.id).state.world, "lantern")).toBe("cellar");
    const stored = await t.call("world_apply", { operations: [{ op: "store", what: "lantern", in: "chest", source: src }] });
    expect(stored.error).toBeUndefined();
    expect(entity("lantern")?.relations.map((r) => r.type)).toEqual(["in"]);
  });

  test("Wren on the table moves with it, and stands on no place of her own", async () => {
    const t = await table();
    const state = () => t.s.stateAt(t.turn.id).state.world;
    const set = await t.call("world_apply", { operations: [{ op: "place", what: "wren", on: "long_table", source: src }] });
    expect(set.error).toBeUndefined();
    expect(state().entities.wren?.relations).toEqual([{ type: "on", to: "long_table" }]);
    expect(state().entities.wren?.fields.place ?? null).toBeNull();
    await t.call("world_apply", { operations: [{ op: "move", who: "long_table", to: "cellar", source: src }] });
    expect(placeOfEntity(state(), "wren")).toBe("cellar");
  });
});
