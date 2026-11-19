// Lumiverse's database file, read directly and only read (STANDALONE-PLAN §4.2, §4.4), for an RPE on
// the machine Lumiverse runs on. The file is opened read-only and the reader runs SELECTs and the
// read-only pragmas `schema_version` and `table_info`, nothing else: no write, no checkpoint, no pragma
// that sets anything. Lumiverse keeps the file in write-ahead-log mode (`db/maintenance.ts:330-343`)
// and writes it from its own process all the while, so every read is one short statement.
//
// Before the first read, and again whenever the file's schema moves or another file takes its path,
// the reader checks every table and column it reads against the type Lumiverse declares it with
// (`db/baseline.sql`). A file that differs was made by a Lumiverse this reader does not know: it is
// refused, with one sentence naming the difference, until the file changes again. A file that is
// missing, unreadable or no database is refused the same way. A refusal is `SourceOff`, which sends
// the read to Lumiverse's HTTP routes (`reads.ts`).
//
// Every statement is scoped to RPE's own user through the table that owns the row, the user bound as a
// value: another user's chat, book or setting, and a row with no owner, reads as none.

import { Database } from "bun:sqlite";
import { closeSync, openSync, readSync, statSync, type Stats } from "node:fs";
import type { JsonValue } from "../../shared/json";
import { SourceOff, type LumiverseReads, type LvStep, type Places } from "./reads";
import { bookFrom, characterFrom, chatFrom, entryFrom, messageFrom, personaFrom, presetFrom, settingFrom, Unreadable, type LvMessage } from "./rows";
import { KEEP, KEPT, Memo } from "./memo";
import { textHash } from "./wire";

/**
 * Each table read and each column of it read, with the type `db/baseline.sql` declares it with:
 * `characters` `:44-62`, `chats` `:112-119`, `message_breakdowns` `:648-653`, `messages` `:655-670`,
 * `personas` `:743-752`, `presets` `:754-763`, `settings` `:835-841`, `world_book_entries`
 * `:1070-1096`, `world_books` `:1105-1112`. A column not read may come and go as Lumiverse likes.
 */
export const READ_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  chats: { id: "TEXT", user_id: "TEXT", character_id: "TEXT", name: "TEXT", metadata: "TEXT", updated_at: "INTEGER" },
  messages: { id: "TEXT", chat_id: "TEXT", index_in_chat: "INTEGER", is_user: "INTEGER", name: "TEXT", content: "TEXT", send_date: "INTEGER", swipe_id: "INTEGER", swipes: "TEXT", swipe_dates: "TEXT", extra: "TEXT", revision: "INTEGER" },
  world_books: { id: "TEXT", user_id: "TEXT", name: "TEXT", description: "TEXT", metadata: "TEXT", created_at: "INTEGER", updated_at: "INTEGER" },
  world_book_entries: {
    id: "TEXT",
    world_book_id: "TEXT",
    uid: "TEXT",
    key: "TEXT",
    keysecondary: "TEXT",
    content: "TEXT",
    comment: "TEXT",
    position: "INTEGER",
    depth: "INTEGER",
    role: "TEXT",
    order_value: "INTEGER",
    constant: "INTEGER",
    disabled: "INTEGER",
    selective: "INTEGER",
    vectorized: "INTEGER",
    sticky: "INTEGER",
    extensions: "TEXT",
    revision: "INTEGER",
    updated_at: "INTEGER",
  },
  characters: {
    id: "TEXT",
    user_id: "TEXT",
    name: "TEXT",
    description: "TEXT",
    personality: "TEXT",
    scenario: "TEXT",
    first_mes: "TEXT",
    mes_example: "TEXT",
    system_prompt: "TEXT",
    post_history_instructions: "TEXT",
    tags: "TEXT",
    alternate_greetings: "TEXT",
    extensions: "TEXT",
    updated_at: "INTEGER",
  },
  personas: { id: "TEXT", user_id: "TEXT", name: "TEXT", title: "TEXT", description: "TEXT", metadata: "TEXT", attached_world_book_id: "TEXT", is_default: "INTEGER", is_narrator: "INTEGER", updated_at: "INTEGER" },
  presets: { id: "TEXT", user_id: "TEXT", name: "TEXT", provider: "TEXT", engine: "TEXT", parameters: "TEXT", prompt_order: "TEXT", prompts: "TEXT", metadata: "TEXT", cache_revision: "INTEGER", updated_at: "INTEGER" },
  settings: { key: "TEXT", value: "TEXT", updated_at: "INTEGER", user_id: "TEXT" },
  message_breakdowns: { message_id: "TEXT", chat_id: "TEXT", data: "TEXT", user_id: "TEXT" },
};

