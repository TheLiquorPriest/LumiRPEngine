// The command line `rpe` (plan §4.4, §4.6, §16), as functions over the process's input and output
// (`main.ts` gives the real ones). `serve` runs RPE in the foreground; `status`, `key`, `allow`,
// `deny` and `backup` work on the data folder directly, so they work whether RPE runs or not; and
// `connection` is a client of the running server's API, because the connections' one writer, RPH's
// model layer, lives in that process. `allow` and `deny` are the one way anything that runs a command
// or calls out is switched on or off: no route of the API can do it. `lumiverse` says which Lumiverse
// this RPE belongs to and signs in to it, writing the config and the secrets file itself, so a running
// server takes it when it starts again.

import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ConnectionInput, Effort } from "rp-harness/contract";
import { EXTENSION_IDENTIFIER } from "../adapter/lumiverse/pipe-wire";
import { LumiverseError, LumiverseSession, type StoredSignIn } from "../adapter/lumiverse/session";
import { goingBack } from "../migrate/going-back";
import { earlierRuns } from "../migrate/migrate";
import { migrateCli } from "../migrate/cli";
import type { TreeLayout } from "../migrate/own-files";
import { runtimeFoldersOf } from "../migrate/runtime-folders";
import { type Loopback, swapCheck, swapRun, todaysBuildInstalled, whoseRefusals } from "../migrate/swap";
import { isRecord } from "../shared/json";
import { TREE_MIGRATIONS, TreeChats } from "../tree/chats";
import { CHATS_FOLDER, GLOBAL_CONFIG, GLOBAL_FOLDERS, NOTES_FOLDER, SHIPPED_FOLDER } from "../tree/layout";
import type { Area } from "./app";
import { lineLog, openApp, STATUS_PATH } from "./app";
import { type AppFile, updateSettings, versionOf } from "./update";
import type { KeyKind } from "./auth";
import { currentKeys, insertKey, insertPageToken, newKeyText, NO_OWNER, secretHash, takeKeyHash } from "./auth";
import { makeBackup } from "./backup";
import type { AppConfig, DataPaths, Env } from "./config";
import { CONFIG_ENV, dataPaths, defaultDataFolder, loadConfig, plainText, prepareDataFolder, updateConfigFile, webAddress } from "./config";
import { readText, writeWhole } from "./disk";
import type { ConnectionShown, ConnectionsShown } from "./connections";
import { openDatabase } from "./database";
import { appliedMigrations, migrate, Migrations } from "./migrations";
import { APP_MIGRATIONS } from "./schema";
import { SecretsFile } from "./secrets";
import { listSwitches, setSwitch } from "./switches";
import { accountSystemctl, connectionsWhere, installedExtension, localUrl, type LumiverseCall, removeRpeService, type RpeService, rpeService, rpeServiceOf, rpeUnitText, serviceNameOf, settleConnection, type SettledConnection, startRpeService, TODAYS_MODEL } from "./up";

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
  /** The app file this process runs (`dist/rpe.js`, as `rpe up`'s service starts it): `serve` keeps its hash and restarts onto a new build of it. Absent where there is none. */
  appFile?: string;
}

const USAGE = [
  "rpe: RPEngine's own application.",
  "",
  "  rpe up --url <address> --user <username> [--systemd] [--name <name>]",
  "         [--lumiverse <folder> [--runtime <name> | --no-runtime] [--runtime-config <folder>]",
  "          [--runtime-data <folder>] [--identifier <id>]]",
  "                                 set RPE up with Lumiverse: sign in, make RPE's connection there,",
  "                                 and say what is left to do; run again, it changes nothing.",
  "                                 --systemd: run RPE as a service of this account (rpe-<name>.service).",
  "                                 --lumiverse: the swap, once the extension runs the new build: wait for",
  "                                 today's build to be idle, stop its service, migrate again from",
  "                                 Lumiverse's data folder, and start RPE's service in its place, at its",
  "                                 address, under its model name and with its key, so its connection",
  "                                 in Lumiverse goes on working; then switch today's service off",
  "  rpe down                       stop and remove RPE's service; its data stays where it is",
  "  rpe serve                      run RPE in the foreground",
  "  rpe status                     what this RPE is, and whether it answers",
  "  rpe version                    this build's id (also rpe --version)",
  "  rpe lumiverse                  which Lumiverse this RPE belongs to, and its sign-in",
  "  rpe lumiverse --url <address> --user <username> [--database <file>] [--connection <id>]",
  "                                 set it and sign in; the password is asked for, never kept",
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
  "  rpe migrate [--rehearse] --lumiverse <folder> --user <id> [...]",
  "                                 carry today's build's data into RPE; --rehearse writes nothing",
  "                                 (rpe migrate alone lists the rest)",
  "",
  "Every command takes --data <folder>: the data folder (default: $RPE_DATA, else ~/.local/share/rpe).",
].join("\n");

