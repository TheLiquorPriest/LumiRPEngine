// The migration's reads of Lumiverse's database (STANDALONE-PLAN §15.3 step 2, §16; READINGS R-2): the
// same door as the adapter's own reader (`db.ts`), for the one run that reads what today's build left
// in Lumiverse. Read-only: SELECTs and the read-only pragmas `schema_version` and `table_info`, nothing
// else. Every statement is scoped to the one user the run was opened for, the user bound as a value
// through the table that owns the row: another user's chat, message, book or setting reads as none.
// Before a read, and again whenever the file's schema version moves, every table and column it reads
// is checked against the type Lumiverse declares it with (`db/baseline.sql`); a file that differs is
// refused, with one sentence naming the difference, until its schema moves again. No connection key is
// read: a connection's key is a secret Lumiverse keeps apart (`connection_profiles` holds whether it has
// one, not the key), and of the connections only the columns that say what each one is are read.
//
// The caller opens the file and hands it in: the migration reads a database Lumiverse may have stopped
// (so no log is beside it), which the plain open of `db.ts` refuses, and which the caller opens without
// making a file beside it. Reads are synchronous, as the migration's are; it waits for no other reader
// of the file.

import type { Database } from "bun:sqlite";
import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import { READ_COLUMNS } from "./db";
import { chatFrom, settingFrom, type LvChat, type LvSetting } from "./rows";

/** A database opened for reading, and how to close it. */
export interface OpenedDatabase {
  db: Database;
  close(): void;
}

/**
 * The tables and columns the migration reads, each with the type `db/baseline.sql` declares it with:
 * the adapter's own (`READ_COLUMNS`, which holds `chats`, `messages`, `world_books`, `world_book_entries`,
 * `characters`, `presets` and `settings` as the adapter reads them) and the three it alone reads:
 * `"user"` `:943-957`, `extensions` `:323-337` and `regex_scripts` `:789-813`.
 */
export const MIGRATION_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  chats: READ_COLUMNS.chats!,
  messages: READ_COLUMNS.messages!,
  world_books: READ_COLUMNS.world_books!,
  world_book_entries: READ_COLUMNS.world_book_entries!,
  characters: READ_COLUMNS.characters!,
  presets: READ_COLUMNS.presets!,
  settings: READ_COLUMNS.settings!,
  user: { id: "TEXT", username: "TEXT" },
  extensions: { identifier: "TEXT", version: "TEXT", install_scope: "TEXT", installed_by_user_id: "TEXT", branch: "TEXT" },
  regex_scripts: { user_id: "TEXT", folder: "TEXT" },
};

/**
 * The columns of the user's connections the migration reads, checked when it reads them: what each
 * connection is (`connection_profiles`, `db/baseline.sql:122-133`; `user_id` and `has_api_key` by
 * migrations 013 and 016), never its key, which is no column of it.
 */
export const PROFILE_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  connection_profiles: { id: "TEXT", name: "TEXT", provider: "TEXT", api_url: "TEXT", model: "TEXT", user_id: "TEXT", updated_at: "INTEGER" },
};

const SCHEMA = "SELECT schema_version AS schema FROM pragma_schema_version";

/** How the file differs from the tables and columns given (the migration's, unless others are named), in one sentence; null when every one is there as declared. */
export function migrationSchemaDifference(db: Database, read: Readonly<Record<string, Readonly<Record<string, string>>>> = MIGRATION_COLUMNS): string | null {
  const tables = Object.keys(read);
  const found = new Map<string, Map<string, string>>(tables.map((t) => [t, new Map()]));
  const query = `WITH t(name) AS (VALUES ${tables.map(() => "(?)").join(", ")}) SELECT t.name AS tbl, c.name AS col, c.type AS type FROM t LEFT JOIN pragma_table_info(t.name) AS c`;
  for (const row of db.query<{ tbl: string; col: string | null; type: string | null }, string[]>(query).all(...tables)) {
    if (row.col !== null) found.get(row.tbl)?.set(row.col, (row.type ?? "").trim().toUpperCase());
  }
  const differences: string[] = [];
  for (const [table, columns] of Object.entries(read)) {
    const has = found.get(table)!;
    if (has.size === 0) {
      differences.push(`it has no table "${table}"`);
      continue;
    }
    for (const [column, type] of Object.entries(columns)) {
      const actual = has.get(column);
      if (actual === undefined) differences.push(`its table "${table}" has no column "${column}"`);
      else if (actual !== type) differences.push(`its column "${table}.${column}" is declared ${actual === "" ? "with no type" : actual}, where RPE reads it as ${type}`);
    }
  }
  const [first, ...more] = differences;
  if (first === undefined) return null;
  return more.length === 0 ? first : `${first} (and ${more.length} more ${more.length === 1 ? "difference" : "differences"})`;
}

