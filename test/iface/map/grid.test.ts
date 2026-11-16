import { describe, expect, test } from "bun:test";
import { initialState } from "../../../src/engine/world-state";
import { blockersOf, drawnOf, footprint, indexOf, lift, movingOf, NOTHING_MOVES, place, putOn, setDoor, squareAt, standsAt, type Drawn } from "../../../src/packs/space/core/grid-model";
import { CELLAR, INN, registry, TOWN, worldWith } from "./fixtures";

function inn(): Drawn {
  const d = drawnOf(worldWith(INN), "common_room");
  if (!d) throw new Error("the common room has no grid");
  return d;
}

const squares = (d: Drawn, list: Iterable<number>): number[][] => [...list].sort((a, b) => a - b).map((i) => [...squareAt(d, i)]);

describe("what is drawn", () => {
  test("is read from today's map as the engine compiles it", () => {
    const d = inn();
    expect([d.width, d.height]).toEqual([12, 8]);
    expect(d.symbols[indexOf(d, [6, 1]) ?? -1]).toBe("+");
    expect(squares(d, d.doors)).toEqual([
      [6, 1],
      [12, 5],
    ]);
    // The bar and the hearth are drawn blocking; the chest is drawn where it starts.
    expect(d.blocked.has(indexOf(d, [5, 4]) ?? -1)).toBe(true);
    expect(d.blocked.has(indexOf(d, [2, 7]) ?? -1)).toBe(true);
    expect(squareAt(d, d.items.chest ?? -1)).toEqual([8, 6]);
    expect(d.scale.feet).toBe(5);
  });

  test("a place with no map of its own has no grid", () => {
    expect(drawnOf(worldWith(INN), "market_square")).toBeNull();
  });
});

describe("what moves", () => {
  test("someone is put on a square and moved to another", () => {
    const d = inn();
    let { moving, reports } = place(d, NOTHING_MOVES, "wren", [6, 5]);
    expect(reports).toEqual([]);
    ({ moving, reports } = place(d, moving, "wren", [11, 2]));
    expect(reports).toEqual([]);
    expect(standsAt(moving, "wren")).toEqual([11, 2]);
  });

  test("a square in a wall is applied and reported; one off the grid is not applied", () => {
    const d = inn();
    const walled = place(d, NOTHING_MOVES, "bram", [5, 4]);
    expect(standsAt(walled.moving, "bram")).toEqual([5, 4]);
    expect(walled.reports).toEqual([{ code: "in_wall", values: { what: "bram", squares: [[5, 4]] } }]);
    const off = place(d, NOTHING_MOVES, "bram", [13, 2]);
    expect(standsAt(off.moving, "bram")).toBeNull();
    expect(off.reports[0]?.code).toBe("off_grid");
  });

  test("a footprint covers its squares, and one that blocks is reported under someone", () => {
    const d = inn();
    let { moving } = place(d, NOTHING_MOVES, "long_table", [9, 2], { size: [2, 2], blocks: { way: true } });
    expect(squares(d, footprint(d, moving, "long_table"))).toEqual([
      [9, 2],
      [10, 2],
      [9, 3],
      [10, 3],
    ]);
    expect(blockersOf(d, moving).way.has(indexOf(d, [10, 3]) ?? -1)).toBe(true);
    expect(blockersOf(d, moving).view.has(indexOf(d, [10, 3]) ?? -1)).toBe(false);
    const sat = place(d, moving, "tam", [10, 3]);
    expect(sat.reports).toEqual([{ code: "overlaps", values: { what: "tam", with: "long_table" } }]);
    // Moved, it keeps its footprint; against the wall it runs off the edge.
    ({ moving } = place(d, moving, "long_table", [12, 7]));
    expect(squares(d, footprint(d, moving, "long_table"))).toEqual([
      [12, 7],
      [12, 8],
    ]);
    expect(place(d, moving, "long_table", [12, 7]).reports.map((r) => r.code)).toEqual(["off_edge", "in_wall"]);
  });

  test("a thing on another stands where that stands, and goes with it", () => {
    const d = inn();
    let { moving } = place(d, NOTHING_MOVES, "long_table", [9, 2], { size: [2, 2] });
    ({ moving } = putOn(moving, "lantern", "long_table"));
    expect(standsAt(moving, "lantern")).toEqual([9, 2]);
    ({ moving } = place(d, moving, "long_table", [3, 6]));
    expect(standsAt(moving, "lantern")).toEqual([3, 6]);
    expect(standsAt(lift(moving, "long_table"), "lantern")).toBeNull();
    expect(putOn(moving, "cup", "nobody").reports).toEqual([{ code: "holder_off_grid", values: { what: "cup", holder: "nobody" } }]);
  });

  test("a door is opened, shut or locked; a square with no door is not", () => {
    const d = inn();
    const { moving } = place(d, NOTHING_MOVES, "bram", [6, 1]);
    const shut = setDoor(d, moving, [6, 1], "closed");
    expect(shut.moving.doors).toEqual({ "6,1": "closed" });
    expect(shut.reports).toEqual([{ code: "door_on", values: { square: [6, 1], what: "bram" } }]);
    expect(setDoor(d, moving, [5, 5], "locked").reports).toEqual([{ code: "not_a_door", values: { square: [5, 5] } }]);
  });
});

describe("the moving layer from the store", () => {
  test("people and things on squares, what lies on a thing there, and who has no square yet", () => {
    const reg = registry();
    const world = worldWith(INN, CELLAR, TOWN);
    // A ring in a box on the long table: the ring's id comes before the box's.
    world.entities.box = { id: "box", kind: "container", name: "Snuff box", tier: "background", fields: {}, relations: [{ type: "in", to: "long_table" }] };
    world.entities.amber_ring = { id: "amber_ring", kind: "item", name: "Amber ring", tier: "background", fields: {}, relations: [{ type: "in", to: "box" }] };
    const state = initialState(world, "rev-a", reg);
    const wren = state.entities.wren;
    if (!wren) throw new Error("no wren");
    Object.assign(wren.fields, { x: 5, y: 4 });
    const d = drawnOf(world, "common_room");
    if (!d) throw new Error("no grid");
    const { moving, unplaced } = movingOf(reg, world, state, d);
    expect(moving.pieces).toEqual({ chest: { at: [8, 6] }, long_table: { at: [9, 2] }, wren: { at: [6, 5] }, lantern: { on: "long_table" }, box: { on: "long_table", within: true }, amber_ring: { on: "box", within: true } });
    expect(standsAt(moving, "amber_ring")).toEqual([9, 2]);
    expect(unplaced).toEqual(["bram"]);
  });
});