/** The flags each command takes. `up` and `down` read their own lines: `up` takes switches as well. */
const FLAGS: Readonly<Record<string, readonly string[]>> = {
  serve: ["data"],
  status: ["data"],
  lumiverse: ["data", "url", "user", "database", "connection"],
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
  return localUrl(config.address, config.port);
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

/** What answers at RPE's own address now: RPE (with its version, and its builds in words), something else (with its status), or nothing. */
async function serverAnswer(config: AppConfig, io: CliIO): Promise<{ rpe: string; builds: string | null } | { other: number } | null> {
  try {
    const res = await io.fetch(`${serverUrl(config)}${STATUS_PATH}`, { signal: AbortSignal.timeout(config.commandLine.waitMs) });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !isRecord(body) || body.name !== "rpe") return { other: res.status };
    return { rpe: String(body.version), builds: isRecord(body.builds) && typeof body.builds.words === "string" ? body.builds.words : null };
  } catch {
    // Not running, or not reachable.
    return null;
  }
}

async function statusCommand(paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  io.out(`RPE ${version}`);
  io.out(`Data folder: ${paths.root}`);
  const answer = await serverAnswer(config, io);
  io.out(`Listens on: ${serverUrl(config)}, ${answer === null ? "not answering" : "rpe" in answer ? `answering (RPE ${answer.rpe})` : `answering, but not as RPE (${answer.other})`}`);
  if (answer !== null && "rpe" in answer && answer.builds !== null) io.out(`Builds: ${answer.builds}`);
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

/** The part of the secrets file the adapter keeps its sign-in to Lumiverse in (src/adapter/lumiverse/mount.ts). */
const SIGN_IN_PART = "lumiverse";

/** Which Lumiverse this RPE belongs to, and its sign-in: never the token. */
async function showLumiverse(paths: DataPaths, config: AppConfig, io: CliIO): Promise<void> {
  const { url, user, database, connection } = config.lumiverse;
  const fromEnv = (name: string): string => (io.env[name]?.trim() ? ` (from ${name}, which wins over the config file)` : "");
  io.out(`Lumiverse: ${url ?? "not set"}${fromEnv(CONFIG_ENV.lumiverseUrl)}`);
  io.out(`User: ${user ?? "not set"}${fromEnv(CONFIG_ENV.lumiverseUser)}`);
  io.out(`Database: ${database ?? "not set, so Lumiverse is read over HTTP"}`);
  io.out(`RPE's connection in Lumiverse: ${connection ?? "not set"}`);
  const kept = await new SecretsFile(paths.secrets).read(SIGN_IN_PART);
  if (!isRecord(kept) || typeof kept.username !== "string" || typeof kept.user !== "string") {
    io.out("Signed in: no");
    return;
  }
  const since = typeof kept.savedAt === "number" ? ` since ${new Date(kept.savedAt).toISOString().slice(0, 10)}` : "";
  io.out(`Signed in: as ${kept.username} (user ${kept.user})${since}${kept.user === user ? "" : ", which is not the user above: sign in again"}`);
}

/**
 * A session with Lumiverse at `url` for the command line, from a kept sign-in or none; a sign-in
 * Lumiverse takes is kept in the secrets file once `guard` (where given) has not refused its user.
 */
function commandLineSession(url: string, signIn: StoredSignIn | null, paths: DataPaths, config: AppConfig, io: CliIO, guard?: (user: string) => void): LumiverseSession {
  const secrets = new SecretsFile(paths.secrets);
  return new LumiverseSession({
    base: url,
    // Past this the address counts as one that does not answer.
    fetch: (address, init) => io.fetch(address, { ...init, signal: AbortSignal.timeout(config.commandLine.signInMs) }),
    signIn,
    // Called only once Lumiverse has taken the password, or has said a kept sign-in ended.
    async save(next) {
      if (next !== null) guard?.(next.user);
      await prepareDataFolder(paths);
      await secrets.write(SIGN_IN_PART, next === null ? null : { ...next });
    },
    // The server's own command line says whose RPE this is, so any account may sign in here.
    owner: () => null,
    // The handle is one this setTimeout gave.
    clock: { now: io.now, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]) },
    log: io.err,
  });
}

