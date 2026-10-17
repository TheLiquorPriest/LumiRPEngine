// Classification facets (DESIGN §4.1): pure lookups over a world's facets and a facet's value tree,
// shared by the engine (selectors, lint, the Cast view) and the UI (Build's editors, Cast's filters).

import { hasOwn, isRecord } from "./json";
import type { FacetDef, FacetId, FacetValueDef, FacetValueId, WorldDoc } from "./world";

/** How deep a value's parent chain is followed: a cycle (linted) ends the walk. */
const NESTING_DEPTH = 16;

/** Whether `value` is `ancestor` or nests under it, following `parent` links. */
export function withinValue(values: Readonly<Record<FacetValueId, { parent?: FacetValueId }>>, value: FacetValueId, ancestor: FacetValueId): boolean {
  let current: FacetValueId | undefined = value;
  for (let depth = 0; current !== undefined && depth < NESTING_DEPTH; depth++) {
    if (current === ancestor) return true;
    current = hasOwn(values, current) ? values[current]?.parent : undefined;
  }
  return false;
}

/** The world's facets, lowest `order` first (unordered ones last), then by label. */
export function facetsInOrder(world: Pick<WorldDoc, "classifications">): [FacetId, FacetDef][] {
  if (!isRecord(world.classifications)) return [];
  const rank = (f: FacetDef): number => (typeof f.order === "number" && Number.isFinite(f.order) ? f.order : Number.MAX_SAFE_INTEGER);
  const name = (id: FacetId, f: FacetDef): string => (typeof f.label === "string" ? f.label : id);
  return Object.entries(world.classifications)
    .filter(([, f]) => isRecord(f) && isRecord(f.values))
    .sort(([a, fa], [b, fb]) => rank(fa) - rank(fb) || name(a, fa).localeCompare(name(b, fb)) || a.localeCompare(b));
}

/**
 * A facet's values depth first: each value, then the values nested under it, siblings in their
 * authored order. Values whose parent is missing are roots; values caught in a parent cycle (lint
 * flags them) come last, at the top level.
 */
export function facetTree(values: Readonly<Record<FacetValueId, FacetValueDef>>): { id: FacetValueId; value: FacetValueDef; depth: number }[] {
  const ids = Object.keys(values);
  const out: { id: FacetValueId; value: FacetValueDef; depth: number }[] = [];
  const seen = new Set<FacetValueId>();
  const visit = (id: FacetValueId, depth: number): void => {
    const value = values[id];
    if (!value || seen.has(id)) return;
    seen.add(id);
    out.push({ id, value, depth });
    for (const child of ids) if (values[child]?.parent === id) visit(child, depth + 1);
  };
  for (const id of ids) {
    const parent = values[id]?.parent;
    if (parent === undefined || !hasOwn(values, parent)) visit(id, 0);
  }
  for (const id of ids) visit(id, 0);
  return out;
}
