// The story record's table (plan §8.1, Appendix B "Story"), the application's `story` area. Every
// write the story lane takes is one row, tied to the turn that wrote it. A reading takes the rows of
// the turns on its path, so a swipe or a delete takes a turn's writes off the path with the turn,
// and showing that swipe again brings them back. A later write never changes a row: an item's
// history is its rows, in the order of the path.

import type { Migration } from "../app";

export const STORY_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "the story record",
    sql: `
CREATE TABLE story_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  ord INTEGER NOT NULL,
  part TEXT NOT NULL,
  item TEXT NOT NULL,
  value TEXT NOT NULL,
  by TEXT,
  agent TEXT,
  job TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX story_entry_turn ON story_entry (user, turn, ord);
`,
  },
];
