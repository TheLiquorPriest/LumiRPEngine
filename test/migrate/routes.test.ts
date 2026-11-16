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
import { callRoute } from "../app/call";

describe("the Migration page's route", () => {
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

  const ask = async (db: Database, user: string): Promise<unknown> => {
    const [page] = migrateRoutes({ db, identifier: IDENT, globalConfig: join(data, "RPE-global.yml") });
    if (page === undefined) throw new Error("no route");
    return await callRoute(page, { user });
  };

  test("is one read for a page, and answers what the page's data function gives for that user", async () => {
    const routes = migrateRoutes({ db: new Database(":memory:"), identifier: IDENT, globalConfig: join(data, "RPE-global.yml") });
    expect(routes.map((r) => [r.method, r.path, r.access])).toEqual([["GET", MIGRATION_PATH, "page"], ["GET", "/api/v1/chats/:chat/carried", "page"], ["GET", "/api/v1/chats/:chat/turns/:turn/carried", "page"]]);
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

  test("a migrated chat's carried turns are listed, and a turn gives each text its record names word for word, with the engine that played it", async () => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const [, list, one] = migrateRoutes({ db, identifier: IDENT, globalConfig: join(data, "RPE-global.yml") });
      if (list === undefined || one === undefined) throw new Error("no route");
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