/** A chat's message as the migration reads it: the row's texts and lists, parsed as Lumiverse's own mapper parses them (`rowToMessage`, `chats.service.ts:587-605`). */
export interface MigrationMessage {
  id: string;
  chat: string;
  index: number;
  isUser: boolean;
  name: string;
  /** The stored text of the swipe showing (`content`). */
  content: string;
  swipe: number;
  /** Every swipe as saved; the message's `content` alone where `swipes` is no list. */
  swipes: unknown[];
  /** `swipe_dates` as saved: a list, or none where it is not JSON. */
  dates: unknown[];
  /** What the extensions put on it (`extra.spindle_metadata`); absent where there is none. */
  metadata: JsonObject | undefined;
  /** The user hid it from the prompt (`extra.hidden`, as `db.ts` reads the mark); false where `extra` is not JSON. */
  hidden: boolean;
}

/** A message that carries an extension's metadata, with that metadata whole. */
export interface MetadataMessage {
  id: string;
  chat: string;
  isUser: boolean;
  metadata: JsonObject;
}

/** How an extension is installed, from Lumiverse's own row of it. */
export interface InstallRow {
  scope: "operator" | "user";
  owner: string | null;
  branch: string | null;
  version: string;
}

/** One of the user's connections in Lumiverse, as what it is: its provider, address and model, never its key. */
export interface ProfileRow {
  id: string;
  name: string;
  /** Lumiverse's id for its provider (`custom` for an OpenAI-compatible one). */
  provider: string;
  /** Its address (`api_url`); empty where the provider gives its own. */
  url: string;
  model: string;
}

