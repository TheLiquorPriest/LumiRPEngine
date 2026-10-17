// The map panel's view model (`space.map`): every scope the POV can open (map-scope.ts), each drawn
// as its own frame; the scope the map opens on (the one around the POV); and travel options as
// ready-to-send actions. A scope lists a place the POV can see (`canSeePlace`), and the places the
// POV is inside even when it can't.

import type { JsonObject } from "../../../shared/json";
import type { ActionId, PlaceId, TravelMode } from "../../../shared/ids";
import type { ReadContext } from "../../../engine/registry";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { placeOfEntity } from "../../../engine/scope";
import { canSeePlace } from "../../../engine/visibility";
import { defaultScope, hasGrid, placeChildren, placePath, scopeView, WORLD_SCOPE_NAME, type MapScopeView, type ScopeFilter } from "./map-scope";
import { routeAt } from "./travel";

export type { MapGridView, MapPlaceView, MapRouteView, MapScopeView } from "./map-scope";

export interface MapView {
  level: number;
  here: PlaceId | null;
  /** The POV's place and the places around it, outermost first. */
  path: PlaceId[];
  /** The scope the map opens on: the place whose map the POV stands in, or null for the world. */
  scope: PlaceId | null;
  /** Every scope the POV can open: the world, and each place it can see with places inside it or a grid. */
  scopes: MapScopeView[];
  travel: { to: PlaceId; label: string; mode: TravelMode; minutes: number; cents?: number; vehicle?: string; action: ActionId; params: JsonObject; disabled?: string }[];
}

export function buildMapView(ctx: ReadContext): MapView {
  const { world, state } = ctx;
  const level = ctx.levelOf(world.pov, "space");
  const here = placeOfEntity(state, world.pov);
  const path = placePath(world, here);
  const inside = new Set(path);
  const filter: ScopeFilter = { known: (id) => canSeePlace(ctx.registry, world, state, world.pov, id), drawn: (id) => inside.has(id) || canSeePlace(ctx.registry, world, state, world.pov, id) };
  const children = placeChildren(world);
  const opens = (id: PlaceId): boolean => hasGrid(world, id) || (children.get(id) ?? []).some(filter.drawn);
  const roots = (children.get(null) ?? []).filter(filter.drawn);
  const pov = own(state.entities, world.pov);
  const at = typeof pov?.fields.x === "number" && typeof pov.fields.y === "number" ? { x: pov.fields.x, y: pov.fields.y } : undefined;
  const ids = [...children.values()].flat().filter(filter.drawn).sort();
  const trail = (id: PlaceId): MapScopeView["trail"] => [
    ...(roots.length > 0 ? [{ id: null, name: WORLD_SCOPE_NAME }] : []),
    ...placePath(world, id)
      .slice(0, -1)
      .filter(filter.drawn)
      .map((p) => ({ id: p, name: own(world.places, p)?.name ?? p })),
  ];
  const scopes: MapScopeView[] = [];
  if (roots.length > 0) scopes.push(scopeView(world, null, filter, { level, trail: [], children, here }));
  for (const id of ids) if (opens(id)) scopes.push(scopeView(world, id, filter, { level, trail: trail(id), children, here, ...(at ? { pov: at } : {}) }));
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
  return { level, here, path, scope: scope === null || scopes.some((s) => s.id === scope) ? scope : null, scopes, travel };
}
