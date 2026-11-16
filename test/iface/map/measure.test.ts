import { describe, expect, test } from "bun:test";
import { NOTHING_MOVES, place, setDoor, type Drawn, type Moving, type Piece, type Square } from "../../../src/packs/space/core/grid-model";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { between, burst, cone, distance, line, sees, within } from "../../../src/packs/space/core/grid-measure";
import { CELLAR, drawn, HALL, INN, OPEN, PILLAR, SEALED } from "./fixtures";

/** Where to stand: a square, or a square with a footprint and what it blocks. */
type Stand = Square | (Pick<Piece, "size" | "blocks"> & { square: Square });

/** Everyone put where they are given, with what they are given. */
function stand(d: Drawn, at: Record<string, Stand>): Moving {
  let moving = NOTHING_MOVES;
  for (const [id, where] of Object.entries(at)) moving = "square" in where ? place(d, moving, id, where.square, where).moving : place(d, moving, id, where).moving;
  return moving;
}

describe("distance", () => {
  test("a diagonal counts as one square as shipped, and every second one as two under the other rule", () => {
    expect(distance("one", [6, 5], [9, 2])).toBe(3);
    expect(distance("alternate", [6, 5], [9, 2])).toBe(4);
    expect(distance("one", [2, 2], [11, 7])).toBe(9);
    expect(distance("alternate", [2, 2], [11, 7])).toBe(11);
  });

  test("the inn's traveller sits 15 ft from you, as plan 8.2 prints it", () => {
    const d = drawn(INN);
    const moving = stand(d, { wren: [6, 5], traveller: [9, 2] });
    expect((between(d, moving, "wren", "traveller") ?? 0) * d.scale.feet).toBe(15);
  });

  test("something bigger than a square is measured from its nearest square", () => {
    const d = drawn(INN);
    const moving = stand(d, { wren: [6, 5], long_table: { square: [9, 2], size: [2, 2] } });
    expect(between(d, moving, "wren", "long_table")).toBe(3);
    expect(between(d, moving, [11, 4], "long_table")).toBe(1);
    expect(between(d, moving, [10, 3], "long_table")).toBe(0);
    expect(between(d, moving, "wren", "nobody")).toBeNull();
  });

  test("who is within a range", () => {
    const d = drawn(INN);
    const moving = stand(d, { wren: [6, 5], bram: [4, 3], tam: [9, 6] });
    expect(within(d, moving, "wren", 2)).toEqual(["bram"]);
    expect(within(d, moving, "wren", 3)).toEqual(["bram", "tam"]);
  });
});

