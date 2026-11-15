// `rpe down`: stops and removes RPE's service, and leaves the data where it is.

import { resolve } from "node:path";
import { EXTENSION_IDENTIFIER } from "../../adapter/lumiverse/pipe-wire";
import { goingBack } from "../../migrate/going-back";
import { earlierRuns } from "../../migrate/migrate";
import { dataPaths, defaultDataFolder, loadConfig } from "../config";
import type { CliIO } from "../cli";
import { accountSystemctl, removeRpeService, rpeServiceOf, TODAYS_MODEL } from "../up";
import { parseArgs, UsageError } from "./args";

/**
 * `rpe down` (plan §15.6 step 1): stops and removes RPE's service for its data folder, and leaves
 * the data where it is; then the steps of going back, with the runtime the last run took the place of,
 * and RPE's own connection in Lumiverse where RPE answered on one rather than on today's.
 */
export async function downCommand(argv: readonly string[], io: CliIO): Promise<number> {
  const { words, flags } = parseArgs(argv, ["data"]);
  if (words.length > 0) throw new UsageError("rpe down takes no words.");
  const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
  const config = await loadConfig(paths, io.env);
  const data = resolve(paths.root);
  const service = await rpeServiceOf(data, io.env, io.home);
  if (service === null) io.out(`RPE has no service for the data folder ${data}: nothing to stop.`);
  else {
    await removeRpeService(service, accountSystemctl(io.env, process.getuid?.() ?? null));
    io.out(`Stopped and removed ${service.unit}. RPE's data stays where it is, in ${data}.`);
  }
  const user = config.lumiverse.user;
  const taken = user === null ? null : (earlierRuns(paths.database, user).previous?.runtime?.taken ?? null);
  // RPE answers to today's model name once the swap took today's connection over; else the connection its config names is its own.
  const own = config.lumiverse.models.some((m) => TODAYS_MODEL.test(m)) ? null : config.lumiverse.connection;
  io.out("");
  for (const line of goingBack({ identifier: EXTENSION_IDENTIFIER, runtime: taken === null ? null : { name: taken.name, source: taken.source }, own })) io.out(line);
  return 0;
}
