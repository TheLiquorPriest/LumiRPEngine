// Searching worlds on the client: every string in every item of a world document, matched against
// the query's words, items that hold all of them first. A hit names the item and the field (a JSON
// Pointer inside the item) that matched best, with a snippet around the match.

import { isRecord } from "../shared/json";
import { pointerOf } from "../shared/json-patch";
import type { WorldItem } from "./diff";
import { cutAt, nameOf } from "./read";

export interface SearchHit {
  worldId: string;
  source: "head" | "draft";
  /** A collection (`entities`), a pack's own collection (`products` in the economy's config), or a part of the world (`calendar`) with an empty `id`. */
  collection: string;
  id: string;
  /** The item's JSON Pointer in the world: `/entities/mara`, `/calendar`, `/packs/economy/config/products/checking`. */
  pointer: string;
  /** An entity's kind (`person`, `account`, `flow`, `household`): money, jobs and households are entities too, told apart by it. */
  kind?: string;
  label: string;
  /** Where in the item it matched, as a JSON Pointer below `pointer` (`/fields/description`). */
  field: string;
  snippet: string;
}

export interface ScoredHit extends SearchHit {
  score: number;
}


/** The query's words, lowercased, each once. */
export function searchWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w !== ""))];
}

/** Every string inside a value, with its pointer below `base`. */
function strings(value: unknown, base: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") out.push({ path: base, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${base}/${i}`, out));
  else if (isRecord(value)) for (const [key, v] of Object.entries(value)) strings(v, `${base}${pointerOf([key])}`, out);
}

/** About 160 characters of `text` around the first of the words it holds. */
function snippetOf(text: string, words: readonly string[]): string {
  const lower = text.toLowerCase();
  const found = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
  const at = found.length > 0 ? Math.min(...found) : 0;
  // Neither end splits a surrogate pair (cutAt): a lone half would read as U+FFFD.
  const start = cutAt(text, Math.max(0, at - 60));
  const end = cutAt(text, start + 160);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

export interface SearchScope {
  worldId: string;
  source: "head" | "draft";
  /** Only these collections and parts; all of them when null. */
  collections: ReadonlySet<string> | null;
  /** Only the entities whose kind passes, and nothing outside `entities`; every item when null. */
  kinds: ((kind: string) => boolean) | null;
  /** Leaves an item out (a head item the draft holds unchanged, which the draft's hits already cover). */
  skip?: (item: WorldItem) => boolean;
}

/** The items of one world document (`itemsOf`) that hold any of the words, scored. */
export function searchItems(items: readonly WorldItem[], words: readonly string[], scope: SearchScope): ScoredHit[] {
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  const hits: ScoredHit[] = [];
  for (const entry of items) {
    const { collection, id, pointer, value } = entry;
    if (scope.collections !== null && !scope.collections.has(collection)) continue;
    const kind = collection === "entities" && isRecord(value) && typeof value.kind === "string" ? value.kind : undefined;
    if (scope.kinds !== null && (kind === undefined || !scope.kinds(kind))) continue;
    if (scope.skip?.(entry)) continue;
    const leaves: { path: string; text: string }[] = [];
    strings(value, "", leaves);
    const matched = new Set<string>();
    let occurrences = 0;
    let best: { path: string; text: string; found: number } | null = null;
    let phraseFound = false;
    for (const leaf of leaves) {
      const lower = leaf.text.toLowerCase();
      let found = 0;
      for (const w of words) {
        if (!lower.includes(w)) continue;
        found++;
        matched.add(w);
        occurrences += Math.min(5, lower.split(w).length - 1);
      }
      if (words.length > 1 && lower.includes(phrase)) phraseFound = true;
      if (found > 0 && (best === null || found > best.found)) best = { ...leaf, found };
    }
    if (best === null) continue;
    const label = nameOf(value) ?? (id || collection);
    const inLabel = words.some((w) => label.toLowerCase().includes(w));
    const score = matched.size * 100 + Math.min(40, occurrences) + (phraseFound ? 50 : 0) + (inLabel ? 20 : 0);
    hits.push({ worldId: scope.worldId, source: scope.source, collection, id, pointer, ...(kind !== undefined ? { kind } : {}), label, field: best.path, snippet: snippetOf(best.text, words), score });
  }
  return hits;
}

/** The best hits first, all-word hits before partial ones; the earlier world and item win ties. */
export function rank(hits: readonly ScoredHit[], limit: number): SearchHit[] {
  return [...hits]
    .map((hit, i) => ({ hit, i }))
    .sort((a, b) => b.hit.score - a.hit.score || a.i - b.i)
    .slice(0, limit)
    .map(({ hit: { score: _score, ...hit } }) => hit);
}
