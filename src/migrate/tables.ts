// The migration's own tables (STANDALONE-PLAN Appendix B, "Migration"), kept under the app's
// migration area `migrate`: each real run with its report, each row of the plan's table per run,
// each chat the migration imported with what came of it, and each imported turn's record as today's
// build kept it, beside the turn and read-only; and RPE's copy of the user's worlds, every file byte
// for byte (plan §4.5: world definitions are kept as they are, by revision, in the database). Every
// table carries the user.

import type { Database } from "bun:sqlite";
import type { Migration } from "../app/migrations";
import type { ChatCarried } from "./briefing";
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
  {
    version: 3,
    name: "what a run keeps in the backup only",
    // A row's things this build has no place for yet (`NO_PLACE_YET`): their own count, never carried or archived.
    sql: "ALTER TABLE migration_item ADD COLUMN backup INTEGER NOT NULL DEFAULT 0;",
  },
  {
    version: 4,
    name: "what a run carried of each chat",
    // Read by the chat's first briefing on RPE and by the Migration page: counts and names, never content.
    sql: "ALTER TABLE migration_chat ADD COLUMN carried TEXT;",
  },
  {
    version: 5,
    name: "which character each of today's people became",
    // A later run finds a person's character here before any name, so a rename or a name two people share never makes a second one.
    sql: `
CREATE TABLE migration_person (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  entity TEXT NOT NULL,
  character TEXT NOT NULL,
  PRIMARY KEY (user, chat, entity)
);
CREATE INDEX migration_person_character ON migration_person (user, character);
`,
  },
  {
    version: 6,
    name: "the files a run wrote into the file tree",
    // A later run removes what an earlier one wrote and today's side no longer has, where it is still as that run wrote it.
    sql: `
CREATE TABLE migration_file (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  base TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (user, base, path)
);
`,
  },
  {
    version: 7,
    name: "what a run put into RPE's own documents",
    // A later run replaces a carried connection, the default or a carried setting only where RPE's copy is still what a run put there: what the user changed in RPE stays.
    sql: `
CREATE TABLE migration_put (
  user TEXT NOT NULL,
  what TEXT NOT NULL,
  print TEXT NOT NULL,
  PRIMARY KEY (user, what)
);
`,
  },
];

