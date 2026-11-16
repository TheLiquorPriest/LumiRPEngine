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
  {
    version: 2,
    // A chat on a real world starts from, and folds over, the revision it plays. A revision's id is its
    // document's content hash, so a revision once kept never changes and one id names one document.
    // A job's changes take effect just before the first turn that begins after the job ended (plan
    // §10.9), so when each job ended is kept.
    sql: `
CREATE TABLE world_revision (
  user TEXT NOT NULL,
  revision TEXT NOT NULL,
  world TEXT NOT NULL,
  doc TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (user, revision)
);
CREATE INDEX world_revision_world ON world_revision (user, world);
CREATE INDEX world_revision_id ON world_revision (revision);
CREATE TABLE job_end (
  user TEXT NOT NULL,
  job TEXT NOT NULL,
  ended INTEGER NOT NULL,
  PRIMARY KEY (user, job)
);
CREATE INDEX change_job ON change (user, job) WHERE job IS NOT NULL;
`,
  },
  {
    version: 3,
    // What RPE heard of a chat's messages since its last comparison (plan §4.2, §6.3): hidden marks and edits, by message id, as
    // JSON. The event's calls write it, the question reads it, and the next comparison clears it as it takes what the chat shows.
    // The path column keeps the path and nothing else. A chat made before this comes up having heard nothing.
    sql: `ALTER TABLE chat ADD COLUMN heard TEXT NOT NULL DEFAULT '{}';`,
  },
  {
    version: 4,
    // A continue's held turn joined to the turn it extended (plan §10.10, R-192 (e), (f)): the turn whose changes it joined, kept
    // so a job the continue started, still holding that turn, is told where to write. A turn made before this joined none.
    sql: `ALTER TABLE turn ADD COLUMN joined TEXT;`,
  },
  {
    version: 5,
    // How many marks and edits of a chat's messages RPE has heard (plan §4.2): each one heard is numbered by it, so a comparison
    // keeps what was heard after its path was read. A chat made before this has heard nothing numbered; what it heard reads as heard
    // before any path its next comparison reads.
    sql: `ALTER TABLE chat ADD COLUMN heard_count INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    version: 6,
    // Snapshots by part (plan §6.3 l.619): a snapshot's row names the parts its state is made of, each by the hash of its text,
    // and each part is stored once for the user, counted by the snapshots that name it and gone with the last of them. A snapshot
    // stored before this holds its whole state and names no part.
    sql: `
CREATE TABLE snapshot_part (
  user TEXT NOT NULL,
  hash TEXT NOT NULL,
  body TEXT NOT NULL,
  refs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, hash)
);
CREATE TRIGGER snapshot_parts_named AFTER INSERT ON snapshot BEGIN
  UPDATE snapshot_part SET refs = refs + 1 WHERE user = NEW.user AND hash IN (SELECT value FROM json_each(NEW.state, '$.parts'));
END;
CREATE TRIGGER snapshot_parts_renamed AFTER UPDATE OF state ON snapshot BEGIN
  UPDATE snapshot_part SET refs = refs + 1 WHERE user = NEW.user AND hash IN (SELECT value FROM json_each(NEW.state, '$.parts'));
  UPDATE snapshot_part SET refs = refs - 1 WHERE user = OLD.user AND hash IN (SELECT value FROM json_each(OLD.state, '$.parts'));
  DELETE FROM snapshot_part WHERE user = OLD.user AND refs <= 0 AND hash IN (SELECT value FROM json_each(OLD.state, '$.parts'));
END;
CREATE TRIGGER snapshot_parts_unnamed AFTER DELETE ON snapshot BEGIN
  UPDATE snapshot_part SET refs = refs - 1 WHERE user = OLD.user AND hash IN (SELECT value FROM json_each(OLD.state, '$.parts'));
  DELETE FROM snapshot_part WHERE user = OLD.user AND refs <= 0 AND hash IN (SELECT value FROM json_each(OLD.state, '$.parts'));
END;
`,
  },
  {
    version: 7,
    // A fold mark for each chat (plan §6.3 l.616, 619): a write voids the states held for the chats whose path runs through what it
    // writes, and no other chat's. Marks only ever stand for states held in memory, so the user's marks before this go with it.
    sql: `
DROP TABLE fold_mark;
CREATE TABLE fold_mark (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  mark TEXT NOT NULL,
  PRIMARY KEY (user, chat)
);
`,
  },
];

/** The tables the store reads and writes, all made by its migrations. */
export const STORE_TABLES: readonly string[] = ["chat", "message_link", "session", "turn", "path_node", "change", "snapshot", "fold_mark", "world_revision", "job_end", "snapshot_part"];

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
