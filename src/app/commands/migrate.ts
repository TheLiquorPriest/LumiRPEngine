// `rpe migrate`: the migration's own command line, into RPE's data folder.

import { resolve } from "node:path";
import { installHistoryLines, shippedTexts } from "../../iface";
import { migrateCli } from "../../migrate/cli";
import { carryJob, HARNESS_MIGRATIONS, keepCarriedRun } from "../../turn";
import type { CliIO } from "../cli";
import { compose } from "../compose";
import { dataPaths, defaultDataFolder, loadConfig } from "../config";
import { gatherSettings } from "../hooks";
import { rpeServiceOf } from "../up";
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
  const line = rest.includes("--data") ? rest : [...rest, "--data", defaultDataFolder(io.env, io.home)];
  const folder = line[line.indexOf("--data") + 1];
  // Its output is whole texts, this one's lines; and it reads the build's id from the environment, where a built `rpe` does not put it.
  // Each carried setting is checked as the reader of its own key takes it: against the registry of every area's list, which reaches no Lumiverse.
  const noLumiverse = (): never => {
    throw new Error("The migration reaches no Lumiverse, and an area asked for it while its settings were listed.");
  };
  const registry = () => gatherSettings(compose({ fetch: async () => noLumiverse(), open: noLumiverse, sleep: async () => noLumiverse() }).areas);
  // The migration runs the engine here, on this process's one thread, with no server to read the user's files through: it says the shipped lines, which the main thread and each worker read by the same loader.
  const migrate = async (): Promise<number> => {
    await installHistoryLines(shippedTexts());
    // The turn lane's writer of a carried turn's run record, handed in: the migration may not import the turn lane.
    return await migrateCli(line, { out: (text) => io.out(text.replace(/\n$/, "")), err: io.err, env: { ...io.env, LRE_BUILD_ID: version }, home: io.home }, treeLayout(), registry(), { tables: { area: "harness", migrations: HARNESS_MIGRATIONS }, keep: keepCarriedRun, keepJob: carryJob });
  };
  if (rest.includes("--rehearse") || folder === undefined || folder.startsWith("--")) return await migrate();
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
