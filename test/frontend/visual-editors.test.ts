import { describe, expect, test } from "bun:test";
import { dayHandles, handleRange, moveHandle, slotIssues, slotSpans, timeOf } from "../../src/packs/calendar/ui/schedule-editor";
import { strokeCells } from "../../src/packs/space/ui/editors";
import { cellMeaning, checkMapText, fillCells, framePosition, freeChar, gridPlaceCells, moveLegendChar, nodePositions, paintLayout, readModel, removePlace, renamePlace, resizeLayout, withLayout, type MapModel, type MapValue } from "../../src/packs/space/ui/map-editor";
import { badCells, markOf, previewMarks } from "../../src/packs/space/ui/map-preview";
import { removeStage, stageOrder } from "../../src/packs/story/ui/track-editor";
import { formatMap } from "../../src/shared/maps";
import type { ScheduleSlot, TrackDef } from "../../src/shared/world";
import { baseWorld } from "../packs/support";

/** A small floor plan: a parlour and a kitchen behind a door, a hallway under them. */
function plan(): MapValue {
  return {
    id: "ground",
    scope: "home",
    layout: ["#######", "#pp+kk#", "#pp#kk#", "###+###", "#hhhhh#"],
    legend: { p: { place: "parlour" }, k: { place: "kitchen" }, h: { place: "hallway" }, l: { item: "lamp", place: "kitchen" } },
    places: [{ id: "parlour", name: "Parlour" }, { id: "kitchen" }, { id: "hallway", at: [3, 4] }],
    links: [{ from: "parlour", to: "kitchen", minutes: 1 }, { from: "kitchen", to: "hallway", minutes: 1 }],
  };
}

function model(value: MapValue): MapModel {
  const m = readModel(value);
  if (typeof m === "string") throw new Error(m);
  return m;
}

