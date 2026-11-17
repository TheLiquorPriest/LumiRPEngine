// Build's own tables (plan §14, "What happens to today's UI": Build mode is kept, on RPE's typed routes), as steps for the application's
// migration runner (its area `build`). Every table carries the user. His worlds are kept once, in the store's `world_part`.
//
//   build_job   each job Build ran or runs, with its status, progress, input and result (`jobs/schema.ts`)
//   build_secrecy  each book a secrecy move was made on, with every move of it for Restore (`lore/schema.ts`)
//   build_lore_index  the lore index entry Build wrote of each world, at its revision, with its text's hash (`lore/schema.ts`)
//
// Steps 1 and 5 made and then dropped the tables of the worlds as an earlier build of Build kept them (`build_file`, and `build_seed`,
// what a migration run put there): the store's step 13, which runs before Build's in every open, moved their content into `world_part`.

import type { Migration } from "../app/migrations";
import { JOB_MIGRATION } from "./jobs/schema";
import { INDEX_ENTRY_MIGRATION, SECRECY_MIGRATION } from "./lore/schema";

export const BUILD_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "the worlds as Build keeps them",
    sql: `CREATE TABLE build_file (
  user TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (user, path)
) WITHOUT ROWID;
CREATE TABLE build_seed (
  user TEXT NOT NULL,
  world TEXT NOT NULL,
  files TEXT NOT NULL,
  run TEXT NOT NULL,
  PRIMARY KEY (user, world)
) WITHOUT ROWID`,
  },
  JOB_MIGRATION,
  SECRECY_MIGRATION,
  INDEX_ENTRY_MIGRATION,
  {
    version: 5,
    name: "the worlds kept once: Build's own copies go",
    sql: `DROP TABLE IF EXISTS build_file;
DROP TABLE IF EXISTS build_seed`,
  },
];
