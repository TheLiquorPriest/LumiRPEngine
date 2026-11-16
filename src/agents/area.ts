// The agents' registration with the application (plan §4.1): their routes, over RPH's definitions, which the turn lane's harness holds.

import type { Area } from "../app";
import { agentsRoutes, type AgentsRoutesDeps } from "./routes";

/** `takes` is asked once the turn lane is mounted: the routes are made then. */
export function agentsArea(takes: () => AgentsRoutesDeps): Area {
  return {
    name: "agents",
    mounted: (at) => {
      at.routes.add("agents", agentsRoutes(takes()));
    },
  };
}
