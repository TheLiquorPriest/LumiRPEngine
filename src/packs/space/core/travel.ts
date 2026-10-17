// Routes and grids (DESIGN §3 Locations, §9.1 Space & travel): shortest routes over the world's route
// graph per travel mode, terrain multipliers, and A* on grids with a hard expansion cap.

import type { PlaceId, TravelMode } from "../../../shared/ids";
import type { GridDef, RouteLeg, WorldDoc } from "../../../shared/world";
import { objOf, optionalQuery, sliceOf, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";

/** A move at Space level 1 (named places only). */
export const NOMINAL_MOVE_MINUTES = 15;

/** Terrain multipliers on leg time (Space level 4). Unknown terrain is 1. */
export const TERRAIN_FACTORS: Readonly<Record<string, number>> = Object.freeze({
  paved: 1,
  road: 1,
  gravel: 1.2,
  trail: 1.3,
  dirt: 1.4,
  rough: 1.6,
  sand: 1.8,
  mud: 2,
  snow: 2.2,
  swamp: 2.5,
  water: 1,
  open_water: 1,
  river: 1.1,
});

/** Walking between places that share a parent, when no route is authored. */
export const SIBLING_WALK_MINUTES = 5;

export interface TravelLeg {
  from: PlaceId;
  to: PlaceId;
  minutes: number;
  distanceKm: number;
  terrain: string | null;
}

export interface TravelPlan {
  mode: TravelMode;
  legs: TravelLeg[];
  minutes: number;
  distanceKm: number;
}

interface Edge {
  to: PlaceId;
  leg: RouteLeg;
}

/** The node a place is left through: a compact parent itself, or a spread parent's exit node `P^`. */
const EXIT = "^";

function edges(world: WorldDoc, mode: TravelMode, closed: ReadonlySet<string>): Map<PlaceId, Edge[]> {
  const out = new Map<PlaceId, Edge[]>();
  const authored = new Map<PlaceId, Edge[]>();
  const add = (from: PlaceId, to: PlaceId, leg: RouteLeg, into = out): void => {
    const list = into.get(from) ?? [];
    list.push({ to, leg });
    into.set(from, list);
  };
  for (const id of Object.keys(world.routes).sort()) {
    const r = own(world.routes, id);
    const leg = r ? own(r.modes, mode) : undefined;
    if (!r || !leg || closed.has(id)) continue;
    add(r.from, r.to, leg);
    add(r.from, r.to, leg, authored);
    if (r.bidirectional) {
      add(r.to, r.from, leg);
      add(r.to, r.from, leg, authored);
    }
  }
  // Places inside a place connect to it: on foot a short walk, by vehicle or boat a one-minute
  // connector (out of the garage, off the dock) with no distance. A parent with authored routes
  // between its own descendants is "spread out" (a town): leaving one of its children reaches its
  // exit node, which carries the parent's own routes but never re-enters a sibling, so a town is
  // not a free hub. A "compact" parent (a building) connects its children directly.
  const connector: RouteLeg = mode === "walk" ? { minutes: SIBLING_WALK_MINUTES, distanceKm: 0.3 } : { minutes: 1, distanceKm: 0 };
  const within = (place: PlaceId, ancestor: PlaceId): boolean => {
    let cur = own(world.places, place)?.parent;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur === ancestor) return true;
      cur = own(world.places, cur)?.parent;
    }
    return false;
  };
  const byParent = new Map<string, PlaceId[]>();
  for (const p of Object.values(world.places)) if (p.parent) byParent.set(p.parent, [...(byParent.get(p.parent) ?? []), p.id]);
  const spread = new Set<PlaceId>();
  for (const parent of byParent.keys()) if (Object.values(world.routes).some((r) => within(r.from, parent) && within(r.to, parent))) spread.add(parent);
  const exitNode = (p: PlaceId): PlaceId => (spread.has(p) ? `${p}${EXIT}` : p);
  for (const [parent, kids] of byParent) {
    for (const a of kids.sort()) {
      if (mode === "walk" && !spread.has(parent)) for (const b of kids) if (a !== b && !(out.get(a) ?? []).some((e) => e.to === b)) add(a, b, connector);
      add(a, exitNode(parent), connector);
      if (!(out.get(parent) ?? []).some((e) => e.to === a)) add(parent, a, connector);
    }
  }
  for (const p of spread) {
    for (const e of authored.get(p) ?? []) add(`${p}${EXIT}`, e.to, e.leg);
    const up = own(world.places, p)?.parent;
    if (up) add(`${p}${EXIT}`, exitNode(up), connector);
  }
  return out;
}

