// Routes (DESIGN §3 Locations, §9.1 Space & travel): shortest routes over the world's route graph
// per travel mode, with terrain multipliers. Grids and A* are `shared/grid`.

import type { PlaceId, TravelMode } from "../../../shared/ids";
import type { RouteLeg, WorldDoc } from "../../../shared/world";
import type { TravelLeg, TravelPlan, VehicleTrip, VehicleTripAsk } from "../../../shared/travel";
import { objOf, optionalQuery, sliceOf, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { passMemo } from "../../../engine/read-pass";
import { mapSettingsOf, travelTuningOf } from "../../../shared/maps";

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

interface Edge {
  to: PlaceId;
  leg: RouteLeg;
}

/** The node a place is left through: a compact parent itself, or a spread parent's exit node `P^`. */
const EXIT = "^";

/** The route graph of a travel mode, once per read pass (DESIGN §9.6): the palette and the map ask for many routes on one world. */
function edges(world: WorldDoc, mode: TravelMode, closed: ReadonlySet<string>): Map<PlaceId, Edge[]> {
  return passMemo([world], `space.edges\u0000${mode}\u0000${[...closed].sort().join("\u0000")}`, () => buildEdges(world, mode, closed));
}

function buildEdges(world: WorldDoc, mode: TravelMode, closed: ReadonlySet<string>): Map<PlaceId, Edge[]> {
  const out = new Map<PlaceId, Edge[]>();
  // Who each node already reaches, so a connector is added only where no edge leads yet.
  const reached = new Map<PlaceId, Set<PlaceId>>();
  const authored = new Map<PlaceId, Edge[]>();
  const add = (from: PlaceId, to: PlaceId, leg: RouteLeg, into = out): void => {
    const list = into.get(from) ?? [];
    list.push({ to, leg });
    into.set(from, list);
    if (into !== out) return;
    const seen = reached.get(from) ?? new Set<PlaceId>();
    seen.add(to);
    reached.set(from, seen);
  };
  const reaches = (from: PlaceId, to: PlaceId): boolean => reached.get(from)?.has(to) === true;
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
  /** The places a place lies within, nearest first. */
  const ancestors = (place: PlaceId): Set<PlaceId> => {
    const out = new Set<PlaceId>();
    let cur = own(world.places, place)?.parent;
    for (let guard = 0; cur && guard < 64; guard++) {
      out.add(cur);
      cur = own(world.places, cur)?.parent;
    }
    return out;
  };
  const byParent = new Map<string, PlaceId[]>();
  for (const p of Object.values(world.places)) {
    if (!p.parent) continue;
    const kids = byParent.get(p.parent);
    if (kids) kids.push(p.id);
    else byParent.set(p.parent, [p.id]);
  }
  // Every place both ends of a route (of any mode, open or not) lie within.
  const holding = new Set<PlaceId>();
  for (const r of Object.values(world.routes)) {
    const from = ancestors(r.from);
    for (const a of ancestors(r.to)) if (from.has(a)) holding.add(a);
  }
  const spread = new Set<PlaceId>([...byParent.keys()].filter((parent) => holding.has(parent)));
  const exitNode = (p: PlaceId): PlaceId => (spread.has(p) ? `${p}${EXIT}` : p);
  for (const [parent, kids] of byParent) {
    for (const a of kids.sort()) {
      if (mode === "walk" && !spread.has(parent)) for (const b of kids) if (a !== b && !reaches(a, b)) add(a, b, connector);
      add(a, exitNode(parent), connector);
      if (!reaches(parent, a)) add(parent, a, connector);
    }
  }
  for (const p of spread) {
    for (const e of authored.get(p) ?? []) add(`${p}${EXIT}`, e.to, e.leg);
    const up = own(world.places, p)?.parent;
    if (up) add(`${p}${EXIT}`, exitNode(up), connector);
  }
  return out;
}

/** How a search costs a leg of a mode: its distance at a set speed, else its own minutes; then terrain and weather. */
interface Costing {
  /** km/h for a mode, when the world (or the vehicle's class) sets one. */
  speed(mode: TravelMode): number | undefined;
  terrain: boolean;
  /** Weather and other microclimate effects on a mode. */
  factor(mode: TravelMode): number;
}

function legCost(costing: Costing, mode: TravelMode, leg: RouteLeg): number {
  const speed = costing.speed(mode);
  const base = speed !== undefined && (leg.distanceKm ?? 0) > 0 ? ((leg.distanceKm ?? 0) / speed) * 60 : leg.minutes;
  return base * (costing.terrain ? (own(TERRAIN_FACTORS, leg.terrain ?? "") ?? 1) : 1) * costing.factor(mode);
}

/** A step a search took into a node: from where, by which leg of which mode. */
interface Step {
  from: PlaceId;
  leg: RouteLeg;
  mode: TravelMode;
}

/** What a search reached: each node's least minutes, and the step that got there. */
interface Tree {
  dist: Map<PlaceId, number>;
  prev: Map<PlaceId, Step>;
}

/**
 * Dijkstra by minutes over the union of some modes' graphs, from `starts` (ties broken by node id),
 * until `stop` says a node ends it or 10,000 nodes are taken.
 */
function grow(graphs: readonly { mode: TravelMode; graph: Map<PlaceId, Edge[]> }[], starts: readonly PlaceId[], costing: Costing, stop: (node: PlaceId) => boolean = () => false): Tree {
  const dist = new Map<PlaceId, number>(starts.map((s) => [s, 0]));
  const prev = new Map<PlaceId, Step>();
  const done = new Set<PlaceId>();
  const frontier = new Frontier();
  for (const s of starts) frontier.push(0, s);
  for (let taken = 0; taken < 10_000; ) {
    const next = frontier.pop();
    if (!next) break;
    const best = next.place;
    // A node reached again more cheaply, or taken already, is passed over.
    if (done.has(best) || next.minutes !== dist.get(best)) continue;
    taken++;
    if (stop(best)) break;
    done.add(best);
    for (const { mode, graph } of graphs) {
      for (const e of graph.get(best) ?? []) {
        const nd = next.minutes + legCost(costing, mode, e.leg);
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: best, leg: e.leg, mode });
          frontier.push(nd, e.to);
        }
      }
    }
  }
  return { dist, prev };
}

