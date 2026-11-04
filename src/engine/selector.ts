// Selectors (DESIGN §4.1): which entities a rule, schedule, visibility grant, filter or grouping
// applies to. Classes and tags are definitional, so they are read live from the world for the
// entities it defines (an Upgrade reclassifies a running chat) and from state for spawned ones,
// those whose own an Upgrade kept, and those a GM classified; kind follows inheritance; tier, group
// membership, the party and positions come from the folded state, where play can change them. A
// removed entity (`isGone`) matches no selector and is no group's member, so no caller has to filter
// it out; GM views and Upgrade read state directly and still see it.
//
// Membership (ORG-SPEC §3.2) is one reader over every organization: a group's `member_of` links,
// nested, and the rows each kind's membership providers add (a business's owners, every employer's
// staff, a party's travellers). A company's staff are its members; anyone else's staff only work
// for it. A member group's members count through it.

import type { EntityId } from "../shared/ids";
import { withinValue } from "../shared/classes";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { JsonValue } from "../shared/json";
import { positionsIn, type OrgMember } from "../shared/org";
import { isPartyTier, PARTY_RELATION, PARTY_TIERS, partyTierOf } from "../shared/party";
import { tierOf } from "../shared/tiers";
import type { FacetId, FacetValueId, Selector, WorldDoc } from "../shared/world";
import { passMemo } from "./read-pass";
import type { MembershipProvider, ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { isGone, kindDef, kindIs, kindParent } from "./scope";
import type { WorldState } from "./state";

/** What a membership question reads: the registry's kinds and providers, the world and the state. */
export type MembershipContext = Pick<ReadContext, "registry" | "world" | "state">;

/** The relation that makes an entity a member of a group. */
export const MEMBER_OF = "member_of";
/** The kind every group extends: factions, families, households, companies and an author's own. */
export const GROUP_KIND = "group";
/** The kind a company is: the economy's business and every kind extending it. */
export const COMPANY_KIND = "business";
/** How deep group nesting is followed (a crew in a guild in a city's council). */
const MEMBERSHIP_DEPTH = 8;

/** Where an entity's classes and tags live: its state when it holds them (spawned, kept through an Upgrade, or set by a GM edit), else the world's definition. */
function definitional(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): { class?: Record<FacetId, FacetValueId[]>; tags?: string[] } | undefined {
  const held = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  if (held && (held.class !== undefined || held.tags !== undefined)) return held;
  return hasOwn(world.entities, id) ? world.entities[id] : held;
}

/** The entity's values for a facet. */
export function classValues(world: WorldDoc, state: Readonly<WorldState>, id: EntityId, facet: FacetId): readonly FacetValueId[] {
  const def = definitional(world, state, id);
  const values = def?.class && hasOwn(def.class, facet) ? def.class[facet] : undefined;
  return Array.isArray(values) ? values : [];
}

/** Whether `value` is `ancestor` or nests under it in the facet's value tree. */
export function valueWithin(world: WorldDoc, facet: FacetId, value: FacetValueId, ancestor: FacetValueId): boolean {
  const def = hasOwn(world.classifications, facet) ? world.classifications[facet] : undefined;
  return value === ancestor || (def !== undefined && withinValue(def.values, value, ancestor));
}

/** Whether the entity holds an accepted value of the facet, or a value nested under one. */
export function inClass(world: WorldDoc, state: Readonly<WorldState>, id: EntityId, facet: FacetId, accepted: readonly FacetValueId[]): boolean {
  return classValues(world, state, id, facet).some((v) => accepted.some((a) => valueWithin(world, facet, v, a)));
}

export function tagsOf(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): readonly string[] {
  const tags = definitional(world, state, id)?.tags;
  return Array.isArray(tags) ? tags : [];
}

/** Whether `id` is a member of `group` by `member_of` links alone, directly or through groups that are members of it; the walk never passes through a group `stop` names. */
export function linkedMemberOf(state: Readonly<WorldState>, id: EntityId, group: EntityId, stop?: (via: EntityId) => boolean): boolean {
  let frontier: EntityId[] = [id];
  const seen = new Set<EntityId>([id]);
  for (let depth = 0; frontier.length > 0 && depth < MEMBERSHIP_DEPTH; depth++) {
    const next: EntityId[] = [];
    for (const member of frontier) {
      for (const r of state.entities[member]?.relations ?? []) {
        if (r.type !== MEMBER_OF) continue;
        if (r.to === group) return true;
        if (!seen.has(r.to) && !stop?.(r.to)) {
          seen.add(r.to);
          next.push(r.to);
        }
      }
    }
    frontier = next;
  }
  return false;
}

/** The rows of `member_of` links to `org`: each linked member with its title, position, rank and since, in id order (the group kind's provider). */
export function linkRows(ctx: MembershipContext, org: EntityId): OrgMember[] {
  const out: OrgMember[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const link = ctx.state.entities[id]?.relations.find((r) => r.type === MEMBER_OF && r.to === org);
    if (!link) continue;
    const f = isRecord(link.fields) ? link.fields : {};
    out.push({
      who: id,
      how: "member",
      ...(typeof f.role === "string" && f.role !== "" ? { title: f.role } : {}),
      ...(typeof f.position === "string" && f.position !== "" ? { position: f.position } : {}),
      ...(typeof f.rank === "number" ? { rank: f.rank } : {}),
      ...(typeof f.since === "string" && f.since !== "" ? { since: f.since } : {}),
    });
  }
  return out;
}

/** The membership providers up a kind's chain, the most general first, each kind's in registration order (a business: the group's member links and staff, then its owners). */
export function providersOf(reg: Registry, world: WorldDoc, kind: string): { kind: string; provider: MembershipProvider }[] {
  const out: { kind: string; provider: MembershipProvider }[] = [];
  for (let id: string | undefined = kind, guard = 0; id && guard < 32; id = kindParent(reg, world, id), guard++) {
    const providers = reg.memberships.get(id) ?? [];
    out.unshift(...providers.map((provider) => ({ kind: id as string, provider })));
  }
  return out;
}

/**
 * Everyone who belongs to `group` by a tie other than a `member_of` link: a row the providers give an
 * organization that is `group`, or a member of it by links (a business in a family brings its owners
 * and staff; only member groups nest), but for staff of anything other than a company, who work for
 * it without belonging to it (ORG-SPEC §3.1).
 */
function tiedTo(ctx: MembershipContext, group: EntityId): ReadonlySet<EntityId> {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.tied:${group}`, () => {
    const out = new Set<EntityId>();
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const e = ctx.state.entities[id];
      if (!e || isGone(ctx.state, id)) continue;
      const ties = providersOf(ctx.registry, ctx.world, e.kind).filter((p) => p.provider !== linkRows);
      if (ties.length === 0 || (id !== group && !linkedMemberOf(ctx.state, id, group))) continue;
      const company = kindIs(ctx.registry, ctx.world, e.kind, COMPANY_KIND);
      for (const { provider } of ties) for (const row of provider(ctx, id)) if (row.how !== "member" && (row.how !== "staff" || company)) out.add(row.who);
    }
    return out;
  });
}

/** Whether `id` is a member of `group` (an organization of any type), directly or through groups that are members of it. */
export function isMemberOf(ctx: MembershipContext, id: EntityId, group: EntityId): boolean {
  return linkedMemberOf(ctx.state, id, group) || tiedTo(ctx, group).has(id);
}

/** Whether the entity's kind is `group` or extends it. */
export function isGroup(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  const e = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  return !!e && kindIs(reg, world, e.kind, GROUP_KIND);
}

/** A group's members that aren't groups themselves (people, things), directly or through member groups, in id order; removed ones aren't members. */
export function membersOf(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, group: EntityId): EntityId[] {
  const ctx: MembershipContext = { registry: reg, world, state };
  return Object.keys(state.entities)
    .sort()
    .filter((id) => id !== group && !isGroup(reg, world, state, id) && !isGone(state, id) && isMemberOf(ctx, id, group));
}

/** Whether `id` is in the player character's party (`travels_with` it) in one of `tiers`; the leader is in none. */
function inParty(world: WorldDoc, state: Readonly<WorldState>, id: EntityId, tiers: readonly string[]): boolean {
  const link = state.entities[id]?.relations.find((r) => r.type === PARTY_RELATION && r.to === world.pov);
  return link !== undefined && tiers.includes(partyTierOf(link.fields));
}

/** Whether `id` holds one of `positions` (by its `member_of` link or its job) in one of `orgs`, or in any organization when none is named. */
function holdsPosition(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId, positions: readonly string[], orgs: readonly EntityId[] | undefined): boolean {
  const ctx: MembershipContext = { registry: reg, world, state };
  const held = (org: EntityId, position: unknown): boolean =>
    typeof position === "string" && positions.includes(position) && (orgs === undefined || orgs.some((o) => o === org || linkedMemberOf(state, org, o))) && positionsIn(state.entities[org]?.fields.positions).some((p) => p.id === position);
  if (state.entities[id]?.relations.some((r) => r.type === MEMBER_OF && held(r.to, r.fields?.position))) return true;
  for (const [org, e] of Object.entries(state.entities)) {
    if (isGone(state, org)) continue;
    // Member links were read above, from the relations themselves.
    for (const { provider } of providersOf(reg, world, e.kind)) {
      if (provider === linkRows) continue;
      if (provider(ctx, org).some((row) => row.who === id && held(org, row.position))) return true;
    }
  }
  return false;
}

/** Whether the selector matches the entity; a removed entity matches none. */
export function selectorMatches(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, selector: Readonly<Selector>, id: EntityId): boolean {
  const entity = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  if (!entity || isGone(state, id)) return false;
  if (selector.ids && !selector.ids.includes(id)) return false;
  if (selector.kind && !selector.kind.some((k) => kindIs(reg, world, entity.kind, k))) return false;
  if (selector.tier && !selector.tier.includes(entity.tier)) return false;
  if (selector.tag && !selector.tag.some((t) => tagsOf(world, state, id).includes(t))) return false;
  if (selector.class) {
    for (const [facet, accepted] of Object.entries(selector.class)) if (!inClass(world, state, id, facet, accepted)) return false;
  }
  if (selector.memberOf && !selector.memberOf.some((g) => isMemberOf({ registry: reg, world, state }, id, g))) return false;
  if (selector.party && !inParty(world, state, id, selector.party)) return false;
  if (selector.position && !holdsPosition(reg, world, state, id, selector.position, selector.memberOf)) return false;
  return true;
}

/** Every entity the selector matches, in id order. */
export function selectEntities(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, selector: Readonly<Selector>): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => selectorMatches(reg, world, state, selector, id))
    .sort();
}

function stringsIn(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

/**
 * What a selector names that the world doesn't have, for lint: each a phrase that follows "it"
 * ("names an unknown kind …"). Tags are free-form, so they are never wrong.
 */
export function selectorProblems(reg: Registry, world: WorldDoc, selector: unknown): string[] {
  if (!isRecord(selector)) return ["isn't a selector"];
  const out: string[] = [];
  const list = (key: string): string[] => {
    const v = selector[key];
    if (v === undefined) return [];
    const items = stringsIn(v);
    if (items === null) out.push(`has a "${key}" that isn't a list`);
    return items ?? [];
  };
  for (const id of list("ids")) if (!hasOwn(world.entities, id)) out.push(`names "${id}", which isn't in the world`);
  for (const kind of list("kind")) if (!kindDef(reg, world, kind)) out.push(`names an unknown kind "${kind}"`);
  for (const tier of list("tier")) if (!tierOf(world, tier)) out.push(`names tier "${tier}", which isn't one of the world's tiers`);
  const groups = list("memberOf");
  for (const group of groups) {
    const e = hasOwn(world.entities, group) ? world.entities[group] : undefined;
    if (!e) out.push(`names the group "${group}", which isn't in the world`);
    else if (providersOf(reg, world, e.kind).length === 0) out.push(`names ${e.name} as a group, but it isn't an organization`);
  }
  for (const tier of list("party")) if (!isPartyTier(tier)) out.push(`names the party tier "${tier}", which isn't one of ${PARTY_TIERS.join(", ")}`);
  for (const position of list("position")) {
    const where = groups.length > 0 ? groups : Object.keys(world.entities);
    if (!where.some((org) => positionsIn((hasOwn(world.entities, org) ? world.entities[org] : undefined)?.fields.positions).some((p) => p.id === position))) out.push(`names the position "${position}", which no organization${groups.length > 0 ? " it names" : ""} defines`);
  }
  list("tag");
  const classes = selector.class;
  if (classes !== undefined && !isRecord(classes)) out.push("has a class that isn't a facet → values map");
  if (isRecord(classes)) {
    for (const [facet, values] of Object.entries(classes)) {
      const def = hasOwn(world.classifications, facet) ? world.classifications[facet] : undefined;
      if (!def) {
        out.push(`names an unknown classification "${facet}"`);
        continue;
      }
      for (const v of stringsIn(values) ?? []) if (!hasOwn(def.values, v)) out.push(`names "${v}", which isn't a value of ${def.label}`);
    }
  }
  return out;
}

