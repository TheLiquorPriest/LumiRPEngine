// The Migration page's route (plan §14, §15.5, §15.6): what the last run reported and its printed
// text, each chat's check, the backup, what waits on the user, and the steps of going back. A page's
// route, and a read: it changes nothing, and it reads RPE's own database only.

import type { Database } from "bun:sqlite";
import { route } from "../app";
import { migrationPage } from "./page";

export interface MigrateRoutesDeps {
  /** RPE's database. */
  db: Database;
  /** The extension's identifier in Lumiverse, which the steps of going back name. */
  identifier: string;
}

export const MIGRATION_PATH = "/api/v1/migration";

/** The migration's routes: one, for the page. */
export function migrateRoutes(deps: MigrateRoutesDeps) {
  return [
    route({
      method: "GET",
      path: MIGRATION_PATH,
      access: "page",
      handle: ({ user }) => migrationPage({ db: deps.db, user, identifier: deps.identifier }),
    }),
  ];
}
