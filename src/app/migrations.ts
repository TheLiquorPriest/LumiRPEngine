// The database's migrations (plan §4.6, Appendix B): forward only, each in one transaction, and a
// copy of the file taken before the first migration of a new version. Every area brings its own
// tables as migrations through one registry; they run area by area in the order of
// `MIGRATION_AREAS`, and within an area by version. An area's tables may name an earlier area's,
// never a later one's.
//
// The runner keeps two tables of its own, `migration` (which ran, when, and under which build) and
// `meta` (the build that last brought the file up, and the build a copy was last taken for). They
// describe the file, not a user's data, so they carry no user.

import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { OWNER_ONLY_FILE, OWNER_ONLY_FOLDER } from "./disk";

/** The areas that bring tables, in the order their migrations run. */
export const MIGRATION_AREAS = ["app", "store", "cast", "story", "lore", "prompt", "files", "harness", "migrate"] as const;
export type MigrationArea = (typeof MIGRATION_AREAS)[number];

/**
 * One step of an area's tables. `version` orders an area's steps and is never reused; a step that
 * has shipped is never changed, a new one is added. `sql` may hold several statements.
 */
export type Migration = { readonly version: number; readonly name?: string } & ({ readonly sql: string } | { readonly up: (db: Database) => void });

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
  /** This build's version: a copy is taken before its first migration. */
  version: string;
  /** Where copies go. */
  backups: string;
  now: () => number;
}

const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS migration (
  area TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT,
  build TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (area, version)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;

/** A file name made of `version`'s safe characters and the time. */
function copyName(version: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `rpe-before-${version.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64)}-${stamp}.db`;
}

/** What has run, by area. */
export function appliedMigrations(db: Database): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const exists = db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'migration'").get();
  if ((exists?.n ?? 0) === 0) return out;
  for (const row of db.query<{ area: string; version: number }, []>("SELECT area, version FROM migration").all()) {
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
 * is refused, as is a migration numbered below one that has already run.
 */
export function migrate(db: Database, migrations: Migrations, options: MigrateOptions): MigrationOutcome {
  db.transaction(() => db.run(BOOKKEEPING))();
  const applied = appliedMigrations(db);
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
  const meta = new Map(db.query<{ key: string; value: string }, []>("SELECT key, value FROM meta").all().map((row) => [row.key, row.value]));
  const putMeta = db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  let backup: string | null = null;
  const holdsTables = [...applied.values()].some((versions) => versions.size > 0);
  if (pending.length > 0 && holdsTables && meta.get("copied_for") !== options.version) {
    if (!existsSync(options.backups)) mkdirSync(options.backups, { recursive: true, mode: OWNER_ONLY_FOLDER });
    backup = join(options.backups, copyName(options.version, options.now()));
    // A copy taken by SQLite itself: whole and consistent, the log's committed pages included.
    db.run("VACUUM INTO ?", [backup]);
    chmodSync(backup, OWNER_ONLY_FILE);
    putMeta.run("copied_for", options.version);
  }
  const ran: Applied[] = [];
  for (const { area, migration } of pending) {
    try {
      db.transaction(() => {
        if ("sql" in migration) db.run(migration.sql);
        else migration.up(db);
        db.run("INSERT INTO migration (area, version, name, build, at) VALUES (?, ?, ?, ?, ?)", [area, migration.version, migration.name ?? null, options.version, options.now()]);
      }).immediate();
    } catch (error) {
      throw new MigrationError(`The ${area} migration ${migration.version}${migration.name ? ` (${migration.name})` : ""} failed and was undone, so the database is as it was before it, and nothing after it ran: ${error instanceof Error ? error.message : String(error)}`);
    }
    ran.push({ area, version: migration.version, name: migration.name ?? null });
  }
  if (meta.get("version") !== options.version) putMeta.run("version", options.version);
  return { applied: ran, backup };
}
