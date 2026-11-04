// Things (ITEMS-SPEC §3, §4): the size ladder and traits; the facts a thing keeps about how it came
// to be had (`got`) and made (`made`); the handover, grant and access bases; where a thing is or
// rests (`Spot`, `Rest`); the op vocabulary every writer of things speaks (`ItemOp`, `PlaceOp`) and
// its shape check; the world's things config (`packs.gear.config`) as the engine reads it, each part
// the world leaves out or gets wrong reading as its shipped default; and how a thing's name is
// compared (`nameKey`, `stem`). The engine's readers and writers of things are `engine/things.ts`,
// `thing-index.ts`, `thing-resolve.ts`, `thing-ops.ts` and `access.ts`. Pure.

import type { EntityId, Level, PlaceId } from "./ids";
import { hasOwn, isRecord, safeKey } from "./json";
import { selectorOrNull } from "./minds";
import { isAudience, type Audience } from "./org";
import type { Selector, WorldDoc } from "./world";

// ---------------------------------------------------------------- sizes and traits

/** The size ladder (ITEMS-SPEC §3.2, a fixed value), smallest first. */
export const SIZES = ["pocket", "hand", "armful", "heavy", "furniture", "builtin"] as const;
export type Size = (typeof SIZES)[number];

export const SIZE_LABELS: Readonly<Record<Size, string>> = { pocket: "Pocket", hand: "Hand", armful: "Armful", heavy: "Heavy", furniture: "Furniture", builtin: "Built-in" };

export function isSize(v: unknown): v is Size {
  return typeof v === "string" && (SIZES as readonly string[]).includes(v);
}

/** A size's place on the ladder, 0 for Pocket. */
export function sizeRank(size: Size): number {
  return SIZES.indexOf(size);
}

/**
 * What a thing's size reads as (§4.1): a size of the ladder; `part`, built into its holder, moving
 * with it and never taken out (a glovebox, a truck bed); `vehicle`, held as Furniture and only by
 * another vehicle; or `unknown`, portable for a move the story states.
 */
export type SizeClass = Size | "part" | "vehicle" | "unknown";

/** Where an inferred size came from, first answer first (§4.1). */
export type SizeFrom = "size" | "fixed" | "part" | "vehicle" | "row" | "location" | "volume" | "category" | "unknown";

/** The sizes the volume bounds part (upper bounds in litres); anything larger is Furniture. */
export const VOLUME_SIZES = ["pocket", "hand", "armful", "heavy"] as const;
export type VolumeSize = (typeof VOLUME_SIZES)[number];

// ---------------------------------------------------------------- the facts kept

/** Why someone has a thing (§3.3), as each change of possession writes it in `got`. */
export const GOT_HOWS = ["bought", "given", "holding", "loan", "found", "took", "fetched", "put_away", "made"] as const;
export type GotHow = (typeof GOT_HOWS)[number];

/** `got`: how its possessor came to have it, from whom, when (game minutes), and the story's why. */
export interface Got {
  how: GotHow;
  from?: EntityId;
  at: number;
  why?: string;
}

/** Where a thing is: lying at a place, or in a holder (a person, a container, a vehicle). */
export type Spot = { place: PlaceId } | { in: EntityId };

/** Where a thing rests when nobody is using it (`home`): a spot, or on its owner. */
export type Rest = Spot | "owner";

/** `made`: a thing made in play, who made it (the writer: `story`, `curator`, `gm`, or the person) and where. */
export interface Made {
  by: string;
  at: Spot;
}

export function isSpot(v: unknown): v is Spot {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && ((keys[0] === "place" && typeof v.place === "string" && v.place !== "") || (keys[0] === "in" && typeof v.in === "string" && v.in !== ""));
}

