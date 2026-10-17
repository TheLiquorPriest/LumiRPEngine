// Selectors (DESIGN §4.1): which entities a rule, schedule, visibility grant, filter or grouping
// applies to. Classes and tags are definitional, so they are read live from the world (an Upgrade
// reclassifies a running chat); kind follows inheritance; tier and group membership come from
// the folded state, where play can change them.

import type { EntityId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import type { FacetId, FacetValueId, Selector, WorldDoc } from "../shared/world";
import type { Registry } from "./registry-impl";
import { kindIs } from "./scope";
import type { WorldState } from "./state";

/** The relation that makes an entity a member of a group. */
export const MEMBER_OF = "member_of";
/** How deep group nesting is followed (a crew in a guild in a city's council). */
const MEMBERSHIP_DEPTH = 8;
/** How deep a facet value's parent chain is followed. */
const NESTING_DEPTH = 16;

/** The entity's values for a facet, as the world defines them (spawned entities have none). */
export function classValues(world: WorldDoc, id: EntityId, facet: FacetId): readonly FacetValueId[] {
  const def = hasOwn(world.entities, id) ? world.entities[id] : undefined;
  const values = def?.class && hasOwn(def.class, facet) ? def.class[facet] : undefined;
  return Array.isArray(values) ? values : [];
}

/** Whether `value` is `ancestor` or nests under it in the facet's value tree. */
export function valueWithin(world: WorldDoc, facet: FacetId, value: FacetValueId, ancestor: FacetValueId): boolean {
  const def = hasOwn(world.classifications, facet) ? world.classifications[facet] : undefined;
  let current: FacetValueId | undefined = value;
  for (let depth = 0; current !== undefined && depth < NESTING_DEPTH; depth++) {
    if (current === ancestor) return true;
    current = def && hasOwn(def.values, current) ? def.values[current]?.parent : undefined;
  }
  return false;
}

/** Whether the entity holds an accepted value of the facet, or a value nested under one. */
export function inClass(world: WorldDoc, id: EntityId, facet: FacetId, accepted: readonly FacetValueId[]): boolean {
  return classValues(world, id, facet).some((v) => accepted.some((a) => valueWithin(world, facet, v, a)));
}

export function tagsOf(world: WorldDoc, id: EntityId): readonly string[] {
  const tags = hasOwn(world.entities, id) ? world.entities[id]?.tags : undefined;
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

export function selectorMatches(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, selector: Readonly<Selector>, id: EntityId): boolean {
  const entity = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  if (!entity) return false;
  if (selector.ids && !selector.ids.includes(id)) return false;
  if (selector.kind && !selector.kind.some((k) => kindIs(reg, world, entity.kind, k))) return false;
  if (selector.tier && !selector.tier.includes(entity.tier)) return false;
  if (selector.tag && !selector.tag.some((t) => tagsOf(world, id).includes(t))) return false;
  if (selector.class) {
    for (const [facet, accepted] of Object.entries(selector.class)) if (!inClass(world, id, facet, accepted)) return false;
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