/** Whether the database holds the migration's tables yet. */
function hasTables(db: Database): boolean {
  return (db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'migration_run'").get()?.n ?? 0) > 0;
}

/** Keeps what a run carried of a chat it imported, beside what it did with the chat. */
export function keepCarried(db: Database, user: string, chat: string, carried: ChatCarried): void {
  db.run("UPDATE migration_chat SET carried = ? WHERE user = ? AND chat = ?", [JSON.stringify(carried), user, chat]);
}

/** The character one of today's people became in a chat (the one it was made in); null where no run made one. */
export function personOf(db: Database, user: string, chat: string, entity: string): string | null {
  return db.query<{ character: string }, [string, string, string]>("SELECT character FROM migration_person WHERE user = ? AND chat = ? AND entity = ?").get(user, chat, entity)?.character ?? null;
}

/** Whether a run made `character` of one of today's people. */
export function isPerson(db: Database, user: string, character: string): boolean {
  return db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM migration_person WHERE user = ? AND character = ?").get(user, character)?.n !== 0;
}

/** Notes the character one of today's people became in a chat, inside the caller's write. */
export function keepPerson(db: Database, user: string, chat: string, entity: string, character: string): void {
  db.run("INSERT OR REPLACE INTO migration_person (user, chat, entity, character) VALUES (?, ?, ?, ?)", [user, chat, entity, character]);
}

/** Today's people of a chat and the characters they became there, as runs made them. */
export function peopleOf(db: Database, user: string, chat: string): { entity: string; character: string }[] {
  return db.query<{ entity: string; character: string }, [string, string]>("SELECT entity, character FROM migration_person WHERE user = ? AND chat = ? ORDER BY entity").all(user, chat);
}

/** A file a run wrote into the file tree, below its folder: the chat whose notes it is ("" at the user's level), the folder it was written under and its path there, and the SHA-256 of what was written. */
export interface WrittenFile {
  chat: string;
  base: string;
  path: string;
  sha256: string;
}

/** The files the user's earlier runs wrote into the file tree, as the last run left the list. */
export function writtenFiles(db: Database, user: string): WrittenFile[] {
  return db.query<WrittenFile, [string]>("SELECT chat, base, path, sha256 FROM migration_file WHERE user = ? ORDER BY base, path").all(user);
}

/** Keeps the list of files in the file tree that are the migration's, in place of the last. */
export function keepWritten(db: Database, user: string, files: readonly WrittenFile[]): void {
  db.transaction(() => {
    db.run("DELETE FROM migration_file WHERE user = ?", [user]);
    const put = db.query("INSERT OR REPLACE INTO migration_file (user, chat, base, path, sha256) VALUES (?, ?, ?, ?, ?)");
    for (const f of files) put.run(user, f.chat, f.base, f.path, f.sha256);
  })();
}

/**
 * What the user's earlier runs put into RPE's own documents, each as the last of them put it there:
 * by what it is (`connection <id>`, `default`, `setting <key>`), the fingerprint (`hashJson`) of
 * the value put.
 */
export function putPrints(db: Database, user: string): Map<string, string> {
  return new Map(db.query<{ what: string; print: string }, [string]>("SELECT what, print FROM migration_put WHERE user = ?").all(user).map((r) => [r.what, r.print]));
}

/** Keeps what a run put into RPE's own documents, over what an earlier run put of the same. */
export function keepPutPrints(db: Database, user: string, prints: ReadonlyMap<string, string>): void {
  db.transaction(() => {
    const put = db.query("INSERT INTO migration_put (user, what, print) VALUES (?, ?, ?) ON CONFLICT (user, what) DO UPDATE SET print = excluded.print");
    for (const [what, print] of prints) put.run(user, what, print);
  })();
}

/** What the last run that imported a chat did with it, and what it carried of it. */
export interface ChatRecord {
  run: string;
  outcome: string;
  marked: boolean;
  carried: ChatCarried;
}

/** What the last run that imported a chat did with it and carried of it; null when no run imported it, or this database holds no such record (no run here, or only runs by a build that kept none). */
export function chatRecord(db: Database, user: string, chat: string): ChatRecord | null {
  if (!hasTables(db)) return null;
  const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('migration_chat')").all();
  if (!columns.some((c) => c.name === "carried")) return null;
  const row = db.query<{ run: string; outcome: string; marked: number; carried: string | null }, [string, string]>("SELECT run, outcome, marked, carried FROM migration_chat WHERE user = ? AND chat = ?").get(user, chat);
  return row === null || row.carried === null ? null : { run: row.run, outcome: row.outcome, marked: row.marked === 1, carried: JSON.parse(row.carried) as ChatCarried };
}

/** The report of the user's last real run, or null when there was none. */
export function lastReport(db: Database, user: string): MigrationReport | null {
  if (!hasTables(db)) return null;
  const row = db.query<{ report: string }, [string]>("SELECT report FROM migration_run WHERE user = ? ORDER BY at DESC, rowid DESC LIMIT 1").get(user);
  return row === null ? null : (JSON.parse(row.report) as MigrationReport);
}

/** The users whose data earlier real runs carried into this database: one RPE serves one Lumiverse user. */
export function runUsers(db: Database): string[] {
  if (!hasTables(db)) return [];
  return db.query<{ user: string }, []>("SELECT DISTINCT user FROM migration_run ORDER BY user").all().map((r) => r.user);
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
    const put = db.query("INSERT INTO migration_item (user, run, store, found, carried, attached, archived, backup, bytes, checksum, landed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of report.rows) put.run(user, id, r.row, r.count.found, r.count.carried, r.count.attached, r.count.archived, r.count.backup, r.bytes, r.digest, landed(r.row));
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
