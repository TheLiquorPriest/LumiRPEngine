// `rpe up`'s part in Lumiverse (plan §4.6): RPE's connection there, made through Lumiverse's own
// connections API as the signed-in user (Lumiverse's `src/routes/connections.routes.ts`, mounted at
// `/api/v1/connections`). It is an OpenAI-compatible connection pointed at this RPE's `/v1` with the
// provider key. Whatever already matches is left as it is, so running `rpe up` again changes nothing.
// The connection today's build made for its runtime is never changed (§15.6: going back needs it as
// it is). At the swap RPE takes it over as it is (§15.2): RPE answers where today's runtime did,
// under its model name and with its key. Where RPE's config names it and RPE has not taken it over,
// RPE makes a connection of its own beside it.
//
// And RPE's service, which `rpe up` installs and `rpe down` removes: a systemd user unit of the
// account, as today's runtime runs under one (LumiAH `runtime/update/service.ts`), found again by the
// data folder its first lines name. The command line signs in and hands over its calls and the
// account's systemctl; this file names no other area.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "../shared/json";
import type { Env } from "./config";

/** Lumiverse's id for an OpenAI-compatible connection (its `src/llm/providers/custom.ts`). */
export const OPENAI_COMPATIBLE = "custom";
/** The name a new connection is given; a name the user gave it later is kept. */
export const CONNECTION_NAME = "RPE";
const CONNECTIONS = "/api/v1/connections";
/** The model of the connection today's build made for its runtime: LumiAH's own, or one that starts with it (LumiAH `link/contract.ts`, `loopbackModel`). */
export const TODAYS_MODEL = /^lumiah(-|$)/;

/** One call to Lumiverse as the signed-in user: a path under its address, a JSON body. */
export type LumiverseCall = (method: string, path: string, body?: unknown) => Promise<Response>;

export interface WantedConnection {
  /** This RPE's `/v1`, as Lumiverse reaches it. */
  apiUrl: string;
  /** The model names RPE offers (`lumiverse.models`); a connection on one of them keeps it. */
  models: readonly string[];
  /** Whether this RPE has a provider key in force. Its key is kept only as a hash, so a connection without it is given a new one. */
  hasKey: boolean;
  /** Makes a new provider key (the one before it stops working) and gives it. */
  makeKey(): string;
}

export interface SettledConnection {
  id: string;
  name: string;
  made: boolean;
  /** What was changed on a connection that was there: the fields' names, and `key` for a new key. */
  changed: string[];
  /** Whether a new provider key was made for it. */
  newKey: boolean;
  /** The connection RPE's config named, where it is the one today's build made for its runtime: left as it is, and RPE's own made beside it. */
  todays: string | null;
}

/** Lumiverse's answer as JSON, or its refusal as an error in its own words. */
async function answer(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    throw new Error(`Lumiverse answered ${what} with something that is not JSON (${res.status}).`);
  }
  if (!res.ok) throw new Error(`Lumiverse refused ${what} (${res.status})${isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : ""}.`);
  return body;
}

interface Profile {
  id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  has_api_key: boolean;
}

function readProfile(value: unknown): Profile | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.provider !== "string" || typeof value.api_url !== "string" || typeof value.model !== "string" || typeof value.has_api_key !== "boolean") return null;
  return { id: value.id, name: value.name, provider: value.provider, api_url: value.api_url, model: value.model, has_api_key: value.has_api_key };
}

function profileOf(value: unknown, what: string): Profile {
  const profile = readProfile(value);
  if (profile === null) throw new Error(`Lumiverse answered ${what} with something that is not a connection.`);
  return profile;
}

/**
 * Makes RPE's connection in Lumiverse, or brings the one `known` names into line: Lumiverse's
 * OpenAI-compatible provider, this RPE's `/v1`, one of RPE's model names, and a key RPE takes. A
 * `known` that is today's build's connection is never changed: it is RPE's as it is where RPE answers
 * to its model name, which RPE does once the swap has taken it over; else RPE makes its own instead.
 */
