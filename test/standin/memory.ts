// What a generation reads of Lumiverse's memory and databanks: a chat's chunks and consolidations (the scenes and arcs
// its memory summarized, `services/memory-cortex/consolidation.ts`), and the databanks and documents a `#mention` in the player's
// line names (`services/databank/`). Kept in memory and, given a database, written there as Lumiverse writes the rows (the very
// columns of `src/db/baseline.sql`, `CORTEX_DDL` of `cortex.ts` and the two tables of documents below); a generation then
// reads the rows themselves, so a row changed under the stand-in is read at the next generation, as `library` (`books.ts`) does.
// What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; paths are Lumiverse's `src/`.

import { CORTEX_DDL } from "./cortex";
import type { StandInDb } from "./db";

/**
 * `databank_documents` (`src/db/baseline.sql:219-236`) and `databank_chunks` (`:203-217`): what `cortex.ts` does not make (it makes `databanks`,
 * `chat_chunks` and `memory_consolidations`).
 */
const DATABANK_DDL = `
CREATE TABLE IF NOT EXISTS databank_chunks (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  databank_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  token_count   INTEGER NOT NULL DEFAULT 0,
  vectorized_at INTEGER,
  vector_model  TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS databank_documents (
  id            TEXT PRIMARY KEY,
  databank_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  mime_type     TEXT NOT NULL DEFAULT '',
  file_size     INTEGER NOT NULL DEFAULT 0,
  content_hash  TEXT NOT NULL DEFAULT '',
  total_chunks  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'ready', 'error')),
  error_message TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
`;

/** A chunk of a chat (`chat_chunks`): the messages it holds, and the scene it was folded into. */
export interface Chunk {
  id: string;
  chat: string;
  /** The messages it holds, by id (`message_ids`). */
  messageIds: string[];
  /** The consolidation it was folded into (`consolidation_id`). */
  consolidation?: string | null;
}

/** A scene (tier 1, over chunks) or an arc (tier 2, over scenes) of a chat's memory (`memory_consolidations`, `rowToConsolidation`, `memory-cortex/consolidation.ts:69-91`). */
export interface Consolidation {
  id: string;
  chat: string;
  tier: number;
  summary: string;
  title?: string | null;
  sourceChunkIds: string[];
  sourceConsolidationIds: string[];
  /** The columns it is ordered by (`getConsolidations`, `:101-110`). */
  messageRangeStart: number | null;
  messageRangeEnd?: number | null;
  /** In seconds, as Lumiverse stamps rows; it breaks ties between equal summaries (`history-replacement.ts:92-93`). */
  updatedAt: number;
}

/** A databank (`databanks`): global, a character's or a chat's. */
export interface Databank {
  id: string;
  user: string;
  name: string;
  scope: "global" | "character" | "chat";
  scopeId?: string | null;
  enabled?: boolean;
}

/** A document of a databank (`databank_documents`) and its text, which Lumiverse holds as chunks. */
export interface DatabankDocument {
  id: string;
  databank: string;
  user: string;
  name: string;
  /** What a `#mention` names (`MENTION_PATTERN`, `databank/mention-resolver.service.ts:23`): lowercase letters, digits and hyphens. */
  slug: string;
  /** Its chunks in order; a mention puts them back together with a newline between (`getFullDocumentText`, `databank-crud.service.ts:467-473`). */
  chunks: string[];
  /** Lumiverse resolves only a "ready" one (`getDocumentBySlug`, `:258-263`). */
  status?: "pending" | "processing" | "ready" | "error";
}

const parsedArray = (raw: unknown): string[] => {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as string[]) : [];
  } catch {
    return [];
  }
};

/** A chat's chunks and consolidations. */
export class Memory {
  private readonly chunkList: Chunk[] = [];
  private readonly consolidationList: Consolidation[] = [];
  private made: StandInDb | null = null;

  constructor(
    private readonly db: () => StandInDb | null,
    private readonly now: () => number,
  ) {}

  /** The tables, once, when there is a database: one statement at a time, for the database runs the first of a text. */
  private tables(): StandInDb | null {
    const db = this.db();
    if (db === null) return null;
    if (this.made !== db) {
      for (const statement of CORTEX_DDL.split(/;\s*\n/)) if (statement.trim() !== "") db.run(statement);
      this.made = db;
    }
    return db;
  }

