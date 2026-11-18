// The swap by `rpe up`, once the extension runs the new build: with today's build there for this user,
// plain `rpe up` is the swap (§15.3 step 10; R-83).

import { rm } from "node:fs/promises";
import { connectionsWhere, installedExtension, type LumiverseCall, markConnection } from "../../adapter/lumiverse/install-calls";
import { EXTENSION_IDENTIFIER } from "../../adapter/lumiverse/pipe-wire";
import { grantedPermissions } from "../../adapter/lumiverse/swap-reads";
import { stopAfterSwitch, swapSteps } from "../../migrate/going-back";
import { runtimeFoldersOf } from "../../migrate/runtime-folders";
import { type Loopback, otherBuildInstalled, swapCheck, swapRun, swapStands, type TakenConnection, todaysBuildInstalled } from "../../migrate/swap";
import { carryJob, HARNESS_MIGRATIONS, keepCarriedRun } from "../../turn";
import { isRecord } from "../../shared/json";
import { BUILDS_PATH } from "../app";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { CONNECTIONS_PATH } from "../connections";
import { readText, writeWhole } from "../disk";
import { accountSystemctl, localUrl, type RpeService } from "../up";
import type { Flags } from "./args";
import { extensionLeft, sayLeft } from "./left";
import { ownConnection } from "./own-connection";
import { runLine } from "./run-line";
import { serverAnswer, serverUrl } from "./running";
import { treeLayout } from "./tree-layout";
import { webToken } from "./web-token";
import { runningServer, takeLock, withWriter, type WriterContext } from "./writer";

/**
 * What RPE takes of today's at the swap (plan §15.2; R-109), written into its own config and keys:
 * where today's runtime listened, every connection in Lumiverse that reached it (`connections`, which
 * are all RPE's now, each answered under the model name it names, so each is added to
 * `lumiverse.models`), the model name today's loopback names where there is one, and the hash of the
 * key those connections hold, paired with their model names and the loopback's (the key opens those).
 * The model names are what tell that RPE answers on today's connections rather than on one of its own
 * (`rpe down`). Resolves to what puts RPE's config back as it was; a key hash taken stays, since only
 * today's connections hold that key, and it reaches RPE only where today's runtime answered.
 */
export async function takeOver(ctx: WriterContext, current: AppConfig, loopback: Loopback | null, ids: readonly string[], taken: readonly TakenConnection[]): Promise<() => Promise<void>> {
  const before = await readText(ctx.paths.config);
  const named = [...taken.map((c) => c.model), ...(loopback !== null && taken.length > 0 ? [loopback.model] : [])];
  const models = [...new Set([...current.lumiverse.models, ...named])];
  const hash = loopback?.keyHash ?? null;
  await withWriter(ctx, async (ops) => {
    await ops.saveLumiverse({ set: { connections: [...ids], ...(models.length === current.lumiverse.models.length ? {} : { models }) }, ...(loopback === null ? {} : { listens: { address: loopback.at.address, port: loopback.at.port } }) });
    if (hash !== null && loopback !== null) await ops.takeKey(hash, [...new Set([...taken.map((c) => c.model), loopback.model])]);
  });
  return async () => {
    // RPE's service is stopped by now (the undo runs the later steps first); the config is put back as the one writer.
    const lock = await takeLock(ctx);
    try {
      if (before === null) await rm(ctx.paths.config, { force: true });
      else await writeWhole(ctx.paths.config, before);
    } finally {
      lock.release();
    }
  };
}

