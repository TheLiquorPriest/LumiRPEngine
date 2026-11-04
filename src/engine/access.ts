// Who owns, may use and may dispose of a thing (DESIGN §6.11; ITEMS-SPEC §3.4), and how far it is
// from someone (§4.5). Ownership is stored as an `owner` field (one party) or an `owners` list
// (parties with a role and share, `ownersIn`), or a holder (a card's `holder`, `heldBy`); an
// unowned thing's owner is presumed (`whoseOf`). Use and disposal are one resolver (`accessFor`):
// the owner (an organization's powers through its hook, `orgPower`), a use grant (`uses`), a
// standing permission (`permits`), the world's implied rules (household, housemates, partners,
// family, staff, customers) and a thing's own `access` on the audience ladder. It labels and guides
// and never vetoes the story. Pure.

import { heldBy, ownersIn, worthShares, type Owner } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import { admits, isAudience, type Audience } from "../shared/org";
import type { AccessBasis, GrantBasis, PermitScope } from "../shared/things";
import { grantBasisOf, PERMIT_SCOPES, thingsConfigOf } from "../shared/things";
import { belongsTo, isStaff, orgPlaces, orgPower, orgTypeOf, ownsThrough, placeEntry } from "./org";
import { optionalQuery, own } from "./pack-kit";
import { together } from "./presence";
import type { ReadContext } from "./registry";
import { isGone, kindIs, placeOfEntity, placeWithin } from "./scope";
import { isMemberOf } from "./selector";
import type { WorldState } from "./state";
import { holdersOf, possessorOf, sizeOf, whoseOf, type ThingContext } from "./things";

export interface UseGrant {
  who: EntityId;
  /** When the grant ends (a lend); absent, it stands (an assignment). */
  until?: number;
}

export interface Access {
  /** Its owners, each with their role and their share of its worth in percent. */
  owners: (Owner & { worth: number })[];
  /** Who may use it by a grant still in force. */
  users: UseGrant[];
}

/** Who owns and may use `id`. */
export function accessOf(state: Readonly<WorldState>, id: EntityId): Access {
  const e = own(state.entities, id);
  if (!e) return { owners: [], users: [] };
  const owners = ownersIn(e.fields);
  const worth = worthShares(owners);
  const users: UseGrant[] = [];
  for (const [who, other] of Object.entries(state.entities)) {
    for (const r of other.relations) {
      if (r.type !== "uses" || r.to !== id) continue;
      if (typeof r.until === "number" && r.until < state.clock) continue;
      users.push(typeof r.until === "number" ? { who, until: r.until } : { who });
    }
  }
  return { owners: owners.map((o) => ({ ...o, worth: worth[o.party] ?? 0 })), users };
}

/**
 * Whether `who` owns `id`: on its owners, its holder, or a member by `member_of` of a group that owns
 * it; never through a company, whose things aren't its staff's or its officers' (ORG-SPEC §3.2).
 */
export function owns(ctx: Pick<ReadContext, "registry" | "world" | "state">, who: EntityId, id: EntityId): boolean {
  const e = own(ctx.state.entities, id);
  if (!e) return false;
  if (heldBy(ctx.state.entities, id, who)) return true;
  return ownersIn(e.fields).some((o) => ownsThrough(ctx, who, o.party));
}

// ---------------------------------------------------------------- the access resolver

/** What a use or a disposal rests on (§3.4): its basis, and the organization, person or link behind it. */
export interface AccessAnswer {
  basis: AccessBasis;
  /** The organization, owner, permitter or employer it is through. */
  via?: EntityId;
  /** The position or job that gives it, when one does. */
  by?: EntityId;
  /** A use grant's own basis and end. */
  grant?: GrantBasis;
  until?: number;
  /** It rests on an owner the place presumes (§4.2), not one stated. */
  presumed?: true;
}

/** Whether `who` may use a thing, and dispose of it (consume, give away, sell, destroy), each with what it rests on, or null. */
export interface ThingAccess {
  use: AccessAnswer | null;
  dispose: AccessAnswer | null;
}

const NO_ACCESS: ThingAccess = { use: null, dispose: null };

/** Whether a relation from `a` to `b`, or from `b` to `a`, is one of `types` (a symmetric pair is kept on both sides; this reads either). */
function related(state: Readonly<WorldState>, a: EntityId, b: EntityId, types: readonly string[]): boolean {
  const between = (x: EntityId, y: EntityId): boolean => own(state.entities, x)?.relations.some((r) => r.to === y && types.includes(r.type)) ?? false;
  return between(a, b) || between(b, a);
}

/** Whether a thing is at `home` (a place someone lives): somewhere within it, in the same building or site. */
export function atHome(ctx: ThingContext, at: PlaceId | null, home: unknown): boolean {
  return typeof home === "string" && at !== null && own(ctx.world.places, home) !== undefined && placeWithin(ctx.world, at, home) && together(ctx.world, at, home);
}

