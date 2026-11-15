// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/runtime/config.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// A runtime's config: `~/.config/lumiah/<name>.json` (under `$XDG_CONFIG_HOME` when that is set),
// readable only by its owner, since it holds the runtime's Lumiverse session (a whole-account
// credential) and its relay secret. `up` writes it; `serve` reads it, and reads its session again
// whenever the link opens, so `lumiah login` takes effect without a restart. Its `tuning` is the
// runtime's limits and timings as it last read them from the user's settings: what it starts with
// before it has linked. Beside what the runtime runs with, it keeps how the runtime was set up and
// is kept: its memory limit, whether it updates itself, the file it was set up from, and the unit
// that runs it. And here is where a runtime keeps its data: its data folder and its own folder there.

import { EXTENSION_IDENTIFIER, RUNTIME_NAME } from "../link/contract";
import { isRecord } from "../link/json";
import type { RuntimeTuning } from "../link/settings";
import { RUNTIME_DEFAULTS, TRANSPORT_KEY, runtimeTuningOf } from "../link/settings";
import type { StoredLogin } from "./lumiverse";
import { DEFAULT_MEMORY, memoryRefusal } from "./update/memory";

/** What a runtime runs with: its link to the extension and the loopback endpoint it serves. */
export interface RuntimeConfig {
  name: string;
  /** Lumiverse's address, as the runtime reaches it. */
  base: string;
  /** The identifier of the extension it links to: LumiAH's own, or that of an extension LumiAH is built into. */
  extension: string;
  /** Where it serves the loopback endpoint. */
  listen: string;
  port: number;
  /** Its registration with the extension, and the secret only it holds. */
  relay: string;
  secret: string;
  session: StoredLogin;
  tuning: RuntimeTuning;
}

/** The systemd user unit `up --systemd` installed for a runtime: its name and file, and the Bun and the copy of the runtime its ExecStart runs. */
export interface SystemdService {
  manager: "systemd";
  unit: string;
  file: string;
  bun: string;
  script: string;
}

/** How a runtime was set up and is kept. */
export interface RuntimeSetup {
  /** The memory it may hold, as systemd reads a size ("1G"), or "infinity": its unit's MemoryMax. */
  memory: string;
  /** Whether it takes an update the extension offers by itself, once nothing is under way. */
  autoUpdate: boolean;
  /** The file `up` was run from, the extension's own copy of the runtime: the only file it takes an update from. Null in a config written before a runtime could update itself. */
  source: string | null;
  /** The unit that keeps it running; null when lumiah installed none (it runs in the foreground, or under a service of the user's own making). */
  service: SystemdService | null;
}

/** A runtime's config file: what it runs with, and how it was set up. */
export type SavedConfig = RuntimeConfig & RuntimeSetup;

/** How a runtime set up for the first time is kept, until `up` or the Runtime page says otherwise. */
export const SETUP_DEFAULTS: Readonly<RuntimeSetup> = { memory: DEFAULT_MEMORY, autoUpdate: true, source: null, service: null };

/** The file's format: a config of another one is set up again rather than guessed at. */
const FORMAT = 1;

/** One of the account's XDG folders: the variable's when it is set and absolute (the spec says to ignore a relative one), else its fallback under home. */
export function xdgDir(env: Readonly<Record<string, string | undefined>>, home: string, variable: "XDG_CONFIG_HOME" | "XDG_DATA_HOME", fallback: string): string {
  const v = env[variable];
  return v !== undefined && v.startsWith("/") ? v : `${home}/${fallback}`;
}

/** Where configs live: `$XDG_CONFIG_HOME/lumiah`, or `~/.config/lumiah`. */
export function configDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return `${xdgDir(env, home, "XDG_CONFIG_HOME", ".config")}/lumiah`;
}

export function configPathOf(dir: string, name: string): string {
  return `${dir}/${name}.json`;
}

/** Where runtimes keep their data: `$XDG_DATA_HOME/lumiah`, or `~/.local/share/lumiah`. LumiAH's installed copy of the runtime is there too. */
export function dataDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return `${xdgDir(env, home, "XDG_DATA_HOME", ".local/share")}/lumiah`;
}

/** A runtime's own folder holds its keys and its working store, so no one but its owner may enter it: it is made with this mode. */
export const RUNTIME_DIR_MODE = 0o700;

/** A runtime's own folder in the data folder, by its name: `<dataDir>/runtimes/<name>`, made with RUNTIME_DIR_MODE. */
export function runtimeDir(data: string, name: string): string {
  return `${data}/runtimes/${name}`;
}

