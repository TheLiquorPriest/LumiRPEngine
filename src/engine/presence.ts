// Who is with whom (DESIGN §6.6, §24.1): the one test of being in the POV's scene, which the Minds,
// People and Stance sections, minds' presence and who gets a mind all use. Two places are together
// when they are the same place, or one lies at most two levels inside the other with nothing spread
// out between them: a reply can place someone coarsely ("the fourth floor") while the POV stands in
// a room of a suite on it. A place is spread out by travel distance: some route between two places
// inside it takes something other than walking, or a long walk (a town, a region); or routes run
// inside it (travel then joins its parts only by those routes) and short walks don't join all of
// its parts to one another (a town whose homes and sites are each their own island). A building
// drawn as rooms joined by one-minute routes, or a floor plan's doors, stays one building, and a
// place with no routes inside travel joins on foot, so it never is. Rooms side by side are never
// together: the next room over is somewhere else.

import type { EntityId, PlaceId } from "../shared/ids";
import type { RouteDef, WorldDoc } from "../shared/world";
import { placeChain } from "./lore-pins";
import { placeOfEntity } from "./scope";
import type { WorldState } from "./state";

/**
 * How many levels apart two places may be, one inside the other, and still be together: a floor, a
 * suite on it, a room of the suite. Someone placed at the whole building while the POV is in one of
 * its bathrooms is somewhere in a big place; counting them would fill People and Minds with everyone
 * a routine puts "at work" there.
 */
const LEVELS_APART = 2;

/** The longest walk between two places inside a place that keeps it one building or site; a longer one is the walk between a town's parts. */
const INTERIOR_WALK_MINUTES = 10;

/** Whether a route is travel between apart places: nothing walks it, or its walk is a long one. */
function farRoute(route: RouteDef): boolean {
  const walk = route.modes.walk;
  return walk === undefined || walk.minutes > INTERIOR_WALK_MINUTES;
}

/** Each world revision's spread-out places, read once: a revision's places and routes never change. */
const spreadOf = new WeakMap<WorldDoc, ReadonlySet<PlaceId>>();

/** The representative of `part` among the parts walks have joined (union-find, compressing the path it walked). */
function joined(parts: Map<PlaceId, PlaceId>, part: PlaceId): PlaceId {
  let rep = part;
  for (let next = parts.get(rep); next !== undefined && next !== rep; next = parts.get(rep)) rep = next;
  parts.set(part, rep);
  return rep;
}

/**
 * The spread-out places. A far route spreads each place both its ends lie within; a short walk
 * joins, in each such place, the two parts of it its ends lie in. A place routes run inside is
 * spread unless walks join all its parts: `travel.ts` joins that place's parts only by its routes,
 * so a part no walk reaches is a drive, or a world, away.
 */
function spreadPlaces(world: WorldDoc): ReadonlySet<PlaceId> {
  const hit = spreadOf.get(world);
  if (hit) return hit;
  const out = new Set<PlaceId>();
  const joins = new Map<PlaceId, Map<PlaceId, PlaceId>>();
  for (const r of Object.values(world.routes)) {
    const from = placeChain(world, r.from);
    const to = placeChain(world, r.to);
    for (let i = 1; i < from.length; i++) {
      const place = from[i];
      const fromPart = from[i - 1];
      const j = place === undefined ? -1 : to.indexOf(place);
      const toPart = to[j - 1];
      if (place === undefined || fromPart === undefined || j < 1 || toPart === undefined) continue;
      const parts = joins.get(place) ?? new Map<PlaceId, PlaceId>();
      joins.set(place, parts);
      if (farRoute(r)) out.add(place);
      else parts.set(joined(parts, fromPart), joined(parts, toPart));
    }
  }
  const partsOf = new Map<PlaceId, PlaceId[]>();
  for (const p of Object.values(world.places)) {
    if (!p.parent) continue;
    const parts = partsOf.get(p.parent);
    if (parts) parts.push(p.id);
    else partsOf.set(p.parent, [p.id]);
  }
  for (const [place, parts] of joins) {
    if (new Set((partsOf.get(place) ?? []).map((part) => joined(parts, part))).size > 1) out.add(place);
  }
  spreadOf.set(world, out);
  return out;
}

/** Whether someone at `a` is with someone at `b`: the same place, or one at most `LEVELS_APART` inside the other with no spread-out place on the way up. */
export function together(world: WorldDoc, a: PlaceId | null, b: PlaceId | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  const within = (inner: PlaceId, outer: PlaceId): boolean => {
    const up = placeChain(world, inner).slice(1, LEVELS_APART + 1);
    const at = up.indexOf(outer);
    return at >= 0 && !up.slice(0, at + 1).some((p) => spreadPlaces(world).has(p));
  };
  return within(a, b) || within(b, a);
}

/**
 * The site a place belongs to: its outermost enclosing place with nothing spread out on the way up
 * (a house with its driveway and garage, a marina), so things at the same site are a short walk
 * apart. A place that is itself spread out (a town) is its own site.
 */
export function siteOf(world: WorldDoc, place: PlaceId | null): PlaceId | null {
  if (place === null) return null;
  const chain = placeChain(world, place);
  let site = place;
  for (const up of chain.slice(1)) {
    if (spreadPlaces(world).has(up)) break;
    site = up;
  }
  return site;
}

/** Whether `id` is in the POV's scene (`together`); the POV itself isn't. */
export function inPovScene(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  return id !== world.pov && together(world, placeOfEntity(state, world.pov), placeOfEntity(state, id));
}

/** How the People section names the POV, first of everyone there; the helpers' facts lead with the POV already. */
export function povLead(name: string): string {
  return `${name} (you)`;
}
