// Laying a grid in play (plan §8.2, `map_lay`): a room grid over one square of a coarse map, and a
// grid for a place, each as the changes the store records, in today's events. The map is written
// whole into the chat's own draft of its world (`engine.world`, the event today's `world_map` tool
// writes; `engine/world-draft.ts`), scoped to the place at the coarse square, so it is that place's
// own grid while the coarse map keeps the place on its square for travel, and `opens` links that
// square to the room grid where the coarse map draws the place. Where no place is drawn on that
// square, one is made there by the same event. Whoever stood on the coarse square is taken off it
// (`space.pos`), since the room grid is where they stand now; the GM places them. A place that has
// a grid already is laid over in the chat's draft: its own map is written again there (the world's
// is untouched, and a swipe takes it back), and whoever no longer stands on a square of it is taken
// off. Nothing of the call is refused for what the world has: a name taken is made new, a place the
// square does not hold is laid for the one it holds, a symbol no legend names is read as floor, and
// each is reported. A square's width is the map's own cell size, and the map says its own time
// step (`step`): the one its square gives by the settings unless the laying names another.

import type { PlaceId } from "../../shared/ids";
import { hasOwn, type JsonObject } from "../../shared/json";
import { areaPlaceAt, gridOf } from "../../shared/grid";
import { DEFAULT_LEGEND, readMap } from "../../shared/maps";
import { pathText } from "../../shared/schema-check";
import type { MapCellDef, MapDoc, WorldDoc } from "../../shared/world";
import { own } from "../../engine/pack-kit";
import { playedWorld } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import { MAP_ID_MAX } from "../../packs/space/core/grid-play";
import { spotOf } from "../../packs/space/core/grid-model";
import type { ChangeInput, Report } from "../../store/types";
import { MAP_DEFAULTS, type MapConfig } from "../../shared/map-config";
import { cellOf, indexOf, laidMetres, scaleOf, squareOf, type Square, type TimeStep } from "../../packs/space/core/grid-model";
import { draftChange, positionChange } from "./record";

/** A grid to lay. */
export interface Laying {
  /** The id its map is to have; the place's id and `_map` when absent. One the world or the chat has already is made new, and said. */
  id?: string;
  /** Its rows, top first, one symbol to a square. */
  rows: readonly string[];
  /** What its symbols stand for, besides today's default legend (`#` wall, `.` floor, `+` door, a space nothing). */
  legend?: Record<string, MapCellDef>;
  title?: string;
  /** A square's width in metres; a grid laid in play takes the settings' when absent. */
  metres?: number;
  /** How time passes on it; the step its square gives by the settings when absent. */
  step?: TimeStep;
}

/** The place a call names for a grid laid over a coarse square: a place the world has, or a name it has none by (`made`), with the id it would be made under. */
export interface Named {
  id: PlaceId;
  name: string;
  made: boolean;
}

/** A laying worked out: the changes to record in order (none when it cannot be laid), the place whose grid it is, and what does not add up. */
export interface Laid {
  changes: ChangeInput[];
  scope: PlaceId | null;
  reports: Report[];
  /** The id of the map laid. */
  map?: string;
  /** The coarse map the room grid is linked from (`opens`), when the coarse map draws the place. */
  opens?: string;
  /** The square's width was not given: it is the setting's, an assumption (standing assumed, source default, plan §6.6). */
  sizeDefaulted?: true;
}

/** Rows for a walled room of `width` by `height` squares, floor inside, with a door on each square given. */
export function plainRows(width: number, height: number, doors: readonly Square[] = []): string[] {
  const rows = Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c): string => (r === 0 || c === 0 || r === height - 1 || c === width - 1 ? "#" : ".")));
  for (const [c, r] of doors) {
    const row = rows[r - 1];
    if (row && c >= 1 && c <= width) row[c - 1] = "+";
  }
  return rows.map((r) => r.join(""));
}

/** An id from a name or an id: letters, digits and `_`, cut at the most characters the format's id pattern allows, and no more. */
export function idFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, MAP_ID_MAX)
      .replace(/_+$/, "") || "map"
  );
}

