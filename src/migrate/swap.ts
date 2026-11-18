// The swap (STANDALONE-PLAN §15.3 step 10, §4.6, §15.2): run by `rpe up` on the owner's word, once the
// installed extension has been switched to the new build. It reads first, as the rehearsal does, and
// stops nothing where the run would be refused (`swapCheck`). Then (`swapRun`) it waits for today's
// runtime to be idle, as today's own `lumiah up` waits before it restarts one (its "Wait before
// restart" and "Restart poll" settings), stops today's service, and runs the migration again from the
// start: a fresh backup, every chat not yet played on RPE imported again, the check, the report.
// Once that run went through, RPE takes today's loopback (§15.2): it listens where today's runtime
// listened, answers to the model name today's connection in Lumiverse names, and holds that
// connection's key's hash, so the connection, which nobody changes, and every chat pinned to it go on
// working. RPE's service is started in the old one's place, and only once RPE answers is today's
// service switched off. A failure anywhere from the stop on puts back what was done, in reverse:
// RPE's service stopped, its config as it was, what was stopped running again.
// Of today's it switches off the unit alone: the runtime's config and folders stay as they were, so
// its own install line brings it back (§15.6 step 4); and it never calls Lumiverse. It records the
// cutover for going back (the identifier used, the connections taken, RPE's own earlier ones, and each
// chat left off RPE's connections with the connection it was on), and names those chats, each with its
// engine and the one step that puts it on RPE, in its closing lines.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loopbackModel, loopsBack, runtimeBase } from "./today/lumiah/link/contract";
import { STATUS_PATH } from "../app/app";
import { dataPaths } from "../app/config";
import { localUrl, mustRun, removeRpeService, type RpeService, startRpeService, type Systemctl } from "../app/up";
import { isRecord } from "../shared/json";
import { readText } from "./files";
import { dropSwap, keepSwap, LIGHT_PERMISSIONS, NEW_BUILD_BRANCH, PREVIOUS_PERMISSIONS, previousBranch, stopAfterSwitch, type SwapRecord } from "./going-back";
import { loopbackKeyHash } from "./inside";
import { LumiverseDb } from "./lumiverse-db";
import { earlierRuns, migrate, type MigrateOptions, type MigrateResult } from "./migrate";
import { type ChatReport, type MigrationReport, refusalsOf, reportText } from "./report";
import { disownedLines } from "./no-runtime";
import { type NotCarriedSteps, notCarriedLines, notCarriedOf } from "./not-carried";
import { runtimeConfig, type SavedRuntime } from "./runtime-folders";
import { openToday, type Sources } from "./today";

export interface SwapIo {
  out(line: string): void;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): number;
  sleep(ms: number): Promise<void>;
  systemctl: Systemctl;
  /** Calls `stop` with the signal's name whenever the process is told to stop (Ctrl-C, a closed terminal, a kill), in place of ending it; returns what lets go of that. */
  onStop(stop: (signal: string) => void): () => void;
}

/** Where a program listens. */
export interface Place {
  address: string;
  port: number;
}

/**
 * Today's loopback, which RPE takes at the swap (§15.2): where today's runtime listened, the model
 * name its connection in Lumiverse names (`loopbackModel`), and the hash of the key that connection
 * holds (null: the user's registry holds none).
 */
export interface Loopback {
  at: Place;
  model: string;
  keyHash: string | null;
  /** Whether a connection in Lumiverse is today's loopback, by today's own rule (`loopsBack`): it names the loopback model, or it sits at the runtime's address and names no other extension's. */
  is(connection: { model: string; url: string }): boolean;
}

/** A connection in Lumiverse that reaches today's runtime, by its id, its name there and the model name it names, under which RPE answers it once it is RPE's (R-109). */
export interface TakenConnection {
  id: string;
  name: string;
  model: string;
}

/** What the swap found before stopping anything. */
export interface SwapPlan {
  sources: Sources;
  /** The real run's options: RPE's data folder, the build, the file tree's layout. */
  options: MigrateOptions;
  /** Today's runtime the run takes: its name and config, the unit that runs it (null: none rpe up can stop), and its loopback. Null where the run takes none. */
  took: { name: string; config: SavedRuntime; unit: string | null; loopback: Loopback } | null;
  /** Where RPE answers once swapped: where today's runtime listened, else where RPE's config says. */
  at: Place;
  /**
   * Every connection in Lumiverse that reaches the runtime the run takes (R-109): each is kept as it
   * is and made RPE's own, marked as RPE's before RPE answers (`RpeStart.mark`), and handed to
   * `rpe up`, which keeps the list in RPE's config and prints it as answered by RPE. Empty where no
   * runtime is taken, or `swapCheck` was given no way to read them.
   */
  connections: TakenConnection[];
  /** The branch the previous build is kept on (`migration.previousBranch`), which every stop's way back names. */
  branch: string;
}

