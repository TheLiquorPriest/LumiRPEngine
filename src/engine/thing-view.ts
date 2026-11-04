// Things as Build's pages read them (ITEMS-SPEC §10.1; `shared/thing-view.ts`): every thing with
// its size, where it is and whose it is, and the same by owner; one thing's page, with where it is
// kept, who may use it (each person asked of the one access resolver, grouped by ground) and what it
// holds; a person's things in the Character page's groups; what words name (the name resolver, then
// names that start with them); the catalog's types with the sizes they give; and the where and
// whose pickers' choices. Read from a world and a state; Build's is the state a chat starts from
// (`buildContext`), GM → Things' a chat's head (`engine/thing-gm.ts` adds what the GM reads beyond
// it). Everything is an author's view: every thing, a secret one marked. Pure.

import type { EntityId, PlaceId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { TYPE_TABLES, typeFields } from "../shared/items-build";
import type { AccessChip, GrantView, OwnerGroup, PartyRef, PersonThings, Presumption, ThingPage, ThingPicks, ThingRow, ThingsList, ThingType, WardrobeRows, WhereChoice, WhereStep, WhoseView } from "../shared/thing-view";
import { partyPossessive } from "../shared/thing-view";
import type { Rest, Spot } from "../shared/things";
import { grantBasisOf, nameTokens, thingsConfigOf } from "../shared/things";
import type { WorldDoc } from "../shared/world";
import { listWords } from "../shared/words";
import { accessFor, atHome, type AccessAnswer } from "./access";
import { calendarOf, formatClock } from "./calendar";
import { orgPlaces, orgTypeOf, placesOf } from "./org";
import { own } from "./pack-kit";
import { readPass } from "./read-pass";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { isGone, kindDef, kindIs, placeOfEntity, placeWithin } from "./scope";
import { thingIndex, typeRowOf } from "./thing-index";
import { findThings } from "./thing-resolve";
import { contentsOf, holderOf, holdersOf, holdsOf, isThing, keptCategoryOf, possessorOf, presumedAt, restOf, sizeOf, sizeOfDef, slotOf, whoseOf, type Whose } from "./things";
import { initialState } from "./world-state";

/** How far up a chain of places or holders is followed. */
const DEPTH = 32;

/** How many names a ground's chip lists before it counts the rest. */
const CHIP_NAMES = 2;

/** The context Build reads a draft in: the state a chat starts from; null while the draft can't start one (its clock doesn't parse). */
export function buildContext(reg: Registry, world: WorldDoc): ReadContext | null {
  try {
    calendarOf(world);
    return reg.context(world, initialState(world, "things", reg));
  } catch {
    return null;
  }
}

const isPerson = (ctx: ReadContext, id: string): boolean => {
  const e = own(ctx.state.entities, id);
  return !!e && kindIs(ctx.registry, ctx.world, e.kind, "person");
};

/** A party by id: a person, an organization, or a place an older world names as an owner. */
export function partyRef(ctx: ReadContext, id: string): PartyRef {
  const e = own(ctx.state.entities, id);
  if (e) return { id, name: e.name, is: orgTypeOf(ctx, id) ?? (kindIs(ctx.registry, ctx.world, e.kind, "person") ? "person" : "other") };
  const place = own(ctx.world.places, id);
  return { id, name: place?.name ?? id, is: place ? "place" : "other" };
}

/** A place and the places around it, outermost first. */
function placePath(world: WorldDoc, place: PlaceId): WhereStep[] {
  const out: WhereStep[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = place; at && !seen.has(at) && out.length < DEPTH; at = own(world.places, at)?.parent) {
    seen.add(at);
    out.unshift({ id: at, name: own(world.places, at)?.name ?? at, is: "place" });
  }
  return out;
}

/** Where an entity is, outermost first, as the engine reads it (its place first, else what holds it): ending at the place it lies at or what holds it. */
export function whereOf(ctx: ReadContext, id: EntityId): WhereStep[] {
  const out: WhereStep[] = [];
  const seen = new Set<string>([id]);
  for (let cur = id, guard = 0; guard < DEPTH; guard++) {
    const e = own(ctx.state.entities, cur);
    if (!e) break;
    if (typeof e.fields.place === "string" && e.fields.place !== "") {
      out.unshift(...placePath(ctx.world, e.fields.place));
      break;
    }
    const holder = holderOf(ctx.state, cur);
    if (!holder || seen.has(holder)) break;
    seen.add(holder);
    out.unshift({ id: holder, name: own(ctx.state.entities, holder)?.name ?? holder, is: isPerson(ctx, holder) ? "person" : "thing" });
    cur = holder;
  }
  return out;
}

/** The steps to a spot and the spot itself. */
export function spotSteps(ctx: ReadContext, rest: Exclude<Rest, "owner">): WhereStep[] {
  if ("place" in rest) return placePath(ctx.world, rest.place);
  return [...whereOf(ctx, rest.in), { id: rest.in, name: own(ctx.state.entities, rest.in)?.name ?? rest.in, is: isPerson(ctx, rest.in) ? "person" : "thing" }];
}

/**
 * The place that presumes an owner, by name: for a business, its place around `place`; for a
 * household, a property or residents, the home around it; else `place` itself.
 */
function presumingPlace(ctx: ReadContext, place: PlaceId, whose: Whose): string {
  const homes = new Set<string>();
  if (whose.presumed === "business") for (const b of whose.owners) for (const p of placesOf(ctx, b)) homes.add(p);
  else for (const id of Object.keys(ctx.state.entities)) if (isPerson(ctx, id) && typeof own(ctx.state.entities, id)?.fields.home === "string") homes.add(String(own(ctx.state.entities, id)?.fields.home));
  for (const step of placePath(ctx.world, place).reverse()) if (homes.has(step.id)) return step.name;
  return own(ctx.world.places, place)?.name ?? place;
}

/** Presumptions a place makes (a business's, a household's, a property's, the residents'), whose place a page names. */
const PLACE_PRESUMED: Readonly<Partial<Record<Presumption, true>>> = { business: true, household: true, property: true, residents: true };

/** Whose as a page says it: the parties named, how they're presumed, and the place that presumes them. */
function whoseView(ctx: ReadContext, whose: Whose, place: PlaceId | null): WhoseView {
  const presumed = whose.presumed ?? null;
  return { owners: whose.owners.map((o) => partyRef(ctx, o)), presumed, at: presumed !== null && PLACE_PRESUMED[presumed] === true && place !== null ? presumingPlace(ctx, place, whose) : null };
}

/** A thing's visibility: the world document's, else (a thing made in play hidden) the one its fields keep, as `isDiscoverable` reads it. */
export function thingVisibility(ctx: ReadContext, id: EntityId): unknown {
  return own(ctx.world.entities, id)?.visibility ?? own(ctx.state.entities, id)?.fields.visibility;
}

/** Where Put away takes a thing (its rest): a place, or a holder; on its owner, the owner. Null when nothing says. */
function restSpot(ctx: ReadContext, id: EntityId): Spot | null {
  const rest = restOf(ctx, id).rest;
  if (rest !== "owner") return rest;
  const owner = whoseOf(ctx, id).owners[0];
  return owner !== undefined && own(ctx.state.entities, owner) ? { in: owner } : null;
}

/** A thing as a list shows it. */
export function thingRow(ctx: ReadContext, id: EntityId): ThingRow {
  const e = own(ctx.state.entities, id);
  const fields = e?.fields ?? {};
  const type = typeRowOf(ctx, fields)?.row.name;
  const worn = e?.relations.find((r) => r.type === "worn_by" || r.type === "equipped");
  const visibility = thingVisibility(ctx, id);
  return {
    id,
    name: e?.name ?? id,
    kind: e?.kind ?? "",
    type: typeof type === "string" ? type : null,
    size: sizeOf(ctx, id).size,
    where: whereOf(ctx, id),
    whose: whoseView(ctx, whoseOf(ctx, id), placeOfEntity(ctx.state, id)),
    with: possessorOf(ctx, id),
    worn: worn ? (typeof worn.fields?.slot === "string" ? worn.fields.slot : typeof fields.slot === "string" ? fields.slot : "worn") : null,
    slot: slotOf(ctx, fields),
    rest: restSpot(ctx, id),
    holds: holdsOf(ctx, id),
    // Things only: a cash account in a wallet is the money's, not a thing in it.
    inside: contentsOf(ctx.state, id).filter((c) => isThing(ctx, c) && !isGone(ctx.state, c)).length,
    hidden: visibility === "discoverable",
    secret: visibility === "secret" || visibility === "known_by",
  };
}

/** Every thing still in the world, by name. */
function things(ctx: ReadContext): EntityId[] {
  const ids = thingIndex(ctx).things.filter((id) => !isGone(ctx.state, id));
  return ids.sort((a, b) => (own(ctx.state.entities, a)?.name ?? a).localeCompare(own(ctx.state.entities, b)?.name ?? b) || a.localeCompare(b));
}

/** Parties in the order pickers and By owner list them: the player character, people, organizations, then anything else, each by name. */
function partyOrder(ctx: ReadContext, a: PartyRef, b: PartyRef): number {
  const rank = (p: PartyRef): number => (p.id === ctx.world.pov ? 0 : p.is === "person" ? 1 : p.is === "place" || p.is === "other" ? 3 : 2);
  return rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Whether a thing is at its owner's home: a person's home, an organization's places, or within the place that owns it. */
function atOwnersHome(ctx: ReadContext, owner: PartyRef, at: PlaceId | null): boolean {
  if (at === null) return false;
  if (owner.is === "person") return atHome(ctx, at, own(ctx.state.entities, owner.id)?.fields.home);
  if (owner.is === "place") return placeWithin(ctx.world, at, owner.id);
  return orgPlaces(ctx, owner.id).some((p) => placeWithin(ctx.world, at, p));
}

/** By owner (ITEMS-SPEC §10.1): each owner, stated or presumed, with their things on them, at home and elsewhere; nobody's last. */
function ownerGroups(ctx: ReadContext, rows: readonly ThingRow[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();
  const nobody: OwnerGroup = { owner: null, on: [], home: [], away: [] };
  for (const row of rows) {
    if (row.whose.owners.length === 0) {
      (row.with !== null ? nobody.on : nobody.away).push(row.id);
      continue;
    }
    for (const owner of row.whose.owners) {
      let group = groups.get(owner.id);
      if (!group) {
        group = { owner, on: [], home: [], away: [] };
        groups.set(owner.id, group);
      }
      const on = owner.is === "person" ? row.with === owner.id : row.with !== null;
      (on ? group.on : atOwnersHome(ctx, owner, placeOfEntity(ctx.state, row.id)) ? group.home : group.away).push(row.id);
    }
  }
  const out = [...groups.values()].sort((a, b) => (a.owner && b.owner ? partyOrder(ctx, a.owner, b.owner) : 0));
  return nobody.on.length + nobody.away.length > 0 ? [...out, nobody] : out;
}

/** Things (ITEMS-SPEC §10.1): every thing, by owner too, and the pickers' choices. */
export function thingsList(ctx: ReadContext): ThingsList {
  return readPass(() => {
    const rows = things(ctx).map((id) => thingRow(ctx, id));
    return { rows, owners: ownerGroups(ctx, rows), pick: thingPicks(ctx) };
  });
}

/** Whose a thing nobody owns is presumed, put in a holder: the holder's, stated or presumed; on a person, theirs. */
function presumedIn(ctx: ReadContext, holder: EntityId): WhoseView {
  if (isPerson(ctx, holder)) return { owners: [partyRef(ctx, holder)], presumed: "on", at: null };
  const owners = whoseOf(ctx, holder).owners;
  return { owners: owners.map((o) => partyRef(ctx, o)), presumed: owners.length > 0 ? "holder" : "nobody", at: null };
}

/** The where and whose pickers' choices: every place by its path, every person, every thing that holds things, and every party. */
export function thingPicks(ctx: ReadContext): ThingPicks {
  return readPass(() => {
    const where: WhereChoice[] = [];
    for (const place of Object.values(ctx.world.places)) {
      where.push({
        id: place.id,
        is: "place",
        name: place.name,
        path: placePath(ctx.world, place.id).slice(0, -1),
        parent: place.parent !== undefined && own(ctx.world.places, place.parent) ? place.parent : null,
        holds: null,
        vehicle: false,
        whose: null,
        presumes: whoseView(ctx, presumedAt(ctx, place.id), place.id),
        secret: place.visibility !== undefined && place.visibility !== "public",
      });
    }
    const config = thingsConfigOf(ctx.world);
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id)) continue;
      const person = kindIs(ctx.registry, ctx.world, e.kind, "person");
      const holds = person ? config.sizes.ceiling : isThing(ctx, id) ? holdsOf(ctx, id) : null;
      if (holds === null) continue;
      const steps = whereOf(ctx, id);
      const visibility = person ? own(ctx.world.entities, id)?.visibility : thingVisibility(ctx, id);
      where.push({
        id,
        is: person ? "person" : "thing",
        name: e.name,
        path: steps,
        parent: steps.at(-1)?.id ?? null,
        holds,
        vehicle: kindIs(ctx.registry, ctx.world, e.kind, "vehicle"),
        whose: person ? null : whoseView(ctx, whoseOf(ctx, id), placeOfEntity(ctx.state, id)),
        presumes: presumedIn(ctx, id),
        secret: visibility === "secret" || visibility === "known_by",
      });
    }
    const parties: PartyRef[] = [];
    for (const id of Object.keys(ctx.state.entities)) {
      if (isGone(ctx.state, id)) continue;
      const party = partyRef(ctx, id);
      if (party.is !== "other" && party.is !== "place") parties.push(party);
    }
    return { where, parties: parties.sort((a, b) => partyOrder(ctx, a, b)), ceiling: config.sizes.ceiling };
  });
}