/** `base` as an id for something new: not one `taken` holds, with a number after it where it must, and whole inside the format's id length. */
export function freshId(base: string, taken: (id: string) => boolean): string {
  const stem = idFrom(base);
  let id = stem;
  for (let k = 2; taken(id); k++) {
    const tail = `_${k}`;
    id = `${stem.slice(0, MAP_ID_MAX - tail.length).replace(/_+$/, "")}${tail}`;
  }
  return id;
}

function refused(scope: PlaceId | null, report: Report): Laid {
  return { changes: [], scope, reports: [report] };
}

/**
 * `laying` as the grid of `scope`, after the changes `before`. Where the place has a map drawn
 * row by row, that map is written again in the chat's draft (its places and links kept); where its
 * grid was authored without a map, the draft takes the grid off the place and a map of its own
 * draws it; either way the world's own is untouched, and the answer says so. What stood on a square
 * at `scope` is taken off it (those who stood on the coarse grid, or on the old grid beyond the new).
 */
function layOn(world: WorldDoc, state: Readonly<WorldState>, played: WorldDoc, scope: PlaceId, laying: Laying, config: Readonly<MapConfig>, before: ChangeInput[]): Laid {
  const has = gridOf(played, scope);
  const redrawn = has?.map !== undefined && hasOwn(played.maps, has.map) ? played.maps[has.map] : undefined;
  const reports: Report[] = [];
  if (has) reports.push({ code: "has_grid", values: { place: scope, grid: has.id } });
  let id: string;
  if (redrawn) id = redrawn.id;
  else {
    const wanted = laying.id ?? `${scope}_map`;
    const stem = idFrom(wanted);
    const taken = (x: string): boolean => hasOwn(played.maps, x) || hasOwn(played.grids, x);
    id = freshId(wanted, taken);
    if (id !== stem) {
      const holder = hasOwn(played.maps, stem) ? played.maps[stem]?.scope : Object.keys(played.places).sort().find((p) => own(played.places, p)?.grid === stem);
      reports.push({ code: "id_taken", values: { id: stem, ...(holder !== undefined ? { held: holder } : {}), fresh: id } });
    }
  }
  const metres = laying.metres ?? laidMetres(config);
  const title = laying.title ?? redrawn?.title;
  const drawn: MapDoc = {
    id,
    scope,
    ...(title !== undefined ? { title } : {}),
    layout: [...laying.rows],
    ...(laying.legend !== undefined ? { legend: laying.legend } : {}),
    cellMeters: metres,
    // What the map draws besides its rows stays: the places it makes inside the place and the ways between them.
    ...(redrawn?.places !== undefined ? { places: redrawn.places } : {}),
    ...(redrawn?.links !== undefined ? { links: redrawn.links } : {}),
  };
  // `step` is the map format's own field (`lre-map-v1`), which today's map type does not name.
  const map: MapDoc = Object.assign(drawn, { step: laying.step ?? scaleOf(metres, config, played.ruleset).step });
  const { problems } = readMap(map);
  if (problems.length > 0) return { changes: [], scope, reports: problems.map((p) => ({ code: "bad_map", values: { at: pathText(p.path), why: p.message } })) };
  // A symbol no legend names is read as floor, as the compiler reads it: reported, so the GM names it, and the map stands as assumed.
  const named = (ch: string): boolean => hasOwn(laying.legend ?? {}, ch) || hasOwn(DEFAULT_LEGEND, ch);
  const unnamed = [...new Set(laying.rows.flatMap((r) => [...r]).filter((ch) => !named(ch)))];
  for (const symbol of unnamed) reports.push({ code: "not_in_legend", values: { symbol } });
  const changes: ChangeInput[] = [...before];
  const def = has !== undefined && redrawn === undefined ? own(played.places, scope) : undefined;
  if (def) {
    const { grid: _grid, ...rest } = def;
    changes.push(draftChange(world, state, { collection: "places", id: scope, value: rest as unknown as JsonObject }));
  }
  // A square's width nobody gave, or a symbol no legend names, is the setting's or the compiler's reading: that change stands as assumed, from the default (plan §6.6).
  const mapChange = draftChange(world, state, { collection: "maps", id, value: map as unknown as JsonObject });
  changes.push(laying.metres === undefined || unnamed.length > 0 ? { ...mapChange, standing: "assumed" as const, source: "default" as const } : mapChange);
  const width = Math.max(0, ...laying.rows.map((r) => [...r].length));
  const height = laying.rows.length;
  for (const entity of Object.keys(state.entities).sort()) {
    const spot = spotOf(played, state, entity);
    if (!spot) continue;
    // On a grid the place has already: whoever still stands on a square of the new one stays on it.
    if (has !== undefined) {
      if (spot.scope !== scope || (spot.x < width && spot.y < height)) continue;
    } else if (state.entities[entity]?.fields.place !== scope) continue;
    changes.push(positionChange({ scope: spot.scope }, entity, null, squareOf(spot)));
  }
  return { changes, scope, reports, map: id, ...(laying.metres === undefined ? { sizeDefaulted: true as const } : {}) };
}

