// A world as the tools read and count it: its items (every collection item by item, every other
// part whole), how many items each collection gained, changed and lost between two versions, and
// inside a changed item the JSON Pointers whose values differ, capped so a large change still fits
// one answer. The comparison itself is `shared/world-diff.ts`'s.

import { hasOwn, isRecord } from "../shared/json";
import { isPrototypeKey, jsonEqual, pointerOf } from "../shared/json-patch";
import { type Change, groupOf, isCollection, packItems, type WorldItem } from "../shared/world-diff";
import { clip } from "./read";

/** A world document as its items: every collection item by item (each pack's config maps opened up), every other part whole. */
export function itemsOf(doc: unknown): WorldItem[] {
  if (!isRecord(doc)) return [];
  const out: WorldItem[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (isPrototypeKey(key)) continue;
    if (!isCollection(key) || !isRecord(value)) {
      out.push({ collection: key, id: "", pointer: pointerOf([key]), value });
      continue;
    }
    for (const [id, item] of Object.entries(value)) {
      if (isPrototypeKey(id)) continue;
      if (key === "packs") out.push(...packItems(id, item));
      else out.push({ collection: key, id, pointer: pointerOf([key, id]), value: item });
    }
  }
  return out;
}

export type ChangeCounts = Record<string, Partial<Record<Change["kind"], number>>>;

/** How many items each collection (or part) gained, changed and lost. Null-prototype records: no key, however named, reaches Object.prototype. */
export function countsOf(changes: readonly Change[]): ChangeCounts {
  const counts: ChangeCounts = Object.create(null) as ChangeCounts;
  for (const change of changes) {
    const top = groupOf(change.key);
    if (isPrototypeKey(top)) continue;
    const row = (counts[top] ??= Object.create(null) as ChangeCounts[string]);
    row[change.kind] = (row[change.kind] ?? 0) + 1;
  }
  return counts;
}

export interface FieldChange {
  path: string;
  kind: "added" | "changed" | "removed";
  from?: string;
  to?: string;
}

/** A value as a diff line shows it. */
const shown = (value: unknown): string => clip(JSON.stringify(value) ?? "null", 120);

/**
 * The leaf-level differences inside one item, as pointers below `base`: keys added or removed,
 * values that differ, lists element by element while their lengths match (a list that grew or
 * shrank is one change). At most `limit` are listed; `more` counts the rest.
 */
export function fieldChanges(before: unknown, after: unknown, base: string, limit: number): { changes: FieldChange[]; more: number } {
  const changes: FieldChange[] = [];
  let more = 0;
  const note = (change: FieldChange): void => {
    if (changes.length < limit) changes.push(change);
    else more++;
  };
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (jsonEqual(a, b)) return;
    if (isRecord(a) && isRecord(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const at = `${path}${pointerOf([key])}`;
        if (!hasOwn(a, key)) note({ path: at, kind: "added", to: shown(b[key]) });
        else if (!hasOwn(b, key)) note({ path: at, kind: "removed", from: shown(a[key]) });
        else walk(a[key], b[key], at);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((v, i) => walk(v, b[i], `${path}/${i}`));
      return;
    }
    note({ path, kind: "changed", from: shown(a), to: shown(b) });
  };
  walk(before, after, base);
  return { changes, more };
}
