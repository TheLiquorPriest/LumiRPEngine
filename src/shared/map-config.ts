// What a grid reads of the map's settings (plan §8.2, Appendix D.1): the values, their defaults and the
// words that name them. The settings that carry them (`map:` in a config file) are declared by
// `iface/map/settings.ts`; the space pack's geometry reads the values from here, below the interface.

/** How a diagonal step counts: as one square, or every second one in a row as two. */
export const DIAGONALS = ["one", "alternate"] as const;
export type Diagonal = (typeof DIAGONALS)[number];

/** What a distance is told in. */
export const UNITS = ["feet", "metres"] as const;
export type Unit = (typeof UNITS)[number];

export const METRES_PER_FOOT = 0.3048;

/** The map's settings for a chat. */
export interface MapConfig {
  /** A grid laid in play: how wide a square is, in feet. */
  laidFeet: number;
  /** A room-scale grid's time step: a round, in seconds. */
  roundSeconds: number;
  /** How far someone moves in a round, in feet. */
  roundFeet: number;
  /** The world state prints a map whole up to this many columns… */
  printColumns: number;
  /** …and rows; a larger one around the horizon. */
  printRows: number;
  /** How a diagonal step counts, where the world's ruleset says nothing. */
  diagonal: Diagonal;
  /** What distances are told in, where the world's ruleset says nothing. */
  distances: Unit;
  /** The world state prints the map's picture (§22 l.2120's remedy: off, the list carries the load). */
  picture: boolean;
}

/** Appendix D.1: squares of 5 ft, rounds of 6 seconds, a map printed whole up to 40 by 30, a diagonal as one square, feet. */
export const MAP_DEFAULTS: Readonly<MapConfig> = Object.freeze({
  laidFeet: 5,
  roundSeconds: 6,
  // D.1 names rounds of 6 seconds and not the feet: 30 ft a round is the D&D walking speed.
  roundFeet: 30,
  printColumns: 40,
  printRows: 30,
  diagonal: "one",
  distances: "feet",
  picture: true,
});