  /** A chunk, as `chat_chunks` holds one. With a database, the chat is there before it (the table's foreign key). */
  addChunk(chunk: Chunk): void {
    this.chunkList.push(structuredClone(chunk));
    const db = this.tables();
    if (db === null) return;
    const seconds = Math.floor(this.now() / 1000);
    const ids = chunk.messageIds;
    db.run(
      "INSERT INTO chat_chunks (id, chat_id, start_message_id, end_message_id, message_ids, content, token_count, message_count, created_at, updated_at, consolidation_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
      chunk.id,
      chunk.chat,
      ids[0] ?? "",
      ids.at(-1) ?? "",
      JSON.stringify(ids),
      "",
      ids.length,
      seconds,
      seconds,
      chunk.consolidation ?? null,
    );
  }

  /** A scene or an arc, as `memory_consolidations` holds one. */
  addConsolidation(c: Consolidation): void {
    this.consolidationList.push(structuredClone(c));
    const db = this.tables();
    if (db === null) return;
    const seconds = Math.floor(this.now() / 1000);
    db.run(
      "INSERT INTO memory_consolidations (id, chat_id, tier, title, summary, source_chunk_ids, source_consolidation_ids, message_range_start, message_range_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      c.id,
      c.chat,
      c.tier,
      c.title ?? null,
      c.summary,
      JSON.stringify(c.sourceChunkIds),
      JSON.stringify(c.sourceConsolidationIds),
      c.messageRangeStart,
      c.messageRangeEnd ?? null,
      seconds,
      c.updatedAt,
    );
  }

  /** `getConsolidations` (`memory-cortex/consolidation.ts:101-110`): a chat's, by tier and then by the start of their range, those with none first. */
  consolidations(chat: string): Consolidation[] {
    const db = this.tables();
    if (db === null) {
      return this.consolidationList
        .filter((c) => c.chat === chat)
        .sort((a, b) => a.tier - b.tier || (a.messageRangeStart ?? Number.NEGATIVE_INFINITY) - (b.messageRangeStart ?? Number.NEGATIVE_INFINITY))
        .map((c) => structuredClone(c));
    }
    return db.rows("SELECT * FROM memory_consolidations WHERE chat_id = ? ORDER BY tier ASC, message_range_start ASC", chat).map((row) => ({
      id: String(row.id),
      chat,
      tier: Number(row.tier),
      summary: String(row.summary),
      title: row.title === null ? null : String(row.title),
      sourceChunkIds: parsedArray(row.source_chunk_ids),
      sourceConsolidationIds: parsedArray(row.source_consolidation_ids),
      messageRangeStart: row.message_range_start === null ? null : Number(row.message_range_start),
      messageRangeEnd: row.message_range_end === null ? null : Number(row.message_range_end),
      updatedAt: Number(row.updated_at),
    }));
  }

  /** A chat's chunks as `buildCortexHistoryPlan` reads them (`memory-cortex/history-replacement.ts:55-58`): the raw `message_ids` text, and the scene each was folded into. */
  chunks(chat: string): { id: string; messageIds: string; consolidation: string | null }[] {
    const db = this.tables();
    if (db === null) return this.chunkList.filter((c) => c.chat === chat).map((c) => ({ id: c.id, messageIds: JSON.stringify(c.messageIds), consolidation: c.consolidation ?? null }));
    return db.rows("SELECT id, message_ids, consolidation_id FROM chat_chunks WHERE chat_id = ?", chat).map((row) => ({ id: String(row.id), messageIds: String(row.message_ids), consolidation: row.consolidation_id === null ? null : String(row.consolidation_id) }));
  }
}

/** The databanks and documents a mention reads. */
export class Databanks {
  private readonly banks: Databank[] = [];
  private readonly documents: DatabankDocument[] = [];
  private made: StandInDb | null = null;

  constructor(
    private readonly db: () => StandInDb | null,
    private readonly now: () => number,
  ) {}

  private tables(): StandInDb | null {
    const db = this.db();
    if (db === null) return null;
    if (this.made !== db) {
      for (const statement of [...CORTEX_DDL.split(/;\s*\n/), ...DATABANK_DDL.split(/;\s*\n/)]) if (statement.trim() !== "") db.run(statement);
      this.made = db;
    }
    return db;
  }

