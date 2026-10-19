// What changed between two versions of a world (its head, its draft or any revision): the
// collections item by item, every other part whole (the Studio's review), and inside a changed
// item the JSON Pointers whose values differ, capped so a large change still fits one answer.

import { hasOwn, isRecord } from "../shared/json";
import { isPrototypeKey, jsonEqual, parsePointer, pointerOf } from "../shared/json-patch";
import { clip, nameOf } from "./read";

/** The collections of a world (`lre-world-v1`): objects keyed by id, compared item by item. */
const IS_COLLECTION: Record<string, true> = {
  packs: true,
  kinds: true,
  relations: true,
  entities: true,
  places: true,
  routes: true,
  grids: true,
  maps: true,
  rules: true,
  actions: true,
  checks: true,
  schedules: true,
  tracks: true,
  tables: true,
  sections: true,
  steps: true,
  lore: true,
  classifications: true,
  tiers: true,
  lifeStates: true,
};

export function isCollection(key: string): boolean {
  return hasOwn(IS_COLLECTION, key);
}

export interface Change {
  /** The item's (or part's) JSON Pointer: `/entities/mara`, `/calendar`. */
  key: string;
  label: string;
  kind: "added" | "changed" | "removed";
}

/**
 * Every change from one world document to another, collections item by item, in document order.
 * A key that reaches a prototype (`__proto__`) is no part of a world, whatever a document holds, so it is no change either.
 */
export function changesBetween(from: unknown, to: unknown): Change[] {
  const a = isRecord(from) ? from : {};
  const b = isRecord(to) ? to : {};
  const out: Change[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (isPrototypeKey(key)) continue;
    const before = hasOwn(a, key) ? a[key] : undefined;
    const after = hasOwn(b, key) ? b[key] : undefined;
    if (isCollection(key) && isRecord(before) && isRecord(after)) {
      for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (isPrototypeKey(id)) continue;
        const was = hasOwn(before, id) ? before[id] : undefined;
        const now = hasOwn(after, id) ? after[id] : undefined;
        if (jsonEqual(was, now)) continue;
        const name = nameOf(now) ?? nameOf(was);
        out.push({ key: pointerOf([key, id]), label: `${key} › ${name !== null && name !== id ? `${name} (${id})` : id}`, kind: was === undefined ? "added" : now === undefined ? "removed" : "changed" });
      }
      continue;
    }
    if (jsonEqual(before, after)) continue;
    out.push({ key: pointerOf([key]), label: key, kind: before === undefined ? "added" : after === undefined ? "removed" : "changed" });
  }
  return out;
}

export type ChangeCounts = Record<string, Partial<Record<Change["kind"], number>>>;

/** How many items each collection (or part) gained, changed and lost. Null-prototype records: no key, however named, reaches Object.prototype. */
export function countsOf(changes: readonly Change[]): ChangeCounts {
  const counts: ChangeCounts = Object.create(null) as ChangeCounts;
  for (const change of changes) {
    const top = parsePointer(change.key)[0] ?? "";
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
