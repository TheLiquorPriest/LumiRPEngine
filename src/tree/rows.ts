// What RPE's database takes, chat by chat (plan §5.5, §14 Storage; Appendix B): for each table that carries
// the chat, found by its columns here and nowhere else, the bytes the table (and its indexes) take, shared
// among the chats by the size of each chat's rows. A table names its chat by a `chat` column, by the `turn`
// it belongs to, or by the `node` of a path (a snapshot); one that names none is the installation's own.
// The shares and the rest (the installation's own tables and what no chat owns) add up to the database's
// size. The same finding of a chat's rows is what the database's prunes work from (`rows` below).

import type { Database } from "bun:sqlite";

/** How a table says which chat a row belongs to, as a SQL expression and the joins it needs; null for a table that does not say. */
interface Owner {
  chat: string;
  joins: string;
}

/** The tables of the database, by name, with the names of their columns. */
function tablesOf(db: Database): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { name } of db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    out.set(name, db.query<{ name: string }, []>(`PRAGMA table_info("${name}")`).all().map((c) => c.name));
  }
  return out;
}

/** How each table that carries the chat says which one, found from its columns. */
export function ownersOf(db: Database): Map<string, Owner> {
  const tables = tablesOf(db);
  const has = (name: string, column: string): boolean => tables.get(name)?.includes(column) === true;
  const turnJoin = (on: string): string => `LEFT JOIN "turn" tt ON tt.user = t."user" AND tt."id" = ${on}`;
  const out = new Map<string, Owner>();
  for (const [name, columns] of tables) {
    if (!columns.includes("user")) continue;
    if (columns.includes("chat")) out.set(name, { chat: `t."chat"`, joins: "" });
    else if (columns.includes("turn") && has("turn", "chat")) out.set(name, { chat: "tt.\"chat\"", joins: turnJoin(`t."turn"`) });
    else if (columns.includes("node") && has("path_node", "key") && has("turn", "chat")) out.set(name, { chat: "tt.\"chat\"", joins: `LEFT JOIN "path_node" pn ON pn."user" = t."user" AND pn."key" = t."node" ${turnJoin('pn."turn"')}` });
    else if (name === "chat" && columns.includes("id")) out.set(name, { chat: `t."id"`, joins: "" });
  }
  return out;
}

/** The bytes a table and its indexes take, by the database's own page count. */
function pagesOf(db: Database): Map<string, number> {
  try {
    return new Map(db.query<{ name: string; bytes: number }, []>("SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name").all().map((r) => [r.name, r.bytes]));
  } catch {
    // A build of SQLite without the page statistics: each table is measured by the size of its rows alone.
    return new Map();
  }
}

export interface RowShares {
  /** What each chat's rows take of the database, by chat. */
  chats: Map<string, number>;
  /** What no chat owns: the installation's own tables, and the rows that name no chat. */
  rest: number;
}

/**
 * What each chat's rows take of the database `size` bytes, in every table that carries the chat: a table's bytes (its pages, its indexes'
 * with them) shared by the length of each chat's rows in it. What is left of `size` is `rest`.
 */
export function rowShares(db: Database, user: string, size: number): RowShares {
  const pages = pagesOf(db);
  const chats = new Map<string, number>();
  for (const [name, owner] of ownersOf(db)) {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    const length = columns.map((c) => `COALESCE(length(CAST(t."${c}" AS BLOB)), 0) + 1`).join(" + ");
    const rows = db.query<{ chat: string | null; n: number }, [string]>(`SELECT ${owner.chat} AS chat, sum(${length}) AS n FROM "${name}" t ${owner.joins} WHERE t."user" = ? GROUP BY chat`).all(user);
    const total = rows.reduce((sum, r) => sum + r.n, 0);
    if (total === 0) continue;
    const indexes = db.query<{ name: string }, []>(`PRAGMA index_list("${name}")`).all().map((i) => i.name);
    const held = [name, ...indexes].reduce((sum, n) => sum + (pages.get(n) ?? 0), 0);
    const bytes = held > 0 ? held : total;
    for (const r of rows) if (r.chat !== null) chats.set(r.chat, (chats.get(r.chat) ?? 0) + Math.round((bytes * r.n) / total));
  }
  const shared = [...chats.values()].reduce((sum, n) => sum + n, 0);
  // A table's pages cannot add up to more than the file: shares that do are cut back in proportion.
  if (size > 0 && shared > size) for (const [chat, n] of chats) chats.set(chat, Math.floor((n * size) / shared));
  return { chats, rest: Math.max(0, size - [...chats.values()].reduce((sum, n) => sum + n, 0)) };
}

/** The tables a chat's rows are never removed from: where the tree keeps that a chat was placed and deleted, which the removal of its files needs. */
const KEPT_TABLES: ReadonlySet<string> = new Set(["tree_chat"]);

/** What a chat has in one table: its rows, and the bytes they take as the rows' own lengths add up. */
export interface ChatTableRows {
  table: string;
  rows: number;
  bytes: number;
}

/** How early a table's rows go: the rows that name their chat through a path's node first, then those through a turn, then those that name the chat themselves. */
const order = (owner: Owner): number => (owner.joins.includes('"path_node"') ? 0 : owner.joins === "" ? 2 : 1);

/** What a chat has in each table that carries the chat (only those named, when `only` is given), the tables with no row of it left out. */
export function chatRows(db: Database, user: string, chat: string, only?: readonly string[]): ChatTableRows[] {
  const out: ChatTableRows[] = [];
  for (const [name, owner] of ownersOf(db)) {
    if (KEPT_TABLES.has(name) || (only !== undefined && !only.includes(name))) continue;
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    const length = columns.map((c) => `COALESCE(length(CAST(t."${c}" AS BLOB)), 0) + 1`).join(" + ");
    const row = db.query<{ n: number; bytes: number | null }, [string, string]>(`SELECT count(*) AS n, sum(${length}) AS bytes FROM "${name}" t ${owner.joins} WHERE t."user" = ? AND ${owner.chat} = ?`).get(user, chat);
    if (row !== null && row.n > 0) out.push({ table: name, rows: row.n, bytes: row.bytes ?? 0 });
  }
  return out;
}

/**
 * Removes the chat's rows from every table that carries the chat (or only those named), in the order its rows can still be found by:
 * through a path's node, then through a turn, then by the chat itself. The one transaction is the caller's. How many rows went.
 */
export function removeChatRows(db: Database, user: string, chat: string, only?: readonly string[]): number {
  const tables = [...ownersOf(db)].filter(([name]) => !KEPT_TABLES.has(name) && (only === undefined || only.includes(name))).sort((a, b) => order(a[1]) - order(b[1]));
  let removed = 0;
  for (const [name, owner] of tables) {
    // A table kept without a rowid is found by its key.
    const key = db.query<{ name: string; pk: number }, []>(`PRAGMA table_info("${name}")`).all().filter((c) => c.pk > 0).map((c) => `"${c.name}"`);
    const withoutRowid = /WITHOUT\s+ROWID/i.test(db.query<{ sql: string | null }, [string]>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name)?.sql ?? "");
    const target = withoutRowid && key.length > 0 ? key.map((k) => `t.${k}`).join(", ") : "t.rowid";
    const column = withoutRowid && key.length > 0 ? `(${key.join(", ")})` : "rowid";
    removed += db.run(`DELETE FROM "${name}" WHERE ${column} IN (SELECT ${target} FROM "${name}" t ${owner.joins} WHERE t."user" = ? AND ${owner.chat} = ?)`, [user, chat]).changes;
  }
  return removed;
}
