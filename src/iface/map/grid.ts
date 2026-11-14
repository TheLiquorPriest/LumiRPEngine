// The grid (plan §8.2): a place's map as two layers, on today's maps. What is drawn (terrain,
// walls, doors, zones, the things the map draws) is read from the map as the engine compiles it
// (`shared/maps.ts compileMaps`, `shared/grid.ts`) and changes rarely. What moves (who and what
// stands on which square, how big it is, whether it blocks, which doors are shut) is the state of
// play. Squares are written as the map prints them, [column, row] counted from 1 at the top left;
// the store keeps today's cells (x and y from 0), and `cellOf` and `squareOf` are the one
// conversion. Pure arithmetic: placing applies what it is given and reports, as codes and values,
// what does not add up.

import type { EntityId, PlaceId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { gridOf, standingGrid, type Cell } from "../../shared/grid";
import { DEFAULT_LEGEND, VOID_TERRAIN } from "../../shared/maps";
import type { GridDef, MapCellDef, WorldDoc } from "../../shared/world";
import type { Registry } from "../../engine/registry-impl";
import { isGone, kindIs } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { spotOf } from "../../packs/space/core/positions";
import type { Report } from "../../store/types";

/** A square as the map prints it and the tools take it: [column, row], from 1 at the top left. */
export type Square = readonly [number, number];

/** How a diagonal step counts: as one square, or every second one in a row as two. */
export type Diagonal = "one" | "alternate";

export type DoorState = "open" | "closed" | "locked";

/** The grid's settings, each with its default (Appendix D.1). */
export interface GridSettings {
  /** How a diagonal step counts (the ruleset's rule; as shipped, one square). */
  diagonal: Diagonal;
  /** A grid laid in play: how wide a square is, in feet. */
  laidFeet: number;
  /** A room-scale grid's time step: a round, in seconds. */
  roundSeconds: number;
  /** How far someone moves in a round, in feet. */
  roundFeet: number;
  /** The world state prints a map whole up to this many columns… */
  printColumns: number;
  /** …and rows; a larger one around a centre. */
  printRows: number;
}

export const GRID_DEFAULTS: Readonly<GridSettings> = Object.freeze({
  diagonal: "one",
  laidFeet: 5,
  roundSeconds: 6,
  roundFeet: 30,
  printColumns: 40,
  printRows: 30,
});

export const METRES_PER_FOOT = 0.3048;

/** Today's cell when a map gives none (`shared/grid.ts costMinutes`): a block of a town. */
const TODAY_CELL_METRES = 80;

/**
 * A grid's time step. On a grid whose square a round's move crosses, rounds of a few seconds, in
 * each of which someone moves so many squares; on a coarser one, today's walking minutes.
 */
export type TimeStep = { per: "round"; seconds: number; squares: number } | { per: "minute" };

/** A grid's scale: how wide a square is, how a diagonal counts, and how time passes on it. */
export interface Scale {
  metres: number;
  feet: number;
  diagonal: Diagonal;
  step: TimeStep;
}

/** How wide a square of a grid laid in play is, in metres (the map's `cellMeters`). */
export function laidMetres(settings: Readonly<GridSettings> = GRID_DEFAULTS): number {
  return settings.laidFeet * METRES_PER_FOOT;
}

/**
 * The scale of a grid whose square is `metres` wide. Today's maps carry no time step, so it
 * follows the square: when a round's move crosses at least one square, the grid counts rounds.
 */
export function scaleOf(metres: number, settings: Readonly<GridSettings> = GRID_DEFAULTS): Scale {
  // A hair over the quotient, so that 30 ft over 5 ft squares is six squares, not 5.999….
  const squares = Math.floor((settings.roundFeet * METRES_PER_FOOT) / metres + 1e-9);
  const step: TimeStep = squares >= 1 ? { per: "round", seconds: settings.roundSeconds, squares } : { per: "minute" };
  return { metres, feet: metres / METRES_PER_FOOT, diagonal: settings.diagonal, step };
}

/** What is drawn on a place's grid: the fixed layer. Indexes are row by row, from 0. */
export interface Drawn {
  /** The grid's id: the key of the map that draws it, or an authored grid's own. */
  id: string;
  /** The place whose grid it is. */
  scope: PlaceId;
  /** The map that draws it; absent for a grid authored without one. */
  map?: string;
  width: number;
  height: number;
  /** Each square's symbol as drawn: the map's layout character. */
  symbols: readonly string[];
  /** Each square's terrain, as compiled: what entering it costs reads it (`shared/grid.ts cellCost`). */
  terrain: GridDef["terrain"];
  /** Squares drawn as blocking (walls, blocked terrain, a door drawn shut). */
  blocked: ReadonlySet<number>;
  doors: ReadonlySet<number>;
  zones: Readonly<Record<string, readonly number[]>>;
  /** What each symbol stands for: the map's legend over the default one. */
  legend: Readonly<Record<string, MapCellDef>>;
  /** The things the map draws, each at the square it is drawn on. */
  items: Readonly<Record<EntityId, number>>;
  scale: Scale;
}

/** Terrain a door can be opened and shut on; today's entrance finder reads the same words. */
const DOOR = /door|gate/i;

const TERRAIN_SYMBOL: Readonly<Record<string, string>> = { wall: "#", door: "+", floor: ".", "": ".", [VOID_TERRAIN]: " " };

/** Symbols for a grid authored without a map: the default legend's, and a letter for each other terrain. */
function symbolsOfTerrain(grid: GridDef): { symbols: string[]; legend: Record<string, MapCellDef> } {
  const legend: Record<string, MapCellDef> = { ...DEFAULT_LEGEND };
  const blocked = new Set(grid.blocked);
  const given = new Map<string, string>(Object.entries(TERRAIN_SYMBOL));
  const free = [..."abcdefghijklmnopqrstuvwxyz0123456789"];
  const symbols = grid.terrain.map((t, i) => {
    let s = given.get(t);
    if (s === undefined) {
      s = free.shift() ?? "?";
      given.set(t, s);
      legend[s] = { terrain: t, ...(blocked.has(i) ? { blocked: true } : {}) };
    }
    return s;
  });
  return { symbols, legend };
}

/** What is drawn on `scope`'s own grid, read from the world as the engine compiles it; null when the place has none. */
export function drawnOf(world: Pick<WorldDoc, "places" | "grids" | "maps">, scope: PlaceId, settings: Readonly<GridSettings> = GRID_DEFAULTS): Drawn | null {
  const grid = gridOf(world, scope);
  if (!grid) return null;
  const map = grid.map !== undefined && hasOwn(world.maps, grid.map) ? world.maps[grid.map] : undefined;
  let symbols: string[];
  let legend: Record<string, MapCellDef>;
  if (map?.layout) {
    legend = { ...DEFAULT_LEGEND, ...(map.legend ?? {}) };
    symbols = [];
    // As the compiler reads a layout: a short row is padded with nothing.
    for (let y = 0; y < grid.height; y++) {
      const row = [...(map.layout[y] ?? "")];
      for (let x = 0; x < grid.width; x++) symbols.push(row[x] ?? " ");
    }
  } else ({ symbols, legend } = symbolsOfTerrain(grid));
  const doors = new Set<number>();
  grid.terrain.forEach((t, i) => {
    if (DOOR.test(t)) doors.add(i);
  });
  return {
    id: grid.id,
    scope,
    ...(map ? { map: map.id } : {}),
    width: grid.width,
    height: grid.height,
    symbols,
    terrain: grid.terrain,
    blocked: new Set(grid.blocked),
    doors,
    zones: grid.zones,
    legend,
    items: grid.items ?? {},
    scale: scaleOf(grid.cellMeters ?? TODAY_CELL_METRES, settings),
  };
}

// ---------------------------------------------------------------- squares

/** A square's index on a grid, or null off it. */
export function indexOf(grid: Pick<Drawn, "width" | "height">, s: Square): number | null {
  const [c, r] = s;
  return Number.isInteger(c) && Number.isInteger(r) && c >= 1 && r >= 1 && c <= grid.width && r <= grid.height ? (r - 1) * grid.width + (c - 1) : null;
}

export function squareAt(grid: Pick<Drawn, "width">, index: number): Square {
  return [(index % grid.width) + 1, Math.floor(index / grid.width) + 1];
}

/** Today's cell (as the store keeps x and y) of a square. */
export function cellOf(s: Square): Cell {
  return { x: s[0] - 1, y: s[1] - 1 };
}

/** The square of today's cell. */
export function squareOf(c: Cell): Square {
  return [c.x + 1, c.y + 1];
}

export function squareKey(s: Square): string {
  return `${s[0]},${s[1]}`;
}

// ---------------------------------------------------------------- what moves

/** Someone or something on a grid. */
export interface Piece {
  /** Its square: the top left of its footprint. Absent for what lies on or in something else. */
  at?: Square;
  /** What it lies on or in; it stands where that stands. */
  on?: EntityId;
  /** Its footprint, [columns, rows]; one square when absent. */
  size?: Square;
  /** Whether its footprint blocks the way and the view; neither when absent. */
  blocks?: { way?: boolean; view?: boolean };
}

/** What moves on a grid: the second layer. */
export interface Moving {
  pieces: Readonly<Record<EntityId, Piece>>;
  /** Doors play has opened, shut or locked, by square (`squareKey`); any other door is as drawn. */
  doors: Readonly<Record<string, DoorState>>;
}

export const NOTHING_MOVES: Moving = Object.freeze({ pieces: Object.freeze({}), doors: Object.freeze({}) });

function pieceOf(moving: Moving, id: EntityId): Piece | undefined {
  return hasOwn(moving.pieces, id) ? moving.pieces[id] : undefined;
}

/** Where something stands: its own square, or that of what it lies on, followed down. Null when it stands nowhere on the grid. */
export function standsAt(moving: Moving, id: EntityId): Square | null {
  let at: EntityId | undefined = id;
  for (let guard = Object.keys(moving.pieces).length; at !== undefined && guard >= 0; guard--) {
    const p = pieceOf(moving, at);
    if (!p) return null;
    if (p.at) return p.at;
    at = p.on;
  }
  return null;
}

/** The squares something covers: its footprint from where it stands, the part on the grid. */
export function footprint(grid: Pick<Drawn, "width" | "height">, moving: Moving, id: EntityId): number[] {
  const at = standsAt(moving, id);
  if (!at) return [];
  const [w, h] = pieceOf(moving, id)?.size ?? [1, 1];
  const out: number[] = [];
  for (let r = at[1]; r < at[1] + h; r++) {
    for (let c = at[0]; c < at[0] + w; c++) {
      const i = indexOf(grid, [c, r]);
      if (i !== null) out.push(i);
    }
  }
  return out;
}

/** A door's state: as play set it, else as drawn (a door drawn blocked is shut). Null where there is no door. */
export function doorState(drawn: Drawn, moving: Moving, index: number): DoorState | null {
  if (!drawn.doors.has(index)) return null;
  const key = squareKey(squareAt(drawn, index));
  return hasOwn(moving.doors, key) ? (moving.doors[key] ?? null) : drawn.blocked.has(index) ? "closed" : "open";
}

/** The squares that block the way and the view as play stands. */
export interface Blockers {
  way: ReadonlySet<number>;
  view: ReadonlySet<number>;
}

/**
 * What blocks as play stands: walls and blocked terrain as drawn, every door that is not open, and
 * the footprints that block, but those of `except` (who moves, who looks).
 */
export function blockersOf(drawn: Drawn, moving: Moving, except: readonly EntityId[] = []): Blockers {
  const way = new Set<number>();
  const view = new Set<number>();
  for (const i of drawn.blocked) {
    if (drawn.doors.has(i)) continue;
    way.add(i);
    view.add(i);
  }
  for (const i of drawn.doors) {
    if (doorState(drawn, moving, i) === "open") continue;
    way.add(i);
    view.add(i);
  }
  for (const [id, p] of Object.entries(moving.pieces)) {
    if (except.includes(id) || !(p.blocks?.way || p.blocks?.view)) continue;
    for (const i of footprint(drawn, moving, id)) {
      if (p.blocks.way) way.add(i);
      if (p.blocks.view) view.add(i);
    }
  }
  return { way, view };
}

/** What changing the moving layer came to: the layer after, and what does not add up. */
export interface Placed {
  moving: Moving;
  reports: Report[];
}

/** What does not add up where `id` now stands: off the grid's edge, in a wall or a shut door, over something that blocks. */
function problemsAt(drawn: Drawn, moving: Moving, id: EntityId): Report[] {
  const reports: Report[] = [];
  const at = standsAt(moving, id);
  if (!at) return [{ code: "stands_nowhere", values: { what: id } }];
  const [w, h] = pieceOf(moving, id)?.size ?? [1, 1];
  const mine = footprint(drawn, moving, id);
  if (mine.length < w * h) reports.push({ code: "off_edge", values: { what: id, square: [...at] } });
  const shut = blockersOf(drawn, { ...moving, pieces: {} }).way;
  const walls = mine.filter((i) => shut.has(i)).map((i) => [...squareAt(drawn, i)]);
  if (walls.length > 0) reports.push({ code: "in_wall", values: { what: id, squares: walls } });
  const me = pieceOf(moving, id);
  const covered = new Set(mine);
  for (const [other, p] of Object.entries(moving.pieces)) {
    if (other === id || p.on !== undefined || !(p.blocks?.way || me?.blocks?.way)) continue;
    if (footprint(drawn, moving, other).some((i) => covered.has(i))) reports.push({ code: "overlaps", values: { what: id, with: other } });
  }
  return reports;
}

/**
 * Puts someone or something on a square, or moves them there: its footprint and whether it blocks
 * kept unless given. A square off the grid is not applied; anything else is, with its reports.
 */
export function place(drawn: Drawn, moving: Moving, id: EntityId, at: Square, shape: Pick<Piece, "size" | "blocks"> = {}): Placed {
  if (indexOf(drawn, at) === null) return { moving, reports: [{ code: "off_grid", values: { what: id, square: [...at], width: drawn.width, height: drawn.height } }] };
  const was = pieceOf(moving, id);
  const size = shape.size ?? was?.size;
  const blocks = shape.blocks ?? was?.blocks;
  const piece: Piece = { at: [at[0], at[1]], ...(size ? { size: [size[0], size[1]] as Square } : {}), ...(blocks ? { blocks: { ...blocks } } : {}) };
  const next: Moving = { ...moving, pieces: { ...moving.pieces, [id]: piece } };
  return { moving: next, reports: problemsAt(drawn, next, id) };
}

/** Lays something on or in something else on the grid (the lantern on the table): it shares that one's square. */
export function putOn(moving: Moving, id: EntityId, holder: EntityId): Placed {
  const was = pieceOf(moving, id);
  const piece: Piece = { on: holder, ...(was?.size ? { size: was.size } : {}) };
  const next: Moving = { ...moving, pieces: { ...moving.pieces, [id]: piece } };
  return { moving: next, reports: standsAt(next, id) === null ? [{ code: "holder_off_grid", values: { what: id, holder } }] : [] };
}

/** Takes someone or something off the grid (picked up, gone from the place); what lay on it goes with it. */
export function lift(moving: Moving, id: EntityId): Moving {
  if (!hasOwn(moving.pieces, id)) return moving;
  const pieces = { ...moving.pieces };
  delete pieces[id];
  return { ...moving, pieces };
}

/** Opens, shuts or locks the door on a square. A square that is no door is not applied; a door shut on someone is, and says so. */
export function setDoor(drawn: Drawn, moving: Moving, at: Square, state: DoorState): Placed {
  const i = indexOf(drawn, at);
  if (i === null || !drawn.doors.has(i)) return { moving, reports: [{ code: "not_a_door", values: { square: [...at] } }] };
  const next: Moving = { ...moving, doors: { ...moving.doors, [squareKey(at)]: state } };
  const reports: Report[] = [];
  if (state !== "open") for (const id of Object.keys(moving.pieces).sort()) if (footprint(drawn, moving, id).includes(i)) reports.push({ code: "door_on", values: { square: [...at], what: id } });
  return { moving: next, reports };
}

// ---------------------------------------------------------------- from the store

/** Who and what stands on a grid as the store holds it, and who is at the place with no square yet. */
export interface StoredMoving {
  moving: Moving;
  /** At a place this grid draws, with no square on it: placed when the scene opens. */
  unplaced: EntityId[];
}

/**
 * The moving layer of `drawn` from a chat's state (`world` the world as the chat plays it): each
 * person and thing standing on a square of it (today's `place`, `x` and `y`), and each thing lying
 * in a thing that stands there (today's `in`). What a person carries is theirs, not the floor's.
 * Today's state holds no footprint, blocking or door state: those stay as drawn.
 */
export function movingOf(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, drawn: Drawn): StoredMoving {
  const pieces: Record<EntityId, Piece> = {};
  const unplaced: EntityId[] = [];
  const ids = Object.keys(state.entities).sort();
  for (const id of ids) {
    const e = state.entities[id];
    if (!e || isGone(state, id)) continue;
    const place = e.fields.place;
    if (typeof place === "string" && place !== "") {
      if (standingGrid(world, place)?.scope !== drawn.scope) continue;
      const spot = spotOf(world, state, id);
      if (spot) pieces[id] = { at: squareOf(spot) };
      else unplaced.push(id);
    }
  }
  // A thing in a thing in a thing: each pass lays on the grid what lies in something laid on it, until none is left.
  for (let laid = true; laid; ) {
    laid = false;
    for (const id of ids) {
      const e = state.entities[id];
      if (!e || isGone(state, id) || hasOwn(pieces, id) || (typeof e.fields.place === "string" && e.fields.place !== "")) continue;
      const holder = e.relations.find((r) => r.type === "in")?.to;
      const held = holder !== undefined ? state.entities[holder] : undefined;
      if (holder === undefined || !held || !hasOwn(pieces, holder) || kindIs(registry, world, held.kind, "person")) continue;
      pieces[id] = { on: holder };
      laid = true;
    }
  }
  return { moving: { pieces, doors: {} }, unplaced };
}
