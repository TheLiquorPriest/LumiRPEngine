// Places made in play (ITEMS-SPEC §6.2, I10): a room inside a building or a home, a spot that is a
// part of a place ("the back booth"), or a venue new in town, made when the story puts someone or
// something where the world has nothing that fits. They live in the space pack's slice
// (`packs.space.places`), each written whole by a `space.place` event, and every reader sees them
// through `playedWorld`, which overlays them on the world's places wherever a world meets a state:
// a read context (`registry.context`, the fold's included), a `Working`, and the journal's views and
// read contexts (`LedgerCore.playedAt`). The world's own places win any collision, so a made place
// kept into the world under its own id becomes the world's. A made place is found first, by name
// or alias under the same parent; its id is a slug and a digest, as a spawned person's is. It is as
// visible as the place it is in. Pure.

import { hashParts } from "../shared/hash";
import type { EntityId, PlaceId } from "../shared/ids";
import { hasOwn, isRecord, type JsonObject } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { isAudience } from "../shared/org";
import { nameKey, PLACE_KINDS, stem, type PlaceKind, type PlaceOp } from "../shared/things";
import { placeCapsOf, type PlaceDef, type WorldDoc } from "../shared/world";
import { labelOf, own } from "./pack-kit";
import { headSays, placeAliases, placeDistance, placeKey, placeSaid } from "./place-names";
import type { ReadContext, Rejection } from "./registry";
import { placeOfEntity, placeWithin } from "./scope";
import type { WorldState } from "./state";

/** The event that writes a made place whole, or (`gone`) takes it away (ITEMS-SPEC §3.5, a fixed format). */
export const PLACE_EVENT = "space.place";

/** The slice (`packs.space.places`) the made places live in. */
const SLICE = "space";
const KEY = "places";

/** What made a place: room, spot or venue; the writer (the story, the Curator, the GM, a player's fix); when, in game minutes; and the story's why. */
export interface PlaceMade {
  as: PlaceKind;
  by: string;
  at: number;
  why: string;
}

/**
 * A place made in play: a world place (its description, aliases and entry in `fields`, as a world
 * place keeps them) with what made it. Keeping it in the world drops `made` (`keptPlace`); a place
 * that carries `made` is play's, never the world's own.
 */
export interface MadePlace extends PlaceDef {
  parent: PlaceId;
  made: PlaceMade;
}

/** A refused place op; a make that found what it would make names it (`exists`). */
export type PlaceOpRefusal = Rejection & { exists?: PlaceId };

/** A place op's events and the place it made, or why not. */
export type PlaceOpOutcome = { events: LedgerEvent[]; made?: PlaceId } | PlaceOpRefusal;

/** The longest name, or alias, a place made in play takes. */
export const PLACE_NAME_MAX = 60;

/** The most aliases a place made in play keeps. */
const ALIASES_MAX = 8;

const NONE: Readonly<Record<PlaceId, MadePlace>> = Object.freeze({});

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

// ---------------------------------------------------------------- the slice and the overlay

/** The places this chat made, by id, as the slice holds them (never mutated in place: each write replaces the record). */
export function madePlacesOf(state: Readonly<WorldState>): Readonly<Record<PlaceId, MadePlace>> {
  const v = state.packs[SLICE]?.[KEY];
  return isRecord(v) ? (v as unknown as Readonly<Record<PlaceId, MadePlace>>) : NONE;
}

/** The places this chat made, in the order it made them. */
export function madePlaces(state: Readonly<WorldState>): MadePlace[] {
  return Object.values(madePlacesOf(state));
}

/** What made a place, when play made it: null for the world's own. */
export function madeOf(def: PlaceDef | undefined): PlaceMade | null {
  const made: unknown = (def as { made?: unknown } | undefined)?.made;
  return isRecord(made) ? (made as unknown as PlaceMade) : null;
}

/** Whether a place the context's world has is one play made (the world's own place of the same id wins, so it isn't). */
export function isMadePlace(ctx: Pick<ReadContext, "world">, id: PlaceId): boolean {
  return madeOf(own(ctx.world.places, id)) !== null;
}

/** A made place as the world keeps it (GM → Things → Keep in the world): everything but `made`. */
export function keptPlace(place: MadePlace): PlaceDef {
  const kept: PlaceDef & { made?: PlaceMade } = { ...place };
  delete kept.made;
  return kept;
}

