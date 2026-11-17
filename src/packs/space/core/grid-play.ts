// What play changes on a grid besides who stands where (plan §8.2), as the space pack's own events,
// each writing its record whole into the pack's slice: a door's state (`space.door`: open, closed or
// locked), a thing's footprint and what it blocks (`space.shape`), where someone or something is
// within its place besides its square, a zone or words (`space.where`), a change to some squares of a
// map and to its legend (`space.squares`), kept as that change over the map so that a later edit of
// the map shows through wherever the change did not touch it. None writes an entity's definition, so
// none declares `touches`: an Upgrade to a new revision carries the records on (`carrySpace`): a
// square the new revision took in (it draws the symbol the chat drew there, and gives it the
// meaning the chat gave it) is dropped from the chat's record, so the world's later edit of it shows
// in the chat; any other plays on over what that revision draws. A record (squares, doors, footprints,
// where someone is) whose map, place or thing the revision no longer has is kept, shows nothing while
// its target is gone, is named in the Upgrade's notes, and shows again if a later revision brings the target back. Two optional fields of the map format (`lre-map-v1`) carry what a
// map draws once: a terrain that blocks the way and not the view (`seeThrough`), and the grid's time
// step (`step`). A record is replaced, never changed in place, so a reader may keep what it works out
// from one by its identity. None is told in a line, as a step on a grid is not (`space.pos`): the
// grid's tools report them.

import { hasOwn, isRecord, safeKey, type JsonObject } from "../../../shared/json";
import { hashJson } from "../../../shared/hash";
import type { PackEvent } from "../../../shared/ledger";
import type { EntityId, MapId, PlaceId } from "../../../shared/ids";
import { readMap } from "../../../shared/maps";
import mapFormat from "../../../shared/lre-map-v1.schema.json";
import type { MapCellDef, MapDoc, WorldDoc } from "../../../shared/world";
import { labelOf, mutableSlice, objOf, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, Rejection } from "../../../engine/registry";
import { GONE_FIELD } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { chatDraftOf, draftedWorld } from "../../../engine/world-draft";

export const DOOR_EVENT = "space.door";
export const SHAPE_EVENT = "space.shape";
export const SQUARES_EVENT = "space.squares";
export const WHERE_EVENT = "space.where";

export const DOOR_STATES = ["open", "closed", "locked"] as const;
export type DoorState = (typeof DOOR_STATES)[number];

/**
 * The most squares a side of a map can have: the rows of its layout, and the squares of a row, as
 * the format's schema bounds them (`lre-map-v1`), read from it so the two cannot part. The largest
 * grid, and the largest footprint on one.
 */
export const MAP_SIDE_MAX: number = Math.min(mapFormat.properties.layout.maxItems, mapFormat.properties.layout.items.maxLength);

/** What the format holds as an id (a map's, and a place's inside a map): its pattern, and the most characters it allows, both read from the schema so the three cannot part. */
export const MAP_ID_PATTERN = new RegExp(mapFormat.$defs.id.pattern);
export const MAP_ID_MAX: number = Number(/\{0,(\d+)\}\$$/.exec(mapFormat.$defs.id.pattern)?.[1]) + 1;

/** A thing's footprint in squares, [columns, rows], and whether it blocks the way and the view. */
export interface Shape {
  size: [number, number];
  way: boolean;
  view: boolean;
}

/** The changes play made to a map's squares (by cell, `x,y` from 0, as the store keeps cells) and to its legend (a symbol given null is taken out). */
export interface SquareEdits {
  cells: Readonly<Record<string, string>>;
  legend: Readonly<Record<string, MapCellDef | null>>;
}

/** A grid's time step as its map gives it: rounds of `seconds`, in each of which someone moves `squares` squares, or walking minutes. */
export type MapStep = { per: "round"; seconds: number; squares: number } | { per: "minute" };

const reject = (code: string, reason: string): Rejection => ({ code, reason });

/** How a cell is keyed in the slice: today's cell, x and y from 0. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Whether a value is a whole number from 0, as a cell's x and y are. */
const fromZero = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

const oneSymbol = (s: unknown): s is string => typeof s === "string" && [...s].length === 1;

function record(state: Readonly<WorldState>, key: string): Readonly<Record<string, unknown>> {
  const v = sliceOf(state, "space")[key];
  return isRecord(v) ? v : {};
}

// ---------------------------------------------------------------- reading the slice
// Each record is read as its event wrote it: the events below are its only writers, and each
// checked what it writes before applying it.

/** The doors play has opened, shut or locked on the grid of `scope`, by cell key; any other door is as drawn. */
export function doorsAt(state: Readonly<WorldState>, scope: PlaceId): Readonly<Record<string, DoorState>> {
  const all = record(state, "doors");
  const mine = hasOwn(all, scope) ? all[scope] : undefined;
  return isRecord(mine) ? (mine as Record<string, DoorState>) : {};
}

