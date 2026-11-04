// The one name resolver for things (ITEMS-SPEC §5.1): what words stand for, by name, alias or type
// row, the head noun always matching; narrowed by an owner ("Danny's", "my") and a place or holder
// ("on the counter", "in the truck"); ranked nearest first from the actor. Secrecy is marks, never a
// filter: every candidate is weighed, each one the viewer can't see marked, so a hidden thing the
// words name is found rather than made twice, and a caller words the result as the viewer may know
// it. Pure.

import type { EntityId, KindId, PlaceId } from "../shared/ids";
import { nameKey, nameTokens, stem, type NameKey } from "../shared/things";
import { orgTypeOf } from "./org";
import { own } from "./pack-kit";
import { siteOf, together } from "./presence";
import { isGone, kindIs, placeOfEntity, placeWithin } from "./scope";
import { thingIndex, type ThingName } from "./thing-index";
import { holdersOf, holdsOf, isThing, sizeOf, whoseOf, type ThingContext } from "./things";
import { canSeeEntity } from "./visibility";

/** Where a candidate stands from the actor (§5.1), nearest first. */
export const THING_RANKS = ["on", "handed", "loose", "holders", "fixtures", "site", "own", "known"] as const;
export type ThingRank = (typeof THING_RANKS)[number];

/** How far a resolution looks: on the actor (and what was handed over); here; the same site; their own things anywhere; anything. */
export type ThingScope = "on" | "here" | "site" | "own" | "all";
const SCOPE_REACH: Readonly<Record<ThingScope, ThingRank>> = { on: "handed", here: "fixtures", site: "site", own: "own", all: "known" };

export interface ResolveOptions {
  /** Whose words they are: "my" is theirs, and ranks count from them. */
  actor: EntityId;
  /** Whose knowledge marks a candidate secret; "your" is theirs (the player character, in the narration's second person). */
  viewer: EntityId;
  scope?: ThingScope;
  /** What it must be: a kind (by inheritance), or "holder" for anything that holds things. */
  need?: KindId | "holder";
  /** Whose it must be, besides any owner the words name. */
  owner?: EntityId;
  /** Things handed over this turn, ranked after what the actor holds. */
  handed?: readonly EntityId[];
}

/** One thing the words may mean. */
export interface ThingCandidate {
  id: EntityId;
  rank: ThingRank;
  /** Every other word of the name matched too, not only its head noun. */
  full: boolean;
  /** What matched: its own name, an alias, or its type row's name. */
  by: ThingName["by"];
  /** The viewer can't see it. */
  secret: boolean;
}

/** One thing, several (`ambiguous`, each the viewer can't see also in `secret`), or none. */
export type Resolved = { id: EntityId; secret: boolean } | { ambiguous: EntityId[]; secret: EntityId[] } | { none: true };

/** How a name meets the words: on every word ("full"), on the head noun alone ("head"), or not at all (null). */
export function meets(said: NameKey, name: NameKey): "full" | "head" | null {
  if (!name.heads.some((h) => said.heads.includes(h))) return null;
  return said.words.every((w) => said.heads.includes(w) || name.words.includes(w)) ? "full" : "head";
}

/** Whether two names meet on every word of `said`, as stacks and kit pieces compare them. */
export function nameMeets(said: string, name: string): boolean {
  const a = nameKey(said);
  const b = nameKey(name);
  return a !== null && b !== null && meets(a, b) === "full";
}

/** Whether `words` name a thing on every word, by any of its names (a check's test, `has_item`). */
export function namesThing(ctx: ThingContext, id: EntityId, words: string): boolean {
  const said = nameKey(words);
  return said !== null && (thingIndex(ctx).names.get(id) ?? []).some((n) => meets(said, n) === "full");
}

const PRONOUNS: Readonly<Record<string, "actor" | "viewer" | "other">> = { my: "actor", your: "viewer", his: "other", her: "other", their: "other", our: "other", its: "other" };

