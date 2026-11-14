// The store's tables (plan Appendix B, "Chats and turns") and the small runner that brings a
// database up to them. Every table but the runner's own version row carries the user.

import type { Database } from "bun:sqlite";

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
CREATE TABLE change (
  id INTEGER PRIMARY KEY,
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
`,
  },
];

/** Brings `db` up to the newest version; returns the version it is at. */
export function migrateStore(db: Database, migrations: readonly Migration[] = STORE_MIGRATIONS): number {
  db.run("CREATE TABLE IF NOT EXISTS store_schema (version INTEGER NOT NULL)");
  const row = db.query<{ version: number }, []>("SELECT version FROM store_schema").get();
  let at = row?.version ?? 0;
  if (!row) db.run("INSERT INTO store_schema (version) VALUES (0)");
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= at) continue;
    db.transaction(() => {
      db.run(m.sql);
      db.run("UPDATE store_schema SET version = ?", [m.version]);
    })();
    at = m.version;
  }
  return at;
}