const plain = (node: PlaceId): PlaceId => (node.endsWith(EXIT) ? node.slice(0, -EXIT.length) : node);

/** The legs a forward search took to `end`, each rounded to the minute, with the mode it took. */
function legsTo(tree: Tree, costing: Costing, from: PlaceId, end: PlaceId): { leg: TravelLeg; mode: TravelMode }[] | null {
  const legs: { leg: TravelLeg; mode: TravelMode }[] = [];
  for (let cur: PlaceId = end; cur !== from; ) {
    const p = tree.prev.get(cur);
    if (!p) return null;
    legs.unshift({ leg: { from: plain(p.from), to: plain(cur), minutes: Math.round(legCost(costing, p.mode, p.leg)), distanceKm: p.leg.distanceKm ?? 0, terrain: p.leg.terrain ?? null }, mode: p.mode });
    cur = p.from;
  }
  return legs;
}

function planOf(mode: TravelMode, legs: TravelLeg[]): TravelPlan {
  return { mode, legs, minutes: legs.reduce((a, l) => a + l.minutes, 0), distanceKm: legs.reduce((a, l) => a + l.distanceKm, 0) };
}

/**
 * The fastest route between two places for a mode (Dijkstra by minutes; ties broken by place id),
 * or null when unreachable. `terrain` applies the terrain multipliers (Space level 4), `factor`
 * scales every leg (weather and other microclimate effects) and `speed` (km/h) times a leg with a
 * distance by it in place of its own minutes.
 */
