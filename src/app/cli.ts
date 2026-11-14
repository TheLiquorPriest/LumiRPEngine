// The command line `rpe` (plan §4.4, §4.6, §16), as functions over the process's input and output
// (`main.ts` gives the real ones). `serve` runs RPE in the foreground; `status`, `key`, `allow`,
// `deny` and `backup` work on the data folder directly, so they work whether RPE runs or not; and
// `connection` is a client of the running server's API, because the connections' one writer, RPH's
// model layer, lives in that process. `allow` and `deny` are the one way anything that runs a command
// or calls out is switched on or off: no route of the API can do it.

import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import type { ConnectionInput, ConnectionList, ConnectionView, Effort } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import type { Area } from "./app";
import { lineLog, openApp, STATUS_PATH } from "./app";
import type { KeyKind } from "./auth";
import { currentKeys, insertKey, insertPageToken, NO_OWNER, secretHash } from "./auth";
import { makeBackup } from "./backup";
import type { AppConfig, DataPaths, Env } from "./config";
import { dataPaths, defaultDataFolder, loadConfig, prepareDataFolder } from "./config";
import { openDatabase } from "./database";
import { appliedMigrations, migrate, Migrations } from "./migrations";
import { APP_MIGRATIONS } from "./schema";
import { listSwitches, setSwitch } from "./switches";

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  env: Env;
  home: string;
  now(): number;
  /** A secret the user gives: piped in, or typed at a prompt that does not show it; null when none is given. */
  secret(question: string): Promise<string | null>;
  /** Resolves when the process is told to stop (Ctrl-C, the service stopping). */
  stopped(): Promise<void>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export interface CliOptions {
  version: string;
  /** The areas `serve` mounts besides the app's own. */
  areas?: readonly Area[];
}

const USAGE = [
  "rpe: RPEngine's own application.",
  "",
  "  rpe serve                      run RPE in the foreground",
  "  rpe status                     what this RPE is, and whether it answers",
  "  rpe key [provider|extension|web]",
  "                                 make a new key, shown once; the one before it stops working",
  "  rpe connection list            the model connections",
  "  rpe connection add --name <name> --provider <provider> [--auth key|signin|none]",
  "                     [--model <model>] [--effort <effort>] [--base-url <address>]",
  "                     [--context-window <tokens>] [--max-tokens <tokens>]",
  "                                 add one; its key is asked for, never given on the line",
  "  rpe connection remove <name or id>",
  "  rpe allow <name>               switch on something that runs a command or calls out",
  "  rpe deny <name>                switch it off",
  "  rpe backup [--out <file>]      one archive of the database and the file tree",
  "",
  "Every command takes --data <folder>: the data folder (default: $RPE_DATA, else ~/.local/share/rpe).",
].join("\n");

/** The flags each command takes. */
const FLAGS: Readonly<Record<string, readonly string[]>> = {
  serve: ["data"],
  status: ["data"],
  key: ["data"],
  allow: ["data"],
  deny: ["data"],
  backup: ["data", "out"],
  connection: ["data", "name", "provider", "auth", "model", "effort", "base-url", "context-window", "max-tokens"],
};

class UsageError extends Error {}

type Flags = Readonly<Record<string, string>>;

/** Words, and `--name value` (or `--name=value`) flags, each allowed flag at most once. */
function parseArgs(argv: readonly string[], allowed: readonly string[]): { words: string[]; flags: Flags } {
  const words: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!allowed.includes(name)) throw new UsageError(`This command does not take --${name}.`);
    if (Object.hasOwn(flags, name)) throw new UsageError(`--${name} is given twice.`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "") throw new UsageError(`--${name} needs a value.`);
    flags[name] = value;
  }
  return { words, flags };
}

