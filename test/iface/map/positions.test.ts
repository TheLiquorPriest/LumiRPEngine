// A position inside a place is a square, a named zone or words, and a move is never lost for want of
// a square (plan §8.2): through `world_apply` as a model meets it. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { gridMoves, mapLines, shippedTexts } from "../../../src/iface/index";
import { whereOf } from "../../../src/packs/space/core/grid-play";
import { rig, texts } from "../rig";

const src = { from: "prose", message: "m-7" };

describe("a position that is not a square", () => {
  test("pass_time then move with zone 'by the hearth' to a place with no map records both, and says what could not be placed", async () => {
    const t = await rig({ grid: gridMoves(await mapLines(shippedTexts())) });
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", minutes: 10, source: src }, { op: "move", who: "odile", to: "common_room", zone: "by the hearth", source: src }] });
    expect(r.error).toBeUndefined();
    const state = t.s.stateAt(t.turn.id).state.world;
    expect(state.entities.odile?.fields.place).toBe("common_room");
    expect(whereOf(state, "odile")).toEqual({ zone: "by the hearth" });
    expect(r.reports?.some((x) => x.includes("has no map of squares") && x.includes("by the hearth"))).toBe(true);
    expect(state.clock).toBeGreaterThan(0);
  });

  test("a square on a place with no map is answered with what does not exist and map_lay, and nothing is recorded", async () => {
    const t = await rig({ grid: gridMoves(await mapLines(shippedTexts())) });
    const before = t.s.changes(t.turn.id).length;
    const r = await t.call("world_apply", { operations: [{ op: "move", who: "bram", to: "cellar", square: [3, 3], source: src }] });
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.includes("no square exists at") && x.includes("map_lay"))).toBe(true);
    expect(t.s.changes(t.turn.id).length).toBe(before);
  });

  test("the bell set on the windowsill has those words as its position and no raw field; carried to the cellar it is no longer there, nor is Bram by the hearth", async () => {
    const t = await rig({ grid: gridMoves(await mapLines(shippedTexts())) });
    const state = () => t.s.stateAt(t.turn.id).state.world;
    const set = await t.call("world_apply", { operations: [{ op: "place", what: "bell", on: "the windowsill", source: src }, { op: "move", who: "bram", to: "common_room", near: "the hearth", source: src }] });
    expect(set.error).toBeUndefined();
    expect(whereOf(state(), "bell")).toEqual({ words: "on the windowsill" });
    expect(state().entities.bell?.fields).not.toHaveProperty("said_on");
    expect(whereOf(state(), "bram")).toEqual({ words: "near the hearth" });
    const gone = await t.call("world_apply", { operations: [{ op: "move", who: "bell", to: "cellar", source: src }, { op: "move", who: "bram", to: "cellar", source: src }] });
    expect(gone.error).toBeUndefined();
    expect(whereOf(state(), "bell")).toBeNull();
    expect(whereOf(state(), "bram")).toBeNull();
  });

  test("words given to a thing stay while it stays and go when it is placed elsewhere", async () => {
    const t = await rig({ grid: gridMoves(await mapLines(shippedTexts())) });
    const state = () => t.s.stateAt(t.turn.id).state.world;
    await t.call("world_apply", { operations: [{ op: "place", what: "bell", at: "common_room", source: src }, { op: "place", what: "bell", on: "the windowsill", source: src }] });
    expect(whereOf(state(), "bell")).toEqual({ words: "on the windowsill" });
    const moved = await t.call("world_apply", { operations: [{ op: "place", what: "bell", at: "market_square", source: src }] });
    expect(moved.error).toBeUndefined();
    expect(whereOf(state(), "bell")).toBeNull();
  });
});
