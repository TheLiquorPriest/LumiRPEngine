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
// its own install line brings it back (§15.6 step 4); and it never calls Lumiverse.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loopbackModel, loopsBack, runtimeBase } from "lumi-ah/link";
import { STATUS_PATH } from "../app/app";
import { dataPaths } from "../app/config";
import { localUrl, mustRun, removeRpeService, type RpeService, startRpeService, type Systemctl } from "../app/up";
import { isRecord } from "../shared/json";
import { readText } from "./files";
import { PREVIOUS_PERMISSIONS } from "./going-back";
import { loopbackKeyHash } from "./inside";
import { earlierRuns, migrate, type MigrateOptions, type MigrateResult } from "./migrate";
import { refusalsOf, reportText } from "./report";
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

/** What the swap found before stopping anything. */
export interface SwapPlan {
  sources: Sources;
  /** The real run's options: RPE's data folder, the build, the file tree's layout. */
  options: MigrateOptions;
  /** Today's runtime the run takes: its name and config, the unit that runs it (null: none rpe up can stop), and its loopback. Null where the run takes none. */
  took: { name: string; config: SavedRuntime; unit: string | null; loopback: Loopback } | null;
  /** Where RPE answers once swapped: where today's runtime listened, else where RPE's config says. */
  at: Place;
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
}

/** Fixed: how often RPE is asked whether it answers yet, once its service is started. */
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
async function idle(name: string, config: SavedRuntime, io: SwapIo): Promise<boolean> {
  const { drainMs, drainPollMs } = config.tuning;
  let now = await underWay(config, io);
  if (!busy(now)) return true;
  io.out(`Today's runtime ${name} ${said(now)}: waiting up to ${Math.round(drainMs / 1000)} seconds (its own "Wait before restart" setting) for it to be idle.`);
  for (let waited = 0; waited < drainMs && busy(now); waited += drainPollMs) {
    await io.sleep(drainPollMs);
    now = await underWay(config, io);
  }
  if (busy(now)) io.out(`Today's runtime ${name} still ${said(now)} after ${Math.round(drainMs / 1000)} seconds: nothing was stopped or changed. Run rpe up again once it is idle.`);
  return !busy(now);
}

