// The application (plan §4.1, §4.4): one process that holds the database and its write queue, the
// route table, the live hub, auth and the switches, and serves them. `openApp` makes it ready over a
// data folder, migrating the database and mounting every area, and `start` makes it listen. An area
// reaches the app through `App` and nothing else.

import type { Database } from "bun:sqlite";
import type { JsonValue, Log, ModelsPort } from "rp-harness/contract";
import { Answers, answersRoute } from "./answers";
import { Auth, NO_OWNER } from "./auth";
import type { AppConfig, DataPaths } from "./config";
import { moveLimits, prepareDataFolder } from "./config";
import { commandRoutes } from "./command-routes";
import { commandSocketPath } from "./data-folder";
import { modelsPort, ownModels } from "./connections";
import { openDatabase, WriteQueue } from "./database";
import { type Fills, gatherHooks, gatherSettings, type Hooks } from "./hooks";
import { IndexFile } from "./index-file/index-file";
import { type AreaLiveKind, gatherLiveKinds, LiveHub, liveRoute } from "./live";
import type { Migration, MigrationArea, MigrationOutcome } from "./migrations";
import { migrate, Migrations, pruneCopies } from "./migrations";
import { type Exactly, type Holds, type Infer, route, RouteError, RouteTable, shape } from "./routes";
import { APP_MIGRATIONS } from "./schema";
import { SecretsFile } from "./secrets";
import type { Setting } from "./setting-list";
import type { RunningServer } from "./server";
import { startServer } from "./server";
import { guardSwitches, Switches } from "./switches";
import { RPE_UI, uiRoute } from "./ui";
import { ServiceLog } from "./service-log";
import { type AppFile, Builds, type BuildsStatus } from "./update";
import { defaultThreads, Workers } from "./workers/pool";

/** Public: that RPE answers here, and its build; nothing more, and no work to say it. */
export const STATUS_PATH = "/api/v1/status";
/** A page's: when RPE started, and the builds that meet at it, read again from its app file. */
export const BUILDS_PATH = "/api/v1/status/builds";
/** A page's: whose its credential is, and when it ends (`ends`, epoch milliseconds; null: no end). */
export const SESSION_PATH = "/api/v1/status/session";
/** "Update now" (plan §4.6): RPE restarts onto its new app file once no turn or job runs, whatever `update.restart` says. */
export const UPDATE_PATH = "/api/v1/update";

/**
 * An area of RPE as the app mounts it: its tables, its settings, what it adds to the other areas'
 * hooks, and what it adds once its tables are up to date (its routes, its live events, its writers).
 * Each area names all of these in a file of its own (`area.ts` in its folder), and the composition
 * (`compose.ts`) names each area once. Areas are mounted in the order given, then each is told that
 * all are mounted (`mounted`): a route made from the parts of an area mounted after this one is added
 * there, and the rest in `mount`.
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
  /** Its tables: each migration area it brings (an area of RPE may bring more than one), and its migrations. */
  readonly tables?: readonly AreaTables[];
  /** Its settings, each with its words and when it takes effect: listed once, with every other area's, in the registry (`App.settings`). */
  readonly settings?: readonly Setting[];
  /** What it adds to the hooks of the other areas (`App.hooks`): a view an agent is given by name, a lane of the door. */
  readonly fills?: Fills;
  /** Its own live kinds (`liveKind`), each declared once among every area's and the app's; it publishes through each kind's handle. */
  readonly liveKinds?: readonly AreaLiveKind[];
  /** In the order of the areas. */
  readonly mount?: (app: App) => void | Promise<void>;
  /** Once every area is mounted, in the order of the areas: what is made from the parts of an area mounted after this one (its routes among them). */
  readonly mounted?: (app: App) => void | Promise<void>;
  /** Once the server listens. It cannot add routes: the table is fixed by then. */
  readonly started?: (app: App) => void | Promise<void>;
  /** First thing at close. */
  readonly stopping?: (app: App) => void | Promise<void>;
}

/** The tables of one migration area an area brings. */
export interface AreaTables {
  readonly area: MigrationArea;
  readonly migrations: readonly Migration[];
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
  /** RPE's own newest log lines, which `log` keeps as it says them: what the Runtime page reads. */
  readonly serviceLog: ServiceLog;
  /** The settings registry: every setting the areas list, in the order of the areas, which the Settings routes show and write. */
  readonly settings: readonly Setting[];
  /** What the areas add to each other's hooks, gathered from every area when the app opened. */
  readonly hooks: Hooks;
  readonly now: () => number;
  /** The builds that meet at RPE (its own, its app file's on disk, the extension's), and a restart onto a new app file. */
  readonly builds: Builds;
  /** The worker threads heavy work runs on (plan §4.1): a task of the one list (`workers/tasks.ts`), its answer back. */
  readonly workers: Workers;
  /** The index file: contentless full-text indexes the lanes feed and search (`index-file/index-file.ts`). */
  readonly index: IndexFile;
  /** What the migrations did when the app opened. */
  readonly migrated: MigrationOutcome;
  /** Listens, with the route table as it stands (it takes no more routes after), then runs each area's `started`, in order. */
  start(): Promise<RunningServer>;
  /** The server once it listens (its port and address, for the addresses a page is handed); null before. */
  listening(): RunningServer | null;
  /** Runs each mounted area's `stopping`, in reverse order, then stops listening, lets the writes already queued land, closes the index file, stops the worker threads and closes the database. */
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
  /** The app file this process was started from, and what a restart onto another build of it needs; absent or null where it runs from no single file. */
  appFile?: AppFile | null;
}

