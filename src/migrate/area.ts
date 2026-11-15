// The migration's registration with the application (plan §4.1): its tables and its page's route.

import type { Area } from "../app";
import { migrateRoutes, type MigrateRoutesDeps } from "./routes";
import { MIGRATE_TABLES } from "./tables";

/** What the migration takes from the composition: the extension's identifier, which the Migration page names. */
export type MigrateTakes = Pick<MigrateRoutesDeps, "identifier">;

export function migrateArea(takes: MigrateTakes): Area {
  return {
    name: "migrate",
    tables: [{ area: "migrate", migrations: MIGRATE_TABLES }],
    mount: (at) => at.routes.add("migration", migrateRoutes({ db: at.db, identifier: takes.identifier })),
  };
}
