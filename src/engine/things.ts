// What the engine reads of a thing (ITEMS-SPEC §3.3, §4): its size and what a holder takes (§4.1),
// where it is and who has it, whose it is, stated or presumed (§4.2), and where it rests (§4.3).
// Everything here is read when asked and never written: inference is a reading, so a recorded state
// reads the same as long as the world and the tables it was played on do. Pure.

import { ownersIn } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import { hasOwn, type JsonObject } from "../shared/json";
import type { NameSize, Rest, SizeClass, SizeFrom, Spot } from "../shared/things";
import { gotOf, holdsOfVolume, isRest, isSize, madeOf, nameSizeOf, sizeOfVolume, sizeRank, thingsConfigOf, type Size } from "../shared/things";
import type { TableRow } from "../shared/tables";
import { businessAt, orgTypeOf } from "./org";
import { own } from "./pack-kit";
import { together } from "./presence";
import { passMemo } from "./read-pass";
import type { ReadContext } from "./registry";
import { isGone, kindIs, placeOfEntity, placeWithin } from "./scope";
import { isMemberOf, selectorMatches } from "./selector";
import { contentsIndex, thingIndex, typeRowOf } from "./thing-index";

/** What the things model reads: the registry, the world and its tables, and the state. */
export type ThingContext = Pick<ReadContext, "registry" | "world" | "state" | "tables">;

/** How far up a chain of holders is followed (a key in a box in a bag in a truck). */
const CHAIN_DEPTH = 32;

/** Whether `id` is a thing: an item, or a kind that extends one (containers, kits, vehicles). */
export function isThing(ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): boolean {
  const e = own(ctx.state.entities, id);
  return !!e && kindIs(ctx.registry, ctx.world, e.kind, "item");
}

const isPerson = (ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): boolean => {
  const e = own(ctx.state.entities, id);
  return !!e && kindIs(ctx.registry, ctx.world, e.kind, "person");
};

// ---------------------------------------------------------------- size

/**
 * A thing's size (§4.1), the first that answers: its own `size`; Built-in when `fixed`; `part` when
 * marked so or its containers row is built into a vehicle; a vehicle; its type row's `size`; a
 * containers row that stands as furniture; its volume against the size bounds; its name, by the
 * world's sizes by name; its category's size; otherwise unknown.
 */
export function sizeOf(ctx: ThingContext, id: EntityId): { size: SizeClass; from: SizeFrom } {
  const e = own(ctx.state.entities, id);
  return e ? sizeOfDef(ctx, e.kind, e.fields, e.name) : { size: "unknown", from: "unknown" };
}

/** The names the size map reads of a thing (§4.1): its own name, its aliases, then its type row's name and aliases. */
export function namesOf(f: Readonly<JsonObject>, name: string | undefined, row: TableRow | undefined): string[] {
  const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((a): a is string => typeof a === "string") : []);
  return [...(name !== undefined ? [name] : []), ...texts(f.aliases), ...(typeof row?.name === "string" ? [row.name] : []), ...texts(row?.aliases)];
}

/** The world's size map entry a thing's names give (`sizes.byName`, §4.1), or null. */
export function nameEntryOf(ctx: Pick<ThingContext, "world" | "tables">, f: Readonly<JsonObject>, name: string | undefined): NameSize | null {
  return nameSizeOf(thingsConfigOf(ctx.world).sizes.byName, namesOf(f, name, typeRowOf(ctx, f)?.row))?.entry ?? null;
}

