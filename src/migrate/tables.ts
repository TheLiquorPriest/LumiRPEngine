// The migration's own tables (STANDALONE-PLAN Appendix B, "Migration"), kept under the app's
// migration area `migrate`: each real run with its report, each row of the plan's table per run,
// each chat the migration imported with what came of it, and each imported turn's record as today's
// build kept it, beside the turn and read-only; and RPE's copy of the user's worlds, every file byte
// for byte (plan §4.5: world definitions are kept as they are, by revision, in the database). Every
// table carries the user.

import type { Database } from "bun:sqlite";
import type { Migration } from "../app/migrations";
import type { MigrationReport } from "./report";

export const MIGRATE_TABLES: readonly Migration[] = [
  {
    version: 1,
    name: "runs, rows, imported chats and records",
    sql: `
CREATE TABLE migration_run (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  report TEXT NOT NULL,
  PRIMARY KEY (user, id)
);
CREATE TABLE migration_item (
  user TEXT NOT NULL,
  run TEXT NOT NULL,
  store TEXT NOT NULL,
  found INTEGER NOT NULL,
  carried INTEGER NOT NULL,
  attached INTEGER NOT NULL,
  archived INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  landed TEXT NOT NULL,
  PRIMARY KEY (user, run, store)
);
CREATE TABLE migration_chat (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  run TEXT NOT NULL,
  source TEXT,
  outcome TEXT NOT NULL,
  marked INTEGER NOT NULL,
  PRIMARY KEY (user, chat)
);
CREATE TABLE imported_record (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT NOT NULL,
  message TEXT NOT NULL,
  swipe INTEGER NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (user, turn)
);
CREATE INDEX imported_record_chat ON imported_record (user, chat);
`,
  },
  {
    version: 2,
    name: "worlds, byte for byte",
    sql: `
CREATE TABLE world_file (
  user TEXT NOT NULL,
  world TEXT NOT NULL,
  file TEXT NOT NULL,
  bytes BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  run TEXT NOT NULL,
  PRIMARY KEY (user, world, file)
);
`,
  },
];

/** Whether the database holds the migration's tables yet. */
function hasTables(db: Database): boolean {
  return (db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'migration_run'").get()?.n ?? 0) > 0;
}

/** The report of the user's last real run, or null when there was none. */
export function lastReport(db: Database, user: string): MigrationReport | null {
  if (!hasTables(db)) return null;
  const row = db.query<{ report: string }, [string]>("SELECT report FROM migration_run WHERE user = ? ORDER BY at DESC, rowid DESC LIMIT 1").get(user);
  return row === null ? null : (JSON.parse(row.report) as MigrationReport);
}

/** The chats an earlier run imported for the user, with the chat each shares turns with. */
export function importedChats(db: Database, user: string): { chat: string; source: string | null }[] {
  if (!hasTables(db)) return [];
  return db.query<{ chat: string; source: string | null }, [string]>("SELECT chat, source FROM migration_chat WHERE user = ? ORDER BY chat").all(user);
}

/** Keeps a run's report, with its rows and where each now lands. */
export function keepRun(db: Database, user: string, id: string, report: MigrationReport, landed: (row: string) => string): void {
  db.transaction(() => {
    db.run("INSERT INTO migration_run (user, id, at, report) VALUES (?, ?, ?, ?)", [user, id, report.at, JSON.stringify(report)]);
    const put = db.query("INSERT INTO migration_item (user, run, store, found, carried, attached, archived, bytes, checksum, landed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of report.rows) put.run(user, id, r.row, r.count.found, r.count.carried, r.count.attached, r.count.archived, r.bytes, r.digest, landed(r.row));
  })();
}

/** Notes what a run did with a chat. */
export function keepChat(db: Database, user: string, chat: string, run: string, source: string | null, outcome: string, marked: boolean): void {
  db.run("INSERT OR REPLACE INTO migration_chat (user, chat, run, source, outcome, marked) VALUES (?, ?, ?, ?, ?, ?)", [user, chat, run, source, outcome, marked ? 1 : 0]);
}

/** Forgets the chats a run removed from the store, and the records kept beside their turns. */
export function forgetChats(db: Database, user: string, chats: readonly string[]): void {
  for (const chat of chats) {
    db.run("DELETE FROM imported_record WHERE user = ? AND chat = ?", [user, chat]);
    db.run("DELETE FROM migration_chat WHERE user = ? AND chat = ?", [user, chat]);
  }
}

/** Keeps today's record of one swipe beside the turn it became. */
export function keepRecord(db: Database, user: string, row: { chat: string; turn: string; message: string; swipe: number; record: unknown }): void {
  db.run("INSERT OR REPLACE INTO imported_record (user, chat, turn, message, swipe, record) VALUES (?, ?, ?, ?, ?, ?)", [user, row.chat, row.turn, row.message, row.swipe, JSON.stringify(row.record)]);
}
