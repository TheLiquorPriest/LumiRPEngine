// Places as a reply's read names them (DESIGN §9.4): the places `extract` is offered, and the one
// place a name it gives back stands for. Only places the player character can see are offered or
// found by name, so neither tells of a place it may not know. A world can hold hundreds of places,
// so the menu leads with the places the reply and the player's message name, then where the player
// character is and the places holding it, then where the people the read is shown are, then the
// rest, nearest first along the place tree.

import type { PlaceId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import { placeChain } from "./lore-pins";
import { own } from "./pack-kit";
import type { Registry } from "./registry-impl";
import { placeOfEntity } from "./scope";
import type { WorldState } from "./state";
import { canSeePlace } from "./visibility";

/** The most places `extract` is offered. */
export const PLACE_MENU_MAX = 60;

/** A place as `extract` is offered it. */
export interface PlaceChoice {
  id: PlaceId;
  name: string;
}

/** Text as names are compared: lower case, letters and digits only, one space between words. */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A place's name as names are compared (`words`), a leading article left out: "the Rooftop Terrace" is "rooftop terrace". */
export function placeKey(name: string): string {
  return words(name).replace(/^(?:the|a|an) /, "");
}

/** How many steps up and down the place tree lead from `a` to `b`; two places with no common ancestor are as far apart as their chains are long. */
export function placeDistance(world: Pick<WorldDoc, "places">, a: PlaceId, b: PlaceId): number {
  const up = placeChain(world, a);
  const down = placeChain(world, b);
  for (const [i, id] of up.entries()) {
    const j = down.indexOf(id);
    if (j >= 0) return i + j;
  }
  return up.length + down.length;
}

/** The places the POV can see that have a name, in the world's order. */
function namedPlaces(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): PlaceId[] {
  return Object.keys(world.places).filter((id) => (own(world.places, id)?.name.trim() ?? "") !== "" && canSeePlace(reg, world, state, world.pov, id));
}

/**
 * The places `extract` is offered, at most `PLACE_MENU_MAX`, each one the POV can see: first those
 * whose name `texts` say as whole words (the reply and the player's message), nearest first; then
 * the POV's place and the places holding it; then `also` (where the people the read is shown are);
 * then the rest, nearest the POV's place first and in the world's order where as near.
 */
export function placeMenu(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, texts: readonly string[], also: readonly PlaceId[] = []): PlaceChoice[] {
  const here = placeOfEntity(state, world.pov);
  const seen = namedPlaces(reg, world, state);
  const distance = new Map(seen.map((id) => [id, here === null ? 0 : placeDistance(world, here, id)]));
  const near = [...seen].sort((a, b) => (distance.get(a) ?? 0) - (distance.get(b) ?? 0));
  const said = texts.map((t) => ` ${words(t)} `);
  const named = near.filter((id) => {
    const key = placeKey(own(world.places, id)?.name ?? "");
    return key !== "" && said.some((t) => t.includes(` ${key} `));
  });
  const visible = new Set(seen);
  const out: PlaceChoice[] = [];
  const added = new Set<PlaceId>();
  for (const id of [...named, ...placeChain(world, here), ...also, ...near]) {
    if (out.length >= PLACE_MENU_MAX) break;
    if (!visible.has(id) || added.has(id)) continue;
    added.add(id);
    out.push({ id, name: own(world.places, id)?.name.trim() ?? id });
  }
  return out;
}

/**
 * The place `said` stands for: a place id as it is (in any case), else the place the POV can see by
 * that name (`placeKey`), the nearest to the POV's place when several share it. Null when none does,
 * or when the nearest two are as near as each other.
 */
export function placeSaid(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, said: string): PlaceId | null {
  const t = said.trim();
  if (t === "") return null;
  if (hasOwn(world.places, t)) return t;
  if (hasOwn(world.places, t.toLowerCase())) return t.toLowerCase();
  const key = placeKey(t);
  if (key === "") return null;
  const matches = namedPlaces(reg, world, state).filter((id) => placeKey(own(world.places, id)?.name ?? "") === key);
  if (matches.length <= 1) return matches[0] ?? null;
  const here = placeOfEntity(state, world.pov);
  if (here === null) return null;
  const [first, second] = matches.map((id) => ({ id, d: placeDistance(world, here, id) })).sort((a, b) => a.d - b.d);
  return first && second && first.d < second.d ? first.id : null;
}

/**
 * Whether `said` names a place the POV can't see: its id (in any case), or a name only such places
 * have (`placeKey`). Hearing of such a place is how the POV comes to know it (the `knows` channel),
 * so nothing the player sees may name one otherwise.
 */
export function placeUnheard(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, said: string): boolean {
  const t = said.trim();
  const id = hasOwn(world.places, t) ? t : hasOwn(world.places, t.toLowerCase()) ? t.toLowerCase() : null;
  if (id !== null) return !canSeePlace(reg, world, state, world.pov, id);
  const key = placeKey(t);
  const named = key === "" ? [] : Object.keys(world.places).filter((p) => placeKey(own(world.places, p)?.name ?? "") === key);
  return named.length > 0 && !named.some((p) => canSeePlace(reg, world, state, world.pov, p));
}
