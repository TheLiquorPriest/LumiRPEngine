// Map scopes (DESIGN §12): the map shows one place at a time, drawing only the places directly
// inside it. A place with a grid draws its children at their cells on that grid (`cell` is a
// position on the parent's grid); any other place lays them out as nodes. The world itself is the
// outermost scope, holding the top-level places. Pure over the world document, so Play's map
// (filtered to what the POV may see) and Build's map preview draw a scope the same way.

import type { PlaceId, TravelMode } from "../../../shared/ids";
import { isRecord } from "../../../shared/json";
import type { MapDoc, WorldDoc } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";

/** What the breadcrumbs call the outermost scope, the world's top-level places. */
export const WORLD_SCOPE_NAME = "World";

/** The node layout's extent when no place in it has a position of its own. */
const NODE_FRAME = 100;

export interface MapPlaceView {
  id: PlaceId;
  name: string;
  /** Position in the scope's frame: a cell's centre on the scope's grid, else on the node layout. */
  x: number;
  y: number;
  /** The place's default scene type. */
  kind?: string;
  /** Whether the POV knows the place; one the POV is inside shows even when it doesn't. */
  known: boolean;
}

export interface MapRouteView {
  from: PlaceId;
  to: PlaceId;
  modes: Partial<Record<TravelMode, { minutes: number; distanceKm?: number }>>;
}

export interface MapGridView {
  width: number;
  height: number;
  cellMeters?: number;
  /** Terrain per cell, row-major. */
  terrain: string[];
  blocked: number[];
  /** The cells of each drawn place's area: the grid's zones named after places in the scope. */
  areas: Record<PlaceId, number[]>;
  /** The POV's own cell, when it stands in this scope (Space 3 and up). */
  pov?: { x: number; y: number };
}

export interface MapScopeView {
  /** The place drawn, or null for the world (its top-level places). */
  id: PlaceId | null;
  name: string;
  /** The scopes around it, outermost first: the breadcrumbs. */
  trail: { id: PlaceId | null; name: string }[];
  /** The extent the positions sit in: the grid in cells (plus a row below it for places without a cell), else the node layout. */
  frame: { width: number; height: number };
  /** The scope's grid, drawn behind its places (Space 2 and up). */
  grid?: MapGridView;
  places: MapPlaceView[];
  /** Routes between the drawn places; a route to somewhere inside one of them is drawn to that place. */
  routes: MapRouteView[];
}

/** Which places a scope may draw, and which of them the viewer knows. */
export interface ScopeFilter {
  drawn(id: PlaceId): boolean;
  known(id: PlaceId): boolean;
}

/** Each place's children by id, and the top-level places under `null`, each list in id order. */
export function placeChildren(world: Pick<WorldDoc, "places">): Map<PlaceId | null, PlaceId[]> {
  const out = new Map<PlaceId | null, PlaceId[]>();
  for (const id of Object.keys(world.places).sort()) {
    const parent = own(world.places, id)?.parent;
    // A parent that doesn't exist leaves the place at the top, where the map can still reach it.
    const key = parent && own(world.places, parent) ? parent : null;
    out.set(key, [...(out.get(key) ?? []), id]);
  }
  return out;
}

/** A place and the places around it, outermost first; empty for a place the world doesn't have. */
export function placePath(world: Pick<WorldDoc, "places">, place: PlaceId | null): PlaceId[] {
  const out: PlaceId[] = [];
  for (let cur = place ?? undefined, guard = 0; cur && own(world.places, cur) && guard < 64 && !out.includes(cur); guard++) {
    out.unshift(cur);
    cur = own(world.places, cur)?.parent;
  }
  return out;
}

/** Whether a place has a grid of its own to draw its places on. */
export function hasGrid(world: Pick<WorldDoc, "places" | "grids">, place: PlaceId): boolean {
  const grid = own(world.places, place)?.grid;
  return grid !== undefined && own(world.grids, grid) !== undefined;
}

/** The node map (`WorldDoc.maps`, no layout) that draws a place, if one does; a map the document holds may be malformed. */
function nodeMapOf(world: Pick<WorldDoc, "maps">, place: PlaceId): MapDoc | undefined {
  return Object.values(isRecord(world.maps) ? world.maps : {}).find((m) => isRecord(m) && m.scope === place && m.layout === undefined);
}

/**
 * The scope a map opens on for a viewer at `here`: the nearest place around it that has a grid or
 * a map of its own (the viewer's own place counts when there are places inside it to draw), else
 * the place it is in, else the world.
 */
export function defaultScope(world: Pick<WorldDoc, "places" | "grids" | "maps">, here: PlaceId | null, children: ReadonlyMap<PlaceId | null, readonly PlaceId[]>, filter: ScopeFilter): PlaceId | null {
  const path = placePath(world, here);
  const inner = path.at(-1);
  for (let i = path.length - 1; i >= 0; i--) {
    const id = path[i];
    if (id === undefined) continue;
    if (id === inner && !(children.get(id) ?? []).some(filter.drawn)) continue;
    if (hasGrid(world, id) || nodeMapOf(world, id)) return id;
  }
  return path.length >= 2 ? (path[path.length - 2] ?? null) : null;
}

/** The child of `scope` that is `place` or holds it, or null when the place lies outside the scope. */
function childOf(world: Pick<WorldDoc, "places">, scope: PlaceId | null, place: PlaceId): PlaceId | null {
  const path = placePath(world, place);
  if (scope === null) return path[0] ?? null;
  const at = path.indexOf(scope);
  return at >= 0 ? (path[at + 1] ?? null) : null;
}

