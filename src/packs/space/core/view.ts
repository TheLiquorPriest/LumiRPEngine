// The map panel's view model (`space.map`): every scope the POV can open (map-scope.ts), each drawn
// as its own frame; the scope the map opens on (the one around the POV); and travel options as
// ready-to-send actions. A scope lists a place the POV can see (`canSeePlace`), and the places the
// POV is inside even when it can't, each marked known and visited; the frontend draws them by the
// display mode (DESIGN §12). A grid carries the POV's cell when it stands on it, and, while the grid
// system is on, the cells it has seen; things lying in cells show once the POV has seen them there.

import type { JsonObject } from "../../../shared/json";
import type { ActionId, PlaceId, TravelMode } from "../../../shared/ids";
import { cellIndex, gridOf, hasCell, standingGrid } from "../../../shared/grid";
import { mapSettingsOf } from "../../../shared/maps";
import type { GridDef, MapDisplay } from "../../../shared/world";
import type { ReadContext } from "../../../engine/registry";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { cellsSeen, placeVisit } from "../../../engine/seen";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { defaultScope, hasGrid, placeChildren, placePath, scopeView, WORLD_SCOPE_NAME, type MapItemView, type MapScopeView, type ScopeFilter } from "./map-scope";
import { routeAt } from "./travel";

export type { MapGridView, MapItemView, MapPlaceView, MapRouteView, MapScopeView } from "./map-scope";

export interface MapView {
  level: number;
  here: PlaceId | null;
  /** The POV's place and the places around it, outermost first. */
  path: PlaceId[];
  /** The scope the map opens on: the place whose map the POV stands in, or null for the world. */
  scope: PlaceId | null;
  /** How the world's map shows by default; the player may choose otherwise for a chat (`StateView.mapDisplay`). */
  display: MapDisplay;
  /** Whether the grid system is on: the POV walks grids (Walk here sends `step`), and their cells are seen or fogged. */
  movement: boolean;
  /** Every scope the POV can open: the world, and each place it can see with places inside it or a grid. */
  scopes: MapScopeView[];
  travel: { to: PlaceId; label: string; mode: TravelMode; minutes: number; cents?: number; vehicle?: string; action: ActionId; params: JsonObject; disabled?: string }[];
}

/** The things lying at cells of a scope's grid that the POV has seen there: on a seen cell while cells are tracked, else in a place it has been. */
function itemsOn(ctx: ReadContext, scope: PlaceId, grid: GridDef, seen: string | undefined): MapItemView[] {
  const { world, state } = ctx;
  const out: MapItemView[] = [];
  for (const id of Object.keys(state.entities).sort()) {
    const e = own(state.entities, id);
    const place = e?.fields.place;
    if (!e || id === world.pov || typeof place !== "string" || standingGrid(world, place)?.scope !== scope) continue;
    const { x, y } = e.fields;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const index = cellIndex(grid, { x, y });
    if (index === null || kindIs(ctx.registry, world, e.kind, "person") || isGone(state, id) || !canSeeEntity(ctx.registry, world, state, world.pov, id)) continue;
    if (seen !== undefined ? !hasCell(seen, index) : placeVisit(state, place) === null) continue;
    out.push({ id, name: e.name, x, y });
  }
  return out;
}

export function buildMapView(ctx: ReadContext): MapView {
  const { world, state } = ctx;
  const level = ctx.levelOf(world.pov, "space");
  const settings = mapSettingsOf(world);
  const here = placeOfEntity(state, world.pov);
  const path = placePath(world, here);
  const inside = new Set(path);
  const filter: ScopeFilter = {
    known: (id) => canSeePlace(ctx.registry, world, state, world.pov, id),
    drawn: (id) => inside.has(id) || canSeePlace(ctx.registry, world, state, world.pov, id),
    visited: (id) => placeVisit(state, id) !== null,
  };
  const children = placeChildren(world);
  const opens = (id: PlaceId): boolean => hasGrid(world, id) || (children.get(id) ?? []).some(filter.drawn);
  const roots = (children.get(null) ?? []).filter(filter.drawn);
  // The POV's cell is drawn on the grid it stands on: its place's own, or the one its place is drawn on.
  const stand = standingGrid(world, here);
  const fields = own(state.entities, world.pov)?.fields;
  const pov = stand && typeof fields?.x === "number" && typeof fields.y === "number" && cellIndex(stand.grid, { x: fields.x, y: fields.y }) !== null ? { x: fields.x, y: fields.y } : undefined;
  const ids = [...children.values()].flat().filter(filter.drawn).sort();
  const trail = (id: PlaceId): MapScopeView["trail"] => [
    ...(roots.length > 0 ? [{ id: null, name: WORLD_SCOPE_NAME }] : []),
    ...placePath(world, id)
      .slice(0, -1)
      .filter(filter.drawn)
      .map((p) => ({ id: p, name: own(world.places, p)?.name ?? p })),
  ];
  const scopes: MapScopeView[] = [];
  if (roots.length > 0) scopes.push(scopeView(world, null, filter, { level, trail: [], children }));
  for (const id of ids) {
    if (!opens(id)) continue;
    const grid = gridOf(world, id);
    const seen = grid && settings.grid.movement ? (cellsSeen(state, id, grid.width) ?? "") : undefined;
    scopes.push(scopeView(world, id, filter, { level, trail: trail(id), children, ...(pov && stand?.scope === id ? { pov } : {}), ...(seen !== undefined ? { seen } : {}), ...(grid && level >= 2 ? { items: itemsOn(ctx, id, grid, seen) } : {}) }));
  }
  const scope = defaultScope(world, here, children, filter);
  const drawn = new Set(ids);
  const travel: MapView["travel"] = [];
  if (here && level >= 1) {
    for (const id of ids) {
      if (id === here) continue;
      const plan = routeAt(ctx, here, id, "walk");
      const name = own(world.places, id)?.name ?? id;
      travel.push({ to: id, label: `Walk to ${name}`, mode: "walk", minutes: plan?.minutes ?? 0, action: "go", params: { to: id }, ...(plan ? {} : { disabled: "no walking route" }) });
    }
    const vehicles = optionalQuery(ctx, "vehicles.travel_options");
    if (vehicles) for (const o of vehicles(ctx, here)) if (drawn.has(o.to)) travel.push(o);
  }
  return { level, here, path, scope: scope === null || scopes.some((s) => s.id === scope) ? scope : null, display: settings.display, movement: settings.grid.movement, scopes, travel };
}
