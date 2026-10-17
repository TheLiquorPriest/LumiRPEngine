// Selectors (DESIGN §4.1): which entities a rule, schedule, visibility grant, filter or grouping
// applies to. Classes and tags are definitional, so they are read live from the world for the
// entities it defines (an Upgrade reclassifies a running chat) and from state for spawned ones and
// those whose own an Upgrade kept; kind follows inheritance; tier and group membership come from the
// folded state, where play can change them.

import type { EntityId } from "../shared/ids";
import { withinValue } from "../shared/classes";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { JsonValue } from "../shared/json";
import { tierOf } from "../shared/tiers";
import type { FacetId, FacetValueId, Selector, WorldDoc } from "../shared/world";
import type { Registry } from "./registry-impl";
import { kindDef, kindIs } from "./scope";
import type { WorldState } from "./state";

/** The relation that makes an entity a member of a group. */
export const MEMBER_OF = "member_of";
/** The kind every group extends: factions, families, households, companies and an author's own. */
export const GROUP_KIND = "group";
/** How deep group nesting is followed (a crew in a guild in a city's council). */
const MEMBERSHIP_DEPTH = 8;

/** Where an entity's classes and tags live: its state when it holds them (spawned, or kept through an Upgrade), else the world's definition. */
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

/** Whether `id` is a member of `group`, directly or through groups that are members of it. */
export function isMemberOf(state: Readonly<WorldState>, id: EntityId, group: EntityId): boolean {
  let frontier: EntityId[] = [id];
  const seen = new Set<EntityId>([id]);
  for (let depth = 0; frontier.length > 0 && depth < MEMBERSHIP_DEPTH; depth++) {
    const next: EntityId[] = [];
    for (const member of frontier) {
      for (const r of state.entities[member]?.relations ?? []) {
        if (r.type !== MEMBER_OF) continue;
        if (r.to === group) return true;
        if (!seen.has(r.to)) {
          seen.add(r.to);
          next.push(r.to);
        }
      }
    }
    frontier = next;
  }
  return false;
}

/** Whether the entity's kind is `group` or extends it. */
export function isGroup(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  const e = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  return !!e && kindIs(reg, world, e.kind, GROUP_KIND);
}

/** A group's members that aren't groups themselves (people, things), directly or through member groups, in id order. */
export function membersOf(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, group: EntityId): EntityId[] {
  return Object.keys(state.entities)
    .sort()
    .filter((id) => id !== group && !isGroup(reg, world, state, id) && isMemberOf(state, id, group));
}

export function selectorMatches(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, selector: Readonly<Selector>, id: EntityId): boolean {
  const entity = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  if (!entity) return false;
  if (selector.ids && !selector.ids.includes(id)) return false;
  if (selector.kind && !selector.kind.some((k) => kindIs(reg, world, entity.kind, k))) return false;
  if (selector.tier && !selector.tier.includes(entity.tier)) return false;
  if (selector.tag && !selector.tag.some((t) => tagsOf(world, state, id).includes(t))) return false;
  if (selector.class) {
    for (const [facet, accepted] of Object.entries(selector.class)) if (!inClass(world, state, id, facet, accepted)) return false;
  }
  if (selector.memberOf && !selector.memberOf.some((g) => isMemberOf(state, id, g))) return false;
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
  for (const group of list("memberOf")) {
    const e = hasOwn(world.entities, group) ? world.entities[group] : undefined;
    if (!e) out.push(`names the group "${group}", which isn't in the world`);
    else if (!kindIs(reg, world, e.kind, GROUP_KIND)) out.push(`names ${e.name} as a group, but its kind isn't a group`);
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
