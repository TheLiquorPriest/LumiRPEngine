// Every table carries the user (plan P14, Appendix B; R-9, R-179): every table of every area, as the
// app composes them, the installation's own included; the tree's tables take Appendix B's names; and
// no road opens RPE's database before the install has named its user.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { asCommand, listSwitches, setSwitch } from "../../src/app/switches";
import { NO_OWNER } from "../../src/app/auth";
import { compose } from "../../src/app/compose";
import { migrate, Migrations } from "../../src/app/migrations";
import { APP_MIGRATIONS } from "../../src/app/schema";
import { type Bed, makeBed, OWNER } from "./helpers";

/** An in-memory database brought up by every area's migrations, the app's first, as the app composes them. */
function composed(user: string | null): Database {
  const db = new Database(":memory:");
  const migrations = new Migrations();
  migrations.add("app", APP_MIGRATIONS);
  for (const area of compose().areas) for (const tables of area.tables ?? []) migrations.add(tables.area, tables.migrations);
  migrate(db, migrations, { user, version: "test", backups: "/nonexistent", now: () => 0 });
  return db;
}

function tablesOf(db: Database): string[] {
  return db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
}

function columnsOf(db: Database, table: string): string[] {
  return db.query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)").all(table).map((c) => c.name);
}

describe("every table carries the user", () => {
  test("a database brought up by every area's migrations, as the app composes them, holds no table without a user column", () => {
    const db = composed(OWNER);
    try {
      const tables = tablesOf(db);
      expect(tables.length).toBeGreaterThan(50);
      expect(tables.filter((table) => !columnsOf(db, table).includes("user"))).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("Appendix B's names stand: `note_version` and `suggestion` exist and `tree_write` and `tree_suggestion` do not", () => {
    const db = composed(OWNER);
    try {
      const tables = tablesOf(db);
      expect(tables).toContain("note_version");
      expect(tables).toContain("suggestion");
      expect(tables).not.toContain("tree_write");
      expect(tables).not.toContain("tree_suggestion");
    } finally {
      db.close();
    }
  });

  test("`note_version` has the columns path, turn and text", () => {
    const db = composed(OWNER);
    try {
      expect(columnsOf(db, "note_version")).toEqual(expect.arrayContaining(["user", "path", "turn", "text"]));
    } finally {
      db.close();
    }
  });

  test("the migration runner given no user writes nothing and says so", () => {
    for (const user of [null, ""]) {
      const db = new Database(":memory:");
      try {
        const migrations = new Migrations();
        migrations.add("app", APP_MIGRATIONS);
        expect(() => migrate(db, migrations, { user, version: "test", backups: "/nonexistent", now: () => 0 })).toThrow(NO_OWNER);
        expect(tablesOf(db)).toEqual([]);
      } finally {
        db.close();
      }
    }
  });
});

describe("RPE opens for its user alone", () => {
  let bed: Bed;

  beforeEach(async () => {
    bed = await makeBed();
  });
  afterEach(async () => {
    await bed.remove();
  });

  test("a start with no user named leaves the data folder as it was and says what is missing", async () => {
    await expect(bed.open({ config: { lumiverse: { url: null, user: null } } })).rejects.toThrow(NO_OWNER);
    // Not the folder, its config, its backups or its database.
    expect(existsSync(bed.paths.root)).toBe(false);
  });

  test("a switch turned on under one user is not on for another", async () => {
    const app = await bed.open();
    expect(await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt --write {file}" })).toBe("waiting");
    await app.writes.run((db) => asCommand(db, () => setSwitch(db, OWNER, "format", "on", app.now())));
    expect(await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt --write {file}" })).toBe("on");
    expect(listSwitches(app.db, "user-other")).toEqual([]);
    expect(await app.switches.state("user-other", { kind: "hook", name: "format", target: "fmt --write {file}" })).toBe("waiting");
    await app.writes.run((db) => expect(asCommand(db, () => setSwitch(db, "user-other", "nothing-listed", "on", app.now()))).toBeNull());
    expect(app.switches.list().map((s) => [s.name, s.state])).toEqual([["format", "on"]]);
  });
});
