// World lore helpers (DESIGN §4.2) shared by the lint, the backend and Build: whether an entry is
// secret, its source, the helpers a secret entry may reach, the hash a book-sourced entry keeps of
// the World Info text it was indexed from, and the lookup table's terms, additions and
// suggestions. Pure.

import { hashParts } from "./hash";
import type { TopicId } from "./ids";
import type { JsonObject } from "./json";
import { hasOwn, isRecord, safeKey } from "./json";
import { STEP_OUTPUTS } from "./steps";
import type { LoreIndex, LorePin, LorePins, LoreSource, StepPurpose, WorldDoc } from "./world";

/** Every helper a secret entry's audience may name, in Settings' order. */
export const LORE_AUDIENCE = Object.keys(STEP_OUTPUTS) as StepPurpose[];

/**
 * Steps whose output reaches the narrator or the player: prose, suggestions and proposals that
 * become chips. They never read secret lore before its gate holds (the secrecy batching rule), so
 * a secret entry naming one in its audience is linted.
 */
export const PROSE_STEPS: readonly StepPurpose[] = ["brief", "outline", "choices", "extract"];

/**
 * Whether an entry is secret: unless `secret` is `false` or absent it is, so a value a reader
 * doesn't understand (`"true"`, `"false"`, 1) keeps the entry hidden rather than public (linted).
 */
export function loreIsSecret(entry: { readonly secret?: unknown }): boolean {
  return entry.secret !== undefined && entry.secret !== false;
}

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

/** Whether a value is a lore pin: `{lore}` naming one of the world's entries, or `{book, entry}` naming a World Info book's (DESIGN §24.5). */
export function isLorePin(v: unknown): v is LorePin {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v).length;
  if (v.lore !== undefined) return typeof v.lore === "string" && v.lore !== "" && keys === 1;
  return typeof v.book === "string" && v.book !== "" && typeof v.entry === "string" && v.entry !== "" && keys === 2;
}

/** A pin's key, the same for the same entry wherever it is pinned: `lore:<id>` or `book:<book>/<entry>`. */
export function lorePinKey(pin: LorePin): string {
  return "lore" in pin ? `lore:${pin.lore}` : `book:${pin.book}/${pin.entry}`;
}

const pinsRead = new WeakMap<object, LorePins>();

/**
 * The world's lore pins as the engine reads them (DESIGN §24.5): each character's and place's
 * well-formed pins, each entry once, in order; a malformed one (linted) or a key that could reach a
 * prototype is left out. Read once per world revision.
 */
export function lorePinsOf(world: { readonly lorePins?: unknown }): LorePins {
  const raw = world.lorePins;
  if (!isRecord(raw)) return { characters: {}, places: {} };
  const known = pinsRead.get(raw);
  if (known) return known;
  const part = (value: unknown): Record<string, LorePin[]> => {
    const out: Record<string, LorePin[]> = {};
    if (!isRecord(value)) return out;
    for (const [id, list] of Object.entries(value)) {
      if (!safeKey(id) || !Array.isArray(list)) continue;
      const seen = new Set<string>();
      const pins: LorePin[] = [];
      for (const pin of list) {
        if (!isLorePin(pin) || seen.has(lorePinKey(pin))) continue;
        seen.add(lorePinKey(pin));
        pins.push("lore" in pin ? { lore: pin.lore } : { book: pin.book, entry: pin.entry });
      }
      if (pins.length > 0) out[id] = pins;
    }
    return out;
  };
  const read: LorePins = { characters: part(raw.characters), places: part(raw.places) };
  pinsRead.set(raw, read);
  return read;
}

/** The pins as plain JSON: the value of a `set lorePins` edit, with no target left that pins nothing. */
export function lorePinsJson(pins: LorePins): JsonObject {
  const part = (record: Readonly<Record<string, readonly LorePin[]>>): JsonObject => Object.fromEntries(Object.entries(record).flatMap(([id, list]) => (list.length > 0 ? [[id, list.map((p): JsonObject => ("lore" in p ? { lore: p.lore } : { book: p.book, entry: p.entry }))]] : [])));
  return { characters: part(pins.characters), places: part(pins.places) };
}

/** The lint codes lore pins raise (DESIGN §24.5), with what each means; the reference lists them. */
export const LORE_PIN_LINTS: Readonly<Record<string, string>> = {
  pin_shape: 'a pin that is neither {"lore": id} nor {"book": id, "entry": id}: it is ignored',
  pin_missing: "a pin naming a lore entry the world doesn't have",
  pin_target: "pins under a character or place the world doesn't have: no call reads them",
  pin_duplicate: "the same entry pinned twice to one character or place",
  pin_unread: "a secret entry pinned to someone whose own it isn't: their mind never reads it",
  pin_pending: "an AI-written entry still waiting for review: no call reads it until it is accepted",
};

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
