// Lumiverse's database, read without changing it: one user's chats, their messages and their
// metadata, and the few rows today's build made in Lumiverse itself (its books, entries, regex
// scripts and preset blocks), which the report lists and the migration leaves as they are.
//
// The database is in WAL mode while Lumiverse runs. It is opened read-only, through SQLite's own
// locks, so a read sees what Lumiverse has committed, the log included; SQLite keeps those locks in
// its shared-memory index beside the database (`lumiverse.db-shm`), which every reader of a WAL
// database writes, Lumiverse's own among them. The database and its log are never written. Where
// Lumiverse is stopped cleanly, neither the log nor the index is there, and nothing can be missing
// from a log that isn't there. A read-only open would then make both files at its first read (as
// SQLite itself does) or fail that read (as macOS's SQLite does), and the open alone never shows
// which: so how to open is decided before opening, and the file is read as immutable, which takes no
// lock and makes no file.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { decodeMessage } from "../backend/spindle-host";
import type { HostMessage } from "../backend/host";
import { isRecord, type JsonObject } from "../shared/json";
import { openQuiet } from "./quiet-db";

/** The database's file in Lumiverse's data folder (`src/db/connection.ts`). */
export const DATABASE_FILE = "lumiverse.db";

/**
 * The hash RPE gives a message's text, to tie a turn to the reply as saved and to find it again
 * (STANDALONE-PLAN §6.3): the contract's text hash, the first 32 hex digits of the SHA-256 of its
 * UTF-8, as the adapter gives each message it reads from Lumiverse.
 */
export function textHash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);
}

/** A message's swipes as RPE knows them: each one's text hash (null for one with no text) and its date, as Lumiverse keeps them. */
export interface SwipeFacts {
  hashes: (string | null)[];
  dates: (number | null)[];
}

export interface ChatRow {
  id: string;
  name: string;
  /** The character whose chat it is (`character_id`); null for a chat with none, as Lumiverse's temporary chat. */
  character: string | null;
  metadata: JsonObject;
  /** Unix seconds, as Lumiverse keeps it. */
  updatedAt: number;
}

/** How the extension is installed: its storage is per extension (`operator`) or per user (`user`, in its owner's folder). */
export interface Install {
  scope: "operator" | "user";
  owner: string | null;
  branch: string | null;
  version: string;
}

/** What today's build put in Lumiverse itself, counted: the report lists it, and nothing of it changes. */
export interface LumiverseMarks {
  /** Books the engine made for its worlds (metadata `lumi_rp_engine: true`). */
  engineBooks: number;
  /** Entries in those books. */
  engineEntries: number;
  /** Entries of the user's own books carrying the engine's lore fields or secret marks (`extensions.lumi_rp_engine`). */
  markedEntries: number;
  /** Chats with an engine book attached (`chat_world_book_ids`). */
  chatsWithEngineBook: number;
  /** Regex scripts in the engine's folder. */
  regexScripts: number;
  /** Preset blocks named `RPEngine · …` (and the `RPEngine` category). */
  presetBlocks: number;
  /** Preset blocks whose text names an outlet of the engine's (`{{outlet::lre_…}}`). */
  outletReferences: number;
}

function parsed(text: unknown): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function objectOf(text: unknown): JsonObject {
  const value = parsed(text);
  return isRecord(value) ? (value as JsonObject) : {};
}

export class LumiverseDb {
  private constructor(
    private readonly db: Database,
    /** How it was opened: through SQLite's locks, or as an unchanging file where no log exists. */
    readonly opened: "locked" | "immutable",
    private readonly closer: () => void,
  ) {}

  /** Opens Lumiverse's database in `dataDir` for reading only: under SQLite's locks while its log or their index is beside it, else as an unchanging file. */
  static open(dataDir: string): LumiverseDb {
    const path = join(dataDir, DATABASE_FILE);
    if (!existsSync(path)) throw new Error(`There is no Lumiverse database at ${path}.`);
    if (existsSync(`${path}-wal`) || existsSync(`${path}-shm`)) {
      const db = new Database(path, { readonly: true });
      return new LumiverseDb(db, "locked", () => db.close());
    }
    const quiet = openQuiet(path);
    return new LumiverseDb(quiet.db, "immutable", quiet.close);
  }

