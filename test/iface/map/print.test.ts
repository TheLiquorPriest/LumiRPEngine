import { describe, expect, test } from "bun:test";
import { blockersOf, indexOf, NOTHING_MOVES, place, putOn, setDoor, type Drawn, type Moving, type Square } from "../../../src/packs/space/core/grid-model";
import { between, distance, sees } from "../../../src/packs/space/core/grid-measure";
import { walk } from "../../../src/packs/space/core/grid-path";
import { printMap, type Printed } from "../../../src/iface/map/print";
import type { MapDoc } from "../../../src/shared/world";
import { CELLAR, drawn, INN, INN_PICTURE } from "./fixtures";

/** The common room as plan 8.2 shows it: the long table and the chest where it draws them, you, and a hooded traveller at the table. */
function commonRoom(): { d: Drawn; moving: Moving } {
  const d = drawn(INN);
  let moving = place(d, NOTHING_MOVES, "long_table", [9, 2], { size: [2, 2] }).moving;
  moving = place(d, moving, "chest", [8, 6], { blocks: { way: true } }).moving;
  moving = place(d, moving, "wren", [6, 5]).moving;
  moving = place(d, moving, "traveller", [9, 2]).moving;
  moving = putOn(moving, "lantern", "long_table").moving;
  return { d, moving };
}

/** The symbol a reader finds on the picture at a square: on the row's line, under the column's number. */
function readSquare(picture: string, s: Square): string {
  const [head = "", ...rows] = picture.split("\n");
  const column = [...head.matchAll(/\d+/g)].find((m) => m[0] === String(s[0]))?.index;
  const row = rows.find((line) => line.slice(0, 4).trim() === String(s[1]));
  if (column === undefined || row === undefined) throw new Error(`the picture shows no square ${s.join(",")}`);
  return row[column] ?? " ";
}

/** Whether a reader of the printed map would say a square blocks the way: by its symbol's legend entry, the doors' states and what is listed there. */
function readsBlocked(p: Printed, s: Square): boolean {
  const what = p.legend.find((e) => e.symbol === readSquare(p.picture, s))?.what;
  if (what === "wall") return true;
  if (what === "door") return p.doors.find((x) => x.at[0] === s[0] && x.at[1] === s[1])?.state !== "open";
  if (typeof what === "object" && "terrain" in what) return what.blocked === true;
  if (typeof what === "object" && "item" in what) return p.pieces.find((x) => x.id === what.item)?.blocks?.way === true;
  return false;
}

describe("the text map", () => {
  test("prints the common room exactly as plan 8.2 does", () => {
    const { d, moving } = commonRoom();
    const p = printMap(d, moving);
    expect(p.picture).toBe(INN_PICTURE);
    expect(p.whole).toBe(true);
    expect([p.from, p.to]).toEqual([
      [1, 1],
      [12, 8],
    ]);
    expect(p.scale.feet).toBe(5);
  });

  test("gives its legend as data: each symbol, what the map says it is, and where it is shown", () => {
    const { d, moving } = commonRoom();
    const p = printMap(d, moving);
    expect(p.legend.map((e) => e.symbol)).toEqual(["#", "+", ".", "T", "B", "c", "H"]);
    expect(p.legend.find((e) => e.symbol === "T")).toEqual({
      symbol: "T",
      what: { item: "long_table" },
      where: [
        [9, 2],
        [10, 2],
        [9, 3],
        [10, 3],
      ],
    });
    expect(p.legend.find((e) => e.symbol === "+")).toEqual({
      symbol: "+",
      what: "door",
      where: [
        [6, 1],
        [12, 5],
      ],
    });
    expect(p.legend.find((e) => e.symbol === "B")?.what).toEqual({ terrain: "bar", blocked: true });
  });

  test("lists who and what is where, and the doors as they stand", () => {
    const { d, moving } = commonRoom();
    const p = printMap(d, setDoor(d, moving, [6, 1], "closed").moving);
    expect(p.pieces).toEqual([
      { id: "chest", at: [8, 6], blocks: { way: true }, shown: true },
      { id: "lantern", at: [9, 2], on: "long_table", shown: true },
      { id: "long_table", at: [9, 2], size: [2, 2], shown: true },
      { id: "traveller", at: [9, 2], shown: true },
      { id: "wren", at: [6, 5], shown: true },
    ]);
    expect(p.doors).toEqual([
      { at: [6, 1], state: "closed" },
      { at: [12, 5], state: "open" },
    ]);
  });

  test("draws a thing the map draws where it stands now", () => {
    const { d, moving } = commonRoom();
    const p = printMap(d, place(d, moving, "chest", [3, 2]).moving);
    expect(readSquare(p.picture, [3, 2])).toBe("c");
    expect(readSquare(p.picture, [8, 6])).toBe(".");
    expect(p.legend.find((e) => e.symbol === "c")?.where).toEqual([[3, 2]]);
  });
});