/** The people a household or person shares a household with `who` in: a household organization they both belong to. */
function shareHousehold(ctx: ThingContext, who: EntityId, other: EntityId): boolean {
  return Object.keys(ctx.state.entities).some((h) => orgTypeOf(ctx, h) === "household" && !isGone(ctx.state, h) && isMemberOf(ctx, who, h) && isMemberOf(ctx, other, h));
}

/** A `permits` from `from` to `who` in force at the clock, and its scope. */
function permitOf(state: Readonly<WorldState>, from: EntityId, who: EntityId): PermitScope | null {
  const r = own(state.entities, from)?.relations.find((x) => x.type === "permits" && x.to === who && (x.until === undefined || x.until >= state.clock));
  if (!r) return null;
  const scope = r.fields?.scope;
  return (PERMIT_SCOPES as readonly unknown[]).includes(scope) ? (scope as PermitScope) : "all";
}

/** Who a set `access` admits beyond the owner, from `who`'s side: the step they stand on, or null for none short of public. */
function audienceStep(ctx: ThingContext, who: EntityId, owner: EntityId, at: PlaceId | null): { step: Audience; basis: AccessBasis } | null {
  const org = orgTypeOf(ctx, owner) !== null;
  if (org ? belongsTo(ctx, who, owner) : shareHousehold(ctx, who, owner)) return { step: "members", basis: org ? "member" : "household" };
  if (isStaff(ctx, who, owner)) return { step: "staff", basis: "staff" };
  if (at !== null && admits(placeEntry(ctx, at, ctx.state.clock), "customers")) return { step: "customers", basis: "customer" };
  return null;
}

/**
 * Whether `who` may use and dispose of `thing` (§3.4), the first answer winning: the owner (an
 * organization's powers by its hook), a use grant in force, a standing permission from an owner,
 * then (while the thing's `access` is unset) the world's implied rules, or else its `access`. An
 * unowned thing nobody is presumed to own is anyone's to use. Disposal is the owner's alone; for an
 * organization, whom its hook says.
 */
export function accessFor(ctx: ThingContext, who: EntityId, thing: EntityId): ThingAccess {
  const e = own(ctx.state.entities, thing);
  if (!e || isGone(ctx.state, thing) || !own(ctx.state.entities, who)) return NO_ACCESS;
  const whose = whoseOf(ctx, thing);
  const presumed = whose.presumed !== undefined ? { presumed: true as const } : {};
  // 1. The owner.
  for (const owner of whose.owners) {
    if (owner === who) return { use: { basis: "owner", ...presumed }, dispose: { basis: "owner", ...presumed } };
    if (orgTypeOf(ctx, owner) === null) continue;
    const use = orgPower(ctx, who, owner, "assets.use", thing);
    if (!use) continue;
    const dispose = orgPower(ctx, who, owner, "assets.dispose", thing);
    const answer = (g: { basis: AccessBasis; id?: EntityId }): AccessAnswer => ({ basis: g.basis, via: owner, ...(g.id !== undefined ? { by: g.id } : {}), ...presumed });
    return { use: answer(use), dispose: dispose ? answer(dispose) : null };
  }
  const use = useFor(ctx, who, thing, whose.owners, presumed);
  return { use, dispose: null };
}