/** Each world's own document under it: itself for one as authored, the world it was played over for a played one. */
const BASES = new WeakMap<WorldDoc, WorldDoc>();
/** Each slice's played world over each base (a slice is never mutated in place, so its identity keys it). */
const PLAYED = new WeakMap<object, WeakMap<WorldDoc, WorldDoc>>();

/**
 * The world as authored under `world`: itself, the world a played one was played over, or, for a
 * copy of a played one (`{...world, lore}`), the copy without the places play made, so that a copy
 * never keeps one the state has since changed or taken away.
 */
export function baseWorld(world: WorldDoc): WorldDoc {
  const known = BASES.get(world);
  if (known !== undefined) return known;
  let base = world;
  for (const id in world.places) {
    if (!hasOwn(world.places, id) || madeOf(world.places[id]) === null) continue;
    const places: Record<PlaceId, PlaceDef> = {};
    for (const [key, def] of Object.entries(world.places)) if (madeOf(def) === null) places[key] = def;
    base = { ...world, places };
    BASES.set(base, base);
    break;
  }
  BASES.set(world, base);
  return base;
}

/**
 * The world as this state plays it (ITEMS-SPEC §6.2): the world's own places, then the places the
 * state made that the world has no place of the same id for. The world itself while the state made
 * none, and the same object for the same slice and world, so a reader keyed on the world's identity
 * keeps its memo until a place is made, labelled or taken away. Idempotent: a played world is played
 * again from the world under it.
 */
export function playedWorld(world: WorldDoc, state: Readonly<WorldState>): WorldDoc {
  const base = baseWorld(world);
  const made = madePlacesOf(state);
  if (made === NONE) return base;
  let byBase = PLAYED.get(made);
  const hit = byBase?.get(base);
  if (hit !== undefined) return hit;
  let played = base;
  for (const [id, def] of Object.entries(made)) {
    if (hasOwn(base.places, id)) continue;
    if (played === base) played = { ...base, places: { ...base.places } };
    played.places[id] = def;
  }
  if (played !== base) BASES.set(played, base);
  if (byBase === undefined) {
    byBase = new WeakMap();
    PLAYED.set(made, byBase);
  }
  byBase.set(base, played);
  return played;
}

/** How many places a chat has made: every one its slice holds, kept into the world or not. */
export function placesMade(state: Readonly<WorldState>): number {
  return Object.keys(madePlacesOf(state)).length;
}

// ---------------------------------------------------------------- finding

/** A place found by name (`findPlaces`): how it was found, whose place it is in, and whether play made it. */
export interface PlaceHit {
  id: PlaceId;
  name: string;
  parent: PlaceId | null;
  made: boolean;
  /** By its id, its name, an alias, or its head noun ("the booth" for "the back booth"). */
  matched: "id" | "name" | "alias" | "head";
}

/**
 * The places `words` names, made ones included, secret ones too (a caller words them as its viewer
 * may know them): by id; else by name or alias as `placeKey` compares them, names first; else by
 * head noun (`headSays`), only when one place answers, or one is nearer `near` than any other.
 * `parent` looks only at the places directly in it; `near` puts the nearest first along the place
 * tree. Empty when nothing answers.
 */
export function findPlaces(ctx: Pick<ReadContext, "world">, words: string, opts: { parent?: PlaceId; near?: PlaceId } = {}): PlaceHit[] {
  const world = ctx.world;
  const said = words.trim();
  if (said === "") return [];
  const pool: [PlaceId, PlaceDef][] = Object.entries(world.places).filter(([, def]) => opts.parent === undefined || def.parent === opts.parent);
  const hit = ([id, def]: [PlaceId, PlaceDef], matched: PlaceHit["matched"]): PlaceHit => ({ id, name: def.name, parent: def.parent ?? null, made: madeOf(def) !== null, matched });
  const near = opts.near;
  const distance = (id: PlaceId): number => (near === undefined ? 0 : placeDistance(world, near, id));
  const nearest = (list: [PlaceId, PlaceDef][]): [PlaceId, PlaceDef][] => (near === undefined ? list : [...list].sort((a, b) => distance(a[0]) - distance(b[0])));
  const byId = pool.find(([id]) => id === said || id === said.toLowerCase());
  if (byId) return [hit(byId, "id")];
  const key = placeKey(said);
  if (key === "") return [];
  const named = pool.filter(([, def]) => placeKey(def.name) === key);
  const aliased = pool.filter(([, def]) => placeKey(def.name) !== key && placeAliases(def).some((a) => placeKey(a) === key));
  if (named.length + aliased.length > 0) return [...nearest(named).map((p) => hit(p, "name")), ...nearest(aliased).map((p) => hit(p, "alias"))];
  const head = nameKey(said);
  if (head === null) return [];
  const heads = nearest(pool.filter(([, def]) => [def.name, ...placeAliases(def)].some((n) => headSays(head, n))));
  const [first, second] = heads;
  if (first === undefined) return [];
  return second === undefined || (near !== undefined && distance(first[0]) < distance(second[0])) ? [hit(first, "head")] : [];
}

