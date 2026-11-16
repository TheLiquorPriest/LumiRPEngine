// The migration's registration with the application (plan §4.1): its tables, its setting and its page's routes, with the
// page's rehearsals held in memory for as long as RPE runs.

import type { Area } from "../app";
import { rehearsal } from "./migrate";
import { Rehearsals } from "./rehearse-job";
import { migrateRoutes, type MigrateRoutesDeps } from "./routes";
import { MIGRATE_SETTINGS } from "./setting-list";
import { MIGRATE_TABLES } from "./tables";

/**
 * What the migration takes from the composition: the extension's identifier, which the Migration page names; and the file tree's
 * writer as him at the global level (`OwnFiles.writeAsUser`, which the migration may not import), which one press uses to switch
 * an attached file on: `text` written at `path` below the global level, the path written answered.
 */
export type MigrateTakes = Pick<MigrateRoutesDeps, "identifier"> & { writeAsUser?(user: string, path: string, text: string): Promise<string> };

export function migrateArea(takes: MigrateTakes): Area {
  return {
    name: "migrate",
    tables: [{ area: "migrate", migrations: MIGRATE_TABLES }],
    settings: MIGRATE_SETTINGS,
    mount: (at) => {
      // A rehearsal from the page reads today's data and RPE's database through the running RPE's own connection, and writes nothing.
      const rehearsals = new Rehearsals((sources) => rehearsal(sources, { data: at.paths.root, db: at.db, owner: at.config.lumiverse.user, now: () => new Date(at.now()) }), at.now);
      at.routes.add("migration", migrateRoutes({ db: at.db, identifier: takes.identifier, paths: at.paths, config: at.config, rehearsals }));
    },
  };
}
