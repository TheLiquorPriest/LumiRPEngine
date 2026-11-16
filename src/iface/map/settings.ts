// The map's settings (plan §8.2, Appendix D.1): every value of a grid that is not the map's own is a
// setting with a default, declared here and read for the chat by the turn lane (`map:` in `RPE.yml`).
// A world's ruleset says feet or metres and how a diagonal counts, and where it does, the grid reads
// that over the setting (`drawnOf`). Nothing about a grid is a constant in code.

import type { ConfigRead } from "../../app/config-read";
import type { Setting } from "../../app/setting-list";
import { AREA_STARTS, DIAGONALS, DISPLAYS, LIGHTS, MAP_DEFAULTS, UNITS, type MapConfig } from "../../shared/map-config";

export { AREA_STARTS, DIAGONALS, DISPLAYS, LIGHTS, MAP_DEFAULTS, UNITS, type AreaStart, type Diagonal, type Display, type Light, type MapConfig, type Unit } from "../../shared/map-config";

// D.1's rows name the width of a square laid in play, how a diagonal counts, a round's seconds and the size printed whole; a round's move, the unit and the picture are beyond D.1.

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
    row: "A grid laid in play",
  },
  roundSeconds: {
    key: "map.roundSeconds",
    default: MAP_DEFAULTS.roundSeconds,
    takes: { type: "number", least: 0.1 },
    perConnection: false,
    name: "Seconds in a round",
    about: "How long a round is on a grid whose square a round's move crosses; a fight counts time in them.",
    effect: "turn",
    row: "A grid laid in play",
  },
  roundFeet: {
    key: "map.roundFeet",
    default: MAP_DEFAULTS.roundFeet,
    takes: { type: "number", least: 0.1 },
    perConnection: false,
    name: "Feet moved in a round",
    about: "How far someone moves in a round, where nothing says how fast they are.",
    effect: "turn",
  },
  printColumns: {
    key: "map.printColumns",
    default: MAP_DEFAULTS.printColumns,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Map printed, columns",
    about: "The most columns of a map the world state prints; a wider map is printed around the horizon.",
    effect: "turn",
    row: "World state: the map",
  },
  printRows: {
    key: "map.printRows",
    default: MAP_DEFAULTS.printRows,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Map printed, rows",
    about: "The most rows of a map the world state prints; a taller map is printed around the horizon.",
    effect: "turn",
    row: "World state: the map",
  },
  diagonal: {
    key: "map.diagonal",
    default: MAP_DEFAULTS.diagonal,
    takes: { type: "oneOf", values: DIAGONALS },
    perConnection: false,
    name: "How a diagonal counts",
    about: "one: a diagonal step is one square; alternate: every second diagonal in a row is two. A world's ruleset that says otherwise wins.",
    effect: "turn",
    row: "A grid laid in play",
  },
  distances: {
    key: "map.distances",
    default: MAP_DEFAULTS.distances,
    takes: { type: "oneOf", values: UNITS },
    perConnection: false,
    name: "Distances told in",
    about: "feet or metres. A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  picture: {
    key: "map.picture",
    default: MAP_DEFAULTS.picture,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "World state prints the map's picture",
    about: "The world state prints the map's picture with its legend; off, it gives the title and the legend and the list of who and what is where carries the load.",
    effect: "turn",
  },
  areaStart: {
    key: "map.areaStart",
    default: MAP_DEFAULTS.areaStart,
    takes: { type: "oneOf", values: AREA_STARTS },
    perConnection: false,
    name: "Where an area starts",
    about: "corner: at a point where squares meet, as D&D's grid rule has it; middle: at the middle of a square. Every area (a radius, a cone, a line, a cube) follows it. A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  areaShare: {
    key: "map.areaShare",
    default: MAP_DEFAULTS.areaShare,
    takes: { type: "number", least: 0, most: 1 },
    perConnection: false,
    name: "Share of a square an area must cover",
    about: "From 0 to 1: the share of a square an area must cover for the square to count; 0.5 is D&D's half, and 0 counts any square the area covers any of. A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  coverHalf: {
    key: "map.coverHalf",
    default: MAP_DEFAULTS.coverHalf,
    takes: { type: "whole", least: 1, most: 4 },
    perConnection: false,
    name: "Lines blocked for half cover",
    about: "Of the four lines from a corner of the attacker's square to the corners of the target's, how many blocked give half cover (D&D: one or two). A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  coverThreeQuarters: {
    key: "map.coverThreeQuarters",
    default: MAP_DEFAULTS.coverThreeQuarters,
    takes: { type: "whole", least: 1, most: 4 },
    perConnection: false,
    name: "Lines blocked for three-quarters cover",
    about: "How many of the four lines, blocked, give three-quarters cover (D&D: three). A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  coverTotal: {
    key: "map.coverTotal",
    default: MAP_DEFAULTS.coverTotal,
    takes: { type: "whole", least: 1, most: 4 },
    perConnection: false,
    name: "Lines blocked for total cover",
    about: "How many of the four lines, blocked, give total cover (D&D: four). A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  coverCreatures: {
    key: "map.coverCreatures",
    default: MAP_DEFAULTS.coverCreatures,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "Creatures give cover",
    about: "Whether other people and things standing between an attacker and a target obstruct the lines, as D&D has it. A world's ruleset that says otherwise wins.",
    effect: "turn",
  },
  lightUnset: {
    key: "map.lightUnset",
    default: MAP_DEFAULTS.lightUnset,
    takes: { type: "oneOf", values: LIGHTS },
    perConnection: false,
    name: "A place with no light recorded reads",
    about: "lit or dark: how a place reads, on the grid and to sight, when neither it nor any place above it has had its light set (world_apply, set, key light).",
    effect: "turn",
  },
  display: {
    key: "map.display",
    default: MAP_DEFAULTS.display,
    takes: { type: "oneOf", values: DISPLAYS },
    perConnection: false,
    name: "How the map panel shows the map",
    about: "world: as the world says; knowledge: only what the character knows, places heard of drawn dashed; fog: fog over what it has not seen. The panel's Known and Fog switch writes this for the chat.",
    effect: "turn",
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
