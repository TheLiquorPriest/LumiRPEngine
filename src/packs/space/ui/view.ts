// The `space.map` view model as the UI reads it (`src/packs/space/core`).
// Decoded defensively from JSON; the space core builds it, already filtered to the POV.

import type { JsonObject } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { TravelMode } from "../../../shared/ids";
import { list, num, obj, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import type { MapGridView, MapItemView, MapPlaceView, MapRouteView, MapScopeView, MapView } from "../core/view";

export const TRAVEL_MODES = ["walk", "road", "offroad", "water"] as const satisfies readonly TravelMode[];
const TRIP_PARTS = ["fetch", "start", "drive", "park", "walk"] as const;

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === "number") : [];
}

function decodePlace(p: Record<string, unknown>): MapPlaceView | null {
  // A view without `visited` (an older backend) reads every place as visited: none is drawn as only heard of.
  return typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id), x: num(p.x), y: num(p.y), kind: optStr(p.kind), known: p.known !== false, visited: p.visited !== false } : null;
}

function decodeItem(i: Record<string, unknown>): MapItemView | null {
  return typeof i.id === "string" && typeof i.x === "number" && typeof i.y === "number" ? { id: i.id, name: str(i.name, i.id), x: i.x, y: i.y } : null;
}

function decodeRoute(r: Record<string, unknown>): MapRouteView | null {
  const modes: MapRouteView["modes"] = {};
  const raw = obj(r.modes);
  if (raw) {
    for (const mode of TRAVEL_MODES) {
      const leg = obj(raw[mode]);
      if (leg) modes[mode] = { minutes: num(leg.minutes), distanceKm: optNum(leg.distanceKm) };
    }
  }
  return typeof r.from === "string" && typeof r.to === "string" ? { from: r.from, to: r.to, modes } : null;
}

function decodeGrid(value: unknown): MapGridView | undefined {
  const grid = obj(value);
  if (!grid) return undefined;
  const pov = obj(grid.pov);
  const areas = obj(grid.areas);
  return {
    width: num(grid.width, 1),
    height: num(grid.height, 1),
    cellMeters: optNum(grid.cellMeters),
    terrain: strings(grid.terrain),
    blocked: numbers(grid.blocked),
    areas: areas ? Object.fromEntries(Object.entries(areas).map(([id, cells]) => [id, numbers(cells)])) : {},
    pov: pov ? { x: num(pov.x), y: num(pov.y) } : undefined,
    seen: optStr(grid.seen),
    items: list(grid.items, decodeItem),
  };
}

export function decodeScope(s: Record<string, unknown>): MapScopeView | null {
  if (s.id !== null && typeof s.id !== "string") return null;
  const frame = obj(s.frame);
  return {
    id: s.id,
    name: str(s.name, "Map"),
    trail: list(s.trail, (c) => (c.id === null || typeof c.id === "string" ? { id: c.id, name: str(c.name, c.id ?? "Map") } : null)),
    frame: { width: frame ? num(frame.width, 100) : 100, height: frame ? num(frame.height, 100) : 100 },
    grid: decodeGrid(s.grid),
    places: list(s.places, decodePlace),
    routes: list(s.routes, decodeRoute),
  };
}

export function decodeMapView(value: unknown): MapView | null {
  if (!isRecord(value) || !Array.isArray(value.scopes)) return null;
  return {
    level: num(value.level, 1),
    here: optStr(value.here) ?? null,
    path: strings(value.path),
    scope: optStr(value.scope) ?? null,
    display: value.display === "fog" ? "fog" : "knowledge",
    movement: value.movement === true,
    scopes: list(value.scopes, decodeScope),
    travel: list(value.travel, (t) =>
      typeof t.to === "string" && typeof t.action === "string"
        ? { to: t.to, label: str(t.label, t.action), mode: oneOf(t.mode, TRAVEL_MODES, "walk"), minutes: num(t.minutes), parts: list(t.parts, (p) => (typeof p.words === "string" ? { kind: oneOf(p.kind, TRIP_PARTS, "drive"), minutes: num(p.minutes), words: p.words } : null)), cents: optNum(t.cents), vehicle: optStr(t.vehicle), action: t.action, params: isRecord(t.params) ? (t.params as JsonObject) : {}, disabled: optStr(t.disabled) }
        : null,
    ),
  };
}