/** The size a thing of `kind` with these fields and this name has (`sizeOf`), before it is in the world. */
export function sizeOfDef(ctx: Pick<ThingContext, "registry" | "world" | "tables">, kind: string, f: Readonly<JsonObject>, name?: string): { size: SizeClass; from: SizeFrom } {
  if (isSize(f.size)) return { size: f.size, from: "size" };
  if (f.fixed === true) return { size: "builtin", from: "fixed" };
  const type = typeRowOf(ctx, f);
  if (f.part === true || (type?.table === "gear.containers" && type.row.location === "vehicle_fixed")) return { size: "part", from: "part" };
  if (kindIs(ctx.registry, ctx.world, kind, "vehicle")) return { size: "vehicle", from: "vehicle" };
  if (isSize(type?.row.size)) return { size: type.row.size, from: "row" };
  if (type?.table === "gear.containers" && type.row.location === "furniture") return { size: "furniture", from: "location" };
  const config = thingsConfigOf(ctx.world);
  if (typeof f.volume_l === "number" && Number.isFinite(f.volume_l) && f.volume_l > 0) return { size: sizeOfVolume(f.volume_l, config.sizes.byVolume), from: "volume" };
  const named = nameSizeOf(config.sizes.byName, namesOf(f, name, type?.row));
  if (named) return { size: named.entry.size, from: "name" };
  const category = typeof f.category === "string" ? f.category : typeof type?.row.category === "string" ? type.row.category : "";
  if (category !== "" && hasOwn(config.sizes.byCategory, category)) {
    const size = config.sizes.byCategory[category];
    if (size) return { size, from: "category" };
  }
  return { size: "unknown", from: "unknown" };
}

/**
 * The largest size a holder takes (§4.1), or null for what holds nothing: a person, up to the
 * person ceiling; a vehicle, its own `holds`, else Furniture; any other container its own `holds`,
 * else its row's, else its capacity against the size bounds, else Hand; a plain thing its own
 * `holds`, else its row's, else what its name holds by the world's sizes by name (a wardrobe).
 */
export function holdsOf(ctx: ThingContext, holder: EntityId): Size | null {
  const e = own(ctx.state.entities, holder);
  if (!e) return null;
  const config = thingsConfigOf(ctx.world);
  if (kindIs(ctx.registry, ctx.world, e.kind, "person")) return config.sizes.ceiling;
  if (!kindIs(ctx.registry, ctx.world, e.kind, "item")) return null;
  const vehicle = kindIs(ctx.registry, ctx.world, e.kind, "vehicle");
  if (isSize(e.fields.holds)) return e.fields.holds;
  if (vehicle) return "furniture";
  const row = typeRowOf(ctx, e.fields)?.row;
  if (!kindIs(ctx.registry, ctx.world, e.kind, "container")) return isSize(row?.holds) ? row.holds : (nameEntryOf(ctx, e.fields, e.name)?.holds ?? null);
  if (isSize(row?.holds)) return row.holds;
  const capacity = typeof e.fields.capacity_l === "number" ? e.fields.capacity_l : row?.capacity_l;
  return typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0 ? holdsOfVolume(capacity, config.sizes.byVolume) : "hand";
}

// ---------------------------------------------------------------- where it is, who has it

/** What directly holds a thing (`in`), or null. */
export function holderOf(state: ThingContext["state"], id: EntityId): EntityId | null {
  return own(state.entities, id)?.relations.find((r) => r.type === "in")?.to ?? null;
}

/** Things directly in a holder, in id order (the thing index's). */
export function contentsOf(state: ThingContext["state"], holder: EntityId): readonly EntityId[] {
  return contentsIndex(state).contents.get(holder) ?? [];
}

/**
 * Where a thing is (§3.3): lying at a place, or in a holder; null for nowhere (lost, or never
 * placed). A thing with both set (from before one writer kept them apart) is at its place, as
 * `placeOfEntity` reads it.
 */
export function spotOf(state: ThingContext["state"], id: EntityId): Spot | null {
  const e = own(state.entities, id);
  if (!e) return null;
  if (typeof e.fields.place === "string" && e.fields.place !== "") return { place: e.fields.place };
  const holder = holderOf(state, id);
  return holder ? { in: holder } : null;
}

/** The holders a thing is in, nearest first (never itself, never twice). */
export function holdersOf(state: ThingContext["state"], id: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (let cur = holderOf(state, id); cur && !out.includes(cur) && cur !== id && out.length < CHAIN_DEPTH; cur = holderOf(state, cur)) out.push(cur);
  return out;
}

/** Who has a thing (§3.3): the nearest person up its holders, or null. */
export function possessorOf(ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): EntityId | null {
  return holdersOf(ctx.state, id).find((h) => isPerson(ctx, h)) ?? null;
}