// ---------------------------------------------------------------- making

/** Tags of a place that holds other places, as a town holds its venues: what is made in it is a venue. */
const AREA_TAGS: Readonly<Record<string, true>> = { region: true, county: true, town: true, city: true, village: true, district: true, neighborhood: true, neighbourhood: true, road: true, street: true, island: true };

/** Head nouns a room goes by, stemmed as `nameKey` stems them: what else is made inside a place is a spot. */
const ROOM_WORDS: Readonly<Record<string, true>> = Object.fromEntries(
  ["room", "backroom", "kitchen", "bathroom", "bedroom", "office", "hall", "hallway", "corridor", "cellar", "basement", "attic", "garage", "closet", "pantry", "study", "lounge", "den", "loft", "lobby", "storeroom", "stockroom", "washroom", "restroom", "toilet", "stairwell", "landing", "nursery", "library", "parlor", "parlour", "workshop", "laundry"].map((w) => [stem(w), true] as const),
);

/**
 * What a place made in `parent` is when the story doesn't say (ITEMS-SPEC §6.2): a venue in a place
 * that holds others (a town, a region, a street, or a place in nothing), a room when its name says
 * one, else a spot (a part of the place: "the back booth").
 */
export function placeKindFor(world: Pick<WorldDoc, "places">, parent: PlaceId, name: string): PlaceKind {
  const def = own(world.places, parent);
  const tags = Array.isArray(def?.fields.tags) ? def.fields.tags : [];
  if (def === undefined || def.parent === undefined || tags.some((t) => typeof t === "string" && AREA_TAGS[t.toLowerCase()] === true)) return "venue";
  return nameKey(name)?.heads.some((h) => ROOM_WORDS[h] === true) === true ? "room" : "spot";
}

/**
 * A name as a place made in play keeps it: trimmed, one space between words, its first letter a
 * capital, as the world's places are named ("the back booth" is "The back booth"); null when it says
 * nothing or runs past `PLACE_NAME_MAX`.
 */
function cleanName(text: string): string | null {
  const name = text.trim().replace(/\s+/g, " ");
  return name !== "" && name.length <= PLACE_NAME_MAX && placeKey(name) !== "" ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : null;
}

