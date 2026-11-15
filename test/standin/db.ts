// The stand-in Lumiverse's database file: the tables RPE's reader reads, made with the very statements
// of Lumiverse's `src/db/baseline.sql` (lines cited per table), opened with Lumiverse's own pragmas
// (`src/db/maintenance.ts:330-343`): write-ahead log, foreign keys on. Its writer stays open, as a
// running Lumiverse's does, so the `-wal` and `-shm` files sit beside it. What the stand-in holds in
// memory is written here whole after each change (`write`). Every row is invented.

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import type { Entry } from "./lore";
import type { Role } from "./steps";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `src/db/baseline.sql`: `"user"` `:943-957`, `characters` `:44-62`, `chats` `:112-119`, `message_breakdowns` `:648-653`, `messages` `:655-670`, `personas` `:743-752`, `presets` `:754-763`, `settings` `:835-841`, `world_book_entries` `:1070-1096` and `:1739-1740`, `world_books` `:1105-1112`. */
export const LUMIVERSE_DDL = `
CREATE TABLE images (id TEXT PRIMARY KEY);
CREATE TABLE "user" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
  username TEXT UNIQUE,
  displayUsername TEXT,
  role TEXT DEFAULT 'user',
  banned INTEGER DEFAULT 0,
  banReason TEXT,
  banExpires INTEGER
);
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_path TEXT,
  description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '',
  first_mes TEXT NOT NULL DEFAULT '',
  mes_example TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '',
  creator_notes TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  post_history_instructions TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  alternate_greetings TEXT NOT NULL DEFAULT '[]',
  extensions TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, image_id TEXT REFERENCES images(id) ON DELETE SET NULL, user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE, deleting INTEGER NOT NULL DEFAULT 0, folder TEXT NOT NULL DEFAULT '', library_scope TEXT NOT NULL DEFAULT 'mine' CHECK(library_scope IN ('mine', 'shared')));
CREATE TABLE "chats" (
  id TEXT PRIMARY KEY,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE message_breakdowns (
  message_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
, user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  index_in_chat INTEGER NOT NULL,
  is_user INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  send_date INTEGER NOT NULL DEFAULT (unixepoch()),
  swipe_id INTEGER NOT NULL DEFAULT 0,
  swipes TEXT NOT NULL DEFAULT '[]',
  extra TEXT NOT NULL DEFAULT '{}',
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  branch_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
, swipe_dates TEXT NOT NULL DEFAULT '[]'
, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, attached_world_book_id TEXT REFERENCES world_books(id) ON DELETE SET NULL, image_id TEXT REFERENCES images(id) ON DELETE SET NULL, user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT '', folder TEXT NOT NULL DEFAULT '', subjective_pronoun TEXT NOT NULL DEFAULT '', objective_pronoun TEXT NOT NULL DEFAULT '', possessive_pronoun TEXT NOT NULL DEFAULT '', is_narrator INTEGER NOT NULL DEFAULT 0, reflexive_pronoun TEXT NOT NULL DEFAULT '', possessive_pronoun_standalone TEXT NOT NULL DEFAULT '');
CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '{}',
  prompt_order TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, prompts TEXT NOT NULL DEFAULT '{}', user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE, engine TEXT NOT NULL DEFAULT 'classic', cache_revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE "settings" (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY (key, user_id)
);
CREATE TABLE world_books (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE, folder TEXT NOT NULL DEFAULT '');
CREATE TABLE world_book_entries (
  id TEXT PRIMARY KEY,
  world_book_id TEXT NOT NULL REFERENCES world_books(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '[]',
  keysecondary TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 4,
  role TEXT,
  order_value INTEGER NOT NULL DEFAULT 100,
  selective INTEGER NOT NULL DEFAULT 0,
  constant INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT '',
  group_override INTEGER NOT NULL DEFAULT 0,
  group_weight INTEGER NOT NULL DEFAULT 100,
  probability INTEGER NOT NULL DEFAULT 100,
  scan_depth INTEGER,
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  match_whole_words INTEGER NOT NULL DEFAULT 0,
  automation_id TEXT,
  extensions TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, use_regex INTEGER NOT NULL DEFAULT 0, prevent_recursion INTEGER NOT NULL DEFAULT 0, exclude_recursion INTEGER NOT NULL DEFAULT 0, delay_until_recursion INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 10, sticky INTEGER NOT NULL DEFAULT 0, cooldown INTEGER NOT NULL DEFAULT 0, delay INTEGER NOT NULL DEFAULT 0, selective_logic INTEGER NOT NULL DEFAULT 0, use_probability INTEGER NOT NULL DEFAULT 1, vectorized INTEGER NOT NULL DEFAULT 0, vector_index_status TEXT NOT NULL DEFAULT 'not_enabled', vector_indexed_at INTEGER, vector_index_error TEXT, exclude_greeting INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1);
ALTER TABLE world_book_entries ADD COLUMN folder TEXT NOT NULL DEFAULT '';
ALTER TABLE world_book_entries ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
`;