export function findRoute(world: WorldDoc, from: PlaceId, to: PlaceId, mode: TravelMode, opts: { terrain?: boolean; factor?: number; closed?: ReadonlySet<string>; speed?: number } = {}): TravelPlan | null {
  if (from === to) return { mode, legs: [], minutes: 0, distanceKm: 0 };
  if (!own(world.places, from) || !own(world.places, to)) return null;
  const costing: Costing = { speed: () => opts.speed, terrain: opts.terrain === true, factor: () => opts.factor ?? 1 };
  const tree = grow([{ mode, graph: edges(world, mode, opts.closed ?? new Set()) }], [from], costing, (node) => node === to || node === `${to}${EXIT}`);
  const ends = [to, `${to}${EXIT}`].filter((n) => tree.prev.has(n)).sort((a, b) => (tree.dist.get(a) ?? Infinity) - (tree.dist.get(b) ?? Infinity));
  const end = ends[0] ?? null;
  if (end === null) return null;
  const legs = legsTo(tree, costing, from, end);
  return legs ? planOf(mode, legs.map((l) => l.leg)) : null;
}

/** A node a route search reached, by how far it is. */
interface Reached {
  minutes: number;
  place: PlaceId;
}

/** The nodes a route search may take next, nearest first, then by id: the order it takes them in. */
class Frontier {
  private readonly heap: Reached[] = [];

  private static before(a: Reached, b: Reached): boolean {
    return a.minutes < b.minutes || (a.minutes === b.minutes && a.place < b.place);
  }

  push(minutes: number, place: PlaceId): void {
    const heap = this.heap;
    heap.push({ minutes, place });
    for (let i = heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (!this.swapIfBefore(i, up)) break;
      i = up;
    }
  }

  pop(): Reached | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;
    heap[0] = last;
    for (let i = 0; ; ) {
      let least = i;
      for (const k of [2 * i + 1, 2 * i + 2]) {
        const child = heap[k];
        const held = heap[least];
        if (child && held && Frontier.before(child, held)) least = k;
      }
      if (least === i || !this.swapIfBefore(least, i)) break;
      i = least;
    }
    return top;
  }

  /** Swaps the entries at `a` and `b` when the one at `a` comes before the one at `b`. */
  private swapIfBefore(a: number, b: number): boolean {
    const heap = this.heap;
    const x = heap[a];
    const y = heap[b];
    if (!x || !y || !Frontier.before(x, y)) return false;
    heap[a] = y;
    heap[b] = x;
    return true;
  }
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

/** The route a mode takes at the current level: closed routes from level 2; terrain and weather (factors, closed modes) from level 4; the world's speed for the mode, when it sets one (`mapSettings.travel`). */
export function routeAt(ctx: ReadContext, from: PlaceId, to: PlaceId, mode: TravelMode): TravelPlan | null {
  const level = ctx.levelOf(ctx.world.pov, "space");
  if (level <= 1) return nominalRoute(ctx, from, to, mode);
  const weather = level >= 4 ? optionalQuery(ctx, "weather.travel_factor") : null;
  const closes = level >= 4 ? optionalQuery(ctx, "weather.closed_modes") : null;
  if (closes && (closes(ctx, from).includes(mode) || closes(ctx, to).includes(mode))) return null;
  const factor = weather ? Math.max(weather(ctx, from, mode), weather(ctx, to, mode)) : 1;
  const speed = travelTuningOf(ctx.world).speeds[mode];
  return findRoute(ctx.world, from, to, mode, { terrain: level >= 4, factor, closed: closedRoutes(ctx), ...(speed !== undefined ? { speed } : {}) });
}

