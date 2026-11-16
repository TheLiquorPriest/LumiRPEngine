// Laying a grid in play (plan §8.2, `map_lay`): a room grid over one square of a coarse map, and a
// grid for a place that has no map, each as the changes the store records, in today's events. The
// map is written whole into the chat's own draft of its world (`engine.world`, the event today's
// `world_map` tool writes; `engine/world-draft.ts`), scoped to the place at the coarse square, so
// it is that place's own grid while the coarse map keeps the place on its square for travel. Where
// no place is drawn on that square, one is made there by the same event. Whoever stood on the coarse
// square is taken off it (`space.pos`), since the room grid is where they stand now; the GM places
// them. A square's width is the map's own cell size, and the map says its own time step (`step`):
// the one its square gives by the settings unless the laying names another.

import type { PlaceId } from "../../shared/ids";
import { hasOwn, type JsonObject } from "../../shared/json";
import { areaPlaceAt, gridOf } from "../../shared/grid";
import { readMap } from "../../shared/maps";
import type { MapCellDef, MapDoc, WorldDoc } from "../../shared/world";
import { playedWorld } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import { spotOf } from "../../packs/space/core/positions";
import type { ChangeInput, Report } from "../../store/types";
import { MAP_DEFAULTS, type MapConfig } from "../../shared/map-config";
import { cellOf, indexOf, laidMetres, scaleOf, squareOf, type Square, type TimeStep } from "./grid";
import { draftChange, positionChange } from "./record";

/** A grid to lay. */
export interface Laying {
  /** Its map's id: new to the world and to the chat. */
  id: string;
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

/** A laying worked out: the changes to record in order (none when it cannot be laid), the place whose grid it is, and what does not add up. */
export interface Laid {
  changes: ChangeInput[];
  scope: PlaceId | null;
  reports: Report[];
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

function refused(scope: PlaceId | null, report: Report): Laid {
  return { changes: [], scope, reports: [report] };
}

/** `laying` as the grid of `scope`, after the changes `before`; what stood on a square at `scope` taken off it. */
function layOn(world: WorldDoc, state: Readonly<WorldState>, played: WorldDoc, scope: PlaceId, laying: Laying, config: Readonly<MapConfig>, before: ChangeInput[]): Laid {
  const has = gridOf(played, scope);
  if (has) return refused(scope, { code: "has_grid", values: { place: scope, grid: has.id } });
  if (hasOwn(played.maps, laying.id) || hasOwn(played.grids, laying.id)) return refused(scope, { code: "id_taken", values: { id: laying.id } });
  const metres = laying.metres ?? laidMetres(config);
  const drawn: MapDoc = {
    id: laying.id,
    scope,
    ...(laying.title !== undefined ? { title: laying.title } : {}),
    layout: [...laying.rows],
    ...(laying.legend !== undefined ? { legend: laying.legend } : {}),
    cellMeters: metres,
  };
  // `step` is the map format's own field (`lre-map-v1`), which today's map type does not name.
  const map: MapDoc = Object.assign(drawn, { step: laying.step ?? scaleOf(metres, config, played.ruleset).step });
  const { problems } = readMap(map);
  if (problems.length > 0) return { changes: [], scope, reports: problems.map((p) => ({ code: "bad_map", values: { at: p.path } })) };
  // A square's width nobody gave is the setting's: that change stands as assumed, from the default (plan §6.6).
  const mapChange = draftChange(world, state, { collection: "maps", id: laying.id, value: map as unknown as JsonObject });
  const changes = [...before, laying.metres === undefined ? { ...mapChange, standing: "assumed" as const, source: "default" as const } : mapChange];
  for (const id of Object.keys(state.entities).sort()) {
    if (state.entities[id]?.fields.place !== scope) continue;
    const spot = spotOf(played, state, id);
    if (spot) changes.push(positionChange({ scope: spot.scope }, id, null, squareOf(spot)));
  }
  return { changes, scope, reports: [], ...(laying.metres === undefined ? { sizeDefaulted: true as const } : {}) };
}

/**
 * A room grid laid over one square of the coarse grid of `coarse`: for the place drawn on that
 * square (at it, or with it in its area), else for a place `laying.place` makes there. `world` is
 * the revision the chat plays, `state` the chat's state now.
 */
export function layOverSquare(world: WorldDoc, state: Readonly<WorldState>, coarse: PlaceId, square: Square, laying: Laying & { place?: { id: PlaceId; name: string } }, config: Readonly<MapConfig> = MAP_DEFAULTS): Laid {
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
  if (drawnHere !== null) return layOn(world, state, played, drawnHere, laying, config, []);
  const made = laying.place;
  if (!made) return refused(null, { code: "needs_place", values: { square: [...square] } });
  if (hasOwn(played.places, made.id)) return refused(null, { code: "id_taken", values: { id: made.id } });
  const place = draftChange(world, state, { collection: "places", id: made.id, value: { id: made.id, name: made.name, parent: coarse, cell: { ...cell }, fields: {} } });
  return layOn(world, state, played, made.id, laying, config, [place]);
}

/** A grid laid for `place`, which has none of its own. `world` is the revision the chat plays, `state` the chat's state now. */
export function layForPlace(world: WorldDoc, state: Readonly<WorldState>, place: PlaceId, laying: Laying, config: Readonly<MapConfig> = MAP_DEFAULTS): Laid {
  const played = playedWorld(world, state);
  if (!hasOwn(played.places, place)) return refused(null, { code: "no_place", values: { place } });
  return layOn(world, state, played, place, laying, config, []);
}
