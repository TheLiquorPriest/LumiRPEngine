// Build's registration with the application (plan §4.1): its tables and its page's route, and its world store handed out once mounted.

import type { Area } from "../app";
import type { WorldStore } from "../worlds/worlds";
import { buildRoutes } from "./routes";
import { BUILD_MIGRATIONS } from "./schema";
import { BuildService, type BuildDeps } from "./serve";

/** What Build takes from the composition: the store a committed revision is kept in, and the guidance folder whose answers word what Build does not do. */
export type BuildTakes = Pick<BuildDeps, "store" | "guidance">;

export interface BuildArea extends Area {
  /** Build's world store, the one write path to his worlds (a world entry's lore proposal is approved through it); null before the area is mounted. */
  worlds(): WorldStore | null;
}

/** `takes` is asked once the turn lane is mounted, whose store Build serves over: the route is made then. */
export function buildArea(takes: () => BuildTakes): BuildArea {
  let service: BuildService | null = null;
  return {
    name: "build",
    tables: [{ area: "build", migrations: BUILD_MIGRATIONS }],
    mounted: (at) => {
      service = new BuildService({ db: at.db, writes: at.writes, log: at.log, ...takes() });
      at.routes.add("build", buildRoutes(service));
    },
    worlds: () => service?.worlds ?? null,
  };
}