// ---------------------------------------------------------------- a thing's page

/** Names as a chip lists them: two, then how many more. */
function chipNames(names: readonly string[]): string {
  return names.length <= CHIP_NAMES ? listWords(names) : `${names.slice(0, CHIP_NAMES).join(", ")} and ${names.length - CHIP_NAMES} more`;
}

/** The place of an organization's that a thing is at, by name. */
function orgPlaceAt(ctx: ReadContext, org: EntityId, at: PlaceId | null): string | null {
  const place = at === null ? undefined : orgPlaces(ctx, org).find((p) => placeWithin(ctx.world, at, p));
  return place === undefined ? null : (own(ctx.world.places, place)?.name ?? place);
}

/**
 * Who may use a thing beyond a grant, ground by ground (ITEMS-SPEC §3.4, §10.1): every person asked
 * of the access resolver, as a chat starts, and grouped by what their use rests on ("The Kowalczyks ·
 * members", "Alder Automotive staff · at Alder Automotive", "Anyone"). A grant is the page's own row.
 */
function useChips(ctx: ReadContext, thing: EntityId): AccessChip[] {
  const chips = new Map<string, { answer: AccessAnswer; who: string[] }>();
  const people = Object.keys(ctx.state.entities)
    .filter((id) => isPerson(ctx, id) && !isGone(ctx.state, id))
    .sort((a, b) => partyOrder(ctx, partyRef(ctx, a), partyRef(ctx, b)));
  for (const who of people) {
    const use = accessFor(ctx, who, thing).use;
    if (!use || use.basis === "grant") continue;
    // Grounds an organization gives are one chip for all it covers; a person's own ground, one per person.
    const key = use.basis === "public" ? "public" : use.basis === "member" || use.basis === "staff" || use.basis === "customer" ? `${use.basis}:${use.via ?? ""}` : use.basis === "owner" || use.basis === "position" || use.basis === "delegate" ? `${use.basis}:${use.via ?? ""}:${who}` : `${use.basis}:${use.via ?? ""}`;
    const chip = chips.get(key);
    const name = own(ctx.state.entities, who)?.name ?? who;
    if (chip) chip.who.push(name);
    else chips.set(key, { answer: use, who: [name] });
  }
  const at = placeOfEntity(ctx.state, thing);
  const nameOf = (id: string | undefined): string => (id === undefined ? "" : partyRef(ctx, id).name);
  return [...chips.values()].map(({ answer, who }): AccessChip => {
    const presumed = answer.presumed ? " (presumed)" : "";
    const via = answer.via;
    switch (answer.basis) {
      case "public":
        return { basis: "public", label: "Anyone · nobody's", who: [] };
      case "owner":
        return { basis: "owner", label: via === undefined ? `${chipNames(who)} · owner${presumed}` : `${chipNames(who)} · ${partyPossessive(partyRef(ctx, via))} owner`, who };
      case "member":
        return { basis: "member", label: `${nameOf(via)} · members${presumed}`, who };
      case "staff": {
        const place = via === undefined ? null : orgPlaceAt(ctx, via, at);
        return { basis: "staff", label: `${nameOf(via)} staff${place !== null ? ` · at ${place}` : ""}`, who };
      }
      case "customer":
        return { basis: "customer", label: `${nameOf(via)} customers · while it trades`, who };
      case "permit":
        return { basis: "permit", label: `${chipNames(who)} · allowed by ${nameOf(via)}`, who };
      case "household":
        return { basis: "household", label: `${chipNames(who)} · household`, who };
      case "housemate":
        return { basis: "housemate", label: `${chipNames(who)} · housemates`, who };
      case "partner":
        return { basis: "partner", label: `${chipNames(who)} · partner`, who };
      case "family":
        return { basis: "family", label: `${chipNames(who)} · family`, who };
      default:
        return { basis: answer.basis, label: `${chipNames(who)} · ${answer.basis} in ${nameOf(via)}`, who };
    }
  });
}