/** A `got` as stored, or null when it isn't one. */
export function gotOf(v: unknown): Got | null {
  if (!isRecord(v) || !(GOT_HOWS as readonly unknown[]).includes(v.how) || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  return { how: v.how as GotHow, at: v.at, ...(typeof v.from === "string" && v.from !== "" ? { from: v.from } : {}), ...(typeof v.why === "string" && v.why !== "" ? { why: v.why } : {}) };
}

/** A `made` as stored, or null when it isn't one. */
export function madeOf(v: unknown): Made | null {
  return isRecord(v) && typeof v.by === "string" && isSpot(v.at) ? { by: v.by, at: v.at } : null;
}

// ---------------------------------------------------------------- bases

/** What a handover means (§4.6, a fixed value). Only gift, sale and trade change the owner. */
export const HANDOVER_BASES = ["hold", "loan", "return", "gift", "sale", "trade", "theft"] as const;
export type HandoverBasis = (typeof HANDOVER_BASES)[number];

/** What a use grant (`uses`) rests on (§3.5, a fixed value). */
export const GRANT_BASES = ["hold", "loan", "assign"] as const;
export type GrantBasis = (typeof GRANT_BASES)[number];

/** Why someone may use or dispose of a thing (§3.4, a fixed value). */
export const ACCESS_BASES = ["owner", "member", "position", "delegate", "grant", "permit", "household", "housemate", "partner", "family", "staff", "customer", "public"] as const;
export type AccessBasis = (typeof ACCESS_BASES)[number];

/** How far a `permits` reaches: all the permitter's things, or those at their home. */
export const PERMIT_SCOPES = ["all", "home"] as const;
export type PermitScope = (typeof PERMIT_SCOPES)[number];

/** The longest name a thing is given in play, as a GM's spawn bounds one. */
export const THING_NAME_MAX = 80;

/** A use grant's basis as stored: its own, else (a link from before bases) a loan when it has an end, else an assignment. */
export function grantBasisOf(fields: Readonly<Record<string, unknown>> | undefined, until: number | undefined): GrantBasis {
  const basis = fields?.basis;
  if ((GRANT_BASES as readonly unknown[]).includes(basis)) return basis as GrantBasis;
  return until !== undefined ? "loan" : "assign";
}

// ---------------------------------------------------------------- ops

/** A place made in play (§6.2): a room inside a building or home, a spot (a part of a place), or a new venue. */
export const PLACE_KINDS = ["room", "spot", "venue"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/**
 * One change to a thing (§3.5, a fixed format), the one vocabulary the reply's read, the Curator,
 * GM edits, actions and MCP all compile to. `why` is the story's reason, told with the change.
 */
export type ItemOp =
  | { do: "make"; name: string; type?: string; size?: Size; at: Spot; owner?: EntityId; home?: Rest; qty?: number; aliases?: string[]; hidden?: boolean; why: string }
  | { do: "move"; item: EntityId; to: Spot; why: string }
  | { do: "hand"; item: EntityId; to: EntityId; basis: HandoverBasis; until?: number; why: string }
  | { do: "own"; item: EntityId; owner: EntityId | null; why: string }
  | { do: "grant" | "revoke"; item: EntityId; who: EntityId; basis?: GrantBasis; until?: number; by?: EntityId }
  | { do: "permit" | "unpermit"; from: EntityId; to: EntityId; scope?: PermitScope; until?: number; by?: EntityId }
  | { do: "home"; item: EntityId; home: Rest | null }
  | { do: "use"; item: EntityId; qty?: number }
  | { do: "wear"; item: EntityId; who: EntityId; off?: boolean }
  | { do: "condition"; item: EntityId; delta: number }
  | { do: "lose"; item: EntityId; by?: EntityId }
  | { do: "label"; item: EntityId; name?: string; aliases?: string[]; description?: string; size?: Size }
  | { do: "merge"; keep: EntityId; drop: EntityId }
  | { do: "remove"; item: EntityId; why: string };

/** One change to a place made in play (§3.5, a fixed format). */
export type PlaceOp =
  | { do: "make"; name: string; parent: PlaceId; as: PlaceKind; aliases?: string[]; description?: string; entry?: Audience; why: string }
  | { do: "label"; place: PlaceId; name?: string; aliases?: string[]; description?: string }
  | { do: "remove"; place: PlaceId };

/**
 * The reply's thing facts (§5.2): what the read says happened to a thing, each in the story's words,
 * which the reconciler (`engine/reconcile-things`) settles into item ops.
 */
export const THING_FACTS = ["give", "take", "drop", "put", "has", "owner", "use_up", "wear", "lose", "item_condition"] as const;
export type ThingFact = (typeof THING_FACTS)[number];

export function isThingFact(v: unknown): v is ThingFact {
  return typeof v === "string" && (THING_FACTS as readonly string[]).includes(v);
}

/**
 * What the Curator owns of a reply on an agent chat (ITEMS-SPEC I9, §6.4): the thing facts, a
 * purchase's goods, a walk-on person and a place made in play. While it runs, the reply's read
 * proposes none of them; prompt-only, it is classic's read of these alone.
 */
export const CURATOR_FACTS: readonly string[] = [...THING_FACTS, "purchase", "spawn", "place_make"];

/**
 * The change types a thing fact lands under (§5.4, a fixed value), each with its own mode: a move
 * (take, drop, put, has, fetch), a handover that keeps the owner (hold, loan, return), a change of
 * owner (gift, sale, trade, owner), a thing made, used up, worn, worn down or mended, or lost.
 */
export const ITEM_CHANGES = ["item_move", "item_hand", "item_own", "item_make", "item_use", "item_wear", "item_condition", "item_lose"] as const;
export type ItemChange = (typeof ITEM_CHANGES)[number];

export function isItemChange(v: unknown): v is ItemChange {
  return typeof v === "string" && (ITEM_CHANGES as readonly string[]).includes(v);
}

/**
 * The change type each thing fact had before it was settled (§5.4 pins carry over): a pin or a
 * learning window kept under the old name is the new type's.
 */
export const FACT_CHANGE: Readonly<Partial<Record<string, ItemChange>>> = { take: "item_move", drop: "item_move", give: "item_hand", use_up: "item_use", wear: "item_wear", lose: "item_lose" };

const id = (v: unknown): v is string => typeof v === "string" && v !== "" && safeKey(v);
const text = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optional = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || ok(v);

/** A rest as written: a spot, or "owner". */
export function isRest(v: unknown): v is Rest {
  return v === "owner" || isSpot(v);
}

/**
 * An item op from outside data (a request, a tool's arguments, a recorded edit), checked for shape:
 * null when it isn't one. What it names is checked when it resolves (`engine/thing-ops`).
 */
export function parseItemOp(o: unknown): ItemOp | null {
  if (!isRecord(o)) return null;
  switch (o.do) {
    case "make": {
      if (!text(o.name) || !isSpot(o.at) || !text(o.why) || !optional(o.type, id) || !optional(o.size, isSize) || !optional(o.owner, id) || !optional(o.home, isRest) || !optional(o.qty, finite) || !optional(o.aliases, strings) || !optional(o.hidden, (v) => typeof v === "boolean")) return null;
      return { do: "make", name: o.name, at: o.at, why: o.why, ...(id(o.type) ? { type: o.type } : {}), ...(isSize(o.size) ? { size: o.size } : {}), ...(id(o.owner) ? { owner: o.owner } : {}), ...(isRest(o.home) ? { home: o.home } : {}), ...(finite(o.qty) ? { qty: o.qty } : {}), ...(strings(o.aliases) ? { aliases: o.aliases } : {}), ...(o.hidden === true ? { hidden: true } : {}) };
    }
    case "move":
      return id(o.item) && isSpot(o.to) && text(o.why) ? { do: "move", item: o.item, to: o.to, why: o.why } : null;
    case "hand":
      if (!id(o.item) || !id(o.to) || !(HANDOVER_BASES as readonly unknown[]).includes(o.basis) || !text(o.why) || !optional(o.until, finite)) return null;
      return { do: "hand", item: o.item, to: o.to, basis: o.basis as HandoverBasis, why: o.why, ...(finite(o.until) ? { until: o.until } : {}) };
    case "own":
      return id(o.item) && (o.owner === null || id(o.owner)) && text(o.why) ? { do: "own", item: o.item, owner: o.owner, why: o.why } : null;
    case "grant":
    case "revoke":
      if (!id(o.item) || !id(o.who) || !optional(o.basis, (v) => (GRANT_BASES as readonly unknown[]).includes(v)) || !optional(o.until, finite) || !optional(o.by, id)) return null;
      return { do: o.do, item: o.item, who: o.who, ...(o.basis !== undefined ? { basis: o.basis as GrantBasis } : {}), ...(finite(o.until) ? { until: o.until } : {}), ...(id(o.by) ? { by: o.by } : {}) };
    case "permit":
    case "unpermit":
      if (!id(o.from) || !id(o.to) || !optional(o.scope, (v) => (PERMIT_SCOPES as readonly unknown[]).includes(v)) || !optional(o.until, finite) || !optional(o.by, id)) return null;
      return { do: o.do, from: o.from, to: o.to, ...(o.scope !== undefined ? { scope: o.scope as PermitScope } : {}), ...(finite(o.until) ? { until: o.until } : {}), ...(id(o.by) ? { by: o.by } : {}) };
    case "home":
      return id(o.item) && (o.home === null || isRest(o.home)) ? { do: "home", item: o.item, home: o.home } : null;
    case "use":
      return id(o.item) && optional(o.qty, finite) ? { do: "use", item: o.item, ...(finite(o.qty) ? { qty: o.qty } : {}) } : null;
    case "wear":
      return id(o.item) && id(o.who) && optional(o.off, (v) => typeof v === "boolean") ? { do: "wear", item: o.item, who: o.who, ...(o.off === true ? { off: true } : {}) } : null;
    case "condition":
      return id(o.item) && finite(o.delta) ? { do: "condition", item: o.item, delta: o.delta } : null;
    case "lose":
      return id(o.item) && optional(o.by, id) ? { do: "lose", item: o.item, ...(id(o.by) ? { by: o.by } : {}) } : null;
    case "label":
      if (!id(o.item) || !optional(o.name, text) || !optional(o.aliases, strings) || !optional(o.description, text) || !optional(o.size, isSize)) return null;
      return { do: "label", item: o.item, ...(text(o.name) ? { name: o.name } : {}), ...(strings(o.aliases) ? { aliases: o.aliases } : {}), ...(text(o.description) ? { description: o.description } : {}), ...(isSize(o.size) ? { size: o.size } : {}) };
    case "merge":
      return id(o.keep) && id(o.drop) ? { do: "merge", keep: o.keep, drop: o.drop } : null;
    case "remove":
      return id(o.item) && text(o.why) ? { do: "remove", item: o.item, why: o.why } : null;
    default:
      return null;
  }
}

/** A place op from outside data, checked for shape as `parseItemOp` checks an item op. */
export function parsePlaceOp(o: unknown): PlaceOp | null {
  if (!isRecord(o)) return null;
  switch (o.do) {
    case "make":
      if (!text(o.name) || !id(o.parent) || !(PLACE_KINDS as readonly unknown[]).includes(o.as) || !text(o.why) || !optional(o.aliases, strings) || !optional(o.description, text) || !optional(o.entry, isAudience)) return null;
      return { do: "make", name: o.name, parent: o.parent, as: o.as as PlaceKind, why: o.why, ...(strings(o.aliases) ? { aliases: o.aliases } : {}), ...(text(o.description) ? { description: o.description } : {}), ...(isAudience(o.entry) ? { entry: o.entry } : {}) };
    case "label":
      if (!id(o.place) || !optional(o.name, text) || !optional(o.aliases, strings) || !optional(o.description, text)) return null;
      return { do: "label", place: o.place, ...(text(o.name) ? { name: o.name } : {}), ...(strings(o.aliases) ? { aliases: o.aliases } : {}), ...(text(o.description) ? { description: o.description } : {}) };
    case "remove":
      return id(o.place) ? { do: "remove", place: o.place } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the world's things config

/** The implied access rules a world switches on or off (§3.4). */
export const IMPLIED_RULES = ["household", "housemates", "partners", "family", "staff", "customers"] as const;
export type ImpliedRule = (typeof IMPLIED_RULES)[number];

/**
 * Everyday carry (§4.4): who carries which catalog types from the start, each made the first time
 * such a person is observed (the gear pack's generator 2), unless they have one of the type already.
 */
export interface CarryRule {
  who: Selector;
  types: string[];
}

/** `packs.gear.config` as the engine plays it (§3.5, §11). */
export interface ThingsConfig {
  sizes: {
    /** The largest thing a person carries. */
    ceiling: Size;
    /** A category's size, for a thing nothing else sizes. */
    byCategory: Readonly<Record<string, Size>>;
    /** Upper bounds in litres; above the last, Furniture. */
    byVolume: Readonly<Record<VolumeSize, number>>;
  };
  access: Readonly<Record<ImpliedRule, boolean>>;
  carry: readonly CarryRule[];
  /** How many minutes on foot a fetch reaches. */
  fetchMinutes: number;
  /** The put-away process: on, after how many hours untouched, from which Gear level. */
  putAway: { on: boolean; hours: number; minLevel: Level };
  /** Tidy impossible holds automatically. */
  tidy: { auto: boolean };
  /** How many lines of the Gear section tell the player character's own things that aren't with them ("Not with you", §5.5). */
  notWithYou: number;
}

/** The Modern US categories' sizes (both catalogs' category ids), for a thing its row doesn't size; a service category sizes nothing. */
const MODERN_US_CATEGORY_SIZES: Readonly<Record<string, Size>> = {
  carried: "pocket",
  clothing: "hand",
  household: "hand",
  tool: "hand",
  recreation: "armful",
  groceries_staples: "hand",
  groceries_baskets: "armful",
  meals_out: "hand",
  coffee: "hand",
  alcohol: "hand",
  electronics: "hand",
  tools_hardware: "hand",
  household_goods: "hand",
  personal_care: "hand",
  medical: "hand",
  entertainment: "hand",
  gifts: "hand",
  home_furnishings: "furniture",
};

export const DEFAULT_THINGS_CONFIG: Readonly<ThingsConfig> = Object.freeze<ThingsConfig>({
  sizes: { ceiling: "armful", byCategory: MODERN_US_CATEGORY_SIZES, byVolume: { pocket: 0.5, hand: 5, armful: 40, heavy: 400 } },
  access: { household: true, housemates: true, partners: true, family: false, staff: true, customers: true },
  carry: [{ who: { kind: ["person"] }, types: ["wallet", "keys_set", "smartphone"] }],
  fetchMinutes: 3,
  putAway: { on: true, hours: 24, minLevel: 3 },
  tidy: { auto: true },
  notWithYou: 3,
});

const obj = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const atLeast = (v: unknown, floor: number, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= floor ? v : fallback);

/**
 * A world's things config as the engine reads it (`packs.gear.config`): every part it leaves out,
 * or gets wrong, reads as the default, as `worldMindsOf` reads minds. A category the world sizes
 * wins over the default's, and one it sets to null is unsized; volume bounds out of order are put
 * in order; an empty carry list carries nothing.
 */
export function thingsConfigOf(world: Pick<WorldDoc, "packs">): ThingsConfig {
  const raw = obj(hasOwn(world.packs, "gear") ? world.packs.gear?.config : undefined);
  const d = DEFAULT_THINGS_CONFIG;
  const sizes = obj(raw.sizes);
  const byCategory: Record<string, Size> = { ...d.sizes.byCategory };
  for (const [category, size] of Object.entries(obj(sizes.byCategory))) {
    if (!safeKey(category)) continue;
    if (size === null) delete byCategory[category];
    else if (isSize(size)) byCategory[category] = size;
  }
  const volume = obj(sizes.byVolume);
  const byVolume = { ...d.sizes.byVolume };
  let floor = 0;
  for (const size of VOLUME_SIZES) {
    byVolume[size] = Math.max(floor, atLeast(volume[size], Number.MIN_VALUE, d.sizes.byVolume[size]));
    floor = byVolume[size];
  }
  const access = obj(raw.access);
  const carry: CarryRule[] = [];
  for (const rule of Array.isArray(raw.carry) ? raw.carry : []) {
    const who = isRecord(rule) ? selectorOrNull(rule.who) : null;
    const types = isRecord(rule) && strings(rule.types) ? rule.types.filter((t) => t !== "") : [];
    if (who && types.length > 0) carry.push({ who, types });
  }
  const putAway = obj(raw.putAway);
  const minLevel = putAway.minLevel;
  return {
    sizes: { ceiling: isSize(sizes.ceiling) ? sizes.ceiling : d.sizes.ceiling, byCategory, byVolume },
    access: { household: flag(access.household, d.access.household), housemates: flag(access.housemates, d.access.housemates), partners: flag(access.partners, d.access.partners), family: flag(access.family, d.access.family), staff: flag(access.staff, d.access.staff), customers: flag(access.customers, d.access.customers) },
    carry: Array.isArray(raw.carry) ? carry : d.carry,
    fetchMinutes: atLeast(raw.fetchMinutes, 0, d.fetchMinutes),
    putAway: { on: flag(putAway.on, d.putAway.on), hours: atLeast(putAway.hours, Number.MIN_VALUE, d.putAway.hours), minLevel: minLevel === 0 || minLevel === 1 || minLevel === 2 || minLevel === 3 || minLevel === 4 ? minLevel : d.putAway.minLevel },
    tidy: { auto: flag(obj(raw.tidy).auto, d.tidy.auto) },
    notWithYou: typeof raw.notWithYou === "number" && Number.isInteger(raw.notWithYou) && raw.notWithYou >= 0 ? raw.notWithYou : d.notWithYou,
  };
}

/** The size of a thing of `litres` by the bounds: the first size it doesn't exceed, else Furniture. */
export function sizeOfVolume(litres: number, bounds: Readonly<Record<VolumeSize, number>>): Size {
  return VOLUME_SIZES.find((size) => litres <= bounds[size]) ?? "furniture";
}

/** The largest size a holder of `litres` surely takes: the largest whose bound it reaches, Pocket at least. */
export function holdsOfVolume(litres: number, bounds: Readonly<Record<VolumeSize, number>>): Size {
  return VOLUME_SIZES.findLast((size) => litres >= bounds[size]) ?? "pocket";
}

// ---------------------------------------------------------------- names

/**
 * A word's comparison form: lowercase singular, simply ("coffees" coffee, "lunches" lunch,
 * "glasses" glass, "potatoes" potato), with -y and -ie endings made one ("battery" and "batteries",
 * "cookie" and "cookies" compare equal). A hyphenated word keeps its hyphens and stems its last part.
 */
export function stem(word: string): string {
  const parts = word.split("-");
  const w = parts.pop() ?? "";
  let s = w;
  if (w.length > 3 && !/(?:ss|us|is)$/.test(w)) {
    if (w.length > 4 && w.endsWith("ies")) s = `${w.slice(0, -3)}i`;
    else if (/(?:s|x|z|ch|sh)es$/.test(w) || (w.length > 5 && w.endsWith("oes"))) s = w.slice(0, -2);
    else if (w.endsWith("s")) s = w.slice(0, -1);
    if (s.length > 3 && /(?:ie|y)$/.test(s)) s = s.replace(/(?:ie|y)$/, "i");
  }
  return [...parts, s].join("-");
}

/** Words that never name the thing: articles and determiners, and possessive pronouns. */
const DETERMINERS: Readonly<Record<string, true>> = { a: true, an: true, the: true, some: true, any: true, this: true, that: true, these: true, those: true, my: true, your: true, his: true, her: true, their: true, our: true, its: true };

/** Words that start a trailing phrase about where, how or for whom a thing is ("relay in the truck", "sandwich for lunch"). */
const TRAILING: Readonly<Record<string, true>> = { for: true, to: true, from: true, at: true, with: true, in: true, on: true, by: true, per: true, as: true, inside: true, under: true, behind: true, near: true, beside: true, into: true, onto: true };

/** Words naming a collection of what comes before them ("key set", "key ring"): the thing is also what the collection holds. */
const COLLECTIONS: Readonly<Record<string, true>> = { set: true, pair: true, pack: true, packet: true, bunch: true, bundle: true, roll: true, stack: true, ring: true };

/** A thing's name as the resolver compares it: the nouns it is (`heads`) and every word of it, stemmed. */
export interface NameKey {
  heads: string[];
  words: string[];
}

/** Lowercase words without accents or apostrophes; a hyphenated word ("fuel-pump") is one word. */
export function nameTokens(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

/** A word's stem and, for a hyphenated word, its last part's ("fuel-pump" is also a pump). */
function forms(word: string): string[] {
  const s = stem(word);
  const last = word.includes("-") ? stem(word.split("-").at(-1) ?? word) : s;
  return last !== s ? [s, last] : [s];
}

/** The noun a phrase ends in: its last word that isn't a number. */
function lastNoun(words: readonly string[]): string | undefined {
  return words.findLast((w) => /[a-z]/.test(w));
}

/**
 * A name's key (§5.1): case, accents, apostrophes, leading determiners and simple plurals folded.
 * "Noun, qualifier" and "Noun (qualifier)" are the noun, the qualifier's words kept; a trailing phrase
 * ("for lunch", "in the truck") is cut from the noun; "X of Y" is both X and Y ("bottle of wine"); a
 * collection ("key set") is also what it collects. Null when no word names a thing.
 */
export function nameKey(text: string): NameKey | null {
  const lower = text.toLowerCase();
  const cut = lower.search(/[,(]/);
  const base = nameTokens(cut < 0 ? lower : lower.slice(0, cut));
  const qualifier = cut < 0 ? [] : nameTokens(lower.slice(cut + 1));
  let start = 0;
  while (start < base.length && DETERMINERS[base[start] ?? ""]) start++;
  const phrase = base.slice(start);
  const at = phrase.findIndex((w, i) => i > 0 && TRAILING[w] === true);
  const noun = at < 0 ? phrase : phrase.slice(0, at);
  const of = noun.indexOf("of");
  const parts = of > 0 && of < noun.length - 1 ? [noun.slice(0, of), noun.slice(of + 1).filter((w) => !DETERMINERS[w])] : [noun];
  const heads: string[] = [];
  for (const part of parts) {
    const head = lastNoun(part);
    if (head === undefined) continue;
    heads.push(...forms(head));
    const before = part[part.lastIndexOf(head) - 1];
    if (COLLECTIONS[stem(head)] && before !== undefined && /[a-z]/.test(before)) heads.push(...forms(before));
  }
  if (heads.length === 0) return null;
  const words = [...noun, ...qualifier].filter((w) => w !== "of" && !DETERMINERS[w]).flatMap(forms);
  return { heads: [...new Set(heads)], words: [...new Set(words)] };
}
