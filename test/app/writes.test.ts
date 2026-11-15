// The single write queue: a hundred writers at once all land, in the order they asked; one that fails
// or waits is undone alone; nothing writes around the queue; and reads are answered while a long run
// of writes is still under way. Each test starts the server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, Area, RunningServer } from "../../src/app";
import { route, shape, WriteWaited } from "../../src/app";
import { bearer, type Bed, makeBed, makeKey } from "./helpers";

/** A table to write to, and a page route that writes one row through the queue. */
const probe: Area = {
  name: "probe",
  tables: { area: "harness", migrations: [{ version: 1, sql: "CREATE TABLE probe (id INTEGER PRIMARY KEY, n INTEGER NOT NULL, by TEXT NOT NULL)" }] },
  mount(app) {
    app.routes.add("probe", [
      route({
        method: "POST",
        path: "/api/v1/probe/rows",
        access: "page",
        group: "service",
        does: "Writes one row through the queue.",
        body: shape.object({ n: shape.number() }),
        reply: shape.object({ id: shape.number() }),
        handle: async ({ body }) => ({ id: await app.writes.run((db) => Number(db.run("INSERT INTO probe (n, by) VALUES (?, 'page')", [body.n]).lastInsertRowid)) }),
      }),
    ]);
  },
};

function rows(app: App): number[] {
  return app.db.query<{ n: number }, []>("SELECT n FROM probe ORDER BY id").all().map((r) => r.n);
}

function insert(app: App, n: number): Promise<number> {
  return app.writes.run((db) => Number(db.run("INSERT INTO probe (n, by) VALUES (?, 'writer')", [n]).lastInsertRowid));
}

describe("the write queue", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open({ areas: [probe] });
    server = await app.start();
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("a hundred writers at once all land, in the order they asked", async () => {
    const ids = await Promise.all(Array.from({ length: 100 }, (_, n) => insert(app, n)));
    expect(rows(app)).toEqual(Array.from({ length: 100 }, (_, n) => n));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(100);
  });

  test("a hundred pages writing at once all land, each once", async () => {
    const page = bearer(await makeKey(app, "web"));
    const answers = await Promise.all(
      Array.from({ length: 100 }, (_, n) => fetch(`${server.url}/api/v1/probe/rows`, { method: "POST", headers: { ...page, "content-type": "application/json" }, body: JSON.stringify({ n }) })),
    );
    expect(answers.map((res) => res.status)).toEqual(Array.from({ length: 100 }, () => 200));
    expect(rows(app).sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, n) => n));
  });

  test("a writer that fails is undone alone, and the writers around it land", async () => {
    const asked = Array.from({ length: 10 }, (_, n) =>
      n === 5
        ? app.writes.run((db) => {
            db.run("INSERT INTO probe (n, by) VALUES (5, 'writer')");
            throw new Error("the fifth writer changed its mind");
          })
        : insert(app, n),
    );
    const settled = await Promise.allSettled(asked);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    expect(rows(app)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9]);
  });

  test("a writer that waits inside its transaction is undone and told why, and what it does after the wait is refused", async () => {
    let after: unknown = "did not run";
    const waited = app.writes.run(async (db) => {
      db.run("INSERT INTO probe (n, by) VALUES (1, 'writer')");
      await Promise.resolve();
      try {
        db.run("INSERT INTO probe (n, by) VALUES (2, 'writer')");
        after = "wrote";
      } catch (error) {
        after = error;
      }
    });
    await expect(waited).rejects.toThrow(WriteWaited);
    expect(after).toBeInstanceOf(Error);
    expect(rows(app)).toEqual([]);
    await insert(app, 3);
    expect(rows(app)).toEqual([3]);
  });

  test("nothing writes around the queue: the database takes no write outside it, and reads go on", () => {
    expect(() => app.db.run("INSERT INTO probe (n, by) VALUES (1, 'around')")).toThrow("readonly");
    expect(rows(app)).toEqual([]);
  });

  test("reads are answered while a long run of writes is still under way", async () => {
    const all = 20_000;
    const done = Promise.all(Array.from({ length: all }, (_, n) => insert(app, n)));
    // One turn of the event loop: the queue has run one slice of writes and let other work in.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const midway = rows(app).length;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(all);
    expect((await fetch(`${server.url}/api/v1/status`)).status).toBe(200);
    await done;
    expect(rows(app)).toHaveLength(all);
  });
});