  addBank(bank: Databank): void {
    this.banks.push(structuredClone(bank));
    const db = this.tables();
    if (db === null) return;
    const seconds = Math.floor(this.now() / 1000);
    db.run("INSERT INTO databanks (id, user_id, name, scope, scope_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", bank.id, bank.user, bank.name, bank.scope, bank.scopeId ?? null, bank.enabled === false ? 0 : 1, seconds, seconds);
  }

  addDocument(doc: DatabankDocument): void {
    this.documents.push(structuredClone(doc));
    const db = this.tables();
    if (db === null) return;
    const seconds = Math.floor(this.now() / 1000);
    db.run("INSERT INTO databank_documents (id, databank_id, user_id, name, slug, file_path, total_chunks, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", doc.id, doc.databank, doc.user, doc.name, doc.slug, `${doc.slug}.txt`, doc.chunks.length, doc.status ?? "ready", seconds, seconds);
    doc.chunks.forEach((content, index) => db.run("INSERT INTO databank_chunks (id, document_id, databank_id, user_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", `${doc.id}-${index}`, doc.id, doc.databank, doc.user, index, content, seconds));
  }

  /**
   * `resolveActiveDatabankIds` (`services/databank/scope-resolver.service.ts:31-99`): the user's enabled banks that are global, this chat's or a given
   * character's, then the user's `globalDatabanks` setting and the cross-references (`character.extensions.databank_ids`, `chat.metadata.chat_databank_ids`),
   * all kept only where the bank exists, is the user's and is enabled.
   */
  activeBanks(user: string, chat: string, characters: readonly string[], refs: { global: readonly string[]; character: readonly string[]; chat: readonly string[] }): string[] {
    const db = this.tables();
    const ids = new Set<string>();
    const scoped = db === null ? this.banks.filter((b) => b.user === user && b.enabled !== false && (b.scope === "global" || (b.scope === "chat" && b.scopeId === chat) || (b.scope === "character" && characters.includes(b.scopeId ?? "")))).map((b) => b.id) : (characters.length === 0 ? db.rows("SELECT id FROM databanks WHERE user_id = ? AND enabled = 1 AND (scope = 'global' OR (scope = 'chat' AND scope_id = ?))", user, chat) : db.rows(`SELECT id FROM databanks WHERE user_id = ? AND enabled = 1 AND (scope = 'global' OR (scope = 'chat' AND scope_id = ?) OR (scope = 'character' AND scope_id IN (${characters.map(() => "?").join(",")})))`, user, chat, ...characters)).map((r) => String(r.id));
    for (const id of scoped) ids.add(id);
    for (const id of [...refs.global, ...refs.character, ...refs.chat]) if (typeof id === "string" && id !== "") ids.add(id);
    if (ids.size === 0) return [];
    const list = [...ids];
    if (db === null) return this.banks.filter((b) => list.includes(b.id) && b.user === user && b.enabled !== false).map((b) => b.id);
    return db.rows(`SELECT id FROM databanks WHERE id IN (${list.map(() => "?").join(",")}) AND user_id = ? AND enabled = 1`, ...list, user).map((r) => String(r.id));
  }

  /** `getDocumentBySlug` (`databank-crud.service.ts:258-263`): the user's ready document of this slug. */
  documentBySlug(user: string, slug: string): { id: string; databank: string; name: string } | null {
    const db = this.tables();
    if (db === null) {
      const found = this.documents.find((d) => d.user === user && d.slug === slug && (d.status ?? "ready") === "ready");
      return found === undefined ? null : { id: found.id, databank: found.databank, name: found.name };
    }
    const row = db.rows("SELECT id, databank_id, name FROM databank_documents WHERE user_id = ? AND slug = ? AND status = 'ready' LIMIT 1", user, slug)[0];
    return row === undefined ? null : { id: String(row.id), databank: String(row.databank_id), name: String(row.name) };
  }

  /** `getFullDocumentText` (`databank-crud.service.ts:467-473`): the chunks in order joined by a newline; null where there are none. */
  fullText(user: string, document: string): string | null {
    const db = this.tables();
    if (db === null) {
      const found = this.documents.find((d) => d.id === document && d.user === user);
      return found === undefined || found.chunks.length === 0 ? null : found.chunks.join("\n");
    }
    const rows = db.rows("SELECT content FROM databank_chunks WHERE document_id = ? AND user_id = ? ORDER BY chunk_index ASC", document, user);
    return rows.length === 0 ? null : rows.map((r) => String(r.content)).join("\n");
  }
}