export interface MigrationReads {
  /** The user's name, or null when there is no such user. */
  username(): string | null;
  /** How the extension is installed; null when it is not. The row is the extension's, not any user's. */
  install(identifier: string): InstallRow | null;
  /** Every chat of the user's, the most recently updated first (`chats.service.ts`'s list). */
  chats(): LvChat[];
  /** A character of the user's; null when the user has none of that id. */
  character(id: string): { id: string; name: string } | null;
  /** How many messages a chat of the user's holds; none for another user's chat. */
  messageCount(chat: string): number;
  /** A chat's messages in order, only where the chat is the user's. */
  messages(chat: string): MigrationMessage[];
  /** The user's messages whose extra holds `text`, with the extensions' metadata whole, in chat and place order. */
  metadataMessages(text: string): MetadataMessage[];
  /** The user's world books, each with its metadata. */
  books(): { id: string; metadata: JsonObject }[];
  /** The entries of the user's books, each with its book and its extensions. */
  entryExtensions(): { book: string; extensions: JsonObject }[];
  /** How many regex scripts of the user's are in the folder. */
  regexScripts(folder: string): number;
  /** Each preset's prompt order of the user's, as JSON; null where it is not. */
  promptOrders(): JsonValue[];
  /** One of the user's settings; null when there is none. */
  setting(key: string): LvSetting | null;
  /** The user's connections in Lumiverse, the most recently changed first (`connections.service.ts`'s list): what each is, never its key. */
  connectionProfiles(): ProfileRow[];
  close(): void;
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

/** Lumiverse's database is one RPE does not read (a table or column the migration needs is not there): its message says which, in RPE's words. */
export class DatabaseNotRead extends Error {}

const OF_CHAT = "FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.chat_id = ? AND c.user_id = ?";

/** Opens the migration's reads of `opened`, for `user`'s rows only. Closing them closes the database. */
export function migrationReads(opened: OpenedDatabase, user: string): MigrationReads {
  const { db } = opened;
  /** By the tables a read names: the schema version they were last checked at, and the one a difference was found at (those reads are refused until the schema moves). */
  const checks = new Map<object, { checked: number | null; refusedAt: number | null; refusal: string }>();

  /** The database, the tables and columns `read` names checked at its schema as it stands now. */
  function door(read = MIGRATION_COLUMNS): Database {
    const schema = db.query<{ schema: number }, []>(SCHEMA).get()?.schema ?? -1;
    let state = checks.get(read);
    if (state === undefined) checks.set(read, (state = { checked: null, refusedAt: null, refusal: "" }));
    if (state.refusedAt === schema) throw new DatabaseNotRead(state.refusal);
    if (state.checked !== schema) {
      const difference = migrationSchemaDifference(db, read);
      if (difference !== null) {
        state.refusedAt = schema;
        state.refusal = `RPE does not read Lumiverse's database: it was made by a Lumiverse RPE does not know: ${difference}.`;
        throw new DatabaseNotRead(state.refusal);
      }
      state.checked = schema;
    }
    return db;
  }

  return {
    username() {
      return door().query<{ username: string | null }, [string]>(`SELECT username FROM "user" WHERE id = ?`).get(user)?.username ?? null;
    },
    install(identifier) {
      const row = door().query<{ install_scope: string | null; installed_by_user_id: string | null; branch: string | null; version: string | null }, [string]>("SELECT install_scope, installed_by_user_id, branch, version FROM extensions WHERE identifier = ?").get(identifier);
      if (row === null) return null;
      return { scope: row.install_scope === "user" ? "user" : "operator", owner: row.installed_by_user_id, branch: row.branch, version: row.version ?? "" };
    },
    chats() {
      return door()
        .query<Record<string, unknown>, [string]>("SELECT id, user_id, character_id, name, metadata, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC, id ASC")
        .all(user)
        .map(chatFrom);
    },
    character(id) {
      return door().query<{ id: string; name: string }, [string, string]>("SELECT id, name FROM characters WHERE id = ? AND user_id = ?").get(id, user);
    },
    messageCount(chat) {
      return door().query<{ n: number }, [string, string]>(`SELECT count(*) AS n ${OF_CHAT}`).get(chat, user)?.n ?? 0;
    },
    messages(chat) {
      const rows = door()
        .query<{ id: string; chat_id: string; index_in_chat: number; is_user: number; name: string; content: string; swipe_id: number | null; swipes: string | null; swipe_dates: string | null; extra: string | null }, [string, string]>(
          `SELECT m.id, m.chat_id, m.index_in_chat, m.is_user, m.name, m.content, m.swipe_id, m.swipes, m.swipe_dates, m.extra ${OF_CHAT} ORDER BY m.index_in_chat ASC`,
        )
        .all(chat, user);
      return rows.map((r) => {
        const swipes = parsed(r.swipes);
        const dates = parsed(r.swipe_dates);
        const extra = objectOf(r.extra);
        return {
          id: r.id,
          chat: r.chat_id,
          index: r.index_in_chat,
          isUser: r.is_user === 1,
          name: r.name,
          content: r.content,
          swipe: r.swipe_id ?? 0,
          swipes: Array.isArray(swipes) ? swipes : [r.content],
          dates: Array.isArray(dates) ? dates : [],
          metadata: isRecord(extra.spindle_metadata) ? (extra.spindle_metadata as JsonObject) : undefined,
          hidden: extra.hidden === true,
        };
      });
    },
    metadataMessages(text) {
      return door()
        .query<{ id: string; chat_id: string; is_user: number; meta: string | null }, [string, string]>("SELECT m.id, m.chat_id, m.is_user, json_extract(m.extra, '$.spindle_metadata') AS meta FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = ? AND instr(m.extra, ?) > 0 ORDER BY m.chat_id, m.index_in_chat")
        .all(user, text)
        .map((r) => ({ id: r.id, chat: r.chat_id, isUser: r.is_user === 1, metadata: objectOf(r.meta) }));
    },
    books() {
      return door()
        .query<{ id: string; metadata: string | null }, [string]>("SELECT id, metadata FROM world_books WHERE user_id = ?")
        .all(user)
        .map((b) => ({ id: b.id, metadata: objectOf(b.metadata) }));
    },
    entryExtensions() {
      return door()
        .query<{ world_book_id: string; extensions: string | null }, [string]>("SELECT e.world_book_id, e.extensions FROM world_book_entries e JOIN world_books b ON b.id = e.world_book_id WHERE b.user_id = ?")
        .all(user)
        .map((e) => ({ book: e.world_book_id, extensions: objectOf(e.extensions) }));
    },
    regexScripts(folder) {
      return door().query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM regex_scripts WHERE user_id = ? AND folder = ?").get(user, folder)?.n ?? 0;
    },
    promptOrders() {
      return door()
        .query<{ prompt_order: string | null }, [string]>("SELECT prompt_order FROM presets WHERE user_id = ?")
        .all(user)
        .map((p) => parsed(p.prompt_order) as JsonValue);
    },
    setting(key) {
      const row = door().query<Record<string, unknown>, [string, string]>("SELECT key, value, updated_at FROM settings WHERE key = ? AND user_id = ?").get(key, user);
      return row === null ? null : settingFrom(row);
    },
    connectionProfiles() {
      return door(PROFILE_COLUMNS)
        .query<ProfileRow, [string]>("SELECT id, name, provider, api_url AS url, model FROM connection_profiles WHERE user_id = ? ORDER BY updated_at DESC, id ASC")
        .all(user);
    },
    close: () => opened.close(),
  };
}
