// The application (plan §4.1, §4.4): one process that holds the database and its write queue, the
// route table, the live hub, auth and the switches, and serves them. `openApp` makes it ready over a
// data folder, migrating the database and mounting every area, and `start` makes it listen. An area
// reaches the app through `App` and nothing else.

import type { Database } from "bun:sqlite";
import type { JsonValue, Log, ModelsPort } from "rp-harness/contract";
import { Auth } from "./auth";
import type { AppConfig, DataPaths } from "./config";
import { prepareDataFolder } from "./config";
import { modelsPort } from "./connections";
import { openDatabase, WriteQueue } from "./database";
import { LiveHub, liveRoute } from "./live";
import type { Migration, MigrationArea, MigrationOutcome } from "./migrations";
import { migrate, Migrations } from "./migrations";
import { route, RouteTable } from "./routes";
import { APP_MIGRATIONS } from "./schema";
import { SecretsFile } from "./secrets";
import type { RunningServer } from "./server";
import { startServer } from "./server";
import { guardSwitches, Switches } from "./switches";
import { RPE_UI, uiRoute } from "./ui";

export const STATUS_PATH = "/api/v1/status";

/**
 * An area of RPE as the app mounts it: its tables, and what it adds once they are up to date (its
 * routes, its live events, its writers). Areas are mounted in the order given.
 *
 * Two moments besides: `started`, once the server listens (its address is then `app.listening()`),
 * areas in order; and `stopping`, first thing when the app closes, areas in reverse order, while the
 * server still answers and writes still land. `start()` waits for each `started`, so one that waits
 * on the network starts its work and returns. A throw from either is logged, and RPE goes on.
 * `stopping` runs for every area whose `mount` finished (one with no `mount` counts), also when the
 * server never started or failed to, so it must be safe when `started` never ran.
 */
export interface Area {
  readonly name: string;
  /** Its tables: the migration area they are kept under, and its migrations. */
  readonly tables?: { readonly area: MigrationArea; readonly migrations: readonly Migration[] };
  readonly mount?: (app: App) => void | Promise<void>;
  /** Once the server listens. It cannot add routes: the table is fixed by then. */
  readonly started?: (app: App) => void | Promise<void>;
  /** First thing at close. */
  readonly stopping?: (app: App) => void | Promise<void>;
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
  /** Listens, with the route table as it stands (it takes no more routes after), then runs each area's `started`, in order. */
  start(): Promise<RunningServer>;
  /** The server once it listens (its port and address, for the addresses a page is handed); null before. */
  listening(): RunningServer | null;
  /** Runs each mounted area's `stopping`, in reverse order, then stops listening, lets the writes already queued land, and closes the database. */
  close(): Promise<void>;
}

export interface OpenAppOptions {
  paths: DataPaths;
  config: AppConfig;
  /** This build's version: the database is copied before the first migration of a new one. */
  version: string;
  areas?: readonly Area[];
  /** The built web app's folder, served at `/ui/`: the one the build put beside the bundle when absent; null for none. */
  ui?: string | null;
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

/** The app's own routes: its status, the live socket, and the web app. */
function appRoutes(version: string, started: number, auth: Auth, ui: string | null) {
  return [
    route({ method: "GET", path: STATUS_PATH, access: "public", handle: () => ({ name: "rpe", version, started, belongsToUser: auth.owner !== null }) }),
    liveRoute,
    uiRoute(ui),
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
  routes.add("app", appRoutes(version, now(), auth, options.ui === undefined ? RPE_UI : options.ui));
  let running: RunningServer | null = null;
  let starting: Promise<RunningServer> | null = null;
  let closing: Promise<void> | null = null;
  const mounted: Area[] = [];
  /** Runs one area's hook; a throw is logged, and the next goes on. */
  const hook = async (area: Area, moment: "started" | "stopping"): Promise<void> => {
    try {
      await area[moment]?.(app);
    } catch (error) {
      log.error(moment === "started" ? "an area failed once RPE was listening; RPE goes on serving" : "an area failed as RPE was stopping; RPE goes on stopping", { area: area.name, error: error instanceof Error ? error.message : String(error) });
    }
  };
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
    async start() {
      if (closing !== null) throw new Error("RPE is stopping, so its server was not started.");
      if (starting !== null) throw new Error("RPE's server is already started.");
      const run = (async () => {
        const server = startServer({ config, routes, auth, live, log });
        running = server;
        for (const area of mounted) await hook(area, "started");
        return server;
      })();
      starting = run;
      try {
        return await run;
      } catch (error) {
        // It did not listen (its port taken, say): it may be started again.
        starting = null;
        throw error;
      }
    },
    listening: () => running,
    close() {
      closing ??= (async () => {
        // A start under way finishes its areas' `started` first, so each `stopping` comes after.
        await starting?.catch(() => undefined);
        for (const area of [...mounted].reverse()) await hook(area, "stopping");
        const server = running;
        running = null;
        await server?.stop();
        await writes.close();
        db.close();
      })();
      return closing;
    },
  };
  try {
    for (const area of areas) {
      await area.mount?.(app);
      mounted.push(area);
    }
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
