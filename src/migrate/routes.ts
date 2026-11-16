// The Migration page's routes (plan §14, §15.5, §15.6): what the last run reported and its printed
// text, each chat's check, the backup, what waits on the user, and the steps of going back; and, for
// a migrated chat, its carried turns with what each old engine recorded of the reply. Each a page's
// route, and a read: it changes nothing, and it reads RPE's own database only.

import type { Database } from "bun:sqlite";
import { route, RouteError, shape } from "../app";
import { oldRecord, oldRecords } from "./old-records";
import { migrationPage } from "./page";
import { carriedPage } from "./setting-list";
import { carriedTurnReply, carriedTurnsReply, type MigrationShown, migrationReply } from "./shapes";

export interface MigrateRoutesDeps {
  /** RPE's database. */
  db: Database;
  /** The extension's identifier in Lumiverse, which the steps of going back name. */
  identifier: string;
  /** RPE's `RPE-global.yml`, where the page sizes of the carried turns' list are set. */
  globalConfig: string;
}

export const MIGRATION_PATH = "/api/v1/migration";

/** The migration's routes: the page's, and the carried turns' of a chat. */
export function migrateRoutes(deps: MigrateRoutesDeps) {
  return [
    route({
      method: "GET",
      path: MIGRATION_PATH,
      access: "page",
      group: "migration",
      does: "The Migration page's data: the last run's report and its printed text, each chat's check, the backup, what waits on the user, and the steps of going back.",
      reply: migrationReply,
      // The report, what was carried of each chat and what was put in Lumiverse are documents the migration kept as JSON; they are carried as they are.
      handle: ({ user }) => migrationPage({ db: deps.db, user, identifier: deps.identifier }) as unknown as MigrationShown,
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/carried",
      access: "page",
      group: "migration",
      does: "A migrated chat's carried turns, in the order the run imported them, each tied to its message and swipe, with the engine that played it, why it stood with no turn played, and how many departures and texts of the old engine it holds. `from` is how many to pass over; `limit` how many to give (the setting `migration.page` when left out, at most `migration.pageMost`).",
      query: {
        from: shape.optional(shape.whole({ least: 0 }), "How many carried turns to pass over; none when left out."),
        limit: shape.optional(shape.whole({ least: 1 }), "How many carried turns to give: the setting `migration.page` when left out, and at most `migration.pageMost`."),
      },
      reply: carriedTurnsReply,
      handle: async ({ user, params, query }) => {
        const page = await carriedPage(deps.globalConfig);
        const from = query.from ?? 0;
        const read = oldRecords(deps.db, user, params.chat, { from, limit: Math.min(query.limit ?? page.size, page.most) });
        return { ...read, more: from + read.turns.length < read.total };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/carried",
      access: "page",
      group: "migration",
      does: "What an old engine recorded on a reply the migration carried, for the reply's Turn page: the engine that played the chat, each part of the record by name, every text it names word for word, why the reply stood with no turn played, and each line where it says something against its turn.",
      reply: carriedTurnReply,
      joined: true,
      handle: ({ user, params }) => {
        const found = oldRecord(deps.db, user, params.turn);
        if (found === null || found.chat !== params.chat) throw new RouteError(404, `Turn ${params.turn} of chat ${params.chat} is not one a migration carried.`);
        return found;
      },
    }),
  ] as const;
}
