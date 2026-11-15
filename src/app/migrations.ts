// The database's migrations (plan §4.6, Appendix B): forward only, each in one transaction, and a
// copy of the file taken before the first migration of a new version. Every area brings its own
// tables as migrations through one registry; they run area by area in the order of
// `MIGRATION_AREAS`, and within an area by version. An area's tables may name an earlier area's,
// never a later one's.
//
// The runner keeps two tables of its own, `migration` (which ran, when, and under which build) and
// `meta` (the build that last brought the file up, and the build a copy was last taken for). Like
// every table they carry the user (R-9): the runner runs only for a named user, hands him to every
// step, and reads and writes its own rows as his. It brings its two tables up itself: rows an older
// build wrote without the user take the install's user before anything else runs (R-179).

import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NO_OWNER } from "./auth";
import { OWNER_ONLY_FILE, OWNER_ONLY_FOLDER } from "./disk";

/** The areas that bring tables, in the order their migrations run. */
export const MIGRATION_AREAS = ["app", "store", "cast", "story", "lore", "prompt", "files", "harness", "migrate", "build"] as const;
export type MigrationArea = (typeof MIGRATION_AREAS)[number];

/**
 * One step of an area's tables. `version` orders an area's steps and is never reused; a step that
 * has shipped is never changed, a new one is added. `sql` may hold several statements. `up` is handed
 * the user the database belongs to: a step that adds a user column fills it with him.
 */
export type Migration = { readonly version: number; readonly name?: string } & ({ readonly sql: string } | { readonly up: (db: Database, user: string) => void });

export class MigrationError extends Error {
  override name = "MigrationError";
}

/** Every area's migrations, gathered before the database is opened. */
export class Migrations {
  private readonly byArea = new Map<MigrationArea, readonly Migration[]>();

  /** An area's migrations; an area brings all of its own at once. */
  add(area: MigrationArea, migrations: readonly Migration[]): void {
    if (!MIGRATION_AREAS.includes(area)) throw new MigrationError(`"${area}" is not an area with tables: the areas are ${MIGRATION_AREAS.join(", ")}.`);
    if (this.byArea.has(area)) throw new MigrationError(`The ${area} area's migrations were given twice.`);
    const seen = new Set<number>();
    for (const m of migrations) {
      if (!Number.isInteger(m.version) || m.version < 1) throw new MigrationError(`A ${area} migration's version must be a whole number from 1: ${String(m.version)}.`);
      if (seen.has(m.version)) throw new MigrationError(`The ${area} area has two migrations numbered ${m.version}.`);
      seen.add(m.version);
    }
    this.byArea.set(area, [...migrations].sort((a, b) => a.version - b.version));
  }

  /** Every migration, in the order they run. */
  ordered(): { area: MigrationArea; migration: Migration }[] {
    return MIGRATION_AREAS.flatMap((area) => (this.byArea.get(area) ?? []).map((migration) => ({ area, migration })));
  }

  areas(): MigrationArea[] {
    return MIGRATION_AREAS.filter((area) => this.byArea.has(area));
  }
}

export interface Applied {
  area: MigrationArea;
  version: number;
  name: string | null;
}

export interface MigrationOutcome {
  /** What ran this time, in order. */
  applied: Applied[];
  /** The copy taken before them; null when none was needed. */
  backup: string | null;
}

export interface MigrateOptions {
  /** The user the database belongs to, as the install named him; null or empty, the runner writes nothing. */
  user: string | null;
  /** This build's version: a copy is taken before its first migration. */
  version: string;
  /** Where copies go. */
  backups: string;
  now: () => number;
}