/**
 * The fastest route between two places for a mode (Dijkstra by minutes; ties broken by place id),
 * or null when unreachable. `terrain` applies the terrain multipliers (Space level 4) and
 * `factor` scales every leg (weather and other microclimate effects).
 */
export function findRoute(world: WorldDoc, from: PlaceId, to: PlaceId, mode: TravelMode, opts: { terrain?: boolean; factor?: number; closed?: ReadonlySet<string> } = {}): TravelPlan | null {
  if (from === to) return { mode, legs: [], minutes: 0, distanceKm: 0 };
  if (!own(world.places, from) || !own(world.places, to)) return null;
  const graph = edges(world, mode, opts.closed ?? new Set());
  const factor = opts.factor ?? 1;
  const cost = (leg: RouteLeg): number => leg.minutes * (opts.terrain ? (own(TERRAIN_FACTORS, leg.terrain ?? "") ?? 1) : 1) * factor;
  const dist = new Map<PlaceId, number>([[from, 0]]);
  const prev = new Map<PlaceId, { from: PlaceId; leg: RouteLeg }>();
  const done = new Set<PlaceId>();
  for (let guard = 0; guard < 10_000; guard++) {
    let best: PlaceId | null = null;
    for (const [p, d] of dist) if (!done.has(p) && (best === null || d < (dist.get(best) ?? Infinity) || (d === dist.get(best) && p < best))) best = p;
    if (best === null) return null;
    if (best === to || best === `${to}${EXIT}`) break;
    done.add(best);
    for (const e of graph.get(best) ?? []) {
      const nd = (dist.get(best) ?? 0) + cost(e.leg);
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: best, leg: e.leg });
      }
    }
  }
  const ends = [to, `${to}${EXIT}`].filter((n) => prev.has(n)).sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
  const end = ends[0] ?? null;
  if (end === null) return null;
  const plain = (node: PlaceId): PlaceId => (node.endsWith(EXIT) ? node.slice(0, -EXIT.length) : node);
  const legs: TravelLeg[] = [];
  for (let cur: PlaceId = end; cur !== from; ) {
    const p = prev.get(cur);
    if (!p) return null;
    legs.unshift({ from: plain(p.from), to: plain(cur), minutes: Math.round(cost(p.leg)), distanceKm: p.leg.distanceKm ?? 0, terrain: p.leg.terrain ?? null });
    cur = p.from;
  }
  return { mode, legs, minutes: legs.reduce((a, l) => a + l.minutes, 0), distanceKm: legs.reduce((a, l) => a + l.distanceKm, 0) };
}

// ---------------------------------------------------------------- grids

export interface Cell {
  x: number;
  y: number;
}

/** Cost to enter a cell by its terrain code; blocked cells are impassable. */
export const GRID_TERRAIN_COST: Readonly<Record<string, number>> = Object.freeze({ "": 1, ".": 1, floor: 1, road: 1, grass: 1.2, sand: 1.8, mud: 2, water: 4, rough: 1.6, "~": 4, "^": 3 });

/** Expanded-node cap for one A* search: a search past it returns null. */
export const ASTAR_CAP = 20_000;

export interface GridPath {
  cells: Cell[];
  cost: number;
}

/**
 * A* on a grid, 4-connected, Manhattan heuristic (admissible: every step costs ≥ 1). Returns the
 * cheapest path including both ends, or null when blocked, off-grid or past `cap` expansions.
 */
