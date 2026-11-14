// The Migration page's route after a real run on the migration fixture: it answers, for the user RPE
// belongs to, exactly what the page's data function gives, and for a database no run has touched it
// answers a page with no report.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "../../src/migrate/migrate";
import { migrationPage } from "../../src/migrate/page";
import { MIGRATION_PATH, migrateRoutes } from "../../src/migrate/routes";
import { buildFixture, IDENT, STRAY, USER, type Fixture } from "./fixture";
import { TREE as tree } from "./tree";

describe("the Migration page's route", () => {
  let fixture: Fixture;
  let data: string;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    const run = await migrate(fixture.sources, { data, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(run.ran).toBe(true);
  });

  afterAll(async () => {
    await fixture.remove();
  });

  const ask = async (db: Database, user: string): Promise<unknown> => {
    const [page] = migrateRoutes({ db, identifier: IDENT });
    if (page === undefined) throw new Error("no route");
    const request = new Request(`http://rpe.test${MIGRATION_PATH}`);
    return await page.handle({ params: {}, query: new URLSearchParams(), body: undefined, user, request, signal: request.signal });
  };

  test("is one read for a page, and answers what the page's data function gives for that user", async () => {
    const routes = migrateRoutes({ db: new Database(":memory:"), identifier: IDENT });
    expect(routes.map((r) => [r.method, r.path, r.access])).toEqual([["GET", MIGRATION_PATH, "page"]]);
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const answered = await ask(db, USER);
      expect(answered).toEqual(migrationPage({ db, user: USER, identifier: IDENT }));
      expect((answered as { report: unknown }).report).not.toBeNull();
    } finally {
      db.close();
    }
  });

  test("another user is answered a page with no report and no chats", async () => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const answered = (await ask(db, "someone-else")) as { report: unknown; chats: unknown[] };
      expect(answered.report).toBeNull();
      expect(answered.chats).toEqual([]);
    } finally {
      db.close();
    }
  });
});