// ---------------------------------------------------------------- whose it is

/** How an unowned thing's owner is presumed (§4.2), or that nobody's is (it is public). */
export type PresumedBy = "on" | "holder" | "business" | "household" | "property" | "residents" | "nobody";

/** Whose a thing is: its stated owners, or (`presumed`) whom its place presumes, read and never written. */
export interface Whose {
  owners: EntityId[];
  presumed?: PresumedBy;
}

/**
 * The people who live where `place` is: the nearest place up from it, within the same building or
 * site (`together`), that is someone's `home`, and its residents.
 */
function residentsAt(ctx: ThingContext, place: PlaceId): { home: PlaceId; residents: EntityId[] } | null {
  for (let at: PlaceId | undefined = place, guard = 0; at && guard < CHAIN_DEPTH && together(ctx.world, place, at); at = own(ctx.world.places, at)?.parent, guard++) {
    const home = at;
    const residents = Object.keys(ctx.state.entities)
      .filter((id) => own(ctx.state.entities, id)?.fields.home === home && isPerson(ctx, id) && !isGone(ctx.state, id))
      .sort();
    if (residents.length > 0) return { home, residents };
  }
  return null;
}

/**
 * Whose a thing is (§4.2): its stated owners; unowned, on a person that person's; in a holder the
 * holder's, stated or presumed; at a place, the business trading there, else whoever lives there
 * (one household they all belong to, else the owners of the property the home is, else the
 * residents together), else nobody's.
 */
export function whoseOf(ctx: ThingContext, id: EntityId): Whose {
  const seen = new Set<EntityId>();
  for (let cur: EntityId | null = id; cur && !seen.has(cur) && seen.size < CHAIN_DEPTH; ) {
    seen.add(cur);
    const e = own(ctx.state.entities, cur);
    if (!e) break;
    const stated = [...new Set(ownersIn(e.fields).map((o) => o.party))];
    if (stated.length > 0) return cur === id ? { owners: stated } : { owners: stated, presumed: "holder" };
    if (cur !== id && isPerson(ctx, cur)) return { owners: [cur], presumed: "on" };
    const place = typeof e.fields.place === "string" && e.fields.place !== "" ? e.fields.place : null;
    if (place) return presumedAt(ctx, place);
    cur = holderOf(ctx.state, cur);
  }
  return { owners: [], presumed: "nobody" };
}

/** Whose a thing nobody owns is presumed where it lies at `place` (§4.2): the business trading there, else whoever lives there, else nobody. */
export function presumedAt(ctx: ThingContext, place: PlaceId): Whose {
  const business = businessAt(ctx, place);
  if (business) return { owners: [business], presumed: "business" };
  const living = residentsAt(ctx, place);
  if (!living) return { owners: [], presumed: "nobody" };
  const households = Object.keys(ctx.state.entities)
    .filter((h) => orgTypeOf(ctx, h) === "household" && !isGone(ctx.state, h) && living.residents.every((r) => isMemberOf(ctx, r, h)))
    .sort();
  if (households.length === 1 && households[0] !== undefined) return { owners: [households[0]], presumed: "household" };
  const owners = new Set<EntityId>();
  for (const pid of Object.keys(ctx.state.entities).sort()) {
    const p = own(ctx.state.entities, pid);
    if (p && p.fields.place === living.home && kindIs(ctx.registry, ctx.world, p.kind, "property") && !isGone(ctx.state, pid)) for (const o of ownersIn(p.fields)) owners.add(o.party);
  }
  return owners.size > 0 ? { owners: [...owners], presumed: "property" } : { owners: living.residents, presumed: "residents" };
}

/**
 * Whether the player character may ✎ or dispose of a thing (`fix_item`, ITEMS-SPEC §10.3): one
 * stated theirs (or their household's); else, nobody's stated, one they have, or one at a place they
 * live in or own.
 */
