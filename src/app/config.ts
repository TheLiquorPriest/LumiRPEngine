// RPE's data folder and its config file (plan §4.4, §4.5, §16). One folder holds everything RPE
// keeps: the database, the file tree agents work in, the secrets file and the config file, and a
// folder for backups. The config file says where RPE listens (loopback unless an address is set),
// which Lumiverse it serves and which of its users this RPE belongs to, and holds every limit the app
// keeps, each with its default. Four of its values can be set from the environment instead, which
// wins over the file, so a service unit or a container can set them without editing it.

import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "../shared/json";
import { isMissing, OWNER_ONLY_FILE, ownerOnlyFolder, readText, writeWhole } from "./disk";

export const CONFIG_FILE = "config.json";
export const SECRETS_FILE = "secrets.json";
export const DATABASE_FILE = "rpe.db";
export const FILES_FOLDER = "files";
export const BACKUPS_FOLDER = "backups";
/** The file tree's global config (plan §5): connection profiles live in it, beside what other areas keep there. */
export const GLOBAL_CONFIG_FILE = "RPE-global.yml";

/** Where each thing RPE keeps is, under one data folder. */
export interface DataPaths {
  root: string;
  config: string;
  secrets: string;
  database: string;
  /** The file tree agents work in (plan §5). */
  files: string;
  globalConfig: string;
  backups: string;
}

export function dataPaths(root: string): DataPaths {
  const files = join(root, FILES_FOLDER);
  return {
    root,
    config: join(root, CONFIG_FILE),
    secrets: join(root, SECRETS_FILE),
    database: join(root, DATABASE_FILE),
    files,
    globalConfig: join(files, GLOBAL_CONFIG_FILE),
    backups: join(root, BACKUPS_FOLDER),
  };
}

export type Env = Readonly<Record<string, string | undefined>>;

/** The data folder: `RPE_DATA` when set, else `rpe` in the user's data folder (`XDG_DATA_HOME`, else `~/.local/share`). */
export function defaultDataFolder(env: Env, home: string = homedir()): string {
  const chosen = env.RPE_DATA?.trim();
  if (chosen) return chosen;
  const data = env.XDG_DATA_HOME?.trim();
  return join(data ? data : join(home, ".local", "share"), "rpe");
}

export interface AppConfig {
  /** The address RPE listens on: loopback unless one is set. */
  address: string;
  /** Its port; 0 takes any free one. */
  port: number;
  lumiverse: {
    /** Lumiverse's address as RPE reaches it; pages from its origin may call RPE. */
    url: string | null;
    /** The id of the Lumiverse user this RPE belongs to. Pages act for that user alone. */
    user: string | null;
    /** Lumiverse's database file, which the adapter reads read-only; null where it cannot be reached and Lumiverse is read over HTTP. */
    database: string | null;
    /** The id of RPE's connection in Lumiverse; null before one is made. */
    connection: string | null;
    /** The model names RPE's connection is offered (`/v1/models`). */
    models: string[];
  };
  /** Origins besides RPE's own and Lumiverse's whose pages may call RPE: an address either is published at. */
  origins: string[];
  /** Names besides RPE's own address that requests may reach it by (a published address's host name; `name:port` to hold it to a port). */
  hosts: string[];
  server: {
    /** The largest request body a route takes unless the route says otherwise, in bytes. */
    bodyBytes: number;
    /** The largest request the provider endpoint takes: a whole assembled prompt, pictures included. */
    providerBodyBytes: number;
    /** How long a browser may keep RPE's answer to a page's preflight, in seconds. */
    preflightSeconds: number;
  };
  auth: {
    /** How long a page token holds, in minutes. */
    pageTokenMinutes: number;
    /** How long the token the command line makes to call the running server holds, in seconds. */
    commandLineSeconds: number;
  };
  live: {
    /** Events held for one slow reader of one chat; past it the oldest it has not taken are dropped, and it is told which. */
    queueEvents: number;
    /** The largest message a page may send on the live socket, in bytes. */
    messageBytes: number;
  };
  database: {
    /** How long a write waits for another program's write to the file (the command line's) to finish, in milliseconds. */
    busyMs: number;
    /** How long the write queue runs writes before it lets other work in, in milliseconds. */
    sliceMs: number;
  };
  commandLine: {
    /** How long `rpe status` and `rpe connection` wait for the running server, in milliseconds. */
    waitMs: number;
    /** How long `rpe lumiverse` waits for Lumiverse to answer its sign-in, in milliseconds. */
    signInMs: number;
    /** How long `rpe up` waits for RPE to answer once it has started RPE's service, before it puts back what it did, in milliseconds. */
    startMs: number;
  };
}

