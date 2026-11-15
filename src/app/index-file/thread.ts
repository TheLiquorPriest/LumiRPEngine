// The index file's SQL, run on worker threads only (plan §4.2 "No copy", Appendix B): its writer, the one
// thread that writes the file, and its search, which the pool's threads run over a connection of their own
// that reads alone. Five contentless full-text indexes (`INDEXES`) hold tokens and ids, never text: each is
// a full-text table holding the user beside the tokens of each text (its text itself is never kept), and a
// key table giving each row's user, id, revision and scope (the chat or the book it is searched within).
// An area's own table (`TableDef`) is keyed the same way and holds numbers and bytes alone.

import { Database } from "bun:sqlite";
import { chmodSync, existsSync } from "node:fs";
import { OWNER_ONLY_FILE } from "../disk";

/** The index file's five indexes: chat messages, lore entries, facts, beats, memories. */
export const INDEXES = ["messages", "entries", "facts", "beats", "memories"] as const;
export type IndexName = (typeof INDEXES)[number];

/** A text to index: its id, its revision, its scope (the chat or the book it belongs to) and its text, which the index tokenizes and does not keep. */
export interface IndexDoc {
  id: string;
  revision: string;
  scope: string;
  text: string;
}

/** A search's hit: the id, the revision indexed, its scope, and its rank (lower is better). */
export interface IndexHit {
  id: string;
  revision: string;
  scope: string;
  rank: number;
}

/** The kinds of value an area's own table holds: numbers and bytes, never text. */
export type ColumnKind = "integer" | "real" | "blob";
export type ColumnValue = number | Uint8Array | null;

/** An area's own table in the index file: its name and its columns beside the user, id, revision and scope every row carries. */
export interface TableDef {
  name: string;
  columns: Readonly<Record<string, ColumnKind>>;
}

/** A row of an area's own table. */
export interface TableRow {
  id: string;
  revision: string;
  scope: string;
  values: Record<string, ColumnValue>;
}

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const KEY_COLUMNS = ["user", "id", "revision", "scope"];

/** The writer's connections, by file: open on the writer's thread alone. */
const writers = new Map<string, Database>();
/** Connections that read alone, by file: one for each thread that searched it. */
const readers = new Map<string, Database>();

function writerOf(path: string): Database {
  const db = writers.get(path);
  if (db === undefined) throw new Error(`The index file ${path} is not open for writing on this thread.`);
  return db;
}

function readerOf(path: string): Database {
  let db = readers.get(path);
  if (db === undefined) {
    db = new Database(path, { readonly: true, strict: true });
    readers.set(path, db);
  }
  return db;
}

function indexOf(index: string): IndexName {
  if (!(INDEXES as readonly string[]).includes(index)) throw new Error(`The index file has no index ${index}; it has ${INDEXES.join(", ")}.`);
  return index as IndexName;
}

function makeIndex(db: Database, name: IndexName): void {
  db.run(`CREATE TABLE IF NOT EXISTS "${name}_key" (row INTEGER PRIMARY KEY, user TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, scope TEXT NOT NULL, UNIQUE (user, id))`);
  db.run(`CREATE INDEX IF NOT EXISTS "${name}_scope" ON "${name}_key" (user, scope)`);
  // Contentless: the text's tokens are indexed and the text is kept nowhere; the user is kept beside them.
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS "${name}" USING fts5(user UNINDEXED, text, content='', contentless_delete=1, contentless_unindexed=1, tokenize='unicode61 remove_diacritics 2')`);
}

/** Runs `each` over `items` in transactions of `batch` at most. */
function inBatches<T>(db: Database, items: readonly T[], batch: number, each: (item: T) => void): void {
  const write = db.transaction((part: readonly T[]) => {
    for (const item of part) each(item);
  });
  for (let at = 0; at < items.length; at += batch) write(items.slice(at, at + batch));
}

/** A query a person typed as one the full-text index takes: each word quoted, all of them asked for. */
function matchOf(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}]+/gu);
  return words === null ? null : words.map((word) => `"${word}"`).join(" ");
}

function tableName(name: string): string {
  if (!NAME.test(name)) throw new Error(`An index table's name is lower-case letters, digits and _, starting with a letter: not ${JSON.stringify(name)}.`);
  if (INDEXES.some((index) => name === index || name.startsWith(`${index}_`))) throw new Error(`The table ${name} would sit among the index file's own.`);
  return name;
}

