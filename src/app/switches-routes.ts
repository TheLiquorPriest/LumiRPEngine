// What the registry of switches lists for the page's own user (plan §16): every thing that waits, is on or is off,
// with what it runs, calls or would send a key to. The files are looked at first, so a thing written in one (a page's save, or
// an editor on the server) is listed before the answer. A page only reads it: no route switches anything, and only
// `rpe allow` and `rpe deny` on the server do (`switches.ts`).

import type { Database } from "bun:sqlite";
import { switchEntry } from "./command-routes";
import { route, shape } from "./routes";
import { listSwitches, type NamedNow } from "./switches";

export const SWITCHES_PATH = "/api/v1/switches";

/** `look` lists what the user's files name that runs a command or calls out, as the files stand now, and says what they name (null: it could not tell, and everything the registry holds is listed). */
export function switchesRoutes(db: Database, look: () => Promise<NamedNow | null>) {
  return [
    route({
      method: "GET",
      path: SWITCHES_PATH,
      access: "page",
      group: "service",
      does: "Every thing that runs a command or calls out that the page's own user has listed and a file of theirs names now, and whether it waits, is on or is off, with what it runs or calls, or the address its connection's key would go to. A thing whose file is gone is not listed, and is there again, as it was switched, when a file names it again. Only rpe allow and rpe deny on the server switch one; no page can.",
      reply: shape.named("SwitchesShown", "The page user's own switches, each name's newest definition.", shape.object({ switches: shape.field(shape.list(switchEntry), "Each of the user's things and where it stands.") })),
      handle: async ({ auth }) => ({ switches: listSwitches(db, auth.user, await look()) }),
    }),
  ] as const;
}
