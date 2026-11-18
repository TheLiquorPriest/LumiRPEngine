// Taking on a story with a past: its registration with the application (plan §4.1): its settings,
// its routes, and the views its job's agents are given by name.

import type { App, Area } from "../../app";
import type { Turns } from "../lane";
import { globalConfig, TURN_DEFAULTS, TURN_SETTINGS } from "../settings";
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
    // A bootstrap job's views are a chat's: a job of no chat is given none of them.
    fills: { views: (scope, agent, ref) => (scope.chat === undefined ? Promise.resolve(null) : jobs.view(scope, agent, ref)) },
    mounted: (at) =>
      at.routes.add(
        "bootstrap",
        bootstrapRoutes({
          jobs,
          carried: (user) => takes.carried(at, user),
          // The lists page as the turn area's do, by its page settings in the levels every chat shares.
          sizes: () => {
            const read = globalConfig(at.paths.files, at.log);
            const value = (key: string, fallback: number): number => {
              const def = TURN_SETTINGS.find((s) => s.key === key);
              const v = def === undefined ? fallback : read.value(def);
              return typeof v === "number" ? v : fallback;
            };
            return { default: value("turns.page", TURN_DEFAULTS.turnsPage.size), most: value("turns.maxPage", TURN_DEFAULTS.turnsPage.most) };
          },
        }),
      ),
  };
}