const TABLES = Object.keys(READ_COLUMNS);
const COLUMNS = `WITH t(name) AS (VALUES ${TABLES.map(() => "(?)").join(", ")}) SELECT t.name AS tbl, c.name AS col, c.type AS type FROM t LEFT JOIN pragma_table_info(t.name) AS c`;
const SCHEMA = "SELECT schema_version AS schema FROM pragma_schema_version";

/** How the file differs from what the reader reads, in one sentence; null when every column read is there as declared. */
export function schemaDifference(db: Database): string | null {
  const found = new Map<string, Map<string, string>>(TABLES.map((t) => [t, new Map()]));
  for (const row of db.query<{ tbl: string; col: string | null; type: string | null }, string[]>(COLUMNS).all(...TABLES)) {
    if (row.col !== null) found.get(row.tbl)?.set(row.col, (row.type ?? "").trim().toUpperCase());
  }
  const differences: string[] = [];
  for (const [table, columns] of Object.entries(READ_COLUMNS)) {
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

// The statements. A chat's messages in Lumiverse's order: by place, then as they were stored.
// A message's marks (hidden, a system message an extension added) read in SQL, as `messageFrom` in `rows.ts` reads them after
// Lumiverse's mapper: none where `extra` is not JSON. Its `extra` itself is never read into RPE: an old engine's reply can carry
// everything it recorded there.
const HIDDEN = "CASE WHEN json_valid(m.extra) THEN coalesce(json_type(m.extra, '$.hidden') = 'true', 0) ELSE 0 END AS hidden";
const SYSTEM = "CASE WHEN json_valid(m.extra) THEN coalesce(json_extract(m.extra, '$.spindle_role') = 'system', 0) ELSE 0 END AS system";
const MESSAGE = `m.id, m.chat_id, m.index_in_chat, m.is_user, m.name, m.content, m.send_date, m.swipe_id, m.swipes, m.swipe_dates, m.revision, ${HIDDEN}, ${SYSTEM}`;
const OF_CHAT = "FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.chat_id = ? AND c.user_id = ?";
const ORDER = "ORDER BY m.index_in_chat, m.rowid";
// A step's swipe count, marks and showing swipe read in SQL, so listing a long chat reads one text per
// message and not every swipe of it. As `messageFrom` in `rows.ts`, after Lumiverse's mapper: one swipe
// where `swipes` is not a JSON list, no dates where `swipe_dates` is not (`chats.service.ts:589-592`), and
// `content` where the list has no text at the showing swipe.
const STEP = `m.id, m.chat_id, m.index_in_chat, m.is_user, m.swipe_id, m.revision,
  CASE WHEN json_valid(m.swipes) AND json_type(m.swipes) = 'array' THEN json_array_length(m.swipes) ELSE 1 END AS swipe_count,
  ${HIDDEN},
  ${SYSTEM},
  CASE WHEN m.swipe_id < 0 OR NOT json_valid(m.swipes) THEN m.content
    WHEN json_type(m.swipes, '$[' || m.swipe_id || ']') = 'text' THEN json_extract(m.swipes, '$[' || m.swipe_id || ']')
    ELSE m.content END AS shown_text,
  CASE WHEN m.swipe_id < 0 OR NOT json_valid(m.swipe_dates) THEN NULL
    WHEN json_type(m.swipe_dates, '$[' || m.swipe_id || ']') IN ('integer', 'real') THEN json_extract(m.swipe_dates, '$[' || m.swipe_id || ']')
    END AS shown_date`;
const ENTRY = "e.id, e.world_book_id, e.uid, e.key, e.keysecondary, e.content, e.comment, e.position, e.depth, e.role, e.order_value, e.constant, e.disabled, e.selective, e.vectorized, e.sticky, e.extensions, e.revision, e.updated_at";
const CHARACTER = "id, name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, tags, alternate_greetings, extensions, updated_at";
const Q = {
  chat: "SELECT id, user_id, character_id, name, metadata, updated_at FROM chats WHERE id = ? AND user_id = ?",
  chats: "SELECT id, user_id, character_id, name, metadata, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC, rowid",
  path: `SELECT ${STEP} ${OF_CHAT} ${ORDER}`,
  // What says a message's step stands as last read, without the texts a step is read from: its showing swipe's own text (`content`,
  // which Lumiverse writes with every change of the swipe shown), the bytes of its swipes, dates and `extra`, whose JSON is not read, and
  // its hidden value, read from `extra` only where `"hidden"` stands in it. A hide writes `extra` alone, moving no revision, and writes it
  // again as JSON.stringify writes it: from an `extra` another tool wrote with spaces or escapes, that can keep its length exactly.
  pathMarks: `SELECT m.id, m.index_in_chat, m.is_user, m.swipe_id, m.revision, m.content, octet_length(m.swipes) AS swipes_bytes, octet_length(m.swipe_dates) AS dates_bytes, octet_length(m.extra) AS extra_bytes,
    CASE WHEN instr(m.extra, '"hidden"') > 0 AND json_valid(m.extra) THEN json_type(m.extra, '$.hidden') END AS hidden_type ${OF_CHAT} ${ORDER}`,
  pathOf: `SELECT ${STEP} ${OF_CHAT} AND m.id IN (SELECT value FROM json_each(?)) ${ORDER}`,
  messages: `SELECT ${MESSAGE} ${OF_CHAT} ${ORDER} LIMIT ? OFFSET ?`,
  messagesById: `SELECT ${MESSAGE} ${OF_CHAT} AND m.id IN (SELECT value FROM json_each(?)) ${ORDER}`,
  book: "SELECT id, name, description, metadata, created_at, updated_at FROM world_books WHERE id = ? AND user_id = ?",
  books: "SELECT id, name, description, metadata, created_at, updated_at FROM world_books WHERE user_id = ? ORDER BY created_at, rowid",
  entries: `SELECT ${ENTRY} FROM world_book_entries e JOIN world_books w ON w.id = e.world_book_id WHERE e.world_book_id = ? AND w.user_id = ? ORDER BY e.order_value, e.rowid`,
  entry: `SELECT ${ENTRY} FROM world_book_entries e JOIN world_books w ON w.id = e.world_book_id WHERE e.id = ? AND w.user_id = ?`,
  character: `SELECT ${CHARACTER} FROM characters WHERE id = ? AND user_id = ?`,
  characters: `SELECT ${CHARACTER} FROM characters WHERE user_id = ? ORDER BY rowid`,
  persona: "SELECT id, name, title, description, metadata, attached_world_book_id, is_default, is_narrator, updated_at FROM personas WHERE id = ? AND user_id = ?",
  // Lumiverse's own query for it (`services/personas.service.ts:184`).
  defaultPersona: "SELECT id, name, title, description, metadata, attached_world_book_id, is_default, is_narrator, updated_at FROM personas WHERE is_default = 1 AND user_id = ? LIMIT 1",
  preset: "SELECT id, name, provider, engine, parameters, prompt_order, prompts, metadata, cache_revision, updated_at FROM presets WHERE id = ? AND user_id = ?",
  setting: "SELECT key, value, updated_at FROM settings WHERE key = ? AND user_id = ?",
  // The breakdown of the chat's latest reply that has one: a swipe replaces its message's breakdown in place (`breakdown.service.ts:3-11`).
  // That message is found first, so the one breakdown is read: each holds its prompt's whole history.
  breakdown:
    "SELECT b.data FROM message_breakdowns b WHERE b.user_id = ? AND b.message_id = (SELECT n.message_id FROM message_breakdowns n JOIN messages m ON m.id = n.message_id WHERE n.chat_id = ? AND n.user_id = ? ORDER BY m.index_in_chat DESC, m.rowid DESC LIMIT 1)",
  // What says a book's entries are as they were read: Lumiverse's own signature of them (`world-books.service.ts:1083-1094`, which it makes its entity tags from) and the book's own `updated_at`; they move with any entry added, edited, reordered or removed.
  bookStamp: "SELECT w.updated_at AS book, COUNT(e.id) AS count, COALESCE(MAX(e.updated_at), 0) AS latest, COALESCE(SUM(e.revision), 0) AS revisions FROM world_books w LEFT JOIN world_book_entries e ON e.world_book_id = w.id WHERE w.id = ? AND w.user_id = ?",
  presetStamp: "SELECT updated_at, cache_revision FROM presets WHERE id = ? AND user_id = ?",
  // Changes whenever another connection commits to the file, and for nothing else: a chat's rows read at one version are the chat's rows until it moves.
  version: "PRAGMA data_version",
} as const;

/** How many times a statement is tried while Lumiverse holds the file locked, and the wait before the second try, doubled after. */
export const TRIES = 4;
export const RETRY_MS = 25;
/** The default of `lumiverse.database.slowSeconds`, in milliseconds: a read that held RPE this long is told in its log. */
export const SLOW_MS = 1_000;

export interface DbReaderDeps {
  /** Lumiverse's database file: `lumiverse.db` in its data folder (`db/connection.ts:38`, `env.ts:157`). */
  path: string;
  /** The Lumiverse user RPE belongs to: the only one whose rows are read. */
  user: string;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  /** Its tries, first wait and slow read, read at each statement (the door's settings); `TRIES`, `RETRY_MS` and `SLOW_MS` when not given. */
  settings?: () => { tries: number; retryMs: number; slowMs: number; kept: number };
}

export interface DbState {
  path: string;
  /** Why the reader does not read the file now, in one sentence; null while it does. */
  off: string | null;
  /** The schema version the columns were last checked at, and when (ms). */
  checked: { schema: number; at: number } | null;
}

export interface DbReader extends LumiverseReads {
  state(): DbState;
  close(): void;
}

/** How SQLite's file starts. */
const MAGIC = new TextEncoder().encode("SQLite format 3\0");

const code = (error: unknown): string => (error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "");
const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Why the file cannot be opened for reading as it stands; null when it can. */
function troubleWith(path: string): string | null {
  let file: Stats;
  try {
    file = statSync(path);
  } catch (error) {
    return code(error) === "ENOENT" ? `there is no file at ${path}` : `${path} cannot be looked at (${code(error) || words(error)})`;
  }
  if (!file.isFile()) return `${path} is not a file`;
  const head = new Uint8Array(100);
  let read = 0;
  try {
    const fd = openSync(path, "r");
    try {
      read = readSync(fd, head, 0, head.length, 0);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    return `${path} cannot be read (${code(error) || words(error)})`;
  }
  if (read < 100 || MAGIC.some((byte, i) => head[i] !== byte)) return `${path} is not a SQLite database`;
  // A file in write-ahead-log mode is read through the `-wal` and `-shm` beside it, which Lumiverse makes when it opens the file; a read-only reader cannot make them.
  if (head[18] === 2 || head[19] === 2) {
    for (const side of ["-wal", "-shm"]) {
      try {
        statSync(path + side);
      } catch {
        return `${path}${side} is not beside it, as when Lumiverse is not running`;
      }
    }
  }
  return null;
}

interface Open {
  db: Database;
  dev: number;
  ino: number;
  /** The schema version its columns were checked at; null before. */
  schema: number | null;
  /** The schema version a difference was found at: the file is refused until its schema moves. */
  refusedAt: number | null;
}

export function createDbReader(deps: DbReaderDeps): DbReader {
  let open: Open | null = null;
  let off: string | null = null;
  let checked: DbState["checked"] = null;
  let closed = false;

  const release = (): void => {
    open?.db.close();
    open = null;
    // A file opened again counts its versions from the start: nothing read before it is known to be as the file stands.
    memo.clear();
    stepsKept.clear();
  };

  const refuse = (why: string): SourceOff => {
    const sentence = `RPE does not read Lumiverse's database: ${why}.`;
    if (off !== sentence) deps.log(sentence);
    off = sentence;
    return new SourceOff(sentence);
  };

  /** The file open and its columns checked at its schema now. */
  function file(): Open {
    if (closed) throw new SourceOff("RPE's reader of Lumiverse's database was closed.");
    let now: Stats;
    try {
      now = statSync(deps.path);
    } catch {
      release();
      throw refuse(`there is no file at ${deps.path}`);
    }
    if (open !== null && (open.dev !== now.dev || open.ino !== now.ino)) release();
    if (open === null) {
      const trouble = troubleWith(deps.path);
      if (trouble !== null) throw refuse(trouble);
      open = { db: new Database(deps.path, { readonly: true }), dev: now.dev, ino: now.ino, schema: null, refusedAt: null };
    }
    const at = open;
    const schema = at.db.query<{ schema: number }, []>(SCHEMA).get()?.schema ?? -1;
    if (at.refusedAt === schema) throw new SourceOff(off ?? "RPE does not read Lumiverse's database.");
    if (at.schema !== schema) {
      const difference = schemaDifference(at.db);
      checked = { schema, at: Date.now() };
      if (difference !== null) {
        at.refusedAt = schema;
        throw refuse(`it was made by a Lumiverse RPE does not know: ${difference}`);
      }
      at.schema = schema;
      at.refusedAt = null;
    }
    off = null;
    return at;
  }

  /**
   * One statement, tried again after a short wait while another connection holds the file locked. A statement holds RPE's one thread
   * while it runs: one that takes `slowMs` or more is told in the log, in one line, with how long it took.
   */
  async function step<T>(what: string, run: (db: Database) => T): Promise<T> {
    const { tries, retryMs, slowMs } = deps.settings?.() ?? { tries: TRIES, retryMs: RETRY_MS, slowMs: SLOW_MS };
    for (let tried = 1; ; tried++) {
      try {
        const began = performance.now();
        const out = run(file().db);
        const took = performance.now() - began;
        if (took >= slowMs) deps.log(`Reading ${what} from Lumiverse's database held RPE for ${Math.round(took)} ms.`);
        return out;
      } catch (error) {
        if (error instanceof SourceOff || error instanceof Unreadable) throw error;
        const c = code(error);
        if (/^SQLITE_(BUSY|LOCKED|SCHEMA)/.test(c) && tried < tries) {
          await deps.sleep(retryMs * 2 ** (tried - 1));
          continue;
        }
        if (/^SQLITE_(CANTOPEN|IOERR|PERM|READONLY|AUTH|CORRUPT|NOTADB)/.test(c)) {
          // The file may have been put back or its side files taken away under the connection.
          release();
          throw refuse(`it could not be read just now (${c})`);
        }
        throw new Error(`RPE could not read ${what} from Lumiverse's database (SQLite says: ${words(error)}).`);
      }
    }
  }

  const row = (r: unknown): Record<string, unknown> => r as Record<string, unknown>;
  const user = deps.user;

  /** A row Lumiverse's own mapper refuses fails the read, in words that say so. */
  function mapped<T>(what: string, map: () => T): T {
    try {
      return map();
    } catch (error) {
      if (error instanceof Unreadable) throw new Error(`Lumiverse itself cannot read ${what} (${error.message}), so RPE does not read it either.`);
      throw error;
    }
  }

  const memo = new Memo({ most: () => deps.settings?.().kept ?? KEPT, now: () => Date.now() });
  /** Where Lumiverse's file stands: it moves whenever another connection commits, and for nothing else. */
  const version = (): Promise<string> => step("the file's version", (db) => String(row(db.query(Q.version).get()).data_version));
  /** What is read of a chat, held while the file stands as it did at the read. */
  const ofChat = async <T>(chat: string, part: string, fill: () => Promise<T>): Promise<T> => memo.get(KEEP.chat(chat), await version(), Infinity, part, fill);
  /**
   * Each chat's steps as last read, by message id, with what says each still stands (`Q.pathMarks`): a message that moved only its place
   * keeps its step; any other is read again. The chats read most recently are kept, as many as the memo keeps.
   */
  const stepsKept = new Map<string, Map<string, { key: string; step: LvStep }>>();
  const stepOf = (s: Record<string, unknown>): LvStep => ({
    id: String(s.id),
    chat: String(s.chat_id),
    index: Number(s.index_in_chat),
    role: s.is_user ? "user" : s.system ? "system" : "assistant",
    swipe: Number(s.swipe_id),
    swipes: Number(s.swipe_count),
    hidden: s.hidden === 1,
    revision: Number(s.revision),
    shown: { hash: textHash(String(s.shown_text)), date: typeof s.shown_date === "number" ? s.shown_date : null },
  });

  const reader: DbReader = {
    kind: "database",
    async chat(chat) {
      const r = await step(`chat ${chat}`, (db) => db.query(Q.chat).get(chat, user));
      return r === null ? null : mapped(`chat ${chat}`, () => chatFrom(row(r)));
    },
    async chats() {
      const rows = await step("your chats", (db) => db.query(Q.chats).all(user));
      return rows.map((r) => mapped("a chat", () => chatFrom(row(r))));
    },
    async path(chat) {
      const steps = await ofChat(chat, "path", () =>
        step(`chat ${chat}'s messages`, (db) => {
          // One read transaction: the chat and its messages as one moment of the file.
          return db.transaction(() => {
            if (db.query(Q.chat).get(chat, user) === null) return null;
            // Every message's marks, then the steps of those whose marks moved since the last read (all of them at a chat's first).
            const had = stepsKept.get(chat);
            const marks = db.query(Q.pathMarks).all(chat, user).map(row);
            const keys = marks.map((m) => [m.is_user, m.swipe_id, m.revision, m.swipes_bytes, m.dates_bytes, m.extra_bytes, m.hidden_type, Bun.hash(String(m.content))].join("\u0000"));
            const moved = had === undefined ? null : marks.flatMap((m, i) => (had.get(String(m.id))?.key === keys[i] ? [] : [String(m.id)]));
            const fresh = moved === null ? db.query(Q.path).all(chat, user) : moved.length === 0 ? [] : db.query(Q.pathOf).all(chat, user, JSON.stringify(moved));
            const read = new Map(fresh.map((r) => [String(row(r).id), stepOf(row(r))]));
            const now = new Map<string, { key: string; step: LvStep }>();
            const out = marks.flatMap((m, i): LvStep[] => {
              const id = String(m.id);
              const kept = had?.get(id)?.step;
              const s = read.get(id) ?? (kept === undefined ? undefined : { ...kept, index: Number(m.index_in_chat) });
              if (s === undefined) return [];
              now.set(id, { key: keys[i] as string, step: s });
              return [s];
            });
            stepsKept.delete(chat);
            stepsKept.set(chat, now);
            for (const oldest of stepsKept.keys()) {
              if (stepsKept.size <= Math.max(1, deps.settings?.().kept ?? KEPT)) break;
              stepsKept.delete(oldest);
            }
            return out;
          })();
        }),
      );
      return steps === null ? null : [...steps];
    },
    async messages(chat, places: Places) {
      const from = Math.max(0, Math.floor(places.from));
      const count = Math.max(0, Math.floor(places.to) - from);
      if (count === 0) return [];
      const read = await ofChat(chat, `messages ${from} ${count}`, async () => {
        const rows = await step(`chat ${chat}'s messages`, (db) => db.query(Q.messages).all(chat, user, count, from));
        return rows.map((r): LvMessage => mapped(`a message of chat ${chat}`, () => messageFrom(row(r))));
      });
      return [...read];
    },
    async messagesById(chat, ids) {
      if (ids.length === 0) return [];
      const read = await ofChat(chat, `by id ${JSON.stringify(ids)}`, async () => {
        const rows = await step(`chat ${chat}'s messages`, (db) => db.query(Q.messagesById).all(chat, user, JSON.stringify(ids)));
        return rows.map((r) => mapped(`a message of chat ${chat}`, () => messageFrom(row(r))));
      });
      return [...read];
    },
    async book(book) {
      const r = await step(`world book ${book}`, (db) => db.query(Q.book).get(book, user));
      return r === null ? null : mapped(`world book ${book}`, () => bookFrom(row(r)));
    },
    async books() {
      const rows = await step("your world books", (db) => db.query(Q.books).all(user));
      return rows.map((r) => mapped("a world book", () => bookFrom(row(r))));
    },
    async entries(book) {
      // Held while Lumiverse's own signature of the book's entries and the book's `updated_at` are what they were at the read.
      const stamp = await step(`world book ${book}'s entries`, (db) => {
        const s = row(db.query(Q.bookStamp).get(book, user));
        return s.book === null ? "none" : `${String(s.book)}.${String(s.count)}.${String(s.latest)}.${String(s.revisions)}`;
      });
      const read = await memo.get(KEEP.book(book), stamp, Infinity, "entries", async () => {
        const rows = await step(`world book ${book}'s entries`, (db) => db.query(Q.entries).all(book, user));
        return rows.map((r) => mapped(`an entry of world book ${book}`, () => entryFrom(row(r))));
      });
      return [...read];
    },
    async entry(entry) {
      const r = await step(`entry ${entry}`, (db) => db.query(Q.entry).get(entry, user));
      return r === null ? null : mapped(`entry ${entry}`, () => entryFrom(row(r)));
    },
    async character(character) {
      const r = await step(`character ${character}`, (db) => db.query(Q.character).get(character, user));
      return r === null ? null : mapped(`character ${character}`, () => characterFrom(row(r)));
    },
    async characters() {
      const rows = await step("your characters", (db) => db.query(Q.characters).all(user));
      return rows.map((r) => mapped("a character", () => characterFrom(row(r))));
    },
    async persona(persona) {
      const r = await step(`persona ${persona}`, (db) => db.query(Q.persona).get(persona, user));
      return r === null ? null : mapped(`persona ${persona}`, () => personaFrom(row(r)));
    },
    async defaultPersona() {
      const r = await step("the default persona", (db) => db.query(Q.defaultPersona).get(user));
      return r === null ? null : mapped("the default persona", () => personaFrom(row(r)));
    },
    async preset(preset) {
      // Held while the preset's `updated_at` and `cache_revision` are what they were at the read.
      const stamp = await step(`preset ${preset}`, (db) => {
        const s = db.query(Q.presetStamp).get(preset, user);
        return s === null ? "none" : `${String(row(s).updated_at)}.${String(row(s).cache_revision)}`;
      });
      return memo.get(KEEP.preset(preset), stamp, Infinity, "row", async () => {
        const r = await step(`preset ${preset}`, (db) => db.query(Q.preset).get(preset, user));
        return r === null ? null : mapped(`preset ${preset}`, () => presetFrom(row(r)));
      });
    },
    async setting(key) {
      const r = await step(`setting ${key}`, (db) => db.query(Q.setting).get(key, user));
      return r === null ? null : mapped(`setting ${key}`, () => settingFrom(row(r)));
    },
    async breakdown(chat) {
      const r = await step(`chat ${chat}'s breakdown`, (db) => db.query(Q.breakdown).get(user, chat, user));
      if (r === null) return null;
      // `getBreakdown` (`breakdown.service.ts:14-23`): data that is not JSON is no breakdown.
      try {
        return JSON.parse(String(row(r).data)) as JsonValue;
      } catch {
        return null;
      }
    },
    dropChat: (chat) => {
      memo.drop(KEEP.chat(chat));
      stepsKept.delete(chat);
    },
    // The file says itself when its rows change (its version, a book's signature, a preset's stamp): no event is needed.
    heard: () => undefined,
    state: () => ({ path: deps.path, off, checked }),
    close() {
      closed = true;
      memo.clear();
      release();
    },
  };
  return reader;
}
