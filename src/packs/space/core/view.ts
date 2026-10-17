// The map panel's view model (`space.map`): every scope the POV can open (map-scope.ts), each drawn
// as its own frame; the scope the map opens on (the one around the POV); and travel options as
// ready-to-send actions. A scope lists a place the POV can see (`canSeePlace`), and the places the
// POV is inside even when it can't, each marked known and visited; one it can't see goes by a
// stand-in (an opaque id and "Somewhere") everywhere the view names it, and is never somewhere to
// travel to. The view is built for the chat's display (DESIGN §12): its grids carry only the cells
// the POV is shown, the cells of places it can't see as nothing in either display, and in fog the
// cells it hasn't seen as blank ground. A grid carries the POV's cell when it stands on it; things
// lying in cells show once the POV has seen them there.

import type { JsonObject } from "../../../shared/json";
import type { ActionId, PlaceId, TravelMode } from "../../../shared/ids";
import { addCells, areaOf, cellIndex, gridOf, hasCell, standingGrid } from "../../../shared/grid";
import { mapSettingsOf } from "../../../shared/maps";
import type { GridDef, MapDisplay, WorldDoc } from "../../../shared/world";
import type { ReadContext } from "../../../engine/registry";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { cellsSeen, placeVisit } from "../../../engine/seen";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { byShownId, defaultScope, hasGrid, placeChildren, placePath, scopeView, shownName, WORLD_SCOPE_NAME, type CellView, type MapItemView, type MapScopeView, type ScopeFilter } from "./map-scope";
import { hiddenCells } from "./positions";
import { routeAt } from "./travel";

export type { MapGridView, MapItemView, MapPlaceView, MapRouteView, MapScopeView } from "./map-scope";

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
  travel: { to: PlaceId; label: string; mode: TravelMode; minutes: number; cents?: number; vehicle?: string; action: ActionId; params: JsonObject; disabled?: string }[];
}

/** The things lying at cells of a scope's grid that the POV has seen there: on a seen cell while cells are tracked, else in a place it has been; never on a cell it isn't shown. */
function itemsOn(ctx: ReadContext, scope: PlaceId, grid: GridDef, seen: string | undefined, cells: CellView): MapItemView[] {
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
    if (seen !== undefined ? !hasCell(seen, index) : placeVisit(state, place) === null) continue;
    out.push({ id, name: e.name, x, y });
  }
  return out;
}

/**
 * The cells of a scope's grid the POV isn't shown, and in fog the ones it is (`seen`). The cells of
 * places it can't see are void in either display (`hiddenCells`). In fog the cells it hasn't seen
 * go out blank: those never in its sight while the grid system tracks them (`seen`, its record),
 * else the areas of the rooms it knows of and hasn't been in (`unvisited`).
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

/** The map as the POV sees it, in `chosen` (the chat's pick), else the world's display. */
export function buildMapView(ctx: ReadContext, chosen: MapDisplay | null = null): MapView {
  const { world, state } = ctx;
  const level = ctx.levelOf(world.pov, "space");
  const settings = mapSettingsOf(world);
  const display = chosen ?? settings.display;
  const here = placeOfEntity(state, world.pov);
  const path = placePath(world, here);
  const inside = new Set(path);
  const known = (id: PlaceId): boolean => canSeePlace(ctx.registry, world, state, world.pov, id);
  // The places around the POV that it may not know (a secret one, someone's flat it was let into)
  // are drawn, but never by their own id or name: each goes by a stand-in, outermost first.
  const standIns = new Map<PlaceId, PlaceId>();
  for (const id of path) if (!known(id)) standIns.set(id, standIn(world, standIns.size + 1));
  const filter: ScopeFilter = {
    known,
    drawn: (id) => inside.has(id) || known(id),
    visited: (id) => placeVisit(state, id) !== null,
    shown: (id) => standIns.get(id) ?? id,
  };
  const children = placeChildren(world);
  const opens = (id: PlaceId): boolean => hasGrid(world, id) || (children.get(id) ?? []).some(filter.drawn);
  const roots = (children.get(null) ?? []).filter(filter.drawn);
  // The POV's cell is drawn on the grid it stands on: its place's own, or the one its place is drawn on.
  const stand = standingGrid(world, here);
  const fields = own(state.entities, world.pov)?.fields;
  const pov = stand && typeof fields?.x === "number" && typeof fields.y === "number" && cellIndex(stand.grid, { x: fields.x, y: fields.y }) !== null ? { x: fields.x, y: fields.y } : undefined;
  const ids = [...children.values()].flat().filter(filter.drawn).sort(byShownId(filter));
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
    scopes.push(scopeView(world, id, filter, { level, trail: trail(id), children, cells, items: itemsOn(ctx, id, grid, seen, cells), ...(pov && stand?.scope === id ? { pov } : {}), ...(cells.seen !== undefined ? { seen: cells.seen } : {}) }));
  }
  const scope = defaultScope(world, here, children, filter);
  const shownScope = scope === null ? null : filter.shown(scope);
  // Somewhere to go is a place the POV knows: a stand-in names nowhere it could ask for.
  const targets = new Set(ids.filter(known));
  const travel: MapView["travel"] = [];
  if (here && level >= 1) {
    for (const id of targets) {
      if (id === here) continue;
      const plan = routeAt(ctx, here, id, "walk");
      const name = own(world.places, id)?.name ?? id;
      travel.push({ to: id, label: `Walk to ${name}`, mode: "walk", minutes: plan?.minutes ?? 0, action: "go", params: { to: id }, ...(plan ? {} : { disabled: "no walking route" }) });
    }
    const vehicles = optionalQuery(ctx, "vehicles.travel_options");
    if (vehicles) for (const o of vehicles(ctx, here)) if (targets.has(o.to)) travel.push(o);
  }
  return { level, here: here === null ? null : filter.shown(here), path: path.map(filter.shown), scope: shownScope === null || scopes.some((s) => s.id === shownScope) ? shownScope : null, display, movement: settings.grid.movement, scopes, travel };
}