/** A thing's footprint and what it blocks, as play set them; null for one square that blocks nothing. */
export function shapeOf(state: Readonly<WorldState>, entity: EntityId): Shape | null {
  const all = record(state, "shapes");
  const s = hasOwn(all, entity) ? all[entity] : undefined;
  return isRecord(s) && Array.isArray(s.size) ? (s as unknown as Shape) : null;
}

/** The changes play made to a map's squares and legend; null where it made none. */
export function squareEditsOf(state: Readonly<WorldState>, map: MapId): SquareEdits | null {
  const all = record(state, "squares");
  const e = hasOwn(all, map) ? all[map] : undefined;
  return isRecord(e) ? (e as unknown as SquareEdits) : null;
}

/** `map` with play's changes laid over it: each changed square on its layout (a short row padded with nothing to reach it), and its legend changed. */
export function editedMap(map: MapDoc, edits: SquareEdits): MapDoc {
  const rows = (map.layout ?? []).map((row) => [...row]);
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (const [key, symbol] of Object.entries(edits.cells)) {
    const [x = -1, y = -1] = key.split(",").map(Number);
    const row = rows[y];
    if (!row || !Number.isInteger(x) || x < 0 || x >= width) continue;
    while (row.length <= x) row.push(" ");
    row[x] = symbol;
  }
  const legend: Record<string, MapCellDef> = { ...(map.legend ?? {}) };
  for (const [symbol, cell] of Object.entries(edits.legend)) {
    if (cell === null) delete legend[symbol];
    else legend[symbol] = cell;
  }
  const out: MapDoc = { ...map, layout: rows.map((r) => r.join("")) };
  if (Object.keys(legend).length > 0) out.legend = legend;
  else delete out.legend;
  return out;
}

/** The maps (and authored grids) play has changed the squares of, by id. */
export function squaredMaps(state: Readonly<WorldState>): string[] {
  return Object.keys(record(state, "squares"));
}

/** `edits` as they stay over `doc`, the map of the revision a chat moves to: a square the map draws as the chat drew it, with the symbol meaning what the chat made it mean, and a symbol the legend gives as the chat did, are taken in and go. The same record where nothing goes, null where all does. */
function leftOver(doc: MapDoc, edits: SquareEdits): SquareEdits | null {
  const rows = (doc.layout ?? []).map((row) => [...row]);
  const same = (a: unknown, b: unknown): boolean => (a === undefined || b === undefined ? a === b : hashJson(a) === hashJson(b));
  const cells: Record<string, string> = {};
  for (const [key, symbol] of Object.entries(edits.cells)) {
    const [x = -1, y = -1] = key.split(",").map(Number);
    const meant = hasOwn(edits.legend, symbol) ? edits.legend[symbol] : undefined;
    const meansAsDrawn = meant === undefined || (meant === null ? doc.legend?.[symbol] === undefined : same(meant, doc.legend?.[symbol]));
    if (rows[y]?.[x] === symbol && meansAsDrawn) continue;
    cells[key] = symbol;
  }
  const legend: Record<string, MapCellDef | null> = {};
  for (const [symbol, cell] of Object.entries(edits.legend)) {
    const held = doc.legend?.[symbol];
    if (!(cell === null ? held === undefined : held !== undefined && same(held, cell))) legend[symbol] = cell;
  }
  const kept = Object.keys(cells).length + Object.keys(legend).length;
  if (kept === 0) return null;
  return kept === Object.keys(edits.cells).length + Object.keys(edits.legend).length ? edits : { cells, legend };
}

/**
 * A chat's records of what it changed on grids, as an Upgrade carries them to the revision `to` (a
 * `migrate` marker's step, `upgrade.ts`, beside `carryDraft`): the squares `to` took in leave the
 * chat's record, what `to` left alone or drew otherwise plays on over it, and a record whose map,
 * place or thing `to` (with this chat's own draft laid over it) no longer has is kept as it was. The
 * notes name each of those, so they are seen; nothing is dropped for it.
 */
