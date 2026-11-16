// The map panel's view model (`space.map`): every scope the POV can open (map-scope.ts), each drawn
// as its own frame; the scope the map opens on (the one around the POV); and travel options as
// ready-to-send actions. A scope lists a place the POV can see (`canSeePlace`), and the places the
// POV is inside even when it can't, each marked known and visited; one it can't see goes by a
// stand-in (an opaque id and "Somewhere") everywhere the view names it, and is never somewhere to
// travel to. The view is built for the chat's display (DESIGN §12): its grids carry only the cells
// the POV is shown, the cells of places it can't see as nothing, and in fog the cells it hasn't
// seen as blank ground, a hidden place's among them, so fog never outlines one. A grid carries the
// POV's cell when it stands on it; a thing lying in a cell shows only where the POV sees it now,
// never where it once saw it. Where the geometry draws a grid (`grid-model.ts`), the grid is that
// geometry as the chat plays it, the squares the chat changed laid over the map, and carries what
// is on it besides: every person and thing the POV may see (`pieces`), those at the place with no
// square (`unplaced`), each door as it stands, the squares seen now and the dark ones, and the
// scale and time step. Someone the POV cannot see is not in the view.

import type { JsonObject } from "../../../shared/json";
import type { ActionId, EntityId, PlaceId, TravelMode } from "../../../shared/ids";
import { addCells, areaOf, cellIndex, gridOf, hasCell, standingGrid } from "../../../shared/grid";
import { mapSettingsOf } from "../../../shared/maps";
import { ALIVE, type GridDef, type MapDisplay, type WorldDoc } from "../../../shared/world";
import type { ReadContext } from "../../../engine/registry";
import { MAP_DEFAULTS, type MapConfig } from "../../../shared/map-config";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { entryFor, entryRefusal } from "../../../engine/entry";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { cellsSeen, placeVisit } from "../../../engine/seen";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { byShownId, defaultScope, hasGrid, placeChildren, placePath, scopeView, shownName, WORLD_SCOPE_NAME, type CellView, type GridScene, type MapDoorView, type MapItemView, type MapPieceView, type MapScopeView, type MapUnplacedView, type ScopeFilter } from "./map-scope";
import { cellOf, doorState, drawnOf, indexOf, movingOf, squareAt, standsAt, type Drawn, type StoredMoving } from "./grid-model";
import { whereOf } from "./grid-play";
import { hiddenCells, sightFor } from "./positions";
import { closedRoutes, goMinutes, routeAt } from "./travel";
import type { TravelPart } from "../../../shared/travel";

export type { MapDoorView, MapGridView, MapItemView, MapPieceView, MapPlaceView, MapRouteView, MapScaleView, MapScopeView, MapUnplacedView } from "./map-scope";

export interface MapView {
  level: number;
  here: PlaceId | null;
  /** The POV's place and the places around it, outermost first. */
  path: PlaceId[];
  /** The scope the map opens on: the place whose map the POV stands in, or null for the world. */
  scope: PlaceId | null;
  /** How the map shows in this chat: the player's pick (`lre.map`), else the world's `mapSettings.display`. Its grids are already cut to it. */
  display: MapDisplay;
  /** Whether the grid system is on: the POV walks grids (Walk here sends `step`), and their cells are seen or fogged. */
  movement: boolean;
  /** Every scope the POV can open: the world, and each place it can see with places inside it or a grid. */
  scopes: MapScopeView[];
  /** `parts`: how a vehicle trip's minutes break down, each in words after its minutes ("to reach it at home", "driving"); none for a walk. */
  travel: { to: PlaceId; label: string; mode: TravelMode; minutes: number; parts?: TravelPart[]; cents?: number; vehicle?: string; action: ActionId; params: JsonObject; disabled?: string }[];
}

/**
 * The things lying at cells of a scope's grid where the POV sees them now: in its `sight` while the
 * grid system is on (none on a grid it doesn't stand on), else in the place it is in (`here`). One
 * it saw elsewhere, or that moved since, isn't shown where it lies now; none on a cell it isn't shown.
 */
