// `rpe up --systemd`: RPE as a service of the account (plan §4.6; READINGS R-13). It runs RPE's own
// installed copy under a user unit, as today's runtime runs under one (LumiAH's `up --systemd`): what
// stops it before anything is written, the lingering the unit needs, the wait for the turns under way
// before a running RPE is restarted, and the copy and the unit written.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appCopyPlaces, copiedFile, installCopy, isInstalledCopy } from "../app-copy";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { COMMAND_PATHS } from "../command-routes";
import { accountProgram, accountSystemctl, lingering, removeRpeService, type RpeService, rpeUnitText, startRpeService } from "../up";
import type { UpdateSettings } from "../update";
import { isRecord } from "../../shared/json";
import { lumiverseFolderOf } from "./lumiverse-folder";
import { changeableRefusal } from "./safety";
import { shellWord } from "../../migrate/going-back";
import { runLine } from "./run-line";
import { runningServer, type WriterContext } from "./writer";

/** The machine, as the command line reads it. */
export interface Host {
  platform: string;
  uid: number | null;
  bun: string;
}

/** Whether RPE can be a systemd service here; if not, why not. */
export type Manager = { systemd: true } | { systemd: false; why: string };

/** The folder at `path` or the nearest one above it that is there. */
function nearestExisting(path: string): string {
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  return at;
}

/**
 * What `--systemd` can do here, decided before anything is written. It is refused (an error, nothing
 * changed) as root, whose account has no service manager of its own; for an RPE run from its sources;
 * and where the app file, the Bun, or a folder above them or above RPE's data folder is one another
 * account could change. Without systemd (macOS, Windows, a container, no systemctl) it answers why, and
 * `rpe up` says how to keep RPE running there and serves in the foreground instead.
 */
export async function managerOf(io: CliIO, host: Host, appFile: string | undefined, bun: string, paths: DataPaths): Promise<Manager> {
  if (host.platform !== "linux") return { systemd: false, why: `this is ${host.platform === "darwin" ? "macOS" : host.platform === "win32" ? "Windows" : host.platform}` };
  if (host.uid === 0) throw new Error("--systemd installs a service of your own account, and root's account has none on most systems. Run RPE as the account Lumiverse runs as (sudo -u <account> …): it needs no more rights than that. Nothing was changed.");
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return { systemd: false, why: "this is a container, where there is no systemd and 127.0.0.1 is the container's own" };
  if (Bun.which("systemctl", { PATH: io.env.PATH ?? "" }) === null) return { systemd: false, why: "there is no systemctl on this machine's PATH" };
  if (appFile === undefined || /\.ts$/.test(appFile)) throw new Error(`The service runs a built RPE, and this runs from source${appFile === undefined ? "" : ` (${appFile})`}. Build first (bun run build), then run dist/rpe.js. Nothing was changed.`);
  if (host.uid !== null) {
    const refusal = await changeableRefusal([appFile, bun, nearestExisting(paths.root)], host.uid, io.env);
    if (refusal !== null) throw new Error(`${refusal}\nNothing was changed.`);
  }
  return { systemd: true };
}

/**
 * What `rpe up --systemd` says where there is no systemd: that, and how to keep RPE running there. It still runs on a copy of its own
 * (R-13): the line to keep running is that copy's. Nothing restarts it onto an update there, so an update of the extension reaches the
 * copy when this is run again, and RPE is then restarted by hand. With no single app file to copy, the line is `rpe serve`.
 */
export function withoutSystemd(why: string, io: CliIO, paths: DataPaths, bun: string, appFile: string | undefined): string[] {
  const data = resolve(paths.root);
  const keep = appFile === undefined ? runLine(io, paths, "serve") : [bun, copiedFile(data), "serve", "--data", data].map(shellWord).join(" ");
  return [
    `--systemd installs a systemd service, and ${why}, so none is installed here; ${appFile === undefined ? "" : "RPE's own copy is, and "}RPE runs in the foreground below instead.`,
    `To keep RPE running here, have your system start this line when you log in and again whenever it stops: ${keep}`,
    "On macOS that is launchd, on Windows Task Scheduler, in a container a second process or a compose service that shares Lumiverse's network (127.0.0.1 is then the same for both); docs/install.md, \"Keep it running on macOS, Windows and in a container\", has the entries.",
    appFile === undefined
      ? "RPE does not restart itself onto an update there: stop it and start it again after you update the extension."
      : `RPE does not restart itself onto an update there: after you update the extension, run ${runLine(io, paths, "up", "--systemd")} again, which puts the new build in RPE's copy, then restart RPE.`,
  ];
}