/**
 * Where lumiah installs the copy of the runtime a unit runs. Each extension ships its own build of
 * the runtime, so each has a copy of its own: LumiAH's in the data folder, and that of an extension
 * LumiAH is built into in a folder there named for the extension. Updating one extension never
 * changes the file another's service runs.
 */
export function installedPath(data: string, extension: string): string {
  return `${data}${extension === EXTENSION_IDENTIFIER ? "" : `/${extension}`}/lumiah.js`;
}

/** An absolute path, as POSIX writes one or as Windows does (`C:\…`). */
function absolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/** A character that would break a line of a unit, a log line or a page's words, or hide in one: below 0x20, and DEL. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Whether a path holds such a character: no unit is written with one, and a config that names one is read without it. */
export function controlled(path: string): boolean {
  return CONTROL.test(path);
}

/** A path a config may name: absolute, and no control character in it. */
function usable(path: unknown): path is string {
  return typeof path === "string" && absolute(path) && !controlled(path);
}

/** An extension's identifier, as `--extension` takes one and a config must hold one: it names a folder (`installedPath`) and a unit. */
export const EXTENSION_FORM = /^[a-z][a-z0-9_]*$/;

/** The unit a config names, as `up --systemd` wrote it; null for anything else. */
function serviceOf(raw: unknown): SystemdService | null {
  if (!isRecord(raw) || raw.manager !== "systemd") return null;
  const { unit, file, bun, script } = raw;
  if (typeof unit !== "string" || !/^lumiah-[a-z0-9][a-z0-9_-]{0,39}\.service$/.test(unit)) return null;
  if (!usable(file) || !usable(bun) || !usable(script)) return null;
  return { manager: "systemd", unit, file, bun, script };
}

/** A config as its file holds it. */
export function configText(config: SavedConfig): string {
  return `${JSON.stringify({ lumiah: FORMAT, runtime: config }, null, 2)}\n`;
}

/** The config a file's text holds; throws, in words that say what to do, when it holds none this build reads. */
export function configOf(text: string | null, path: string): SavedConfig {
  if (text === null) throw new Error(`There is no runtime config at ${path}. Set the runtime up with: lumiah up --url <the address you open Lumiverse at>`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${path} isn't readable JSON. Set the runtime up again with: lumiah up`);
  }
  const c = isRecord(raw) && raw.lumiah === FORMAT && isRecord(raw.runtime) ? raw.runtime : null;
  const s = c !== null && isRecord(c.session) ? c.session : null;
  // The name is checked as `up` checks it: the runtime's own folder and its unit are named by it.
  if (c === null || s === null || typeof c.name !== "string" || !RUNTIME_NAME.test(c.name) || typeof c.base !== "string" || typeof c.listen !== "string" || typeof c.port !== "number" || typeof c.relay !== "string" || typeof c.secret !== "string" || typeof s.username !== "string" || typeof s.token !== "string") {
    throw new Error(`${path} isn't a runtime config this lumiah reads. Set the runtime up again with: lumiah up`);
  }
  // Read as the settings' own section is, so a value this build refuses falls back to its default.
  const tuning = isRecord(c.tuning) ? runtimeTuningOf({ [TRANSPORT_KEY]: { runtime: c.tuning } }) : { ...RUNTIME_DEFAULTS };
  // A config written before the extension could be named links to LumiAH's own. The identifier names a folder and a unit: it is held to the form `--extension` takes.
  if (c.extension !== undefined && (typeof c.extension !== "string" || !EXTENSION_FORM.test(c.extension))) throw new Error(`${path} isn't a runtime config this lumiah reads. Set the runtime up again with: lumiah up`);
  const extension = typeof c.extension === "string" ? c.extension : EXTENSION_IDENTIFIER;
  // A config written before these were kept, or holding a value this build refuses, reads with their defaults.
  const setup: RuntimeSetup = {
    memory: typeof c.memory === "string" && memoryRefusal(c.memory) === null ? c.memory : SETUP_DEFAULTS.memory,
    autoUpdate: typeof c.autoUpdate === "boolean" ? c.autoUpdate : SETUP_DEFAULTS.autoUpdate,
    source: usable(c.source) ? c.source : null,
    service: serviceOf(c.service),
  };
  return { name: c.name, base: c.base, extension, listen: c.listen, port: c.port, relay: c.relay, secret: c.secret, session: { username: s.username, token: s.token, savedAt: typeof s.savedAt === "number" ? s.savedAt : 0, ...(s.allowHttp === true ? { allowHttp: true } : {}) }, tuning, ...setup };
}
