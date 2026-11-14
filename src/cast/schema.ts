// The cast's tables (plan §7.1, Appendix B "Characters"), the application's `cast` area. Three of
// them stand outside turns: the characters themselves (a name, and the casting the player pinned),
// their sources as bindings (the text stays in Lumiverse and is read live), and the base as
// versioned documents, each version with the revisions of the sources it was drawn against. The
// fourth holds every other part as rows tied to the turn that wrote them, read along the path the
// way the story record is: a swipe or a delete takes a turn's rows off the path, and showing that
// swipe again brings them back. Nothing here caps what is stored.

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
];
