// `rpe up`: the one command a new install runs, and the swap.

import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { memoryRefusal } from "../service-memory";
import { type AppConfig, type DataPaths, dataPaths, defaultDataFolder, loadConfig, LOOPBACK, plainText, webAddress } from "../config";
import { lineLog } from "../app";
import type { CliIO, CliOptions } from "../cli";
import type { LumiverseCall } from "../../adapter/lumiverse/install-calls";
import { rpeService, rpeServiceOf, serviceNameOf, unitNameRefusal } from "../up";
import { parseArgs, UsageError } from "./args";
import { writeGlobalSetting } from "./global-setting";
import { extensionLeft, sayLeft } from "./left";
import { installCopy } from "../app-copy";
import { LUMIVERSE_DATABASE, lumiverseFolderOf } from "./lumiverse-folder";
import { ownConnection } from "./own-connection";
import { firstFreePort, portFree } from "./ports";
import { runLine } from "./run-line";
import { answerAt, loopbackUrl } from "./running";
import { keptSession, keptUsername, oneUser, signInTo } from "./sign-in";
import { runtimeFoldersOf } from "../../migrate/runtime-folders";
import { installedExtension } from "../../adapter/lumiverse/install-calls";
import { EXTENSION_IDENTIFIER } from "../../adapter/lumiverse/pipe-wire";
import { todaysRuntimeFound } from "./swap-find";
import { swapUp } from "./swap-up";
import { installService, managerOf, unitFor, withoutSystemd, type Manager } from "./up-service";
import { updateSettingsOf } from "./update-settings";
import { webToken } from "./web-token";
import { withWriter } from "./writer";

/** The switches `rpe up` takes beside its flags, and its flags. */
const UP_SWITCHES = ["systemd", "no-runtime", "allow-http"] as const;
const UP_FLAGS = ["data", "url", "user", "username", "name", "lumiverse", "runtime", "runtime-config", "runtime-data", "identifier", "port", "listen", "bun", "database", "memory"] as const;

/** Whether a Lumiverse address is plain http to another machine, where the password and then the session token would cross the network in clear. */
function inClear(base: string): boolean {
  const url = new URL(base);
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return !(host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]");
}

/** `--port`: a port number. */
function portOf(given: string | undefined): number | undefined {
  if (given === undefined) return undefined;
  const port = Number(given);
  if (!/^\d+$/.test(given) || port < 1 || port > 65535) throw new UsageError(`--port is "${given}": give a port number.`);
  return port;
}

/**
 * `rpe up` (plan §4.6, §15.3 step 10): the one command a new install runs, and the swap. It asks for
 * the username (or reads it from `--user`, `--username` or LUMIVERSE_USERNAME) and for the password,
 * which it does not keep, and signs in to Lumiverse (a kept sign-in to the same Lumiverse and user that
 * still holds is used as it is, and nothing is asked). A new install makes RPE's connection there or
 * brings it into line (up.ts; today's build's own connection is never changed), keeps its id in
 * `lumiverse.connections`, prints the web app's token the first time, and runs RPE as a service of the
 * account where asked (`--systemd`), else serves in the foreground until it is told to stop. Given
 * Lumiverse's data folder (`--lumiverse`), it swaps instead (`swapUp`): RPE takes today's runtime's
 * place, its address, its model name and its key, so today's connection in Lumiverse goes on working as
 * it is. One RPE service already there for this data folder is kept, and started again on what this run
 * wrote. What already matches is left alone, so a second run changes nothing.
 */
/** Serves RPE in the foreground on a data folder and its config, as `rpe serve` does; `rpe up` is handed it, and ends with it. */
export type ServeHere = (paths: DataPaths, config: AppConfig) => Promise<number>;

