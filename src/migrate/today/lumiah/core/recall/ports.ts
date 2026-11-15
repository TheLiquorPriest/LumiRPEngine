// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/core/recall/ports.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// What the lore and history tools read from the host beyond `LorePort` and `ChatPort` (DESIGN §24):
// every lore entry with its state, how Lumiverse activated what it put in the prompt, when each chat
// message was sent, embeddings on the user's embedding connection, Lumiverse's Memory Cortex, the
// user's databanks and their web search provider.
//
// Every member is optional, so a host written before them still fits. Without `lore` the tools read
// the books through `LorePort` and know less of each entry; without `chat` no message has a date;
// without `embeddings` search is by word; and a host without `memory`, `databanks` or `web` means
// the tools that rest on it are not offered. Lumiverse is the data surface: nothing here keeps a
// copy of what Lumiverse keeps.

import type { ChatMessage, ChatRole } from "../ports";

// ---------------------------------------------------------------- lore

/** Where a world book applies to a chat from; null where the host can't tell. */
export type LoreBookSource = "character" | "persona" | "chat" | "global";

/** A world book that applies to the chat, with when it last changed. */
export interface LoreBookRecord {
  id: string;
  name: string;
  description: string;
  source: LoreBookSource | null;
  /** When the book or any entry of it last changed, in milliseconds since 1970; 0 where the host has none. */
  updatedAt: number;
}

/** An entry of a world book with what Lumiverse keeps on it beside its text. `title` is its comment. */
export interface LoreRecord {
  id: string;
  bookId: string;
  title: string;
  keys: string[];
  /** Its secondary keys: with them, a primary key alone doesn't activate it. */
  secondaryKeys: string[];
  content: string;
  /** False: the user switched it off, and Lumiverse never activates it. */
  enabled: boolean;
  /** Lumiverse puts it in every prompt, whatever was said. */
  constant: boolean;
  /** Lumiverse may activate it by a vector match as well as by its keys. */
  vectorized: boolean;
  /** Its keys are regular expressions, not words. */
  regex: boolean;
  /** As whose message Lumiverse puts it in the prompt; null: as the preset's World Info marker has it. */
  role: ChatRole | null;
  /** Its order among the entries Lumiverse puts in one place: the lower comes first. */
  order: number;
  /** When it last changed, in milliseconds since 1970; 0 where the host has none. */
  updatedAt: number;
}

/** A book with its entries, in the book's order; `entries` null: nothing of it changed since the stamp the caller holds (`RecallLorePort.read`). */
export interface LoreBookRead extends LoreBookRecord {
  entries: LoreRecord[] | null;
}

/** An entry Lumiverse activated for a generation, and how. */
export interface ActivatedEntry {
  entryId: string;
  /** Null where the host can't tell which book it is of. */
  bookId: string | null;
  title: string;
  /** How it got into the prompt: one of its keys matched (a constant entry counts as this), or a vector match; null where the host can't tell. */
  how: "key" | "vector" | null;
  /** The key that matched, where the host names it; never worked out by the core. */
  key?: string;
  /** A vector match's score, as Lumiverse reports it. */
  score?: number;
  /** The text Lumiverse put in the prompt for it, its macros filled, where the host knows it. */
  content?: string;
}

export interface RecallLorePort {
  /**
   * Every book that applies to the chat, each with every entry of it, in one call. `known` holds the
   * `updatedAt` the caller has for each book it read before: a host that can tell cheaply that a
   * book didn't change since may give that book with `entries` null. A host that can't gives every
   * book whole, which is always right.
   */
  read(chatId: string, known?: Readonly<Record<string, number>>): Promise<LoreBookRead[]>;
  /** How Lumiverse activated each entry it put in the generation's prompt. */
  activated(chatId: string, generationId: string): Promise<ActivatedEntry[]>;
}

// ---------------------------------------------------------------- the chat

/** A chat message with when it was sent. */
export interface TimedMessage extends ChatMessage {
  /** In milliseconds since 1970; null where the host has none. */
  at: number | null;
}

export interface RecallChatPort {
  /** As `ChatPort.messages`, each message with when it was sent. */
  messages(chatId: string, from: number, to: number): Promise<TimedMessage[]>;
}

// ---------------------------------------------------------------- embeddings

/**
 * The most texts one `embed` call may carry, and the most characters of each: Lumiverse's own bounds
 * on an embedding call. Fixed, not settings: the settings that batch and cut texts are bounded by
 * them (`recall/settings.ts`).
 */
export const EMBED_BATCH_MAX = 256;
export const EMBED_TEXT_MAX = 8192;

/** The user's embedding connection. */
export interface EmbedderInfo {
  id: string;
  name: string;
  model: string;
  /** Its vectors' length where it is set; null: the model's own. */
  dimensions: number | null;
}

