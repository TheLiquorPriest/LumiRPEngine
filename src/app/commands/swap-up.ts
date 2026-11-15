// The swap by `rpe up --lumiverse`, once the extension runs the new build.

import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { EXTENSION_IDENTIFIER } from "../../adapter/lumiverse/pipe-wire";
import { shellWord } from "../../migrate/going-back";
import { type Loopback, otherBuildInstalled, swapCheck, swapRun, swapStands } from "../../migrate/swap";
import { runtimeFoldersOf } from "../../migrate/runtime-folders";
import { isRecord } from "../../shared/json";
import { takeKeyHash } from "../auth";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { updateConfigFile } from "../config";
import { readText, writeWhole } from "../disk";
import { accountSystemctl, connectionsWhere, installedExtension, localUrl, type LumiverseCall, type RpeService } from "../up";
import type { Flags } from "./args";
import { commandLineDatabase } from "./database";
import { extensionLeft, sayLeft } from "./left";
import { ownConnection } from "./own-connection";
import { serverAnswer, serverUrl } from "./running";
import { treeLayout } from "./tree-layout";

/**
 * What RPE takes of today's at the swap (plan §15.2), written into its own config and keys: where
 * today's runtime listened, the model name today's connection in Lumiverse names and the hash of the
 * key it holds, and `connection` as RPE's connection there. The model name is taken only with today's
 * connection (`todays`): it is then what tells that RPE answers on today's connection rather than
 * on one of its own (`rpe down`). Resolves to what puts RPE's config back as it was; a key hash taken
 * stays, since only today's connection holds that key, and it reaches RPE only where today's runtime
 * answered.
 */
export async function takeOver(paths: DataPaths, current: AppConfig, version: string, io: CliIO, loopback: Loopback | null, connection: string, todays: boolean): Promise<() => Promise<void>> {
  const before = await readText(paths.config);
  await updateConfigFile(paths, (raw) => {
    const models = loopback === null || !todays || current.lumiverse.models.includes(loopback.model) ? {} : { models: [...current.lumiverse.models, loopback.model] };
    raw.lumiverse = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}), connection, ...models };
    if (loopback !== null) Object.assign(raw, { address: loopback.at.address, port: loopback.at.port });
  });
  const hash = loopback?.keyHash ?? null;
  if (hash !== null) {
    const db = commandLineDatabase(paths, current, version, io.now);
    try {
      db.transaction(() => takeKeyHash(db, "provider", hash, io.now())).immediate();
    } finally {
      db.close();
    }
  }
  return async () => {
    if (before === null) await rm(paths.config, { force: true });
    else await writeWhole(paths.config, before);
  };
}

/** Where `rpe up --lumiverse` finds today's build, and RPE's service, as `upCommand` read them. */
export interface SwapLine {
  flags: Flags;
  switches: ReadonlySet<string>;
  paths: DataPaths;
  current: AppConfig;
  call: LumiverseCall;
  service: RpeService;
  existing: RpeService | null;
  unitText: string;
}

/** The signals that end the process (Ctrl-C, a closed terminal, a kill): while the swap runs, each is told to it instead, so that it puts back what it did before it ends. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Tells `stop` each stop signal the process gets, in place of ending it; returns what lets go of them.
 * After a hang-up the terminal is gone and a write to it fails: that failure must not end the process
 * before the swap has put back what it did, nor after it.
 */