/**
 * Whose RPE this is, asked of a sign-in once Lumiverse has taken the password and before the sign-in,
 * the config, a key or a connection is written, by the migration gate's own checks (`whoseRefusals`):
 * one RPE serves one Lumiverse user, so a sign-in as another user than the one it belongs to, or than
 * the one whose data a migration carried into it, is refused. An RPE nobody has signed in to and
 * nothing was carried into takes whoever signs in first.
 */
function oneUser(paths: DataPaths, config: AppConfig): (user: string) => void {
  return (user) => {
    const refusals = whoseRefusals(paths.root, config.lumiverse.user, user);
    if (refusals.length > 0) throw new Error(`${refusals.join(" ")} Nothing was stopped or changed.`);
  };
}

/**
 * Signs in to Lumiverse at `url` as `username` with the password asked for. Only once Lumiverse has
 * taken it, and `guard` has not refused the user it signs in as, are the sign-in kept and the config
 * written (with `more` in its `lumiverse` block), so a refusal changes nothing. The user written is
 * the id Lumiverse answers for the username, which is what pages and Lumiverse's rows name.
 */
async function signInTo(url: string, username: string, more: Record<string, string>, paths: DataPaths, config: AppConfig, io: CliIO, guard: (user: string) => void): Promise<LumiverseSession> {
  const password = await io.secret(`The Lumiverse password of ${username} (it is not shown, and not kept): `);
  if (password === null) throw new Error("Signing in needs the password.");
  const session = commandLineSession(url, null, paths, config, io, guard);
  const signedIn = await session.signIn(username, password);
  await updateConfigFile(paths, (raw) => {
    raw.lumiverse = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}), url, user: signedIn.user, ...more };
  });
  io.out(`Signed in to Lumiverse at ${url} as ${signedIn.username}. This RPE belongs to that Lumiverse user (${signedIn.user}).`);
  return session;
}

/** `rpe lumiverse`: with no flags, what is set; with them, the sign-in, and then what is set. */
async function lumiverseCommand(flags: Flags, paths: DataPaths, config: AppConfig, io: CliIO): Promise<number> {
  if (flags.url === undefined && flags.user === undefined && flags.database === undefined && flags.connection === undefined) {
    await showLumiverse(paths, config, io);
    return 0;
  }
  const username = flags.user;
  if (flags.url === undefined || username === undefined) throw new UsageError("rpe lumiverse needs --url and --user to sign in; with no flags it shows what is set.");
  const url = webAddress(flags.url, "--url");
  const connection = flags.connection === undefined ? undefined : plainText(flags.connection, "--connection");
  const database = flags.database === undefined ? undefined : resolve(flags.database);
  if (database !== undefined && !(existsSync(database) && statSync(database).isFile())) throw new Error(`There is no file at ${database}: give --database the path of Lumiverse's database file, or leave it out to read Lumiverse over HTTP.`);
  await signInTo(url, username, { ...(database === undefined ? {} : { database }), ...(connection === undefined ? {} : { connection }) }, paths, config, io, oneUser(paths, config));
  await showLumiverse(paths, await loadConfig(paths, io.env), io);
  const answer = await serverAnswer(config, io);
  if (answer !== null && "rpe" in answer) io.out(`RPE is running at ${serverUrl(config)}: restart it (stop \`rpe serve\` and start it again) for it to take this.`);
  return 0;
}

/** The kept sign-in, when it is to `url` as `username` for the user this RPE belongs to and Lumiverse still takes it; null otherwise. */
async function keptSession(url: string, username: string, paths: DataPaths, config: AppConfig, io: CliIO): Promise<LumiverseSession | null> {
  const kept = await new SecretsFile(paths.secrets).read(SIGN_IN_PART);
  const user = config.lumiverse.user;
  if (config.lumiverse.url !== url || user === null || !isRecord(kept) || kept.username !== username || kept.user !== user || typeof kept.token !== "string" || typeof kept.savedAt !== "number") return null;
  const session = commandLineSession(url, { username, user, token: kept.token, savedAt: kept.savedAt }, paths, config, io);
  try {
    await session.check();
  } catch (error) {
    // Ended: it has said so, and a new sign-in follows.
    if (error instanceof LumiverseError && error.problem === "lost") return null;
    throw error;
  }
  return session;
}