/**
 * A room grid laid over one square of the coarse grid of `coarse`: for the place drawn on that
 * square (at it, or with it in its area), else for a place `named` makes there. A place named that
 * the square does not hold is not the one laid for: the grid is laid for the one the square holds,
 * and the call is told so; a place the world has that is drawn nowhere on that square is laid for
 * alone. Where the coarse map draws the place, its entry opens the room grid (`opens`); the place
 * keeps its cell either way. `world` is the revision the chat plays, `state` the chat's state now.
 */
export function layOverSquare(world: WorldDoc, state: Readonly<WorldState>, coarse: PlaceId, square: Square, laying: Laying, config: Readonly<MapConfig> = MAP_DEFAULTS, named?: Named): Laid {
  const played = playedWorld(world, state);
  const grid = gridOf(played, coarse);
  if (!grid) return refused(null, { code: "no_grid", values: { place: coarse } });
  const index = indexOf(grid, square);
  if (index === null) return refused(null, { code: "off_grid", values: { square: [...square], width: grid.width, height: grid.height } });
  const cell = cellOf(square);
  const at = Object.keys(played.places)
    .sort()
    .find((id) => {
      const p = played.places[id];
      return p?.parent === coarse && p.cell?.x === cell.x && p.cell.y === cell.y;
    });
  const drawnHere = at ?? areaPlaceAt(played, coarse, grid, index);
  const notes: Report[] = [];
  let scope: PlaceId;
  let before: ChangeInput[] = [];
  if (drawnHere !== null) {
    scope = drawnHere;
    if (named !== undefined && named.id !== drawnHere) notes.push({ code: "place_elsewhere", values: { place: named.made ? named.name : named.id, square: [...square], held: drawnHere } });
  } else if (named === undefined) return refused(null, { code: "needs_place", values: { square: [...square] } });
  else if (!named.made) {
    scope = named.id;
    notes.push({ code: "not_drawn_there", values: { place: named.id, square: [...square] } });
  } else {
    const stem = idFrom(named.id);
    scope = freshId(named.id, (x) => hasOwn(played.places, x));
    if (scope !== stem) notes.push({ code: "place_id_taken", values: { id: stem, fresh: scope } });
    before = [draftChange(world, state, { collection: "places", id: scope, value: { id: scope, name: named.name, parent: coarse, cell: { ...cell }, fields: {} } })];
  }
  const laid = layOn(world, state, played, scope, laying, config, before);
  if (laid.changes.length === 0) return laid;
  // The coarse map that draws the place links the square to the room grid; where it does not draw it, the place's cell is all that joins them.
  const coarseMap = grid.map !== undefined && hasOwn(played.maps, grid.map) ? played.maps[grid.map] : undefined;
  const places = coarseMap?.places ?? [];
  if (coarseMap !== undefined && laid.map !== undefined && places.some((p) => p.id === scope && p.opens !== laid.map)) {
    const opens = laid.map;
    laid.changes.push(draftChange(world, state, { collection: "maps", id: coarseMap.id, value: { ...coarseMap, places: places.map((p) => (p.id === scope ? { ...p, opens } : p)) } as unknown as JsonObject }));
    laid.opens = coarseMap.id;
  }
  return { ...laid, reports: [...notes, ...laid.reports] };
}

/** A grid laid for `place`. `world` is the revision the chat plays, `state` the chat's state now. */
export function layForPlace(world: WorldDoc, state: Readonly<WorldState>, place: PlaceId, laying: Laying, config: Readonly<MapConfig> = MAP_DEFAULTS): Laid {
  const played = playedWorld(world, state);
  if (!hasOwn(played.places, place)) return refused(null, { code: "no_place", values: { place } });
  return layOn(world, state, played, place, laying, config, []);
}
