// The database's migrations: each runs once, area by area in the stated order and by version within
// an area; one that fails leaves the database as it was before it and runs nothing after it; a copy
// of the file is taken before a new version's first migration; and a database a newer build brought
// further is refused. The store's own migrations plug in as they are. Each test starts the server
// in-process on a free loopback port.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { App, Area, Migration } from "../../src/app";
import { MigrationError } from "../../src/app";
import { STORE_MIGRATIONS } from "../../src/store";
import { type Bed, makeBed } from "./helpers";

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
    { name: "cast", tables: { area: "cast", migrations: cast } },
    { name: "store", tables: { area: "store", migrations: store } },
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
    expect(first.migrated.applied.map((m) => `${m.area} ${m.version}`)).toEqual(["app 1", "store 1", "store 2", "cast 1"]);
    const second = await run("1.0.0", areas([STORE_1, STORE_2], [CAST_1]));
    expect(second.migrated.applied).toEqual([]);
    const db = new Database(bed.paths.database);
    try {
      expect(steps(db)).toEqual(["store 1", "store 2", "cast 1"]);
      expect(recorded(db)).toEqual(["app 1", "store 1", "store 2", "cast 1"]);
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
      expect(recorded(db)).toEqual(["app 1", "store 1", "store 2", "cast 1"]);
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
      expect(recorded(copy)).toEqual(["app 1", "store 1", "cast 1"]);
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
    await run("1.0.0", [{ name: "store", tables: { area: "store", migrations: STORE_MIGRATIONS } }]);
    const db = new Database(bed.paths.database);
    try {
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      for (const table of ["chat", "turn", "change", "snapshot", "session", "path_node", "message_link", "world_revision"]) expect(tables).toContain(table);
      expect(recorded(db)).toEqual(["app 1", ...STORE_MIGRATIONS.map((m) => `store ${m.version}`)]);
    } finally {
      db.close();
    }
  });
});