/** The use grants to a thing (every `uses` to it), each with its basis and when it ends in words. */
function grantsTo(ctx: ReadContext, thing: EntityId): GrantView[] {
  const cal = calendarOf(ctx.world);
  const out: GrantView[] = [];
  for (const who of Object.keys(ctx.state.entities).sort()) {
    for (const r of own(ctx.state.entities, who)?.relations ?? []) {
      if (r.type !== "uses" || r.to !== thing) continue;
      out.push({ who: partyRef(ctx, who), basis: grantBasisOf(r.fields, r.until), until: typeof r.until === "number" ? formatClock(cal, r.until) : null });
    }
  }
  return out.sort((a, b) => partyOrder(ctx, a.who, b.who));
}

/** One thing's page (ITEMS-SPEC §10.1); null for an id that isn't a thing in the world. */
export function thingPage(ctx: ReadContext, id: EntityId): ThingPage | null {
  if (!isThing(ctx, id) || isGone(ctx.state, id)) return null;
  return readPass(() => {
    const e = own(ctx.state.entities, id);
    const rest = restOf(ctx, id);
    const set = rest.from === "home" && rest.rest !== null;
    return {
      row: thingRow(ctx, id),
      kindLabel: (e ? kindDef(ctx.registry, ctx.world, e.kind)?.label : undefined) ?? e?.kind ?? "",
      sizeFrom: sizeOf(ctx, id).from,
      kept: { set, owner: set && rest.rest === "owner", where: set && rest.rest !== null && rest.rest !== "owner" ? spotSteps(ctx, rest.rest) : [] },
      use: useChips(ctx, id),
      grants: grantsTo(ctx, id),
      contents: contentsOf(ctx.state, id)
        .filter((c) => isThing(ctx, c) && !isGone(ctx.state, c))
        .map((c) => thingRow(ctx, c)),
    };
  });
}

