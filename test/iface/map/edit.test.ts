import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../../src/engine/places-in-play";
import { initialState } from "../../../src/engine/world-state";
import { editMap } from "../../../src/iface/map/edit";
import { drawnOf, NOTHING_MOVES } from "../../../src/iface/map/grid";
import { walk } from "../../../src/iface/map/path";
import { printMap } from "../../../src/iface/map/print";
import { testStore } from "../../store/fixtures";
import { CELLAR, registry, worldWith } from "./fixtures";

describe("changing part of a grid", () => {
  test("walls up a door, sets a table in a rectangle and water on a line, and leaves the rest and the world's own map as they were", () => {
    const world = worldWith(CELLAR);
    const { s, revision } = testStore({ world });
    s.createChat({ id: "c", revision });
    const turn = s.beginTurn({ chat: "c", kind: "normal" });
    const start = initialState(world, revision, registry());
    const edited = editMap(
      world,
      start,
      "cellar",
      [
        { symbol: "#", squares: [[5, 3]] },
        { symbol: "t", rect: [
            [6, 2],
            [7, 2],
          ] },
        { symbol: "~", line: [
            [2, 2],
            [4, 4],
          ] },
        { symbol: "?", squares: [[8, 4]] },
        { symbol: "#", squares: [[12, 1]] },
      ],
      { t: { terrain: "table", blocked: true }, "~": { terrain: "water" } },
    );
    expect(edited.reports).toEqual([
      { code: "not_in_legend", values: { symbol: "?" } },
      { code: "off_grid", values: { square: [12, 1] } },
    ]);
    const { changes, state } = s.addChanges(turn.id, edited.changes.map((c) => ({ ...c, by: "gm", source: "gm" as const })));
    expect(changes.map((c) => [c.op, c.applied, c.reports])).toEqual([["engine.world", true, []]]);
    const d = drawnOf(playedWorld(world, state.world), "cellar");
    if (!d) throw new Error("the cellar lost its grid");
    expect(printMap(d, NOTHING_MOVES).picture).toBe(["      1 2 3 4 5 6 7 8 9", "   1  # # # # # # # # #", "   2  # ~ . . # t t . #", "   3  # . ~ . # . . . #", "   4  # . . ~ # . . ? #", "   5  # # # # # # # # #"].join("\n"));
    expect([d.doors.size, walk(d, NOTHING_MOVES, [2, 3], [8, 3])]).toEqual([0, null]);
    expect(d.terrain[(3 - 1) * d.width + (3 - 1)]).toBe("water");
    expect(drawnOf(world, "cellar")?.doors.size).toBe(1);
  });

  test("a place with no map of its own has nothing to change", () => {
    const world = worldWith(CELLAR);
    expect(editMap(world, initialState(world, "r", registry()), "market_square", [{ symbol: "#", squares: [[1, 1]] }]).reports).toEqual([{ code: "no_map", values: { place: "market_square" } }]);
  });
});
