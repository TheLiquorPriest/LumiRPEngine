// The `service` group's routes of the application's own (plan §4.4): how RPE's service stands. Those a
// page reads are the app's (`appRoutes`); these are the owner's command line's, answered on its socket
// alone, and the extension's.

import { COMMAND_PATHS } from "./command-routes";
import { route, shape } from "./routes";
import type { Builds } from "./update";

/** Where the extension says a new app file has arrived (the extension's road, open to the extension's key alone). */
export const ARRIVED_PATH = "/api/v1/ext/arrived";

/** What the service's routes need of the app. */
export interface ServiceDeps {
  builds: Builds;
}

export function serviceRoutes({ builds }: ServiceDeps) {
  return [
    route({
      method: "POST",
      path: ARRIVED_PATH,
      access: "extension",
      group: "service",
      does: "The extension's word that a new app file has arrived, with the hash stated for it: RPE reads the source it was set up from, takes the build only when every file matches, starts it for real, and swaps onto it once no turn or job runs. A word with no stated hash is not taken.",
      body: shape.object({ hash: shape.optional(shape.text(), "The hash stated for the new app file, as the build states it (the hash of its statement of its files).") }),
      reply: shape.named("Arrived", "Whether RPE took the build, and where it stands, in words.", shape.object({ taken: shape.field(shape.yesNo(), "Whether RPE took the build: every file matched, and it started."), words: shape.field(shape.text(), "Where the builds stand, in a sentence or two, with why a build was not taken.") })),
      handle: ({ body }) => builds.arrived(body.hash ?? null),
    }),
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
