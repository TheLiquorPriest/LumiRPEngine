// `rpe down`: stops and removes RPE's service, leaves the data where it is, takes RPE's mark off each
// connection the swap took, and says everything going back needs.

import { resolve } from "node:path";
import { type LumiverseCall, markConnection, TODAYS_MODEL } from "../../adapter/lumiverse/install-calls";
import { EXTENSION_IDENTIFIER } from "../../adapter/lumiverse/pipe-wire";
import { type ChatNow, goingBack, goingBackFacts, lastSwap, previousBranch, readRpe } from "../../migrate/going-back";
import { LumiverseDb } from "../../migrate/lumiverse-db";
import { type AppConfig, type DataPaths, dataPaths, defaultDataFolder, loadConfig } from "../config";
import type { CliIO } from "../cli";
import { accountSystemctl, removeRpeService, rpeServiceOf } from "../up";
import { parseArgs, UsageError } from "./args";
import { keptSession, keptUsername } from "./sign-in";

/**
 * Takes RPE's mark off each connection in Lumiverse the swap took (PlanSwap-11 wrote it), through the
 * kept sign-in, changing nothing else of it, so each is as it was before the swap; says what it could
 * not take off, and why.
 */
async function unmark(ids: readonly string[], paths: DataPaths, config: AppConfig, io: CliIO): Promise<void> {
  const url = config.lumiverse.url;
  const username = url === null ? null : await keptUsername(url, paths, config);
  const session = url === null || username === null ? null : await keptSession(url, username, paths, config, io).catch(() => null);
  if (session === null) {
    io.out(`RPE's mark stays on ${ids.join(", ")} in Lumiverse: rpe down holds no sign-in to Lumiverse that it still takes. The mark is RPE's alone, in each connection's metadata; run rpe down again once rpe up has signed in, or leave it.`);
    return;
  }
  const call: LumiverseCall = (method, path, body) => session.request(method, path, body);
  for (const id of ids) {
    try {
      if (await markConnection(call, id, false)) io.out(`Took RPE's mark off the connection ${id} in Lumiverse: nothing else of it was changed, and it is as it was before the swap.`);
    } catch (error) {
      io.out(`RPE's mark stays on the connection ${id} in Lumiverse: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
}

/**
 * `rpe down` (plan §15.6 step 1): stops and removes RPE's service for its data folder, and leaves the
 * data where it is; takes RPE's mark off each connection the swap took; then the steps of going back,
 * with the identifier the swap used, the configured branch, the runtime the last run took the place
 * of, and what changed since the swap: each chat moved onto RPE's connections, RPE's own earlier
 * connection, a key to put back, and RPE's own connection where RPE answered on one.
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
  const branch = await previousBranch(paths.globalConfig);
  // RPE answers to today's model name once the swap took today's connection over; else the connection its config names is its own.
  const own = config.lumiverse.models.some((m) => TODAYS_MODEL.test(m)) ? null : (config.lumiverse.connections[0] ?? null);
  const swap = user === null ? null : readRpe(paths.database, (db) => lastSwap(db, user));
  // Each chat as Lumiverse holds it now, where the swap read it: those moved onto RPE's connections since are named.
  let chats: ChatNow[] | null = null;
  if (swap !== null && user !== null) {
    try {
      const lumiverse = LumiverseDb.open(swap.lumiverse, user);
      try {
        chats = lumiverse.chats();
      } finally {
        lumiverse.close();
      }
    } catch (error) {
      io.out(`Lumiverse's chats could not be read at ${swap.lumiverse} (${error instanceof Error ? error.message : String(error)}): the chats moved onto RPE's connections since the swap are not named below.`);
    }
  }
  if (swap !== null && swap.taken.length > 0) await unmark(swap.taken, paths, config, io);
  const facts = (user === null ? null : readRpe(paths.database, (db) => goingBackFacts(db, user, { identifier: EXTENSION_IDENTIFIER, branch, rpe: config.lumiverse.connections, own, chats }))) ?? { identifier: EXTENSION_IDENTIFIER, runtime: null, branch, own };
  io.out("");
  for (const line of goingBack(facts)) io.out(line);
  return 0;
}