export function findPath(grid: GridDef, from: Cell, to: Cell, cap = ASTAR_CAP): GridPath | null {
  const inside = (c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < grid.width && c.y < grid.height;
  const index = (c: Cell): number => c.y * grid.width + c.x;
  const blocked = new Set(grid.blocked);
  if (!inside(from) || !inside(to) || blocked.has(index(from)) || blocked.has(index(to))) return null;
  const goal = index(to);
  const h = (i: number): number => Math.abs((i % grid.width) - to.x) + Math.abs(Math.floor(i / grid.width) - to.y);
  const g = new Map<number, number>([[index(from), 0]]);
  const came = new Map<number, number>();
  const open = new Map<number, number>([[index(from), h(index(from))]]);
  let expanded = 0;
  while (open.size > 0) {
    let cur = -1;
    let best = Infinity;
    for (const [i, f] of open) if (f < best || (f === best && i < cur)) {
      best = f;
      cur = i;
    }
    if (cur === goal) {
      const cells: Cell[] = [];
      for (let i: number | undefined = cur; i !== undefined; i = came.get(i)) cells.unshift({ x: i % grid.width, y: Math.floor(i / grid.width) });
      return { cells, cost: g.get(cur) ?? 0 };
    }
    open.delete(cur);
    if (++expanded > cap) return null;
    const cx = cur % grid.width;
    const cy = Math.floor(cur / grid.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: cx + dx, y: cy + dy };
      if (!inside(n)) continue;
      const ni = index(n);
      if (blocked.has(ni)) continue;
      const step = Math.max(1, own(GRID_TERRAIN_COST, grid.terrain[ni] ?? "") ?? 1);
      const ng = (g.get(cur) ?? 0) + step;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, cur);
        open.set(ni, ng + h(ni));
      }
    }
  }
  return null;
}

/** Walking minutes along a grid path: its cost × the cell size, at 80 m per minute (a cell is 80 m by default). */
export function gridMinutes(grid: GridDef, path: GridPath): number {
  const meters = (grid.cellMeters ?? 80) * path.cost;
  return Math.max(path.cells.length > 1 ? 1 : 0, Math.round(meters / 80));
}

/** Routes closed now: `packs.space.config.closedRoutes` (secret or seasonal routes) unless opened, plus any closed by `space.route`. */
export function closedRoutes(ctx: Pick<ReadContext, "world" | "state">): Set<string> {
  const initial = ctx.world.packs.space?.config.closedRoutes;
  const out = new Set<string>(Array.isArray(initial) ? initial.filter((x): x is string => typeof x === "string") : []);
  for (const [id, open] of Object.entries(objOf(sliceOf(ctx.state, "space").routes))) {
    if (open === true) out.delete(id);
    else if (open === false) out.add(id);
  }
  return out;
}

/** The route a mode takes at the current level: closed routes from level 2; terrain and weather (factors, closed modes) from level 4. */
export function routeAt(ctx: ReadContext, from: PlaceId, to: PlaceId, mode: TravelMode): TravelPlan | null {
  const level = ctx.levelOf(ctx.world.pov, "space");
  if (level <= 1) return nominalRoute(ctx, from, to, mode);
  const weather = level >= 4 ? optionalQuery(ctx, "weather.travel_factor") : null;
  const closes = level >= 4 ? optionalQuery(ctx, "weather.closed_modes") : null;
  if (closes && (closes(ctx, from).includes(mode) || closes(ctx, to).includes(mode))) return null;
  const factor = weather ? Math.max(weather(ctx, from, mode), weather(ctx, to, mode)) : 1;
  return findRoute(ctx.world, from, to, mode, { terrain: level >= 4, factor, closed: closedRoutes(ctx) });
}

/** Level 0–1 movement: any known place, instantly (0) or in a nominal move (1). */
export function nominalRoute(ctx: ReadContext, from: PlaceId, to: PlaceId, mode: TravelMode): TravelPlan | null {
  if (!own(ctx.world.places, to)) return null;
  if (from === to) return { mode, legs: [], minutes: 0, distanceKm: 0 };
  const level = ctx.levelOf(ctx.world.pov, "space");
  const minutes = level === 0 ? 0 : NOMINAL_MOVE_MINUTES;
  return { mode, legs: [{ from, to, minutes, distanceKm: 0, terrain: null }], minutes, distanceKm: 0 };
}
