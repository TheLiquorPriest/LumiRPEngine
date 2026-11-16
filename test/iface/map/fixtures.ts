// Invented maps for the grid's tests, on the store lane's invented world: the inn's common room as
// plan §8.2 prints it, two cellar rooms with a door between them, and the town drawn a block to a
// square. Every name here is made up.

import { join } from "node:path";
import { SHIPPED_GUIDANCE } from "../../../src/iface/texts";
import { parseLayout } from "../../../src/iface/map/layout";
import type { Printed } from "../../../src/iface/map/print";
import { pictureWords } from "../../../src/iface/map/words";
import { drawnOf, type Drawn } from "../../../src/packs/space/core/grid-model";
import { MAP_DEFAULTS, type MapConfig } from "../../../src/shared/map-config";
import { compileMaps } from "../../../src/shared/maps";
import type { MapDoc, WorldDoc } from "../../../src/shared/world";
import { inventedWorld } from "../../store/fixtures";

export { registry } from "../../store/fixtures";

/** The shipped layout of a map. */
export const LAYOUT = parseLayout(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "map-layout.md")).text());

/** A printed map's picture as the shipped layout lays it out. */
export function picture(p: Printed): string {
  return pictureWords(LAYOUT, p) ?? "";
}

/** The common room, row by row, as plan §8.2 draws it. */
export const INN_ROWS = ["#####+######", "#.......TT.#", "#.......TT.#", "#..BBB.....#", "#..........+", "#......c...#", "#HH........#", "############"];

/** The picture plan §8.2 prints for that room: the text map prints it so. */
export const INN_PICTURE = [
  "      1 2 3 4 5 6 7 8 9 10 11 12",
  "   1  # # # # # + # # # #  #  #",
  "   2  # . . . . . . . T T  .  #",
  "   3  # . . . . . . . T T  .  #",
  "   4  # . . B B B . . . .  .  #",
  "   5  # . . . . . . . . .  .  +",
  "   6  # . . . . . . c . .  .  #",
  "   7  # H H . . . . . . .  .  #",
  "   8  # # # # # # # # # #  #  #",
].join("\n");

export const INN: MapDoc = {
  id: "inn_room",
  scope: "common_room",
  title: "The common room",
  layout: INN_ROWS,
  cellMeters: 1.524,
  legend: { T: { item: "long_table" }, c: { item: "chest" }, B: { terrain: "bar", blocked: true }, H: { terrain: "hearth", blocked: true } },
};

/** Two cellar rooms, a wall between them and a door in it at (5,3). */
export const CELLAR: MapDoc = {
  id: "cellar_rooms",
  scope: "cellar",
  layout: ["#########", "#...#...#", "#...+...#", "#...#...#", "#########"],
  cellMeters: 1.524,
};

/** The town, a block to a square (today's 80 m), with the inn on the way out drawn as one square of it. */
export const TOWN: MapDoc = {
  id: "thornbury_streets",
  scope: "thornbury",
  layout: ["######", "#....#", "#....#", "######"],
  places: [{ id: "crooked_kettle", name: "The Crooked Kettle", at: [2, 1] }],
};

/** Open floor, five squares by five, at the market. */
export const OPEN: MapDoc = { id: "market_floor", scope: "market_square", layout: [".....", ".....", ".....", ".....", "....."], cellMeters: 1.524 };

/** A pillar in the middle of three squares by three, on the far road. */
export const PILLAR: MapDoc = { id: "road_pillar", scope: "far_road", layout: ["...", ".#.", "..."], cellMeters: 1.524 };

/** Two walls that meet at a corner, in the vale. */
export const SEALED: MapDoc = { id: "vale_corner", scope: "vale", layout: [".#", "#."], cellMeters: 1.524 };

/** The great hall on the far road, as large as a map can be (64 by 64 squares), parted by a wall the whole height of column 41. */
export const HALL: MapDoc = { id: "great_hall", scope: "far_road", layout: Array.from({ length: 64 }, () => `${".".repeat(40)}#${".".repeat(23)}`), cellMeters: 1.524 };

/** The invented world with the long table, the chest and a lantern on the table, and `maps` compiled. */
export function worldWith(...maps: MapDoc[]): WorldDoc {
  const w = inventedWorld();
  const thing = (id: string, kind: string, name: string, relations: WorldDoc["entities"][string]["relations"] = []): WorldDoc["entities"][string] => ({ id, kind, name, tier: "background", fields: {}, relations });
  w.entities.long_table = thing("long_table", "item", "Long table");
  w.entities.chest = thing("chest", "container", "Iron-bound chest");
  w.entities.lantern = thing("lantern", "item", "Lantern", [{ type: "on", to: "long_table" }]);
  w.maps = Object.fromEntries(maps.map((m) => [m.id, m]));
  return compileMaps(w);
}

/** What `map` draws, on the invented world with that map alone. */
export function drawn(map: MapDoc, config: Readonly<MapConfig> = MAP_DEFAULTS): Drawn {
  const d = drawnOf(worldWith(map), map.scope, config);
  if (!d) throw new Error(`${map.scope} has no grid`);
  return d;
}

/**
 * The market square's grid authored with no map, as every starter world's is: six by four squares of cobble
 * walled round, a doorway and a hatch in the wall, and a stall two squares wide. `doors` is the world's list of
 * door terrains (`mapSettings.doorTerrains`); none leaves the shipped one.
 */
export function withAuthoredMarket(w: WorldDoc, doors?: string[]): WorldDoc {
  const names: Record<string, string> = { "#": "wall", d: "doorway", h: "hatch", ".": "cobble", s: "stall" };
  const rows = ["##d###", "#.ss.#", "#....h", "######"];
  const cells = rows.join("");
  w.grids.market_square_grid = {
    id: "market_square_grid",
    width: 6,
    height: 4,
    cellMeters: 1.524,
    terrain: [...cells].map((c) => names[c] ?? "cobble"),
    blocked: [...cells].flatMap((c, i) => (c === "#" || c === "s" ? [i] : [])),
    zones: {},
  };
  const square = w.places.market_square;
  if (square) square.grid = "market_square_grid";
  if (doors) w.mapSettings = { display: "knowledge", grid: { movement: false, sightRadius: 3 }, doorTerrains: doors };
  return w;
}