/** The database for the command line: a connection of its own, without the server's guard, with the app's tables made when missing. */
function commandLineDatabase(paths: DataPaths, config: AppConfig, version: string, now: () => number): Database {
  const db = openDatabase(paths.database, config.database.busyMs);
  try {
    const migrations = new Migrations();
    migrations.add("app", APP_MIGRATIONS);
    migrate(db, migrations, { version, backups: paths.backups, now });
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Where the running server answers, as a program on the same machine reaches it. */
function serverUrl(config: AppConfig): string {
  const address = config.address === "0.0.0.0" ? "127.0.0.1" : config.address === "::" ? "[::1]" : config.address.includes(":") ? `[${config.address}]` : config.address;
  return `http://${address}:${config.port}`;
}

const KEY_WORDS: Readonly<Record<KeyKind, string>> = {
  provider: "Put it in RPE's connection in Lumiverse as its API key.",
  extension: "Give it to the light extension as its registration with this RPE.",
  web: "Sign in to RPE's web UI with it.",
};

function keyCommand(words: readonly string[], paths: DataPaths, config: AppConfig, io: CliIO, version: string): number {
  const kind = words[0] ?? "provider";
  if (!Object.hasOwn(KEY_WORDS, kind) || words.length > 1) throw new UsageError("rpe key takes provider, extension or web.");
  const db = commandLineDatabase(paths, config, version, io.now);
  try {
    const made = db.transaction(() => insertKey(db, kind as KeyKind, io.now())).immediate();
    io.out(`A new ${kind} key for this RPE. It is shown this once; RPE keeps only its hash.`);
    io.out("");
    io.out(`  ${made.key}`);
    io.out("");
    io.out(KEY_WORDS[kind as KeyKind]);
    io.out(`The ${kind} key made before it, if there was one, no longer works.`);
  } finally {
    db.close();
  }
  return 0;
}

function switchCommand(name: string, state: "on" | "off", paths: DataPaths, io: CliIO): number {
  const db = existsSync(paths.database) ? new Database(paths.database, { readwrite: true, create: false }) : null;
  try {
    const listed = db !== null && (appliedMigrations(db).get("app")?.has(1) ?? false);
    const entry = listed ? db.transaction(() => setSwitch(db, name, state, io.now())).immediate() : null;
    if (entry === null) {
      const all = listed ? listSwitches(db) : [];
      io.err(`Nothing called "${name}" is listed. ${all.length === 0 ? "Nothing is listed yet." : `Listed: ${all.map((s) => `${s.name} (${s.state})`).join(", ")}.`}`);
      return 1;
    }
    io.out(state === "on" ? `"${entry.name}" (${entry.kind}) is on. It may now run: ${entry.what}` : `"${entry.name}" (${entry.kind}) is off.`);
    return 0;
  } finally {
    db?.close();
  }
}

async function statusCommand(paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  io.out(`RPE ${version}`);
  io.out(`Data folder: ${paths.root}`);
  const url = serverUrl(config);
  let answer = "not answering";
  try {
    const res = await io.fetch(`${url}${STATUS_PATH}`, { signal: AbortSignal.timeout(config.commandLine.waitMs) });
    const body: unknown = await res.json();
    answer = res.ok && isRecord(body) && body.name === "rpe" ? `answering (RPE ${String(body.version)})` : `answering, but not as RPE (${res.status})`;
  } catch {
    // Not running, or not reachable: said as it is.
  }
  io.out(`Listens on: ${url}, ${answer}`);
  io.out(`Lumiverse: ${config.lumiverse.url ?? "not set"}, for user ${config.lumiverse.user ?? "not set"}`);
  if (!existsSync(paths.database)) {
    io.out("Database: not made yet");
    return 0;
  }
  const db = new Database(paths.database, { readwrite: true, create: false });
  try {
    const applied = appliedMigrations(db);
    const tables = [...applied].map(([area, versions]) => `${area} ${Math.max(...versions)}`).join(", ");
    io.out(`Database: ${(statSync(paths.database).size / 1048576).toFixed(1)} MiB; tables at ${tables === "" ? "none" : tables}`);
    if (!(applied.get("app")?.has(1) ?? false)) return 0;
    const keys = currentKeys(db);
    const keyLines = (["provider", "extension", "web"] as const).map((kind) => {
      const key = keys.find((k) => k.kind === kind);
      return key === undefined ? `${kind} none` : `${kind} ends ${key.last4} (made ${new Date(key.made).toISOString().slice(0, 10)})`;
    });
    io.out(`Keys: ${keyLines.join("; ")}`);
    const switches = listSwitches(db);
    const waiting = switches.filter((s) => s.state === "waiting");
    io.out(`Switches: ${waiting.length} waiting, ${switches.filter((s) => s.state === "on").length} on, ${switches.filter((s) => s.state === "off").length} off`);
    for (const s of waiting) io.out(`  waiting: ${s.name} (${s.kind}) runs ${s.what}. Switch it on with: rpe allow ${s.name}`);
  } finally {
    db.close();
  }
  return 0;
}

type Api = (method: string, path: string, body?: unknown) => Promise<Response>;

/** Calls the running server's API as the user this RPE belongs to, with a token the command line makes for itself and lets go after. */
async function withServer<T>(paths: DataPaths, config: AppConfig, io: CliIO, version: string, call: (api: Api) => Promise<T>): Promise<T> {
  const owner = config.lumiverse.user;
  if (owner === null) throw new Error(NO_OWNER);
  const db = commandLineDatabase(paths, config, version, io.now);
  const token = db.transaction(() => insertPageToken(db, owner, "command line", config.auth.commandLineSeconds * 1000, io.now())).immediate();
  const url = serverUrl(config);
  try {
    return await call(async (method, path, body) => {
      try {
        return await io.fetch(`${url}${path}`, {
          method,
          headers: { authorization: `Bearer ${token.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(config.commandLine.waitMs),
        });
      } catch {
        throw new Error(`RPE is not answering at ${url}: start it with \`rpe serve\`.`);
      }
    });
  } finally {
    db.run("DELETE FROM page_token WHERE hash = ?", [secretHash(token.token)]);
    db.close();
  }
}

/** The server's answer, or its refusal as an error in its own words. */
async function replyOf<T>(res: Response): Promise<T> {
  if (res.status === 404) throw new Error("This RPE does not offer connections yet: the model layer is not mounted in it.");
  const text = await res.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  if (!res.ok) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `RPE answered ${res.status}.`);
  return body as T;
}

function tokenCount(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`--${flag} is a whole number of tokens.`);
  return Number(value);
}

async function connectionCommand(words: readonly string[], flags: Flags, paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  const sub = words[0];
  if (sub === "list" && words.length === 1) {
    const list = await withServer(paths, config, io, version, async (api) => replyOf<ConnectionList>(await api("GET", "/api/v1/connections")));
    if (list.connections.length === 0) io.out("No connections yet: add one with `rpe connection add`.");
    for (const c of list.connections) {
      const key = c.key === null ? "signs with no key" : c.key.set ? `key ending ${c.key.last4 ?? ""}` : "no key set";
      io.out(`${c.default ? "*" : " "} ${c.name} (${c.id}): ${c.provider}${c.model === undefined ? "" : `, ${c.model}`}${c.effort === undefined ? "" : `, effort ${c.effort}`}, ${key}`);
    }
    return 0;
  }
  if (sub === "add" && words.length === 1) {
    const { name, provider, model } = flags;
    if (name === undefined || provider === undefined) throw new UsageError("rpe connection add needs --name and --provider.");
    const auth = flags.auth ?? "key";
    if (auth !== "key" && auth !== "signin" && auth !== "none") throw new UsageError("--auth is key, signin or none.");
    const contextWindow = tokenCount(flags["context-window"], "context-window");
    const maxTokens = tokenCount(flags["max-tokens"], "max-tokens");
    const limited = contextWindow !== undefined || maxTokens !== undefined;
    if (limited && model === undefined) throw new UsageError("Limits are a model's: give --model with them.");
    const connection: ConnectionInput = {
      name,
      provider,
      auth,
      ...(model === undefined ? {} : { model }),
      // The model layer checks the effort, as it checks every field of a connection.
      ...(flags.effort === undefined ? {} : { effort: flags.effort as Effort }),
      ...(flags["base-url"] === undefined ? {} : { baseUrl: flags["base-url"] }),
      ...(limited && model !== undefined ? { limits: { [model]: { ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxTokens === undefined ? {} : { maxTokens }) } } } : {}),
    };
    let key: string | null = null;
    if (auth === "key") {
      key = (await io.secret(`The key for ${name} (it is not shown): `))?.trim() ?? null;
      if (key === null || key === "") throw new Error("A connection that signs with a key needs one.");
    }
    const saved = await withServer(paths, config, io, version, async (api) => replyOf<ConnectionView>(await api("POST", "/api/v1/connections", { connection, ...(key === null ? {} : { key }) })));
    io.out(`Added ${saved.name} (${saved.id}).`);
    return 0;
  }
  if (sub === "remove" && words.length === 2) {
    const which = words[1] ?? "";
    const removed = await withServer(paths, config, io, version, async (api) => {
      const list = await replyOf<ConnectionList>(await api("GET", "/api/v1/connections"));
      const matches = list.connections.filter((c) => c.id === which || c.name === which);
      const chosen = matches[0];
      if (chosen === undefined) throw new Error(`No connection is called "${which}".`);
      if (matches.length > 1) throw new Error(`More than one connection is called "${which}": give its id (${matches.map((c) => c.id).join(", ")}).`);
      await replyOf<undefined>(await api("DELETE", `/api/v1/connections/${encodeURIComponent(chosen.id)}`));
      return chosen;
    });
    io.out(`Removed ${removed.name} (${removed.id}).`);
    return 0;
  }
  throw new UsageError("rpe connection takes list, add or remove <name or id>.");
}

async function serveCommand(paths: DataPaths, config: AppConfig, io: CliIO, options: CliOptions): Promise<number> {
  const app = await openApp({ paths, config, version: options.version, areas: options.areas ?? [], now: io.now, log: lineLog(io.err, io.now) });
  try {
    const running = app.start();
    io.out(`RPE ${options.version} listens on ${running.url} (data folder: ${paths.root}).`);
    if (app.auth.owner === null) io.out(NO_OWNER);
    if (!currentKeys(app.db).some((k) => k.kind === "provider")) io.out("There is no provider key yet: make one with `rpe key`.");
    const waiting = app.switches.list().filter((s) => s.state === "waiting").length;
    if (waiting > 0) io.out(`${waiting} waiting to be switched on: \`rpe status\` lists them.`);
    await io.stopped();
  } finally {
    await app.close();
  }
  return 0;
}

/** Runs one command; returns the exit code. */
export async function runCli(argv: readonly string[], io: CliIO, options: CliOptions): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "help" || command === "--help") {
      io.out(USAGE);
      return command === undefined ? 2 : 0;
    }
    const allowed = FLAGS[command];
    if (allowed === undefined) throw new UsageError(`rpe has no command "${command}".`);
    const { words, flags } = parseArgs(rest, allowed);
    const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
    const config = await loadConfig(paths, io.env);
    if ((command === "serve" || command === "status" || command === "backup") && words.length > 0) throw new UsageError(`rpe ${command} takes no words.`);
    switch (command) {
      case "serve":
        return await serveCommand(paths, config, io, options);
      case "status":
        return await statusCommand(paths, config, io, options.version);
      case "backup": {
        const made = await makeBackup(paths, io.now(), flags.out);
        io.out(`Backed up the database and ${made.files} files of the tree to ${made.path} (${(made.bytes / 1048576).toFixed(1)} MiB, sha256 ${made.sha256}).`);
        if (made.skipped.length > 0) io.out(`Left out, being links: ${made.skipped.join(", ")}.`);
        return 0;
      }
      case "key":
        await prepareDataFolder(paths);
        return keyCommand(words, paths, config, io, options.version);
      case "connection":
        return await connectionCommand(words, flags, paths, config, io, options.version);
      default: {
        const name = words[0];
        if (words.length !== 1 || name === undefined) throw new UsageError(`rpe ${command} takes one name.`);
        return switchCommand(name, command === "allow" ? "on" : "off", paths, io);
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err(USAGE);
      return 2;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