export function carrySpace(state: WorldState, to: WorldDoc): string[] {
  const squares = record(state, "squares");
  const doors = record(state, "doors");
  const shapes = record(state, "shapes");
  const where = record(state, "where");
  if (Object.keys(squares).length === 0 && Object.keys(doors).length === 0 && Object.keys(shapes).length === 0 && Object.keys(where).length === 0) return [];
  const played = draftedWorld(to, chatDraftOf(state));
  const notes: string[] = [];
  const kept: Record<string, unknown> = {};
  let moved = false;
  for (const [id, raw] of Object.entries(squares)) {
    const doc = own(to.maps, id);
    if (doc !== undefined && isRecord(raw)) {
      const left = leftOver(doc, raw as unknown as SquareEdits);
      if ((left as unknown) !== raw) moved = true;
      if (left !== null) kept[id] = left;
      continue;
    }
    kept[id] = raw;
    if (own(played.maps, id) === undefined && own(played.grids, id) === undefined) notes.push(`the squares drawn on the map ${id} are kept: this revision has no such map, and they show again if a later one brings it back`);
  }
  if (moved) {
    const slice = mutableSlice(state, "space");
    if (Object.keys(kept).length > 0) slice.squares = kept as JsonObject;
    else delete slice.squares;
  }
  const drawn = (place: PlaceId): boolean => own(played.grids, place) !== undefined || Object.values(played.maps).some((m) => m.scope === place && m.layout !== undefined);
  for (const place of Object.keys(doors)) {
    if (!drawn(place)) notes.push(`the doors set at ${own(played.places, place)?.name ?? place} are kept: this revision draws no map there, and they show again if a later one does`);
  }
  // A footprint, or where someone was said to be, of a thing that has left the world (an Upgrade took it out): its record stays.
  const left = (id: EntityId): boolean => {
    const e = own(state.entities, id);
    return e === undefined || e.fields[GONE_FIELD] === true;
  };
  for (const id of Object.keys(shapes)) {
    if (left(id)) notes.push(`the footprint set for ${id} is kept: that thing is gone from this chat's world, and it shows again if it comes back`);
  }
  for (const id of Object.keys(where)) {
    if (left(id)) notes.push(`where ${id} was said to be is kept: that one is gone from this chat's world, and it shows again if it comes back`);
  }
  return notes;
}

// ---------------------------------------------------------------- the map format's own fields

/** A grid's time step as its map gives it (`step`); null where it gives none, and the step follows the square. */
export function mapStepOf(map: MapDoc): MapStep | null {
  const step = "step" in map && isRecord(map.step) ? map.step : null;
  if (step === null) return null;
  if (step.per === "minute") return { per: "minute" };
  const { seconds, squares } = step;
  return step.per === "round" && typeof seconds === "number" && seconds > 0 && typeof squares === "number" && Number.isInteger(squares) && squares >= 1 ? { per: "round", seconds, squares } : null;
}

/** Whether a legend's cell blocks the way and lets the view through: a blocked terrain marked `seeThrough` (a bar, a low wall). */
export function seesThrough(cell: MapCellDef | undefined): boolean {
  return typeof cell === "object" && "terrain" in cell && cell.blocked === true && "seeThrough" in cell && cell.seeThrough === true;
}

// ---------------------------------------------------------------- the events

/** A door's state on the grid of a place (`{scope, x, y, state}`): the door at that cell is open, shut or locked from now on. */
export const doorEventDef: EventTypeDef<PackEvent> = {
  type: DOOR_EVENT,
  validate(e, ctx) {
    const scope = strOf(e.data.scope);
    if (!safeKey(scope) || !own(ctx.world.places, scope)) return reject("missing_place", `no place ${labelOf(ctx, scope)}`);
    if (!fromZero(e.data.x) || !fromZero(e.data.y)) return reject("bad_cell", "a door's cell is x and y, whole numbers from 0");
    return (DOOR_STATES as readonly unknown[]).includes(e.data.state) ? null : reject("bad_state", "a door is open, closed or locked");
  },
  apply(e, state) {
    const scope = strOf(e.data.scope);
    const slice = mutableSlice(state, "space");
    const all = { ...objOf(slice.doors) };
    all[scope] = { ...objOf(all[scope]), [cellKey(Number(e.data.x), Number(e.data.y))]: strOf(e.data.state) };
    slice.doors = all;
  },
  describe: () => "",
};

/** A thing's footprint and what it blocks (`{entity, size: [columns, rows], way, view}`), written whole; one square that blocks nothing takes the record away. */
export const shapeEventDef: EventTypeDef<PackEvent> = {
  type: SHAPE_EVENT,
  validate(e, ctx) {
    const entity = strOf(e.data.entity);
    if (!safeKey(entity) || !own(ctx.state.entities, entity)) return reject("missing_entity", `no entity ${labelOf(ctx, entity)}`);
    const size = e.data.size;
    if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => fromZero(n) && n >= 1 && n <= MAP_SIDE_MAX)) return reject("bad_size", `a footprint is [columns, rows], each from 1 to ${MAP_SIDE_MAX}`);
    return typeof e.data.way === "boolean" && typeof e.data.view === "boolean" ? null : reject("bad_blocks", "way and view are true or false");
  },
  apply(e, state) {
    const entity = strOf(e.data.entity);
    const slice = mutableSlice(state, "space");
    const all = { ...objOf(slice.shapes) };
    const [w = 1, h = 1] = Array.isArray(e.data.size) ? e.data.size.map(Number) : [];
    if (w === 1 && h === 1 && e.data.way !== true && e.data.view !== true) delete all[entity];
    else all[entity] = { size: [w, h], way: e.data.way === true, view: e.data.view === true };
    slice.shapes = all;
  },
  describe: () => "",
};