export function mayFixThing(ctx: ThingContext, pov: EntityId, item: EntityId): boolean {
  const ours = (party: EntityId): boolean => party === pov || (orgTypeOf(ctx, party) === "household" && isMemberOf(ctx, pov, party));
  const stated = ownersIn(own(ctx.state.entities, item)?.fields ?? {}).map((o) => o.party);
  if (stated.length > 0) return stated.some(ours);
  if (possessorOf(ctx, item) === pov) return true;
  const at = placeOfEntity(ctx.state, item);
  const home = own(ctx.state.entities, pov)?.fields.home;
  if (at === null) return false;
  if (typeof home === "string" && own(ctx.world.places, home) && placeWithin(ctx.world, at, home) && together(ctx.world, at, home)) return true;
  return presumedAt(ctx, at).owners.some(ours);
}

// ---------------------------------------------------------------- where it rests

/** Where a rest came from: the thing's own `home`, the world's placing of it, or the inference for things made in play (`stored`: what keeps its kind at its owner's home, a wardrobe for clothing). */
export type RestFrom = "home" | "authored" | "carry" | "stored" | "fixture" | "bought" | "made" | "none";

/** A rest as a thing's `home` field stores it: a place's id, a holder's id, "owner", or a spot. */
export function readRest(value: unknown, ctx: Pick<ReadContext, "world" | "state">): Rest | null {
  if (value === "owner") return "owner";
  if (typeof value === "string" && value !== "") return own(ctx.world.places, value) ? { place: value } : own(ctx.state.entities, value) ? { in: value } : null;
  return isRest(value) ? value : null;
}

/** Whether a thing is everyday carry for its owner (§4.4): its type is one the world's carry rules give someone like them. */
function everyday(ctx: ThingContext, id: EntityId, owner: EntityId | undefined): boolean {
  const type = own(ctx.state.entities, id)?.fields.catalog;
  if (typeof type !== "string" || owner === undefined) return false;
  return thingsConfigOf(ctx.world).carry.some((rule) => rule.types.includes(type) && selectorMatches(ctx.registry, ctx.world, ctx.state, rule.who, owner));
}

/** The slots that carry rather than dress (§10.3): never an outfit's, and never what makes a thing clothing. */
const CARRY_SLOTS: Readonly<Record<string, true>> = { none: true, pocket: true, pocket_or_bag: true, hand_held: true, back: true, shoulder: true };

/** The slots several things share at once (pockets, hands): wearing one there takes nothing else off. */
export const SHARED_SLOTS: Readonly<Record<string, true>> = { pocket: true, pocket_or_bag: true, hand_held: true };

/** The slot a thing is worn in (§10.3): its own `slot`, else its type row's `equip_slot`; null when it isn't worn. */
export function slotOf(ctx: Pick<ThingContext, "tables">, f: Readonly<JsonObject>): string | null {
  const slot = typeof f.slot === "string" && f.slot !== "" ? f.slot : typeRowOf(ctx, f)?.row.equip_slot;
  return typeof slot === "string" && slot !== "" && slot !== "none" ? slot : null;
}

/** A thing's category as the sizes by name's `keeps` reads it: its own, else its type row's; a thing worn on the body is clothing. */
export function keptCategoryOf(ctx: Pick<ThingContext, "tables">, f: Readonly<JsonObject>): string | null {
  const category = typeof f.category === "string" && f.category !== "" ? f.category : typeRowOf(ctx, f)?.row.category;
  if (typeof category === "string" && category !== "") return category;
  const slot = slotOf(ctx, f);
  return slot !== null && !hasOwn(CARRY_SLOTS, slot) ? "clothing" : null;
}

/** Things lying at a place whose names keep a category's things (a wardrobe keeps clothing), each category's in id order, from the pass's state. */
function keepersOf(ctx: ThingContext): ReadonlyMap<string, readonly { id: EntityId; place: PlaceId }[]> {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], "things.keepers", () => {
    const out = new Map<string, { id: EntityId; place: PlaceId }[]>();
    for (const id of thingIndex(ctx).things) {
      const e = own(ctx.state.entities, id);
      const place = e?.fields.place;
      if (!e || typeof place !== "string" || place === "" || isGone(ctx.state, id)) continue;
      for (const category of nameEntryOf(ctx, e.fields, e.name)?.keeps ?? []) out.set(category, [...(out.get(category) ?? []), { id, place }]);
    }
    return out;
  });
}

