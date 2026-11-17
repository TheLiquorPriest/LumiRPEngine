// The database's migrations: each runs once, area by area in the stated order and by version within
// an area; one that fails leaves the database as it was before it and runs nothing after it; a copy
// of the file is taken before a new version's first migration; and a database a newer build brought
// further is refused. The store's own migrations plug in as they are. The runner's own rows name the
// user the database belongs to, and an older database's rows take him in the step that adds the
// column. Each test starts the server in-process on a free loopback port.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { App, Area, Migration } from "../../src/app";
import { MigrationError } from "../../src/app";
import { secretHash } from "../../src/app/auth";
import { APP_MIGRATIONS } from "../../src/app/schema";
import { STORE_MIGRATIONS } from "../../src/store";
import { TREE_MIGRATIONS } from "../../src/tree";
import { type Bed, makeBed, OWNER } from "./helpers";

/** The app area's own steps, as the runner records them: they run first. */
const APP_STEPS = APP_MIGRATIONS.map((m) => `app ${m.version}`);

/** A migration that notes that it ran, in a table the store's first migration makes. */
function noting(area: string, version: number): Migration {
  return { version, sql: `INSERT INTO ran (step) VALUES ('${area} ${version}');` };
}

const STORE_1: Migration = { version: 1, sql: "CREATE TABLE ran (n INTEGER PRIMARY KEY, step TEXT NOT NULL); INSERT INTO ran (step) VALUES ('store 1');" };
const STORE_2 = noting("store", 2);
const CAST_1 = noting("cast", 1);

/** The areas, given in the opposite of the order they run in. */
function areas(store: Migration[], cast: Migration[]): Area[] {
  return [
    { name: "cast", tables: [{ area: "cast", migrations: cast }] },
    { name: "store", tables: [{ area: "store", migrations: store }] },
  ];
}

function steps(db: Database): string[] {
  return db.query<{ step: string }, []>("SELECT step FROM ran ORDER BY n").all().map((r) => r.step);
}

function recorded(db: Database): string[] {
  return db.query<{ area: string; version: number }, []>("SELECT area, version FROM migration ORDER BY rowid").all().map((r) => `${r.area} ${r.version}`);
}

