// Build's registration with the application (plan §4.1): its tables and its page's route.

import type { Area } from "../app";
import { buildRoutes } from "./routes";
import { BUILD_MIGRATIONS } from "./schema";
import { BuildService, type BuildDeps } from "./serve";

/** What Build takes from the composition: the store a committed revision is kept in, and the guidance folder whose answers word what Build does not do. */
export type BuildTakes = Pick<BuildDeps, "store" | "guidance">;

/** `takes` is asked once the turn lane is mounted, whose store Build serves over: the route is made then. */
export function buildArea(takes: () => BuildTakes): Area {
  return {
    name: "build",
    tables: [{ area: "build", migrations: BUILD_MIGRATIONS }],
    mounted: (at) => at.routes.add("build", buildRoutes(new BuildService({ db: at.db, writes: at.writes, log: at.log, ...takes() }))),
  };
}
