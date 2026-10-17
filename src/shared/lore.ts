// World lore helpers (DESIGN §4.2) shared by the lint, the backend and Build: an entry's source,
// the helpers a secret entry may reach, the hash a book-sourced entry keeps of the World Info text
// it was indexed from, and the lookup table's terms, additions and suggestions. Pure.

import { hashParts } from "./hash";
import type { TopicId } from "./ids";
import type { JsonObject } from "./json";
import { hasOwn, isRecord, safeKey } from "./json";
import { STEP_OUTPUTS } from "./steps";
import type { LoreIndex, LoreSource, StepPurpose, WorldDoc } from "./world";

/** Every helper a secret entry's audience may name, in Settings' order. */
export const LORE_AUDIENCE = Object.keys(STEP_OUTPUTS) as StepPurpose[];

/**
 * Steps whose output reaches the narrator or the player: prose, suggestions and proposals that
 * become chips. They never read secret lore before its gate holds (the secrecy batching rule), so
 * a secret entry naming one in its audience is linted.
 */
export const PROSE_STEPS: readonly StepPurpose[] = ["brief", "outline", "choices", "extract"];

/**
 * A secret entry's text as the leak check looks for it: each sentence or clause of at least four
 * words, without quotes or end punctuation. A player-facing line carrying one of these word for
 * word is dropped; a paraphrase isn't caught, which is why secret lore never shares a call with a
 * step that writes for the player.
 */
export function lorePhrases(content: string): string[] {
  const out: string[] = [];
  for (const part of content.split(/[.!?…;:\n]+|\s[—–-]\s|—/)) {
    const phrase = part
      .replace(/^[\s"'“”‘’()[\]*_]+|[\s"'“”‘’()[\]*_,]+$/g, "")
      .replace(/\s+/g, " ");
    if (phrase.length >= 16 && phrase.split(" ").length >= 4 && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}

/** An entry's source as stored: a missing one (every entry written before sources existed) or a malformed one counts as authored. */
export function loreSourceOf(raw: unknown): LoreSource {
  if (!isRecord(raw)) return { kind: "authored" };
  if (raw.kind === "book" && typeof raw.bookId === "string" && typeof raw.entryId === "string" && typeof raw.hash === "string") return { kind: "book", bookId: raw.bookId, entryId: raw.entryId, hash: raw.hash };
  if (raw.kind === "chat" && typeof raw.chatId === "string" && typeof raw.messageId === "string") return { kind: "chat", chatId: raw.chatId, messageId: raw.messageId };
  if (raw.kind === "ai" && (raw.status === "pending" || raw.status === "accepted")) return { kind: "ai", status: raw.status };
  return { kind: "authored" };
}

/** The lookup table as plain JSON: the value of a `set loreIndex` edit. */
export function loreIndexJson(index: LoreIndex): JsonObject {
  return { terms: Object.fromEntries(Object.entries(index.terms).map(([term, ids]) => [term, [...ids]])), topics: Object.fromEntries(Object.entries(index.topics).map(([id, t]) => [id, { label: t.label, entries: [...t.entries] }])) };
}

/** The hash a book-sourced entry keeps of its World Info entry's text; another hash now means the book changed. */
export function bookTextHash(content: string): string {
  return hashParts("lre-lore-book-v1", content);
}

/** A lookup-table term as lookups match it: trimmed, inner spaces collapsed, lowercase. */
export function loreTerm(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A topic's id from its label: lowercase letters and digits joined by `_` ("Harbor law" → `harbor_law`); empty when it has neither. */
export function topicIdOf(label: string): TopicId {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** What an indexing proposal adds to the lookup table for its entry: the terms that lead to it and the topics it belongs under. */
export interface LoreIndexAddition {
  terms: string[];
  topics: { id: TopicId; label: string }[];
}

/**
 * The lookup table with `entry` filed under the addition's terms and topics; a topic the table
 * lacks is created with its label. Nothing already there is removed or reordered, and a term or
 * topic id that could reach a prototype is skipped.
 */
export function addToLoreIndex(index: LoreIndex, entry: string, addition: LoreIndexAddition): LoreIndex {
  const terms = { ...index.terms };
  for (const raw of addition.terms) {
    const term = loreTerm(raw);
    if (!safeKey(term)) continue;
    const listed = hasOwn(terms, term) ? (terms[term] ?? []) : [];
    if (!listed.includes(entry)) terms[term] = [...listed, entry];
  }
  const topics = { ...index.topics };
  for (const t of addition.topics) {
    if (!safeKey(t.id)) continue;
    const topic = hasOwn(topics, t.id) ? topics[t.id] : undefined;
    if (!topic) topics[t.id] = { label: t.label, entries: [entry] };
    else if (!topic.entries.includes(entry)) topics[t.id] = { ...topic, entries: [...topic.entries, entry] };
  }
  return { terms, topics };
}

/** A term an entry's title, alias or keyword suggests for the lookup table. */
export interface TermSuggestion {
  term: string;
  entry: string;
  from: "title" | "alias" | "keyword";
}

/** The terms entries' titles, aliases and keywords suggest that don't lead to that entry yet, in entry order. */
export function termSuggestions(world: Pick<WorldDoc, "lore" | "loreIndex">): TermSuggestion[] {
  const out: TermSuggestion[] = [];
  const seen = new Set<string>();
  for (const [id, l] of Object.entries(world.lore)) {
    const named: [string, TermSuggestion["from"]][] = [[l.title, "title"], ...(l.aliases ?? []).map((a): [string, TermSuggestion["from"]] => [a, "alias"]), ...l.keys.map((k): [string, TermSuggestion["from"]] => [k, "keyword"])];
    for (const [text, from] of named) {
      const term = loreTerm(text);
      const key = `${term}\u0000${id}`;
      if (!safeKey(term) || seen.has(key)) continue;
      seen.add(key);
      if (!(hasOwn(world.loreIndex.terms, term) && (world.loreIndex.terms[term] ?? []).includes(id))) out.push({ term, entry: id, from });
    }
  }
  return out;
}

/** A topic entries name (`LoreEntryDef.topics`) and the entries the table doesn't file under it yet. */
export interface TopicSuggestion {
  id: TopicId;
  label: string;
  entries: string[];
}

/** The topics entries name, each with the entries the table doesn't list under it yet; a topic the table has keeps its label. */
export function topicSuggestions(world: Pick<WorldDoc, "lore" | "loreIndex">): TopicSuggestion[] {
  const byId = new Map<TopicId, TopicSuggestion>();
  for (const [id, l] of Object.entries(world.lore)) {
    for (const label of l.topics ?? []) {
      const topicId = topicIdOf(label);
      if (!safeKey(topicId)) continue;
      const filed = hasOwn(world.loreIndex.topics, topicId) ? world.loreIndex.topics[topicId] : undefined;
      if (filed?.entries.includes(id)) continue;
      const s = byId.get(topicId) ?? { id: topicId, label: filed?.label ?? label.trim(), entries: [] };
      if (!s.entries.includes(id)) s.entries.push(id);
      byId.set(topicId, s);
    }
  }
  return [...byId.values()];
}
