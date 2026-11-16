// Build's registration with the application (plan §4.1): its tables, its page's route (today's messages, until the last package of
// Build deletes it) and the typed routes of his worlds (`worlds-routes.ts`). His worlds are the worlds area's (`src/worlds/area.ts`):
// Build takes the world service it hands out and writes no world file of its own.

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

/** What Build takes from the composition: the store a chat's revision is read from, the world service, and the guidance folder whose answers word what Build does not do. */
export type BuildTakes = Pick<BuildDeps, "store" | "worlds" | "guidance">;

/** `takes` is asked once the turn lane is mounted, whose store Build serves over: the routes are made then. */
export function buildArea(takes: () => BuildTakes): Area {
  let jobs: JobHome | null = null;
  return {
    name: "build",
    tables: [{ area: "build", migrations: BUILD_MIGRATIONS }],
    settings: JOB_SETTINGS,
    liveKinds: [JOB_KIND],
    mounted: async (at) => {
      const deps = takes();
      at.routes.add("build", buildRoutes(new BuildService({ writes: at.writes, log: at.log, ...deps })));
      at.routes.add("worlds", [...worldsRoutes(deps.worlds, (await worldLimitsOf(at)).bodyBytes), ...chatsRoutes(deps.worlds)]);
      jobs = await mountJobs(at, { store: deps.store, worlds: deps.worlds });
    },
    stopping: () => jobs?.stop(),
  };
}