const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS migration (
  user TEXT NOT NULL,
  area TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT,
  build TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user, area, version)
);
CREATE TABLE IF NOT EXISTS meta (
  user TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user, key)
);`;

/** The columns of `table`; none where the database has no such table. */
function columnsOf(db: Database, table: string): Set<string> {
  return new Set(db.query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)").all(table).map((c) => c.name));
}

/** A table's rows for `user`: an older build's, which name no user, are the install's user's (R-179), so all of them are his. */
function rowsOf<T>(db: Database, table: "migration" | "meta", columns: string, user: string): T[] {
  const has = columnsOf(db, table);
  if (has.size === 0) return [];
  return has.has("user") ? db.query<T, [string]>(`SELECT ${columns} FROM ${table} WHERE user = ?`).all(user) : db.query<T, []>(`SELECT ${columns} FROM ${table}`).all();
}

/**
 * The runner's two tables as this build keeps them: made where missing, and, where an older build made
 * them without the user, made again with every row given `user`. In one transaction.
 */
function bookkeeping(db: Database, user: string): void {
  db.transaction(() => {
    const migration = columnsOf(db, "migration");
    if (migration.size > 0 && !migration.has("user")) {
      db.run("ALTER TABLE migration RENAME TO migration_before_user");
      db.run(BOOKKEEPING);
      db.run("INSERT INTO migration (rowid, user, area, version, name, build, at) SELECT rowid, ?, area, version, name, build, at FROM migration_before_user", [user]);
      db.run("DROP TABLE migration_before_user");
    }
    const meta = columnsOf(db, "meta");
    if (meta.size > 0 && !meta.has("user")) {
      db.run("ALTER TABLE meta RENAME TO meta_before_user");
      db.run(BOOKKEEPING);
      db.run("INSERT INTO meta (user, key, value) SELECT ?, key, value FROM meta_before_user", [user]);
      db.run("DROP TABLE meta_before_user");
    }
    db.run(BOOKKEEPING);
  })();
}

/** A file name made of `version`'s safe characters and the time. */
function copyName(version: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `rpe-before-${version.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64)}-${stamp}.db`;
}

/** What has run for `user`, by area. */
export function appliedMigrations(db: Database, user: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const row of rowsOf<{ area: string; version: number }>(db, "migration", "area, version", user)) {
    let versions = out.get(row.area);
    if (versions === undefined) out.set(row.area, (versions = new Set()));
    versions.add(row.version);
  }
  return out;
}

/**
 * Brings the database up to every migration given. Each runs once, in order, in a transaction of
 * its own; one that fails is rolled back, stops the run, and throws, so the file is as it was before
 * it. Before the first migration a new version brings to a file that already holds tables, the file
 * is copied whole into `backups`. A file a newer build has brought further than these migrations go
 * is refused, as is a migration numbered below one that has already run, and a file brought up for
 * another user. With no user named it refuses before it writes anything.
 */
export function migrate(db: Database, migrations: Migrations, options: MigrateOptions): MigrationOutcome {
  const user = options.user;
  if (user === null || user === "") throw new MigrationError(NO_OWNER);
  const applied = appliedMigrations(db, user);
  // A file whose runner's rows are another user's alone is his: one RPE serves one user.
  const other = applied.size === 0 && columnsOf(db, "migration").has("user") ? db.query<{ user: string }, []>("SELECT user FROM migration LIMIT 1").get() : null;
  if (other !== null) throw new MigrationError(`This database was brought up for the Lumiverse user ${other.user}, and this RPE belongs to ${user}: one RPE serves one user. Nothing was written.`);
  for (const area of migrations.areas()) {
    const ran = applied.get(area);
    if (ran === undefined) continue;
    const known = migrations.ordered().filter((m) => m.area === area);
    const newest = Math.max(...ran);
    const knownNewest = Math.max(0, ...known.map((m) => m.migration.version));
    if (newest > knownNewest) throw new MigrationError(`This database was brought up by a newer RPE (its ${area} tables are at ${newest}; this build knows up to ${knownNewest}). Run that RPE, or restore a copy made before it.`);
    const below = known.find((m) => !ran.has(m.migration.version) && m.migration.version < newest);
    if (below !== undefined) throw new MigrationError(`The ${area} migration ${below.migration.version} is numbered below one that has already run (${newest}): give it a number above ${newest}.`);
  }
  const pending = migrations.ordered().filter((m) => !(applied.get(m.area)?.has(m.migration.version) ?? false));
  const meta = new Map(rowsOf<{ key: string; value: string }>(db, "meta", "key, value", user).map((row) => [row.key, row.value]));
  // The runner's own tables brought up from an older build's is a change to the file too.
  const older = ["migration", "meta"].some((table) => {
    const has = columnsOf(db, table);
    return has.size > 0 && !has.has("user");
  });
  let backup: string | null = null;
  const holdsTables = [...applied.values()].some((versions) => versions.size > 0);
  if ((pending.length > 0 || older) && holdsTables && meta.get("copied_for") !== options.version) {
    if (!existsSync(options.backups)) mkdirSync(options.backups, { recursive: true, mode: OWNER_ONLY_FOLDER });
    backup = join(options.backups, copyName(options.version, options.now()));
    // A copy taken by SQLite itself: whole and consistent, the log's committed pages included.
    db.run("VACUUM INTO ?", [backup]);
    chmodSync(backup, OWNER_ONLY_FILE);
  }
  bookkeeping(db, user);
  const putMeta = db.query("INSERT INTO meta (user, key, value) VALUES (?, ?, ?) ON CONFLICT (user, key) DO UPDATE SET value = excluded.value");
  if (backup !== null) putMeta.run(user, "copied_for", options.version);
  const ran: Applied[] = [];
  for (const { area, migration } of pending) {
    try {
      db.transaction(() => {
        if ("sql" in migration) db.run(migration.sql);
        else migration.up(db, user);
        db.run("INSERT INTO migration (user, area, version, name, build, at) VALUES (?, ?, ?, ?, ?, ?)", [user, area, migration.version, migration.name ?? null, options.version, options.now()]);
      }).immediate();
    } catch (error) {
      throw new MigrationError(`The ${area} migration ${migration.version}${migration.name ? ` (${migration.name})` : ""} failed and was undone, so the database is as it was before it, and nothing after it ran: ${error instanceof Error ? error.message : String(error)}`);
    }
    ran.push({ area, version: migration.version, name: migration.name ?? null });
  }
  if (meta.get("version") !== options.version) putMeta.run(user, "version", options.version);
  return { applied: ran, backup };
}