function itemsOn(ctx: ReadContext, scope: PlaceId, grid: GridDef, cells: CellView, sight: ReadonlySet<number> | null, here: PlaceId | null): MapItemView[] {
  const { world, state } = ctx;
  const out: MapItemView[] = [];
  for (const id of Object.keys(state.entities).sort()) {
    const e = own(state.entities, id);
    const place = e?.fields.place;
    if (!e || id === world.pov || typeof place !== "string" || standingGrid(world, place)?.scope !== scope) continue;
    const { x, y } = e.fields;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const index = cellIndex(grid, { x, y });
    if (index === null || cells.blank.has(index) || cells.void.has(index) || kindIs(ctx.registry, world, e.kind, "person") || isGone(state, id) || !canSeeEntity(ctx.registry, world, state, world.pov, id)) continue;
    if (sight !== null ? !sight.has(index) : place !== here) continue;
    out.push({ id, name: e.name, x, y });
  }
  return out;
}

/**
 * The cells of a scope's grid the POV isn't shown, and in fog the ones it is (`seen`). The cells of
 * places it can't see are void (`hiddenCells`). In fog the cells it hasn't seen go out blank: those
 * never in its sight while the grid system tracks them (`seen`, its record), else the areas of the
 * rooms it knows of and hasn't been in (`unvisited`) and of the rooms it can't see and hasn't been
 * in. A cell both blank and void goes out blank, so a hidden room under fog is just fog.
 */
function cellsShown(ctx: ReadContext, grid: GridDef, display: MapDisplay, seen: string | undefined, unvisited: readonly PlaceId[]): CellView & { seen?: string } {
  const voided = hiddenCells(ctx, grid);
  const blank = new Set<number>();
  if (display !== "fog") return { blank, void: voided };
  const size = grid.width * grid.height;
  if (seen !== undefined) {
    for (let i = 0; i < size; i++) if (!hasCell(seen, i)) blank.add(i);
  } else {
    for (const id of unvisited) for (const cell of areaOf(grid, id)) blank.add(cell);
    for (const [zone, cells] of Object.entries(grid.zones)) if (placeVisit(ctx.state, zone) === null) for (const cell of cells) if (voided.has(cell)) blank.add(cell);
  }
  const shown: number[] = [];
  for (let i = 0; i < size; i++) if (!blank.has(i) && !voided.has(i)) shown.push(i);
  return { blank, void: voided, seen: addCells("", shown) };
}

/** The `n`th stand-in id of a view: opaque, and no place's own id. */
function standIn(world: Pick<WorldDoc, "places">, n: number): PlaceId {
  let id = `~${n}`;
  while (own(world.places, id)) id = `~${id}`;
  return id;
}

/**
 * What a grid shows beyond its terrain, from the geometry as the chat plays it (`grid-model.ts`): every
 * person and thing the POV may see standing on it (in its sight on the grid it stands on, else in its
 * place), with its square, footprint, what it blocks, what it lies on or in and its life state; the
 * unplaced of the POV's place with where they are kept; each door as it stands; the squares in the
 * dark (a place's light, lit or dark, over its area: only the squares the POV is shown); and, on the
 * grid the POV stands on with the grid system on, the squares it sees now (`sight`). Someone the POV
 * cannot see is not there, a square it is not shown holds none, and the scale and time step go with
 * the grid.
 */
