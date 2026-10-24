// World lore helpers (DESIGN §4.2) shared by the lint, the backend and Build: whether an entry is
// secret, its source, the helpers a secret entry may reach, the hash a book-sourced entry keeps of
// the World Info text it was indexed from, and the lookup table's terms, additions and
// suggestions. Pure.

import { hashParts } from "./hash";
import type { TopicId } from "./ids";
import type { JsonObject } from "./json";
import { hasOwn, isRecord, safeKey } from "./json";
import { LEDGER_NAMESPACE } from "./ledger";
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

/**
 * LRE's own fields on a World Info entry (DESIGN §4.2), in its extension data under
 * `lumi_rp_engine.lore`: what a world lore entry says beside its text, for an entry read live from a
 * book. With `secret` the entry is stored switched off, and the interceptor turns it on for a prompt
 * only once its gate holds (§6.1).
 */
export interface BookLoreFields {
  secret?: boolean;
  gate?: string;
  audience?: StepPurpose[];
  visibility?: "public" | "known_by";
  links?: string[];
  aliases?: string[];
  holders?: string[];
}

/**
 * An entry's LRE fields as stored, each kept only when well formed; null when it has none. A
 * `secret` that isn't `false` reads as secret, and a visibility this reader doesn't know as Known by
 * with nothing linked, which no one reads: both keep a malformed entry hidden, as a world entry's do.
 */
export function bookLoreFieldsOf(extensions: unknown): BookLoreFields | null {
  const ns = isRecord(extensions) ? extensions[LEDGER_NAMESPACE] : undefined;
  const raw = isRecord(ns) ? ns.lore : undefined;
  if (!isRecord(raw)) return null;
  const ids = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : undefined);
  const out: BookLoreFields = {};
  if (raw.secret !== undefined) out.secret = raw.secret !== false;
  if (typeof raw.gate === "string") out.gate = raw.gate;
  const audience = ids(raw.audience)?.filter((p): p is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(p));
  if (audience) out.audience = audience;
  const links = ids(raw.links);
  if (links) out.links = links;
  const aliases = ids(raw.aliases);
  if (aliases) out.aliases = aliases;
  const holders = ids(raw.holders);
  if (holders) out.holders = holders;
  if (raw.visibility === "public" || raw.visibility === "known_by") out.visibility = raw.visibility;
  else if (raw.visibility !== undefined) {
    out.visibility = "known_by";
    out.links = [];
  }
  return out;
}

/** Extension data with `fields` as the entry's LRE fields (null takes them off), everything else in it kept. */
export function withBookLoreFields(extensions: JsonObject, fields: BookLoreFields | null): JsonObject {
  const held = extensions[LEDGER_NAMESPACE];
  const ns: JsonObject = isRecord(held) ? { ...held } : {};
  if (fields === null) delete ns.lore;
  else ns.lore = JSON.parse(JSON.stringify(fields)) as JsonObject;
  const out: JsonObject = { ...extensions };
  if (Object.keys(ns).length === 0) delete out[LEDGER_NAMESPACE];
  else out[LEDGER_NAMESPACE] = ns;
  return out;
}

/**
 * Whether the engine wrote a World Info entry: its books' sections and their outlet twins, its
 * narrator rules, or a copy an earlier build made of world lore. Such an entry is never lore, and
 * never read through a pin, whatever names it (the Minds section holds other minds).
 */
export function engineWroteEntry(extensions: unknown): boolean {
  const ns = isRecord(extensions) ? extensions[LEDGER_NAMESPACE] : undefined;
  return isRecord(ns) && (typeof ns.slot === "string" || typeof ns.twin === "string" || typeof ns.narrator === "string" || typeof ns.lore === "string");
}

/** The World Info books a world lists to read lore from (DESIGN §4.2): its well-formed ids, each once, in order. */
export function loreBooksOf(world: { readonly loreBooks?: unknown }): string[] {
  const raw = world.loreBooks;
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && id.trim() !== ""))] : [];
}

/** Whether a value is a lore pin: `{lore}` naming one of the world's entries, `{book, entry}` naming a World Info book's, or `{book}` naming a whole book (DESIGN §24.5). */
export function isLorePin(v: unknown): v is LorePin {
  if (!isRecord(v)) return false;
  // A pin's `keep` is its own field beside what it names.
  if (v.keep !== undefined && v.keep !== "start" && v.keep !== "end") return false;
  const keys = Object.keys(v).length - (v.keep === undefined ? 0 : 1);
  if (v.lore !== undefined) return typeof v.lore === "string" && v.lore !== "" && keys === 1;
  if (typeof v.book !== "string" || v.book === "") return false;
  return v.entry === undefined ? keys === 1 : typeof v.entry === "string" && v.entry !== "" && keys === 2;
}

/** A pin's key, the same for the same entry or book wherever it is pinned: `lore:<id>`, `book:<book>/<entry>` or `book:<book>`. */
export function lorePinKey(pin: LorePin): string {
  return "lore" in pin ? `lore:${pin.lore}` : "entry" in pin ? `book:${pin.book}/${pin.entry}` : `book:${pin.book}`;
}

/** A pin as plain JSON, its own fields only; keeping the start, the default, is left unsaid. */
function pinJson(pin: LorePin): LorePin & JsonObject {
  const base: LorePin & JsonObject = "lore" in pin ? { lore: pin.lore } : "entry" in pin ? { book: pin.book, entry: pin.entry } : { book: pin.book };
  if (pin.keep === "end") base.keep = "end";
  return base;
}

const pinsRead = new WeakMap<object, LorePins>();

/**
 * The world's lore pins as the engine reads them (DESIGN §24.5): each character's, place's and
 * step's well-formed pins, each entry once, in order; a malformed one (linted), a step that isn't
 * one, or a key that could reach a prototype is left out. Read once per world revision.
 */
export function lorePinsOf(world: { readonly lorePins?: unknown }): LorePins {
  const raw = world.lorePins;
  if (!isRecord(raw)) return { characters: {}, places: {}, steps: {} };
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
        pins.push(pinJson(pin));
      }
      if (pins.length > 0) out[id] = pins;
    }
    return out;
  };
  const steps = part(raw.steps);
  const read: LorePins = { characters: part(raw.characters), places: part(raw.places), steps: Object.fromEntries(LORE_AUDIENCE.flatMap((p): [StepPurpose, LorePin[]][] => (hasOwn(steps, p) ? [[p, steps[p] ?? []]] : []))) };
  pinsRead.set(raw, read);
  return read;
}

/** The pins as plain JSON: the value of a `set lorePins` edit, with no target left that pins nothing. */
export function lorePinsJson(pins: LorePins): JsonObject {
  const part = (record: Readonly<Record<string, readonly LorePin[] | undefined>>): JsonObject => Object.fromEntries(Object.entries(record).flatMap(([id, list]) => (list && list.length > 0 ? [[id, list.map(pinJson)]] : [])));
  return { characters: part(pins.characters), places: part(pins.places), steps: part(pins.steps) };
}

/** The lint codes lore pins raise (DESIGN §24.5), with what each means; the reference lists them. */
export const LORE_PIN_LINTS: Readonly<Record<string, string>> = {
  pin_shape: 'a pin that is none of {"lore": id}, {"book": id, "entry": id} and {"book": id}: it is ignored',
  pin_missing: "a pin naming a lore entry the world doesn't have",
  pin_target: "pins under a character, place or step the world doesn't have: no call reads them",
  pin_duplicate: "the same entry or book pinned twice to one character, place or step",
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
