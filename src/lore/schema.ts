// The lore area's tables (plan §9, Appendix B), as steps for the application's migration runner (its
// area `lore`). Lumiverse's books are never copied here: RPE keeps only what it adds to them.
//
//   lore_entry_number  the short number of each book entry an agent has seen (`ids.ts`)
//   lore_index         what an indexing run wrote of each entry, and the user's own edits over it,
//                      with the entry's revision the run read (`indexing.ts`)
//   lore_overlay       the Author's notes that a chat's story has moved past part of an entry, each
//                      tied to the turn that wrote it, the agent and the job that wrote it, and its
//                      place among the turn's story rows (`overlays.ts`)
//   lore_proposal      an agent's draft of a new entry or of an edit to one, until the user decides
//   lore_write         every write RPE made to the user's books, with the entry before and after, so
//                      it can be put back (`proposals.ts`)
//   lore_projection    the book RPE owns for one chat, when the projection is on, and a signature of
//                      what it last wrote there (`projection.ts`)

import type { Migration } from "../app/migrations";

export const LORE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "book entry numbers",
    sql: `CREATE TABLE lore_entry_number (
  user TEXT NOT NULL,
  n INTEGER NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (user, n),
  UNIQUE (user, entry)
)`,
  },
  {
    version: 2,
    name: "the lore index",
    // `world` is '' for a book entry, whose number is the user's for good; a world entry's key is its
    // world's own, so the world's id goes with it. `defines` and `related` are JSON lists. Each `own_`
    // column is the user's edit, which stands over the run's and outlives a run that redoes the entry.
    sql: `CREATE TABLE lore_index (
  user TEXT NOT NULL,
  world TEXT NOT NULL,
  entry TEXT NOT NULL,
  revision TEXT,
  kind TEXT,
  line TEXT,
  defines TEXT,
  related TEXT,
  by TEXT,
  written INTEGER,
  own_kind TEXT,
  own_line TEXT,
  own_defines TEXT,
  own_related TEXT,
  edited INTEGER,
  PRIMARY KEY (user, world, entry)
)`,
  },
  {
    version: 3,
    name: "lore overlays",
    // `entry` is the id the lore map shows (`e-12`, `w-harbor`); a chat's world is its own, so a world
    // entry's key needs no world beside it here.
    sql: `
CREATE TABLE lore_overlay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT NOT NULL,
  entry TEXT NOT NULL,
  note TEXT NOT NULL,
  by TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX lore_overlay_entry ON lore_overlay (user, chat, entry);
`,
  },
  {
    version: 4,
    name: "lore proposals and writes",
    // A proposal's `target` is the entry as the agent named it (null: a new entry), `entry` Lumiverse's
    // id of it and `revision` its revision when the draft was made, which an approval is checked
    // against. A write's `before` and `after` are the entry's fields as JSON (null: no entry).
    sql: `
CREATE TABLE lore_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT,
  agent TEXT NOT NULL,
  target TEXT,
  entry TEXT,
  revision INTEGER,
  text TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  said TEXT,
  created INTEGER NOT NULL,
  decided INTEGER,
  write INTEGER
);
CREATE INDEX lore_proposal_user ON lore_proposal (user, status);
CREATE TABLE lore_write (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  proposal INTEGER,
  kind TEXT NOT NULL,
  entry TEXT NOT NULL,
  book TEXT NOT NULL,
  before TEXT,
  after TEXT,
  revision INTEGER,
  of INTEGER,
  put_back INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX lore_write_user ON lore_write (user, id);
`,
  },
  {
    version: 5,
    name: "projection books",
    sql: `CREATE TABLE lore_projection (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  book TEXT NOT NULL,
  signature TEXT,
  written INTEGER,
  PRIMARY KEY (user, chat)
)`,
  },
  {
    version: 6,
    name: "overlays by writer and place",
    // An overlay is written through the story's own write: `agent` and `job` are the writer's, as on a
    // story row, and `ord` its place among the turn's story rows, so a dropped sub-agent and a continue
    // that saved nothing take it back with them. One written before it has no place (-1): it stands
    // before every row of its turn. Overlays are read by the turns of a path, as the story's rows are.
    sql: `
ALTER TABLE lore_overlay ADD COLUMN agent TEXT;
ALTER TABLE lore_overlay ADD COLUMN job TEXT;
ALTER TABLE lore_overlay ADD COLUMN ord INTEGER NOT NULL DEFAULT -1;
CREATE INDEX lore_overlay_turn ON lore_overlay (user, turn, ord);
`,
  },
];