/** Prepositions that say where a thing is ("on the counter", "in the truck", "at the shop"). */
const WHERE = /\s+(?:in|inside|on|at|from|under|behind|near|beside)\s+(?=\S)/giu;

/** Words a person's name is said without: articles and titles. */
const UNNAMING: Readonly<Record<string, true>> = { the: true, a: true, an: true, mr: true, mrs: true, ms: true, dr: true };

/** The parties (people and organizations) a possessive names: every word said one of their name's ("Marcus" for Marcus Delgado). */
function partiesNamed(ctx: ThingContext, said: string): EntityId[] {
  const words = nameTokens(said).filter((w) => !UNNAMING[w]).map(stem);
  if (words.length === 0) return [];
  return Object.keys(ctx.state.entities)
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id) || !(kindIs(ctx.registry, ctx.world, e.kind, "person") || orgTypeOf(ctx, id) !== null)) return false;
      const theirs = new Set(nameTokens(e.name).map(stem));
      return words.every((w) => theirs.has(w));
    })
    .sort();
}

/** The places a phrase names: one of its head nouns, and every word of the phrase in the place's name. */
function placesNamed(ctx: ThingContext, key: NameKey): PlaceId[] {
  return Object.values(ctx.world.places)
    .filter((p) => {
      const k = nameKey(p.name);
      return k !== null && meets(key, k) === "full";
    })
    .map((p) => p.id)
    .sort();
}

/** Where a thing stands from the actor (§5.1). */
function rankOf(ctx: ThingContext, id: EntityId, actor: EntityId, handed: readonly EntityId[]): ThingRank {
  const holders = holdersOf(ctx.state, id);
  if (holders.includes(actor)) return "on";
  if (handed.includes(id)) return "handed";
  const here = placeOfEntity(ctx.state, actor);
  const at = placeOfEntity(ctx.state, id);
  if (here !== null && at === here) {
    const size = sizeOf(ctx, id).size;
    if (size === "furniture" || size === "builtin" || size === "part") return "fixtures";
    return holders.length === 0 ? "loose" : "holders";
  }
  if (here !== null && at !== null && (together(ctx.world, here, at) || siteOf(ctx.world, here) === siteOf(ctx.world, at))) return "site";
  const whose = whoseOf(ctx, id);
  return whose.presumed === undefined && whose.owners.includes(actor) ? "own" : "known";
}

/** The words' owner and place or holder qualifiers, and the name they leave (§5.1). */
interface Said {
  key: NameKey;
  owners: EntityId[] | null;
  within: { places: PlaceId[]; holders: EntityId[] } | null;
}

