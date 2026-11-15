// Taking on a story with a past: its registration with the application (plan §4.1): its settings,
// its routes, and the views its job's agents are given by name.

import type { App, Area } from "../../app";
import type { Turns } from "../lane";
import { BootstrapJobs } from "./jobs";
import { bootstrapRoutes } from "./routes";
import { BOOTSTRAP_SETTINGS } from "./settings";

/** What bootstrap takes from the composition. */
export interface BootstrapTakes {
  /** The turn lane and the harness, once mounted. */
  turns(): Turns;
  /** The chats the last migration carried for the user (imported, or imported again), by id: the ones the Migration page offers a bootstrap for. */
  carried(app: App, user: string): Promise<readonly string[]>;
}

export function bootstrapArea(takes: BootstrapTakes): Area {
  const jobs = new BootstrapJobs({ turns: takes.turns });
  return {
    name: "bootstrap",
    settings: BOOTSTRAP_SETTINGS,
    fills: { views: (scope, agent, ref) => jobs.view(scope, agent, ref) },
    mounted: (at) => at.routes.add("bootstrap", bootstrapRoutes({ jobs, carried: (user) => takes.carried(at, user) })),
  };
}