describe("migrations", () => {
  let bed: Bed;

  beforeEach(async () => {
    bed = await makeBed();
  });

  afterEach(async () => {
    await bed.remove();
  });

  /** Opens the app, starts its server, sees it answer, and closes it. */
  async function run(version: string, given: Area[]): Promise<App> {
    const app = await bed.open({ version, areas: given });
    const server = await app.start();
    expect((await fetch(`${server.url}/api/v1/status`)).status).toBe(200);
    await app.close();
    return app;
  }

  test("run once each, area by area in the stated order, by version within an area", async () => {
    const first = await run("1.0.0", areas([STORE_1, STORE_2], [CAST_1]));
    expect(first.migrated.applied.map((m) => `${m.area} ${m.version}`)).toEqual([...APP_STEPS, "store 1", "store 2", "cast 1"]);
    const second = await run("1.0.0", areas([STORE_1, STORE_2], [CAST_1]));
    expect(second.migrated.applied).toEqual([]);
    const db = new Database(bed.paths.database);
    try {
      expect(steps(db)).toEqual(["store 1", "store 2", "cast 1"]);
      expect(recorded(db)).toEqual([...APP_STEPS, "store 1", "store 2", "cast 1"]);
    } finally {
      db.close();
    }
  });

  test("one that fails leaves the database as it was before it, and nothing after it runs", async () => {
    await run("1.0.0", areas([STORE_1, STORE_2], [CAST_1]));
    const broken: Migration = { version: 3, name: "a broken one", sql: "CREATE TABLE extra (a INTEGER); INSERT INTO ran (step) VALUES ('store 3'); INSERT INTO nowhere VALUES (1);" };
    const failed = bed.open({ version: "1.1.0", areas: areas([STORE_1, STORE_2, broken], [CAST_1, noting("cast", 2)]) });
    await expect(failed).rejects.toThrow(MigrationError);
    await expect(failed).rejects.toThrow("The store migration 3 (a broken one) failed and was undone");
    const db = new Database(bed.paths.database);
    try {
      expect(db.query("SELECT name FROM sqlite_master WHERE name = 'extra'").all()).toEqual([]);
      expect(steps(db)).toEqual(["store 1", "store 2", "cast 1"]);
      expect(recorded(db)).toEqual([...APP_STEPS, "store 1", "store 2", "cast 1"]);
    } finally {
      db.close();
    }
  });

  test("a copy of the file is taken before a new version's first migration, once for that version", async () => {
    expect((await run("1.0.0", areas([STORE_1], [CAST_1]))).migrated.backup).toBeNull();
    const broken: Migration = { version: 2, sql: "CREATE TABLE extra (a INTEGER); INSERT INTO nowhere VALUES (1);" };
    await expect(bed.open({ version: "1.1.0", areas: areas([STORE_1, broken], [CAST_1]) })).rejects.toThrow(MigrationError);
    const copies = await readdir(bed.paths.backups);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toStartWith("rpe-before-1.1.0-");
    const copy = new Database(join(bed.paths.backups, copies[0] ?? ""), { readonly: true });
    try {
      expect(recorded(copy)).toEqual([...APP_STEPS, "store 1", "cast 1"]);
      expect(steps(copy)).toEqual(["store 1", "cast 1"]);
    } finally {
      copy.close();
    }
    // Mended and run again under the same version: the copy taken already holds the file as the old version left it.
    const mended = await run("1.1.0", areas([STORE_1, STORE_2], [CAST_1]));
    expect(mended.migrated.backup).toBeNull();
    expect(mended.migrated.applied.map((m) => `${m.area} ${m.version}`)).toEqual(["store 2"]);
    // A new version with nothing to migrate copies nothing; the next with something does.
    expect((await run("1.2.0", areas([STORE_1, STORE_2], [CAST_1]))).migrated.backup).toBeNull();
    expect((await run("1.3.0", areas([STORE_1, STORE_2], [CAST_1, noting("cast", 2)]))).migrated.backup).not.toBeNull();
    expect(await readdir(bed.paths.backups)).toHaveLength(2);
  });

  test("a database a newer build brought further is refused, as is a migration numbered below one that ran", async () => {
    await run("1.0.0", areas([STORE_1, STORE_2], []));
    await expect(bed.open({ areas: areas([STORE_1], []) })).rejects.toThrow("brought up by a newer RPE");
    await run("2.0.0", areas([STORE_1, STORE_2, noting("store", 4)], []));
    await expect(bed.open({ version: "2.1.0", areas: areas([STORE_1, STORE_2, noting("store", 3), noting("store", 4)], []) })).rejects.toThrow("numbered below one that has already run");
  });

  test("the store's own migrations plug in as they are", async () => {
    await run("1.0.0", [{ name: "store", tables: [{ area: "store", migrations: STORE_MIGRATIONS }] }]);
    const db = new Database(bed.paths.database);
    try {
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      for (const table of ["chat", "turn", "change", "snapshot", "session", "path_node", "message_link", "world_part"]) expect(tables).toContain(table);
      expect(recorded(db)).toEqual([...APP_STEPS, ...STORE_MIGRATIONS.map((m) => `store ${m.version}`)]);
    } finally {
      db.close();
    }
  });

  test("the runner's rows name the user the database belongs to", async () => {
    await run("1.0.0", areas([STORE_1], [CAST_1]));
    const db = new Database(bed.paths.database);
    try {
      expect(db.query<{ user: string }, []>("SELECT DISTINCT user FROM migration").all()).toEqual([{ user: OWNER }]);
      expect(db.query<{ user: string; key: string }, []>("SELECT user, key FROM meta ORDER BY key").all()).toEqual([{ user: OWNER, key: "version" }]);
    } finally {
      db.close();
    }
    // An RPE that comes to belong to another user opens the same database: nothing runs again, and each row stays its user's.
    const other = await bed.open({ config: { lumiverse: { url: null, user: "user-other" } }, areas: areas([STORE_1], [CAST_1]) });
    await other.close();
    const after = new Database(bed.paths.database);
    try {
      expect(after.query<{ user: string }, []>("SELECT DISTINCT user FROM migration").all()).toEqual([{ user: OWNER }]);
      expect(after.query<{ user: string }, []>("SELECT DISTINCT user FROM meta ORDER BY user").all()).toEqual([{ user: "user-other" }, { user: OWNER }]);
    } finally {
      after.close();
    }
  });

  test("an older database's rows hold the install's user as soon as the step that adds the column has run", async () => {
    // A database as the build before this one left it: the app's first step and the files area's first five, no user on
    // the runner's two tables, a key, a switch and a shipped default's record.
    await mkdir(bed.paths.root, { recursive: true });
    const older = new Database(bed.paths.database);
    const key = `rpe_${"7".repeat(64)}`;
    try {
      older.run("CREATE TABLE migration (area TEXT NOT NULL, version INTEGER NOT NULL, name TEXT, build TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (area, version)); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      const first = APP_MIGRATIONS[0];
      if (first === undefined || !("sql" in first)) throw new Error("the app's first step is SQL");
      older.run(first.sql);
      older.run("INSERT INTO migration (area, version, build, at) VALUES ('app', 1, '0.9.0', 1)");
      for (const step of TREE_MIGRATIONS.slice(0, 5)) {
        if (!("sql" in step)) throw new Error("the files area's first five steps are SQL");
        older.run(step.sql);
        older.run("INSERT INTO migration (area, version, build, at) VALUES ('files', ?, '0.9.0', 1)", [step.version]);
      }
      older.run("INSERT INTO meta (key, value) VALUES ('version', '0.9.0')");
      older.run("INSERT INTO app_key (hash, kind, last4, made) VALUES (?, 'provider', ?, 1)", [secretHash(key), key.slice(-4)]);
      older.run("INSERT INTO switch (name, digest, kind, what, state, listed, changed) VALUES ('format', 'd1', 'hook', 'fmt {file}', 'on', 1, 2)");
      older.run("INSERT INTO tree_default (path, before, at) VALUES ('.agents/gm.md', 'The old GM.', 1)");
    } finally {
      older.close();
    }
    const app = await bed.open({ version: "1.0.0", areas: [{ name: "tree", tables: [{ area: "files", migrations: TREE_MIGRATIONS }] }] });
    expect(app.migrated.applied.map((m) => `${m.area} ${m.version}`)).toEqual([...APP_STEPS.slice(1), ...TREE_MIGRATIONS.slice(5).map((m) => `files ${m.version}`)]);
    const users = (table: string): string[] => app.db.query<{ user: string }, []>(`SELECT DISTINCT user FROM ${table}`).all().map((r) => r.user);
    for (const table of ["migration", "meta", "provider_key", "switch", "tree_default"]) expect({ table, users: users(table) }).toEqual({ table, users: [OWNER] });
    // What they held before they hold still, as the install's user's: his key opens RPE, his switch is on.
    expect(app.auth.holds("provider", key)).toBe(true);
    expect(await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt {file}" })).toBe("waiting");
    expect(app.switches.list().find((s) => s.what === "fmt {file}")?.state).toBe("waiting");
    expect(app.db.query("SELECT state FROM switch WHERE digest = 'd1'").get()).toEqual({ state: "on" });
    // The copy taken first holds the file as the build before left it, no user in it.
    const copies = await readdir(bed.paths.backups);
    expect(copies).toHaveLength(1);
    const copy = new Database(join(bed.paths.backups, copies[0] ?? ""), { readonly: true });
    try {
      expect(copy.query<{ name: string }, []>("SELECT name FROM pragma_table_info('migration')").all().map((c) => c.name)).not.toContain("user");
    } finally {
      copy.close();
    }
  });
});
