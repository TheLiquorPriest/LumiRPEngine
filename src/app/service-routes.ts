// The `service` group's routes of the application's own (plan §4.4): how RPE's service stands. Those a
// page reads are the app's (`appRoutes`); these are the owner's command line's, answered on its socket
// alone, and the extension's.

import { COMMAND_PATHS } from "./command-routes";
import { route, shape } from "./routes";
import type { Builds } from "./update";

/** What the service's routes need of the app. */
export interface ServiceDeps {
  builds: Builds;
}

export function serviceRoutes({ builds }: ServiceDeps) {
  return [
    route({
      method: "GET",
      path: COMMAND_PATHS.busy,
      access: "command",
      group: "service",
      does: "How many turns and jobs run now: what a later `rpe up` waits to be none before it restarts RPE's service.",
      reply: shape.named("Busy", "The turns and jobs running now.", shape.object({ busy: shape.field(shape.number(), "How many turns and jobs run now.") })),
      handle: async () => ({ busy: await builds.busy() }),
    }),
  ] as const;
}