function sceneOf(ctx: ReadContext, drawn: Drawn, ground: StoredMoving, cells: CellView, sight: ReadonlySet<number> | null, standing: boolean, here: PlaceId | null): GridScene {
  const { world, state } = ctx;
  const shown = (i: number): boolean => !cells.blank.has(i) && !cells.void.has(i);
  const may = (id: EntityId): boolean => id !== world.pov && canSeeEntity(ctx.registry, world, state, world.pov, id);
  const pieces: MapPieceView[] = [];
  for (const [id, p] of Object.entries(ground.moving.pieces)) {
    const e = own(state.entities, id);
    const square = standsAt(ground.moving, id);
    const index = square === null ? null : indexOf(drawn, square);
    if (!e || square === null || index === null || !shown(index) || !may(id)) continue;
    if (sight !== null ? !sight.has(index) : placeOfEntity(state, id) !== here) continue;
    const { x, y } = cellOf(square);
    pieces.push({
      id,
      name: e.name,
      kind: e.kind,
      x,
      y,
      ...(p.size !== undefined && (p.size[0] !== 1 || p.size[1] !== 1) ? { size: [p.size[0], p.size[1]] as [number, number] } : {}),
      ...(p.blocks !== undefined ? { blocks: { ...p.blocks } } : {}),
      ...(p.on !== undefined && may(p.on) ? { on: p.on, ...(p.within ? { within: true as const } : {}) } : {}),
      ...(e.life !== undefined && e.life !== ALIVE ? { state: e.life } : {}),
    });
  }
  const unplaced: MapUnplacedView[] = [];
  for (const id of ground.unplaced) {
    const e = own(state.entities, id);
    if (!e || !may(id) || placeOfEntity(state, id) !== here) continue;
    unplaced.push({ id, name: e.name, kind: e.kind, ...(whereOf(state, id) ?? {}) });
  }
  const doors: MapDoorView[] = [];
  for (const index of [...drawn.doors].sort((a, b) => a - b)) {
    const at = doorState(drawn, ground.moving, index);
    if (at !== null && shown(index)) doors.push({ ...cellOf(squareAt(drawn, index)), state: at });
  }
  const seen = standing && sight !== null ? [...sight].filter(shown).sort((a, b) => a - b) : null;
  const dark = [...drawn.dark].filter(shown).sort((a, b) => a - b);
  const { metres, feet, unit, diagonal, step } = drawn.scale;
  return {
    ...(pieces.length > 0 ? { pieces } : {}),
    ...(unplaced.length > 0 ? { unplaced } : {}),
    ...(doors.length > 0 ? { doors } : {}),
    ...(seen !== null ? { sight: seen } : {}),
    ...(dark.length > 0 ? { dark } : {}),
    scale: { metres, feet, unit, diagonal, step },
  };
}

