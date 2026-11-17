// The secrecy page's undo copies (plan §14, §15.2; PlanChatUI-B3): one row for each book a move was made on, holding every move of it, oldest first,
// as `secrecy/<hash>.json` held them in today's storage. Every row carries the user.

import type { Migration } from "../../app/migrations";

export const SECRECY_MIGRATION: Migration = {
  version: 3,
  name: "the secrecy page's undo copies",
  sql: `CREATE TABLE build_secrecy (
  user TEXT NOT NULL,
  book TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (user, book)
) WITHOUT ROWID`,
};

// The entry Build wrote of a world's lore index (PlanChatUI-B3 item 4): one row a world, with the entry, the revision Build left it at and a
// hash of the text it wrote, so Build says when the index has changed since, and a write again names that revision.
export const INDEX_ENTRY_MIGRATION: Migration = {
  version: 4,
  name: "the lore index entry Build wrote of each world",
  sql: `CREATE TABLE build_lore_index (
  user TEXT NOT NULL,
  world TEXT NOT NULL,
  book TEXT NOT NULL,
  entry TEXT NOT NULL,
  revision INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (user, world)
) WITHOUT ROWID`,
};