/** The aliases a made place keeps: each a clean name, none its own name or another's twin, at most `ALIASES_MAX`. */
function cleanAliases(name: string, aliases: readonly string[]): string[] {
  const keys = new Set([placeKey(name)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = cleanName(raw);
    if (alias === null || keys.has(placeKey(alias)) || out.length >= ALIASES_MAX) continue;
    keys.add(placeKey(alias));
    out.push(alias);
  }
  return out;
}

/** A name's slug for an id: lower case letters and digits, `_` between, at most 40. */
export function slug(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s !== "" ? s : "place";
}

/**
 * The id a new place gets: its name's slug and a digest of the writer's salt, the place it is in,
 * its name and how many places the chat made before it. Never the name alone, so it isn't an id an
 * author would write; the same on a re-read of the same reply after the same story, and kept in the
 * `space.place` event, so replays and swipes fold alike.
 */
function madeId(ctx: Pick<ReadContext, "world" | "state">, name: string, parent: PlaceId, salt: string): PlaceId {
  const base = `place_${slug(name)}_${hashParts("lre.place", salt, parent, name, String(placesMade(ctx.state))).slice(0, 8)}`;
  let id = base;
  for (let n = 2; hasOwn(ctx.world.places, id) || hasOwn(madePlacesOf(ctx.state), id); n++) id = `${base}_${n}`;
  return id;
}

/** The writer of a place op: who made it (`made.by`) and the salt its id is drawn with. */
export interface PlaceOpOptions {
  by: string;
  salt: string;
}

/**
 * One change to a place made in play (ITEMS-SPEC §3.5 `PlaceOp`, the space pack's `space.place_op`):
 * its events, the place it made, or why not.
 *  - `make` finds first: a place under the same parent by the name or one of the aliases (`findPlaces`)
 *    refuses as `exists`, naming it. Past the world's per-chat cap (`placeCapsOf`) it refuses too.
 *  - `label` renames a made place or sets its aliases or description; another place under the same
 *    parent by the new name refuses as `exists`.
 *  - `remove` takes away a made place nobody and nothing is in, with no place in it.
 * The world's own places are Build's: a label or remove of one refuses.
 */
export function placeOp(ctx: ReadContext, op: PlaceOp, opts: PlaceOpOptions): PlaceOpOutcome {
  switch (op.do) {
    case "make":
      return makePlace(ctx, op, opts);
    case "label":
      return labelPlace(ctx, op);
    case "remove":
      return removePlace(ctx, op.place);
  }
}

function makePlace(ctx: ReadContext, op: Extract<PlaceOp, { do: "make" }>, opts: PlaceOpOptions): PlaceOpOutcome {
  const name = cleanName(op.name);
  if (name === null) return reject("bad_name", `a new place needs a name of at most ${PLACE_NAME_MAX} characters`);
  if (!hasOwn(ctx.world.places, op.parent)) return reject("missing_place", `no place ${labelOf(ctx, op.parent)}`);
  const aliases = cleanAliases(name, op.aliases ?? []);
  for (const said of [name, ...aliases]) {
    const found = findPlaces(ctx, said, { parent: op.parent })[0];
    if (found) return { ...reject("exists", `${found.name} is there already`), exists: found.id };
  }
  const cap = placeCapsOf(ctx.world).chat;
  if (placesMade(ctx.state) >= cap) return reject("place_cap", cap === 0 ? "this world makes no places in play" : `this chat has made ${cap} places already, all its world allows`);
  const id = madeId(ctx, name, op.parent, opts.salt);
  const description = op.description?.trim() ?? "";
  const fields: JsonObject = { ...(description !== "" ? { description } : {}), ...(aliases.length > 0 ? { aliases } : {}), ...(op.entry !== undefined && isAudience(op.entry) ? { entry: op.entry } : {}) };
  const def: MadePlace = { id, name, parent: op.parent, fields, made: { as: op.as, by: opts.by, at: ctx.state.clock, why: op.why.trim() } };
  return { events: [placeEvent(id, def)], made: id };
}

function labelPlace(ctx: ReadContext, op: Extract<PlaceOp, { do: "label" }>): PlaceOpOutcome {
  const def = own(ctx.world.places, op.place);
  if (!def) return reject("missing_place", `no place ${labelOf(ctx, op.place)}`);
  if (madeOf(def) === null) return reject("not_made", `${def.name} is the world's own place: Build changes it`);
  const made = def as MadePlace;
  const name = op.name === undefined ? made.name : cleanName(op.name);
  if (name === null) return reject("bad_name", `a place needs a name of at most ${PLACE_NAME_MAX} characters`);
  const aliases = op.aliases === undefined ? placeAliases(made) : cleanAliases(name, op.aliases);
  for (const said of [name, ...aliases]) {
    const found = findPlaces(ctx, said, { parent: made.parent }).find((h) => h.id !== op.place && h.matched !== "head");
    if (found) return { ...reject("exists", `${found.name} is there already`), exists: found.id };
  }
  const description = op.description === undefined ? made.fields.description : op.description.trim();
  const fields: JsonObject = { ...made.fields };
  delete fields.aliases;
  delete fields.description;
  if (typeof description === "string" && description !== "") fields.description = description;
  if (aliases.length > 0) fields.aliases = aliases;
  const next: MadePlace = { ...made, name, fields };
  if (JSON.stringify(next) === JSON.stringify(made)) return reject("no_change", `${made.name} is so already`);
  return { events: [placeEvent(op.place, next)] };
}

function removePlace(ctx: ReadContext, place: PlaceId): PlaceOpOutcome {
  const def = own(ctx.world.places, place);
  if (!def) return reject("gone", `no place ${labelOf(ctx, place)}`);
  if (madeOf(def) === null) return reject("not_made", `${def.name} is the world's own place: Build removes it`);
  if (Object.values(ctx.world.places).some((p) => p.parent === place)) return reject("occupied", `the places in ${def.name} go first`);
  const there = Object.keys(ctx.state.entities).some((id) => placeWithin(ctx.world, placeOfEntity(ctx.state, id), place));
  if (there) return reject("occupied", `someone or something is still at ${def.name}`);
  return { events: [{ type: PLACE_EVENT, data: { place, gone: true } }] };
}

function placeEvent(place: PlaceId, def: MadePlace): LedgerEvent {
  return { type: PLACE_EVENT, data: { place, def: def as unknown as JsonObject } };
}

/** A `space.place` event's place as written (`def`), checked for shape: null when it isn't one. */
export function madePlaceData(v: unknown, place: PlaceId): MadePlace | null {
  if (!isRecord(v) || v.id !== place || typeof v.name !== "string" || cleanName(v.name) === null || typeof v.parent !== "string" || v.parent === "" || !isRecord(v.fields) || !isRecord(v.made)) return null;
  const m = v.made;
  if (!(PLACE_KINDS as readonly unknown[]).includes(m.as) || typeof m.by !== "string" || typeof m.at !== "number" || !Number.isFinite(m.at) || typeof m.why !== "string") return null;
  const aliases = v.fields.aliases;
  if (aliases !== undefined && !(Array.isArray(aliases) && aliases.every((a) => typeof a === "string"))) return null;
  return v as unknown as MadePlace;
}

// ---------------------------------------------------------------- the story's facts

/**
 * A fact that puts someone at a place the world may lack (ITEMS-SPEC §5.2: a `location` with a
 * `parent`, or the Curator's `place_make`), as it settles against the state now: the place is there
 * (a move), or it is to be made (`op`), or why neither.
 */
export type PlaceFact = { kind: "found"; place: PlaceId } | { kind: "make"; op: Extract<PlaceOp, { do: "make" }> } | { kind: "refused"; rejection: Rejection };

/** The place a fact's `parent` names: by id, any; else by name, one the POV can see (`placeSaid`), as the read is offered places. */
export function parentSaid(ctx: ReadContext, said: string): PlaceId | null {
  const t = said.trim();
  if (t === "") return null;
  if (hasOwn(ctx.world.places, t)) return t;
  if (hasOwn(ctx.world.places, t.toLowerCase())) return t.toLowerCase();
  return placeSaid(ctx.registry, ctx.world, ctx.state, t);
}

/**
 * How a place fact (`{place, parent, as?, aliases?, description?, why?}`) settles (§6.2): the place
 * its words name under the parent, a hidden one included (the story found it), is there; else one
 * is made, a room, a spot or a venue as the fact says or `placeKindFor` reads it. A place the fact
 * names by id is there wherever it is. A fact without a parent the POV can see, or a name, refuses.
 */
export function settlePlaceFact(ctx: ReadContext, p: JsonObject): PlaceFact {
  const said = typeof p.place === "string" ? p.place.trim() : "";
  if (said === "") return { kind: "refused", rejection: reject("bad_name", "it names no place") };
  if (hasOwn(ctx.world.places, said)) return { kind: "found", place: said };
  const parent = parentSaid(ctx, typeof p.parent === "string" ? p.parent : "");
  if (parent === null) return { kind: "refused", rejection: reject("missing_place", "it names no place it is in") };
  const found = findPlaces(ctx, said, { parent })[0];
  if (found) return { kind: "found", place: found.id };
  const name = cleanName(said);
  if (name === null) return { kind: "refused", rejection: reject("bad_name", `a new place needs a name of at most ${PLACE_NAME_MAX} characters`) };
  const as = (PLACE_KINDS as readonly unknown[]).includes(p.as) ? (p.as as PlaceKind) : placeKindFor(ctx.world, parent, name);
  const aliases = Array.isArray(p.aliases) ? p.aliases.filter((a): a is string => typeof a === "string") : [];
  const description = typeof p.description === "string" ? p.description : "";
  const why = typeof p.why === "string" ? p.why : "";
  return { kind: "make", op: { do: "make", name, parent, as, why, ...(aliases.length > 0 ? { aliases } : {}), ...(description.trim() !== "" ? { description } : {}) } };
}

/** Who a place fact puts at the place: its `entity`, or no one (a place made for something to be put in later). */
export function placeFactEntity(p: JsonObject): EntityId | null {
  return typeof p.entity === "string" && p.entity.trim() !== "" ? p.entity.trim() : null;
}