/** Level 0–1 movement: any known place, instantly (0) or in a nominal move (1). */
export function nominalRoute(ctx: ReadContext, from: PlaceId, to: PlaceId, mode: TravelMode): TravelPlan | null {
  if (!own(ctx.world.places, to)) return null;
  if (from === to) return { mode, legs: [], minutes: 0, distanceKm: 0 };
  const level = ctx.levelOf(ctx.world.pov, "space");
  const minutes = level === 0 ? 0 : NOMINAL_MOVE_MINUTES;
  return { mode, legs: [{ from, to, minutes, distanceKm: 0, terrain: null }], minutes, distanceKm: 0 };
}

const GO_MODES: readonly TravelMode[] = ["walk", "road", "offroad", "water"];

/**
 * How long Go takes from `from` to `to` (DESIGN §4.1), or null when it can't go: the walk when one
 * leads there; else, story first, the fastest other mode's route, and with none the nominal move.
 * Only the world's travel simulation makes a Go with no walk one that can't go.
 */
export function goMinutes(ctx: ReadContext, from: PlaceId, to: PlaceId): number | null {
  const walk = routeAt(ctx, from, to, "walk");
  if (walk) return walk.minutes;
  if (mapSettingsOf(ctx.world).travelSimulation === true) return null;
  const times = GO_MODES.flatMap((m) => routeAt(ctx, from, to, m)?.minutes ?? []);
  return times.length > 0 ? Math.min(...times) : NOMINAL_MOVE_MINUTES;
}

/** The walk graph run backwards: who reaches each node, by which leg. */
function reverseEdges(world: WorldDoc, closed: ReadonlySet<string>): Map<PlaceId, Edge[]> {
  return passMemo([world], `space.redges\u0000${[...closed].sort().join("\u0000")}`, () => {
    const out = new Map<PlaceId, Edge[]>();
    for (const [from, list] of edges(world, "walk", closed)) {
      for (const e of list) {
        const back = out.get(e.to) ?? [];
        back.push({ to: from, leg: e.leg });
        out.set(e.to, back);
      }
    }
    return out;
  });
}

/** The places a place lies within, nearest first. */
function aroundOf(world: WorldDoc, place: PlaceId): PlaceId[] {
  const out: PlaceId[] = [];
  let cur = own(world.places, place)?.parent;
  for (let guard = 0; cur && guard < 64; guard++) {
    out.push(cur);
    cur = own(world.places, cur)?.parent;
  }
  return out;
}

/**
 * Vehicle trips from one driver and vehicle to each of `targets` (DESIGN §9.1). Below Space 2 a
 * trip is the nominal move from where both are, with no overheads. From 2, the driver walks to the
 * vehicle (up to the world's `fetchMinutes`), gets it going, drives over the modes it goes by,
 * parks, and walks the rest: the vehicle is left at the destination, else wherever the drive and
 * the walk from it take least time. A destination it can't get nearer has no trip.
 */
