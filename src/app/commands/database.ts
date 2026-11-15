// The database as a command of `rpe` meets it.

import type { Database } from "bun:sqlite";
import type { AppConfig, DataPaths } from "../config";
import { openDatabase } from "../database";
import { migrate, Migrations } from "../migrations";
import { APP_MIGRATIONS } from "../schema";

/** The database for the command line: a connection of its own, without the server's guard, with the app's tables made when missing. */
export function commandLineDatabase(paths: DataPaths, config: AppConfig, version: string, now: () => number): Database {
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
