// `rpe migrate`: the migration's own command line, into RPE's data folder.

import { resolve } from "node:path";
import { installHistoryLines, shippedTexts } from "../../iface";
import { migrateCli } from "../../migrate/cli";
import { shellWord } from "../../migrate/going-back";
import { carryJob, HARNESS_MIGRATIONS, keepCarriedRun } from "../../turn";
import type { CliIO } from "../cli";
import { compose } from "../compose";
import { dataPaths, defaultDataFolder, loadConfig } from "../config";
import { gatherSettings } from "../hooks";
import type { Setting } from "../setting-list";
import { rpeServiceOf } from "../up";
import { type Line, parseArgs, UsageError } from "./args";
import { runLine } from "./run-line";
import { serverAnswer, serverUrl } from "./running";
import { treeLayout } from "./tree-layout";
import { takeLock } from "./writer";

/**
 * `rpe migrate`: the migration's own command line (src/migrate/cli.ts), into RPE's data folder unless
 * the line names another; the user's own files into the folders the file tree's layout gives them,
 * each chat's notes into that chat's own folder, placed as the tree places a chat. A real run is the
 * data folder's one writer: while RPE answers at the address the folder's config gives it, it is
 * refused, as the swap refuses a running RPE, since the running server would keep its own copy of
 * the secrets and write it over what the run carried, and go on serving the chats the run replaces;
 * and it holds the data folder's lock for as long as it runs, as the server does.
 */
export async function migrateCommand(rest: readonly string[], io: CliIO, version: string): Promise<number> {
  // The line is read as every command's is. One that is not understood is the migration's to say, with its usage and the exit code 2: it reads the line again.
  let read: Line | null = null;
  try {
    read = parseArgs(rest, "migrate");
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
  }
  const folder = read?.flags.data ?? defaultDataFolder(io.env, io.home);
  const line = read?.flags.data === undefined ? [...rest, "--data", folder] : rest;
  // Its output is whole texts, this one's lines; and it reads the build's id from the environment, where a built `rpe` does not put it.
  // A chat it does not carry is said with the line that runs it again, as typed, and the line that goes back.
  const again = { again: [io.invoked ?? "rpe", ...["migrate", ...rest].map(shellWord)].join(" "), down: runLine(io, dataPaths(folder), "down") };
  const migrate = async (): Promise<number> => {
    const settings = await readyToMigrate();
    // The turn lane's writer of a carried turn's run record, handed in: the migration may not import the turn lane.
    return await migrateCli(line, { out: (text) => io.out(text.replace(/\n$/, "")), err: io.err, env: { ...io.env, LRE_BUILD_ID: version }, home: io.home }, treeLayout(), settings, { tables: { area: "harness", migrations: HARNESS_MIGRATIONS }, keep: keepCarriedRun, keepJob: carryJob }, again);
  };
  if (read === null || read.switches.has("rehearse")) return await migrate();
  const paths = dataPaths(folder);
  const config = await loadConfig(paths, io.env);
  const answer = await serverAnswer(config, io);
  if (answer !== null && "rpe" in answer) {
    const service = await rpeServiceOf(resolve(paths.root), io.env, io.home);
    io.err(`RPE is running at ${serverUrl(config)}, the address this data folder's config gives it: stop it (${service === null ? runLine(io, paths, "serve") : `systemctl --user stop ${service.unit}`}), then run ${runLine(io, paths, "migrate")} again${service === null ? "" : `, and start it again after (systemctl --user start ${service.unit})`}. Nothing was read or changed.`);
    return 1;
  }
  // The migration refuses an install that has named no user, writing nothing: no lock is made first, which would make the folder.
  if (config.lumiverse.user === null) return await migrate();
  const lock = await takeLock({ paths, config, io, version, what: "rpe migrate" });
  try {
    return await migrate();
  } finally {
    lock.release();
  }
}

/**
 * Readies this process for the migration, `rpe migrate`'s and the switch's (`rpe up`) alike, and gives back the registry of every
 * area's settings. The migration runs the engine here, on this process's one thread, with no server to read the user's files
 * through: it says the shipped lines, which the main thread and each worker read by the same loader, and with none every chat's
 * fold fails and no chat is carried. Each carried setting is checked as the reader of its own key takes it, against that
 * registry, which reaches no Lumiverse.
 */
export async function readyToMigrate(): Promise<Setting[]> {
  await installHistoryLines(shippedTexts());
  const noLumiverse = (): never => {
    throw new Error("The migration reaches no Lumiverse, and an area asked for it while its settings were listed.");
  };
  return gatherSettings(compose({ fetch: async () => noLumiverse(), open: noLumiverse, sleep: async () => noLumiverse() }).areas);
}
