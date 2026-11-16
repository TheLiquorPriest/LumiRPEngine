// The map's settings (plan §8.2, Appendix D.1): every value of a grid that is not the map's own is a
// setting with a default, declared here and read for the chat by the turn lane (`map:` in `RPE.yml`).
// A world's ruleset says feet or metres and how a diagonal counts, and where it does, the grid reads
// that over the setting (`drawnOf`). Nothing about a grid is a constant in code.

import type { ConfigRead } from "../../app/config-read";
import type { Setting } from "../../app/setting-list";
import { DIAGONALS, MAP_DEFAULTS, UNITS, type MapConfig } from "../../shared/map-config";

export { DIAGONALS, MAP_DEFAULTS, UNITS, type Diagonal, type MapConfig, type Unit } from "../../shared/map-config";

const GROUP = "A grid laid in play";
const PRINT = "World state: the map";

/** Each setting as a config file writes it, under `map:`. Each is in force from the next turn. */
export const MAP_SETTING_DEFS = {
  laidFeet: {
    key: "map.laidFeet",
    default: MAP_DEFAULTS.laidFeet,
    takes: { type: "number", least: 0.1 },
    perConnection: false,
    name: "Width of a square laid in play",
    about: "How wide, in feet, a square is on a grid laid in play that names no size.",
    effect: "turn",
    row: GROUP,
  },
  roundSeconds: {
    key: "map.roundSeconds",
    default: MAP_DEFAULTS.roundSeconds,
    takes: { type: "number", least: 0.1 },
    perConnection: false,
    name: "Seconds in a round",
    about: "How long a round is on a grid whose square a round's move crosses; a fight counts time in them.",
    effect: "turn",
    row: GROUP,
  },
  roundFeet: {
    key: "map.roundFeet",
    default: MAP_DEFAULTS.roundFeet,
    takes: { type: "number", least: 0.1 },
    perConnection: false,
    name: "Feet moved in a round",
    about: "How far someone moves in a round, where nothing says how fast they are.",
    effect: "turn",
    row: GROUP,
  },
  printColumns: {
    key: "map.printColumns",
    default: MAP_DEFAULTS.printColumns,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Map printed, columns",
    about: "The most columns of a map the world state prints; a wider map is printed around the horizon.",
    effect: "turn",
    row: PRINT,
  },
  printRows: {
    key: "map.printRows",
    default: MAP_DEFAULTS.printRows,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Map printed, rows",
    about: "The most rows of a map the world state prints; a taller map is printed around the horizon.",
    effect: "turn",
    row: PRINT,
  },
  diagonal: {
    key: "map.diagonal",
    default: MAP_DEFAULTS.diagonal,
    takes: { type: "oneOf", values: DIAGONALS },
    perConnection: false,
    name: "How a diagonal counts",
    about: "one: a diagonal step is one square; alternate: every second diagonal in a row is two. A world's ruleset that says otherwise wins.",
    effect: "turn",
    row: GROUP,
  },
  distances: {
    key: "map.distances",
    default: MAP_DEFAULTS.distances,
    takes: { type: "oneOf", values: UNITS },
    perConnection: false,
    name: "Distances told in",
    about: "feet or metres. A world's ruleset that says otherwise wins.",
    effect: "turn",
    row: GROUP,
  },
} as const satisfies Record<keyof MapConfig, Setting>;

/** Every setting the map reads, as a config file writes it. */
export const MAP_SETTINGS: readonly Setting[] = Object.values(MAP_SETTING_DEFS);

/** The map's settings as a chat's config levels set them over the defaults. */
export function mapConfigRead(read: ConfigRead): MapConfig {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(MAP_SETTING_DEFS) as (keyof MapConfig)[]) out[name] = read.value(MAP_SETTING_DEFS[name]);
  return out as unknown as MapConfig;
}