/** A log of plain lines to `write` (standard error, in the server). Fields carry ids and counts, never a secret. */
export function lineLog(write: (line: string) => void, now: () => number = Date.now): Log {
  const line =
    (level: string) =>
    (message: string, fields?: Record<string, JsonValue>): void =>
      write(`${new Date(now()).toISOString()} ${level} ${message}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`);
  return { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };
}

// What the app's own routes answer.
const T = shape.text();
export const restartState = shape.named(
  "RestartState",
  "Where a restart onto RPE's app file on disk stands: nothing to restart onto, waiting for the turns and jobs running, restarting, needed and not made while `update.restart` is off, or needed and not possible, RPE having been started by hand.",
  shape.oneOf("none", "waiting", "restarting", "off", "by hand"),
);
const updateStage = shape.named(
  "UpdateStage",
  "One stage an update reached: its arrival (the extension's word with the hash stated, or the app file on disk found changed), its check (every file against that hash, or the file asked its build), its start (for real on a scratch copy of RPE's data), or the restart onto it; under way, passed, or where the update stopped, and why.",
  shape.object({
    stage: shape.oneOf("arrived", "checked", "started", "restart"),
    state: shape.field(shape.oneOf("going", "done", "refused"), "Under way, passed, or where the update stopped."),
    at: shape.field(shape.number(), "When it began, in milliseconds since 1970."),
    why: shape.field(shape.nullable(T), "Why the update stopped here; null where it did not."),
  }),
);
export const buildsStatus = shape.named(
  "BuildsStatus",
  "The builds that meet at RPE, as its builds route and \"Update now\" give them.",
  shape.object({
    running: shape.field(T, "The build this process runs."),
    disk: shape.field(shape.nullable(T), "The build of the app file on disk; null where there is no file, or it gives none."),
    broken: shape.field(shape.nullable(T), "Why the file on disk gave no build: it is not there, does not start, or says something else."),
    extension: shape.field(shape.nullable(T), "The extension's build as it said at its last registration; null before it has."),
    agree: shape.field(shape.yesNo(), "Every build known is the running one, and the file on disk starts."),
    restart: restartState,
    update: shape.field(
      shape.nullable(shape.named("UpdateProgress", "The newest update this process heard of, stage by stage from its arrival to the restart onto it.", shape.object({ build: shape.field(shape.nullable(T), "The build it brings, once its check said it."), stages: shape.list(updateStage) }))),
      "The newest update this process heard of; null before any.",
    ),
    words: shape.field(T, "All of it in a sentence or two, as `rpe status` prints it."),
  }),
);
type BuildsMirrored = Holds<Exactly<Infer<typeof buildsStatus>, BuildsStatus>>;
const statusReply = shape.named(
  "Status",
  "That RPE answers here, its build, and the address of the Lumiverse it belongs to (null where it is set to none): nothing more, so a client sends a saved sign-in only to its own RPE.",
  shape.object({ name: shape.literal("rpe"), version: T, lumiverse: shape.field(shape.nullable(T), "The address of the Lumiverse this RPE belongs to; null where none is set.") }),
);

/**
 * The app's own routes: its status to anyone, only that it answers and its build; its builds to a
 * page, which reads the app file again each time it is asked; "Update now", which answers what RPE
 * will do; when the page's own credential ends; the live socket; and the web app.
 */
export function appRoutes(version: string, started: number, ui: string | null, builds: Builds, answers: Answers, lumiverse: string | null = null) {
  return [
    route({ method: "GET", path: STATUS_PATH, access: "public", group: "service", does: "Says that RPE answers here, its build, and the address of the Lumiverse it belongs to; nothing more, and no work to say it.", reply: statusReply, handle: () => ({ name: "rpe" as const, version, lumiverse }) }),
    route({ method: "POST", path: UPDATE_PATH, access: "page", group: "service", does: '"Update now": RPE restarts onto its new app file once no turn or job runs, whatever update.restart says, and answers where that stands.', reply: buildsStatus, handle: () => builds.now() }),
    route({
      method: "GET",
      path: BUILDS_PATH,
      access: "page",
      group: "service",
      does: "When RPE started, and the builds that meet at it, its app file read again.",
      reply: shape.named("BuildsReply", "When RPE started (epoch milliseconds), and the builds that meet at it.", shape.object({ name: shape.literal("rpe"), version: T, started: shape.number(), builds: buildsStatus })),
      handle: async () => ({ name: "rpe" as const, version, started, builds: await builds.check() }),
    }),
    route({
      method: "GET",
      path: SESSION_PATH,
      access: "page",
      group: "service",
      does: "Whose the page's credential is, and when it ends.",
      reply: shape.named("SessionReply", "Whose the page's credential is, and when it runs out (epoch milliseconds; null: it has no end).", shape.object({ user: T, ends: shape.nullable(shape.number()) })),
      handle: ({ auth }) => {
        if (auth.credential === null) throw new RouteError(401, "This needs a page token or the web UI's token.");
        return { user: auth.user, ends: auth.credential.until };
      },
    }),
    answersRoute(answers),
    liveRoute,
    uiRoute(ui),
  ] as const;
}

