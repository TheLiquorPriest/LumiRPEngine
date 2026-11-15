// `rpe up`: the one command a new install runs, and the swap.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { dataPaths, defaultDataFolder, loadConfig, webAddress } from "../config";
import { lineLog } from "../app";
import type { CliIO, CliOptions } from "../cli";
import type { LumiverseCall } from "../../adapter/lumiverse/install-calls";
import { accountSystemctl, removeRpeService, rpeService, rpeServiceOf, rpeUnitText, serviceNameOf, startRpeService } from "../up";
import { parseArgs, UsageError } from "./args";
import { extensionLeft, sayLeft } from "./left";
import { ownConnection } from "./own-connection";
import { serverAnswer, serverUrl } from "./running";
import { keptSession, oneUser, signInTo } from "./sign-in";
import { swapUp } from "./swap-up";
import { updateSettingsOf } from "./update-settings";

/** The switches `rpe up` takes beside its flags, and its flags. */
const UP_SWITCHES = ["systemd", "no-runtime"] as const;
const UP_FLAGS = ["data", "url", "user", "name", "lumiverse", "runtime", "runtime-config", "runtime-data", "identifier"] as const;
/** A service's name, as it goes into its unit's name: as today's runtime's names are held (LumiAH `RUNTIME_NAME`). */
const SERVICE_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * `rpe up` (plan §4.6, §15.3 step 10): the one command a new install runs, and the swap. It signs in
 * to Lumiverse (a kept sign-in to the same Lumiverse and user that still holds is used as it is, and
 * no password is asked). A new install makes RPE's connection there or brings it into line (up.ts;
 * today's build's own connection is never changed), keeps its id in `lumiverse.connection`, and runs
 * RPE as a service of the account where asked (`--systemd`). Given Lumiverse's data folder
 * (`--lumiverse`), it swaps instead (`swapUp`): RPE takes today's runtime's place, its address, its
 * model name and its key, so today's connection in Lumiverse goes on working as it is. One RPE
 * service already there for this data folder is kept, and started again on what this run wrote. Last
 * it says what is left for the user to do. What already matches is left alone, so a second run
 * changes nothing.
 */
export async function upCommand(argv: readonly string[], io: CliIO, options: CliOptions): Promise<number> {
  const version = options.version;
  const switched = argv.filter((a) => a.startsWith("--") && (UP_SWITCHES as readonly string[]).includes(a.slice(2)));
  const switches = new Set(switched.map((a) => a.slice(2)));
  const { words, flags } = parseArgs(
    argv.filter((a) => !switched.includes(a)),
    UP_FLAGS,
  );
  const username = flags.user;
  if (words.length > 0) throw new UsageError("rpe up takes no words.");
  if (flags.url === undefined || username === undefined) throw new UsageError("rpe up needs --url and --user.");
  const swapping = flags.lumiverse !== undefined;
  if (!swapping && (switches.has("no-runtime") || flags.runtime !== undefined || flags["runtime-config"] !== undefined || flags["runtime-data"] !== undefined || flags.identifier !== undefined)) throw new UsageError("--runtime, --no-runtime, --runtime-config, --runtime-data and --identifier say where today's build is: they go with --lumiverse.");
  if (switches.has("no-runtime") && flags.runtime !== undefined) throw new UsageError("--runtime names a runtime to take and --no-runtime says there is none: give one of them.");
  if (flags.name !== undefined && !SERVICE_NAME.test(flags.name)) throw new UsageError(`--name is "${flags.name}": use lowercase letters, digits, _ and -, up to 40.`);
  const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
  const config = await loadConfig(paths, io.env);
  const url = webAddress(flags.url, "--url");
  // Whose RPE this is is asked once Lumiverse has taken the password, before anything is written; a kept sign-in is the owner's own, and is asked of the data a migration carried.
  const guard = oneUser(paths, config);
  const ctx = { paths, config, io, version, what: "rpe up" };
  const kept = await keptSession(url, username, paths, config, io);
  if (kept !== null && config.lumiverse.user !== null) guard(config.lumiverse.user);
  const session = kept ?? (await signInTo(url, username, {}, ctx, guard));
  const current = await loadConfig(paths, io.env);
  const call: LumiverseCall = (method, path, body) => session.request(method, path, body);

  // RPE's service: its unit for this data folder where there is one, else one named for this RPE, which must be no other RPE's.
  const data = resolve(paths.root);
  const existing = await rpeServiceOf(data, io.env, io.home);
  const service = rpeService(flags.name ?? existing?.name ?? serviceNameOf(username), io.env, io.home);
  if (service.unit !== existing?.unit && existsSync(service.file) && (switches.has("systemd") || swapping)) {
    io.err(`${service.file} is a unit for something other than this RPE (another data folder's): give this RPE's service a name of its own with --name. Nothing was stopped or changed.`);
    return 1;
  }
  const update = await updateSettingsOf(paths, lineLog(io.err, io.now));
  const unitText = rpeUnitText({ name: service.name, bun: process.execPath, script: Bun.main, data, startLimit: { tries: update.startTries, windowMs: update.startWindowMs } });
  if (swapping) return await swapUp({ flags, switches, paths, current, call, service, existing, unitText }, io, version);

  const settled = await ownConnection(call, `${serverUrl(current)}/v1`, ctx, current);
  const runs = switches.has("systemd") || existing !== null;
  if (runs) {
    const systemctl = accountSystemctl(io.env, process.getuid?.() ?? null);
    if (existing !== null && existing.unit !== service.unit) await removeRpeService(existing, systemctl);
    await startRpeService(service, unitText, systemctl);
    io.out(`Started ${service.unit}, RPE's service.`);
  }
  const left = await extensionLeft(call);
  if (runs) left.push(`See that RPE answers: rpe status (its service's own log: journalctl --user -u ${service.unit}).`);
  else {
    const answer = await serverAnswer(current, io);
    if (answer === null) left.push("Start RPE: rpe serve.");
    else if (!("rpe" in answer)) left.push(`Something other than RPE answers at ${serverUrl(current)}: give RPE a free port ("port" in its config, or RPE_PORT), and run rpe up again.`);
    else if (kept === null || settled.moved) left.push("Restart RPE (stop rpe serve and start it again) so it takes this.");
  }
  left.push(`In Lumiverse, choose the connection "${settled.name}" for the chats RPE should play.`);
  sayLeft(left, io);
  return 0;
}
