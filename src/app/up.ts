// `rpe up`'s part on this machine (plan §4.6): RPE's service, which `rpe up` installs and `rpe down`
// removes: a systemd user unit of the account, as today's runtime runs under one (LumiAH
// `runtime/update/service.ts`), found again by the data folder its first lines name; and where a
// program on this machine reaches RPE. The command line signs in and hands over its calls and the
// account's systemctl; its calls into Lumiverse are the adapter's (`adapter/lumiverse/install-calls.ts`),
// and this file names no other area.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Env } from "./config";

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
 * The account's systemctl, as today's runtime reaches it (LumiAH `systemctlOf`): found on the PATH
 * the command line was given, `--user`, whose manager it finds by XDG_RUNTIME_DIR, which `sudo -u
 * <account>` leaves unset (the account's is /run/user/<uid>).
 */
export function accountSystemctl(env: Env, uid: number | null): Systemctl {
  return async (args) => {
    const path = Bun.which("systemctl", { PATH: env.PATH ?? "" });
    if (path === null) return { code: 127, out: "", err: "There is no systemctl on this machine's PATH: RPE's service, as today's runtime's, is a systemd user unit." };
    const runtimeDir = env.XDG_RUNTIME_DIR ?? (uid === null ? undefined : `/run/user/${uid}`);
    const vars = Object.fromEntries(Object.entries({ ...env, ...(runtimeDir === undefined ? {} : { XDG_RUNTIME_DIR: runtimeDir }) }).filter((e): e is [string, string] => e[1] !== undefined));
    const proc = Bun.spawn([path, "--user", ...args], { env: vars, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  };
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

/** A service name made from a Lumiverse username, held to the form a unit's name takes: lowercase letters, digits, `_` and `-`. */
export function serviceNameOf(username: string): string {
  return (
    username
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+/, "")
      .slice(0, 40) || "rpe"
  );
}

/** A word of a unit's ExecStart: quoted when it must be, `%` and `$` escaped (systemd.service(5)); no control character, which would start a line of its own. */
function unitWord(word: string): string {
  if (/[\u0000-\u001f\u007f]/.test(word)) throw new Error(`A path for RPE's unit holds a control character (${JSON.stringify(word)}): no unit is written with it.`);
  const escaped = word.replace(/%/g, "%%").replace(/\$/g, "$$$$");
  return /^[A-Za-z0-9_@%+=:,./$-]+$/.test(escaped) ? escaped : `"${escaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * RPE's unit: `rpe serve` on its data folder, by the Bun and the app file `rpe up` ran with, always
 * restarted, as today's runtime's unit is, but no more than `startLimit.tries` times within
 * `startLimit.windowMs` (the settings `update.startTries` and `update.startWindow`): a build that
 * cannot serve, such as one an update put in place, is then left stopped, and `systemctl --user
 * status` says it failed, rather than started every two seconds for good.
 */
export function rpeUnitText(u: { name: string; bun: string; script: string; data: string; startLimit: { tries: number; windowMs: number } }): string {
  const exec = [u.bun, u.script, "serve", "--data", u.data].map(unitWord).join(" ");
  return [
    `# Written by \`rpe up\`: RPE's service. \`rpe down\` stops and removes it, and leaves RPE's data where it is.`,
    `${DATA_LINE}${u.data}`,
    "[Unit]",
    `Description=RPE (${u.name})`,
    `StartLimitIntervalSec=${Math.round(u.startLimit.windowMs / 1000)}`,
    `StartLimitBurst=${u.startLimit.tries}`,
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${exec}`,
    "Restart=always",
    "RestartSec=2",
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

/** Writes RPE's unit and starts it: enabled, so the account's manager starts it again after a reboot, and restarted, so it runs what was just written. */
export async function startRpeService(service: RpeService, text: string, systemctl: Systemctl): Promise<void> {
  await mkdir(dirname(service.file), { recursive: true });
  await writeFile(service.file, text);
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
