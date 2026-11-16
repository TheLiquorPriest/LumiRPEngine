// The grid (plan §8.2), the space pack's one geometry: a place's map as two layers, on today's
// maps. What is drawn (terrain, walls, doors, zones, the things the map draws) is read from the map
// as the engine compiles it (`shared/maps.ts compileMaps`, `shared/grid.ts`), with the squares play
// drew anew laid over it (`space.squares`), and changes rarely. What moves (who and what stands on
// which square, how big it is, whether it blocks, which doors are shut) is the state of play:
// today's positions, and the pack's doors and footprints (`grid-play.ts`). Squares are written as
// the map prints them, [column, row] counted from 1 at the top left; the store keeps today's cells
// (x and y from 0), and `cellOf` and `squareOf` are the one conversion. Pure arithmetic: placing
// applies what it is given and reports, as codes and values, what does not add up. The map tools
// (`iface/maptools.ts`), the panel's view, a step and reach all read this one geometry, with
// `grid-path.ts` (ways) and `grid-measure.ts` (distance, areas, sight).

import type { EntityId, PlaceId } from "../../../shared/ids";
import { hasOwn, isRecord } from "../../../shared/json";
import type { JsonObject } from "../../../shared/json";
import { cellIndex, costMinutes, DEFAULT_CELL_METRES, gridOf, standingGrid, type Cell } from "../../../shared/grid";
import { MAP_DEFAULTS, METRES_PER_FOOT, type Diagonal, type MapConfig, type Unit } from "../../../shared/map-config";
import { compileMaps, DEFAULT_LEGEND, VOID_TERRAIN } from "../../../shared/maps";
import type { GridDef, MapCellDef, MapDoc, RulesetDef, WorldDoc } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";
import type { Registry } from "../../../engine/registry-impl";
import { isGone, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { doorsAt, editedMap, mapStepOf, seesThrough, shapeOf, squareEditsOf, type DoorState, type MapStep, type SquareEdits } from "./grid-play";

export type { DoorState } from "./grid-play";

/** What does not add up on a grid, as a code and its values, never words; the store keeps it as a report (`Report`). */
export interface GridReport {
  code: string;
  values: JsonObject;
}

/** A square as the map prints it and the tools take it: [column, row], from 1 at the top left. */
export type Square = readonly [number, number];

export { METRES_PER_FOOT, type Diagonal, type Unit };

/**
 * A grid's time step: as its map gives it (`step`), or following the square. On a grid whose
 * square a round's move crosses, rounds of a few seconds, in each of which someone moves so many
 * squares; on a coarser one, today's walking minutes.
 */
export type TimeStep = MapStep;

/** A grid's scale: how wide a square is, how a diagonal counts, what its distances are told in, and how time passes on it. */
export interface Scale {
  metres: number;
  feet: number;
  diagonal: Diagonal;
  unit: Unit;
  step: TimeStep;
}

/** How wide a square of a grid laid in play is, in metres (the map's `cellMeters`). */
export function laidMetres(config: Readonly<MapConfig> = MAP_DEFAULTS): number {
  return config.laidFeet * METRES_PER_FOOT;
}

/**
 * The scale of a grid whose square is `metres` wide. Today's maps carry no time step, so it
 * follows the square: when a round's move crosses at least one square, the grid counts rounds. The
 * world's ruleset, where it says how a diagonal counts or whether distances are feet or metres,
 * says it over the settings.
 */
export function scaleOf(metres: number, config: Readonly<MapConfig> = MAP_DEFAULTS, ruleset?: Pick<RulesetDef, "diagonal" | "distances">): Scale {
  // A hair over the quotient, so that 30 ft over 5 ft squares is six squares, not 5.999….
  const squares = Math.floor((config.roundFeet * METRES_PER_FOOT) / metres + 1e-9);
  const step: TimeStep = squares >= 1 ? { per: "round", seconds: config.roundSeconds, squares } : { per: "minute" };
  return { metres, feet: metres / METRES_PER_FOOT, diagonal: ruleset?.diagonal ?? config.diagonal, unit: ruleset?.distances ?? config.distances, step };
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
  /** Of those, the ones the view passes over (a blocked terrain marked `seeThrough`: a bar, a low wall). */
  seeThrough: ReadonlySet<number>;
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

/** Each played world's maps with play's square changes laid over, by the changes' record: compiled once for each. */
const EDITED = new WeakMap<WorldDoc, WeakMap<SquareEdits, { map: MapDoc; grid: GridDef } | null>>();

/** `map` with play's changes laid over it, and the grid that compiles from it as today's compiler reads a map; null where it compiles to none. */
function edited(world: WorldDoc, map: MapDoc, edits: SquareEdits): { map: MapDoc; grid: GridDef } | null {
  let byEdits = EDITED.get(world);
  if (byEdits?.has(edits)) return byEdits.get(edits) ?? null;
  const drawn = editedMap(map, edits);
  const compiled = compileMaps({ ...world, maps: { ...world.maps, [map.id]: drawn } });
  const grid = hasOwn(compiled.grids, map.id) ? compiled.grids[map.id] : undefined;
  const out = grid ? { map: drawn, grid } : null;
  if (byEdits === undefined) {
    byEdits = new WeakMap();
    EDITED.set(world, byEdits);
  }
  byEdits.set(edits, out);
  return out;
}

/**
 * What is drawn on `scope`'s own grid, read from the world as the engine compiles it, with the
 * squares play drew anew in `play` (the chat's state) laid over its map; null when the place has
 * none.
 */
export function drawnOf(world: WorldDoc, scope: PlaceId, config: Readonly<MapConfig> = MAP_DEFAULTS, play?: Readonly<WorldState>): Drawn | null {
  let grid = gridOf(world, scope);
  if (!grid) return null;
  let map = grid.map !== undefined && hasOwn(world.maps, grid.map) ? world.maps[grid.map] : undefined;
  const edits = map && play ? squareEditsOf(play, map.id) : null;
  const over = map && edits ? edited(world, map, edits) : null;
  if (over) ({ map, grid } = over);
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
  const seeThrough = new Set<number>();
  for (const i of grid.blocked) {
    const s = symbols[i] ?? "";
    if (hasOwn(legend, s) && seesThrough(legend[s])) seeThrough.add(i);
  }
  const scale = scaleOf(grid.cellMeters ?? DEFAULT_CELL_METRES, config, world.ruleset);
  const step = map ? mapStepOf(map) : null;
  return {
    id: grid.id,
    scope,
    ...(map ? { map: map.id } : {}),
    width: grid.width,
    height: grid.height,
    symbols,
    terrain: grid.terrain,
    blocked: new Set(grid.blocked),
    seeThrough,
    doors,
    zones: grid.zones,
    legend,
    items: grid.items ?? {},
    scale: step ? { ...scale, step } : scale,
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
  /** That it lies in what `on` names (a holder's contents), not on it (a support's); absent for what is on it. */
  within?: true;
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
    if (!drawn.seeThrough.has(i)) view.add(i);
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
  reports: GridReport[];
}

/** What does not add up where `id` now stands: off the grid's edge, in a wall or a shut door, over something that blocks. */
function problemsAt(drawn: Drawn, moving: Moving, id: EntityId): GridReport[] {
  const reports: GridReport[] = [];
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
  const reports: GridReport[] = [];
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
 * in a thing that stands there (today's `in`), with its footprint and what it blocks as play set
 * them (`space.shape`); and the doors play opened, shut or locked (`space.door`). What a person
 * carries is theirs, not the floor's.
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
      if (spot) pieces[id] = { at: squareOf(spot), ...shaped(state, id) };
      else unplaced.push(id);
    }
  }
  // A thing in a thing in a thing, or on one: each pass lays on the grid what lies in or on something laid on it, until none is left.
  for (let laid = true; laid; ) {
    laid = false;
    for (const id of ids) {
      const e = state.entities[id];
      if (!e || isGone(state, id) || hasOwn(pieces, id) || (typeof e.fields.place === "string" && e.fields.place !== "")) continue;
      const rel = e.relations.find((r) => r.type === "in" || r.type === "on");
      const holder = rel?.to;
      const held = holder !== undefined ? state.entities[holder] : undefined;
      // What someone carries is theirs, not the floor's; something on a person or a thing, or in a thing, stands where that does.
      if (rel === undefined || holder === undefined || !held || !hasOwn(pieces, holder) || (rel.type === "in" && kindIs(registry, world, held.kind, "person"))) continue;
      pieces[id] = { on: holder, ...(rel.type === "in" ? { within: true as const } : {}), ...shaped(state, id) };
      laid = true;
    }
  }
  const doors: Record<string, DoorState> = {};
  for (const [cell, s] of Object.entries(doorsAt(state, drawn.scope))) {
    const [x = -1, y = -1] = cell.split(",").map(Number);
    doors[squareKey(squareOf({ x, y }))] = s;
  }
  return { moving: { pieces, doors }, unplaced };
}

/** A piece's footprint and what it blocks, as play set them; nothing for one square that blocks nothing. */
function shaped(state: Readonly<WorldState>, id: EntityId): Pick<Piece, "size" | "blocks"> {
  const s = shapeOf(state, id);
  return s ? { size: [s.size[0], s.size[1]], ...(s.way || s.view ? { blocks: { way: s.way, view: s.view } } : {}) } : {};
}

// ---------------------------------------------------------------- where someone stands, as the store keeps it

/** A cell on the grid of a place (`scope`, the place whose grid it is). */
export interface GridSpot {
  scope: PlaceId;
  x: number;
  y: number;
}

/** How deep a chain of holders is followed to find where something carried stands. */
export const HOLD_DEPTH = 32;

/** A `space.pos` spot as written, or null (off any grid, or not a spot). */
export function spotData(v: unknown): GridSpot | null {
  return isRecord(v) && typeof v.scope === "string" && Number.isInteger(v.x) && Number.isInteger(v.y) ? { scope: v.scope, x: Number(v.x), y: Number(v.y) } : null;
}

/**
 * Where an entity stands on a grid: its own cell on the grid its place stands on; for something
 * carried or lying on something, its outermost holder's or support's. Null off any grid, or with no cell on it.
 */
export function spotOf(world: WorldDoc, state: Readonly<WorldState>, entity: EntityId): GridSpot | null {
  let id = entity;
  for (let depth = 0; depth < HOLD_DEPTH; depth++) {
    const e = own(state.entities, id);
    if (!e) return null;
    const place = e.fields.place;
    if (typeof place === "string" && place !== "") {
      const stand = standingGrid(world, place);
      const { x, y } = e.fields;
      return stand && typeof x === "number" && typeof y === "number" && cellIndex(stand.grid, { x, y }) !== null ? { scope: stand.scope, x, y } : null;
    }
    const holder = e.relations.find((r) => r.type === "in" || r.type === "on")?.to;
    if (holder === undefined) return null;
    id = holder;
  }
  return null;
}

/** What the pack's own code reads of the world to work a grid out as play stands. */
export interface GroundSource {
  readonly registry: Registry;
  readonly world: WorldDoc;
  readonly state: Readonly<WorldState>;
}

/** A grid as play stands: what is drawn, what moves, and who is at its place with no square yet. */
export interface Ground extends StoredMoving {
  drawn: Drawn;
}

/** The grid someone at `place` stands on (its own, or the one its parent draws it on) as play stands; null where there is none. `config` the chat's map settings. */
export function groundAt(source: GroundSource, place: PlaceId | null, config: Readonly<MapConfig> = MAP_DEFAULTS): Ground | null {
  const stand = standingGrid(source.world, place);
  const drawn = stand ? drawnOf(source.world, stand.scope, config, source.state) : null;
  return drawn ? { drawn, ...movingOf(source.registry, source.world, source.state, drawn) } : null;
}

// ---------------------------------------------------------------- time on a grid

/** How long something took on a grid. */
export interface Took {
  seconds: number;
  /** On a grid that counts rounds, how many. */
  rounds?: number;
}

/**
 * How long a move that costs `cost` (a way's movement, `Walk.cost`) takes on a grid of `scale`:
 * whole rounds at the grid's squares a round, or at `speed` squares a round for a mover whose
 * speed is known; on a coarser grid, today's walking minutes (`shared/grid.ts costMinutes`: 80 m a
 * minute, at least one minute for any step).
 */
export function moveTime(scale: Scale, cost: number, speed?: number): Took {
  if (scale.step.per === "round") {
    const rounds = cost > 0 ? Math.ceil(cost / (speed !== undefined && speed > 0 ? speed : scale.step.squares)) : 0;
    return { seconds: rounds * scale.step.seconds, rounds };
  }
  return { seconds: cost > 0 ? Math.max(1, costMinutes({ cellMeters: scale.metres }, cost)) * 60 : 0 };
}

/** How long `rounds` rounds of a fight take on a grid of `scale`; null on a grid that does not count rounds. */
export function roundsTime(scale: Scale, rounds: number): Took | null {
  return scale.step.per === "round" ? { seconds: rounds * scale.step.seconds, rounds } : null;
}