export async function upCommand(argv: readonly string[], io: CliIO, options: CliOptions, serveHere: ServeHere): Promise<number> {
  const version = options.version;
  const host = options.host ?? { platform: process.platform, uid: process.getuid?.() ?? null, bun: process.execPath };
  const switched = argv.filter((a) => a.startsWith("--") && (UP_SWITCHES as readonly string[]).includes(a.slice(2)));
  const switches = new Set(switched.map((a) => a.slice(2)));
  const { words, flags } = parseArgs(
    argv.filter((a) => !switched.includes(a)),
    UP_FLAGS,
  );
  if (words.length > 0) throw new UsageError("rpe up takes no words.");
  if (flags.user !== undefined && flags.username !== undefined && flags.user !== flags.username) throw new UsageError("--user and --username are the same flag: give one of them.");
  if (switches.has("no-runtime") && flags.runtime !== undefined) throw new UsageError("--runtime names a runtime to take and --no-runtime says there is none: give one of them.");
  const nameWhy = flags.name === undefined ? null : unitNameRefusal(flags.name);
  if (nameWhy !== null) throw new UsageError(`--name is "${flags.name}": ${nameWhy}.`);
  const givenPort = portOf(flags.port);
  const memoryWhy = flags.memory === undefined ? null : memoryRefusal(flags.memory);
  if (memoryWhy !== null) throw new UsageError(`--memory is "${flags.memory}": ${memoryWhy}.`);
  const listen = flags.listen === undefined ? undefined : plainText(flags.listen, "--listen").toLowerCase();
  if (listen !== undefined && listen !== LOOPBACK && listen !== "localhost") io.err(`Warning: RPE will listen on ${listen}, where other machines can reach it, not only this one. Pages and keys cross to it in clear http, so keep it behind something that encrypts (a tunnel, a reverse proxy with HTTPS) or on a private network. Every call still needs its key and must be addressed to ${listen} itself, unless that is a wildcard address (0.0.0.0, ::); RPE still answers on loopback for its extension.`);
  // What the unit runs is the very file the check passed: a link in the path could be pointed elsewhere later.
  const bunGiven = flags.bun ?? host.bun;
  if (!bunGiven.startsWith("/")) throw new UsageError(`--bun must be an absolute path (systemd searches no PATH that has Bun): ${bunGiven}`);
  let bun: string;
  try {
    bun = realpathSync(bunGiven);
  } catch (error) {
    throw new UsageError(`--bun names no Bun here (${bunGiven}): ${error instanceof Error ? error.message : String(error)}`);
  }
  const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
  const config = await loadConfig(paths, io.env);
  // Whether RPE can be a service here, decided before anything is asked or written.
  const manager: Manager | null = switches.has("systemd") ? await managerOf(io, host, options.appFile, bun, paths) : null;
  if (manager !== null && !manager.systemd) for (const line of withoutSystemd(manager.why, io, paths, bun, options.appFile)) io.err(line);

  const address = flags.url ?? config.lumiverse.url ?? io.env.LUMIVERSE_URL?.trim() ?? (await io.ask("Lumiverse address (as you open it in a browser): "));
  if (address === null || address === undefined || address === "") throw new UsageError("rpe up needs Lumiverse's address: --url <address>, LUMIVERSE_URL, or the one RPE's config holds.");
  const url = webAddress(address, "--url");
  if (inClear(url)) {
    if (!switches.has("allow-http")) throw new UsageError(`${url} is plain http to another machine: your password now, and the session token on every call after, would cross the network in clear. Use Lumiverse's https address, or accept that with --allow-http.`);
    io.err(`Warning: ${url} is plain http. Your password now, and the session token on every call after, cross the network in clear.`);
  }
  const username = (flags.user ?? flags.username ?? io.env.LUMIVERSE_USERNAME?.trim() ?? (await keptUsername(url, paths, config)) ?? (await io.ask("Lumiverse username: ")))?.trim();
  if (username === undefined || username === "") throw new UsageError("rpe up needs your Lumiverse username: --user <name>, --username <name> or LUMIVERSE_USERNAME.");

  // Where RPE serves, worked out before anything is written and told only once it is the install that goes on: the port asked for, else the one its config holds, where taken the first free one after it.
  const installed = config.lumiverse.connections.length > 0;
  const first = givenPort ?? config.port;
  const there = await answerAt(loopbackUrl(first), config, io);
  const taken = there !== null && !("rpe" in there) ? true : there === null && !portFree(LOOPBACK, first);
  let port = first;
  let blocked: string | null = null;
  let portNote: string | null = null;
  if (taken) {
    if (installed && givenPort === undefined) blocked = `Something other than RPE answers at ${loopbackUrl(first)}, RPE's port: give RPE a free one with ${runLine(io, paths, "up", "--port", "<port>")} (the port is "port" in its config, and RPE_PORT), or stop what holds it.`;
    else {
      const next = firstFreePort(first + 1, config.service.portLast);
      if (next === null) throw new Error(`Port ${first} is taken and no port from ${first + 1} to ${config.service.portLast} is free on loopback: give a port with --port, or raise service.portLast. Nothing was changed.`);
      portNote = `Port ${first} is taken, so RPE uses ${next}, the first free one after it (up to service.portLast, ${config.service.portLast}).`;
      port = next;
    }
  }

  const data = resolve(paths.root);
  const existing = await rpeServiceOf(data, io.env, io.home);
  const service = rpeService(flags.name ?? existing?.name ?? serviceNameOf(username), io.env, io.home);
  /** A unit of that name that is another RPE's: this RPE's service takes a name of its own. */
  const nameTaken = service.unit !== existing?.unit && existsSync(service.file);
  const nameWords = `${service.file} is a unit for something other than this RPE (another data folder's): give this RPE's service a name of its own with --name. Nothing was stopped or changed.`;
  if (nameTaken && (manager?.systemd === true || flags.lumiverse !== undefined)) {
    io.err(nameWords);
    return 1;
  }
  const database = flags.database === undefined ? undefined : resolve(flags.database);
  if (database !== undefined && !(existsSync(database) && statSync(database).isFile())) throw new Error(`There is no file at ${database}: give --database the path of Lumiverse's database file. Nothing was changed.`);

  // Whose RPE this is is asked once Lumiverse has taken the password, before anything is written; a kept sign-in is the owner's own, and is asked of the data a migration carried.
  const guard = oneUser(paths, config);
  const ctx = { paths, config, io, version, what: "rpe up" };
  const kept = await keptSession(url, username, paths, config, io);
  if (kept !== null && config.lumiverse.user !== null) guard(config.lumiverse.user);
  const session = kept ?? (await signInTo(url, username, {}, ctx, guard));
  let current = await loadConfig(paths, io.env);
  const call: LumiverseCall = (method, path, body) => session.request(method, path, body);

  // Where Lumiverse's data folder is: the one `--lumiverse` names, else the one the extension sits in (where this runs from its own folder), else the database file's, else asked.
  const identifier = flags.identifier ?? EXTENSION_IDENTIFIER;
  const here = options.appFile === undefined ? null : lumiverseFolderOf(options.appFile);
  let lumiverse = flags.lumiverse !== undefined ? resolve(flags.lumiverse) : (here?.data ?? (database !== undefined && basename(database) === LUMIVERSE_DATABASE ? dirname(database) : null));
  if (lumiverse === null && !installed && (await installedExtension(call, identifier)) !== null) {
    const said = await io.ask("Lumiverse's data folder, if Lumiverse runs on this machine (it is where RPE finds the previous build's runtime to take over); leave it empty if it does not: ");
    if (said !== null && said.trim() !== "") lumiverse = resolve(said.trim());
  }
  // With today's build there for this user, plain `rpe up` is the swap (R-83); without it, the install.
  const userId = current.lumiverse.user;
  const folders = runtimeFoldersOf(io.env, io.home);
  const runtime = switches.has("no-runtime") ? null : { configDir: flags["runtime-config"] ?? folders.configDir, dataDir: flags["runtime-data"] ?? folders.dataDir };
  const swapping = flags.lumiverse !== undefined || (lumiverse !== null && userId !== null && (await todaysRuntimeFound({ lumiverse, identifier, userId, runtime, ...(flags.runtime === undefined ? {} : { runtimeName: flags.runtime }) })));
  if (!swapping && (switches.has("no-runtime") || flags.runtime !== undefined || flags["runtime-config"] !== undefined || flags["runtime-data"] !== undefined)) io.err("--runtime, --no-runtime, --runtime-config and --runtime-data say where today's build is, and rpe up found none of today's runtime of yours here: it is the install.");

  // Where Lumiverse's database file is, where this runs from the extension's own folder (or `--database` says): RPE then reads Lumiverse through it.
  const found = database ?? here?.database ?? null;
  // The swap listens where today's runtime did; only the install picks a port.
  const listens = swapping ? undefined : port !== current.port || (listen !== undefined && listen !== current.address) ? { address: listen ?? current.address, port } : undefined;
  const saved = { ...(found !== null && found !== current.lumiverse.database ? { set: { database: found } } : {}), ...(listens === undefined ? {} : { listens }) };
  if (swapping && nameTaken) {
    io.err(nameWords);
    return 1;
  }
  if (!swapping && blocked !== null && manager?.systemd === true) {
    io.err(`${blocked} Nothing else was changed.`);
    return 1;
  }
  if (Object.keys(saved).length > 0) {
    await withWriter({ ...ctx, config: current }, (ops) => ops.saveLumiverse(saved));
    if (saved.set !== undefined) io.out(`RPE reads Lumiverse's database at ${found}.`);
    current = await loadConfig(paths, io.env);
  }
  if (flags.memory !== undefined && flags.memory !== current.service.memory) {
    await writeGlobalSetting(paths, "service.memory", flags.memory);
    current = await loadConfig(paths, io.env);
  }

  const update = await updateSettingsOf(paths, lineLog(io.err, io.now));
  const unitText = unitFor({ config: current, bun, service, update, data });
  // The swap starts RPE's service on its own copy, made once the swap's checks have passed.
  const prepare = async (): Promise<void> => {
    if (options.appFile === undefined) throw new Error("This process runs from no single app file, so RPE's own copy cannot be made.");
    await installCopy(data, options.appFile, io.now());
  };
  if (swapping) {
    if (lumiverse === null) throw new UsageError("rpe up needs Lumiverse's data folder to swap: --lumiverse <folder>.");
    return await swapUp({ flags, switches, paths, current, call, service, existing, unitText, lumiverse, prepare }, io, version);
  }
  if (portNote !== null) io.out(portNote);

  const settled = await ownConnection(call, `${loopbackUrl(current.port)}/v1`, ctx, current);
  await webToken(ctx, current);
  const runs = manager?.systemd === true || existing !== null;
  if (runs) {
    if (options.appFile === undefined) throw new Error("This process runs from no single app file, so RPE's own copy cannot be made.");
    await installService({ ctx, config: current, host, bun, appFile: options.appFile, service, existing, update });
  } else if (manager !== null && options.appFile !== undefined) await installCopy(data, options.appFile, io.now());
  const left = await extensionLeft(call);
  if (runs) left.push(`See that RPE answers: ${runLine(io, paths, "status")} (its service's own log: journalctl --user -u ${service.unit}).`);
  const answer = runs ? null : await answerAt(loopbackUrl(current.port), current, io);
  if (!runs) {
    if (blocked !== null) left.push(blocked);
    else if (answer !== null && "rpe" in answer) left.push(`RPE ${answer.rpe} already answers at ${loopbackUrl(current.port)}${kept === null || settled.moved || saved.listens !== undefined ? ": restart it (stop it and start it again) so it takes what this run wrote" : ""}; this run did not start another.`);
    else if (answer !== null) left.push(`Something other than RPE answers at ${loopbackUrl(current.port)}: give RPE a free port with ${runLine(io, paths, "up", "--port", "<port>")}.`);
  }
  left.push(`In Lumiverse, choose the connection "${settled.name}" for the chats RPE should play.`);
  sayLeft(left, io);
  if (runs) return 0;
  if (blocked !== null || answer !== null) return answer !== null && "rpe" in answer ? 0 : 1;
  io.out("");
  // Asked for a service where there is no systemd, the way to keep it running was said above.
  io.out(`RPE serves in the foreground now: stop it with Ctrl-C.${manager === null ? ` To keep it running without this terminal: ${runLine(io, paths, "up", "--systemd")}` : ""}`);
  return await serveHere(paths, current);
}
