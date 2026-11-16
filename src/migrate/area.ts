// The migration's registration with the application (plan §4.1): its tables, its setting and its page's routes, with the
// page's rehearsals held in memory for as long as RPE runs, and the presses of what waits on him.

import type { Area } from "../app";
import { createRegistry } from "../engine/registry-impl";
import { ALL_PACKS } from "../packs/index";
import type { Store } from "../store";
import { rehearsal } from "./migrate";
import { Rehearsals } from "./rehearse-job";
import { migrateRoutes, type MigrateRoutesDeps } from "./routes";
import { MIGRATE_SETTINGS } from "./setting-list";
import { MIGRATE_TABLES } from "./tables";

/**
 * What the migration takes from the composition: the extension's identifier, which the Migration page names; the file tree's
 * writer as him at the global level (`OwnFiles.writeAsUser`, which the migration may not import), which one press uses to switch
 * an attached file on: `text` written at `path` below the global level, the path written answered; and RPE's store, where his
 * answer to a paused chat lands the held turns' changes.
 */
export type MigrateTakes = Pick<MigrateRoutesDeps, "identifier"> & { writeAsUser?(user: string, path: string, text: string): Promise<string>; store?(): Store };

export function migrateArea(takes: MigrateTakes): Area {
  return {
    name: "migrate",
    tables: [{ area: "migrate", migrations: MIGRATE_TABLES }],
    settings: MIGRATE_SETTINGS,
    mount: (at) => {
      // A rehearsal from the page reads today's data and RPE's database through the running RPE's own connection, and writes nothing.
      const rehearsals = new Rehearsals((sources) => rehearsal(sources, { data: at.paths.root, db: at.db, owner: at.config.lumiverse.user, now: () => new Date(at.now()) }), at.now);
      const registry = createRegistry(ALL_PACKS);
      at.routes.add(
        "migration",
        migrateRoutes({
          db: at.db,
          identifier: takes.identifier,
          paths: at.paths,
          config: at.config,
          rehearsals,
          presses: {
            now: at.now,
            write: (work, label) => at.writes.run(() => work(), label),
            registry,
            ...(takes.store === undefined ? {} : { store: takes.store }),
            ...(takes.writeAsUser === undefined ? {} : { writeAsUser: takes.writeAsUser }),
          },
        }),
      );
    },
  };
}