function parse(ctx: ThingContext, words: string, opts: ResolveOptions, nested: boolean): Said | null {
  let text = words.trim();
  let owners: EntityId[] | null = null;
  // An owner the words name first: a pronoun, or a name with an apostrophe ("Marcus's", "the Kowalczyks'").
  const pronoun = /^(\p{L}+)\s+(?=\S)/u.exec(text);
  const who = pronoun ? PRONOUNS[(pronoun[1] ?? "").toLowerCase()] : undefined;
  if (pronoun && who !== undefined) {
    if (who !== "other") owners = [who === "actor" ? opts.actor : opts.viewer];
    text = text.slice(pronoun[0].length);
  } else {
    const possessive = /^(.+?)['’]s?\s+(\S.*)$/su.exec(text);
    const named = possessive ? partiesNamed(ctx, possessive[1] ?? "") : [];
    if (possessive && named.length > 0) {
      owners = named;
      text = possessive[2] ?? "";
    }
  }
  // A place or holder the words end on ("the wrench on the bench"): the last one that names something.
  let within: Said["within"] = null;
  const cuts = [...text.matchAll(WHERE)].map((m) => ({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length })).reverse();
  for (const cut of cuts) {
    const phrase = text.slice(cut.end);
    const key = nameKey(phrase);
    if (!key) continue;
    const places = placesNamed(ctx, key);
    const holders = nested ? [] : bestOf(findThings(ctx, phrase, { ...opts, need: "holder", owner: undefined }, true)).map((c) => c.id);
    if (places.length === 0 && holders.length === 0) continue;
    within = { places, holders };
    text = text.slice(0, cut.at);
    break;
  }
  const key = nameKey(text);
  return key ? { key, owners, within } : null;
}

/** The candidates that stand first: full matches before head-only ones, then the nearest. */
function bestOf(candidates: readonly ThingCandidate[]): ThingCandidate[] {
  const first = candidates[0];
  return first ? candidates.filter((c) => c.full === first.full && c.rank === first.rank) : [];
}

/**
 * Every thing the words may mean (§5.1), best first: full matches before head-only ones, then by
 * rank from the actor, then by id. Gone things never; hidden ones always, marked. `nested` reads a
 * holder the words end on, which names no further holder of its own.
 */
export function findThings(ctx: ThingContext, words: string, opts: ResolveOptions, nested = false): ThingCandidate[] {
  const said = parse(ctx, words, opts, nested);
  if (!said) return [];
  const index = thingIndex(ctx);
  const ids = new Set<EntityId>();
  for (const head of said.key.heads) for (const id of index.heads.get(head) ?? []) ids.add(id);
  const reach = THING_RANKS.indexOf(SCOPE_REACH[opts.scope ?? "all"]);
  const out: ThingCandidate[] = [];
  for (const id of [...ids].sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || isGone(ctx.state, id)) continue;
    if (opts.need !== undefined && (opts.need === "holder" ? holdsOf(ctx, id) === null : !kindIs(ctx.registry, ctx.world, e.kind, opts.need))) continue;
    let match: { full: boolean; by: ThingName["by"] } | null = null;
    for (const name of index.names.get(id) ?? []) {
      const m = meets(said.key, name);
      if (m !== null && (match === null || (m === "full" && !match.full))) match = { full: m === "full", by: name.by };
    }
    if (!match) continue;
    if (said.owners || opts.owner !== undefined) {
      const whose = whoseOf(ctx, id).owners;
      if (said.owners && !said.owners.some((o) => whose.includes(o))) continue;
      if (opts.owner !== undefined && !whose.includes(opts.owner)) continue;
    }
    if (said.within) {
      const at = placeOfEntity(ctx.state, id);
      const holders = holdersOf(ctx.state, id);
      if (!said.within.places.some((p) => at !== null && placeWithin(ctx.world, at, p)) && !said.within.holders.some((h) => holders.includes(h))) continue;
    }
    const rank = rankOf(ctx, id, opts.actor, opts.handed ?? []);
    if (THING_RANKS.indexOf(rank) > reach) continue;
    out.push({ id, rank, full: match.full, by: match.by, secret: !canSeeEntity(ctx.registry, ctx.world, ctx.state, opts.viewer, id) });
  }
  return out.sort((a, b) => Number(b.full) - Number(a.full) || THING_RANKS.indexOf(a.rank) - THING_RANKS.indexOf(b.rank) || a.id.localeCompare(b.id));
}

/**
 * What the words (or an id) stand for (§5.1): the one thing that stands first, every thing that
 * stands first together when several do, or none. An id names that thing whatever the words would.
 */
export function resolveThing(ctx: ThingContext, wordsOrId: string, opts: ResolveOptions): Resolved {
  if (own(ctx.state.entities, wordsOrId) && isThing(ctx, wordsOrId) && !isGone(ctx.state, wordsOrId)) return { id: wordsOrId, secret: !canSeeEntity(ctx.registry, ctx.world, ctx.state, opts.viewer, wordsOrId) };
  const best = bestOf(findThings(ctx, wordsOrId, opts));
  const only = best.length === 1 ? best[0] : undefined;
  if (only) return { id: only.id, secret: only.secret };
  if (best.length === 0) return { none: true };
  return { ambiguous: best.map((c) => c.id), secret: best.filter((c) => c.secret).map((c) => c.id) };
}
