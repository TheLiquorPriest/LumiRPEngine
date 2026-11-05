// Thin walls and doors (map-walls.ts): how wide a wall's stroke is, how wall cells join into runs,
// where a door leaves its gap, what keeps its fill, and that fog never joins through a cell the
// viewer isn't shown.

import { describe, expect, test } from "bun:test";
import { doorGaps, thinWalls, wallKindOf, wallPlan, wallStrokes, wallWidth, WALL_MIN_CELL, type WallCell, type WallGrid } from "../../../src/packs/space/ui/map-walls";

/** A grid from rows: # wall, + door, . open ground, space solid, ? hidden under fog; `r` an open cell in a room. */
function gridOf(...rows: string[]): WallGrid {
  const width = Math.max(...rows.map((r) => r.length));
  const cells: WallCell[] = [];
  const room = new Set<number>();
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? " ";
      if (ch === "r") room.add(y * width + x);
      cells.push(ch === "#" ? "wall" : ch === "+" ? "door" : ch === "." || ch === "r" ? "open" : ch === "?" ? "hidden" : "solid");
    }
  });
  return { width, height: rows.length, cells, room };
}

describe("a wall's width", () => {
  test("a fifth of a cell, from 2 to 4 CSS px, on whole device pixels", () => {
    expect([wallWidth(5, 1), wallWidth(12, 1), wallWidth(15, 1), wallWidth(40, 1)]).toEqual([2, 2, 3, 4]);
    // 13 px cells: 2.6 CSS px is 5.2 device px at 2×, snapped to 5; 7.8 at 3×, snapped to 8.
    expect(wallWidth(13, 2)).toBe(2.5);
    expect(wallWidth(13, 3)).toBeCloseTo(8 / 3, 10);
    for (const dpr of [1, 2, 3]) for (const size of [6, 9, 13, 17, 22, 30]) expect(Number.isInteger(wallWidth(size, dpr) * dpr)).toBe(true);
  });

  test("cells under 6 px keep their fills", () => {
    expect(WALL_MIN_CELL).toBe(6);
    expect([thinWalls(5.9), thinWalls(6), thinWalls(30)]).toEqual([false, true, true]);
  });

  test("a terrain is a wall or a door by its name, a door's words first; a cliff is neither", () => {
    expect([wallKindOf("wall"), wallKindOf("Stone wall"), wallKindOf("doorway"), wallKindOf("garden gate"), wallKindOf("wall arch"), wallKindOf("cliff"), wallKindOf("floor")]).toEqual(["wall", "wall", "door", "door", "door", null, null]);
  });
});

describe("wall runs", () => {
  test("a straight run is one segment through the cells' centres, square at both ends", () => {
    const { segments, pillars } = wallStrokes(gridOf("#####"));
    expect(segments).toEqual([{ from: { x: 0.5, y: 0.5 }, to: { x: 4.5, y: 0.5 }, jamb: [false, false] }]);
    expect(pillars).toEqual([]);
    expect(wallStrokes(gridOf("#", "#", "#")).segments).toEqual([{ from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 2.5 }, jamb: [false, false] }]);
  });

  test("an L joins at its corner's centre", () => {
    const { segments, pillars } = wallStrokes(gridOf("###", "..#", "..#"));
    expect(segments).toEqual([
      { from: { x: 0.5, y: 0.5 }, to: { x: 2.5, y: 0.5 }, jamb: [false, false] },
      { from: { x: 2.5, y: 0.5 }, to: { x: 2.5, y: 2.5 }, jamb: [false, false] },
    ]);
    expect(pillars).toEqual([]);
  });

  test("a lone wall is a pillar; walls touching only at a corner are joined across it", () => {
    expect(wallStrokes(gridOf("...", ".#.", "...")).pillars).toEqual([4]);
    const diagonal = wallStrokes(gridOf("#..", ".#.", "..#"));
    expect(diagonal.pillars).toEqual([]);
    expect(diagonal.segments).toEqual([
      { from: { x: 0.5, y: 0.5 }, to: { x: 1.5, y: 1.5 }, jamb: [false, false] },
      { from: { x: 1.5, y: 1.5 }, to: { x: 2.5, y: 2.5 }, jamb: [false, false] },
    ]);
  });

  test("a wall two cells thick is one mass, its outline drawn and no rungs inside it", () => {
    const { masses, segments, pillars } = wallStrokes(gridOf("####", "####"));
    expect(masses).toEqual([0, 1, 2]);
    expect(pillars).toEqual([]);
    // The two long lines and the two ends: the edges between the rows inside the mass aren't drawn.
    expect(segments).toHaveLength(4);
    expect(segments.filter((s) => s.from.x === s.to.x).map((s) => s.from.x)).toEqual([0.5, 3.5]);
  });
});

describe("doors", () => {
  test("a door in a wall line leaves a gap between its jambs, across the line it sits in", () => {
    const across = gridOf(".r.", "#+#", "...");
    const { doors, loose } = doorGaps(across);
    expect(loose).toEqual([]);
    expect(doors).toEqual([{ cell: 4, axis: "h", hinge: { x: 1, y: 1.5 }, latch: { x: 2, y: 1.5 }, side: -1 }]);
    // The wall stops at each jamb, flat there.
    expect(wallStrokes(across, doors).segments).toEqual([
      { from: { x: 0.5, y: 1.5 }, to: { x: 1, y: 1.5 }, jamb: [false, true] },
      { from: { x: 2, y: 1.5 }, to: { x: 2.5, y: 1.5 }, jamb: [true, false] },
    ]);
    const down = doorGaps(gridOf(".#.", ".+.", ".#."));
    expect(down.doors.map((d) => [d.axis, d.hinge, d.latch])).toEqual([["v", { x: 1.5, y: 1 }, { x: 1.5, y: 2 }]]);
  });

  test("a pair of doors opens from the middle", () => {
    const { doors } = doorGaps(gridOf("#++#"));
    expect(doors.map((d) => [d.cell, d.hinge.x, d.latch.x])).toEqual([
      [1, 1, 2],
      [2, 3, 2],
    ]);
  });

  test("a door in no wall line keeps its fill, and so does a run a wall closes at one end only", () => {
    const plan = wallPlan(gridOf("....", ".+..", "#++.", "...."));
    expect(plan.doors).toEqual([]);
    expect(plan.loose).toEqual([5, 9, 10]);
    // The wall beside the half-closed run joins nothing: a pillar.
    expect(plan.pillars).toEqual([8]);
  });
});

describe("fog", () => {
  test("a cell the viewer isn't shown never joins two walls, nor closes a door's line", () => {
    const { segments, pillars } = wallStrokes(gridOf("#?#"));
    expect(segments).toEqual([]);
    expect(pillars).toEqual([0, 2]);
    expect(doorGaps(gridOf("#+?")).loose).toEqual([1]);
    expect(wallStrokes(gridOf("##?##")).segments).toEqual([
      { from: { x: 0.5, y: 0.5 }, to: { x: 1.5, y: 0.5 }, jamb: [false, false] },
      { from: { x: 3.5, y: 0.5 }, to: { x: 4.5, y: 0.5 }, jamb: [false, false] },
    ]);
  });
});
