// The `space.map` view model as the UI reads it (`src/packs/space/core`).
// Decoded defensively from JSON; the space core builds it, already filtered to the POV.

import { placeMarkOf } from "../../../shared/maps";
import { isRecord } from "../../../shared/json";
import type { TravelMode } from "../../../shared/ids";
import { list, num, obj, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import type { MapDoorView, MapGridView, MapItemView, MapPieceView, MapPlaceView, MapRouteView, MapScaleView, MapScopeView, MapUnplacedView, MapView } from "../core/view";
import type { GridScene } from "../core/map-scope";
import { DOOR_STATES } from "../core/grid-play";

export const TRAVEL_MODES = ["walk", "road", "offroad", "water", "air"] as const satisfies readonly TravelMode[];

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === "number") : [];
}

function decodePlace(p: Record<string, unknown>): MapPlaceView | null {
  // A view without `visited` (an older backend) reads every place as visited: none is drawn as only heard of.
  return typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id), x: num(p.x), y: num(p.y), kind: optStr(p.kind), known: p.known !== false, visited: p.visited !== false, ...placeMarkOf(p) } : null;
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

function decodePiece(p: Record<string, unknown>): MapPieceView | null {
  if (typeof p.id !== "string" || typeof p.x !== "number" || typeof p.y !== "number") return null;
  const size = numbers(p.size);
  const blocks = obj(p.blocks);
  return {
    id: p.id,
    name: str(p.name, p.id),
    kind: str(p.kind),
    x: p.x,
    y: p.y,
    ...(size.length === 2 && (size[0] !== 1 || size[1] !== 1) ? { size: [size[0] ?? 1, size[1] ?? 1] as [number, number] } : {}),
    ...(blocks && (blocks.way === true || blocks.view === true) ? { blocks: { ...(blocks.way === true ? { way: true } : {}), ...(blocks.view === true ? { view: true } : {}) } } : {}),
    ...(typeof p.on === "string" ? { on: p.on, ...(p.within === true ? { within: true as const } : {}) } : {}),
    ...(typeof p.state === "string" ? { state: p.state } : {}),
  };
}

function decodeUnplaced(u: Record<string, unknown>): MapUnplacedView | null {
  return typeof u.id === "string" ? { id: u.id, name: str(u.name, u.id), kind: str(u.kind), ...(typeof u.zone === "string" ? { zone: u.zone } : {}), ...(typeof u.words === "string" ? { words: u.words } : {}) } : null;
}

function decodeDoor(d: Record<string, unknown>): MapDoorView | null {
  return typeof d.x === "number" && typeof d.y === "number" ? { x: d.x, y: d.y, state: oneOf(d.state, DOOR_STATES, "closed") } : null;
}

function decodeStep(value: unknown): MapScaleView["step"] {
  const step = obj(value);
  return step?.per === "round" ? { per: "round", seconds: num(step.seconds, 6), squares: num(step.squares, 1) } : { per: "minute" };
}

/** What a grid shows beyond its terrain: each part absent when the view sent none. */
function sceneOf(grid: Record<string, unknown>): GridScene {
  const pieces = list(grid.pieces, decodePiece);
  const unplaced = list(grid.unplaced, decodeUnplaced);
  const doors = list(grid.doors, decodeDoor);
  const scale = obj(grid.scale);
  return {
    ...(pieces.length > 0 ? { pieces } : {}),
    ...(unplaced.length > 0 ? { unplaced } : {}),
    ...(doors.length > 0 ? { doors } : {}),
    ...(Array.isArray(grid.sight) ? { sight: numbers(grid.sight) } : {}),
    ...(Array.isArray(grid.dark) && grid.dark.length > 0 ? { dark: numbers(grid.dark) } : {}),
    ...(scale ? { scale: { metres: num(scale.metres, 1.5), feet: num(scale.feet, 5), unit: scale.unit === "metres" ? ("metres" as const) : ("feet" as const), diagonal: scale.diagonal === "alternate" ? ("alternate" as const) : ("one" as const), step: decodeStep(scale.step) } } : {}),
  };
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
    ...sceneOf(grid),
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
  };
}
