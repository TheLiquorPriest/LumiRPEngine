// The lore area's tables (plan §9, Appendix B), as steps for the application's migration runner (its
// area `lore`). Lumiverse's books are never copied here: RPE keeps only what it adds to them.
//
//   lore_entry_number  the short number of each book entry an agent has seen (`ids.ts`)
//   lore_world_number  the short number of each world entry, by its user, world and key (`ids.ts`)
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

import type { Database } from "bun:sqlite";
import type { Migration } from "../app/migrations";
import { giveWorldNumbers, worldEntryId, worldNumbersIn } from "./ids";

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
    // `world` is '' for a book entry, whose number is the user's for good; a world entry's number is its
    // world's own (`w-31`; until step 8 of this area its key), so the world's id goes with it. `defines` and `related` are JSON lists. Each `own_`
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
    // `entry` is the id the lore map shows (`e-12`, `w-31`; a world entry's was `w-harbor`, its key, until
    // step 8 of this area); a chat's world is its own, so a world entry's number needs no world beside it here.
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
  {
    version: 7,
    name: "world entry numbers",
    // A world entry's number is its user's for good, kept with its world and its key (the world
    // document's own address for it).
    sql: `CREATE TABLE lore_world_number (
  user TEXT NOT NULL,
  n INTEGER NOT NULL,
  world TEXT NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY (user, n),
  UNIQUE (user, world, key)
)`,
  },
  {
    version: 8,
    name: "world ids stored by key, by number",
    // The world ids RPE stored before world entries were numbered, in the form `w-<key>`, take their
    // numbers here, so nothing stored names an entry two ways.
    up: (db) => numberStoredWorldIds(db),
  },
];

/**
 * Gives the world ids stored before world entries were numbered (`w-<key>`, in the index's rows and
 * their lists of related entries, the overlays and the proposals' targets) their numbers, and writes
 * the ids back as `w-<number>`. A stored id names its entry's world through the chat it was written
 * for (an index row names its world itself). A row whose world cannot be found keeps its id as it is.
 * Each stored id is read once and written once, so a number is never read as a key.
 */
function numberStoredWorldIds(db: Database): void {
  const keyOf = (id: string | null): string | null => (id !== null && id.startsWith("w-") && id.length > 2 ? id.slice(2) : null);
  const numberOf = (user: string, world: string, key: string): number => giveWorldNumbers(db, user, world, [key]).get(key) ?? 0;

  // The index's rows: renamed through a name no id has, so one row's new id is never another's old one.
  const rows = db.query<{ rowid: number; user: string; world: string; entry: string }, []>("SELECT rowid, user, world, entry FROM lore_index WHERE world <> '' AND substr(entry, 1, 2) = 'w-' ORDER BY rowid").all();
  for (const row of rows) {
    const key = keyOf(row.entry);
    if (key !== null) db.run("UPDATE lore_index SET entry = ? WHERE rowid = ?", [`w#${numberOf(row.user, row.world, key)}`, row.rowid]);
  }
  db.run("UPDATE lore_index SET entry = 'w-' || substr(entry, 3) WHERE substr(entry, 1, 2) = 'w#'");

  const overlays = db
    .query<{ id: number; user: string; entry: string; world: string }, []>("SELECT o.id, o.user, o.entry, c.world FROM lore_overlay o JOIN chat c ON c.user = o.user AND c.id = o.chat WHERE substr(o.entry, 1, 2) = 'w-' AND c.world IS NOT NULL ORDER BY o.id")
    .all();
  for (const row of overlays) {
    const key = keyOf(row.entry);
    if (key !== null) db.run("UPDATE lore_overlay SET entry = ? WHERE id = ?", [worldEntryId(numberOf(row.user, row.world, key)), row.id]);
  }

  const proposals = db
    .query<{ id: number; user: string; target: string; world: string }, []>("SELECT p.id, p.user, p.target, c.world FROM lore_proposal p JOIN chat c ON c.user = p.user AND c.id = p.chat WHERE substr(p.target, 1, 2) = 'w-' AND c.world IS NOT NULL ORDER BY p.id")
    .all();
  for (const row of proposals) {
    const key = keyOf(row.target);
    if (key !== null) db.run("UPDATE lore_proposal SET target = ? WHERE id = ?", [worldEntryId(numberOf(row.user, row.world, key)), row.id]);
  }

  // The related entries an index row lists: a world row's in its own world; a book row's in the one world of the user's that holds the key.
  const lists = db.query<{ rowid: number; user: string; world: string; related: string | null; own_related: string | null }, []>("SELECT rowid, user, world, related, own_related FROM lore_index WHERE instr(related, '\"w-') > 0 OR instr(own_related, '\"w-') > 0 ORDER BY rowid").all();
  const worldsOf = db.query<{ world: string }, [string, string]>("SELECT world FROM lore_world_number WHERE user = ? AND key = ?");
  for (const row of lists) {
    const resolve = (key: string): number | null => {
      if (row.world !== "") return numberOf(row.user, row.world, key);
      const worlds = worldsOf.all(row.user, key);
      return worlds.length === 1 && worlds[0] !== undefined ? (worldNumbersIn(db, row.user, worlds[0].world, [key]).get(key) ?? null) : null;
    };
    const rewritten = (raw: string | null): string | null => {
      if (raw === null) return null;
      let list: unknown;
      try {
        list = JSON.parse(raw);
      } catch {
        return raw;
      }
      if (!Array.isArray(list)) return raw;
      return JSON.stringify(
        list.map((id: unknown) => {
          const key = typeof id === "string" ? keyOf(id) : null;
          const n = key === null ? null : resolve(key);
          return n === null ? id : worldEntryId(n);
        }),
      );
    };
    db.run("UPDATE lore_index SET related = ?, own_related = ? WHERE rowid = ?", [rewritten(row.related), rewritten(row.own_related), row.rowid]);
  }
}