function stopSignals(stop: (signal: string) => void): () => void {
  const handlers = STOP_SIGNALS.map((signal) => {
    const handler = (): void => {
      if (signal === "SIGHUP") for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});
      stop(signal);
    };
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

/**
 * The swap (src/migrate/swap.ts), from the command line: it checks before stopping anything, settles
 * RPE's connection in Lumiverse (today's loopback, kept as it is, where Lumiverse holds one; else
 * RPE's own, where RPE answers once swapped), then swaps, RPE taking today's runtime's place.
 */
export async function swapUp(line: SwapLine, io: CliIO, version: string): Promise<number> {
  const { flags, switches, paths, current, call, service, existing } = line;
  const user = current.lumiverse.user;
  if (user === null) throw new Error("RPE's config names no Lumiverse user after the sign-in.");
  if (existing !== null && existing.unit !== service.unit) {
    io.err(`RPE's service for this data folder is ${existing.unit}, and --name asks for ${service.unit}: the swap starts RPE's own service again, so run it without --name. Nothing was stopped or changed.`);
    return 1;
  }
  // The migration is the data folder's one writer: a running RPE outside a service is stopped by the user, one in its service by the swap.
  const answer = await serverAnswer(current, io);
  if (answer !== null && "rpe" in answer && existing === null) {
    io.err(`RPE is running at ${serverUrl(current)}, outside a service: stop it (rpe serve), then run rpe up again. Nothing was stopped or changed.`);
    return 1;
  }
  // The extension is switched to the new build first (§15.3 step 10): today's, left running in Lumiverse, would go on writing today's storage after the run had read it.
  const identifier = flags.identifier ?? EXTENSION_IDENTIFIER;
  const lumiverse = resolve(flags.lumiverse ?? "");
  const other = await otherBuildInstalled({ lumiverse, identifier, version, installed: await installedExtension(call, identifier) });
  if (other !== null) {
    io.err(`${other} Nothing was stopped or changed.`);
    return 1;
  }
  const found = runtimeFoldersOf(io.env, io.home);
  const runtime = switches.has("no-runtime") ? null : { configDir: flags["runtime-config"] ?? found.configDir, dataDir: flags["runtime-data"] ?? found.dataDir };
  const swapIo = { out: io.out, fetch: io.fetch, now: io.now, sleep: (ms: number) => Bun.sleep(ms), systemctl: accountSystemctl(io.env, process.getuid?.() ?? null), onStop: stopSignals };
  const sources = { lumiverse, identifier, userId: user, runtime, ...(flags.runtime !== undefined ? { runtimeName: flags.runtime } : {}) };
  // A swap that stands already is left as it is: making the migration's run again is `rpe migrate`'s, with RPE's service stopped meanwhile.
  const standing = existing === null ? null : await swapStands({ sources, data: paths.root, rpe: { address: current.address, port: current.port, unit: existing.unit }, waitMs: current.commandLine.waitMs }, swapIo);
  if (standing !== null) {
    const runtimeFlags = [...(switches.has("no-runtime") ? ["--no-runtime"] : []), ...(["runtime", "runtime-config", "runtime-data", "identifier"] as const).flatMap((flag) => (flags[flag] === undefined ? [] : [`--${flag}`, flags[flag]]))];
    const migrateLine = ["rpe", "migrate", "--lumiverse", lumiverse, "--user", user, "--data", resolve(paths.root), ...runtimeFlags].map(shellWord).join(" ");
    io.out(`The swap stands: RPE's service ${standing.unit} runs, and RPE answers at ${standing.at}, where today's runtime ${standing.runtime} answered${standing.todays === null ? "" : `; today's service ${standing.todays} is switched off`}; the extension Lumiverse has installed is this build (${version}). Nothing was stopped or changed, and the migration was not made again.`);
    io.out(`rpe migrate carries what changed on today's side since the last run (read at ${standing.since}): stop RPE's service (systemctl --user stop ${standing.unit}), run ${migrateLine}, then start it again (systemctl --user start ${standing.unit}).`);
    const left = await extensionLeft(call);
    if (left.length > 0) sayLeft(left, io);
    return 0;
  }
  const plan = await swapCheck({ sources, options: { data: paths.root, version, env: io.env, tree: treeLayout() }, rpe: { address: current.address, port: current.port }, waitMs: current.commandLine.waitMs }, swapIo);
  if (plan === null) return 1;

  // Today's connection in Lumiverse becomes RPE's, as it is; RPE makes its own only where Lumiverse holds no loopback of today's.
  const loopbacks = plan.took === null ? [] : await connectionsWhere(call, plan.took.config.tuning.connectionsRead, plan.took.loopback.is);
  const [todays, ...others] = loopbacks;
  const connection = todays ?? (await ownConnection(call, `${localUrl(plan.at.address, plan.at.port)}/v1`, paths, current, version, io));
  if (todays !== undefined) io.out(`RPE's connection in Lumiverse is to be "${todays.name}" (${todays.id}), the one today's build made for its runtime: it is left as it is, and the chats that use it go on working once RPE answers in today's runtime's place.`);
  if (todays !== undefined && others.length > 0) io.out(`These connections in Lumiverse reach today's runtime too: ${others.map((c) => `"${c.name}" (${c.id})`).join(", ")}. RPE plays only the chats on "${todays.name}": choose it for the chats on those.`);
  // A connection of RPE's own that its config named (an earlier plain `rpe up` made it) is RPE's no longer once today's is.
  const before = current.lumiverse.connection;
  const ownBefore = todays !== undefined && before !== null && before !== todays.id && !others.some((c) => c.id === before) ? before : null;
  if (todays !== undefined && ownBefore !== null) io.out(`The connection ${ownBefore} in Lumiverse, RPE's own until now, is played no longer once RPE answers in today's runtime's place: the chats on it belong on "${todays.name}" (${todays.id}).`);

  if (!(await swapRun(plan, { service, text: line.unitText, installed: existing !== null, startMs: current.commandLine.startMs, waitMs: current.commandLine.waitMs, takeOver: () => takeOver(paths, current, version, io, plan.took?.loopback ?? null, connection.id, todays !== undefined), todays: todays !== undefined }, swapIo))) return 1;
  const left = await extensionLeft(call);
  left.push(`RPE's service's own log, should you need it: journalctl --user -u ${service.unit}.`);
  if (todays === undefined) left.push(`In Lumiverse, choose the connection "${connection.name}" for the chats RPE should play.`);
  else if (ownBefore !== null) left.push(`In Lumiverse, move the chats on the connection ${ownBefore} to "${todays.name}": RPE plays only the chats on it now.`);
  sayLeft(left, io);
  return 0;
}
