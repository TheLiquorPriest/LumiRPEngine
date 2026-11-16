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