// ---------------------------------------------------------------- a person's things

/**
 * A person's things in the Character page's groups (ITEMS-SPEC §10.1): theirs (or nobody's) that
 * they have; others' that they have; theirs someone else has; theirs at home; theirs elsewhere.
 * Then, derived, what they wear (by slot) and what they carry and don't wear, and their clothing at
 * home by what holds it, from Gear 3 (below it everything on them is carried). Null for an id that
 * isn't a person.
 */
export function personThings(ctx: ReadContext, person: EntityId): PersonThings | null {
  if (!isPerson(ctx, person) || isGone(ctx.state, person)) return null;
  return readPass(() => {
    const out: PersonThings = { on: [], home: [], away: [], lent: [], holding: [], outfit: [], carried: [], wardrobe: [] };
    const home = own(ctx.state.entities, person)?.fields.home;
    const slotted = ctx.levelOf(person, "gear") >= 3;
    const slots = Object.keys(ctx.tables.get("gear.slots")?.rows ?? {});
    const outfit: { row: ThingRow; rank: number }[] = [];
    const wardrobe = new Map<string, WardrobeRows>();
    for (const id of things(ctx)) {
      const has = possessorOf(ctx, id);
      const whose = whoseOf(ctx, id);
      const stated = whose.presumed === undefined ? whose.owners : [];
      if (has === person) {
        const row = thingRow(ctx, id);
        (stated.length === 0 || stated.includes(person) ? out.on : out.holding).push(row);
        if (holderOf(ctx.state, id) !== person) continue;
        const worn = slotted && row.worn !== null && row.worn !== "pocket" && row.worn !== "pocket_or_bag" && holdersOf(ctx.state, id).includes(person);
        if (worn) outfit.push({ row, rank: slots.includes(row.worn ?? "") ? slots.indexOf(row.worn ?? "") : slots.length });
        else out.carried.push(row);
        continue;
      }
      if (!stated.includes(person)) continue;
      if (has !== null) {
        out.lent.push(thingRow(ctx, id));
        continue;
      }
      const at = placeOfEntity(ctx.state, id);
      const row = thingRow(ctx, id);
      if (!atHome(ctx, at, home)) {
        out.away.push(row);
        continue;
      }
      out.home.push(row);
      if (!slotted || keptCategoryOf(ctx, own(ctx.state.entities, id)?.fields ?? {}) !== "clothing") continue;
      const holder = holderOf(ctx.state, id);
      const key = holder ?? "";
      const group = wardrobe.get(key) ?? { holder: holder !== null ? { id: holder, name: own(ctx.state.entities, holder)?.name ?? holder, is: "thing" as const } : null, rows: [] };
      group.rows.push(row);
      wardrobe.set(key, group);
    }
    out.outfit = outfit.sort((a, b) => a.rank - b.rank || a.row.id.localeCompare(b.row.id)).map((o) => o.row);
    out.wardrobe = [...wardrobe.values()].sort((a, b) => Number(a.holder === null) - Number(b.holder === null) || (a.holder?.name ?? "").localeCompare(b.holder?.name ?? ""));
    return out;
  });
}