describe("line of sight", () => {
  test("a bar drawn between two people hides one from the other; open floor does not", () => {
    const d = drawn(INN);
    const moving = stand(d, { bram: [5, 3], tam: [5, 5], wren: [2, 5], odile: [11, 5] });
    expect(sees(d, moving, "bram", "tam")).toBe(false);
    expect(sees(d, moving, "wren", "odile")).toBe(true);
    expect(sees(d, moving, "tam", "bram")).toBe(false);
  });

  test("a closed or locked door blocks the view; an open one does not", () => {
    const d = drawn(CELLAR);
    const moving = stand(d, { wren: [3, 3], odile: [7, 3] });
    expect(sees(d, moving, "wren", "odile")).toBe(true);
    expect(sees(d, setDoor(d, moving, [5, 3], "closed").moving, "wren", "odile")).toBe(false);
    expect(sees(d, setDoor(d, moving, [5, 3], "locked").moving, "odile", "wren")).toBe(false);
    const reopened = setDoor(d, setDoor(d, moving, [5, 3], "closed").moving, [5, 3], "open").moving;
    expect(sees(d, reopened, "wren", "odile")).toBe(true);
  });

  test("a wall square blocks; past one wall's corner the view goes on; where two walls meet at a corner it does not", () => {
    const pillar = drawn(PILLAR);
    expect(sees(pillar, NOTHING_MOVES, [1, 1], [3, 3])).toBe(false);
    expect(sees(pillar, NOTHING_MOVES, [1, 2], [2, 1])).toBe(true);
    // The straight line from (1,1) to (3,2) crosses the pillar's square below the middle of its top edge.
    expect(sees(pillar, NOTHING_MOVES, [1, 1], [3, 2])).toBe(false);
    expect(sees(pillar, NOTHING_MOVES, [1, 1], [3, 1])).toBe(true);
    const sealed = drawn(SEALED);
    expect(sees(sealed, NOTHING_MOVES, [1, 1], [2, 2])).toBe(false);
  });

  test("a footprint that blocks the view hides what is behind it; one that blocks only the way does not", () => {
    const d = drawn(OPEN);
    const wagon = stand(d, { wren: [1, 3], tam: [5, 3], wagon: { square: [3, 2], size: [1, 3], blocks: { way: true, view: true } } });
    expect(sees(d, wagon, "wren", "tam")).toBe(false);
    expect(sees(d, wagon, "wren", "wagon")).toBe(true);
    const fence = stand(d, { wren: [1, 3], tam: [5, 3], fence: { square: [3, 2], size: [1, 3], blocks: { way: true } } });
    expect(sees(d, fence, "wren", "tam")).toBe(true);
  });

  test("two footprints as large as a map holds, a wall between them, are measured in a few milliseconds", () => {
    const d = drawn(HALL);
    const moving = stand(d, { crowd: { square: [1, 1], size: [40, 64] }, wagons: { square: [42, 1], size: [23, 64] }, herd: { square: [1, 41], size: [30, 24] } });
    const started = performance.now();
    expect(sees(d, moving, "crowd", "wagons")).toBe(false);
    // Seconds before the fix; the bound is loose so that a busy machine does not fail it.
    expect(performance.now() - started).toBeLessThan(1000);
    expect(sees(d, moving, "crowd", "herd")).toBe(true);
  });
});

describe("areas", () => {
  test("a burst of one square around the middle of open floor is the nine squares about it", () => {
    const d = drawn(OPEN);
    const area = burst(d, stand(d, { wren: [2, 2], tam: [5, 5] }), [3, 3], 1);
    expect(area.squares).toHaveLength(9);
    expect(area.who).toEqual(["wren"]);
  });

  test("a burst does not pass a shut door, and through an open one reaches what the doorway lets it", () => {
    const d = drawn(CELLAR);
    const moving = stand(d, { odile: [7, 3] });
    const shut = burst(d, setDoor(d, moving, [5, 3], "closed").moving, [3, 3], 4);
    expect(shut.squares).toHaveLength(9);
    expect(shut.who).toEqual([]);
    const open = burst(d, moving, [3, 3], 4);
    expect(open.squares.filter(([c]) => c >= 5)).toEqual([
      [5, 3],
      [6, 3],
      [7, 3],
    ]);
    expect(open.squares).toHaveLength(12);
    expect(open.who).toEqual(["odile"]);
  });

  test("a cone widens half a square each side for every square it runs", () => {
    const d = drawn(OPEN);
    expect(cone(d, NOTHING_MOVES, [1, 3], [5, 3], 4).squares).toEqual([
      [5, 1],
      [3, 2],
      [4, 2],
      [5, 2],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
      [3, 4],
      [4, 4],
      [5, 4],
      [5, 5],
    ]);
  });

  test("a line runs square by square to its length or the edge, and stops at a wall", () => {
    const d = drawn(OPEN);
    expect(line(d, NOTHING_MOVES, [1, 1], [5, 5], 3).squares).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(line(d, NOTHING_MOVES, [1, 3], [2, 3], 10).squares).toEqual([
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
    ]);
    const cellar = drawn(CELLAR);
    expect(line(cellar, setDoor(cellar, NOTHING_MOVES, [5, 3], "closed").moving, [2, 3], [8, 3], 6).squares).toEqual([
      [3, 3],
      [4, 3],
    ]);
    expect(line(cellar, NOTHING_MOVES, [2, 3], [8, 3], 6).squares).toHaveLength(6);
  });

  test("under the alternating rule a diagonal burst reaches less far", () => {
    const d = drawn(OPEN, { ...MAP_DEFAULTS, diagonal: "alternate" });
    expect(burst(d, NOTHING_MOVES, [3, 3], 2).squares).toHaveLength(21);
  });
});