/** The switches `rpe up` takes beside its flags, and its flags. */
const UP_SWITCHES = ["systemd", "no-runtime"] as const;
const UP_FLAGS = ["data", "url", "user", "name", "lumiverse", "runtime", "runtime-config", "runtime-data", "identifier"] as const;
/** A service's name, as it goes into its unit's name: as today's runtime's names are held (LumiAH `RUNTIME_NAME`). */
const SERVICE_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * RPE's own connection in Lumiverse, made or brought into line at `apiUrl` (up.ts), its id kept in
 * `lumiverse.connection`, what was done said. Its key is in force only once Lumiverse holds it, so a
 * refusal leaves the key before it working.
 */
async function ownConnection(call: LumiverseCall, apiUrl: string, paths: DataPaths, current: AppConfig, version: string, io: CliIO): Promise<SettledConnection & { moved: boolean }> {
  const fresh: { key: string | null } = { key: null };
  const db = commandLineDatabase(paths, current, version, io.now);
  let hadKey: boolean;
  let settled: SettledConnection;
  try {
    hadKey = currentKeys(db).some((k) => k.kind === "provider");
    settled = await settleConnection(call, current.lumiverse.connection, { apiUrl, models: current.lumiverse.models, hasKey: hadKey, makeKey: () => (fresh.key = newKeyText("provider")) });
    const key = fresh.key;
    if (key !== null) db.transaction(() => insertKey(db, "provider", io.now(), key)).immediate();
  } finally {
    db.close();
  }
  const moved = settled.id !== current.lumiverse.connection;
  if (moved) {
    await updateConfigFile(paths, (raw) => {
      raw.lumiverse = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}), connection: settled.id };
    });
  }
  const named = `"${settled.name}" (${settled.id})`;
  if (settled.todays !== null) io.out(`The connection ${settled.todays} that RPE's config named is the one today's build made for its runtime: it is left as it is, for going back.`);
  if (settled.made) io.out(`Made RPE's connection in Lumiverse, ${named}: OpenAI-compatible, at ${apiUrl}, with a new provider key only it holds.`);
  else if (settled.changed.length > 0) io.out(`Brought RPE's connection in Lumiverse, ${named}, up to date: ${settled.changed.join(", ")}.`);
  else io.out(`RPE's connection in Lumiverse, ${named}, is already as it should be.`);
  if (settled.newKey && hadKey) io.out("A new provider key was made for it, and the one before it no longer works.");
  return { ...settled, moved };
}

/**
 * What RPE takes of today's at the swap (plan §15.2), written into its own config and keys: where
 * today's runtime listened, the model name today's connection in Lumiverse names and the hash of the
 * key it holds, and `connection` as RPE's connection there. Resolves to what puts RPE's config back
 * as it was; a key hash taken stays, since only today's connection holds that key, and it reaches
 * RPE only where today's runtime answered.
 */
async function takeOver(paths: DataPaths, current: AppConfig, version: string, io: CliIO, loopback: Loopback | null, connection: string): Promise<() => Promise<void>> {
  const before = await readText(paths.config);
  await updateConfigFile(paths, (raw) => {
    const models = loopback === null || current.lumiverse.models.includes(loopback.model) ? {} : { models: [...current.lumiverse.models, loopback.model] };
    raw.lumiverse = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}), connection, ...models };
    if (loopback !== null) Object.assign(raw, { address: loopback.at.address, port: loopback.at.port });
  });
  const hash = loopback?.keyHash ?? null;
  if (hash !== null) {
    const db = commandLineDatabase(paths, current, version, io.now);
    try {
      db.transaction(() => takeKeyHash(db, "provider", hash, io.now())).immediate();
    } finally {
      db.close();
    }
  }
  return async () => {
    if (before === null) await rm(paths.config, { force: true });
    else await writeWhole(paths.config, before);
  };
}

/** The lines of what is left for the user to do. */
function sayLeft(left: readonly string[], io: CliIO): void {
  io.out("");
  io.out("What is left for you to do:");
  left.forEach((line, i) => io.out(`  ${i + 1}. ${line}`));
}

