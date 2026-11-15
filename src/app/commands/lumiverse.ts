// `rpe lumiverse`: which Lumiverse this RPE belongs to, and its sign-in.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isRecord } from "../../shared/json";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { CONFIG_ENV, loadConfig, plainText, webAddress } from "../config";
import { SecretsFile } from "../secrets";
import { type Flags, UsageError } from "./args";
import { serverAnswer, serverUrl } from "./running";
import { oneUser, SIGN_IN_PART, signInTo } from "./sign-in";

/** Which Lumiverse this RPE belongs to, and its sign-in: never the token. */
export async function showLumiverse(paths: DataPaths, config: AppConfig, io: CliIO): Promise<void> {
  const { url, user, database, connection } = config.lumiverse;
  const fromEnv = (name: string): string => (io.env[name]?.trim() ? ` (from ${name}, which wins over the config file)` : "");
  io.out(`Lumiverse: ${url ?? "not set"}${fromEnv(CONFIG_ENV.lumiverseUrl)}`);
  io.out(`User: ${user ?? "not set"}${fromEnv(CONFIG_ENV.lumiverseUser)}`);
  io.out(`Database: ${database ?? "not set, so Lumiverse is read over HTTP"}`);
  io.out(`RPE's connection in Lumiverse: ${connection ?? "not set"}`);
  const kept = await new SecretsFile(paths.secrets).read(SIGN_IN_PART);
  if (!isRecord(kept) || typeof kept.username !== "string" || typeof kept.user !== "string") {
    io.out("Signed in: no");
    return;
  }
  const since = typeof kept.savedAt === "number" ? ` since ${new Date(kept.savedAt).toISOString().slice(0, 10)}` : "";
  io.out(`Signed in: as ${kept.username} (user ${kept.user})${since}${kept.user === user ? "" : ", which is not the user above: sign in again"}`);
}

/** `rpe lumiverse`: with no flags, what is set; with them, the sign-in, and then what is set. */
export async function lumiverseCommand(flags: Flags, paths: DataPaths, config: AppConfig, io: CliIO): Promise<number> {
  if (flags.url === undefined && flags.user === undefined && flags.database === undefined && flags.connection === undefined) {
    await showLumiverse(paths, config, io);
    return 0;
  }
  const username = flags.user;
  if (flags.url === undefined || username === undefined) throw new UsageError("rpe lumiverse needs --url and --user to sign in; with no flags it shows what is set.");
  const url = webAddress(flags.url, "--url");
  const connection = flags.connection === undefined ? undefined : plainText(flags.connection, "--connection");
  const database = flags.database === undefined ? undefined : resolve(flags.database);
  if (database !== undefined && !(existsSync(database) && statSync(database).isFile())) throw new Error(`There is no file at ${database}: give --database the path of Lumiverse's database file, or leave it out to read Lumiverse over HTTP.`);
  await signInTo(url, username, { ...(database === undefined ? {} : { database }), ...(connection === undefined ? {} : { connection }) }, paths, config, io, oneUser(paths, config));
  await showLumiverse(paths, await loadConfig(paths, io.env), io);
  const answer = await serverAnswer(config, io);
  if (answer !== null && "rpe" in answer) io.out(`RPE is running at ${serverUrl(config)}: restart it (stop \`rpe serve\` and start it again) for it to take this.`);
  return 0;
}
