// The store's tables (plan Appendix B, "Chats and turns"). Every table carries the user.
//
// On RPE's database the application runs these migrations with every other area's (area "store"),
// and a store handed that database writes nothing to it on opening: it expects its tables there.
// `migrateStore` brings up a database the store has to itself (one it opens from a path, a test's, a
// script's), keeping how far it has gone in SQLite's `user_version` rather than in a table.

import type { Database } from "bun:sqlite";
import { StoreSchemaError } from "./types";

export interface Migration {
  version: number;
  sql: string;
}

export const STORE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE chat (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  world TEXT,
  revision TEXT,
  source_chat TEXT,
  source_message TEXT,
  head TEXT,
  path TEXT NOT NULL DEFAULT '[]',
  created INTEGER NOT NULL,
  deleted INTEGER,
  PRIMARY KEY (user, id)
);
CREATE TABLE message_link (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  message TEXT NOT NULL,
  source_chat TEXT NOT NULL,
  source_message TEXT NOT NULL,
  PRIMARY KEY (user, chat, message)
);
CREATE INDEX message_link_source ON message_link (user, source_chat);
CREATE TABLE session (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  chat TEXT NOT NULL,
  scene TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  closed_by TEXT,
  PRIMARY KEY (user, id)
);
CREATE INDEX session_chat ON session (user, chat);
CREATE TABLE turn (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  chat TEXT NOT NULL,
  parent TEXT,
  node TEXT NOT NULL,
  depth INTEGER NOT NULL,
  kind TEXT NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0,
  generation TEXT,
  message TEXT,
  hash TEXT,
  swipe_date INTEGER,
  status TEXT NOT NULL,
  edited TEXT,
  intent TEXT,
  story_time INTEGER,
  timings TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created INTEGER NOT NULL,
  PRIMARY KEY (user, id)
);
CREATE INDEX turn_message ON turn (user, chat, message);
CREATE INDEX turn_parent ON turn (user, parent);
CREATE TABLE path_node (
  user TEXT NOT NULL,
  key TEXT NOT NULL,
  prev TEXT,
  turn TEXT NOT NULL,
  depth INTEGER NOT NULL,
  PRIMARY KEY (user, key)
);
CREATE INDEX path_node_prev ON path_node (user, prev);
CREATE INDEX path_node_turn ON path_node (user, turn);
-- Ids only ever grow, never reused after a delete: a snapshot's "upto" tells what was recorded after it.
CREATE TABLE change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  ord INTEGER NOT NULL,
  lane TEXT NOT NULL,
  op TEXT NOT NULL,
  value TEXT NOT NULL,
  by TEXT,
  standing TEXT,
  precision TEXT,
  source TEXT,
  cite TEXT,
  job TEXT,
  applied INTEGER NOT NULL,
  reports TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX change_turn ON change (user, turn, ord);
CREATE TABLE snapshot (
  user TEXT NOT NULL,
  node TEXT NOT NULL,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  upto INTEGER NOT NULL,
  state TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (user, node, kind)
);
-- Replaced by every write that changes what a fold gives; states folded in memory carry the mark
-- they were folded under, so one folded inside a write that was then rolled back is never used.
CREATE TABLE fold_mark (
  user TEXT NOT NULL,
  mark TEXT NOT NULL,
  PRIMARY KEY (user)
);
`,
  },
];

/** The tables the store reads and writes, all made by its migrations. */
export const STORE_TABLES: readonly string[] = ["chat", "message_link", "session", "turn", "path_node", "change", "snapshot", "fold_mark"];

/** The store's tables `db` does not hold. */
export function missingStoreTables(db: Database): string[] {
  const held = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name),
  );
  return STORE_TABLES.filter((t) => !held.has(t));
}

/**
 * Brings a database the store has to itself up to every store migration, each in a transaction of
 * its own, and returns the version it is at. A database whose store tables another runner made (RPE's
 * migrations) is refused before anything is written.
 */
export function migrateStore(db: Database, migrations: readonly Migration[] = STORE_MIGRATIONS): number {
  let at = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (at === 0 && missingStoreTables(db).length < STORE_TABLES.length) {
    throw new StoreSchemaError("This database already holds the store's tables, made by RPE's migrations: open the store on it as it is, without migrateStore.");
  }
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= at) continue;
    db.transaction(() => {
      db.run(m.sql);
      db.run(`PRAGMA user_version = ${Math.floor(m.version)}`);
    })();
    at = m.version;
  }
  return at;
}