/** What is left in Lumiverse for RPE's extension: installed, and on. */
async function extensionLeft(call: LumiverseCall): Promise<string[]> {
  const extension = await installedExtension(call, EXTENSION_IDENTIFIER);
  if (extension === null) return ["Install RPE's extension in Lumiverse, from its git repository's standalone branch, and have an admin approve the permissions it asks for."];
  return extension.on ? [] : ["Switch RPE's extension on in Lumiverse."];
}

/** Where `rpe up --lumiverse` finds today's build, and RPE's service, as `upCommand` read them. */
interface SwapLine {
  flags: Flags;
  switches: ReadonlySet<string>;
  paths: DataPaths;
  current: AppConfig;
  call: LumiverseCall;
  service: RpeService;
  existing: RpeService | null;
  unitText: string;
}

/**
 * The swap (src/migrate/swap.ts), from the command line: it checks before stopping anything, settles
 * RPE's connection in Lumiverse (today's loopback, kept as it is, where Lumiverse holds one; else
 * RPE's own, where RPE answers once swapped), then swaps, RPE taking today's runtime's place.
 */
async function swapUp(line: SwapLine, io: CliIO, version: string): Promise<number> {
  const { flags, switches, paths, current, call, service, existing } = line;
  const user = current.lumiverse.user;
  if (user === null) throw new Error("RPE's config names no Lumiverse user after the sign-in.");
  if (existing !== null && existing.unit !== service.unit) {
    io.err(`RPE's service for this data folder is ${existing.unit}, and --name asks for ${service.unit}: the swap starts RPE's own service again, so run it without --name. Nothing was stopped or changed.`);
    return 1;
  }
  // The migration is the data folder's one writer: a running RPE outside a service is stopped by the user, one in its service by the swap.
  const answer = await serverAnswer(current, io);
  if (answer !== null && "rpe" in answer && existing === null) {
    io.err(`RPE is running at ${serverUrl(current)}, outside a service: stop it (rpe serve), then run rpe up again. Nothing was stopped or changed.`);
    return 1;
  }
  // The extension is switched to the new build first (§15.3 step 10): today's, left running in Lumiverse, would go on writing today's storage after the run had read it.
  const identifier = flags.identifier ?? EXTENSION_IDENTIFIER;
  if (todaysBuildInstalled((await installedExtension(call, identifier))?.permissions ?? null)) {
    io.err(`Lumiverse still has today's build of the extension (${identifier}) installed: its manifest asks for the permissions the previous build asks for. Switch the installed extension to the new build's branch in Lumiverse and approve its permissions first, then run rpe up again. Nothing was stopped or changed.`);
    return 1;
  }
  const found = runtimeFoldersOf(io.env, io.home);
  const runtime = switches.has("no-runtime") ? null : { configDir: flags["runtime-config"] ?? found.configDir, dataDir: flags["runtime-data"] ?? found.dataDir };
  const swapIo = { out: io.out, fetch: io.fetch, now: io.now, sleep: (ms: number) => Bun.sleep(ms), systemctl: accountSystemctl(io.env, process.getuid?.() ?? null) };
  const sources = { lumiverse: resolve(flags.lumiverse ?? ""), identifier, userId: user, runtime, ...(flags.runtime !== undefined ? { runtimeName: flags.runtime } : {}) };
  const plan = await swapCheck({ sources, options: { data: paths.root, version, env: io.env, tree: treeLayout() }, rpe: { address: current.address, port: current.port }, waitMs: current.commandLine.waitMs }, swapIo);
  if (plan === null) return 1;

  // Today's connection in Lumiverse becomes RPE's, as it is; RPE makes its own only where Lumiverse holds no loopback of today's.
  const loopbacks = plan.took === null ? [] : await connectionsWhere(call, plan.took.config.tuning.connectionsRead, plan.took.loopback.is);
  const [todays, ...others] = loopbacks;
  const connection = todays ?? (await ownConnection(call, `${localUrl(plan.at.address, plan.at.port)}/v1`, paths, current, version, io));
  if (todays !== undefined) io.out(`RPE's connection in Lumiverse is to be "${todays.name}" (${todays.id}), the one today's build made for its runtime: it is left as it is, and the chats that use it go on working once RPE answers in today's runtime's place.`);
  if (todays !== undefined && others.length > 0) io.out(`These connections in Lumiverse reach today's runtime too: ${others.map((c) => `"${c.name}" (${c.id})`).join(", ")}. RPE plays only the chats on "${todays.name}": choose it for the chats on those.`);

  if (!(await swapRun(plan, { service, text: line.unitText, installed: existing !== null, startMs: current.commandLine.startMs, waitMs: current.commandLine.waitMs, takeOver: () => takeOver(paths, current, version, io, plan.took?.loopback ?? null, connection.id) }, swapIo))) return 1;
  const left = await extensionLeft(call);
  left.push(`RPE's service's own log, should you need it: journalctl --user -u ${service.unit}.`);
  if (todays === undefined) left.push(`In Lumiverse, choose the connection "${connection.name}" for the chats RPE should play.`);
  sayLeft(left, io);
  return 0;
}