  close(): void {
    this.closer();
  }

  /** The user's name, or null when there is no such user. */
  username(userId: string): string | null {
    const row = this.db.query<{ username: string | null }, [string]>(`SELECT username FROM "user" WHERE id = ?`).get(userId);
    return row === null ? null : (row.username ?? null);
  }

  /** How the extension is installed, from Lumiverse's own row of it; null when it isn't. */
  install(identifier: string): Install | null {
    const row = this.db.query<{ install_scope: string | null; installed_by_user_id: string | null; branch: string | null; version: string | null }, [string]>("SELECT install_scope, installed_by_user_id, branch, version FROM extensions WHERE identifier = ?").get(identifier);
    if (row === null) return null;
    return { scope: row.install_scope === "user" ? "user" : "operator", owner: row.installed_by_user_id, branch: row.branch, version: row.version ?? "" };
  }

  /** Every chat of the user's, the most recently updated first, as Spindle's chat list reads them (`chats.service.ts`). */
  chats(userId: string): ChatRow[] {
    const rows = this.db.query<{ id: string; name: string | null; character_id: string | null; metadata: string | null; updated_at: number | null }, [string]>("SELECT id, name, character_id, metadata, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC, id ASC").all(userId);
    return rows.map((r) => ({ id: r.id, name: r.name ?? "", character: typeof r.character_id === "string" && r.character_id !== "" ? r.character_id : null, metadata: objectOf(r.metadata), updatedAt: r.updated_at ?? 0 }));
  }

  /** A character of the user's, by its id and name; null when the user has none of that id. */
  character(characterId: string, userId: string): { id: string; name: string } | null {
    return this.db.query<{ id: string; name: string }, [string, string]>("SELECT id, name FROM characters WHERE id = ? AND user_id = ?").get(characterId, userId);
  }

  /** How many messages a chat of the user's holds. */
  messageCount(chatId: string, userId: string): number {
    return this.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.chat_id = ? AND c.user_id = ?").get(chatId, userId)?.n ?? 0;
  }

  /**
   * A chat's messages in order, as an extension is handed them (`chat.getMessages`) and today's
   * build reads them (`decodeMessage`), only when the chat is the user's; and each one's swipes as
   * RPE's adapter reads them, by message id. Both come from one read, so that a swipe's place among
   * the messages' swipes is its place among their hashes and dates. A swipe's hash is that of its text
   * in `swipes` (of `content` for the showing one when `swipes` holds no text for it, as Lumiverse
   * falls back to it), and its date is `swipe_dates` at its place, a number or none.
   */
  messages(chatId: string, userId: string): { messages: HostMessage[]; swipes: Map<string, SwipeFacts> } {
    const rows = this.db
      .query<{ id: string; chat_id: string; index_in_chat: number; is_user: number; name: string; content: string; swipe_id: number | null; swipes: string | null; swipe_dates: string | null; extra: string | null }, [string, string]>(
        "SELECT m.id, m.chat_id, m.index_in_chat, m.is_user, m.name, m.content, m.swipe_id, m.swipes, m.swipe_dates, m.extra FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.chat_id = ? AND c.user_id = ? ORDER BY m.index_in_chat ASC",
      )
      .all(chatId, userId);
    const messages: HostMessage[] = [];
    const facts = new Map<string, SwipeFacts>();
    for (const r of rows) {
      const raw = parsed(r.swipes);
      const swipes: unknown[] = Array.isArray(raw) ? raw : [r.content];
      const extra = objectOf(r.extra);
      const metadata = isRecord(extra.spindle_metadata) ? extra.spindle_metadata : undefined;
      const message = decodeMessage(
        {
          id: r.id,
          chat_id: r.chat_id,
          index_in_chat: r.index_in_chat,
          is_user: r.is_user === 1,
          role: r.is_user === 1 ? "user" : "assistant",
          name: r.name,
          content: r.content,
          swipe_id: r.swipe_id ?? 0,
          swipes,
          ...(metadata ? { metadata } : {}),
        },
        chatId,
      );
      if (message) messages.push(message);
      const shown = r.swipe_id ?? 0;
      const dates = parsed(r.swipe_dates);
      facts.set(r.id, {
        hashes: swipes.map((s, i) => (typeof s === "string" ? textHash(s) : i === shown ? textHash(r.content) : null)),
        dates: swipes.map((_, i) => {
          const d = Array.isArray(dates) ? (dates[i] as unknown) : undefined;
          return typeof d === "number" && Number.isFinite(d) ? d : null;
        }),
      });
    }
    return { messages, swipes: facts };
  }

