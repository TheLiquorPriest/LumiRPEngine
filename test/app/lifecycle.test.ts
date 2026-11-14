// An area's two moments besides its mount: `started`, once the server answers, areas in order; and
// `stopping`, first thing at close, in reverse order, while the server still answers and writes
// still land. A throw from either is logged and RPE goes on; `stopping` runs for every mounted area,
// also when the server never started. Each test starts the server in-process on a free loopback port.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, Area } from "../../src/app";
import { type Bed, makeBed } from "./helpers";

describe("an area's moments", () => {
  let bed: Bed;
  let seen: string[];

  beforeEach(async () => {
    bed = await makeBed();
    seen = [];
  });

  afterEach(async () => {
    await bed.remove();
  });

  /** What the server answers on its status route now. */
  async function status(app: App): Promise<string> {
    const url = app.listening()?.url;
    if (url === undefined) return "not listening";
    return String((await fetch(`${url}/api/v1/status`)).status);
  }

  /** An area that notes each of its moments, with what the server answered then. */
  function noting(name: string, fails?: "started" | "stopping"): Area {
    return {
      name,
      async started(app) {
        seen.push(`${name} started: ${await status(app)}`);
        if (fails === "started") throw new Error(`${name} could not reach its door`);
      },
      async stopping(app) {
        seen.push(`${name} stopping: ${await status(app)}`);
        if (fails === "stopping") throw new Error(`${name} could not close its door`);
      },
    };
  }

  function logged(area: string, words: string): boolean {
    return bed.logs.some((line) => line.includes(`"area":"${area}"`) && line.includes(words));
  }

  test("started runs once the server answers, areas in order; one that throws is logged, and the rest start", async () => {
    const app = await bed.open({ areas: [noting("first"), noting("second", "started"), noting("third")] });
    expect(seen).toEqual([]);
    await app.start();
    expect(seen).toEqual(["first started: 200", "second started: 200", "third started: 200"]);
    expect(logged("second", "could not reach its door")).toBe(true);
    expect(await status(app)).toBe("200");
  });

  test("stopping runs first at close, in reverse order, while the server answers and writes land; one that throws is logged, and the app still closes", async () => {
    const writer: Area = {
      name: "writer",
      tables: { area: "harness", migrations: [{ version: 1, sql: "CREATE TABLE seen (n INTEGER PRIMARY KEY, what TEXT NOT NULL)" }] },
      async stopping(app) {
        await app.writes.run((db) => db.run("INSERT INTO seen (what) VALUES ('written while stopping')"));
        seen.push("writer stopping");
      },
    };
    const app = await bed.open({ areas: [writer, noting("door", "stopping"), noting("last")] });
    const { url } = await app.start();
    seen = [];
    await app.close();
    expect(seen).toEqual(["last stopping: 200", "door stopping: 200", "writer stopping"]);
    expect(logged("door", "could not close its door")).toBe(true);
    expect(app.listening()).toBeNull();
    await expect(fetch(`${url}/api/v1/status`)).rejects.toThrow();
    const db = new Database(bed.paths.database, { readonly: true });
    try {
      expect(db.query("SELECT what FROM seen").all()).toEqual([{ what: "written while stopping" }]);
    } finally {
      db.close();
    }
  });

  test("stopping runs for every mounted area when the server never started or its port was taken; an area whose mount failed, and those after it, get none", async () => {
    await (await bed.open({ areas: [noting("first"), noting("second")] })).close();
    expect(seen).toEqual(["second stopping: not listening", "first stopping: not listening"]);
    seen = [];
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("another program") });
    try {
      const blocked = await bed.open({ config: { port: taken.port }, areas: [noting("first")] });
      await expect(blocked.start()).rejects.toThrow();
      await blocked.close();
      expect(seen).toEqual(["first stopping: not listening"]);
    } finally {
      await taken.stop(true);
    }
    seen = [];
    const broken: Area = {
      ...noting("broken"),
      mount() {
        throw new Error("no room for it");
      },
    };
    await expect(bed.open({ areas: [noting("first"), broken, noting("after")] })).rejects.toThrow("no room for it");
    expect(seen).toEqual(["first stopping: not listening"]);
  });

  test("a close asked for while the areas are starting lets their started finish first", async () => {
    const gate = Promise.withResolvers<void>();
    const slow: Area = {
      name: "slow",
      async started() {
        seen.push("slow starting");
        await gate.promise;
        seen.push("slow started");
      },
      stopping() {
        seen.push("slow stopping");
      },
    };
    const app = await bed.open({ areas: [slow] });
    const starting = app.start();
    const closing = app.close();
    expect(seen).toEqual(["slow starting"]);
    gate.resolve();
    await starting;
    await closing;
    expect(seen).toEqual(["slow starting", "slow started", "slow stopping"]);
    await expect(app.start()).rejects.toThrow("RPE is stopping");
  });
});