/** Where `rpe up` finds today's build, and RPE's service, as `upCommand` read them. */
export interface SwapLine {
  flags: Flags;
  switches: ReadonlySet<string>;
  paths: DataPaths;
  current: AppConfig;
  call: LumiverseCall;
  service: RpeService;
  existing: RpeService | null;
  unitText: string;
  /** Lumiverse's data folder: the one the extension sits in, or the one `--lumiverse` names. */
  lumiverse: string;
  /** Makes RPE's own copy, which the unit runs: called once the swap's checks have passed, before anything of today's is stopped. */
  prepare(): Promise<void>;
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

/** The build the light extension said at its last registration with the RPE that runs now, from that RPE's builds route; null where RPE does not answer or the extension has not registered. */
async function registeredBuild(paths: DataPaths, config: AppConfig, io: CliIO): Promise<string | null> {
  const server = await runningServer(paths, config, io);
  if (server === null) return null;
  try {
    const body: unknown = await (await server.api("GET", BUILDS_PATH)).json();
    return isRecord(body) && isRecord(body.builds) && typeof body.builds.extension === "string" ? body.builds.extension : null;
  } catch {
    return null;
  }
}

/** The model connections RPE holds that have no limits (neither a context window nor a longest reply known), asked of the running RPE, each as a line saying where to set them. */
async function connectionsWithoutLimits(paths: DataPaths, config: AppConfig, io: CliIO): Promise<string[]> {
  const server = await runningServer(paths, config, io);
  if (server === null) return [];
  try {
    const body: unknown = await (await server.api("GET", CONNECTIONS_PATH)).json();
    if (!isRecord(body) || !Array.isArray(body.connections)) return [];
    return body.connections.flatMap((c: unknown) => {
      if (!isRecord(c) || typeof c.name !== "string") return [];
      const limits = isRecord(c.limitsInForce) ? c.limitsInForce : null;
      const none = limits === null || (limits.contextWindow === null && limits.maxTokens === null);
      return none ? [`The model connection "${c.name}", carried from the previous build, has no limits: RPE does not know its model's context window or longest reply. Set them on the Connections page (${serverUrl(config)}/ui/#/connections), or with the connection's limits there.`] : [];
    });
  } catch {
    return [];
  }
}

/**
 * The swap (src/migrate/swap.ts), from the command line: it checks before stopping anything, takes every
 * connection in Lumiverse that reached today's runtime as RPE's own (R-109), kept as it is, or makes RPE's
 * own where Lumiverse holds none, then swaps, RPE taking today's runtime's place.
 */
export async function swapUp(line: SwapLine, io: CliIO, version: string): Promise<number> {
  const { flags, switches, paths, current, call, service, existing, lumiverse } = line;
  const user = current.lumiverse.user;
  if (user === null) throw new Error("RPE's config names no Lumiverse user after the sign-in.");
  const identifier = flags.identifier ?? EXTENSION_IDENTIFIER;
  // The extension is switched to the new build first (§15.3 step 10): today's, left running in Lumiverse, would go on writing today's storage after the run had read it.
  const installed = await installedExtension(call, identifier);
  const other = await otherBuildInstalled({ lumiverse, identifier, version, installed, granted: await grantedPermissions(call, identifier) });
  if (other !== null) {
    io.err(other);
    // Not yet switched: the steps, in one place (R-83).
    if (todaysBuildInstalled(installed?.permissions ?? null)) for (const step of swapSteps({ identifier, up: runLine(io, paths, "up") })) io.err(step);
    return 1;
  }
  const stop = (why: string): number => {
    io.err(stopAfterSwitch({ identifier }, why).join("\n"));
    return 1;
  };
  if (existing !== null && existing.unit !== service.unit) return stop(`RPE's service for this data folder is ${existing.unit}, and --name asks for ${service.unit}: the switch starts RPE's own service again, so run it without --name. Nothing was stopped or changed.`);
  // The migration is the data folder's one writer: a running RPE outside a service is stopped by the user, one in its service by the swap.
  const answer = await serverAnswer(current, io);
  if (answer !== null && "rpe" in answer && existing === null) return stop(`RPE is running at ${serverUrl(current)}, outside a service: stop it (${runLine(io, paths, "serve")}), then run ${runLine(io, paths, "up")} again. Nothing was stopped or changed.`);
  const found = runtimeFoldersOf(io.env, io.home);
  const runtime = switches.has("no-runtime") ? null : { configDir: flags["runtime-config"] ?? found.configDir, dataDir: flags["runtime-data"] ?? found.dataDir };
  const swapIo = { out: io.out, fetch: io.fetch, now: io.now, sleep: (ms: number) => Bun.sleep(ms), systemctl: accountSystemctl(io.env, process.getuid?.() ?? null), onStop: stopSignals };
  const sources = { lumiverse, identifier, userId: user, runtime, ...(flags.runtime !== undefined ? { runtimeName: flags.runtime } : {}) };
  // A swap that stands already is left as it is: making the migration's run again is `rpe migrate`'s, with RPE's service stopped meanwhile.
  const standing = existing === null ? null : await swapStands({ sources, data: paths.root, rpe: { address: current.address, port: current.port, unit: existing.unit }, waitMs: current.commandLine.waitMs }, swapIo);
  if (standing !== null) {
    const runtimeFlags = [...(switches.has("no-runtime") ? ["--no-runtime"] : []), ...(["runtime", "runtime-config", "runtime-data", "identifier"] as const).flatMap((flag) => (flags[flag] === undefined ? [] : [`--${flag}`, flags[flag]]))];
    const migrateLine = runLine(io, paths, "migrate", "--lumiverse", lumiverse, "--user", user, ...runtimeFlags);
    io.out(`The switch stands: RPE's service ${standing.unit} runs, and RPE answers at ${standing.at}, where the previous runtime ${standing.runtime} answered${standing.todays === null ? "" : `; the previous build's service ${standing.todays} is switched off`}; the extension Lumiverse has installed is this build (${version}). Nothing was stopped or changed, and the migration was not made again.`);
    io.out(`${runLine(io, paths, "migrate")} carries what changed on the previous build's side since the last run (read at ${standing.since}): stop RPE's service (systemctl --user stop ${standing.unit}), run ${migrateLine}, then start it again (systemctl --user start ${standing.unit}).`);
    const left = await extensionLeft(call);
    if (left.length > 0) sayLeft(left, io);
    return 0;
  }
  const plan = await swapCheck({ sources, options: { data: paths.root, version, env: io.env, tree: treeLayout(), runs: { tables: { area: "harness", migrations: HARNESS_MIGRATIONS }, keep: keepCarriedRun, keepJob: carryJob } }, rpe: { address: current.address, port: current.port }, waitMs: current.commandLine.waitMs, reach: (is) => connectionsWhere(call, is) }, swapIo);
  if (plan === null) return 1;

  // Every connection in Lumiverse that reaches today's runtime is kept as it is and becomes RPE's own (R-109); RPE makes its own only where Lumiverse holds none.
  const taken = plan.connections;
  const own = taken.length > 0 ? null : await ownConnection(call, `${localUrl(plan.at.address, plan.at.port)}/v1`, { paths, config: current, io, version, what: "rpe up" }, current);
  const ids = taken.length > 0 ? taken.map((c) => c.id) : [own?.id ?? ""];
  for (const c of taken) io.out(`RPE answers on "${c.name}" (${c.id}), a connection in Lumiverse that reached the previous runtime, under its model name (${c.model}): it is left as it is, and the chats that use it go on working once RPE answers in the previous runtime's place.`);
  // The connection of RPE's own that an earlier plain `rpe up` made is RPE's no longer once today's are: its key stops with RPE's own earlier key.
  const earlier = current.lumiverse.connections.filter((id) => taken.length > 0 && !ids.includes(id));
  for (const id of earlier) io.out(`The connection ${id} in Lumiverse, RPE's own until now, is played no longer once RPE answers in the previous runtime's place: the chats on it belong on ${taken.length === 1 ? `"${taken[0]?.name}"` : "one of the connections above"}.`);

  const ctx = { paths, config: current, io, version, what: "rpe up" };
  await line.prepare();
  const ran = await swapRun(
    plan,
    {
      service,
      text: line.unitText,
      installed: existing !== null,
      startMs: current.commandLine.startMs,
      waitMs: current.commandLine.waitMs,
      askEveryMs: current.commandLine.askEveryMs,
      takeOver: () => takeOver(ctx, current, plan.took?.loopback ?? null, ids, taken),
      todays: taken.length > 0,
      mark: (id, on) => markConnection(call, id, on),
      extension: { build: version, registered: () => registeredBuild(paths, current, io) },
      earlier,
    },
    swapIo,
  );
  if (!ran) return 1;
  const after = { ...current, lumiverse: { ...current.lumiverse, connections: ids } };
  await webToken(ctx, after);
  const left = await extensionLeft(call);
  left.push(...(await connectionsWithoutLimits(paths, after, io)));
  left.push(`RPE's service's own log, should you need it: journalctl --user -u ${service.unit}.`);
  if (taken.length === 0 && own !== null) left.push(`In Lumiverse, choose the connection "${own.name}" for the chats RPE should play.`);
  sayLeft(left, io);
  return 0;
}
