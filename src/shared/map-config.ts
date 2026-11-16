// What a grid reads of the map's settings (plan §8.2, Appendix D.1): the values, their defaults and the
// words that name them. The settings that carry them (`map:` in a config file) are declared by
// `iface/map/settings.ts`; the space pack's geometry reads the values from here, below the interface.

/** How a diagonal step counts: as one square, or every second one in a row as two. */
export const DIAGONALS = ["one", "alternate"] as const;
export type Diagonal = (typeof DIAGONALS)[number];

/** What a distance is told in. */
export const UNITS = ["feet", "metres"] as const;
export type Unit = (typeof UNITS)[number];

/** Where an area starts (a burst's middle, a cone's point, a line's end, a cube's face): at a point where squares meet, or at the middle of a square. */
export const AREA_STARTS = ["corner", "middle"] as const;
export type AreaStart = (typeof AREA_STARTS)[number];

/** What a place's light is: it is lit, or it is dark (plan §8.2, "what is lit"). */
export const LIGHTS = ["lit", "dark"] as const;
export type Light = (typeof LIGHTS)[number];

/** Where an area starts, and the share of a square it must cover for the square to count (a share of 0 counts any square it covers any of). */
export interface AreaRule {
  start: AreaStart;
  share: number;
}

/** Cover (what stands between an attacker and a target): how many of the four lines between their corners, blocked, give half cover, three-quarters cover and total cover; and whether creatures obstruct. */
export interface CoverRule {
  half: number;
  threeQuarters: number;
  total: number;
  creatures: boolean;
}

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
  /** Where an area starts, where the world's ruleset says nothing. */
  areaStart: AreaStart;
  /** The share of a square an area must cover for it to count, where the world's ruleset says nothing. */
  areaShare: number;
  /** Of the four lines between an attacker's corner and a target's corners, how many blocked give half cover, where the world's ruleset says nothing… */
  coverHalf: number;
  /** …three-quarters cover… */
  coverThreeQuarters: number;
  /** …and total cover. */
  coverTotal: number;
  /** Whether creatures obstruct the lines, where the world's ruleset says nothing. */
  coverCreatures: boolean;
  /** What a place with no light recorded (and none above it that has) reads as. */
  lightUnset: Light;
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
  // R-160: D&D's grid rules. An area starts where squares meet and counts a square it covers by half; one or two lines blocked of four are half cover, three three-quarters, four total, and creatures obstruct.
  areaStart: "corner",
  areaShare: 0.5,
  coverHalf: 1,
  coverThreeQuarters: 3,
  coverTotal: 4,
  coverCreatures: true,
  // A place nobody has said is dark is lit.
  lightUnset: "lit",
});
