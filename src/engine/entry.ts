// Who may enter a place, and who is somewhere without leave (ORG-SPEC §3.9). A place's entry sits on
// the audience ladder that things' access shares (owner, members, staff, customers, public) and is
// counted from the place's owner: ITEMS-SPEC §4.2's presumed owner (the business trading there, else
// whoever lives there), else the organizations that hold it and the owners of a property there.
// Whoever lives there may always enter, and so may someone carrying one of its keys. Entry labels
// and guides. Go greys a place that offers no basis. An entry the story tells still happens, and is
// recorded as a trespass unless someone who may enter is there; it never vetoes. Pure, read when
// asked, never in the fold.

import { ownersIn } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import { admits, type Audience } from "../shared/org";
import { listWords, possessive } from "../shared/words";
import { acts } from "./life";
import { belongsTo, businessAt, entryInPlay, isStaff, orgPlaces, orgPower, orgTypeOf, placeEntry, placesOf, placesUp, setEntryOf } from "./org";
import { own } from "./pack-kit";
import { passMemo } from "./read-pass";
import type { ReadContext } from "./registry";
import { isGone, kindIs, placeOfEntity } from "./scope";
import { isMemberOf } from "./selector";
import { possessorOf, presumedAt } from "./things";
import { canSeeEntity } from "./visibility";

type EntryContext = Pick<ReadContext, "registry" | "world" | "state" | "tables">;

/** What someone's leave to enter rests on: anyone's; living there; an owner's power (owner, position, delegate, member, or control through an organization holding it); a member of the owner or of a person owner's household; working for them; a customer; a key they carry. */
export const ENTRY_BASES = ["public", "resident", "owner", "position", "delegate", "member", "control", "household", "staff", "customer", "key"] as const;
export type EntryBasis = (typeof ENTRY_BASES)[number];

/** Someone's leave to enter a place: what it rests on, the owner it is through, and the position, job or key that gives it. */
export interface EntryAnswer {
  basis: EntryBasis;
  via?: EntityId;
  by?: EntityId;
}

/** Who lives where: each person still in the world by their `home`, in id order. */
function homesOf(ctx: EntryContext): Map<PlaceId, EntityId[]> {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], "entry.homes", () => {
    const out = new Map<PlaceId, EntityId[]>();
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const home = own(ctx.state.entities, id)?.fields.home;
      if (typeof home !== "string" || !own(ctx.world.places, home) || isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person")) continue;
      out.set(home, [...(out.get(home) ?? []), id]);
    }
    return out;
  });
}

/**
 * Whose a place is, as its entry counts from: ITEMS-SPEC §4.2's presumed owner (the business
 * trading there, else whoever lives there: their household, the home's owners or the residents);
 * else the organizations whose places hold it and the owners of a property there. Empty for nobody's.
 */
export function placeOwnersOf(ctx: EntryContext, place: PlaceId): EntityId[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `entry.owners:${place}`, () => {
    const presumed = presumedAt(ctx, place).owners;
    if (presumed.length > 0) return presumed;
    const up = placesUp(ctx, place);
    const out = new Set<EntityId>();
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id)) continue;
      if (kindIs(ctx.registry, ctx.world, e.kind, "property")) {
        if (typeof e.fields.place === "string" && up.includes(e.fields.place)) for (const o of ownersIn(e.fields)) out.add(o.party);
      } else if (orgTypeOf(ctx, id) !== null && orgPlaces(ctx, id).some((p) => up.includes(p))) out.add(id);
    }
    return [...out];
  });
}

/** The place whose entry governs `place`: where its entry is set, else the business's own place it lies in, else itself. */
export function entryPlaceOf(ctx: EntryContext, place: PlaceId): PlaceId {
  const set = setEntryOf(ctx, place);
  if (set) return set.at;
  const business = businessAt(ctx, place);
  const theirs = business === null ? [] : placesOf(ctx, business);
  return placesUp(ctx, place).find((p) => theirs.includes(p)) ?? place;
}

/** Whether a move from `from` to `to` enters `to`: it comes from outside the place whose entry governs `to` (a move between its rooms enters nothing). */
export function entersFrom(ctx: EntryContext, from: PlaceId | null, to: PlaceId): boolean {
  return from === null || !placesUp(ctx, from).includes(entryPlaceOf(ctx, to));
}

/** The keys to a place (item ids or item types, a thing's `catalog`): set in play or by the world, on it or on the nearest place up that has some. */
export function placeKeys(ctx: EntryContext, place: PlaceId): string[] {
  for (const at of placesUp(ctx, place)) {
    const keys = entryInPlay(ctx.state, at).keys ?? own(ctx.world.places, at)?.fields.keys;
    if (Array.isArray(keys) && keys.length > 0) return keys.filter((k): k is string => typeof k === "string" && k !== "");
  }
  return [];
}

/** Who carries a key to a place now (ITEMS-SPEC §3.3: the nearest person up its holders), each with the key, in id order. */
export function keyHolders(ctx: EntryContext, place: PlaceId): { who: EntityId; key: EntityId }[] {
  const keys = placeKeys(ctx, place);
  if (keys.length === 0) return [];
  const out: { who: EntityId; key: EntityId }[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || isGone(ctx.state, id) || !(keys.includes(id) || (typeof e.fields.catalog === "string" && keys.includes(e.fields.catalog)))) continue;
    const who = possessorOf(ctx, id);
    if (who !== null) out.push({ who, key: id });
  }
  return out;
}

