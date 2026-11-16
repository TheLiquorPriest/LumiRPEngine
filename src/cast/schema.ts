// The cast's tables (plan §7.1, Appendix B "Characters"), the application's `cast` area: the characters themselves (a name, and the
// casting the player pinned), their sources as bindings (the text stays in Lumiverse and is read live), and `character_doc`, the
// base as versioned documents (each version with the revisions of the sources it was drawn against) and a migrated character's
// mind files attached as they were. Every other part (casting, growth, mind, memories, relationships, knowledge, perceptions,
// history) is a change of the store, `cast.write` (`fold.ts`): migration 2 moved the rows the first build kept in their own table
// to it. Nothing here caps what is stored.

import type { Database } from "bun:sqlite";
import type { Migration } from "../app";

export const CAST_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "the cast",
    sql: `
CREATE TABLE cast_character (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  chat TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  pinned TEXT,
  created INTEGER NOT NULL
);
CREATE UNIQUE INDEX cast_character_id ON cast_character (user, id);
CREATE UNIQUE INDEX cast_character_name ON cast_character (user, chat, name_key);
CREATE TABLE cast_binding (
  user TEXT NOT NULL,
  character TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  defines TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (user, character, kind, ref)
);
CREATE TABLE cast_doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  character TEXT NOT NULL,
  part TEXT NOT NULL,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  seen TEXT NOT NULL,
  turn TEXT,
  by TEXT,
  agent TEXT,
  created INTEGER NOT NULL
);
CREATE UNIQUE INDEX cast_doc_version ON cast_doc (user, character, part, version);
CREATE TABLE cast_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  ord INTEGER NOT NULL,
  character TEXT NOT NULL,
  part TEXT NOT NULL,
  item TEXT NOT NULL,
  value TEXT NOT NULL,
  at INTEGER,
  by TEXT,
  agent TEXT,
  job TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX cast_entry_turn ON cast_entry (user, turn, ord);
`,
  },
  {
    version: 2,
    name: "the cast's writes are changes of the store",
    up: (db) => moveRows(db),
  },
  {
    version: 3,
    name: "a character keeps the world's person it is",
    up: (db) => {
      db.run("ALTER TABLE character ADD COLUMN person TEXT");
    },
  },
];

/**
 * The cast's writes tied to turns (the `cast_entry` table) become changes of the store, each on its own turn after what the turn
 * already holds, in the order they were made, each as it was written (value, writer, run, job, time); the text of a carried mind
 * file moves to `character_doc` as a version of that file on the turn that held it, and the write that attached it names the
 * version. The tables take the names Appendix B gives them. What the store held of folds is derived and made again.
 */
function moveRows(db: Database): void {
  db.run("ALTER TABLE cast_character RENAME TO character");
  db.run("ALTER TABLE cast_doc RENAME TO character_doc");
  db.run("ALTER TABLE character_doc ADD COLUMN kind TEXT NOT NULL DEFAULT 'base'");
  const rows = db
    .query<{ user: string; turn: string; character: string; part: string; item: string; value: string; at: number | null; by: string | null; agent: string | null; job: string | null; created: number }, []>(
      "SELECT user, turn, character, part, item, value, at, by, agent, job, created FROM cast_entry WHERE EXISTS (SELECT 1 FROM turn t WHERE t.user = cast_entry.user AND t.id = cast_entry.turn) ORDER BY user, turn, ord, id",
    )
    .all();
  const next = db.query<{ n: number | null }, [string, string]>("SELECT max(ord) AS n FROM change WHERE user = ? AND turn = ?");
  const versions = db.query<{ n: number | null }, [string, string, string]>("SELECT max(version) AS n FROM character_doc WHERE user = ? AND character = ? AND part = ? AND kind = 'file'");
  const attach = db.query<unknown, [string, string, string, number, string, string, string | null, string | null, number]>("INSERT INTO character_doc (user, character, kind, part, version, text, seen, turn, by, agent, created) VALUES (?, ?, 'file', ?, ?, ?, '{}', ?, ?, ?, ?)");
  const put = db.query<unknown, [string, string, number, string, string | null, string | null, string | null, string | null, number]>(
    "INSERT INTO change (user, turn, ord, lane, op, value, by, handle, source, job, applied, created) VALUES (?, ?, ?, 'story', 'cast.write', ?, ?, ?, ?, ?, 1, ?)",
  );
  let ord = 0;
  let on = "";
  for (const r of rows) {
    if (`${r.user}\u0000${r.turn}` !== on) {
      on = `${r.user}\u0000${r.turn}`;
      ord = (next.get(r.user, r.turn)?.n ?? -1) + 1;
    }
    const value = JSON.parse(r.value) as Record<string, unknown>;
    if (r.part === "mind" && value.kind === "imported" && typeof value.text === "string" && typeof value.file === "string") {
      const version = (versions.get(r.user, r.character, value.file)?.n ?? 0) + 1;
      attach.run(r.user, r.character, value.file, version, value.text, r.turn, r.by, r.agent, r.created);
      delete value.text;
      value.version = version;
    }
    const written = { character: r.character, part: r.part, item: r.item, value, at: r.at, agent: r.agent, when: r.created };
    put.run(r.user, r.turn, ord++, JSON.stringify(written), r.by, r.agent, r.by === "player" ? "player" : null, r.job, r.created);
  }
  db.run("DROP TABLE cast_entry");
  db.run("DELETE FROM snapshot WHERE kind = 'cache'");
}
