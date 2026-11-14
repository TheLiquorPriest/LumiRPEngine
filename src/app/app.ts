// The application (plan §4.1, §4.4): one process that holds the database and its write queue, the
// route table, the live hub, auth and the switches, and serves them. `openApp` makes it ready over a
// data folder, migrating the database and mounting every area, and `start` makes it listen. An area
// reaches the app through `App` and nothing else.

import type { Database } from "bun:sqlite";
import type { JsonValue, Log, ModelsPort } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import { Auth } from "./auth";
import type { AppConfig, DataPaths } from "./config";
import { prepareDataFolder } from "./config";
import { modelsPort } from "./connections";
import { openDatabase, WriteQueue } from "./database";
import { LiveHub, liveRoute } from "./live";
import type { Migration, MigrationArea, MigrationOutcome } from "./migrations";
import { migrate, Migrations } from "./migrations";
import { route, RouteError, RouteTable } from "./routes";
import { APP_MIGRATIONS } from "./schema";
import { SecretsFile } from "./secrets";
import type { RunningServer } from "./server";
import { startServer } from "./server";
import { guardSwitches, Switches } from "./switches";

export const STATUS_PATH = "/api/v1/status";
/** Where the extension asks for a page token for a page of its user. */
export const PAGE_TOKEN_PATH = "/api/v1/ext/page-token";

/**
 * An area of RPE as the app mounts it: its tables, and what it adds once they are up to date (its
 * routes, its live events, its writers). Areas are mounted in the order given.
 */
export interface Area {
  readonly name: string;
  /** Its tables: the migration area they are kept under, and its migrations. */
  readonly tables?: { readonly area: MigrationArea; readonly migrations: readonly Migration[] };
  readonly mount?: (app: App) => void | Promise<void>;
}

export interface App {
  readonly version: string;
  readonly config: AppConfig;
  readonly paths: DataPaths;
  /** The database. Read from it at any time; write only through `writes`, outside which it takes no writes. */
  readonly db: Database;
  readonly writes: WriteQueue;
  readonly routes: RouteTable;
  readonly live: LiveHub;
  readonly auth: Auth;
  readonly switches: Switches;
  readonly secrets: SecretsFile;
  /** Where RPH's model layer keeps the connections and their secrets: the host's `Environment.models`. */
  readonly models: ModelsPort;
  readonly log: Log;
  readonly now: () => number;
  /** What the migrations did when the app opened. */
  readonly migrated: MigrationOutcome;
  /** Listens, with the route table as it stands; it takes no more routes after. */
  start(): RunningServer;
  /** The server once it listens (its port and address, for the addresses a page is handed); null before. */
  listening(): RunningServer | null;
  /** Stops listening, lets the writes already queued land, and closes the database. */
  close(): Promise<void>;
}

export interface OpenAppOptions {
  paths: DataPaths;
  config: AppConfig;
  /** This build's version: the database is copied before the first migration of a new one. */
  version: string;
  areas?: readonly Area[];
  now?: () => number;
  log?: Log;
}

/** A log of plain lines to `write` (standard error, in the server). Fields carry ids and counts, never a secret. */
export function lineLog(write: (line: string) => void, now: () => number = Date.now): Log {
  const line =
    (level: string) =>
    (message: string, fields?: Record<string, JsonValue>): void =>
      write(`${new Date(now()).toISOString()} ${level} ${message}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`);
  return { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };
}

function pageTokenAsk(value: unknown): { user: string } {
  if (!isRecord(value) || typeof value.user !== "string" || value.user === "") throw new RouteError(400, 'Send {"user": "<the Lumiverse user id of the page>"}.');
  return { user: value.user };
}

/** The app's own routes: its status, the page tokens the extension asks for, and the live socket. */
function appRoutes(version: string, started: number, auth: Auth) {
  return [
    route({ method: "GET", path: STATUS_PATH, access: "public", handle: () => ({ name: "rpe", version, started, belongsToUser: auth.owner !== null }) }),
    route({ method: "POST", path: PAGE_TOKEN_PATH, access: "extension", body: pageTokenAsk, handle: ({ body }) => auth.mintPageToken(body.user, "extension") }),
    liveRoute,
  ] as const;
}

export async function openApp(options: OpenAppOptions): Promise<App> {
  const { paths, config, version } = options;
  const areas = options.areas ?? [];
  const now = options.now ?? Date.now;
  const log = options.log ?? lineLog((text) => process.stderr.write(`${text}\n`), now);
  await prepareDataFolder(paths);
  const migrations = new Migrations();
  migrations.add("app", APP_MIGRATIONS);
  for (const area of areas) if (area.tables !== undefined) migrations.add(area.tables.area, area.tables.migrations);
  const db = openDatabase(paths.database, config.database.busyMs);
  let migrated: MigrationOutcome;
  try {
    migrated = migrate(db, migrations, { version, backups: paths.backups, now });
    guardSwitches(db);
  } catch (error) {
    db.close();
    throw error;
  }
  if (migrated.backup !== null) log.info("the database was copied before this version's first migration", { copy: migrated.backup });
  for (const step of migrated.applied) log.info("migrated", { area: step.area, version: step.version });
  const writes = new WriteQueue(db, config.database.sliceMs);
  const auth = new Auth({ db, writes, owner: config.lumiverse.user, now, pageTokenMs: config.auth.pageTokenMinutes * 60_000 });
  const routes = new RouteTable();
  const live = new LiveHub({ queueEvents: config.live.queueEvents, now });
  const secrets = new SecretsFile(paths.secrets);
  routes.add("app", appRoutes(version, now(), auth));
  let running: RunningServer | null = null;
  let closed = false;
  const app: App = {
    version,
    config,
    paths,
    db,
    writes,
    routes,
    live,
    auth,
    switches: new Switches(db, writes, now),
    secrets,
    models: modelsPort(paths, secrets),
    log,
    now,
    migrated,
    start() {
      if (running !== null) throw new Error("RPE's server is already listening.");
      running = startServer({ config, routes, auth, live, log });
      return running;
    },
    listening: () => running,
    async close() {
      if (closed) return;
      closed = true;
      await running?.stop();
      await writes.close();
      db.close();
    },
  };
  try {
    for (const area of areas) await area.mount?.(app);
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