export interface EmbeddingsPort {
  /** The user's main embedding connection; null: they have none, and search is by word. */
  connection(): Promise<EmbedderInfo | null>;
  /**
   * One vector per text, in order, on that connection. `kind` says what the texts are, for a model
   * that embeds a search query and a stored text differently. At most `EMBED_BATCH_MAX` texts, none
   * empty, each at most `EMBED_TEXT_MAX` characters. Rejects when the connection is gone or fails.
   */
  embed(texts: readonly string[], kind: "query" | "stored", signal?: AbortSignal): Promise<{ vectors: number[][]; model: string; dimensions: number }>;
}

// ---------------------------------------------------------------- Lumiverse's Memory Cortex

/** Something the Cortex gave for a query: a chunk of the chat or one of its arcs. */
export interface MemoryHit {
  source: "chunk" | "arc";
  text: string;
  /** Its score as the Cortex ranks it: the higher the better. */
  score: number;
  /** The chat messages it was made from, first and last by their numbers in the chat; null where the host can't tell. */
  span: [number, number] | null;
  /** The entities it names. */
  entities: string[];
}

export interface MemoryRelation {
  /** The other entity's name. */
  target: string;
  /** What it is to this one: ally, enemy, owns, located_in, … as the Cortex names it. */
  type: string;
  label: string | null;
  /** From 0 to 1. */
  strength: number;
  /** From -1 to 1. */
  sentiment: number;
}

/** What the Cortex has recorded of a person, a place or a thing. */
export interface MemoryEntity {
  id: string;
  name: string;
  /** character, location, item, faction, concept or event. */
  type: string;
  aliases: string[];
  description: string;
  /** active, inactive, deceased, destroyed or unknown. */
  status: string;
  facts: string[];
  /** How often the chat mentions it. */
  mentions: number;
  /** When it was last mentioned, in milliseconds since 1970; null where unknown. */
  lastSeenAt: number | null;
  relations: MemoryRelation[];
}

/** An entity as a list names it. */
export interface MemoryEntityBrief {
  name: string;
  type: string;
  mentions: number;
}

/** An arc the Cortex made of a stretch of the chat: tier 1 a scene, 2 a chapter, and so on, each of the tier below. */
export interface MemoryArc {
  id: string;
  tier: number;
  title: string | null;
  summary: string;
  /** The chat messages it covers, first and last by their numbers in the chat; null where the host can't tell. */
  span: [number, number] | null;
  /** When it was made, in milliseconds since 1970. */
  at: number;
}

export interface MemoryPort {
  /** Whether the user has the Memory Cortex on: off, its tools are not offered. */
  enabled(chatId: string): Promise<boolean>;
  /** The Cortex's own ranked answer to a query over the chat's memory, the best first, `limit` at most. */
  search(chatId: string, query: string, options: { limit: number; entities?: readonly string[] }, signal?: AbortSignal): Promise<MemoryHit[]>;
  /** An entity by its name or one of its aliases, with its facts and relations; null when the Cortex has none so named. */
  entity(chatId: string, name: string): Promise<MemoryEntity | null>;
  /** The entities the Cortex has recorded for the chat, the most salient first, `limit` at most. */
  entities(chatId: string, limit: number): Promise<MemoryEntityBrief[]>;
  /** The chat's arcs, of every tier, in any order. */
  arcs(chatId: string): Promise<MemoryArc[]>;
}

// ---------------------------------------------------------------- databanks

/** A databank that applies to the chat. */
export interface Databank {
  id: string;
  name: string;
  description: string;
  scope: "global" | "character" | "chat";
  /** How many documents it holds. */
  documents: number;
}

export interface DatabankDocument {
  id: string;
  databankId: string;
  name: string;
  /** Something that changes whenever its text does (a content hash, a change stamp): its text is read once for each. */
  version: string;
  /** Its size in bytes as stored, where the host knows it. */
  bytes: number | null;
  /** Whether Lumiverse has finished reading it in: its text can be read once it is `ready`. */
  status: "pending" | "processing" | "ready" | "error";
}

export interface DatabanksPort {
  /** The databanks that apply to the chat and are switched on: the global ones, its character's and its own. None: the databank tools are not offered. */
  list(chatId: string): Promise<Databank[]>;
  /** A databank's documents. */
  documents(databankId: string): Promise<DatabankDocument[]>;
  /** A document's text; null when it has none to read. */
  content(documentId: string): Promise<string | null>;
}

// ---------------------------------------------------------------- web search

/** One result of a web search; `content` is the page's text where the host read the page. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface WebSearchPort {
  /** Whether the user has set up a web search provider: without one, `web_search` is not offered. */
  enabled(): Promise<boolean>;
  /** The provider's results for a query, `count` at most; `pages`: read the pages too, as many as the user's own setting allows. */
  search(query: string, options: { count: number; pages: boolean }, signal?: AbortSignal): Promise<WebResult[]>;
}

// ---------------------------------------------------------------- the ports together

/** What §24 reads from the host: `HarnessHost.recall`. */
export interface RecallPorts {
  lore?: RecallLorePort;
  chat?: RecallChatPort;
  embeddings?: EmbeddingsPort;
  memory?: MemoryPort;
  databanks?: DatabanksPort;
  web?: WebSearchPort;
}
