// Build's registration with the application (plan §4.1): its tables, its page's route (today's messages, until the last package of
// Build deletes it), the typed routes of his worlds (`worlds-routes.ts`), his jobs (`jobs/`) and his lore and secrecy tools (`lore/`). His worlds
// are the worlds area's (`src/worlds/area.ts`): Build takes the world service it hands out and writes no world file of its own. Its model jobs
// run as RPH jobs of no chat (`jobs/model.ts`): what their agents are given by name and the tools they hold are this area's fills.

import type { FilesPort, JobsApi } from "rp-harness/contract";
import type { Area } from "../app";
import type { WorldDoc } from "../shared/world";
import { worldLimitsOf } from "../worlds/area";
import { chatsRoutes } from "./chats-routes";
import { buildRoutes } from "./routes";
import { BUILD_MIGRATIONS } from "./schema";
import { BuildService, type BuildDeps } from "./serve";
import { worldsRoutes } from "./worlds-routes";
import { JOB_KIND, jobLimitsOf, mountJobs } from "./jobs/area";
import type { JobHome } from "./jobs/home";
import { JOB_SETTINGS } from "./jobs/limits";
import { ModelJobs } from "./jobs/model";
import type { BuildBooks, BuildWrites } from "./lore/books";
import { IndexEntries, type WorldIndex } from "./lore/index-entry";
import { loreRoutes } from "./lore/routes";
import { type ChatMessage, BuildLore } from "./lore/service";

/**
 * What Build takes of his books from the composition: his books read through the door, the lore's one recorded writer, a chat's messages,
 * and the lore's index of the books a world reads.
 */
export interface BuildLoreTakes {
  books: BuildBooks;
  writes: BuildWrites;
  messages(user: string, chat: string): Promise<ChatMessage[]>;
  index(user: string, world: WorldDoc): Promise<WorldIndex>;
}

/**
 * What Build takes from the composition: the store a chat's revision is read from, the world service, the guidance folder whose answers word
 * what Build does not do, his books, and RPH's jobs and files, which its model jobs run on.
 */
export type BuildTakes = Pick<BuildDeps, "store" | "worlds" | "guidance"> & { lore: BuildLoreTakes; rph: { jobs: JobsApi; files: FilesPort } };

/** `takes` is asked once the turn lane is mounted, whose store Build serves over: the routes are made then. */
export function buildArea(takes: () => BuildTakes): Area {
  let jobs: JobHome | null = null;
  let models: ModelJobs | null = null;
  return {
    name: "build",
    tables: [{ area: "build", migrations: BUILD_MIGRATIONS }],
    settings: JOB_SETTINGS,
    liveKinds: [JOB_KIND],
    // A model job's input by name, and the tools its agent holds, once the area is mounted.
    fills: {
      views: async (scope, agent, ref) => (models === null ? null : await models.views(scope, agent, ref)),
      jobTools: async (scope) => (models === null ? [] : await models.tools(scope)),
    },
    mounted: async (at) => {
      const { lore, rph, ...deps } = takes();
      at.routes.add("build", buildRoutes(new BuildService({ writes: at.writes, log: at.log, ...deps })));
      at.routes.add("worlds", [...worldsRoutes(deps.worlds, (await worldLimitsOf(at)).bodyBytes), ...chatsRoutes(deps.worlds)]);
      at.routes.add("lore", loreRoutes(new BuildLore({ ...lore, worlds: deps.worlds, store: deps.store, db: at.db, queue: at.writes, log: at.log }), new IndexEntries({ db: at.db, queue: at.writes, worlds: deps.worlds, books: lore.books, writes: lore.writes, index: lore.index })));
      models = new ModelJobs({ rph, worlds: deps.worlds, books: lore.books, log: at.log, limits: () => jobLimitsOf(at) });
      jobs = await mountJobs(at, { store: deps.store, worlds: deps.worlds, more: models.runners() });
    },
    stopping: () => jobs?.stop(),
  };
}