/** Waits for RPE to answer at `base` once its service is started, up to `rpe.startMs` by the clock, or until `stopped` says the swap was told to stop; whether it answered. */
async function cameUp(base: string, rpe: RpeStart, io: SwapIo, stopped: () => boolean): Promise<boolean> {
  const until = performance.now() + rpe.startMs;
  for (;;) {
    if ((await answering(base, rpe.waitMs, io)) === "rpe") return true;
    if (performance.now() >= until || stopped()) return false;
    await io.sleep(ASK_EVERY_MS);
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
 * Why the extension Lumiverse has installed is not this build (`version`), or null where it is or
 * where none is installed (`installed`, as Lumiverse lists it). Lumiverse loads the backend as the
 * extension's folder holds it and builds nothing where `dist/` is tracked (its `buildExtension`), so
 * a branch switch to a commit whose `dist/` was not built again starts the previous build's backend
 * under the light build's manifest. So besides the manifest's permissions, the backend file
 * Lumiverse loads must carry this build's stamp: the id `scripts/build.ts` writes into every file it
 * builds, as a JSON string. That file is `dist/backend.js` in the extension's folder, the one both
 * builds' manifests name and Lumiverse's own default.
 */
export async function otherBuildInstalled(input: { lumiverse: string; identifier: string; version: string; installed: { permissions: readonly string[] | null } | null }): Promise<string | null> {
  const { identifier, version, installed } = input;
  if (installed === null) return null;
  if (todaysBuildInstalled(installed.permissions)) return `Lumiverse still has today's build of the extension (${identifier}) installed: its manifest asks for the permissions the previous build asks for. Switch the installed extension to the new build's branch in Lumiverse and approve its permissions first, then run rpe up again.`;
  // Where Lumiverse keeps an extension's files (its `repoDir`).
  const repo = join(input.lumiverse, "extensions", identifier, "repo");
  const backend = join(repo, "dist", "backend.js");
  // Lumiverse loads the backend when the extension starts and does not watch its files, so files put in by hand run once it is started again.
  const what = `Switch the installed extension to the new build's branch in Lumiverse, or put the new build's files in its folder (${repo}) and switch the extension off and on in Lumiverse so that it runs them, then run rpe up again.`;
  if (version === FROM_SOURCES) return `This rpe runs from its sources and has no build of its own, so whether the extension Lumiverse has installed (${identifier}) is this build can't be told: run the swap with a built copy, such as ${join(repo, "dist", "rpe.js")} once the extension holds the new build.`;
  const text = await readText(backend);
  if (text === null) return `Lumiverse has the extension (${identifier}) installed, and its backend is not at ${backend}, where Lumiverse loads it from. ${what}`;
  if (!text.includes(JSON.stringify(version))) return `The extension Lumiverse has installed (${identifier}) is another build than this rpe (${version}): its backend, ${backend}, does not carry build ${version}. ${what}`;
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

/**
 * The swap's reading, before anything is stopped or changed: the gate (a full rehearsal with the
 * real run's refusals), the runtime the run takes and its loopback, and where RPE answers once
 * swapped (`rpe`: where RPE's config says now). Null where the swap stops here, having said why.
 */
export async function swapCheck(input: { sources: Sources; options: MigrateOptions; rpe: Place; waitMs: number }, io: SwapIo): Promise<SwapPlan | null> {
  const { sources, options } = input;
  // Read first: a run the gate would refuse stops nothing, and today's build goes on answering.
  const gate = await migrate(sources, { ...options, rehearse: true });
  if (gate.report.refusals.length > 0) {
    io.out(reportText(gate.report).replace(/\n$/, ""));
    io.out("The swap stopped before anything was stopped or changed: the run would be refused, as the report says.");
    return null;
  }
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
  if (took === null && (await answering(base, input.waitMs, io)) === "other") {
    io.out(`Something other than RPE answers at ${base}, where RPE's config has it answer: give RPE a free port ("port" in its config, or RPE_PORT), and run rpe up again. Nothing was stopped or changed.`);
    return null;
  }
  return { sources, options, took, at };
}

/**
 * The swap itself, on what `swapCheck` found: waits for today's runtime to be idle, stops it (and
 * RPE's own service, where one runs on this data folder), runs the migration, has RPE take today's
 * loopback, starts RPE's service and waits for RPE to answer where today's runtime did, and only
 * then switches today's service off. Any failure from the first stop on puts back what was done, and
 * so does being told to stop (Ctrl-C, a closed terminal, a kill), once the step under way is done:
 * the process isn't ended in the middle, with neither build answering. Whether it went through.
 */
export async function swapRun(plan: SwapPlan, rpe: RpeStart, io: SwapIo): Promise<boolean> {
  const { took } = plan;
  if (took !== null) {
    if (!(await idle(took.name, took.config, io))) return false;
    if (took.unit === null && (await underWay(took.config, io)) !== null) {
      io.out(`Today's runtime ${took.name} answers at ${took.config.listen}:${took.config.port}, but runs under no unit rpe up can stop: stop it where it runs, then run rpe up again. Nothing was stopped or changed.`);
      return false;
    }
  }
  const base = localUrl(plan.at.address, plan.at.port);
  // What puts back each step done, in the order done; run in reverse on a failure.
  const undo: { what: string; run: () => Promise<void> }[] = [];
  let told: string | null = null;
  const letGo = io.onStop((signal) => {
    if (told !== null) return;
    told = signal;
    io.out(`Told to stop (${signal}): the swap ends once the step under way is done, and puts back what it did.`);
  });
  const going = (): void => {
    if (told !== null) throw new Error(`it was told to stop (${told})`);
  };
  io.out(`${took === null ? "The swap starts now, and RPE answers" : `Today's runtime ${took.name} stops now, and RPE answers in its place`} once the migration has run again: do not interrupt the swap. Interrupted all the same, it puts back what it did before it ends.`);
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
    io.out(reportText(run.report).replace(/\n$/, ""));
    if (!run.ran) throw new Error("the run was refused, as the report says");
    going();
    const putBack = await rpe.takeOver();
    undo.push({ what: "RPE's config is as it was", run: putBack });
    // Stopped again before the units stopped above start again: RPE's own, with its config put back, and today's.
    undo.push(rpe.installed ? { what: `${rpe.service.unit} is stopped`, run: () => mustRun(io.systemctl, ["stop", rpe.service.unit]) } : { what: `${rpe.service.unit} is removed`, run: () => removeRpeService(rpe.service, io.systemctl) });
    going();
    await startRpeService(rpe.service, rpe.text, io.systemctl);
    const answered = await cameUp(base, rpe, io, () => told !== null);
    going();
    if (!answered) throw new Error(`RPE did not answer at ${base} within ${Math.round(rpe.startMs / 1000)} seconds of its service starting (its log: journalctl --user -u ${rpe.service.unit})`);
    if (took?.unit) await mustRun(io.systemctl, ["disable", took.unit]);
  } catch (error) {
    // Told to stop, the step under way may fail of the same signal, its systemctl being in the terminal's process group: the signal is why the swap ended.
    io.out(`The swap did not go through: ${told !== null ? `it was told to stop (${told})` : error instanceof Error ? error.message : String(error)}.`);
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
    if (failed.length === 0) io.out("Nothing of today's was changed.");
    return false;
  } finally {
    letGo();
  }
  io.out(`Started ${rpe.service.unit}, RPE's service: RPE answers at ${base}${took === null ? "" : `, where today's runtime ${took.name} did${rpe.todays ? `, under its model name (${took.loopback.model})` : ""}${took.loopback.keyHash === null ? "" : `${rpe.todays ? " and" : ","} with its key`}`}.`);
  if (took?.unit) io.out(`Stopped and switched off ${took.unit}, today's service. Its unit, and today's runtime's config and folders, stay as they were, for going back.`);
  return true;
}