  /**
   * The user's messages whose metadata names the extension (`spindle_metadata.<identifier>`, or a
   * continuation chunk `<identifier>:<i>`), with that metadata whole: where today's build keeps a
   * reply's records and a user message's panel request.
   */
  engineMessages(userId: string, identifier: string): { id: string; chatId: string; isUser: boolean; metadata: JsonObject }[] {
    const rows = this.db
      .query<{ id: string; chat_id: string; is_user: number; meta: string | null }, [string, string]>("SELECT m.id, m.chat_id, m.is_user, json_extract(m.extra, '$.spindle_metadata') AS meta FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = ? AND instr(m.extra, ?) > 0 ORDER BY m.chat_id, m.index_in_chat")
      .all(userId, `"${identifier}`);
    return rows.flatMap((r) => {
      const metadata = objectOf(r.meta);
      return Object.keys(metadata).some((k) => k === identifier || k.startsWith(`${identifier}:`)) ? [{ id: r.id, chatId: r.chat_id, isUser: r.is_user === 1, metadata }] : [];
    });
  }

  /** What today's build put in Lumiverse for the user, counted. */
  marks(userId: string, chats: readonly ChatRow[]): LumiverseMarks {
    const books = this.db.query<{ id: string; metadata: string | null }, [string]>("SELECT id, metadata FROM world_books WHERE user_id = ?").all(userId);
    const engineBookIds = new Set(books.filter((b) => objectOf(b.metadata).lumi_rp_engine === true).map((b) => b.id));
    const entries = this.db.query<{ world_book_id: string; extensions: string | null }, [string]>("SELECT e.world_book_id, e.extensions FROM world_book_entries e JOIN world_books b ON b.id = e.world_book_id WHERE b.user_id = ?").all(userId);
    let engineEntries = 0;
    let markedEntries = 0;
    for (const e of entries) {
      if (engineBookIds.has(e.world_book_id)) engineEntries++;
      else if (objectOf(e.extensions).lumi_rp_engine !== undefined) markedEntries++;
    }
    const chatsWithEngineBook = chats.filter((c) => Array.isArray(c.metadata.chat_world_book_ids) && c.metadata.chat_world_book_ids.some((id) => typeof id === "string" && engineBookIds.has(id))).length;
    const regex = this.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM regex_scripts WHERE user_id = ? AND folder = 'LumiRPEngine'").get(userId)?.n ?? 0;
    let presetBlocks = 0;
    let outletReferences = 0;
    // A preset's blocks, in order, are its `prompt_order` (Lumiverse's `listPromptBlocks`).
    for (const p of this.db.query<{ prompt_order: string | null }, [string]>("SELECT prompt_order FROM presets WHERE user_id = ?").all(userId)) {
      const blocks = parsed(p.prompt_order);
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (!isRecord(block)) continue;
        if (typeof block.name === "string" && (block.name === "RPEngine" || block.name.startsWith("RPEngine · "))) presetBlocks++;
        if (typeof block.content === "string" && block.content.includes("{{outlet::lre_")) outletReferences++;
      }
    }
    return { engineBooks: engineBookIds.size, engineEntries, markedEntries, chatsWithEngineBook, regexScripts: regex, presetBlocks, outletReferences };
  }
}