export async function openApp(options: OpenAppOptions): Promise<App> {
  const { paths, config, version } = options;
  const areas = options.areas ?? [];
  // Gathered first: a lane two areas fill, or a setting or a live kind two areas declare, stops the app before it has touched the data folder.
  const settings = gatherSettings(areas);
  const hooks = gatherHooks(areas);
  const liveKinds = gatherLiveKinds(areas);
  const now = options.now ?? Date.now;
  const serviceLog = new ServiceLog(options.log ?? lineLog((text) => process.stderr.write(`${text}\n`), now), config.service.logLines, now);
  const log = serviceLog.log;
  // No row is written without its user (R-179): with none named, the data folder is left as it was.
  const user = config.lumiverse.user;
  if (user === null || user === "") throw new Error(NO_OWNER);
  await prepareDataFolder(paths);
  // An earlier build's config.json limits become settings in RPE-global.yml before RPE listens; until then the ones loaded are in force.
  await moveLimits(paths, log);
  const migrations = new Migrations();
  migrations.add("app", APP_MIGRATIONS);
  for (const area of areas) for (const tables of area.tables ?? []) migrations.add(tables.area, tables.migrations);
  const db = openDatabase(paths.database, config.database.busyMs);
  let migrated: MigrationOutcome;
  try {
    migrated = migrate(db, migrations, { user, version, backups: paths.backups, now });
    guardSwitches(db);
  } catch (error) {
    db.close();
    throw error;
  }
  if (migrated.backup !== null) log.info("the database was copied before this version's first migration", { copy: migrated.backup });
  for (const step of migrated.applied) log.info("migrated", { area: step.area, version: step.version });
  const writes = new WriteQueue(db, config.database.sliceMs);
  const workers = new Workers({ threads: config.workers.threads ?? defaultThreads(), name: "RPE's worker threads", log });
  let index: IndexFile;
  try {
    index = await IndexFile.open({ path: paths.index, workers, batch: config.index.batch, log });
  } catch (error) {
    await workers.close();
    await writes.close();
    db.close();
    throw error;
  }
  const auth = new Auth({ db, writes, owner: user, now, pageTokenMs: config.auth.pageTokenMinutes * 60_000, sessionMs: config.auth.webSessionMinutes * 60_000, webKeyMs: config.auth.webKeyDays === null ? null : config.auth.webKeyDays * 86_400_000 });
  const routes = new RouteTable();
  const live = new LiveHub({ queueEvents: config.live.queueEvents, now, kinds: liveKinds });
  const answers = new Answers(config.server.answerKeepSeconds * 1000);
  const secrets = new SecretsFile(paths.secrets);
  // The model layer's documents written before they were kept by user are the install's user's, moved under him before anything reads them.
  await ownModels(paths, secrets, user, log);
  const builds = new Builds({ version, file: options.appFile ?? null, log, now });
  await builds.start();
  routes.add("app", appRoutes(version, now(), options.ui === undefined ? RPE_UI : options.ui, builds, answers, config.lumiverse.url));
  // The server's own command line's routes, which answer on its socket alone: the app's, so every RPE has them. The files that name what runs a command or calls out are looked at before the list of it is read.
  routes.add("command", commandRoutes({ paths, secrets, db, user, webKeyMs: config.auth.webKeyDays === null ? null : config.auth.webKeyDays * 86_400_000, run: (write) => writes.run(write, "the command line's change"), now }, async () => (await builds.check()).words, () => hooks.listFiles()));
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
    switches: new Switches(db, writes, now, user, config.switches.nameLength),
    secrets,
    models: modelsPort(paths, secrets, () => config.lumiverse.user),
    log,
    serviceLog,
    settings,
    hooks,
    now,
    builds,
    workers,
    index,
    migrated,
    async start() {
      if (closing !== null) throw new Error("RPE is stopping, so its server was not started.");
      if (starting !== null) throw new Error("RPE's server is already started.");
      const run = (async () => {
        const server = startServer({ config, routes, auth, live, log, now, workers, answers, commandSocket: commandSocketPath(paths.root) });
        running = server;
        for (const area of mounted) await hook(area, "started");
        // This version has started: the copies taken before migrations are kept to the setting, the oldest let go.
        await pruneCopies(paths.backups, config.database.copiesKept, log);
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
        answers.close();
        await index.close().catch((error: unknown) => log.error("the index file did not close cleanly", { error: error instanceof Error ? error.message : String(error) }));
        await workers.close();
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
    for (const area of areas) await area.mounted?.(app);
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
