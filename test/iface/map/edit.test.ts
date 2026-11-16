import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../../src/engine/places-in-play";
import { initialState } from "../../../src/engine/world-state";
import { editMap } from "../../../src/iface/map/edit";
import { drawnOf, NOTHING_MOVES } from "../../../src/packs/space/core/grid-model";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { walk } from "../../../src/packs/space/core/grid-path";
import { printMap } from "../../../src/iface/map/print";
import { isRecord } from "../../../src/shared/json";
import { testStore } from "../../store/fixtures";
import { CELLAR, picture, registry, worldWith } from "./fixtures";

describe("changing part of a grid", () => {
  test("walls up a door, sets a table in a rectangle and water on a line, kept square by square over the world's own map", () => {
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
      { code: "fell_off", values: { stroke: 5, symbol: "#", count: 1, width: 9, height: 5 } },
    ]);
    const { changes, state } = s.addChanges(turn.id, edited.changes.map((c) => ({ ...c, by: "gm", source: "gm" as const })));
    // The squares of a symbol no legend names are a change of their own, which stands as assumed.
    expect(changes.map((c) => [c.op, c.applied, c.reports, c.standing ?? null])).toEqual([
      ["space.squares", true, [], null],
      ["space.squares", true, [], "assumed"],
    ]);
    const count = (c: (typeof changes)[number] | undefined): number => (isRecord(c?.value) && isRecord(c.value.data) && Array.isArray(c.value.data.squares) ? c.value.data.squares.length : 0);
    expect([count(changes[0]), count(changes[1])]).toEqual([6, 1]);
    expect(JSON.stringify(changes[0]?.value)).not.toContain("layout");
    const d = drawnOf(playedWorld(world, state.world), "cellar", MAP_DEFAULTS, state.world);
    if (!d) throw new Error("the cellar lost its grid");
    expect(picture(printMap(d, NOTHING_MOVES))).toBe(["      1 2 3 4 5 6 7 8 9", "   1  # # # # # # # # #", "   2  # ~ . . # t t . #", "   3  # . ~ . # . . . #", "   4  # . . ~ # . . ? #", "   5  # # # # # # # # #"].join("\n"));
    expect([d.doors.size, walk(d, NOTHING_MOVES, [2, 3], [8, 3])]).toEqual([0, null]);
    expect(d.terrain[(3 - 1) * d.width + (3 - 1)]).toBe("water");
    expect(drawnOf(world, "cellar")?.doors.size).toBe(1);
    // The world's own map edited later, elsewhere: its change shows through, and the chat's stays over it.
    const later = worldWith({ ...CELLAR, layout: ["#########", "#...#..c#", "#...+...#", "#...#...#", "#########"], legend: { c: { terrain: "crate", blocked: true } } });
    const both = drawnOf(later, "cellar", MAP_DEFAULTS, state.world);
    expect(picture(printMap(both ?? d, NOTHING_MOVES)).split("\n")[2]).toBe("   2  # ~ . . # t t c #");
  });

  test("a place with no map of its own has nothing to change", () => {
    const world = worldWith(CELLAR);
    expect(editMap(world, initialState(world, "r", registry()), "market_square", [{ symbol: "#", squares: [[1, 1]] }]).reports).toEqual([{ code: "no_map", values: { place: "market_square" } }]);
  });
});