/** Rows as the stand-in writes them: each table's columns by name. */
export type Row = Record<string, string | number | null>;

export interface Rows {
  user: Row[];
  characters: Row[];
  chats: Row[];
  messages: Row[];
  world_books: Row[];
  world_book_entries: Row[];
  personas: Row[];
  presets: Row[];
  settings: Row[];
  message_breakdowns: Row[];
}

/** The managed keys Lumiverse keeps inside an entry's `extensions` (`services/world-books.service.ts:170-172`, `:174-194`). */
export const WI_MARKERS = ["chat_history", "world_info_before", "world_info_after", "char_description", "char_personality", "persona_description", "scenario", "dialogue_examples", "main_prompt", "enhance_definitions", "jailbreak", "nsfw_prompt"] as const;

/**
 * An entry as `createEntry` writes its row (`services/world-books.service.ts:827-880`, `:1757-1790`): each column as the table has it, its `uid` its
 * own and never its id, its outlet name, its marker and the marker's side folded into `extensions` (`buildStoredEntryExtensions`, `:216-243`),
 * the revision 1. What the entry does not give is the column's default.
 */
export function entryRow(e: Entry, uid: string, now: number): Row {
  const outlet = typeof e.outlet_name === "string" && e.outlet_name.trim() !== "" ? e.outlet_name.trim() : null;
  const marker = typeof e.wi_marker === "string" && (WI_MARKERS as readonly string[]).includes(e.wi_marker.trim().toLowerCase()) ? e.wi_marker.trim().toLowerCase() : null;
  const side = typeof e.wi_marker_side === "string" && ["before", "after"].includes(e.wi_marker_side.trim().toLowerCase()) ? e.wi_marker_side.trim().toLowerCase() : null;
  const extensions = { ...(e.extensions ?? {}), ...(outlet !== null ? { outlet_name: outlet } : {}), ...(marker !== null ? { wi_marker: marker } : {}), ...(side !== null ? { wi_marker_side: side } : {}) };
  const flag = (value: boolean | undefined, otherwise = false): number => ((value ?? otherwise) ? 1 : 0);
  return {
    id: e.id,
    world_book_id: e.book,
    uid,
    key: JSON.stringify(e.keys ?? []),
    keysecondary: JSON.stringify(e.keysecondary ?? []),
    content: e.content,
    comment: e.comment ?? "",
    position: e.position ?? 0,
    depth: e.depth ?? 4,
    role: e.role ?? null,
    order_value: e.order_value ?? 100,
    selective: flag(e.selective),
    constant: flag(e.constant),
    disabled: flag(e.disabled),
    group_name: e.group_name ?? "",
    group_override: flag(e.group_override),
    group_weight: e.group_weight ?? 100,
    probability: e.probability ?? 100,
    scan_depth: e.scan_depth ?? null,
    case_sensitive: flag(e.case_sensitive),
    match_whole_words: flag(e.match_whole_words),
    automation_id: e.automation_id ?? null,
    extensions: JSON.stringify(extensions),
    created_at: now,
    updated_at: now,
    use_regex: flag(e.use_regex),
    prevent_recursion: flag(e.prevent_recursion),
    exclude_recursion: flag(e.exclude_recursion),
    delay_until_recursion: flag(e.delay_until_recursion),
    priority: e.priority ?? 10,
    sticky: e.sticky ?? 0,
    cooldown: e.cooldown ?? 0,
    delay: e.delay ?? 0,
    selective_logic: e.selective_logic ?? 0,
    use_probability: flag(e.use_probability, true),
    vectorized: flag(e.vectorized),
    vector_index_status: e.vector_index_status ?? "not_enabled",
    exclude_greeting: flag(e.exclude_greeting),
    revision: 1,
    folder: "",
    tags: "[]",
  };
}