export interface ClassProblem {
  code: "unknown_facet" | "unknown_class" | "single_class";
  message: string;
}

/**
 * Problems with a class assignment (an entity's `class`, a spawn's), named after `who`: a facet
 * the world doesn't define, a value the facet doesn't have, or several values on a single-valued facet.
 */
export function classProblems(world: WorldDoc, value: unknown, who: string): ClassProblem[] {
  if (value === undefined) return [];
  if (!isRecord(value)) return [{ code: "unknown_facet", message: `${who}'s classification isn't a facet → values map.` }];
  const out: ClassProblem[] = [];
  for (const [facet, raw] of Object.entries(value)) {
    const def = hasOwn(world.classifications, facet) ? world.classifications[facet] : undefined;
    if (!def) {
      out.push({ code: "unknown_facet", message: `${who} is classed under "${facet}", which isn't one of the world's classifications.` });
      continue;
    }
    const values = stringsIn(raw);
    if (values === null || values.length !== (Array.isArray(raw) ? raw.length : -1)) {
      out.push({ code: "unknown_class", message: `${who}'s ${def.label} isn't a list of values.` });
      continue;
    }
    for (const v of values) if (!hasOwn(def.values, v)) out.push({ code: "unknown_class", message: `${who} is classed as "${v}", which isn't a value of ${def.label}.` });
    if (!def.multiple && values.length > 1) out.push({ code: "single_class", message: `${who} holds ${values.length} ${def.label} values; ${def.label} takes one.` });
  }
  return out;
}

/** A class assignment as given (facet → values, a lone string read as one value); null when it isn't one. */
export function classOf(value: JsonValue | undefined): Record<FacetId, FacetValueId[]> | null {
  if (!isRecord(value)) return null;
  const out: Record<FacetId, FacetValueId[]> = {};
  for (const [facet, raw] of Object.entries(value)) {
    if (!safeKey(facet)) return null;
    const values = typeof raw === "string" ? [raw] : stringsIn(raw);
    if (values === null) return null;
    if (values.length > 0) out[facet] = [...new Set(values)];
  }
  return out;
}
