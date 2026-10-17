// The map panel's view model (`space.map`): the POV's surroundings (the top place above it), known
// places with positions, routes, and travel options as ready-to-send actions.

import type { JsonObject } from "../../../shared/json";
import type { ActionId, PlaceId, TravelMode } from "../../../shared/ids";
import type { ReadContext } from "../../../engine/registry";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { placeOfEntity } from "../../../engine/scope";
import { canSeePlace } from "../../../engine/visibility";
import { routeAt } from "./travel";

export interface MapView {
  level: number;
  scope: { id: PlaceId | null; name: string; width: number; height: number };
  here: PlaceId | null;
  places: { id: PlaceId; name: string; x: number; y: number; kind?: string; known: boolean }[];
  routes: { from: PlaceId; to: PlaceId; modes: Partial<Record<TravelMode, { minutes: number; distanceKm?: number }>> }[];
  travel: { to: PlaceId; label: string; mode: TravelMode; minutes: number; cents?: number; vehicle?: string; action: ActionId; params: JsonObject; disabled?: string }[];
  grid?: { width: number; height: number; cellMeters?: number; terrain: string[]; blocked: number[]; pov?: { x: number; y: number } };
}

function topOf(ctx: ReadContext, place: PlaceId | null): PlaceId | null {
  let cur = place;
  for (let guard = 0; cur && guard < 32; guard++) {
    const parent = own(ctx.world.places, cur)?.parent;
    if (!parent) return cur;
    cur = parent;
  }
  return cur;
}

export function buildMapView(ctx: ReadContext): MapView {
  const level = ctx.levelOf(ctx.world.pov, "space");
  const here = placeOfEntity(ctx.state, ctx.world.pov);
  const top = topOf(ctx, here);
  const topDef = top ? own(ctx.world.places, top) : undefined;
  const grid = topDef?.grid ? own(ctx.world.grids, topDef.grid) : undefined;
  const width = grid?.width ?? 100;
  const height = grid?.height ?? 100;
  const ids = Object.keys(ctx.world.places)
    .sort()
    .filter((id) => canSeePlace(ctx.world, ctx.state, ctx.world.pov, id));
  const places: MapView["places"] = ids.map((id, i) => {
    const p = own(ctx.world.places, id);
    // Places without a cell sit on a circle, in id order: stable across turns.
    const angle = (2 * Math.PI * i) / Math.max(1, ids.length);
    const x = p?.cell?.x ?? Math.round(width / 2 + (width / 3) * Math.cos(angle));
    const y = p?.cell?.y ?? Math.round(height / 2 + (height / 3) * Math.sin(angle));
    return { id, name: p?.name ?? id, x, y, ...(p?.sceneType ? { kind: p.sceneType } : {}), known: true };
  });
  const visible = new Set(ids);
  const routes: MapView["routes"] =
    level >= 2
      ? Object.values(ctx.world.routes)
          .filter((r) => visible.has(r.from) && visible.has(r.to))
          .map((r) => ({ from: r.from, to: r.to, modes: Object.fromEntries(Object.entries(r.modes).map(([m, leg]) => [m, { minutes: leg.minutes, ...(leg.distanceKm !== undefined ? { distanceKm: leg.distanceKm } : {}) }])) }))
      : [];
  const travel: MapView["travel"] = [];
  if (here && level >= 1) {
    for (const id of ids) {
      if (id === here) continue;
      const plan = routeAt(ctx, here, id, "walk");
      const name = own(ctx.world.places, id)?.name ?? id;
      travel.push({ to: id, label: `Walk to ${name}`, mode: "walk", minutes: plan?.minutes ?? 0, action: "go", params: { to: id }, ...(plan ? {} : { disabled: "no walking route" }) });
    }
    const vehicles = optionalQuery(ctx, "vehicles.travel_options");
    if (vehicles) for (const o of vehicles(ctx, here)) travel.push(o);
  }
  const pov = own(ctx.state.entities, ctx.world.pov);
  return {
    level,
    scope: { id: top, name: topDef?.name ?? "", width, height },
    here,
    places,
    routes,
    travel,
    ...(grid && level >= 3
      ? { grid: { width: grid.width, height: grid.height, ...(grid.cellMeters !== undefined ? { cellMeters: grid.cellMeters } : {}), terrain: grid.terrain, blocked: grid.blocked, ...(typeof pov?.fields.x === "number" && typeof pov.fields.y === "number" ? { pov: { x: pov.fields.x, y: pov.fields.y } } : {}) } }
      : {}),
  };
}
