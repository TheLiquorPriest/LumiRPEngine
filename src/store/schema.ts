// The store's tables (plan Appendix B, "Chats and turns"). Every table carries the user.
//
// On RPE's database the application runs these migrations with every other area's (area "store"),
// and a store handed that database writes nothing to it on opening: it expects its tables there.
// `migrateStore` brings up a database the store has to itself (one it opens from a path, a test's, a
// script's), keeping how far it has gone in SQLite's `user_version` rather than in a table.

import type { Database } from "bun:sqlite";
import { keepWorldsOnce } from "./worlds";
import { StoreSchemaError } from "./types";

/** One step of the store's tables, as the application's runner takes it: SQL, or a function handed the database and the user it belongs to. */
export type Migration = { version: number; name?: string } & ({ sql: string } | { up: (db: Database, user: string) => void });

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
  {
    version: 8,
    // Who decided a change, and apart from it the run that wrote it (plan §13.4: a lead drops a sub-agent's staged writes by its
    // handle). A change written before this kept the run's handle in `by`, as its writer gave it: that is its handle.
    sql: `
ALTER TABLE change ADD COLUMN handle TEXT;
UPDATE change SET handle = by;
`,
  },
  {
    version: 9,
    // His own changes (plan §6.3 l.632, §10.9, R-22, R-27): a change of no turn, kept with its chat (`chat`, its `turn` empty) and the
    // moment it was made (`created`; a job of his: when it ended). A change of a turn names no chat. A chat's first comparison
    // (`compared`, when it was; null before it): a branch has its path from the moment it is made, so its first comparison is told
    // by this, not by an empty path; a chat compared already counts from when it was made.
    sql: `
ALTER TABLE change ADD COLUMN chat TEXT;
CREATE INDEX change_owner ON change (user, chat) WHERE chat IS NOT NULL;
ALTER TABLE chat ADD COLUMN compared INTEGER;
UPDATE chat SET compared = created WHERE path <> '[]';
`,
  },
  {
    version: 10,
    // The reports a change's tool made for it when it was recorded (plan §6.7, AuState-120): codes and values, kept beside the
    // store's own (`reports`), which a join of a held turn writes again; these it never does.
    sql: `
ALTER TABLE change ADD COLUMN told TEXT;
`,
  },
  {
    version: 11,
    // His own change written again after an import forgot its chat and tied the chat's turns afresh (`restoreOwn`): the turn it stands
    // just before (`placed`), wherever that turn's moment falls (an import's turns share one), and the moment it is placed by where
    // that turn is not on the path read (`moment`; a job's end later than it still counts).
    sql: `
ALTER TABLE change ADD COLUMN placed TEXT;
ALTER TABLE change ADD COLUMN moment INTEGER;
`,
  },
  {
    version: 12,
    // The Author's horizon is the story's record, beside the scene (B-5): the store's own horizon operation goes, and each change that
    // recorded one becomes the story area's, whose list takes the same entries (each in full).
    sql: `
UPDATE change SET op = 'story.horizon', lane = 'story' WHERE op = 'store.horizon';
`,
  },
  {
    version: 13,
    name: "worlds kept once, byte for byte",
    // Every world part in one table (plan §4.5, R-10): each revision's bytes as received under its id with their checksum, and each
    // world's index, draft (with the version it stands at) and history notes beside them. What the migration carried (`world_file`)
    // and what Build kept (`build_file`) move in byte for byte, their checksums compared, and stay where they are until their
    // callers move; the store's old revision table (`world_revision`) moves in and goes.
    up: (db) => {
      db.run(`
CREATE TABLE world_part (
  user TEXT NOT NULL,
  world TEXT NOT NULL,
  file TEXT NOT NULL,
  bytes BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  PRIMARY KEY (user, world, file)
);
CREATE INDEX world_part_file ON world_part (file);
`);
      keepWorldsOnce(db, Date.now());
    },
  },
  {
    version: 14,
    // What the old engines recorded, kept in the store (plan §15.2): a chat's own record (its seed, when it started, whether the engine was on
    // for it before the swap, which engine played it; a chat made before this has its id for a seed and the day it was made), the text a
    // carried turn was played on, and why a reply stands with no turn (stopped, failed, restarted), kept by its message.
    sql: `
ALTER TABLE chat ADD COLUMN seed TEXT;
ALTER TABLE chat ADD COLUMN started INTEGER;
ALTER TABLE chat ADD COLUMN was_on INTEGER;
ALTER TABLE chat ADD COLUMN engine TEXT;
UPDATE chat SET seed = id, started = created;
ALTER TABLE turn ADD COLUMN text TEXT;
CREATE TABLE reply_reason (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  message TEXT NOT NULL,
  why TEXT NOT NULL,
  PRIMARY KEY (user, chat, message)
);
`,
  },
];

/** The tables the store reads and writes, all made by its migrations. */
export const STORE_TABLES: readonly string[] = ["chat", "message_link", "session", "turn", "path_node", "change", "snapshot", "fold_mark", "world_part", "job_end", "snapshot_part", "reply_reason"];

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
      if ("sql" in m) db.run(m.sql);
      else m.up(db, "");
      db.run(`PRAGMA user_version = ${Math.floor(m.version)}`);
    })();
    at = m.version;
  }
  return at;
}