export const CONFIG_DEFAULTS: Readonly<AppConfig> = Object.freeze({
  address: "127.0.0.1",
  port: 7871,
  lumiverse: { url: null, user: null, database: null, connection: null, models: ["rpe"] },
  origins: [],
  hosts: [],
  server: { bodyBytes: 1024 * 1024, providerBodyBytes: 32 * 1024 * 1024, preflightSeconds: 600 },
  auth: { pageTokenMinutes: 30, commandLineSeconds: 60 },
  live: { queueEvents: 512, messageBytes: 64 * 1024 },
  database: { busyMs: 5000, sliceMs: 10 },
  commandLine: { waitMs: 3000, signInMs: 30_000, startMs: 30_000 },
});

/** The environment's names for the values it may set. */
export const CONFIG_ENV = Object.freeze({ address: "RPE_ADDRESS", port: "RPE_PORT", lumiverseUrl: "RPE_LUMIVERSE_URL", lumiverseUser: "RPE_LUMIVERSE_USER" });

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Reader<T> = (value: unknown, where: string) => T;

const wholeIn =
  (min: number, max: number): Reader<number> =>
  (value, where) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ConfigError(`${where} must be a whole number from ${min} to ${max}.`);
    return value;
  };

/** One line of text with no space at either end. */
export const plainText: Reader<string> = (value, where) => {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new ConfigError(`${where} must be text, with no space at either end.`);
  return value;
};