/** Waits for the turns and jobs a running RPE has under way to end, at most `waitMs`, asking every `lookMs`; says so once. A stopped RPE has none. */
export async function waitForTurns(ctx: WriterContext, waitMs: number, lookMs: number): Promise<void> {
  const { io, paths, config } = ctx;
  const began = performance.now();
  let said = false;
  for (;;) {
    const server = await runningServer(paths, config, io);
    if (server === null) return;
    const res = await server.api("GET", COMMAND_PATHS.busy);
    const body: unknown = await res.json().catch(() => null);
    const busy = isRecord(body) && typeof body.busy === "number" ? body.busy : 0;
    if (busy === 0) return;
    if (!said) {
      said = true;
      io.out(`RPE has ${busy} turn(s) or job(s) under way: waiting up to ${Math.round(waitMs / 1000)} s for them to end before RPE's service is restarted.`);
    }
    const waited = performance.now() - began;
    if (waited >= waitMs) {
      io.out(`${busy} still under way after ${Math.round(waitMs / 1000)} s: restarting RPE's service all the same.`);
      return;
    }
    await Bun.sleep(Math.min(lookMs, waitMs - waited));
  }
}

/** What the service is installed with. */
export interface ServiceInstall {
  ctx: WriterContext;
  config: AppConfig;
  host: Host;
  bun: string;
  /** The file this `rpe up` ran from: copied, and recorded as the one source of updates. */
  appFile: string;
  service: RpeService;
  /** The service already there for this data folder, if any: removed where it has another name. */
  existing: RpeService | null;
  update: UpdateSettings;
}

/**
 * The unit's text for the install: RPE's installed copy under the unit's `service.memory`, restart wait
 * and start limit.
 */
export function unitFor(i: Pick<ServiceInstall, "config" | "bun" | "service" | "update"> & { data: string }): string {
  return rpeUnitText({ name: i.service.name, bun: i.bun, data: i.data, startLimit: { tries: i.update.startTries, windowMs: i.update.startWindowMs }, memory: i.config.service.memory, restartWait: i.config.service.restartWait });
}

/**
 * Installs the service: lingering is turned on for the account first (it starts the account's service
 * manager, which `systemctl --user` needs), a running RPE is given the time to finish the turns under
 * way, the copy of RPE and the unit are written, and the service is started. The copy is made only
 * after the wait, so a running RPE is not changed under its turns.
 */
export async function installService(i: ServiceInstall): Promise<void> {
  const { ctx, config, host, service, existing, update } = i;
  const { io, paths } = ctx;
  const data = resolve(paths.root);
  const program = accountProgram(io.env, host.uid);
  const account = (await program("id", ["-nu"])).out.trim();
  if (account !== "") {
    const linger = await lingering(program, account);
    if (linger.turnedOn) io.out(`Turned lingering on for ${account}, so RPE's service starts at boot and keeps running after you log out.`);
    if (linger.why !== null) io.err(linger.why);
  }
  const systemctl = accountSystemctl(io.env, host.uid);
  await waitForTurns({ ...ctx, config }, config.service.drainWaitMs, update.lookEveryMs);
  await installCopy(data, i.appFile, io.now());
  if (!isInstalledCopy(i.appFile, data) && lumiverseFolderOf(i.appFile) === null) io.out(`RPE was set up from ${i.appFile}, which is not the extension's own folder in Lumiverse: updates will come only from that copy, so update that copy to update RPE (${runLine(io, paths, "status")} names the file).`);
  const text = unitFor({ config, bun: i.bun, service, update, data });
  if (existing !== null && existing.unit !== service.unit) await removeRpeService(existing, systemctl);
  await startRpeService(service, text, systemctl);
  io.out(`Installed RPE's own copy in ${appCopyPlaces(data).current} and ${service.unit}, which runs it (memory cap ${config.service.memory}); started.`);
}