/** Places on a ring in id order (the same places always sit in the same spots), rounded to a hundredth of the frame: whole units on the usual 100-unit node layout. */
function ring(ids: readonly PlaceId[], frame: { width: number; height: number }): Map<PlaceId, { x: number; y: number }> {
  const step = Math.min(frame.width, frame.height) / 100;
  const r = Math.min(frame.width, frame.height) / 3;
  const round = (v: number): number => Math.round(v / step) * step;
  return new Map(ids.map((id, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, ids.length);
    return [id, { x: round(frame.width / 2 + r * Math.cos(angle)), y: round(frame.height / 2 + r * Math.sin(angle)) }];
  }));
}

/**
 * One scope as the map draws it: its drawn children at their positions, the routes between them,
 * and its grid. On a grid a child sits at its cell's centre, and children without a cell (another
 * floor, a cellar) sit in a row below the grid. Elsewhere a child sits at its node-map position
 * (`layoutPos`, in the node map's `size` when it gives one), and the rest lie on a ring.
 */
export function scopeView(world: Pick<WorldDoc, "places" | "routes" | "grids" | "maps">, scope: PlaceId | null, filter: ScopeFilter, opts: { level: number; trail: MapScopeView["trail"]; children?: ReadonlyMap<PlaceId | null, readonly PlaceId[]>; here?: PlaceId | null; pov?: { x: number; y: number } }): MapScopeView {
  const kids = ((opts.children ?? placeChildren(world)).get(scope) ?? []).filter(filter.drawn);
  const def = scope === null ? undefined : own(world.places, scope);
  const grid = def?.grid ? own(world.grids, def.grid) : undefined;
  const at = new Map<PlaceId, { x: number; y: number }>();
  let frame = { width: NODE_FRAME, height: NODE_FRAME };
  if (grid) {
    const off: PlaceId[] = [];
    for (const id of kids) {
      const cell = own(world.places, id)?.cell;
      if (cell && cell.x >= 0 && cell.y >= 0 && cell.x < grid.width && cell.y < grid.height) at.set(id, { x: cell.x + 0.5, y: cell.y + 0.5 });
      else off.push(id);
    }
    off.forEach((id, i) => at.set(id, { x: Math.round(((i + 1) * grid.width * 10) / (off.length + 1)) / 10, y: grid.height + 1.5 }));
    frame = { width: grid.width, height: grid.height + (off.length > 0 ? 3 : 0) };
  } else {
    const placed = kids.flatMap((id) => {
      const pos = own(world.places, id)?.layoutPos;
      return pos ? [[id, { x: pos.x, y: pos.y }] as const] : [];
    });
    const size = scope === null ? undefined : nodeMapOf(world, scope)?.size;
    if (Array.isArray(size) && typeof size[0] === "number" && typeof size[1] === "number") frame = { width: Math.max(1, size[0]), height: Math.max(1, size[1]) };
    else if (placed.length > 0) frame = { width: Math.max(1, ...placed.map(([, p]) => p.x)), height: Math.max(1, ...placed.map(([, p]) => p.y)) };
    for (const [id, p] of placed) at.set(id, p);
    const rest = kids.filter((id) => !at.has(id));
    for (const [id, p] of ring(rest, frame)) at.set(id, p);
  }
  const places: MapPlaceView[] = kids.map((id) => {
    const p = own(world.places, id);
    const pos = at.get(id) ?? { x: 0, y: 0 };
    return { id, name: p?.name ?? id, x: pos.x, y: pos.y, ...(p?.sceneType ? { kind: p.sceneType } : {}), known: filter.known(id) };
  });
  const drawn = new Set(kids);
  const routes = new Map<string, MapRouteView>();
  if (opts.level >= 2) {
    for (const rid of Object.keys(world.routes).sort()) {
      const r = own(world.routes, rid);
      if (!r) continue;
      const a = childOf(world, scope, r.from);
      const b = childOf(world, scope, r.to);
      if (a === null || b === null || a === b || !drawn.has(a) || !drawn.has(b)) continue;
      const [from, to] = a < b ? [a, b] : [b, a];
      const key = `${from}\u0000${to}`;
      const out = routes.get(key) ?? { from, to, modes: {} };
      for (const [mode, leg] of Object.entries(r.modes) as [TravelMode, { minutes: number; distanceKm?: number }][]) {
        const had = out.modes[mode];
        if (!had || leg.minutes < had.minutes) out.modes[mode] = { minutes: leg.minutes, ...(leg.distanceKm !== undefined ? { distanceKm: leg.distanceKm } : {}) };
      }
      routes.set(key, out);
    }
  }
  const areas: Record<PlaceId, number[]> = {};
  if (grid) for (const id of kids) if (own(grid.zones, id)) areas[id] = [...(own(grid.zones, id) ?? [])];
  return {
    id: scope,
    name: scope === null ? WORLD_SCOPE_NAME : (def?.name ?? scope),
    trail: opts.trail,
    frame,
    ...(grid && opts.level >= 2
      ? { grid: { width: grid.width, height: grid.height, ...(grid.cellMeters !== undefined ? { cellMeters: grid.cellMeters } : {}), terrain: grid.terrain, blocked: grid.blocked, areas, ...(opts.pov && opts.level >= 3 && scope !== null && scope === opts.here ? { pov: opts.pov } : {}) } }
      : {}),
    places,
    routes: [...routes.values()],
  };
}