/** An http or https address, without the slashes it ends in. */
export const webAddress: Reader<string> = (value, where) => {
  const text = plainText(value, where);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError(`${where} must be an address such as http://127.0.0.1:7860.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ConfigError(`${where} must start with http:// or https://.`);
  return text.replace(/\/+$/, "");
};

/** An origin as a browser sends it: scheme, host and a port only when it is not the scheme's own. */
const origin: Reader<string> = (value, where) => {
  const text = webAddress(value, where);
  const parsed = new URL(text);
  if (parsed.origin !== text.toLowerCase()) throw new ConfigError(`${where} must be an origin alone, such as https://lumiverse.example: no path, and no port the scheme already implies.`);
  return parsed.origin;
};

const listOf =
  <T>(read: Reader<T>): Reader<T[]> =>
  (value, where) => {
    if (!Array.isArray(value)) throw new ConfigError(`${where} must be a list.`);
    return value.map((item, i) => read(item, `${where}[${i}]`));
  };

const hostName: Reader<string> = (value, where) => {
  const text = plainText(value, where).toLowerCase();
  if (/[\s/@]/.test(text)) throw new ConfigError(`${where} must be a host name, with a port after a colon if it should hold to one.`);
  return text;
};

/** The keys an object of the file may hold, each with its reader and its default. */
type Shape<T> = { [K in keyof T]: [Reader<T[K]>, T[K]] };

function readGroup<T>(raw: unknown, where: string, shape: Shape<T>): T {
  if (raw === undefined) raw = {};
  if (!isRecord(raw)) throw new ConfigError(`${where} must be an object.`);
  const known = Object.keys(shape);
  const unknown = Object.keys(raw).filter((k) => !known.includes(k));
  if (unknown.length > 0) throw new ConfigError(`${where} has ${unknown.map((k) => `"${k}"`).join(", ")}, which RPE does not know. It takes ${known.join(", ")}.`);
  const out = {} as T;
  for (const key of known as (keyof T & string)[]) {
    const [read, fallback] = shape[key];
    out[key] = raw[key] === undefined ? structuredClone(fallback) : read(raw[key], `${where}.${key}`);
  }
  return out;
}

/** The config the file `raw` and the environment `env` give, over the defaults. `where` names the file in what is refused. */
export function configOf(raw: unknown, env: Env, where: string): AppConfig {
  const d = CONFIG_DEFAULTS;
  if (isRecord(raw) && raw.v !== undefined && raw.v !== 1) throw new ConfigError(`${where} is of a format this RPE does not read (v ${String(raw.v)}).`);
  const { v: _v, ...rest } = isRecord(raw) ? raw : ({} as Record<string, unknown>);
  const config = readGroup<AppConfig>(isRecord(raw) ? rest : raw, where, {
    address: [hostName, d.address],
    port: [wholeIn(0, 65535), d.port],
    lumiverse: [
      (value, at) =>
        readGroup(value, at, {
          url: [(url, where) => (url === null ? null : webAddress(url, where)), d.lumiverse.url],
          user: [(user, where) => (user === null ? null : plainText(user, where)), d.lumiverse.user],
          database: [(file, where) => (file === null ? null : plainText(file, where)), d.lumiverse.database],
          connection: [(id, where) => (id === null ? null : plainText(id, where)), d.lumiverse.connection],
          models: [listOf(plainText), d.lumiverse.models],
        }),
      d.lumiverse,
    ],
    origins: [listOf(origin), d.origins],
    hosts: [listOf(hostName), d.hosts],
    server: [
      (value, at) =>
        readGroup(value, at, {
          bodyBytes: [wholeIn(1024, 1024 * 1024 * 1024), d.server.bodyBytes],
          providerBodyBytes: [wholeIn(1024, 1024 * 1024 * 1024), d.server.providerBodyBytes],
          preflightSeconds: [wholeIn(0, 86_400), d.server.preflightSeconds],
        }),
      d.server,
    ],
    auth: [
      (value, at) =>
        readGroup(value, at, {
          pageTokenMinutes: [wholeIn(1, 7 * 24 * 60), d.auth.pageTokenMinutes],
          commandLineSeconds: [wholeIn(5, 3600), d.auth.commandLineSeconds],
        }),
      d.auth,
    ],
    live: [
      (value, at) =>
        readGroup(value, at, {
          queueEvents: [wholeIn(1, 1_000_000), d.live.queueEvents],
          messageBytes: [wholeIn(256, 16 * 1024 * 1024), d.live.messageBytes],
        }),
      d.live,
    ],
    database: [
      (value, at) =>
        readGroup(value, at, {
          busyMs: [wholeIn(0, 600_000), d.database.busyMs],
          sliceMs: [wholeIn(1, 10_000), d.database.sliceMs],
        }),
      d.database,
    ],
    commandLine: [
      (value, at) =>
        readGroup(value, at, {
          waitMs: [wholeIn(100, 600_000), d.commandLine.waitMs],
          signInMs: [wholeIn(1000, 600_000), d.commandLine.signInMs],
          startMs: [wholeIn(1000, 600_000), d.commandLine.startMs],
        }),
      d.commandLine,
    ],
  });
  const set = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const address = set(CONFIG_ENV.address);
  if (address !== undefined) config.address = hostName(address, CONFIG_ENV.address);
  const port = set(CONFIG_ENV.port);
  if (port !== undefined) config.port = wholeIn(0, 65535)(/^\d+$/.test(port) ? Number(port) : port, CONFIG_ENV.port);
  const url = set(CONFIG_ENV.lumiverseUrl);
  if (url !== undefined) config.lumiverse.url = webAddress(url, CONFIG_ENV.lumiverseUrl);
  const user = set(CONFIG_ENV.lumiverseUser);
  if (user !== undefined) config.lumiverse.user = plainText(user, CONFIG_ENV.lumiverseUser);
  return config;
}

/** The config file's JSON as it is; `{}` where there is none. */
async function configFile(paths: DataPaths): Promise<unknown> {
  const text = await readText(paths.config);
  if (text === null) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${paths.config} is not JSON (${error instanceof Error ? error.message : String(error)}): fix it, or remove it to start from the defaults.`);
  }
}

/** The config in the data folder, with the environment's values over it; the defaults where the folder has no config file. */
export async function loadConfig(paths: DataPaths, env: Env): Promise<AppConfig> {
  return configOf(await configFile(paths), env, paths.config);
}

/**
 * Changes the config file in place: `change` is given its JSON, and everything else the file holds
 * is kept as it was. The file is written only when RPE reads the result.
 */
export async function updateConfigFile(paths: DataPaths, change: (raw: Record<string, unknown>) => void): Promise<void> {
  const raw = await configFile(paths);
  if (!isRecord(raw)) throw new ConfigError(`${paths.config} must hold one JSON object.`);
  change(raw);
  configOf(raw, {}, paths.config);
  await writeWhole(paths.config, `${JSON.stringify(raw, null, 2)}\n`);
}

/**
 * Makes the data folder ready: the folder and the backups folder enterable by their owner alone, the
 * file tree's folder, and a config file holding where RPE listens and whose it is, when there is none.
 * The limits are left out of a new file, so that a later build's defaults reach it; a limit written
 * into the file is kept.
 */
export async function prepareDataFolder(paths: DataPaths): Promise<void> {
  await ownerOnlyFolder(paths.root);
  await ownerOnlyFolder(paths.backups);
  await mkdir(paths.files, { recursive: true });
  if ((await readText(paths.config)) === null) {
    const first = { v: 1, address: CONFIG_DEFAULTS.address, port: CONFIG_DEFAULTS.port, lumiverse: { url: null, user: null } };
    await writeWhole(paths.config, `${JSON.stringify(first, null, 2)}\n`);
  }
  // A secrets file someone made readable to others is made private again before RPE reads it.
  try {
    await chmod(paths.secrets, OWNER_ONLY_FILE);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
