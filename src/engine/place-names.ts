// Places as a reply's read names them (DESIGN §9.4): the places `extract` is offered, and the one
// place a name it gives back stands for. Only places the player character can see are offered or
// found by name, so neither tells of a place it may not know. A world can hold hundreds of places,
// so the menu leads with the places the reply and the player's message name, then where the player
// character is and the places holding it, then where the people the read is shown are, then the
// rest, nearest first along the place tree.

import type { PlaceId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { nameKey, type NameKey } from "../shared/things";
import type { PlaceDef, WorldDoc } from "../shared/world";
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

/** A place's other names (`fields.aliases`): a place made in play keeps the story's, and an author may give any place some. */
export function placeAliases(def: PlaceDef): string[] {
  const aliases = def.fields.aliases;
  return Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
}

/**
 * Whether words name a place by its head noun, as a thing's name is matched (ITEMS-SPEC §5.1): a
 * noun they end in is one the name ends in, and every word they say is one of the name's ("the
 * booth" names "the back booth"; "the back room" doesn't).
 */
export function headSays(said: NameKey, name: string): boolean {
  const key = nameKey(name);
  return key !== null && said.heads.some((h) => key.heads.includes(h)) && said.words.every((w) => key.words.includes(w));
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
 * that name or an alias (`placeKey`), else by its head noun (`headSays`: "the booth" for "the back
 * booth"), the nearest to the POV's place when several answer. Null when none does, or when the
 * nearest two are as near as each other.
 */
export function placeSaid(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, said: string): PlaceId | null {
  const t = said.trim();
  if (t === "") return null;
  if (hasOwn(world.places, t)) return t;
  if (hasOwn(world.places, t.toLowerCase())) return t.toLowerCase();
  const key = placeKey(t);
  if (key === "") return null;
  const seen = namedPlaces(reg, world, state);
  const named = seen.filter((id) => {
    const def = own(world.places, id);
    return def !== undefined && (placeKey(def.name) === key || placeAliases(def).some((a) => placeKey(a) === key));
  });
  const head = named.length > 0 ? null : nameKey(t);
  const matches = head === null ? named : seen.filter((id) => {
    const def = own(world.places, id);
    return def !== undefined && [def.name, ...placeAliases(def)].some((n) => headSays(head, n));
  });
  if (matches.length <= 1) return matches[0] ?? null;
  const here = placeOfEntity(state, world.pov);
  if (here === null) return null;
  const [first, second] = matches.map((id) => ({ id, d: placeDistance(world, here, id) })).sort((a, b) => a.d - b.d);
  return first && second && first.d < second.d ? first.id : null;
}
