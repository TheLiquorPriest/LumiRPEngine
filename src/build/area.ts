// Build's registration with the application (plan §4.1): its tables, its page's route (today's messages, until the last package of
// Build deletes it), the typed routes of his worlds (`worlds-routes.ts`), his jobs (`jobs/`) and his lore and secrecy tools (`lore/`). His worlds
// are the worlds area's (`src/worlds/area.ts`): Build takes the world service it hands out and writes no world file of its own.

import type { Area } from "../app";
import { worldLimitsOf } from "../worlds/area";
import { chatsRoutes } from "./chats-routes";
import { buildRoutes } from "./routes";
import { BUILD_MIGRATIONS } from "./schema";
import { BuildService, type BuildDeps } from "./serve";
import { worldsRoutes } from "./worlds-routes";
import { JOB_KIND, mountJobs } from "./jobs/area";
import type { JobHome } from "./jobs/home";
import { JOB_SETTINGS } from "./jobs/limits";
import type { BuildBooks, BuildWrites } from "./lore/books";
import { loreRoutes } from "./lore/routes";
import { type ChatMessage, BuildLore } from "./lore/service";

/** What Build takes of his books from the composition: his books read through the door, the lore's one recorded writer, and a chat's messages. */
export interface BuildLoreTakes {
  books: BuildBooks;
  writes: BuildWrites;
  messages(user: string, chat: string): Promise<ChatMessage[]>;
}

/** What Build takes from the composition: the store a chat's revision is read from, the world service, the guidance folder whose answers word what Build does not do, and his books. */
export type BuildTakes = Pick<BuildDeps, "store" | "worlds" | "guidance"> & { lore: BuildLoreTakes };

/** `takes` is asked once the turn lane is mounted, whose store Build serves over: the routes are made then. */
export function buildArea(takes: () => BuildTakes): Area {
  let jobs: JobHome | null = null;
  return {
    name: "build",
    tables: [{ area: "build", migrations: BUILD_MIGRATIONS }],
    settings: JOB_SETTINGS,
    liveKinds: [JOB_KIND],
    mounted: async (at) => {
      const { lore, ...deps } = takes();
      at.routes.add("build", buildRoutes(new BuildService({ writes: at.writes, log: at.log, ...deps })));
      at.routes.add("worlds", [...worldsRoutes(deps.worlds, (await worldLimitsOf(at)).bodyBytes), ...chatsRoutes(deps.worlds)]);
      at.routes.add("lore", loreRoutes(new BuildLore({ ...lore, worlds: deps.worlds, store: deps.store, db: at.db, queue: at.writes, log: at.log })));
      jobs = await mountJobs(at, { store: deps.store, worlds: deps.worlds });
    },
    stopping: () => jobs?.stop(),
  };
}
