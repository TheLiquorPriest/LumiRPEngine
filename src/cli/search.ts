// Searching worlds on the client: every string in every item of a world document, matched against
// the query's words, items that hold all of them first. A hit names the item and the field (a JSON
// Pointer inside the item) that matched best, with a snippet around the match.

import { isRecord } from "../shared/json";
import { isCollection } from "./diff";
import { pointerOf } from "./pointer";
import { nameOf } from "./read";

export interface SearchHit {
  worldId: string;
  source: "head" | "draft";
  /** A collection (`entities`), or a part of the world (`calendar`) with an empty `id`. */
  collection: string;
  id: string;
  label: string;
  /** Where in the item it matched, as a JSON Pointer below `/<collection>/<id>` (`/fields/description`). */
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
  const start = Math.max(0, at - 60);
  const flat = text.slice(start, start + 160).replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${flat}${start + 160 < text.length ? "…" : ""}`;
}

export interface SearchScope {
  worldId: string;
  source: "head" | "draft";
  /** Only these collections and parts; all of them when null. */
  collections: ReadonlySet<string> | null;
  /** Leaves an item out (a head item the draft holds unchanged, which the draft's hits already cover). */
  skip?: (collection: string, id: string, item: unknown) => boolean;
}

/** The items of one world document that hold any of the words, scored. */
export function searchDoc(doc: unknown, words: readonly string[], scope: SearchScope): ScoredHit[] {
  if (!isRecord(doc) || words.length === 0) return [];
  const phrase = words.join(" ");
  const hits: ScoredHit[] = [];
  const consider = (collection: string, id: string, item: unknown): void => {
    if (scope.skip?.(collection, id, item)) return;
    const leaves: { path: string; text: string }[] = [];
    strings(item, "", leaves);
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
    if (best === null) return;
    const label = nameOf(item) ?? (id || collection);
    const inLabel = words.some((w) => label.toLowerCase().includes(w));
    const score = matched.size * 100 + Math.min(40, occurrences) + (phraseFound ? 50 : 0) + (inLabel ? 20 : 0);
    hits.push({ worldId: scope.worldId, source: scope.source, collection, id, label, field: best.path, snippet: snippetOf(best.text, words), score });
  };
  for (const [key, value] of Object.entries(doc)) {
    if (scope.collections !== null && !scope.collections.has(key)) continue;
    if (isCollection(key) && isRecord(value)) for (const [id, item] of Object.entries(value)) consider(key, id, item);
    else consider(key, "", value);
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