// ---------------------------------------------------------------- search, types

/**
 * What words name in Things' search, best first: what the name resolver finds (ITEMS-SPEC §5.1;
 * owners, places and holders the words name narrowing it, the player character's "my"), then every
 * other thing whose name, alias or type has a word starting with each word typed.
 */
export function findThingIds(ctx: ReadContext, words: string): EntityId[] {
  if (words.trim() === "") return [];
  return readPass(() => {
    const pov = ctx.world.pov;
    const found = findThings(ctx, words, { actor: pov, viewer: pov, scope: "all" }).map((c) => c.id);
    const seen = new Set(found);
    const want = nameTokens(words);
    if (want.length === 0) return found;
    const index = thingIndex(ctx);
    for (const id of things(ctx)) {
      if (seen.has(id)) continue;
      const e = own(ctx.state.entities, id);
      const aliases = Array.isArray(e?.fields.aliases) ? e.fields.aliases.filter((a): a is string => typeof a === "string") : [];
      const type = typeRowOf(ctx, e?.fields ?? {})?.row.name;
      const tokens = [e?.name ?? "", ...aliases, typeof type === "string" ? type : ""].flatMap(nameTokens);
      if (index.names.has(id) && want.every((w) => tokens.some((t) => t.startsWith(w)))) found.push(id);
    }
    return found;
  });
}

/** A category's name: the economy's categories table's, else its id in words. */
function categoryName(ctx: ReadContext, category: unknown): string | null {
  if (typeof category !== "string" || category === "") return null;
  const name = ctx.tables.get("economy.categories")?.rows[category]?.name;
  if (typeof name === "string") return name;
  const words = category.replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The catalog's types (both catalogs, a type named in two read from the first, as a thing's is), each with the size it gives. */
export function thingTypes(ctx: ReadContext): ThingType[] {
  return readPass(() => {
    const out: ThingType[] = [];
    const seen = new Set<string>();
    for (const table of TYPE_TABLES) {
      const rows = ctx.tables.get(table)?.rows ?? {};
      for (const id of Object.keys(rows).sort()) {
        const row = hasOwn(rows, id) ? rows[id] : undefined;
        if (!row || seen.has(id)) continue;
        seen.add(id);
        const typed = typeFields(table, id, row);
        out.push({ id, table, name: typeof row.name === "string" ? row.name : id, category: categoryName(ctx, typed.fields.category), size: sizeOfDef(ctx, typed.kind, typed.fields).size });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  });
}
