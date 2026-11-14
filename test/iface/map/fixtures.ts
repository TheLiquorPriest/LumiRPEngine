// Invented maps for the grid's tests, on the store lane's invented world: the inn's common room as
// plan §8.2 prints it, two cellar rooms with a door between them, and the town drawn a block to a
// square. Every name here is made up.

import { drawnOf, GRID_DEFAULTS, type Drawn, type GridSettings } from "../../../src/iface/map/grid";
import { compileMaps } from "../../../src/shared/maps";
import type { MapDoc, WorldDoc } from "../../../src/shared/world";
import { inventedWorld } from "../../store/fixtures";

export { registry } from "../../store/fixtures";

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

/** The invented world with the long table, the chest and a lantern on the table, and `maps` compiled. */
export function worldWith(...maps: MapDoc[]): WorldDoc {
  const w = inventedWorld();
  const thing = (id: string, kind: string, name: string, relations: WorldDoc["entities"][string]["relations"] = []): WorldDoc["entities"][string] => ({ id, kind, name, tier: "background", fields: {}, relations });
  w.entities.long_table = thing("long_table", "item", "Long table");
  w.entities.chest = thing("chest", "container", "Iron-bound chest");
  w.entities.lantern = thing("lantern", "item", "Lantern", [{ type: "in", to: "long_table" }]);
  w.maps = Object.fromEntries(maps.map((m) => [m.id, m]));
  return compileMaps(w);
}

/** What `map` draws, on the invented world with that map alone. */
export function drawn(map: MapDoc, settings: Readonly<GridSettings> = GRID_DEFAULTS): Drawn {
  const d = drawnOf(worldWith(map), map.scope, settings);
  if (!d) throw new Error(`${map.scope} has no grid`);
  return d;
}
