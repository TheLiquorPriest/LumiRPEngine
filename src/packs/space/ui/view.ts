// The `space.map` view model as the UI reads it (`src/packs/space/core`).
// Decoded defensively from JSON; the space core builds it, already filtered to the POV.

import type { JsonObject } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { TravelMode } from "../../../shared/ids";
import { list, num, obj, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import type { MapView } from "../core/view";

export const TRAVEL_MODES = ["walk", "road", "offroad", "water"] as const satisfies readonly TravelMode[];

export function decodeMapView(value: unknown): MapView | null {
  if (!isRecord(value) || !Array.isArray(value.places)) return null;
  const scope = obj(value.scope);
  const grid = obj(value.grid);
  const pov = grid ? obj(grid.pov) : null;
  return {
    level: num(value.level, 1),
    scope: { id: scope ? optStr(scope.id) ?? null : null, name: scope ? str(scope.name, "Map") : "Map", width: scope ? num(scope.width, 1000) : 1000, height: scope ? num(scope.height, 1000) : 1000 },
    here: optStr(value.here) ?? null,
    places: list(value.places, (p) => (typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id), x: num(p.x), y: num(p.y), kind: optStr(p.kind), known: p.known !== false } : null)),
    routes: list(value.routes, (r) => {
      const modes: MapView["routes"][number]["modes"] = {};
      const raw = obj(r.modes);
      if (raw) {
        for (const mode of TRAVEL_MODES) {
          const leg = obj(raw[mode]);
          if (leg) modes[mode] = { minutes: num(leg.minutes), distanceKm: optNum(leg.distanceKm) };
        }
      }
      return typeof r.from === "string" && typeof r.to === "string" ? { from: r.from, to: r.to, modes } : null;
    }),
    travel: list(value.travel, (t) =>
      typeof t.to === "string" && typeof t.action === "string"
        ? { to: t.to, label: str(t.label, t.action), mode: oneOf(t.mode, TRAVEL_MODES, "walk"), minutes: num(t.minutes), cents: optNum(t.cents), vehicle: optStr(t.vehicle), action: t.action, params: isRecord(t.params) ? (t.params as JsonObject) : {}, disabled: optStr(t.disabled) }
        : null,
    ),
    grid: grid
      ? {
          width: num(grid.width, 1),
          height: num(grid.height, 1),
          cellMeters: optNum(grid.cellMeters),
          terrain: strings(grid.terrain),
          blocked: Array.isArray(grid.blocked) ? grid.blocked.filter((n): n is number => typeof n === "number") : [],
          pov: pov ? { x: num(pov.x), y: num(pov.y) } : undefined,
        }
      : undefined,
  };
}