/** An entry as `rowToEntry` reads its row (`services/world-books.service.ts:343-382`): the managed keys out of `extensions`, `role` null when empty. */
export function entryOfRow(row: Record<string, unknown>): Entry {
  const raw = JSON.parse(String(row.extensions)) as Record<string, unknown>;
  const { outlet_name, outletName, wi_marker, wiMarker, wi_marker_side, wiMarkerSide, ...rest } = raw;
  const trimmed = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  const marker = trimmed(wi_marker ?? wiMarker)?.toLowerCase() ?? null;
  const sideRaw = trimmed(wi_marker_side ?? wiMarkerSide)?.toLowerCase() ?? null;
  const flag = (value: unknown): boolean => value === 1 || value === true;
  return {
    id: String(row.id),
    book: String(row.world_book_id),
    uid: String(row.uid),
    content: String(row.content),
    comment: String(row.comment),
    keys: JSON.parse(String(row.key)) as string[],
    keysecondary: JSON.parse(String(row.keysecondary)) as string[],
    position: Number(row.position) as Entry["position"],
    depth: Number(row.depth),
    ...(typeof row.role === "string" && row.role !== "" ? { role: row.role as Role } : {}),
    order_value: Number(row.order_value),
    selective: flag(row.selective),
    constant: flag(row.constant),
    disabled: flag(row.disabled),
    group_name: String(row.group_name),
    group_override: flag(row.group_override),
    group_weight: Number(row.group_weight),
    probability: Number(row.probability),
    scan_depth: row.scan_depth === null || row.scan_depth === undefined ? null : Number(row.scan_depth),
    case_sensitive: flag(row.case_sensitive),
    match_whole_words: flag(row.match_whole_words),
    automation_id: typeof row.automation_id === "string" && row.automation_id !== "" ? row.automation_id : null,
    extensions: rest,
    outlet_name: trimmed(outlet_name ?? outletName),
    wi_marker: marker !== null && (WI_MARKERS as readonly string[]).includes(marker) ? marker : null,
    wi_marker_side: sideRaw === "before" || sideRaw === "after" ? sideRaw : null,
    use_regex: flag(row.use_regex),
    prevent_recursion: flag(row.prevent_recursion),
    exclude_recursion: flag(row.exclude_recursion),
    delay_until_recursion: flag(row.delay_until_recursion),
    priority: Number(row.priority),
    sticky: Number(row.sticky),
    cooldown: Number(row.cooldown),
    delay: Number(row.delay),
    selective_logic: Number(row.selective_logic) as 0 | 1 | 2 | 3,
    use_probability: flag(row.use_probability),
    vectorized: flag(row.vectorized),
    vector_index_status: String(row.vector_index_status),
    exclude_greeting: flag(row.exclude_greeting),
  };
}

export class StandInDb {
  readonly dir: string;
  readonly path: string;
  private readonly db: Database;

  /** A new file in a folder of its own; `ddl` lets a test make a Lumiverse RPE does not know. */
  constructor(ddl = LUMIVERSE_DDL) {
    this.dir = mkdtempSync(join(tmpdir(), "rpe-standin-"));
    this.path = join(this.dir, "lumiverse.db");
    this.db = new Database(this.path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(ddl);
  }

  /** The whole of what the stand-in holds, written in one transaction, parents first. */
  write(rows: Rows): void {
    const order: (keyof Rows)[] = ["user", "characters", "world_books", "chats", "messages", "world_book_entries", "personas", "presets", "settings", "message_breakdowns"];
    this.db.transaction(() => {
      for (const table of [...order].reverse()) this.db.run(`DELETE FROM "${table}"`);
      for (const table of order) {
        for (const row of rows[table]) {
          const columns = Object.keys(row);
          this.db.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map((c) => row[c] ?? null));
        }
      }
    })();
  }

  /** One row written as given: the columns it names, the rest the table's own. */
  insert(table: keyof Rows, row: Row): void {
    const columns = Object.keys(row);
    this.db.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map((c) => row[c] ?? null));
  }

  /** One statement of the stand-in's own, for a test that changes the file under the reader. */
  run(sql: string, ...params: (string | number | null)[]): void {
    this.db.query(sql).run(...params);
  }

  /** The rows a statement of the stand-in's own gives: what its HTTP routes answer from. */
  rows(sql: string, ...params: (string | number | null)[]): Record<string, unknown>[] {
    return this.db.query(sql).all(...params) as Record<string, unknown>[];
  }

  close(): void {
    this.db.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
