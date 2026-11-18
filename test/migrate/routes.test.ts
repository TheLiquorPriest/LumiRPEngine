// The Migration page's routes after a real run on the migration fixture: the summary answers what the page's data function
// gives for the user RPE belongs to, and before any run (another user) the steps and the permissions all the same; and a
// migrated chat's carried turns are listed and given.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { configOf, dataPaths } from "../../src/app/config";
import { PREVIOUS_PERMISSIONS } from "../../src/migrate/going-back";
import { migrate } from "../../src/migrate/migrate";
import { migrationPage } from "../../src/migrate/page";
import { MIGRATION_PATH, migrateRoutes } from "../../src/migrate/routes";
import { buildFixture, IDENT, STRAY, USER, type Fixture } from "./fixture";
import { pageInput } from "./look";
import { TREE as tree } from "./tree";
import { callRoute } from "../app/call";

describe("the Migration page's routes", () => {
  let fixture: Fixture;
  let data: string;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(run.ran).toBe(true);
  });

  afterAll(async () => {
    await fixture.remove();
  });

  const routesOver = (db: Database) =>
    migrateRoutes({ db, identifier: IDENT, paths: dataPaths(data), config: configOf({ port: 0, lumiverse: { url: null, user: USER } }, {}, "the test's config"), rehearsals: pageInput(db, fixture, data).rehearsals, env: {}, home: "/nowhere" });
  const routeAt = (db: Database, method: string, path: string) => {
    const found = routesOver(db).find((r) => r.method === method && r.path === path);
    if (found === undefined) throw new Error(`no route ${method} ${path}`);
    return found;
  };

  test("the summary answers what the page's data function gives; another user is answered no run, with the steps and the permissions", async () => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const answered = (await callRoute(routeAt(db, "GET", MIGRATION_PATH), { user: USER })) as { run: unknown };
      expect(answered.run).toEqual(migrationPage(pageInput(db, fixture, data)).run);
      const other = (await callRoute(routeAt(db, "GET", MIGRATION_PATH), { user: "someone-else" })) as { run: unknown; swap: string[]; goingBack: { permissions: string[] } };
      expect(other.run).toBeNull();
      expect(other.swap.length).toBe(4);
      expect(other.goingBack.permissions).toEqual([...PREVIOUS_PERMISSIONS]);
    } finally {
      db.close();
    }
  });

  test("a migrated chat's carried turns are listed, and a turn gives each text its record names word for word, with the engine that played it", async () => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const list = routeAt(db, "GET", "/api/v1/chats/:chat/carried");
      const one = routeAt(db, "GET", "/api/v1/chats/:chat/turns/:turn/carried");
      const chat = db.query<{ chat: string }, []>("SELECT chat FROM imported_record WHERE record LIKE '%\"texts\"%' LIMIT 1").get()?.chat;
      if (chat === undefined) throw new Error("no carried turn holds a text");
      const page = (await callRoute(list, { user: USER, params: { chat }, query: { limit: "1" } })) as { turns: { turn: string; texts: number }[]; total: number; more: boolean };
      expect(page.turns.length).toBe(1);
      expect(page.total).toBeGreaterThan(0);
      const withTexts = db.query<{ turn: string }, [string]>("SELECT turn FROM imported_record WHERE chat = ? AND record LIKE '%\"texts\"%' LIMIT 1").get(chat)?.turn ?? "";
      const shown = (await callRoute(one, { user: USER, params: { chat, turn: withTexts } })) as { engine: string | null; texts: { part: string; path: string; text: string | null }[] };
      expect(shown.engine).not.toBeNull();
      expect(shown.texts.length).toBeGreaterThan(0);
      expect(shown.texts.some((t) => t.text !== null)).toBe(true);
    } finally {
      db.close();
    }
  });
});
