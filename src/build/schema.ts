// Build's own tables (plan §14, "What happens to today's UI": Build mode is kept, and RPE serves its
// messages), as steps for the application's migration runner (its area `build`). Every table carries
// the user.
//
//   build_file  each file today's world store keeps, by its storage path: `worlds/<id>/index.json`,
//               `draft.json`, `history.json` and `rev/<hash>.json`, with what it writes on the way
//               (`<path>.tmp`, a damaged file set aside). The worlds as Build keeps them.
//   build_seed  each world a migration run put into `build_file`, with one fingerprint of its files
//               as that run put them, so a later run tells a copy changed in RPE from one it may
//               replace (`seed.ts`)
//   build_job   each job Build ran or runs, with its status, progress, input and result (`jobs/schema.ts`)
//   build_secrecy  each book a secrecy move was made on, with every move of it for Restore (`lore/schema.ts`)

import type { Migration } from "../app/migrations";
import { JOB_MIGRATION } from "./jobs/schema";
import { SECRECY_MIGRATION } from "./lore/schema";

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
];
