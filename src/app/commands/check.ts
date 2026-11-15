// `rpe check`: whether this build starts on the data folder.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "../../shared/json";
import type { CliIO, CliOptions } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { BACKUPS_FOLDER, DATABASE_FILE, FILES_FOLDER, SHIPPED_FOLDER } from "../config";
import { openDatabase } from "../database";
import { migrate, Migrations } from "../migrations";
import { APP_MIGRATIONS } from "../schema";
import { guardSwitches } from "../switches";
import { STATUS_PATH } from "../app";
import { portFree } from "./ports";

/** A copy of RPE's database made in `to`: where a running RPE has its log beside the file, copied whole under SQLite's locks. */
async function copyDatabase(paths: DataPaths, to: string): Promise<void> {
  // A database a running RPE has open has its log beside it: copied whole, under SQLite's locks. One without is the file alone.
  if (existsSync(`${paths.database}-wal`) || existsSync(`${paths.database}-shm`)) {
    const live = new Database(paths.database, { readonly: true });
    try {
      live.run("VACUUM INTO ?", [to]);
    } finally {
      live.close();
    }
  } else if (existsSync(paths.database)) await copyFile(paths.database, to);
}

/** A free port on loopback. */
function freeLoopbackPort(): number {
  for (;;) {
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    const port = probe.port;
    void probe.stop(true);
    if (port !== undefined && portFree("127.0.0.1", port)) return port;
  }
}

/** The environment a scratch RPE is started with: this process's, except that it listens where it is told and reaches no Lumiverse. */
function scratchEnv(env: CliIO["env"], port: number, user: string): Record<string, string> {
  const own = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("RPE_")));
  return { ...own, RPE_PORT: String(port), RPE_LUMIVERSE_URL: "", RPE_LUMIVERSE_USER: user };
}

/**
 * Starts this build for real on a scratch copy of the data folder (plan §4.6: RPE "tests that it
 * starts" before it swaps onto a new build): a copy of the database, a fresh file tree, no Lumiverse
 * to reach, on a free loopback port. It passes only once the build has mounted every area, laid its
 * shipped files and answered its status with its own build, within `withinMs`; then it is stopped.
 */
async function startsForReal(work: string, paths: DataPaths, config: AppConfig, appFile: string, version: string, withinMs: number, io: CliIO): Promise<string> {
  const user = config.lumiverse.user;
  if (user === null) throw new Error("RPE's config names no Lumiverse user, so there is nothing to start on.");
  const scratch = join(work, "data");
  await mkdir(join(scratch, BACKUPS_FOLDER), { recursive: true });
  await copyDatabase(paths, join(scratch, DATABASE_FILE));
  const port = freeLoopbackPort();
  await writeFile(join(scratch, "config.json"), JSON.stringify({ v: 1, port, lumiverse: { url: null, user, database: null, connection: null, models: config.lumiverse.models } }));
  const child = Bun.spawn([process.execPath, appFile, "serve", "--data", scratch], { env: scratchEnv(io.env, port, user), stdout: "ignore", stderr: "pipe", stdin: "ignore" });
  const said = new Response(child.stderr).text();
  const exited = child.exited.then((code) => ({ code }));
  const began = performance.now();
  try {
    for (;;) {
      const gone = await Promise.race([exited, Bun.sleep(50).then(() => null)]);
      if (gone !== null) {
        const lines = (await said).trim().split("\n").filter((line) => line.trim() !== "");
        throw new Error(`the build does not start: serving on a copy of the data it exited with ${gone.code}${lines.length === 0 ? "" : `: ${lines.at(-1)}`}`);
      }
      const answered = await fetch(`http://127.0.0.1:${port}${STATUS_PATH}`, { signal: AbortSignal.timeout(1000) }).then((res) => res.json(), () => null);
      if (isRecord(answered) && answered.name === "rpe") {
        if (answered.version !== version) throw new Error(`the build answered its status as build ${String(answered.version)}, not as ${version}`);
        if (!existsSync(join(scratch, FILES_FOLDER, SHIPPED_FOLDER))) throw new Error("the build answered, but laid none of its shipped files");
        return `RPE ${version} starts on a copy of the data folder ${paths.root}: its areas mounted, its database taking this build's tables, its shipped files laid, and its status answered with its build (the copy is gone again).`;
      }
      if (performance.now() - began > withinMs) throw new Error(`the build did not answer its status within ${Math.round(withinMs / 1000)} s`);
    }
  } finally {
    child.kill("SIGTERM");
    const stopped = await Promise.race([exited, Bun.sleep(5000).then(() => null)]);
    if (stopped === null) child.kill("SIGKILL");
    await exited;
  }
}

/**
 * `rpe check` (plan §4.6: RPE "tests that it starts" before it restarts onto a new build): the build is
 * started, as `serve` starts it, on a scratch copy of the data folder made under `into` (a temporary
 * folder where none is given) and removed once the check ends, whichever way it ends. A running RPE
 * asks it of a new app file before it swaps onto it (update.ts). Run from its sources, where there is
 * no app file to start, it applies the build's migrations to the copy of the database and starts
 * nothing.
 */
export async function checkCommand(paths: DataPaths, config: AppConfig, into: string | undefined, within: number | undefined, io: CliIO, options: CliOptions): Promise<number> {
  const work = await mkdtemp(join(into ?? tmpdir(), "rpe-check-"));
  try {
    if (options.appFile !== undefined) {
      io.out(await startsForReal(work, paths, config, options.appFile, options.version, within === undefined ? config.commandLine.startMs : within * 1000, io));
      return 0;
    }
    const copy = join(work, DATABASE_FILE);
    await copyDatabase(paths, copy);
    const migrations = new Migrations();
    migrations.add("app", APP_MIGRATIONS);
    for (const area of options.areas ?? []) for (const tables of area.tables ?? []) migrations.add(tables.area, tables.migrations);
    const db = openDatabase(copy, config.database.busyMs);
    try {
      const done = migrate(db, migrations, { user: config.lumiverse.user, version: options.version, backups: join(work, BACKUPS_FOLDER), now: io.now });
      guardSwitches(db);
      io.out(`RPE ${options.version} starts on the data folder ${paths.root}: its config reads, and its database takes this build's tables (${done.applied.length} migration(s), applied to a copy that is gone again).`);
    } finally {
      db.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return 0;
}