describe("map editor: painting a grid map", () => {
  test("painting sets each cell's character, and a short row is padded with nothing first, as the engine reads it", () => {
    expect(paintLayout(["###", "#"], [{ x: 1, y: 0 }, { x: 2, y: 1 }], ".")).toEqual(["#.#", "# ."]);
    // Off the layout: nothing happens.
    expect(paintLayout(["##"], [{ x: 0, y: 3 }], ".")).toEqual(["##"]);
  });

  test("a fill takes the same character side by side and stops at anything else", () => {
    const cells = fillCells(["#..#", "#.##", "#..."], { x: 1, y: 0 });
    expect(cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(["1,0", "1,1", "1,2", "2,0", "2,2", "3,2"]);
    // A short row's missing cells read as a space, so a fill of nothing reaches them.
    expect(fillCells(["##", "#"], { x: 1, y: 1 }).map((c) => `${c.x},${c.y}`)).toEqual(["1,1"]);
    expect(fillCells(["##"], { x: 5, y: 0 })).toEqual([]);
  });

  test("a stroke covers every cell between two points, so a fast drag leaves no gaps", () => {
    expect(strokeCells({ x: 0, y: 0 }, { x: 3, y: 1 })).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }]);
    expect(strokeCells({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  test("resizing cuts or pads every row to the width, new cells holding nothing", () => {
    expect(resizeLayout(["####", "#"], 3, 3, " ")).toEqual(["###", "#  ", "   "]);
    // A map that gives its size keeps it in step with the layout.
    expect(withLayout({ id: "m", size: [4, 2] }, ["###", "#  ", "   "])).toEqual({ id: "m", size: [3, 3], layout: ["###", "#  ", "   "] });
    expect(withLayout({ id: "m" }, ["#"])).toEqual({ id: "m", layout: ["#"] });
  });

  test("a character means what the legend says, else the default legend; a blocked void is nothing", () => {
    const legend = { "#": { terrain: "hedge", blocked: true }, v: { terrain: "void", blocked: true }, z: { zone: "cellar" } };
    expect(cellMeaning(legend, "#")).toEqual({ kind: "terrain", terrain: "hedge", blocked: true });
    expect(cellMeaning(legend, "+")).toEqual({ kind: "door" });
    expect(cellMeaning(legend, " ")).toEqual({ kind: "nothing" });
    expect(cellMeaning(legend, "v")).toEqual({ kind: "nothing" });
    expect(cellMeaning(legend, "z")).toEqual({ kind: "zone", zone: "cellar" });
    expect(cellMeaning({ l: { item: "lamp" } }, "l")).toEqual({ kind: "item", item: "lamp", place: null });
    expect(cellMeaning({}, "q")).toEqual({ kind: "unknown" });
  });

  test("a new brush takes one of its name's letters when free, never one the layout or the default legend uses", () => {
    expect(freeChar({ p: { place: "parlour" } }, ["#pp#"], "Pantry")).toBe("a");
    expect(freeChar({}, ["#..+"], "#.+")).toBe("a");
    expect(freeChar({}, [], "Kitchen")).toBe("k");
  });

  test("moving a legend entry to another character repaints its cells", () => {
    const next = moveLegendChar(plan(), "p", "P");
    expect(next.layout).toEqual(["#######", "#PP+kk#", "#PP#kk#", "###+###", "#hhhhh#"]);
    expect(Object.keys(next.legend as object)).toEqual(["P", "k", "h", "l"]);
  });
});

describe("map editor: places and links", () => {
  test("renaming a place renames it wherever the map names it", () => {
    const next = renamePlace(plan(), "kitchen", "scullery");
    expect((next.places as { id: string }[]).map((p) => p.id)).toEqual(["parlour", "scullery", "hallway"]);
    expect(next.legend).toEqual({ p: { place: "parlour" }, k: { place: "scullery" }, h: { place: "hallway" }, l: { item: "lamp", place: "scullery" } });
    expect(next.links).toEqual([{ from: "parlour", to: "scullery", minutes: 1 }, { from: "scullery", to: "hallway", minutes: 1 }]);
  });

  test("removing a room takes its brush and ways with it, its cells become floor, and a thing in it lies in the room around it", () => {
    const next = removePlace(plan(), "kitchen");
    expect((next.places as { id: string }[]).map((p) => p.id)).toEqual(["parlour", "hallway"]);
    expect(next.legend).toEqual({ p: { place: "parlour" }, h: { place: "hallway" }, l: { item: "lamp" } });
    expect(next.layout).toEqual(["#######", "#pp+..#", "#pp#..#", "###+###", "#hhhhh#"]);
    expect(next.links).toEqual([]);
  });

  test("a grid map's place stands at its cell, else in the middle of its room; a node map's unplaced places go on a ring", () => {
    const m = model(plan());
    const areas = new Map([["parlour", [8, 9, 15, 16]], ["kitchen", [11, 12, 18, 19]]]);
    const cells = gridPlaceCells(m, areas);
    expect(cells.get("hallway")).toEqual({ x: 3, y: 4 });
    expect(cells.get("parlour")).toEqual({ x: 1, y: 1 });
    const node = model({ id: "town", scope: "x", size: [100, 60], places: [{ id: "a", at: [10, 20] }, { id: "b" }, { id: "c" }] });
    expect([node.width, node.height]).toEqual([100, 60]);
    const positions = nodePositions(node);
    expect(positions.get("a")).toEqual({ x: 10, y: 20 });
    expect(positions.get("b")?.x).toBeCloseTo(50);
    expect(positions.get("b")?.y).toBeCloseTo(30 - 60 * 0.38);
  });

  test("a dragged node lands on a whole position inside the frame", () => {
    expect(framePosition({ x: 41.6, y: -3 }, 4, { width: 100, height: 100 })).toEqual({ x: 10, y: 0 });
    expect(framePosition({ x: 900, y: 120 }, 4, { width: 100, height: 25 })).toEqual({ x: 100, y: 25 });
  });

  test("a node map without a size frames every position, at least 100 square; a map of the wrong shape isn't drawn", () => {
    expect(model({ id: "m", scope: "x", places: [{ id: "a", at: [150, 20] }] })).toMatchObject({ kind: "node", width: 150, height: 100 });
    expect(model({ id: "m", scope: "x", places: [] }).kind).toBe("empty");
    expect(readModel({ id: "m", scope: "x", layout: "###" })).toBe("The layout isn't a list of rows of text.");
  });
});

describe("map editor: the JSON and the drawing agree", () => {
  test("a visual edit is the map's JSON: the text reads back as the edited map, with its problems on their lines", () => {
    const world = baseWorld();
    const scope = world.start.place;
    const map: MapValue = { ...plan(), scope, legend: { p: { place: "parlour" }, k: { place: "kitchen" }, h: { place: "hallway" } } };
    const painted = withLayout(map, paintLayout(map.layout as string[], [{ x: 1, y: 4 }], "q"));
    const checked = checkMapText(formatMap(painted), "ground", world);
    expect(checked.value).toEqual(painted as unknown as typeof checked.value);
    const unknown = checked.problems.find((p) => p.message.includes('"q"'));
    expect(unknown?.path).toEqual(["layout", 4]);
    expect(unknown?.line).toBe(formatMap(painted).split("\n").findIndex((line) => line.includes("#qhhhh#")) + 1);
  });

  test("text that isn't JSON is one problem on its line, with nothing to draw", () => {
    const checked = checkMapText('{\n  "id": "m",\n  "scope": }', "m", baseWorld());
    expect(checked.value).toBeNull();
    expect(checked.problems).toHaveLength(1);
    expect(checked.problems[0]?.line).toBe(3);
  });
});

describe("map preview: problems marked where they are", () => {
  test("a problem's path says what it's about", () => {
    expect(markOf(["layout", 2])).toEqual({ kind: "row", y: 2 });
    expect(markOf(["legend", "k", "item"])).toEqual({ kind: "char", ch: "k" });
    expect(markOf(["places", 1, "at"])).toEqual({ kind: "place", index: 1 });
    expect(markOf(["links", 0, "to"])).toEqual({ kind: "link", index: 0 });
    expect(markOf(["scope"])).toEqual({ kind: "map" });
  });

  test("a row's mark is its characters no legend knows and the cells it lacks; otherwise the whole row", () => {
    expect(badCells(["#q#", "#"], {})).toEqual([1, 4, 5]);
    const value = { layout: ["#q#", "#"], legend: {} };
    expect(previewMarks(value, [{ severity: "error", path: ["layout", 0] }])).toEqual([{ severity: "error", cells: [1] }]);
    expect(previewMarks({ layout: ["###"] }, [{ severity: "warning", path: ["layout", 0] }])).toEqual([{ severity: "warning", cells: [0, 1, 2] }]);
  });

  test("a legend entry marks every cell painted with it; a place and a link mark themselves; the map as a whole marks nothing", () => {
    const marks = previewMarks(plan(), [
      { severity: "error", path: ["legend", "k"] },
      { severity: "warning", path: ["places", 2, "at"] },
      { severity: "error", path: ["links", 1] },
      { severity: "error", path: ["scope"] },
    ]);
    expect(marks).toEqual([
      { severity: "error", cells: [11, 12, 18, 19] },
      { severity: "warning", place: "hallway" },
      { severity: "error", link: ["kitchen", "hallway"] },
    ]);
  });
});

describe("schedule day bar", () => {
  const day: ScheduleSlot[] = [
    { start: "05:30", end: "14:00", value: "diner" },
    { start: "14:00", end: "22:00", value: "home" },
    { start: "22:00", end: "05:30", value: "home" },
  ];

  test("a slot past midnight shows as two spans; one ending at midnight runs to the bar's end", () => {
    expect(slotSpans(day)).toEqual([
      { index: 0, start: 330, end: 840 },
      { index: 1, start: 840, end: 1320 },
      { index: 2, start: 1320, end: 1440 },
      { index: 2, start: 0, end: 330 },
    ]);
    expect(slotSpans([{ start: "12:00", end: "00:00", value: 1 }])).toEqual([{ index: 0, start: 720, end: 1440 }]);
    expect(timeOf(1440)).toBe("00:00");
  });

  test("where one slot ends and the next starts is one handle, and moving it moves both", () => {
    const handles = dayHandles(day);
    expect(handles.map((h) => h.at)).toEqual([330, 840, 1320]);
    expect(handles[1]?.edges).toEqual([{ index: 0, side: "end" }, { index: 1, side: "start" }]);
    expect(moveHandle(day, handles[1]?.edges ?? [], 900)).toEqual([
      { start: "05:30", end: "15:00", value: "diner" },
      { start: "15:00", end: "22:00", value: "home" },
      { start: "22:00", end: "05:30", value: "home" },
    ]);
  });

  test("a handle stays a quarter hour short of its neighbours, and the day's own ends stay put", () => {
    const handles = dayHandles(day);
    expect(handleRange(handles, 1)).toEqual([345, 1305]);
    expect(handleRange(handles, 0)).toEqual([15, 825]);
    const edges = dayHandles([{ start: "00:00", end: "12:00", value: 1 }, { start: "12:00", end: "00:00", value: 2 }]);
    expect(edges.map((h) => h.at)).toEqual([0, 720, 1440]);
    expect(handleRange(edges, 0)).toEqual([0, 0]);
    expect(handleRange(edges, 2)).toEqual([1440, 1440]);
  });

  test("each problem names the slots it's about", () => {
    expect(slotIssues([{ start: "08:00", end: "12:00", value: 1 }, { start: "11:00", end: "13:00" }])).toEqual([
      { slots: [1], message: "Slot 2: no value" },
      { slots: [0, 1], message: "Slots 1 and 2 overlap" },
    ]);
  });
});

describe("track stages", () => {
  const track: Pick<TrackDef, "start" | "stages"> = {
    start: "a",
    stages: {
      lost: { label: "Lost", next: [] },
      b: { label: "B", next: [{ to: "lost", when: "x" }] },
      a: { label: "A", next: [{ to: "b", when: "x" }], fail: { when: "f", to: "lost" } },
      orphan: { label: "O", next: [] },
    },
  };

  test("the list reads from the start along the ways, stages it can't reach last", () => {
    expect(stageOrder(track).map((n) => n.id)).toEqual(["a", "lost", "b", "orphan"]);
  });

  test("deleting a stage takes the ways to it with it", () => {
    const next = removeStage({ id: "t", kind: "quest", label: "T", visibility: "public", ...track }, "lost");
    expect(Object.keys(next.stages)).toEqual(["b", "a", "orphan"]);
    expect(next.stages.b?.next).toEqual([]);
    expect(next.stages.a?.fail).toBeUndefined();
  });
});