/** Use without owning (steps 2 to 5 of `accessFor`). */
function useFor(ctx: ThingContext, who: EntityId, thing: EntityId, owners: readonly EntityId[], presumed: { presumed?: true }): AccessAnswer | null {
  const state = ctx.state;
  const e = own(state.entities, thing);
  if (!e) return null;
  // 2. A use grant in force.
  const grant = own(state.entities, who)?.relations.find((r) => r.type === "uses" && r.to === thing && (r.until === undefined || r.until >= state.clock));
  if (grant) return { basis: "grant", grant: grantBasisOf(grant.fields, grant.until), ...(grant.until !== undefined ? { until: grant.until } : {}), ...(typeof grant.fields?.by === "string" ? { via: grant.fields.by } : {}) };
  const at = placeOfEntity(state, thing);
  // 3. A standing permission from an owner: all their things, or those at their home.
  for (const owner of owners) {
    const scope = permitOf(state, owner, who);
    if (scope === null) continue;
    const home = own(state.entities, owner)?.fields.home;
    if (scope === "all" || atHome(ctx, at, home) || (orgTypeOf(ctx, owner) !== null && orgPlaces(ctx, owner).some((p) => at !== null && placeWithin(ctx.world, at, p)))) return { basis: "permit", via: owner, ...presumed };
  }
  const access = e.fields.access;
  if (isAudience(access)) {
    // 5. Its own access, in place of the implied rules: each step admits those before it.
    if (access === "public") return { basis: "public" };
    for (const owner of owners) {
      const step = audienceStep(ctx, who, owner, at);
      if (step && admits(access, step.step)) return { basis: step.basis, via: owner, ...presumed };
    }
    return null;
  }
  // 4. The world's implied rules, in the order the world lists them.
  const rules = thingsConfigOf(ctx.world).access;
  const mine = own(state.entities, who)?.fields.home;
  const people = owners.filter((o) => orgTypeOf(ctx, o) === null && own(state.entities, o) !== undefined);
  if (rules.household) {
    const kin = people.find((o) => own(state.entities, o)?.fields.home === mine && atHome(ctx, at, mine) && shareHousehold(ctx, who, o));
    if (kin !== undefined) return { basis: "household", via: kin, ...presumed };
  }
  if (rules.housemates && typeof mine === "string" && atHome(ctx, at, mine)) {
    // At a shared home: what the home's owners own, and what nobody does.
    const homeOwners = new Set<EntityId>();
    for (const p of Object.keys(state.entities)) {
      const prop = own(state.entities, p);
      if (prop && prop.fields.place === mine && kindIs(ctx.registry, ctx.world, prop.kind, "property") && !isGone(state, p)) for (const o of ownersIn(prop.fields)) homeOwners.add(o.party);
    }
    const stated = ownersIn(e.fields).map((o) => o.party);
    if (stated.length === 0 || stated.some((o) => homeOwners.has(o))) return { basis: "housemate", ...(owners[0] !== undefined ? { via: owners[0] } : {}), ...presumed };
  }
  if (rules.partners) {
    const partner = people.find((o) => related(state, who, o, ["partner_of", "spouse_of"]));
    if (partner !== undefined) return { basis: "partner", via: partner, ...presumed };
  }
  if (rules.family) {
    const kin = people.find((o) => related(state, who, o, ["parent_of", "child_of", "sibling_of"]));
    if (kin !== undefined) return { basis: "family", via: kin, ...presumed };
  }
  const atTheirs = (owner: EntityId): boolean => at !== null && orgPlaces(ctx, owner).some((p) => placeWithin(ctx.world, at, p));
  if (rules.staff) {
    for (const owner of owners) {
      const staff = isStaff(ctx, who, owner);
      if (staff && atTheirs(owner)) return { basis: "staff", via: owner, by: staff.id, ...presumed };
    }
  }
  if (rules.customers && at !== null) {
    const size = sizeOf(ctx, thing).size;
    const business = owners.find((o) => orgTypeOf(ctx, o) === "company" && atTheirs(o));
    if (business !== undefined && (size === "furniture" || size === "builtin") && admits(placeEntry(ctx, at, state.clock), "customers")) return { basis: "customer", via: business, ...presumed };
  }
  // Nobody's: anyone's to use.
  return owners.length === 0 ? { basis: "public" } : null;
}

/**
 * Whether `who` may lend `thing` out or let someone use it (`assets.assign`; by default, whoever
 * may dispose of it), with what it rests on, or null.
 */
export function assignFor(ctx: ThingContext, who: EntityId, thing: EntityId): AccessAnswer | null {
  if (!own(ctx.state.entities, thing) || isGone(ctx.state, thing)) return null;
  const whose = whoseOf(ctx, thing);
  const presumed = whose.presumed !== undefined ? { presumed: true as const } : {};
  for (const owner of whose.owners) {
    if (owner === who) return { basis: "owner", ...presumed };
    const power = orgTypeOf(ctx, owner) !== null ? orgPower(ctx, who, owner, "assets.assign", thing) : null;
    if (power) return { basis: power.basis, via: owner, ...(power.id !== undefined ? { by: power.id } : {}), ...presumed };
  }
  return null;
}

// ---------------------------------------------------------------- reach

/** How far a thing is from someone (§4.5). */
export interface Reach {
  reach: "on" | "here" | "nearby" | "away";
  /** Where it is (null: nowhere, lost). */
  place: PlaceId | null;
  /** Here, on someone else: who has it. */
  on?: EntityId;
  /** Here, in a holder they may not open: that holder. */
  shut?: EntityId;
  /** Nearby: the minutes on foot a fetch takes. */
  minutes?: number;
}

/**
 * How far `thing` is from `who` (§4.5): on them (in their holders); here, at their place, loose,
 * in holders they may open, or a fixture (`on` names someone else who has it, `shut` a holder they
 * may not open); nearby, at the same site within the world's fetch minutes on foot; else away.
 */
export function reachOf(ctx: ReadContext, who: EntityId, thing: EntityId): Reach {
  const place = placeOfEntity(ctx.state, thing);
  const holders = holdersOf(ctx.state, thing);
  if (holders.includes(who)) return { reach: "on", place };
  const mine = placeOfEntity(ctx.state, who);
  if (place === null || mine === null) return { reach: "away", place };
  if (place === mine) {
    const on = possessorOf(ctx, thing);
    if (on !== null) return { reach: "here", place, on };
    const shut = holders.find((h) => accessFor(ctx, who, h).use === null);
    return shut !== undefined ? { reach: "here", place, shut } : { reach: "here", place };
  }
  if (together(ctx.world, mine, place)) {
    const minutes = optionalQuery(ctx, "space.route")?.(ctx, mine, place, "walk")?.minutes;
    if (minutes !== undefined && minutes <= thingsConfigOf(ctx.world).fetchMinutes) return { reach: "nearby", place, minutes };
  }
  return { reach: "away", place };
}