function columnsOf(def: TableDef): [string, ColumnKind][] {
  const columns = Object.entries(def.columns);
  for (const [column, kind] of columns) {
    if (!NAME.test(column) || KEY_COLUMNS.includes(column)) throw new Error(`The table ${def.name} cannot have a column ${JSON.stringify(column)}.`);
    if (kind !== "integer" && kind !== "real" && kind !== "blob") throw new Error(`The table ${def.name}'s column ${column} holds numbers or bytes, not ${String(kind)}.`);
  }
  return columns;
}

/** The tasks of the index file, run on worker threads (`../workers/tasks.ts`). */
export const INDEX_TASKS = {
  /** On the writer's thread: opens the file, making it and its five indexes where they are missing; `made` when the file was not there. */
  indexOpen(input: { path: string }): { made: boolean } {
    const made = !existsSync(input.path);
    const db = new Database(input.path, { create: true, strict: true });
    chmodSync(input.path, OWNER_ONLY_FILE);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    for (const name of INDEXES) makeIndex(db, name);
    writers.set(input.path, db);
    return { made };
  },

  /** On the writer's thread: closes the file. */
  indexClose(input: { path: string }): void {
    writers.get(input.path)?.close();
    writers.delete(input.path);
  },

  /** On the writer's thread: indexes each text; a new revision replaces the one before, the same revision is left as it is. */
  indexPut(input: { path: string; index: IndexName; user: string; docs: readonly IndexDoc[]; batch: number }): { written: number } {
    const db = writerOf(input.path);
    const name = indexOf(input.index);
    const find = db.query<{ row: number; revision: string; scope: string }, [string, string]>(`SELECT row, revision, scope FROM "${name}_key" WHERE user = ? AND id = ?`);
    const forget = db.query(`DELETE FROM "${name}" WHERE rowid = ?`);
    const rekey = db.query(`UPDATE "${name}_key" SET revision = ?, scope = ? WHERE row = ?`);
    const key = db.query<{ row: number }, [string, string, string, string]>(`INSERT INTO "${name}_key" (user, id, revision, scope) VALUES (?, ?, ?, ?) RETURNING row`);
    const tokens = db.query(`INSERT INTO "${name}" (rowid, user, text) VALUES (?, ?, ?)`);
    let written = 0;
    inBatches(db, input.docs, input.batch, (doc) => {
      const had = find.get(input.user, doc.id);
      if (had !== null && had.revision === doc.revision && had.scope === doc.scope) return;
      let row: number;
      if (had === null) {
        const made = key.get(input.user, doc.id, doc.revision, doc.scope);
        if (made === null) throw new Error(`The index ${name} gave no row for ${doc.id}.`);
        row = made.row;
      } else {
        row = had.row;
        forget.run(row);
        rekey.run(doc.revision, doc.scope, row);
      }
      tokens.run(row, input.user, doc.text);
      written += 1;
    });
    return { written };
  },

  /** On the writer's thread: drops each id from the index; one not there is passed over. */
  indexDrop(input: { path: string; index: IndexName; user: string; ids: readonly string[]; batch: number }): { dropped: number } {
    const db = writerOf(input.path);
    const name = indexOf(input.index);
    const find = db.query<{ row: number }, [string, string]>(`SELECT row FROM "${name}_key" WHERE user = ? AND id = ?`);
    const forget = db.query(`DELETE FROM "${name}" WHERE rowid = ?`);
    const unkey = db.query(`DELETE FROM "${name}_key" WHERE row = ?`);
    let dropped = 0;
    inBatches(db, input.ids, input.batch, (id) => {
      const had = find.get(input.user, id);
      if (had === null) return;
      forget.run(had.row);
      unkey.run(had.row);
      dropped += 1;
    });
    return { dropped };
  },

  /** On any thread: the ids of the texts that hold every word of `query`, the user's alone, within `scope` when one is named, best first. */
  indexSearch(input: { path: string; index: IndexName; user: string; query: string; scope: string | null; limit: number }): IndexHit[] {
    const name = indexOf(input.index);
    const match = matchOf(input.query);
    if (match === null) return [];
    const scoped = input.scope === null ? "" : " AND k.scope = $scope";
    const sql = `SELECT k.id AS id, k.revision AS revision, k.scope AS scope, f.rank AS rank FROM "${name}" f JOIN "${name}_key" k ON k.row = f.rowid WHERE f."${name}" MATCH $match AND k.user = $user${scoped} ORDER BY f.rank LIMIT $limit`;
    const params: Record<string, string | number> = { match, user: input.user, limit: input.limit };
    if (input.scope !== null) params.scope = input.scope;
    return readerOf(input.path).query<IndexHit, Record<string, string | number>>(sql).all(params);
  },

  /** On the writer's thread: makes an area's own table, or makes it again, empty, where it stands with other columns; `made` when it was made. */
  indexTable(input: { path: string; table: TableDef }): { made: boolean } {
    const db = writerOf(input.path);
    const name = tableName(input.table.name);
    const columns = columnsOf(input.table).map(([column, kind]) => `, ${column} ${kind.toUpperCase()}`);
    const sql = `CREATE TABLE "${name}" (user TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, scope TEXT NOT NULL${columns.join("")}, PRIMARY KEY (user, id)) WITHOUT ROWID`;
    const had = db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    if (had?.sql === sql) return { made: false };
    db.transaction(() => {
      if (had !== null) db.run(`DROP TABLE "${name}"`);
      db.run(sql);
      db.run(`CREATE INDEX "${name}_scope" ON "${name}" (user, scope)`);
    })();
    return { made: true };
  },

  /** On the writer's thread: writes rows of an area's own table, each replacing the row of its id. */
  indexPutRows(input: { path: string; table: TableDef; user: string; rows: readonly TableRow[]; batch: number }): { written: number } {
    const db = writerOf(input.path);
    const name = tableName(input.table.name);
    const columns = columnsOf(input.table).map(([column]) => column);
    const put = db.query(`INSERT OR REPLACE INTO "${name}" (user, id, revision, scope${columns.map((c) => `, ${c}`).join("")}) VALUES (?, ?, ?, ?${columns.map(() => ", ?").join("")})`);
    inBatches(db, input.rows, input.batch, (row) => {
      const values = columns.map((column) => {
        const value = row.values[column] ?? null;
        if (typeof value === "string") throw new Error(`The table ${name} holds no text, and its column ${column} was given some.`);
        return value;
      });
      put.run(input.user, row.id, row.revision, row.scope, ...values);
    });
    return { written: input.rows.length };
  },

  /** On the writer's thread: drops rows of an area's own table by id. */
  indexDropRows(input: { path: string; table: TableDef; user: string; ids: readonly string[]; batch: number }): { dropped: number } {
    const db = writerOf(input.path);
    const name = tableName(input.table.name);
    const drop = db.query(`DELETE FROM "${name}" WHERE user = ? AND id = ?`);
    let dropped = 0;
    inBatches(db, input.ids, input.batch, (id) => {
      dropped += drop.run(input.user, id).changes;
    });
    return { dropped };
  },

  /** On any thread: the user's rows of an area's own table, within `scope` when one is named. */
  indexRows(input: { path: string; table: TableDef; user: string; scope: string | null }): TableRow[] {
    const name = tableName(input.table.name);
    const columns = columnsOf(input.table).map(([column]) => column);
    const scoped = input.scope === null ? "" : " AND scope = ?";
    const params = input.scope === null ? [input.user] : [input.user, input.scope];
    const rows = readerOf(input.path)
      .query<Record<string, string | ColumnValue>, string[]>(`SELECT * FROM "${name}" WHERE user = ?${scoped}`)
      .all(...params);
    return rows.map((row) => ({ id: row.id as string, revision: row.revision as string, scope: row.scope as string, values: Object.fromEntries(columns.map((c) => [c, row[c] as ColumnValue])) }));
  },
};
