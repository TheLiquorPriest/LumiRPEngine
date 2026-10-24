// Who is with whom (DESIGN §6.6, §24.1): the one test of being in the POV's scene, which the Minds,
// People and Stance sections, minds' presence and who gets a mind all use. Two places are together
// when they are the same place, or one lies inside the other within one building or site: a reply
// can place someone coarsely ("the fourth floor") while the POV stands in a room on it. What counts
// as a building or site is the space pack's reading of the map (`packs/space/core/travel.ts`): a
// place some route runs inside, both its ends within it, is spread out (a town, a region), and being
// somewhere in it isn't being with whoever is in one of its buildings; any other place is compact,
// and whoever is inside it is with whoever is at it. Rooms side by side never are: the next room
// over is somewhere else.

import type { EntityId, PlaceId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import { placeChain } from "./lore-pins";
import { placeOfEntity } from "./scope";
import type { WorldState } from "./state";

/** Each world revision's spread-out places, read once: a revision's places and routes never change. */
const spreadOf = new WeakMap<WorldDoc, ReadonlySet<PlaceId>>();

/** The places some route runs inside: each place both its ends lie within, as the travel graph reads a spread parent. */
function spreadPlaces(world: WorldDoc): ReadonlySet<PlaceId> {
  const hit = spreadOf.get(world);
  if (hit) return hit;
  const out = new Set<PlaceId>();
  for (const r of Object.values(world.routes)) {
    const from = new Set(placeChain(world, r.from).slice(1));
    for (const p of placeChain(world, r.to).slice(1)) if (from.has(p)) out.add(p);
  }
  spreadOf.set(world, out);
  return out;
}

/** Whether someone at `a` is with someone at `b`: the same place, or one inside the other with the outer one compact. */
export function together(world: WorldDoc, a: PlaceId | null, b: PlaceId | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  const within = (inner: PlaceId, outer: PlaceId): boolean => placeChain(world, inner).includes(outer) && !spreadPlaces(world).has(outer);
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