/** RPE's side of the swap, which the command line gives. */
export interface RpeStart {
  /** RPE's service: its unit and the unit's text. */
  service: RpeService;
  text: string;
  /** Whether that unit was there before this swap: it is then stopped while the run writes, the run being the data folder's one writer. */
  installed: boolean;
  /** Writes into RPE's own config and keys what RPE takes of today's; resolves to what puts them back as they were. */
  takeOver(): Promise<() => Promise<void>>;
  /** Whether RPE answers on today's connection in Lumiverse, under today's model name (`takeOver`), rather than on a connection of its own. */
  todays: boolean;
  /** How long RPE's service is given to answer once started, and each ask (RPE's config, `commandLine`). */
  startMs: number;
  waitMs: number;
  /** How often RPE is asked whether it answers yet, once its service is started (RPE's config, `commandLine.askEveryMs`); `ASK_EVERY_MS` where it gives none. */
  askEveryMs?: number;
  /**
   * Marks the connection `id` in Lumiverse as RPE's, or takes the mark off, changing nothing else of
   * it; says whether it changed it. The swap marks each of `plan.connections` after today's service
   * is stopped and before RPE's service starts, and takes off every mark it wrote where it puts back
   * what it did. Needed where the plan holds connections.
   */
  mark?(id: string, on: boolean): Promise<boolean>;
  /**
   * The light extension's registration with RPE: `build` is the build this swap is, which the
   * extension Lumiverse runs must be; `registered` gives the build the extension said at its last
   * registration, null before it has. Waited for within `startMs` of RPE's service starting, since
   * the file on disk is not the backend Lumiverse runs.
   */
  extension?: { build: string; registered(): Promise<string | null> };
  /** RPE's own connections in Lumiverse from before this swap, which nothing answers once it takes today's: kept in the swap's record, for going back. */
  earlier?: readonly string[];
  /** What the switch says to do of a chat holding records of the previous build that its run did not carry: the line that runs the migration again, and the one that goes back. */
  notCarried: NotCarriedSteps;
}

/** How often RPE is asked whether it answers yet, once its service is started, where RPE's config gives none: the default of `commandLine.askEveryMs`. */
const ASK_EVERY_MS = 250;

/** What today's runtime has under way: its turns and its calls; null where nothing of today's answers; "unknown" where what answers doesn't say. */
type UnderWay = { turns: number; requests: number } | "unknown" | null;

/**
 * The proof `GET /healthz` takes that the asker holds the runtime's config (LumiAH `runtime/proof.ts`,
 * which its package doesn't export), so the runtime answers in full wherever it listens:
 * `<at>.<nonce>.<HMAC-SHA256 of "lumiah healthz\n<at>\n<nonce>" under its relay secret>`.
 */
function healthProof(secret: string, at: number): string {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  return `${at}.${nonce}.${new Bun.CryptoHasher("sha256", secret).update(`lumiah healthz\n${at}\n${nonce}`).digest("hex")}`;
}