/** Squares of a map, or of a grid authored without one, drawn anew, and its legend changed (`{map, squares: [{x, y, symbol}], legend: {symbol: cell or null}}`, `map` the id of the map or the grid): laid over what play changed before. */
export const squaresEventDef: EventTypeDef<PackEvent> = {
  type: SQUARES_EVENT,
  validate(e, ctx) {
    const map = strOf(e.data.map);
    // A map drawn row by row, or a grid authored without a map (its id is the grid's own).
    const doc = safeKey(map) ? own(ctx.world.maps, map) : undefined;
    const authored = doc === undefined && safeKey(map) ? own(ctx.world.grids, map) : undefined;
    if (!doc?.layout && authored?.map !== undefined) return reject("missing_map", `no grid map ${map}`);
    if (!doc?.layout && authored === undefined) return reject("missing_map", `no grid map ${map}`);
    const squares = e.data.squares ?? [];
    if (!Array.isArray(squares) || !squares.every((s) => isRecord(s) && fromZero(s.x) && fromZero(s.y) && oneSymbol(s.symbol))) return reject("bad_squares", "each square is x and y from 0 and one symbol");
    const legend = e.data.legend ?? {};
    if (!isRecord(legend) || !Object.keys(legend).every(oneSymbol)) return reject("bad_legend", "a legend's symbols are one character each");
    const given = Object.fromEntries(Object.entries(legend).filter(([, cell]) => cell !== null));
    if (Object.keys(given).length > 0 && readMap({ id: map, scope: doc?.scope ?? map, layout: ["."], legend: given }).problems.length > 0) return reject("bad_legend", "that is not what a legend's symbol can stand for");
    return squares.length > 0 || Object.keys(legend).length > 0 ? null : reject("no_change", "no square and no symbol is changed");
  },
  apply(e, state) {
    const map = strOf(e.data.map);
    const slice = mutableSlice(state, "space");
    const all = { ...objOf(slice.squares) };
    const was = objOf(all[map]);
    const cells = { ...objOf(was.cells) };
    for (const s of Array.isArray(e.data.squares) ? e.data.squares : []) if (isRecord(s)) cells[cellKey(Number(s.x), Number(s.y))] = strOf(s.symbol);
    all[map] = { cells, legend: { ...objOf(was.legend), ...structuredClone(objOf(e.data.legend)) } };
    slice.squares = all;
  },
  describe: () => "",
};

/** Where someone or something is within its place besides its square: a named zone the map has no square for, words ("by the window"), or both. */
export interface Whereabouts {
  zone?: string;
  words?: string;
}

/** What play said of where `entity` is within its place besides a square; null when it said nothing (or it has moved on since). */
export function whereOf(state: Readonly<WorldState>, entity: EntityId): Whereabouts | null {
  const all = record(state, "where");
  const w = hasOwn(all, entity) ? all[entity] : undefined;
  if (!isRecord(w)) return null;
  const zone = typeof w.zone === "string" ? w.zone : undefined;
  const words = typeof w.words === "string" ? w.words : undefined;
  return zone !== undefined || words !== undefined ? { ...(zone !== undefined ? { zone } : {}), ...(words !== undefined ? { words } : {}) } : null;
}

/**
 * Where someone or something is within its place besides its square (`{entity, zone?, words?}`), written
 * whole; neither takes the record away. A person's position and a thing's are the same: a square, a
 * named zone or words, any of them, and the world state prints whichever is known.
 */
export const whereEventDef: EventTypeDef<PackEvent> = {
  type: WHERE_EVENT,
  validate(e, ctx) {
    const entity = strOf(e.data.entity);
    if (!safeKey(entity) || !own(ctx.state.entities, entity)) return reject("missing_entity", `no entity ${labelOf(ctx, entity)}`);
    const text = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() !== "");
    return text(e.data.zone) && text(e.data.words) ? null : reject("bad_where", "a zone or words are text");
  },
  apply(e, state) {
    const entity = strOf(e.data.entity);
    const slice = mutableSlice(state, "space");
    const all = { ...objOf(slice.where) };
    const zone = typeof e.data.zone === "string" ? e.data.zone.trim() : "";
    const words = typeof e.data.words === "string" ? e.data.words.trim() : "";
    if (zone === "" && words === "") delete all[entity];
    else all[entity] = { ...(zone !== "" ? { zone } : {}), ...(words !== "" ? { words } : {}) };
    if (Object.keys(all).length > 0) slice.where = all;
    else delete slice.where;
  },
  describe: () => "",
};