/**
 * What keeps a thing of `category` at its owner's home (§4.3): a holder there that keeps the
 * category by the sizes by name and takes the thing's size, the owner's own first, never someone
 * else's (a housemate's wardrobe); null when their home has none, or they have no home.
 */
export function keeperAt(ctx: ThingContext, owner: EntityId, thing: EntityId, category: string): EntityId | null {
  const home = own(ctx.state.entities, owner)?.fields.home;
  if (typeof home !== "string" || !own(ctx.world.places, home)) return null;
  const size = sizeOf(ctx, thing).size;
  let best: { id: EntityId; theirs: boolean } | null = null;
  for (const k of keepersOf(ctx).get(category) ?? []) {
    if (k.id === thing || !placeWithin(ctx.world, k.place, home) || !together(ctx.world, k.place, home)) continue;
    const holds = holdsOf(ctx, k.id);
    if (holds === null || (isSize(size) && sizeRank(size) > sizeRank(holds))) continue;
    const stated = ownersIn(own(ctx.state.entities, k.id)?.fields ?? {}).map((o) => o.party);
    const theirs = stated.some((p) => p === owner || isMemberOf(ctx, owner, p));
    if (stated.length > 0 && !theirs) continue;
    if (!best || (theirs && !best.theirs)) best = { id: k.id, theirs };
  }
  return best?.id ?? null;
}

/**
 * Where a thing rests (§4.3): its `home`; unset, an authored thing rests where the world document
 * puts it; one made in play rests on its owner when it is everyday carry or worn, in what keeps its
 * kind at its owner's home (clothing in their wardrobe), where it is when it is Furniture or built in
 * (unless that is on a person, which can't be), at the buyer's home when it was bought (a Pocket
 * thing on the buyer), else where it was made. Null when nothing says.
 */
export function restOf(ctx: ThingContext, id: EntityId): { rest: Rest | null; from: RestFrom } {
  const e = own(ctx.state.entities, id);
  if (!e) return { rest: null, from: "none" };
  if (e.fields.home !== undefined && e.fields.home !== null) {
    const rest = readRest(e.fields.home, ctx);
    if (rest) return { rest, from: "home" };
  }
  const authored = own(ctx.world.entities, id);
  if (authored) {
    const place = authored.fields.place;
    if (typeof place === "string" && own(ctx.world.places, place)) return { rest: { place }, from: "authored" };
    const holder = authored.relations.find((r) => r.type === "in")?.to;
    return holder && own(ctx.state.entities, holder) ? { rest: { in: holder }, from: "authored" } : { rest: null, from: "none" };
  }
  const owner = ownersIn(e.fields)[0]?.party;
  const worn = e.relations.some((r) => r.type === "worn_by" || r.type === "equipped");
  if (owner !== undefined && (worn || everyday(ctx, id, owner))) return { rest: "owner", from: "carry" };
  const category = owner !== undefined ? keptCategoryOf(ctx, e.fields) : null;
  const keeper = owner !== undefined && category !== null ? keeperAt(ctx, owner, id, category) : null;
  if (keeper !== null) return { rest: { in: keeper }, from: "stored" };
  const size = sizeOf(ctx, id).size;
  if (size === "furniture" || size === "builtin" || size === "part" || size === "vehicle") {
    const here = spotOf(ctx.state, id);
    const onPerson = here !== null && "in" in here && isPerson(ctx, here.in);
    if (!onPerson) return { rest: here, from: here ? "fixture" : "none" };
  }
  if (gotOf(e.fields.got)?.how === "bought" && owner !== undefined) {
    if (size === "pocket") return { rest: "owner", from: "bought" };
    const home = own(ctx.state.entities, owner)?.fields.home;
    if (typeof home === "string" && own(ctx.world.places, home)) return { rest: { place: home }, from: "bought" };
  }
  const made = madeOf(e.fields.made);
  return made ? { rest: made.at, from: "made" } : { rest: null, from: "none" };
}
