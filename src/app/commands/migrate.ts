// `rpe migrate`: the migration's own command line, into RPE's data folder.

import { resolve } from "node:path";
import { migrateCli } from "../../migrate/cli";
import type { CliIO } from "../cli";
import { dataPaths, defaultDataFolder, loadConfig } from "../config";
import { rpeServiceOf } from "../up";
import { serverAnswer, serverUrl } from "./running";
import { treeLayout } from "./tree-layout";

/**
 * `rpe migrate`: the migration's own command line (src/migrate/cli.ts), into RPE's data folder unless
 * the line names another; the user's own files into the folders the file tree's layout gives them,
 * each chat's notes into that chat's own folder, placed as the tree places a chat. A real run is the
 * data folder's one writer: while RPE answers at the address the folder's config gives it, it is
 * refused, as the swap refuses a running RPE, since the running server would keep its own copy of
 * the secrets and write it over what the run carried, and go on serving the chats the run replaces.
 */
export async function migrateCommand(rest: readonly string[], io: CliIO, version: string): Promise<number> {
  const line = rest.includes("--data") ? rest : [...rest, "--data", defaultDataFolder(io.env, io.home)];
  const folder = line[line.indexOf("--data") + 1];
  if (!rest.includes("--rehearse") && folder !== undefined && !folder.startsWith("--")) {
    const paths = dataPaths(folder);
    const config = await loadConfig(paths, io.env);
    const answer = await serverAnswer(config, io);
    if (answer !== null && "rpe" in answer) {
      const service = await rpeServiceOf(resolve(paths.root), io.env, io.home);
      io.err(`RPE is running at ${serverUrl(config)}, the address this data folder's config gives it: stop it (${service === null ? "rpe serve" : `systemctl --user stop ${service.unit}`}), then run rpe migrate again${service === null ? "" : `, and start it again after (systemctl --user start ${service.unit})`}. Nothing was read or changed.`);
      return 1;
    }
  }
  // Its output is whole texts, this one's lines; and it reads the build's id from the environment, where a built `rpe` does not put it.
  return await migrateCli(line, { out: (text) => io.out(text.replace(/\n$/, "")), err: io.err, env: { ...io.env, LRE_BUILD_ID: version }, home: io.home }, treeLayout());
}
