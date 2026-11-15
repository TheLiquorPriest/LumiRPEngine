// `rpe up`'s part on this machine (plan §4.6): RPE's service, which `rpe up` installs and `rpe down`
// removes: a systemd user unit of the account, as today's runtime runs under one (LumiAH
// `runtime/update/service.ts`), found again by the data folder its first lines name; and where a
// program on this machine reaches RPE. The command line signs in and hands over its calls and the
// account's systemctl; its calls into Lumiverse are the adapter's (`adapter/lumiverse/install-calls.ts`),
// and this file names no other area.

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appCopyPlaces, copiedFile } from "./app-copy";
import type { Env } from "./config";
import { writeWhole } from "./disk";

/** Where a program on this machine reaches what listens on `address` at `port`: an address that takes every one of the machine's is reached on its loopback. */
export function localUrl(address: string, port: number): string {
  const host = address === "0.0.0.0" ? "127.0.0.1" : address === "::" ? "[::1]" : address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

/** What a run of systemctl gave. */
export interface Ran {
  code: number;
  out: string;
  err: string;
}

/** `systemctl --user <args>`: the account's own service manager. */
export type Systemctl = (args: readonly string[]) => Promise<Ran>;

/**
 * A program of the account, found on the PATH the command line was given, as the account runs it:
 * where its service manager is found by XDG_RUNTIME_DIR, which `sudo -u <account>` leaves unset (the
 * account's is /run/user/<uid>). A program that is not there answers 127, with the words that say so.
 */
export type Program = (command: string, args: readonly string[]) => Promise<Ran>;

export function accountProgram(env: Env, uid: number | null): Program {
  return async (command, args) => {
    const path = Bun.which(command, { PATH: env.PATH ?? "" });
    if (path === null) return { code: 127, out: "", err: `There is no ${command} on this machine's PATH.` };
    const runtimeDir = env.XDG_RUNTIME_DIR ?? (uid === null ? undefined : `/run/user/${uid}`);
    const vars = Object.fromEntries(Object.entries({ ...env, ...(runtimeDir === undefined ? {} : { XDG_RUNTIME_DIR: runtimeDir }) }).filter((e): e is [string, string] => e[1] !== undefined));
    const proc = Bun.spawn([path, ...args], { env: vars, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  };
}

/** `systemctl --user <args>`: the account's own service manager, as today's runtime reaches it (LumiAH `systemctlOf`). */
export function accountSystemctl(env: Env, uid: number | null): Systemctl {
  const run = accountProgram(env, uid);
  return async (args) => {
    const ran = await run("systemctl", ["--user", ...args]);
    return ran.code === 127 ? { ...ran, err: "There is no systemctl on this machine's PATH: RPE's service, as today's runtime's, is a systemd user unit." } : ran;
  };
}

/**
 * Whether the account's units start at boot and outlive a logout (systemd-logind's lingering): on
 * already, or turned on now (logind lets an account do it for itself where its policy allows); else why
 * not, with the line that does it.
 */
export async function lingering(run: Program, account: string): Promise<{ on: boolean; turnedOn: boolean; why: string | null }> {
  const on = async (): Promise<boolean> => (await run("loginctl", ["show-user", account, "--property=Linger", "--value"])).out.trim() === "yes";
  if (await on()) return { on: true, turnedOn: false, why: null };
  const asked = await run("loginctl", ["enable-linger", account]);
  if (asked.code === 0 && (await on())) return { on: true, turnedOn: true, why: null };
  return { on: false, turnedOn: false, why: `Lingering is off for ${account} and could not be turned on from here${asked.err.trim() === "" ? "" : ` (${asked.err.trim()})`}: RPE's service will not start at boot and stops when you log out. Turn it on with: sudo loginctl enable-linger ${account}` };
}

/** Runs systemctl and throws its own words when it fails. */
export async function mustRun(systemctl: Systemctl, args: readonly string[]): Promise<void> {
  const ran = await systemctl(args);
  if (ran.code !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed (${ran.code})${ran.err.trim() === "" ? "" : `: ${ran.err.trim()}`}`);
}

/** Where the account's user units are (systemd's rule, and today's runtime's): `$XDG_CONFIG_HOME/systemd/user` where that is absolute, else `~/.config/systemd/user`. */
export function unitFolder(env: Env, home: string): string {
  const config = env.XDG_CONFIG_HOME;
  return join(config !== undefined && config.startsWith("/") ? config : join(home, ".config"), "systemd", "user");
}

/** RPE's service: its unit `rpe-<name>.service` and the unit's file. */
export interface RpeService {
  name: string;
  unit: string;
  file: string;
}

/** The line of RPE's unit that names its data folder: how `rpe down` and the next `rpe up` find it. */
const DATA_LINE = "# RPE's data folder: ";

/** A unit's name for RPE's service: `rpe-<name>.service`, in the account's user units. */
export function rpeService(name: string, env: Env, home: string): RpeService {
  const unit = `rpe-${name}.service`;
  return { name, unit, file: join(unitFolder(env, home), unit) };
}

/** The most a unit's name may hold, with its suffix (systemd.unit(5)): there is no length of RPE's own. */
const UNIT_NAME_MOST = 255;

/**
 * Why `name` cannot be the name of RPE's service, by systemd's own rule for a unit's name (its
 * ASCII letters, digits and `: _ . \ -`, the whole name with `rpe-` and `.service` at most 255
 * characters); null where it can.
 */
export function unitNameRefusal(name: string): string | null {
  if (!/^[A-Za-z0-9:_.\\-]+$/.test(name)) return "a unit's name is made of ASCII letters, digits and these: : _ . \\ -";
  const unit = `rpe-${name}.service`;
  return unit.length > UNIT_NAME_MOST ? `the unit's name, ${unit.length} characters with its "rpe-" and ".service", is more than the ${UNIT_NAME_MOST} systemd allows` : null;
}

/** A service name made from a Lumiverse username, held to systemd's rule for a unit's name: what the rule does not take becomes `-`, and it is cut only where the rule's own length ends it. */
export function serviceNameOf(username: string): string {
  const room = UNIT_NAME_MOST - "rpe-.service".length;
  return (
    username
      .toLowerCase()
      .replace(/[^a-z0-9:_.\\-]+/g, "-")
      .replace(/^[-_.]+/, "")
      .slice(0, room) || "rpe"
  );
}

/** A word of a unit's ExecStart: quoted when it must be, `%` and `$` escaped (systemd.service(5)); no control character, which would start a line of its own. */
function unitWord(word: string): string {
  if (/[\u0000-\u001f\u007f]/.test(word)) throw new Error(`A path for RPE's unit holds a control character (${JSON.stringify(word)}): no unit is written with it.`);
  const escaped = word.replace(/%/g, "%%").replace(/\$/g, "$$$$");
  return /^[A-Za-z0-9_@%+=:,./$-]+$/.test(escaped) ? escaped : `"${escaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** What RPE's unit holds besides its name. */
export interface UnitFacts {
  name: string;
  /** The Bun the service runs, by its real path. */
  bun: string;
  /** RPE's data folder: its installed copy is what the unit runs. */
  data: string;
  /** No more than `tries` starts within `windowMs` (`update.startTries`, `update.startWindow`): the one start after the last allowed to a swapped-in build is the known-good copy's. */
  startLimit: { tries: number; windowMs: number };
  /** The unit's `MemoryMax` (`service.memory`). */
  memory: string;
  /** Seconds before the service is started again (`service.restartWait`). */
  restartWait: number;
}

/**
 * RPE's unit: `rpe serve` on its data folder, run from RPE's installed copy and never from the
 * extension's file (R-13), by the Bun `rpe up` ran with, always restarted, as today's runtime's unit is,
 * held to its memory cap, and started no more than `tries` times within the window (the settings
 * `update.startTries` and `update.startWindow`) besides the one start that puts back the known-good
 * copy: a build that cannot serve, such as one an update put in place, is first put back, and one that
 * still cannot is left stopped, and `systemctl --user status` says it failed, rather than started
 * every two seconds for good. Its pre-start step is the copy's own, written at install, which an
 * update does not replace.
 */
export function rpeUnitText(u: UnitFacts): string {
  const places = appCopyPlaces(u.data);
  const exec = [u.bun, copiedFile(u.data), "serve", "--data", u.data].map(unitWord).join(" ");
  const before = [u.bun, places.beforeStart, u.data, String(u.startLimit.tries)].map(unitWord).join(" ");
  return [
    `# Written by \`rpe up --systemd\`: RPE's service. \`rpe down\` stops and removes it, and leaves RPE's data where it is.`,
    `${DATA_LINE}${u.data}`,
    "[Unit]",
    `Description=RPE (${u.name})`,
    `StartLimitIntervalSec=${Math.round(u.startLimit.windowMs / 1000)}`,
    `StartLimitBurst=${u.startLimit.tries + 1}`,
    "",
    "[Service]",
    "Type=simple",
    `ExecStartPre=${before}`,
    `ExecStart=${exec}`,
    "Restart=always",
    `RestartSec=${u.restartWait}`,
    // The cap: past it systemd stops RPE (and starts it again) rather than let it take the machine's memory from Lumiverse.
    `MemoryMax=${u.memory}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** RPE's service for the data folder `data`: the unit among the account's whose data line names it; null where there is none. */
export async function rpeServiceOf(data: string, env: Env, home: string): Promise<RpeService | null> {
  const folder = unitFolder(env, home);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return null;
  }
  for (const unit of names.sort()) {
    const name = /^rpe-(.+)\.service$/.exec(unit)?.[1];
    if (name === undefined) continue;
    const text = await readFile(join(folder, unit), "utf8").catch(() => "");
    if (text.split("\n").includes(`${DATA_LINE}${data}`)) return { name, unit, file: join(folder, unit) };
  }
  return null;
}

/** Writes RPE's unit, whole in one step, and starts it: enabled, so the account's manager starts it again after a reboot, and restarted, so it runs what was just written. */
export async function startRpeService(service: RpeService, text: string, systemctl: Systemctl): Promise<void> {
  await mkdir(dirname(service.file), { recursive: true, mode: 0o755 });
  await writeWhole(service.file, text, 0o644);
  await mustRun(systemctl, ["daemon-reload"]);
  await mustRun(systemctl, ["enable", service.unit]);
  await mustRun(systemctl, ["restart", service.unit]);
}

/** Stops RPE's service and removes its unit; RPE's data folder is not touched. */
export async function removeRpeService(service: RpeService, systemctl: Systemctl): Promise<void> {
  await mustRun(systemctl, ["disable", "--now", service.unit]);
  await rm(service.file, { force: true });
  await mustRun(systemctl, ["daemon-reload"]);
}