describe("the printed map and the measuring agree", () => {
  test("what a reader of the picture takes to block the way is what the measuring takes, door shut or open", () => {
    const { d, moving } = commonRoom();
    for (const now of [moving, setDoor(d, moving, [12, 5], "locked").moving]) {
      const p = printMap(d, now);
      const way = blockersOf(d, now).way;
      for (let r = 1; r <= d.height; r++) for (let c = 1; c <= d.width; c++) expect([c, r, readsBlocked(p, [c, r])]).toEqual([c, r, way.has(indexOf(d, [c, r]) ?? -1)]);
    }
  });

  test("the traveller is 15 ft from you by the squares the map lists, as by the measuring", () => {
    const { d, moving } = commonRoom();
    const p = printMap(d, moving);
    const at = (id: string): Square => p.pieces.find((x) => x.id === id)?.at ?? [0, 0];
    expect(distance(p.scale.diagonal, at("wren"), at("traveller")) * p.scale.feet).toBe(15);
    expect((between(d, moving, "wren", "traveller") ?? 0) * d.scale.feet).toBe(15);
  });

  test("the cellar door the picture shows between two people is what stops the way and the view", () => {
    const d = drawn(CELLAR);
    let moving = place(d, NOTHING_MOVES, "wren", [3, 3]).moving;
    moving = place(d, moving, "odile", [7, 3]).moving;
    const shut = setDoor(d, moving, [5, 3], "closed").moving;
    expect(readSquare(printMap(d, shut).picture, [5, 3])).toBe("+");
    expect(printMap(d, shut).doors).toEqual([{ at: [5, 3], state: "closed" }]);
    expect([sees(d, shut, "wren", "odile"), walk(d, shut, [3, 3], [7, 3], "wren")]).toEqual([false, null]);
    expect([sees(d, moving, "wren", "odile"), walk(d, moving, [3, 3], [7, 3], "wren")?.distance]).toEqual([true, 4]);
  });
});

describe("a map too large to print whole", () => {
  const rows = Array.from({ length: 35 }, (_, r) => (r === 0 || r === 34 ? "#".repeat(50) : `#${".".repeat(48)}#`));
  const BIG: MapDoc = { id: "vale_hall", scope: "vale", layout: rows, cellMeters: 1.524 };

  test("is printed 40 by 30 around the centre given, as far as its edges allow", () => {
    const d = drawn(BIG);
    const moving = place(d, place(d, NOTHING_MOVES, "wren", [48, 34]).moving, "tam", [2, 2]).moving;
    const p = printMap(d, moving, { centre: [48, 34] });
    expect(p.whole).toBe(false);
    expect([p.from, p.to]).toEqual([
      [11, 6],
      [50, 35],
    ]);
    expect(p.picture.split("\n")).toHaveLength(31);
    expect(p.picture.split("\n")[0]?.trim().split(/\s+/)[0]).toBe("11");
    expect(p.pieces.map((x) => [x.id, x.shown])).toEqual([
      ["tam", false],
      ["wren", true],
    ]);
    expect(printMap(d, moving, { centre: [1, 1] }).from).toEqual([1, 1]);
    expect(printMap(d, moving).from).toEqual([6, 4]);
  });
});
