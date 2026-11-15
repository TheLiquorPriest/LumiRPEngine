// `rpe check`: whether this build starts on the data folder.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliIO, CliOptions } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { BACKUPS_FOLDER, DATABASE_FILE } from "../config";
import { openDatabase } from "../database";
import { migrate, Migrations } from "../migrations";
import { APP_MIGRATIONS } from "../schema";
import { guardSwitches } from "../switches";

/**
 * `rpe check` (plan §4.6: RPE "tests that it starts" before it restarts onto a new build): what
 * `serve` does with the data folder before it listens, short of listening and with nothing written
 * there. The config is read (by `runCli`, which refuses one this build doesn't take), and this
 * build's migrations, every area's, are applied to a copy of RPE's database, made in a folder of its
 * own under `into` and removed once the check ends. A running RPE asks it of a new app file before it
 * restarts onto it (update.ts), and removes `into` itself, however the check ended.
 */
export async function checkCommand(paths: DataPaths, config: AppConfig, into: string | undefined, io: CliIO, options: CliOptions): Promise<number> {
  const work = await mkdtemp(join(into ?? tmpdir(), "rpe-check-"));
  try {
    const copy = join(work, DATABASE_FILE);
    // A database a running RPE has open has its log beside it: copied whole, under SQLite's locks. One without is the file alone.
    if (existsSync(`${paths.database}-wal`) || existsSync(`${paths.database}-shm`)) {
      const live = new Database(paths.database, { readonly: true });
      try {
        live.run("VACUUM INTO ?", [copy]);
      } finally {
        live.close();
      }
    } else if (existsSync(paths.database)) await copyFile(paths.database, copy);
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
