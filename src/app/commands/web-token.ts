// The web token `rpe up` prints once, at the install (plan §4.4 "a token printed at install"; READINGS R-8).

import type { AppConfig } from "../config";
import { runLine } from "./run-line";
import { serverUrl } from "./running";
import { atWords } from "./words";
import { withWriter, type WriterContext } from "./writer";

/**
 * Makes the web app's token where RPE holds none and prints it, this once, with its end as
 * `auth.webKeyDays` sets it or that it has none; where one was made before, prints none and says how
 * to make a new one.
 */
export async function webToken(ctx: WriterContext, current: AppConfig): Promise<void> {
  const { io, paths } = ctx;
  const made = await withWriter(
    { ...ctx, config: current },
    async (ops) => {
      if ((await ops.status()).keys.some((k) => k.kind === "web")) return null;
      return await ops.makeKey({ kind: "web" });
    },
    { forUser: true },
  );
  const again = runLine(io, paths, "key", "web");
  if (made === null) {
    io.out(`The web app's token was shown at the first rpe up and is not shown again. A new one, which replaces it: ${again}`);
    return;
  }
  io.out("");
  io.out("The token for RPE's web app, shown this once (RPE keeps only its hash):");
  io.out("");
  io.out(`  ${made.key}`);
  io.out("");
  io.out(`Open ${serverUrl(current)}/ui/ and give it. ${made.ends === null ? "It has no end: it works until a new one replaces it (auth.webKeyDays gives it one)." : `It works until ${atWords(made.ends)}.`} A new one, which replaces it: ${again}`);
}