export function vehicleTrips(ctx: ReadContext, ask: VehicleTripAsk, targets: readonly PlaceId[]): Map<PlaceId, VehicleTrip> {
  const out = new Map<PlaceId, VehicleTrip>();
  const level = ctx.levelOf(ctx.world.pov, "space");
  const first = ask.modes[0];
  if (level <= 1 || first === undefined) {
    if (ask.at !== ask.from || first === undefined) return out;
    for (const to of targets) {
      const drive = nominalRoute(ctx, ask.at, to, first);
      if (drive) out.set(to, { fetch: null, startMinutes: 0, drive, park: to, parkMinutes: 0, walk: null, minutes: drive.minutes });
    }
    return out;
  }
  const tuning = travelTuningOf(ctx.world);
  const fetch = ask.at === ask.from ? null : routeAt(ctx, ask.from, ask.at, "walk");
  if (ask.at !== ask.from && (!fetch || fetch.minutes > tuning.fetchMinutes)) return out;
  const weather = level >= 4 ? optionalQuery(ctx, "weather.travel_factor") : null;
  const closes = level >= 4 ? optionalQuery(ctx, "weather.closed_modes") : null;
  const closed = closedRoutes(ctx);
  const startMinutes = Math.round(tuning.startMinutes);
  const parkMinutes = Math.round(tuning.parkMinutes);
  // A search per set of open modes and weather, shared by the targets that have the same.
  const searches = new Map<string, { tree: Tree; costing: Costing }>();
  for (const to of targets) {
    if (to === ask.from || !own(ctx.world.places, to)) continue;
    const modes = ask.modes.filter((m) => !(closes && (closes(ctx, ask.at).includes(m) || closes(ctx, to).includes(m))));
    if (modes.length === 0) continue;
    const factors = new Map(modes.map((m) => [m, weather ? Math.max(weather(ctx, ask.at, m), weather(ctx, to, m)) : 1]));
    const key = modes.map((m) => `${m}:${factors.get(m)}`).join(",");
    let search = searches.get(key);
    if (!search) {
      const costing: Costing = { speed: (m) => ask.speed ?? tuning.speeds[m], terrain: level >= 4, factor: (m) => factors.get(m) ?? 1 };
      search = { costing, tree: grow(modes.map((mode) => ({ mode, graph: edges(ctx.world, mode, closed) })), [ask.at], costing) };
      searches.set(key, search);
    }
    const { tree, costing } = search;
    // The walk from each place to the destination, run back from it; the walk the trip takes is
    // then the place's own route, so it reads exactly as a Go from there would.
    const walkClosed = closes ? closes(ctx, to).includes("walk") : false;
    const back = walkClosed ? null : grow([{ mode: "walk", graph: reverseEdges(ctx.world, closed) }], [to, `${to}${EXIT}`], { speed: (m) => tuning.speeds[m], terrain: level >= 4, factor: () => 1 });
    const arrive = (p: PlaceId): { node: PlaceId; minutes: number } | null => {
      const nodes = [p, `${p}${EXIT}`].filter((n) => tree.prev.has(n)).sort((a, b) => (tree.dist.get(a) ?? Infinity) - (tree.dist.get(b) ?? Infinity));
      const node = nodes[0];
      return node === undefined ? null : { node, minutes: tree.dist.get(node) ?? Infinity };
    };
    let best: { park: PlaceId; node: PlaceId; minutes: number } | null = null;
    const around = new Set([...aroundOf(ctx.world, ask.at), ...aroundOf(ctx.world, to)]);
    for (const p of [to, ...Object.keys(ctx.world.places).sort()]) {
      // A place around the start or the destination is no place to leave it: the trip is inside it already.
      if (p === ask.at || (p !== to && (!ask.canPark(p) || around.has(p)))) continue;
      const there = arrive(p);
      if (!there) continue;
      const walkWeather = weather ? Math.max(weather(ctx, p, "walk"), weather(ctx, to, "walk")) : 1;
      const rest = p === to ? 0 : (back?.dist.get(p) ?? Infinity) * walkWeather;
      const minutes = there.minutes + rest;
      // The destination itself first, then by id: the order the places are taken in.
      if (Number.isFinite(minutes) && (best === null || minutes < best.minutes)) best = { park: p, node: there.node, minutes };
    }
    if (!best) continue;
    const legs = legsTo(tree, costing, ask.at, best.node);
    const walk = best.park === to ? null : routeAt(ctx, best.park, to, "walk");
    if (!legs || (best.park !== to && !walk)) continue;
    const byMode = new Map<TravelMode, number>();
    for (const l of legs) byMode.set(l.mode, (byMode.get(l.mode) ?? 0) + l.leg.minutes);
    const main = [...byMode].sort(([a, x], [b, y]) => y - x || modes.indexOf(a) - modes.indexOf(b))[0]?.[0] ?? first;
    const drive = planOf(main, legs.map((l) => l.leg));
    out.set(to, { fetch, startMinutes, drive, park: best.park, parkMinutes, walk, minutes: (fetch?.minutes ?? 0) + startMinutes + drive.minutes + parkMinutes + (walk?.minutes ?? 0) });
  }
  return out;
}