/** Whether `who` lives at `place`: their home is it or lies within it, or it is part of their home with no one else's home between. */
function livesAt(ctx: EntryContext, who: EntityId, place: PlaceId): boolean {
  const home = own(ctx.state.entities, who)?.fields.home;
  if (typeof home !== "string" || !own(ctx.world.places, home)) return false;
  if (placesUp(ctx, home).includes(place)) return true;
  const homes = homesOf(ctx);
  for (const at of placesUp(ctx, place)) {
    if (at === home) return true;
    if ((homes.get(at) ?? []).length > 0) return false;
  }
  return false;
}

/** Whether `who` and `owner` belong to one household: a person owner's members step (ITEMS-SPEC §3.4). */
function shareHousehold(ctx: EntryContext, who: EntityId, owner: EntityId): boolean {
  return Object.keys(ctx.state.entities).some((h) => orgTypeOf(ctx, h) === "household" && !isGone(ctx.state, h) && isMemberOf(ctx, who, h) && isMemberOf(ctx, owner, h));
}

/**
 * Whether `who` may enter `place` at `clock`, and on what (ORG-SPEC §3.9), the first that answers:
 * anyone, where its entry is public; living there; then, for each of its owners, being the owner or
 * holding `assets.use` over an organization owner (the owner step, as for its things), belonging to
 * it or to a person owner's household (members), working for it (staff), as far as its entry
 * admits them; a customer, where it admits customers; else a key they carry. Null for none.
 */
export function entryFor(ctx: EntryContext, who: EntityId, place: PlaceId, clock: number = ctx.state.clock): EntryAnswer | null {
  if (!own(ctx.world.places, place) || !own(ctx.state.entities, who) || isGone(ctx.state, who)) return null;
  const entry = placeEntry(ctx, place, clock);
  if (entry === "public") return { basis: "public" };
  if (livesAt(ctx, who, place)) return { basis: "resident" };
  for (const owner of placeOwnersOf(ctx, place)) {
    if (owner === who) return { basis: "owner" };
    const org = orgTypeOf(ctx, owner) !== null;
    const power = org ? orgPower(ctx, who, owner, "assets.use") : null;
    if (power) return { basis: power.basis, via: owner, ...(power.id !== undefined ? { by: power.id } : {}) };
    if (admits(entry, "members") && (org ? belongsTo(ctx, who, owner) : shareHousehold(ctx, who, owner))) return { basis: org ? "member" : "household", via: owner };
    const job = admits(entry, "staff") ? isStaff(ctx, who, owner) : null;
    if (job) return { basis: "staff", via: owner, by: job.id };
  }
  if (admits(entry, "customers")) {
    const business = businessAt(ctx, place);
    return { basis: "customer", ...(business !== null ? { via: business } : {}) };
  }
  const key = keyHolders(ctx, place).find((k) => k.who === who);
  return key ? { basis: "key", by: key.key } : null;
}

/** Whether a set entry or a business's hours keep someone out: never at a public place. */
export function entryClosed(ctx: EntryContext, place: PlaceId, clock: number = ctx.state.clock): Audience | null {
  const entry = placeEntry(ctx, place, clock);
  return entry === "public" || entry === "customers" ? null : entry;
}

/**
 * Why `place` turns someone away at `clock`, in the player's words: "Private: Marcus Delgado's" (the
 * owner alone, or a person owner's household), "Members only", "Staff only". The owners are named
 * only when `viewer` may see them all (null: the GM, who sees everyone). Empty where it admits anyone.
 */
export function entryRefusal(ctx: EntryContext, viewer: EntityId | null, place: PlaceId, clock: number = ctx.state.clock): string {
  const entry = entryClosed(ctx, place, clock);
  if (entry === null) return "";
  if (entry === "staff") return "Staff only";
  const owners = placeOwnersOf(ctx, place);
  if (entry === "members" && owners.some((o) => orgTypeOf(ctx, o) !== null)) return "Members only";
  const shown = owners.every((o) => viewer === null || o === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, o));
  const names = owners.map((o) => own(ctx.state.entities, o)?.name ?? o);
  return shown && names.length > 0 ? `Private: ${possessive(listWords(names))}` : "Private";
}

/** Someone else there who acts and may enter it (at the place, in a part of it or around it in the same building): whose company makes an entry no trespass. Null for nobody. */
export function leaveFrom(ctx: EntryContext, who: EntityId, place: PlaceId): EntityId | null {
  const up = placesUp(ctx, place);
  for (const id of Object.keys(ctx.state.entities).sort()) {
    if (id === who || isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") || !acts(ctx.world, ctx.state, id)) continue;
    const at = placeOfEntity(ctx.state, id);
    if (at === null || !(up.includes(at) || placesUp(ctx, at).includes(place))) continue;
    if (entryFor(ctx, id, place) !== null) return id;
  }
  return null;
}

/** Whether `who` is at `place` without leave: no basis of their own, and nobody there who may enter it. */
export function withoutLeave(ctx: EntryContext, who: EntityId, place: PlaceId): boolean {
  return entryFor(ctx, who, place) === null && leaveFrom(ctx, who, place) === null;
}