/** The map as the POV sees it, in the chat's own `map.display` (`config`) when it names one, else `chosen`, else the world's display; its grids drawn by the chat's map settings (`config`). */
export function buildMapView(ctx: ReadContext, chosen: MapDisplay | null = null, config: Readonly<MapConfig> = MAP_DEFAULTS): MapView {
  const { world, state } = ctx;
  const level = ctx.levelOf(world.pov, "space");
  const settings = mapSettingsOf(world);
  const display = config.display !== "world" ? config.display : (chosen ?? settings.display);
  const here = placeOfEntity(state, world.pov);
  const path = placePath(world, here);
  const inside = new Set(path);
  const known = (id: PlaceId): boolean => canSeePlace(ctx.registry, world, state, world.pov, id);
  // The places around the POV that it may not know (a secret one, or a room of one) are drawn, but
  // never by their own id or name: each goes by a stand-in, outermost first.
  const standIns = new Map<PlaceId, PlaceId>();
  for (const id of path) if (!known(id)) standIns.set(id, standIn(world, standIns.size + 1));
  const closed = closedRoutes(ctx);
  // Home, owned and for-sale marks on the places the POV knows, each with the property the place is where the POV may know it (`economy.place_marks`, when the economy is loaded).
  const marks = new Map((optionalQuery(ctx, "economy.place_marks")?.(ctx, world.pov) ?? []).map((m) => [m.place, m] as const));
  const filter: ScopeFilter = {
    known,
    drawn: (id) => inside.has(id) || known(id),
    visited: (id) => placeVisit(state, id) !== null,
    shown: (id) => standIns.get(id) ?? id,
    // Travel skips a closed route from Space 2, where routes are first drawn, so the map does too.
    routeOpen: (id) => !closed.has(id),
    mark: (id) => marks.get(id),
  };
  const children = placeChildren(world);
  const opens = (id: PlaceId): boolean => hasGrid(world, id) || (children.get(id) ?? []).some(filter.drawn);
  const roots = (children.get(null) ?? []).filter(filter.drawn);
  // The POV's cell is drawn on the grid it stands on: its place's own, or the one its place is drawn on.
  const stand = standingGrid(world, here);
  const fields = own(state.entities, world.pov)?.fields;
  const pov = stand && typeof fields?.x === "number" && typeof fields.y === "number" && cellIndex(stand.grid, { x: fields.x, y: fields.y }) !== null ? { x: fields.x, y: fields.y } : undefined;
  const ids = [...children.values()].flat().filter(filter.drawn).sort(byShownId(filter));
  // What the POV sees from where it stands now, while the grid system tracks sight (DESIGN §7).
  const sight = settings.grid.movement && stand && pov ? new Set(sightFor(ctx, stand.scope, pov, settings.grid.sightRadius)) : new Set<number>();
  const trail = (id: PlaceId): MapScopeView["trail"] => [
    ...(roots.length > 0 ? [{ id: null, name: WORLD_SCOPE_NAME }] : []),
    ...placePath(world, id)
      .slice(0, -1)
      .filter(filter.drawn)
      .map((p) => ({ id: filter.shown(p), name: shownName(world, filter, p) })),
  ];
  const scopes: MapScopeView[] = [];
  if (roots.length > 0) scopes.push(scopeView(world, null, filter, { level, trail: [], children }));
  for (const id of ids) {
    if (!opens(id)) continue;
    const grid = gridOf(world, id);
    // Below Space 2 a grid isn't drawn at all.
    if (!grid || level < 2) {
      scopes.push(scopeView(world, id, filter, { level, trail: trail(id), children }));
      continue;
    }
    const seen = settings.grid.movement ? (cellsSeen(state, id, grid.width) ?? "") : undefined;
    const unvisited = (children.get(id) ?? []).filter((p) => filter.drawn(p) && filter.known(p) && !filter.visited(p) && !inside.has(p));
    const cells = cellsShown(ctx, grid, display, seen, unvisited);
    const inSight = settings.grid.movement ? (stand?.scope === id ? sight : new Set<number>()) : null;
    // The geometry as the chat plays it: the squares it changed laid over the map, everyone and everything the POV may see on it, the doors as they stand.
    const drawn = drawnOf(world, id, config, state);
    const scene = drawn === null ? undefined : sceneOf(ctx, drawn, movingOf(ctx.registry, world, state, drawn), cells, inSight, stand?.scope === id && settings.grid.movement, here);
    scopes.push(scopeView(world, id, filter, { level, trail: trail(id), children, cells, items: itemsOn(ctx, id, grid, cells, inSight, here), ...(pov && stand?.scope === id ? { pov } : {}), ...(cells.seen !== undefined ? { seen: cells.seen } : {}), ...(drawn !== null && scene !== undefined ? { drawn: { width: drawn.width, height: drawn.height, terrain: drawn.terrain, blocked: [...drawn.blocked] }, scene } : {}) }));
  }
  const scope = defaultScope(world, here, children, filter);
  const shownScope = scope === null ? null : filter.shown(scope);
  // Somewhere to go is a place the POV knows: a stand-in names nowhere it could ask for.
  const targets = new Set(ids.filter(known));
  const travel: MapView["travel"] = [];
  if (here && level >= 1) {
    for (const id of targets) {
      if (id === here) continue;
      // Story first, a Go leads anywhere (`goMinutes`); only the travel simulation leaves one with no
      // walk disabled, and a place that gives the POV no leave to enter is greyed with why (ORG-SPEC §3.9).
      const minutes = goMinutes(ctx, here, id);
      const name = own(world.places, id)?.name ?? id;
      const shut = entryFor(ctx, world.pov, id) === null ? entryRefusal(ctx, world.pov, id) : "";
      travel.push({ to: id, label: `Walk to ${name}`, mode: "walk", minutes: minutes ?? 0, action: "go", params: { to: id }, ...(minutes === null ? { disabled: "no walking route" } : shut !== "" ? { disabled: shut } : {}) });
    }
    const vehicles = optionalQuery(ctx, "vehicles.travel_options");
    if (vehicles) for (const o of vehicles(ctx, here)) if (targets.has(o.to)) travel.push(o);
  }
  return { level, here: here === null ? null : filter.shown(here), path: path.map(filter.shown), scope: shownScope === null || scopes.some((s) => s.id === shownScope) ? shownScope : null, display, movement: settings.grid.movement, scopes, travel };
}
