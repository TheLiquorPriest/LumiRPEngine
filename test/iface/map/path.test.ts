import { describe, expect, test } from "bun:test";
import { blockersOf, GRID_DEFAULTS, indexOf, NOTHING_MOVES, place, setDoor, standsAt, type Drawn, type Moving, type Square } from "../../../src/iface/map/grid";
import { move, walk, type Walk } from "../../../src/iface/map/path";
import type { MapDoc } from "../../../src/shared/world";
import { CELLAR, drawn, OPEN, PILLAR, SEALED } from "./fixtures";

/** Whether every step of a way goes to a square beside the last, never into something that blocks, and never across a blocked corner. */
function honest(d: Drawn, moving: Moving, way: Walk): boolean {
  const blocked = blockersOf(d, moving).way;
  const shut = (s: Square): boolean => blocked.has(indexOf(d, s) ?? -1);
  return way.squares.every((s, k) => {
    const before = way.squares[k - 1];
    if (before === undefined) return true;
    const dc = s[0] - before[0];
    const dr = s[1] - before[1];
    const beside = Math.max(Math.abs(dc), Math.abs(dr)) === 1;
    const corner = dc !== 0 && dr !== 0 && (shut([before[0] + dc, before[1]]) || shut([before[0], before[1] + dr]));
    return beside && !shut(s) && !corner;
  });
}

const MUD: MapDoc = { id: "market_mud", scope: "market_square", layout: [".....", ".mmm.", "....."], legend: { m: { terrain: "mud" } }, cellMeters: 1.524 };

describe("paths in eight directions", () => {
  test("straight on a diagonal: four squares, or six when every second diagonal counts two", () => {
    const corner: Square[] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ];
    expect(walk(drawn(OPEN), NOTHING_MOVES, [1, 1], [5, 5])).toEqual({ squares: corner, distance: 4, cost: 4 });
    expect(walk(drawn(OPEN, { ...GRID_DEFAULTS, diagonal: "alternate" }), NOTHING_MOVES, [1, 1], [5, 5])).toEqual({ squares: corner, distance: 6, cost: 6 });
  });

  test("along a row, the way reads straight", () => {
    expect(walk(drawn(OPEN), NOTHING_MOVES, [1, 1], [5, 1])?.squares).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
  });

  test("no corner of a wall is cut: round the pillar is four squares, not three", () => {
    const d = drawn(PILLAR);
    const way = walk(d, NOTHING_MOVES, [1, 1], [3, 3]);
    expect(way?.distance).toBe(4);
    expect(way && honest(d, NOTHING_MOVES, way)).toBe(true);
    expect(walk(d, NOTHING_MOVES, [2, 1], [3, 2])?.squares).toEqual([
      [2, 1],
      [3, 1],
      [3, 2],
    ]);
    expect(walk(drawn(SEALED), NOTHING_MOVES, [1, 1], [2, 2])).toBeNull();
  });

  test("a closed or locked door blocks the way; an open one does not", () => {
    const d = drawn(CELLAR);
    const open = walk(d, NOTHING_MOVES, [2, 3], [8, 3]);
    expect(open?.distance).toBe(6);
    expect(open?.squares).toContainEqual([5, 3]);
    expect(open && honest(d, NOTHING_MOVES, open)).toBe(true);
    expect(walk(d, setDoor(d, NOTHING_MOVES, [5, 3], "closed").moving, [2, 3], [8, 3])).toBeNull();
    expect(walk(d, setDoor(d, NOTHING_MOVES, [5, 3], "locked").moving, [2, 3], [8, 3])).toBeNull();
    expect(walk(d, NOTHING_MOVES, [2, 3], [5, 3])?.distance).toBe(3);
  });

  test("the way goes round the mud when that costs less, and says what it cost", () => {
    const d = drawn(MUD);
    const way = walk(d, NOTHING_MOVES, [1, 2], [5, 2]);
    expect(way).toEqual({
      squares: [
        [1, 2],
        [2, 1],
        [3, 1],
        [4, 1],
        [5, 2],
      ],
      distance: 4,
      cost: 4,
    });
  });

  test("a footprint must fit all the way: a cart two squares wide does not pass a door one wide", () => {
    const d = drawn(CELLAR);
    const { moving } = place(d, NOTHING_MOVES, "cart", [2, 2], { size: [2, 2], blocks: { way: true } });
    expect(walk(d, moving, [2, 2], [6, 2], "cart")).toBeNull();
    expect(walk(d, moving, [2, 2], [3, 3], "cart")?.distance).toBe(1);
    // Someone else walks round the cart, never through it nor across its corner.
    const around = walk(d, moving, [4, 2], [2, 4]);
    expect(around?.squares).toEqual([
      [4, 2],
      [4, 3],
      [4, 4],
      [3, 4],
      [2, 4],
    ]);
  });
});

describe("moving along a way", () => {
  test("someone moved is moved along the way, and the way is given", () => {
    const d = drawn(CELLAR);
    const { moving } = place(d, NOTHING_MOVES, "wren", [2, 3]);
    const moved = move(d, moving, "wren", [8, 3]);
    expect(standsAt(moved.moving, "wren")).toEqual([8, 3]);
    expect(moved.walk?.distance).toBe(6);
    expect(moved.reports).toEqual([]);
  });

  test("with no way there, they are put there all the same and it is reported", () => {
    const d = drawn(CELLAR);
    const { moving } = place(d, setDoor(d, NOTHING_MOVES, [5, 3], "closed").moving, "wren", [2, 3]);
    const moved = move(d, moving, "wren", [8, 3]);
    expect(standsAt(moved.moving, "wren")).toEqual([8, 3]);
    expect(moved.walk).toBeNull();
    expect(moved.reports).toEqual([{ code: "no_way", values: { what: "wren", from: [2, 3], to: [8, 3] } }]);
  });
});