/**
 * `rpe up` (plan §4.6, §15.3 step 10): the one command a new install runs, and the swap. It signs in
 * to Lumiverse (a kept sign-in to the same Lumiverse and user that still holds is used as it is, and
 * no password is asked). A new install makes RPE's connection there or brings it into line (up.ts;
 * today's build's own connection is never changed), keeps its id in `lumiverse.connection`, and runs
 * RPE as a service of the account where asked (`--systemd`). Given Lumiverse's data folder
 * (`--lumiverse`), it swaps instead (`swapUp`): RPE takes today's runtime's place, its address, its
 * model name and its key, so today's connection in Lumiverse goes on working as it is. One RPE
 * service already there for this data folder is kept, and started again on what this run wrote. Last
 * it says what is left for the user to do. What already matches is left alone, so a second run
 * changes nothing.
 */
async function upCommand(argv: readonly string[], io: CliIO, version: string): Promise<number> {
  const switched = argv.filter((a) => a.startsWith("--") && (UP_SWITCHES as readonly string[]).includes(a.slice(2)));
  const switches = new Set(switched.map((a) => a.slice(2)));
  const { words, flags } = parseArgs(
    argv.filter((a) => !switched.includes(a)),
    UP_FLAGS,
  );
  const username = flags.user;
  if (words.length > 0) throw new UsageError("rpe up takes no words.");
  if (flags.url === undefined || username === undefined) throw new UsageError("rpe up needs --url and --user.");
  const swapping = flags.lumiverse !== undefined;
  if (!swapping && (switches.has("no-runtime") || flags.runtime !== undefined || flags["runtime-config"] !== undefined || flags["runtime-data"] !== undefined || flags.identifier !== undefined)) throw new UsageError("--runtime, --no-runtime, --runtime-config, --runtime-data and --identifier say where today's build is: they go with --lumiverse.");
  if (switches.has("no-runtime") && flags.runtime !== undefined) throw new UsageError("--runtime names a runtime to take and --no-runtime says there is none: give one of them.");
  if (flags.name !== undefined && !SERVICE_NAME.test(flags.name)) throw new UsageError(`--name is "${flags.name}": use lowercase letters, digits, _ and -, up to 40.`);
  const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
  const config = await loadConfig(paths, io.env);
  const url = webAddress(flags.url, "--url");
  // Whose RPE this is is asked once Lumiverse has taken the password, before anything is written; a kept sign-in is the owner's own, and is asked of the data a migration carried.
  const guard = oneUser(paths, config);
  const kept = await keptSession(url, username, paths, config, io);
  if (kept !== null && config.lumiverse.user !== null) guard(config.lumiverse.user);
  const session = kept ?? (await signInTo(url, username, {}, paths, config, io, guard));
  const current = await loadConfig(paths, io.env);
  const call: LumiverseCall = (method, path, body) => session.request(method, path, body);

  // RPE's service: its unit for this data folder where there is one, else one named for this RPE, which must be no other RPE's.
  const data = resolve(paths.root);
  const existing = await rpeServiceOf(data, io.env, io.home);
  const service = rpeService(flags.name ?? existing?.name ?? serviceNameOf(username), io.env, io.home);
  if (service.unit !== existing?.unit && existsSync(service.file) && (switches.has("systemd") || swapping)) {
    io.err(`${service.file} is a unit for something other than this RPE (another data folder's): give this RPE's service a name of its own with --name. Nothing was stopped or changed.`);
    return 1;
  }
  const unitText = rpeUnitText({ name: service.name, bun: process.execPath, script: Bun.main, data });
  if (swapping) return await swapUp({ flags, switches, paths, current, call, service, existing, unitText }, io, version);

  const settled = await ownConnection(call, `${serverUrl(current)}/v1`, paths, current, version, io);
  const runs = switches.has("systemd") || existing !== null;
  if (runs) {
    const systemctl = accountSystemctl(io.env, process.getuid?.() ?? null);
    if (existing !== null && existing.unit !== service.unit) await removeRpeService(existing, systemctl);
    await startRpeService(service, unitText, systemctl);
    io.out(`Started ${service.unit}, RPE's service.`);
  }
  const left = await extensionLeft(call);
  if (runs) left.push(`See that RPE answers: rpe status (its service's own log: journalctl --user -u ${service.unit}).`);
  else {
    const answer = await serverAnswer(current, io);
    if (answer === null) left.push("Start RPE: rpe serve.");
    else if (!("rpe" in answer)) left.push(`Something other than RPE answers at ${serverUrl(current)}: give RPE a free port ("port" in its config, or RPE_PORT), and run rpe up again.`);
    else if (kept === null || settled.moved) left.push("Restart RPE (stop rpe serve and start it again) so it takes this.");
  }
  left.push(`In Lumiverse, choose the connection "${settled.name}" for the chats RPE should play.`);
  sayLeft(left, io);
  return 0;
}