/** What answers at `base`: RPE (its status says so), something else, or nothing within `ms`. */
async function answering(base: string, ms: number, io: SwapIo): Promise<"rpe" | "other" | null> {
  try {
    const res = await io.fetch(`${base}${STATUS_PATH}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    const body: unknown = await res.json().catch(() => null);
    return res.ok && isRecord(body) && body.name === "rpe" ? "rpe" : "other";
  } catch {
    return null;
  }
}

/**
 * What today's runtime says it has under way (`GET /healthz`, LumiAH `runtime/relay.ts:179-192`).
 * Each ask is given until the next is due; one that gets no answer in that time is from a runtime
 * that is there and doesn't say. RPE answering there, where it took today's runtime's place at an
 * earlier swap, is nothing of today's.
 */
async function underWay(config: SavedRuntime, io: SwapIo): Promise<UnderWay> {
  const base = runtimeBase(config.listen, config.port).replace(/\/v1$/, "");
  let res: Response;
  try {
    res = await io.fetch(`${base}/healthz`, { headers: { Accept: "application/json", Authorization: `Bearer ${healthProof(config.secret, io.now())}` }, signal: AbortSignal.timeout(config.tuning.drainPollMs) });
  } catch (error) {
    return error instanceof Error && error.name === "TimeoutError" ? "unknown" : null;
  }
  const body: unknown = await res.json().catch(() => null);
  if (isRecord(body) && typeof body.turns === "number" && typeof body.requests === "number") return { turns: body.turns, requests: body.requests };
  return (await answering(base, config.tuning.drainPollMs, io)) === "rpe" ? null : "unknown";
}

const busy = (u: UnderWay): boolean => u === "unknown" || (u !== null && u.turns + u.requests > 0);
const said = (u: UnderWay): string => (u === "unknown" || u === null ? "answers, but doesn't say what it has under way" : `has ${u.turns} turn(s) and ${u.requests} request(s) under way`);

/** Waits for today's runtime to be idle, up to its own "Wait before restart" setting, asking every "Restart poll"; whether it is. */
async function idle(identifier: string, name: string, config: SavedRuntime, io: SwapIo): Promise<boolean> {
  const { drainMs, drainPollMs } = config.tuning;
  let now = await underWay(config, io);
  if (!busy(now)) return true;
  io.out(`The previous runtime ${name} ${said(now)}: waiting up to ${Math.round(drainMs / 1000)} seconds (its own "Wait before restart" setting) for it to be idle.`);
  for (let waited = 0; waited < drainMs && busy(now); waited += drainPollMs) {
    await io.sleep(drainPollMs);
    now = await underWay(config, io);
  }
  if (busy(now)) for (const line of stopAfterSwitch({ identifier }, `The previous runtime ${name} still ${said(now)} after ${Math.round(drainMs / 1000)} seconds, and the switch stops nothing while it is busy. Run rpe up again once it is idle.`)) io.out(line);
  return !busy(now);
}

/** Waits for RPE to answer at `base` once its service is started, until the clock reaches `until`, or until `stopped` says the swap was told to stop; whether it answered. */
async function cameUp(base: string, rpe: RpeStart, io: SwapIo, until: number, stopped: () => boolean): Promise<boolean> {
  for (;;) {
    if ((await answering(base, rpe.waitMs, io)) === "rpe") return true;
    if (performance.now() >= until || stopped()) return false;
    await io.sleep(rpe.askEveryMs ?? ASK_EVERY_MS);
  }
}

/** Waits for the light extension to register with RPE, until the clock reaches `until` or `stopped` says the swap was told to stop; the build it said, null where it did not. */
async function registeredBuild(extension: NonNullable<RpeStart["extension"]>, rpe: RpeStart, io: SwapIo, until: number, stopped: () => boolean): Promise<string | null> {
  for (;;) {
    const build = await extension.registered();
    if (build !== null) return build;
    if (performance.now() >= until || stopped()) return null;
    await io.sleep(rpe.askEveryMs ?? ASK_EVERY_MS);
  }
}

/**
 * What would stop `user`'s swap into the data folder `data` for whose it is, by the gate's own two
 * checks (`refusalsOf`): the Lumiverse user RPE's config names (`owner`), and the users earlier runs
 * carried there. Asked once Lumiverse has taken the password and before anything is written, so
 * another user's sign-in, keys or connection never reach an RPE that is not theirs.
 */
export function whoseRefusals(data: string, owner: string | null, user: string): string[] {
  const { users } = earlierRuns(dataPaths(data).database, user);
  return refusalsOf({ rows: [], notClassified: [], disk: { backup: 0, import: 0, total: 0, free: null } }, { user, known: true, owner, earlier: users }, { missing: null, undecided: null });
}

/**
 * Whether the extension Lumiverse has installed is still today's build, by the permissions its
 * manifest asks for: every one the previous build asks for (`PREVIOUS_PERMISSIONS`), twelve of which
 * the light build doesn't. Swapped while it is installed, today's build would go on running in
 * Lumiverse and writing today's storage after the run had read it (§15.3 step 10: the extension is
 * switched first). False where Lumiverse doesn't say what the manifest asks for (`null`).
 */
export function todaysBuildInstalled(permissions: readonly string[] | null): boolean {
  return permissions !== null && PREVIOUS_PERMISSIONS.every((p) => permissions.includes(p));
}

/** The build id a copy run from its sources gives (`src/app/main.ts`): it has no stamp of its own, and every built file holds it, as what its stamp falls back to. */
const FROM_SOURCES = "dev";

/**
 * Why the swap cannot go on for the extension Lumiverse has installed, or null where it can. Every
 * answer says what has changed and what has not, and every one but the first two prints the way back,
 * since each is a stop after the extension was switched to the new build.
 *
 * None is installed (`installed` null): it was removed, not switched, which deleted the extension's
 * own folder and its storage (each user's folder for it stays), so the swap would read storage that
 * is gone and carry its absence over what the real run carried (§4.6; §15.6 step 2). Today's build
 * still installed: its manifest asks for the permissions the previous build asks for. Granted
 * (`granted`, the permissions Lumiverse has granted the extension, null where it doesn't say; left
 * out where the caller reads none): each of the five the light build asks for. Lumiverse loads the
 * backend as the extension's folder holds it and builds nothing where `dist/` is tracked (its
 * `buildExtension`), so a branch switch to a commit whose `dist/` was not built again starts the
 * previous build's backend under the light build's manifest: the backend file Lumiverse loads must
 * carry this build's stamp (`version`), the id `scripts/build.ts` writes into every file it builds,
 * as a JSON string. That file is `dist/backend.js` in the extension's folder, the one both builds'
 * manifests name and Lumiverse's own default. It is the first guard: what Lumiverse runs is read
 * again from RPE's registration once RPE's service is started (`RpeStart.extension`).
 */
export async function otherBuildInstalled(input: { lumiverse: string; identifier: string; version: string; installed: { permissions: readonly string[] | null } | null; granted?: readonly string[] | null }): Promise<string | null> {
  const { identifier, version, installed, granted } = input;
  const stop = (why: string): string => stopAfterSwitch({ identifier }, why).join("\n");
  if (installed === null) return `Lumiverse has no extension (${identifier}) installed: it was removed, not switched to the new build. Removing an extension deletes its own folder and the storage in it (each user's folder for it stays), so what the migration reads there is gone, and the switch does not run the migration again over storage that is gone. The real run's backup holds a copy of it. The switch stopped nothing: the previous build's service runs, and its data is as it was. Install the new build's extension in Lumiverse from its branch (${NEW_BUILD_BRANCH}, until it is main), approve its five permissions (${LIGHT_PERMISSIONS.join(", ")}), then run rpe up again.`;
  if (todaysBuildInstalled(installed.permissions)) return `Lumiverse still has the previous build of the extension (${identifier}) installed: its manifest asks for the permissions the previous build asks for. Switch the installed extension to the new build's branch in Lumiverse and approve its permissions first, then run rpe up again. Nothing was stopped or changed.`;
  if (granted === null) return stop(`Lumiverse does not say which permissions it has granted the extension (${identifier}), so the switch cannot tell whether the new build of the extension can play. In Lumiverse's extension settings, check that ${LIGHT_PERMISSIONS.join(", ")} are granted, then run rpe up again.`);
  const missing = granted === undefined ? [] : LIGHT_PERMISSIONS.filter((p) => !granted.includes(p));
  if (missing.length > 0) return stop(`Lumiverse has not granted the extension (${identifier}) ${missing.join(", ")}, and the new build of the extension cannot play without ${missing.length === 1 ? "it" : "them"}: the switch stops here, before stopping the previous build's service. In Lumiverse's extension settings, grant ${missing.length === 1 ? "it" : "each of them"}, then run rpe up again.`);
  // Where Lumiverse keeps an extension's files (its `repoDir`).
  const repo = join(input.lumiverse, "extensions", identifier, "repo");
  const backend = join(repo, "dist", "backend.js");
  // Lumiverse loads the backend when the extension starts and does not watch its files, so files put in by hand run once it is started again.
  const what = `Switch the installed extension to the new build's branch in Lumiverse, or put the new build's files in its folder (${repo}) and switch the extension off and on in Lumiverse so that it runs them, then run rpe up again.`;
  if (version === FROM_SOURCES) return stop(`This rpe runs from its sources and has no build of its own, so whether the extension Lumiverse has installed (${identifier}) is this build can't be told: run the switch with a built copy, such as ${join(repo, "dist", "rpe.js")} once the extension holds the new build.`);
  const text = await readText(backend);
  if (text === null) return stop(`Lumiverse has the extension (${identifier}) installed, and its backend is not at ${backend}, where Lumiverse loads it from. ${what}`);
  if (!text.includes(JSON.stringify(version))) return stop(`The extension Lumiverse has installed (${identifier}) is another build than this rpe (${version}): its backend, ${backend}, does not carry build ${version}. ${what}`);
  return null;
}

/** What stands of an earlier swap: RPE's service and where RPE answers, today's runtime whose place it took and that runtime's unit (null: it runs under none), and when the last run read today's data. */
export interface Standing {
  unit: string;
  at: string;
  runtime: string;
  todays: string | null;
  since: string;
}

/**
 * Whether an earlier swap stands, read without stopping or changing anything: RPE's service
 * (`rpe.unit`) runs, and RPE answers where it took over the runtime of today's the last real run
 * took, which RPE's config names (`rpe`); and that runtime's unit is switched off, stopped and not
 * started at the next boot. Null where any of it doesn't hold (RPE's service stopped, or today's unit
 * on again after going back): the swap is then made in full.
 */
export async function swapStands(input: { sources: Sources; data: string; rpe: Place & { unit: string }; waitMs: number }, io: SwapIo): Promise<Standing | null> {
  const { sources, rpe } = input;
  if (sources.runtime === null) return null;
  const { previous } = earlierRuns(dataPaths(input.data).database, sources.userId);
  const taken = previous?.runtime?.taken ?? null;
  if (previous === null || taken === null || (sources.runtimeName !== undefined && sources.runtimeName !== taken.name)) return null;
  const config = await runtimeConfig(sources.runtime, sources.identifier, taken.name);
  if (config === null || config.listen !== rpe.address || config.port !== rpe.port) return null;
  const at = localUrl(rpe.address, rpe.port);
  if ((await answering(at, input.waitMs, io)) !== "rpe" || (await io.systemctl(["is-active", "--quiet", rpe.unit])).code !== 0) return null;
  // Today's unit, where it has one: running, or started at the next boot (`is-enabled` says 0), it is on.
  const todays = config.service?.unit ?? null;
  if (todays !== null && ((await io.systemctl(["is-active", "--quiet", todays])).code === 0 || (await io.systemctl(["is-enabled", "--quiet", todays])).code === 0)) return null;
  return { unit: rpe.unit, at, runtime: taken.name, todays, since: previous.at };
}

/** Whether a stored real run's report passed: found equals carried, attached, archived and kept in the backup for every row, and nothing is unclassified. */
function passed(report: MigrationReport): boolean {
  return refusalsOf({ rows: report.rows, notClassified: report.notClassified, disk: { backup: 0, import: 0, total: 0, free: null } }, { user: "", known: true, owner: null, earlier: [] }, { missing: null, undecided: null }).length === 0;
}

/**
 * The swap's reading, before anything is stopped or changed: that this data folder holds a real run
 * of the user's own data whose report passed (§15.3 step 10: the swap comes last, after the migration
 * has been proven on his own data), the gate (a full rehearsal with the real run's refusals), the
 * runtime the run takes and its loopback, every connection in Lumiverse that reaches that runtime
 * (`reach`, which reads them page after page), and where RPE answers once swapped (`rpe`: where RPE's
 * config says now). Null where the swap stops here, having said why, what has changed (the extension
 * was switched to get here) and the way back.
 */
export async function swapCheck(input: { sources: Sources; options: MigrateOptions; rpe: Place; waitMs: number; reach?: (is: Loopback["is"]) => Promise<TakenConnection[]> }, io: SwapIo): Promise<SwapPlan | null> {
  const { sources, options } = input;
  const branch = await previousBranch(dataPaths(options.data).globalConfig);
  const stop = (why: string): null => {
    for (const line of stopAfterSwitch({ identifier: sources.identifier, branch }, why)) io.out(line);
    return null;
  };
  const { previous } = earlierRuns(dataPaths(options.data).database, sources.userId);
  if (previous === null) return stop(`No real run of your own data has been made in this data folder (${options.data}), and the switch goes ahead only once the migration has been proven on it: it stops before it stops anything. Run rpe migrate (rpe migrate --rehearse shows first what it would do), read its report, then run rpe up again.`);
  if (!passed(previous)) return stop(`The last real run in this data folder (read at ${previous.at}) did not pass its report: some row's things are not all carried, attached, archived or kept in the backup, or something found is not classified. The switch goes ahead only once the migration has been proven on your data: run rpe migrate again and read its report, then run rpe up again.`);
  // Read first: a run the gate would refuse stops nothing, and today's build goes on answering.
  const gate = await migrate(sources, { ...options, rehearse: true });
  if (gate.report.refusals.length > 0) {
    io.out(reportText(gate.report).replace(/\n$/, ""));
    return stop("The switch stopped before it stopped anything: the run would be refused, as the report says.");
  }
  // Told there is no runtime, and this user's found all the same: the switch goes on as told, and says what that leaves out.
  if (gate.report.disowned !== undefined) for (const line of disownedLines(gate.report.disowned)) io.out(line);
  const today = await openToday(sources);
  let registry: unknown = null;
  try {
    const text = await today.userView.read("harness/registry.json");
    registry = text === null ? null : JSON.parse(text);
  } catch {
    // A registry today's extension can't read holds no key it reads either.
  } finally {
    today.close();
  }
  const taken = today.runtime.runtimes[0] ?? null;
  let took: SwapPlan["took"] = null;
  if (taken !== null) {
    const { name, config } = taken;
    const model = loopbackModel(sources.identifier);
    const base = runtimeBase(config.listen, config.port);
    // The unit that keeps it running, as the run read it (`runtimeUnit`), where its file is there.
    const unit = config.service !== null && existsSync(config.service.file) ? config.service.unit : null;
    took = { name, config, unit, loopback: { at: { address: config.listen, port: config.port }, model, keyHash: loopbackKeyHash(registry), is: (c) => loopsBack(c, model, [base]) } };
  }
  const at = took?.loopback.at ?? input.rpe;
  // Where no runtime of today's is taken, RPE answers where its config says, and nothing of today's frees that place: whatever else answers there would keep RPE from starting.
  const base = localUrl(at.address, at.port);
  if (took === null && (await answering(base, input.waitMs, io)) === "other") return stop(`Something other than RPE answers at ${base}, where RPE's config has it answer: give RPE a free port ("port" in its config, or RPE_PORT), and run rpe up again.`);
  const connections = took === null || input.reach === undefined ? [] : await input.reach(took.loopback.is);
  return { sources, options, took, at, connections, branch };
}

/**
 * The swap itself, on what `swapCheck` found: waits for today's runtime to be idle, stops it (and
 * RPE's own service, where one runs on this data folder), runs the migration, has RPE take today's
 * loopback, marks every connection it took as RPE's, starts RPE's service and waits for RPE to answer
 * where today's runtime did, and for the light extension to register with it as the build this swap
 * is, and only then switches today's service off. Any failure from the first stop on puts back what
 * was done, the marks included, and so does being told to stop (Ctrl-C, a closed terminal, a kill),
 * once the step under way is done: the process isn't ended in the middle, with neither build
 * answering. The report of the switch's run where it went through; null where it did not.
 */
export async function swapRun(plan: SwapPlan, rpe: RpeStart, io: SwapIo): Promise<MigrationReport | null> {
  const { took } = plan;
  const { identifier } = plan.sources;
  const mark = rpe.mark;
  if (plan.connections.length > 0 && mark === undefined) throw new Error("the switch was given connections to take and no way to mark them as RPE's");
  if (took !== null) {
    if (!(await idle(identifier, took.name, took.config, io))) return null;
    if (took.unit === null && (await underWay(took.config, io)) !== null) {
      for (const line of stopAfterSwitch({ identifier, branch: plan.branch }, `The previous runtime ${took.name} answers at ${took.config.listen}:${took.config.port}, but runs under no unit rpe up can stop: stop it where it runs, then run rpe up again.`)) io.out(line);
      return null;
    }
  }
  const base = localUrl(plan.at.address, plan.at.port);
  // What puts back each step done, in the order done; run in reverse on a failure.
  const undo: { what: string; run: () => Promise<void> }[] = [];
  let told: string | null = null;
  const letGo = io.onStop((signal) => {
    if (told !== null) return;
    told = signal;
    io.out(`Told to stop (${signal}): the switch ends once the step under way is done, and puts back what it did.`);
  });
  const going = (): void => {
    if (told !== null) throw new Error(`it was told to stop (${told})`);
  };
  // The swap's run's report, for the closing lines on the chats that were on today and are on none of RPE's connections.
  let ran: MigrationReport | null = null;
  io.out(`${took === null ? "The switch starts now, and RPE answers" : `The previous runtime ${took.name} stops now, and RPE answers in its place`} once the migration has run again: do not interrupt the switch. Interrupted all the same, it puts back what it did before it ends.`);
  try {
    // Only a unit that runs is stopped, and started again on a failure: one stopped already (today's, after an earlier swap) stays so. systemctl says 3 for a unit that doesn't run.
    for (const unit of [rpe.installed ? rpe.service.unit : null, took?.unit ?? null]) {
      if (unit === null) continue;
      const active = await io.systemctl(["is-active", "--quiet", unit]);
      if (active.code === 3) continue;
      if (active.code !== 0) throw new Error(`systemctl --user is-active ${unit} failed (${active.code})${active.err.trim() === "" ? "" : `: ${active.err.trim()}`}`);
      // Its undo is recorded first: a terminal's Ctrl-C or hang-up reaches the systemctl under way as well as the swap, and the manager finishes a stop whose client was killed. Starting a unit that runs changes nothing.
      undo.push({ what: `${unit} runs again`, run: () => mustRun(io.systemctl, ["start", unit]) });
      await mustRun(io.systemctl, ["stop", unit]);
      going();
    }
    let run: MigrateResult;
    try {
      run = await migrate(plan.sources, plan.options);
    } catch (error) {
      throw new Error(`the migration stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A chat holding records of the previous build that the run did not carry is named first, ahead of the report; the switch goes on as the plan has it.
    for (const line of notCarriedLines(notCarriedOf(run.report), rpe.notCarried)) io.out(line);
    io.out(reportText(run.report).replace(/\n$/, ""));
    if (!run.ran) throw new Error("the run was refused, as the report says");
    going();
    ran = run.report;
    // The cutover, recorded for going back: the identifier used, the connections taken, RPE's own earlier ones, and each chat left off RPE's connections with the one it was on.
    const record: SwapRecord = { at: run.report.at, identifier, lumiverse: plan.sources.lumiverse, taken: plan.connections.map((c) => c.id), earlier: [...(rpe.earlier ?? [])], chats: (run.report.offRpe ?? []).map((c) => ({ chat: c.chat, pinned: c.pinned })), keyTaken: took !== null && took.loopback.keyHash !== null };
    const database = dataPaths(plan.options.data).database;
    try {
      onRpe(database, (db) => keepSwap(db, plan.sources.userId, record));
      undo.push({ what: "the switch's record is taken out", run: async () => onRpe(database, (db) => dropSwap(db, plan.sources.userId, record.at)) });
    } catch (error) {
      io.out(`The switch's record could not be kept (${error instanceof Error ? error.message : String(error)}): going back will not name the chats moved onto RPE's connections since, nor RPE's own earlier connection.`);
    }
    const putBack = await rpe.takeOver();
    undo.push({ what: "RPE's config is as it was", run: putBack });
    // Each connection that reaches today's runtime is made RPE's own, before RPE answers it, in its own metadata and nothing else of it; a mark it did not write is not taken off again.
    for (const connection of plan.connections) {
      going();
      if (mark !== undefined && (await mark(connection.id, true))) undo.push({ what: `the mark on "${connection.name}" (${connection.id}) is taken off`, run: async () => void (await mark(connection.id, false)) });
    }
    // Stopped again before the marks come off and the units stopped above start again: RPE's own, with its config put back, and today's.
    undo.push(rpe.installed ? { what: `${rpe.service.unit} is stopped`, run: () => mustRun(io.systemctl, ["stop", rpe.service.unit]) } : { what: `${rpe.service.unit} is removed`, run: () => removeRpeService(rpe.service, io.systemctl) });
    going();
    // RPE has `startMs` from here to answer and for the extension to register with it.
    const until = performance.now() + rpe.startMs;
    await startRpeService(rpe.service, rpe.text, io.systemctl);
    const answered = await cameUp(base, rpe, io, until, () => told !== null);
    going();
    if (!answered) throw new Error(`RPE did not answer at ${base} within ${Math.round(rpe.startMs / 1000)} seconds of its service starting (its log: journalctl --user -u ${rpe.service.unit})`);
    // The file on disk is not the backend Lumiverse runs: the build the extension says at its registration is.
    if (rpe.extension !== undefined) {
      const runs = await registeredBuild(rpe.extension, rpe, io, until, () => told !== null);
      going();
      if (runs === null) throw new Error(`the new build of the extension did not register with RPE within ${Math.round(rpe.startMs / 1000)} seconds of RPE's service starting, so RPE could not play`);
      if (runs !== rpe.extension.build) throw new Error(`the extension Lumiverse runs is build ${runs}, not this build (${rpe.extension.build}): Lumiverse loads the backend when the extension starts, and it started another`);
    }
    if (took?.unit) await mustRun(io.systemctl, ["disable", took.unit]);
  } catch (error) {
    // Told to stop, the step under way may fail of the same signal, its systemctl being in the terminal's process group: the signal is why the swap ended.
    io.out(`The switch did not go through: ${told !== null ? `it was told to stop (${told})` : error instanceof Error ? error.message : String(error)}.`);
    const putBack: string[] = [];
    const failed: string[] = [];
    for (const step of undo.reverse()) {
      try {
        await step.run();
        putBack.push(step.what);
      } catch (why) {
        failed.push(`${step.what}: ${why instanceof Error ? why.message : String(why)}`);
      }
    }
    io.out(putBack.length > 0 ? `Put back as it was: ${putBack.join("; ")}.` : "Nothing was stopped.");
    for (const line of failed) io.out(`Could not be put back, do it by hand: ${line}.`);
    // Today's service runs again, and what the swap did to Lumiverse stays what the switch did: said, with the way back.
    if (failed.length === 0) for (const line of stopAfterSwitch({ identifier, branch: plan.branch }, "Nothing of the previous build's was changed.")) io.out(line);
    return null;
  } finally {
    letGo();
  }
  io.out(`Started ${rpe.service.unit}, RPE's service: RPE answers at ${base}${took === null ? "" : `, where the previous runtime ${took.name} did${rpe.todays ? `, under its model name (${took.loopback.model})` : ""}${took.loopback.keyHash === null ? "" : `${rpe.todays ? " and" : ","} with its key`}`}.`);
  if (took?.unit) io.out(`Stopped and switched off ${took.unit}, the previous build's service. Its unit, and the previous runtime's config and folders, stay as they were, for going back.`);
  if (ran !== null) for (const line of offRpeLines(plan, ran)) io.out(line);
  return ran;
}

/** Runs `use` on RPE's database at `file`, open for writing while the swap is its one writer. */
function onRpe(file: string, use: (db: Database) => void): void {
  const db = new Database(file);
  try {
    use(db);
  } finally {
    db.close();
  }
}

/** An old engine in words, as he knows it. */
const ENGINE_WORDS: Readonly<Record<NonNullable<ChatReport["engine"]>, string>> = { classic: "the classic pipeline", agents: "the agents engine", harness: "the harness engine" };

/**
 * The swap's closing lines on the chats that were on today and are on none of RPE's connections (N-14's
 * default: RPE writes nothing into his chats): each by its name and the engine that played it, with the
 * one step that puts it on RPE. Names are read from Lumiverse's database; a chat it cannot name is given
 * by its id.
 */
function offRpeLines(plan: SwapPlan, report: MigrationReport): string[] {
  const chats = report.offRpe ?? [];
  if (chats.length === 0) return [];
  const names = new Map<string, string>();
  try {
    const db = LumiverseDb.open(plan.sources.lumiverse, plan.sources.userId);
    try {
      for (const c of db.chats()) names.set(c.id, `"${c.name}"`);
      for (const p of db.connectionProfiles()) names.set(`connection ${p.id}`, `"${p.name}"`);
    } finally {
      db.close();
    }
  } catch {
    // Unnamed, each is given by its id.
  }
  const engines = new Map((report.chats ?? []).map((c) => [c.chatId, c.engine]));
  const rpe = plan.connections.length === 0 ? "the connection RPE answers on" : `one of RPE's connections (${plan.connections.map((c) => `"${c.name}"`).join(", ")})`;
  return [
    `${chats.length === 1 ? "One chat was" : `${chats.length} chats were`} on the previous build and ${chats.length === 1 ? "is" : "are"} on none of RPE's connections: RPE plays only what reaches it on its own connections, and writes nothing into your chats. In Lumiverse, choose ${rpe} as each one's connection, and it is on RPE.`,
    ...chats.map((c) => {
      const engine = engines.get(c.chat) ?? null;
      return `  ${names.get(c.chat) ?? c.chat}, played by ${engine === null ? "the previous build" : ENGINE_WORDS[engine]}: ${c.pinned === null ? "on no connection of its own, so it follows the one active for you" : `on ${names.get(`connection ${c.pinned}`) ?? `the connection ${c.pinned}`}`}`;
    }),
  ];
}