export async function settleConnection(call: LumiverseCall, known: string | null, wanted: WantedConnection): Promise<SettledConnection> {
  const model = wanted.models[0];
  if (model === undefined) throw new Error("lumiverse.models in RPE's config names no model, and RPE's connection needs one: name at least one.");
  let found: Profile | null = null;
  let todays: string | null = null;
  if (known !== null) {
    const what = `the connection ${known}`;
    const res = await call("GET", `${CONNECTIONS}/${encodeURIComponent(known)}`);
    // Removed in Lumiverse since: it is made again.
    if (res.status !== 404) found = profileOf(await answer(res, `the question about ${what}`), what);
    if (found !== null && TODAYS_MODEL.test(found.model)) {
      if (wanted.models.includes(found.model)) return { id: found.id, name: found.name, made: false, changed: [], newKey: false, todays: null };
      [todays, found] = [found.id, null];
    }
  }
  if (found === null) {
    const key = wanted.makeKey();
    const made = profileOf(await answer(await call("POST", CONNECTIONS, { name: CONNECTION_NAME, provider: OPENAI_COMPATIBLE, api_url: wanted.apiUrl, model, api_key: key }), "making RPE's connection"), "making RPE's connection");
    return { id: made.id, name: made.name, made: true, changed: [], newKey: true, todays };
  }
  const change: Record<string, string> = {};
  if (found.provider !== OPENAI_COMPATIBLE) change.provider = OPENAI_COMPATIBLE;
  if (found.api_url.replace(/\/+$/, "") !== wanted.apiUrl) change.api_url = wanted.apiUrl;
  if (!wanted.models.includes(found.model)) change.model = model;
  const newKey = !wanted.hasKey || !found.has_api_key;
  if (newKey) change.api_key = wanted.makeKey();
  const changed = Object.keys(change).map((field) => (field === "api_key" ? "key" : field));
  if (changed.length > 0) await answer(await call("PUT", `${CONNECTIONS}/${encodeURIComponent(found.id)}`, change), `the change to RPE's connection ${found.id}`);
  return { id: found.id, name: found.name, made: false, changed, newKey, todays };
}

/**
 * The user's connections in Lumiverse that `is` takes for today's loopback, newest first, read as
 * today's runtime reads them (LumiAH `connectionProfiles`, `loopbackProfile`): Lumiverse's
 * OpenAI-compatible ones, up to `limit` (today's runtime's own "connections read" setting).
 */
export async function connectionsWhere(call: LumiverseCall, limit: number, is: (connection: { model: string; url: string }) => boolean): Promise<{ id: string; name: string }[]> {
  const body = await answer(await call("GET", `${CONNECTIONS}?limit=${limit}`), "the question about your connections");
  // Paged in Lumiverse's answer (`{ data }`); a bare list in one from before it was paged.
  const rows = isRecord(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  return rows.flatMap((row) => {
    const p = readProfile(row);
    return p !== null && p.provider === OPENAI_COMPATIBLE && is({ model: p.model, url: p.api_url }) ? [{ id: p.id, name: p.name }] : [];
  });
}

/** Where a program on this machine reaches what listens on `address` at `port`: an address that takes every one of the machine's is reached on its loopback. */
export function localUrl(address: string, port: number): string {
  const host = address === "0.0.0.0" ? "127.0.0.1" : address === "::" ? "[::1]" : address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

/**
 * The extension `identifier` as Lumiverse lists it for the signed-in user (`GET /api/v1/spindle`):
 * whether it is switched on, and the permissions its installed manifest asks for (null where
 * Lumiverse doesn't say); null where it isn't installed.
 */
export async function installedExtension(call: LumiverseCall, identifier: string): Promise<{ on: boolean; permissions: string[] | null } | null> {
  const body = await answer(await call("GET", "/api/v1/spindle"), "the list of its extensions");
  const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e) => isRecord(e) && e.identifier === identifier) : undefined;
  if (!isRecord(found)) return null;
  return { on: found.enabled === true, permissions: Array.isArray(found.permissions) ? found.permissions.filter((p): p is string => typeof p === "string") : null };
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

/** RPE's unit: `rpe serve` on its data folder, by the Bun and the app file `rpe up` ran with, always restarted, as today's runtime's unit is. */
export function rpeUnitText(u: { name: string; bun: string; script: string; data: string }): string {
  const exec = [u.bun, u.script, "serve", "--data", u.data].map(unitWord).join(" ");
  return [
    `# Written by \`rpe up\`: RPE's service. \`rpe down\` stops and removes it, and leaves RPE's data where it is.`,
    `${DATA_LINE}${u.data}`,
    "[Unit]",
    `Description=RPE (${u.name})`,
    "StartLimitIntervalSec=0",
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