/**
 * `rpe down` (plan §15.6 step 1): stops and removes RPE's service for its data folder, and leaves
 * the data where it is; then the steps of going back, with the runtime the last run took the place of,
 * and RPE's own connection in Lumiverse where RPE answered on one rather than on today's.
 */
async function downCommand(argv: readonly string[], io: CliIO): Promise<number> {
  const { words, flags } = parseArgs(argv, ["data"]);
  if (words.length > 0) throw new UsageError("rpe down takes no words.");
  const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
  const config = await loadConfig(paths, io.env);
  const data = resolve(paths.root);
  const service = await rpeServiceOf(data, io.env, io.home);
  if (service === null) io.out(`RPE has no service for the data folder ${data}: nothing to stop.`);
  else {
    await removeRpeService(service, accountSystemctl(io.env, process.getuid?.() ?? null));
    io.out(`Stopped and removed ${service.unit}. RPE's data stays where it is, in ${data}.`);
  }
  const user = config.lumiverse.user;
  const taken = user === null ? null : (earlierRuns(paths.database, user).previous?.runtime?.taken ?? null);
  // RPE answers to today's model name once the swap took today's connection over; else the connection its config names is its own.
  const own = config.lumiverse.models.some((m) => TODAYS_MODEL.test(m)) ? null : config.lumiverse.connection;
  io.out("");
  for (const line of goingBack({ identifier: EXTENSION_IDENTIFIER, runtime: taken === null ? null : { name: taken.name, source: taken.source }, own })) io.out(line);
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
    const list = await withServer(paths, config, io, version, async (api) => replyOf<ConnectionsShown>(await api("GET", "/api/v1/connections")));
    if (list.connections.length === 0) io.out("No connections yet: add one with `rpe connection add`.");
    for (const c of list.connections) {
      const key = c.key === null ? "signs with no key" : c.key.set ? "key set" : "no key set";
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
    const saved = await withServer(paths, config, io, version, async (api) => replyOf<ConnectionShown>(await api("POST", "/api/v1/connections", { connection, ...(key === null ? {} : { key }) })));
    io.out(`Added ${saved.name} (${saved.id}).`);
    return 0;
  }
  if (sub === "remove" && words.length === 2) {
    const which = words[1] ?? "";
    const removed = await withServer(paths, config, io, version, async (api) => {
      const list = await replyOf<ConnectionsShown>(await api("GET", "/api/v1/connections"));
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

/** The file tree's layout as the migration takes it: the folders of the user's own files, the tree's tables, and each chat's own folder, placed as the tree places a chat. */
function treeLayout(): TreeLayout {
  return {
    agents: GLOBAL_FOLDERS.agents,
    skills: GLOBAL_FOLDERS.skills,
    prompts: GLOBAL_FOLDERS.prompts,
    notes: NOTES_FOLDER,
    tables: { area: "files", migrations: TREE_MIGRATIONS },
    // The run is the one writer of RPE's database while it runs, so the tree's writes go to it directly.
    chatFolder: async (db, files, user, chat, names) => {
      const at = await new TreeChats(db, { run: async (write) => write(db) }, files).place(user, chat, names);
      return join(CHATS_FOLDER, at.character, at.chat);
    },
  };
}

/**
 * `rpe migrate`: the migration's own command line (src/migrate/cli.ts), into RPE's data folder unless
 * the line names another; the user's own files into the folders the file tree's layout gives them,
 * each chat's notes into that chat's own folder, placed as the tree places a chat.
 */
async function migrateCommand(rest: readonly string[], io: CliIO, version: string): Promise<number> {
  const line = rest.includes("--data") ? rest : [...rest, "--data", defaultDataFolder(io.env, io.home)];
  // Its output is whole texts, this one's lines; and it reads the build's id from the environment, where a built `rpe` does not put it.
  return await migrateCli(line, { out: (text) => io.out(text.replace(/\n$/, "")), err: io.err, env: { ...io.env, LRE_BUILD_ID: version }, home: io.home }, treeLayout());
}

/** Whether this process is the one RPE's service runs (its unit's main process), which the account's manager starts again when it exits. */
async function runByService(paths: DataPaths, io: CliIO): Promise<boolean> {
  const service = await rpeServiceOf(paths.root, io.env, io.home);
  if (service === null) return false;
  const ran = await accountSystemctl(io.env, process.getuid?.() ?? null)(["show", "--property=MainPID", "--value", service.unit]);
  return ran.code === 0 && Number(ran.out.trim()) === process.pid;
}

async function serveCommand(paths: DataPaths, config: AppConfig, io: CliIO, options: CliOptions): Promise<number> {
  const log = lineLog(io.err, io.now);
  // A restart onto a new build of the app file ends `serve` as a stop does, and RPE's service starts the new file.
  const restart = Promise.withResolvers<void>();
  const appFile: AppFile | null =
    options.appFile === undefined
      ? null
      : {
          path: options.appFile,
          buildOf: (path, waitMs) => versionOf(process.execPath, path, waitMs),
          settings: async () => updateSettings(await Promise.all([join(paths.files, SHIPPED_FOLDER, GLOBAL_CONFIG), paths.globalConfig].map((file) => readText(file))), log),
          service: () => runByService(paths, io),
          restart: () => restart.resolve(),
          sleep: (ms) => Bun.sleep(ms),
        };
  const app = await openApp({ paths, config, version: options.version, areas: options.areas ?? [], now: io.now, log, appFile });
  try {
    const running = await app.start();
    io.out(`RPE ${options.version} listens on ${running.url} (data folder: ${paths.root}).`);
    if (app.auth.owner === null) io.out(NO_OWNER);
    if (!currentKeys(app.db).some((k) => k.kind === "provider")) io.out("There is no provider key yet: make one with `rpe key`.");
    const waiting = app.switches.list().filter((s) => s.state === "waiting").length;
    if (waiting > 0) io.out(`${waiting} waiting to be switched on: \`rpe status\` lists them.`);
    // The file as it is once RPE listens: a build put there while it started is noticed now.
    await app.builds.check();
    await Promise.race([io.stopped(), restart.promise]);
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
    // The build's id alone: no data folder is read and nothing is asked over the network.
    if (command === "version" || command === "--version") {
      if (rest.length > 0) throw new UsageError(`rpe ${command} takes nothing more.`);
      io.out(`rpe ${options.version}`);
      return 0;
    }
    // The migration reads its own line, and writes only once it is not a rehearsal; `up` and `down` read theirs, `up` with its switches.
    if (command === "migrate") return await migrateCommand(rest, io, options.version);
    if (command === "up") return await upCommand(rest, io, options.version);
    if (command === "down") return await downCommand(rest, io);
    const allowed = FLAGS[command];
    if (allowed === undefined) throw new UsageError(`rpe has no command "${command}".`);
    const { words, flags } = parseArgs(rest, allowed);
    const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
    const config = await loadConfig(paths, io.env);
    if ((command === "serve" || command === "status" || command === "backup" || command === "lumiverse") && words.length > 0) throw new UsageError(`rpe ${command} takes no words.`);
    switch (command) {
      case "serve":
        return await serveCommand(paths, config, io, options);
      case "status":
        return await statusCommand(paths, config, io, options.version);
      case "lumiverse":
        return await lumiverseCommand(flags, paths, config, io);
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
