// Who is with whom (DESIGN §6.6, §24.1): the one test of being in the POV's scene, which the Minds,
// People and Stance sections, minds' presence and who gets a mind all use. Two places are together
// when they are the same place, or one lies at most two levels inside the other with nothing spread
// out between them: a reply can place someone coarsely ("the fourth floor") while the POV stands in
// a room of a suite on it. A place is spread out by travel distance: some route between two places
// inside it takes something other than walking, or a long walk (a town, a region). Short walks
// between rooms never spread a place, so a building drawn as rooms joined by one-minute routes, or a
// floor plan's doors, stays one building. Rooms side by side are never together: the next room over
// is somewhere else.

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

/** The places a far route runs inside: each place both its ends lie within. */
function spreadPlaces(world: WorldDoc): ReadonlySet<PlaceId> {
  const hit = spreadOf.get(world);
  if (hit) return hit;
  const out = new Set<PlaceId>();
  for (const r of Object.values(world.routes)) {
    if (!farRoute(r)) continue;
    const from = new Set(placeChain(world, r.from).slice(1));
    for (const p of placeChain(world, r.to).slice(1)) if (from.has(p)) out.add(p);
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

/** Whether `id` is in the POV's scene (`together`); the POV itself isn't. */
export function inPovScene(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  return id !== world.pov && together(world, placeOfEntity(state, world.pov), placeOfEntity(state, id));
}

/** How the People section names the POV, first of everyone there; the helpers' facts lead with the POV already. */
export function povLead(name: string): string {
  return `${name} (you)`;
}
