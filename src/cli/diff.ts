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

/** One item of a world as the tools read it: an item of a collection, an entry of a pack's config map, or a part of the world whole. */
export interface WorldItem {
  /** The collection (`entities`), the pack config map (`products`), or the part (`calendar`). */
  collection: string;
  /** Empty for a part. */
  id: string;
  pointer: string;
  value: unknown;
}

/** A pack's config map keyed by id (the economy's `products` and `assets`): an object of objects, read as a collection is. */
export function idMap(value: unknown): value is Record<string, Record<string, unknown>> {
  return isRecord(value) && Object.values(value).every(isRecord);
}

/**
 * One pack as the items it is read in: the pack itself with its config's id maps taken out, then
 * each map's entries as a collection named by the map's key, so a product or an asset is an item
 * with its own name and pointer, not a line deep inside the pack.
 */
export function packItems(id: string, pack: unknown): WorldItem[] {
  const self = (value: unknown): WorldItem => ({ collection: "packs", id, pointer: pointerOf(["packs", id]), value });
  const config = isRecord(pack) && isRecord(pack.config) ? pack.config : null;
  if (!isRecord(pack) || config === null) return [self(pack)];
  const entries = Object.entries(config).filter(([key]) => !isPrototypeKey(key));
  const maps = entries.filter((e): e is [string, Record<string, Record<string, unknown>>] => idMap(e[1]));
  if (maps.length === 0) return [self(pack)];
  const rest = Object.fromEntries(entries.filter(([, value]) => !idMap(value)));
  const opened = maps.flatMap(([name, map]) => Object.entries(map).flatMap(([entry, value]) => (isPrototypeKey(entry) ? [] : [{ collection: name, id: entry, pointer: pointerOf(["packs", id, "config", name, entry]), value }])));
  return [self({ ...pack, config: rest }), ...opened];
}

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

export interface Change {
  /** The item's (or part's) JSON Pointer: `/entities/mara`, `/calendar`, `/packs/economy/config/products/gull_card`. */
  key: string;
  label: string;
  kind: "added" | "changed" | "removed";
}

/**
 * Every change from one world document to another, collections item by item (a pack's config
 * maps entry by entry), in document order. A key that reaches a prototype (`__proto__`) is no
 * part of a world, whatever a document holds, so it is no change either.
 */
export function changesBetween(from: unknown, to: unknown): Change[] {
  const a = isRecord(from) ? from : {};
  const b = isRecord(to) ? to : {};
  const out: Change[] = [];
  const compare = (was: WorldItem | undefined, now: WorldItem | undefined): void => {
    const item = now ?? was;
    if (item === undefined || jsonEqual(was?.value, now?.value)) return;
    const name = nameOf(now?.value) ?? nameOf(was?.value);
    const label = item.id === "" ? item.collection : `${item.collection} › ${name !== null && name !== item.id ? `${name} (${item.id})` : item.id}`;
    out.push({ key: item.pointer, label, kind: was?.value === undefined ? "added" : now?.value === undefined ? "removed" : "changed" });
  };
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
        if (key !== "packs") {
          compare(was === undefined ? undefined : { collection: key, id, pointer: pointerOf([key, id]), value: was }, now === undefined ? undefined : { collection: key, id, pointer: pointerOf([key, id]), value: now });
          continue;
        }
        // A pack changes entry by entry: an added product is that product, not the whole pack.
        const wasItems = new Map((was === undefined ? [] : packItems(id, was)).map((i) => [i.pointer, i]));
        const nowItems = new Map((now === undefined ? [] : packItems(id, now)).map((i) => [i.pointer, i]));
        for (const pointer of new Set([...wasItems.keys(), ...nowItems.keys()])) compare(wasItems.get(pointer), nowItems.get(pointer));
      }
      continue;
    }
    compare(before === undefined ? undefined : { collection: key, id: "", pointer: pointerOf([key]), value: before }, after === undefined ? undefined : { collection: key, id: "", pointer: pointerOf([key]), value: after });
  }
  return out;
}

/** The collection (or part) a change's pointer belongs to: a pack config map's entry counts under the map (`products`), not under `packs`. */
function groupOf(pointer: string): string {
  const tokens = parsePointer(pointer);
  return tokens.length === 5 && tokens[0] === "packs" && tokens[2] === "config" ? (tokens[3] ?? "") : (tokens[0] ?? "");
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
