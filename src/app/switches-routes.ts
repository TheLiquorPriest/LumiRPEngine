// What the registry of switches lists for the page's own user (plan §16): every thing that waits, is on or is off,
// with what it runs, calls or would send a key to. A page only reads it: no route switches anything, and only
// `rpe allow` and `rpe deny` on the server do (`switches.ts`).

import type { Database } from "bun:sqlite";
import { switchEntry } from "./command-routes";
import { route, shape } from "./routes";
import { listSwitches } from "./switches";

export const SWITCHES_PATH = "/api/v1/switches";

export function switchesRoutes(db: Database) {
  return [
    route({
      method: "GET",
      path: SWITCHES_PATH,
      access: "page",
      group: "service",
      does: "Every thing that runs a command or calls out that the page's own user has listed, and whether it waits, is on or is off, with what it runs or calls, or the address its connection's key would go to. Only rpe allow and rpe deny on the server switch one; no page can.",
      reply: shape.named("SwitchesShown", "The page user's own switches, each name's newest definition.", shape.object({ switches: shape.field(shape.list(switchEntry), "Each of the user's things and where it stands.") })),
      handle: ({ auth }) => ({ switches: listSwitches(db, auth.user) }),
    }),
  ] as const;
}
