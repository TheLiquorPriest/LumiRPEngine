import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readConfig } from "../../../src/app/config-read";
import { initialState } from "../../../src/engine/world-state";
import { drawnOf, NOTHING_MOVES, place } from "../../../src/packs/space/core/grid-model";
import { layForPlace, plainRows } from "../../../src/iface/map/lay";
import { distance } from "../../../src/packs/space/core/grid-measure";
import { printMap } from "../../../src/iface/map/print";
import { mapConfigRead, MAP_SETTINGS } from "../../../src/iface/map/settings";
import { farText } from "../../../src/iface/map/words";
import { Lines, SHIPPED_GUIDANCE } from "../../../src/iface/index";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { HALL, OPEN, registry, worldWith } from "./fixtures";

const lines = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "map-answers.md")).text(), "answers");

/** The map settings a chat's `RPE.yml` gives. */
const configOf = (text: string) => mapConfigRead(readConfig([{ level: "chat", file: "RPE.yml", text }], null, MAP_SETTINGS));

describe("the map's settings", () => {
  test("a chat whose RPE.yml sets 10 ft squares and a 20 by 20 window lays 10 ft squares and prints 20 by 20", () => {
    const config = configOf("map:\n  laidFeet: 10\n  printColumns: 20\n  printRows: 20\n");
    expect(config).toEqual({ ...MAP_DEFAULTS, laidFeet: 10, printColumns: 20, printRows: 20 });
    const world = worldWith(OPEN);
    const laid = layForPlace(world, initialState(world, "r", registry()), "far_road", { id: "road_map", rows: plainRows(6, 6) }, config);
    expect(JSON.stringify(laid.changes[0]?.value)).toContain('"cellMeters":3.048');
    expect(laid.changes[0]).toMatchObject({ standing: "assumed", source: "default" });
    const hall = drawnOf(worldWith(HALL), "far_road");
    if (!hall) throw new Error("the hall has no grid");
    const printed = printMap(hall, NOTHING_MOVES, { config });
    expect([printed.from, printed.to, printed.whole]).toEqual([[23, 23], [42, 42], false]);
  });

  test("a world whose ruleset counts every second diagonal as two paths (1,1) to (4,4) as 4 squares; a metric ruleset measures in metres", () => {
    const world = worldWith({ ...OPEN, cellMeters: 2 });
    expect(distance("one", [1, 1], [4, 4])).toBe(3);
    world.ruleset = { diagonal: "alternate", distances: "metres" };
    const d = drawnOf(world, "market_square");
    if (!d) throw new Error("no grid");
    expect([distance(d.scale.diagonal, [1, 1], [4, 4]), d.scale.unit]).toEqual([4, "metres"]);
    expect(farText(lines, d, 7)).toBe("14 m");
    expect(farText(lines, { ...d, scale: { ...d.scale, unit: "feet" } }, 7)).toBe("45.9 ft");
  });

  test("a 64 by 64 map with the scene's three people in one corner prints the part that holds all three", () => {
    const hall = drawnOf(worldWith(HALL), "far_road");
    if (!hall) throw new Error("the hall has no grid");
    let moving = NOTHING_MOVES;
    for (const [id, at] of [["a", [60, 60]], ["b", [62, 61]], ["c", [63, 62]]] as const) moving = place(hall, moving, id, at).moving;
    const printed = printMap(hall, moving, { around: ["a", "b", "c"], centre: [1, 1] });
    expect([printed.from, printed.to]).toEqual([[25, 35], [64, 64]]);
    expect(printed.pieces.map((p) => p.shown)).toEqual([true, true, true]);
  });
});
