// The install's calls into Lumiverse (`src/adapter/lumiverse/install-calls.ts`), against a stand-in
// that answers as Lumiverse's connections routes do (`src/routes/connections.routes.ts`: a list in
// pages of 50 unless asked, at most 1,000, `{ data, total, limit, offset }`; 404 `{ error }` for an
// unknown id; 201 for a new one; an update that replaces a connection's metadata whole,
// `src/services/connections.service.ts:517`).

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONNECTION_NAME, connectionsWhere, installedExtension, type LumiverseCall, markConnection, OPENAI_COMPATIBLE, settleConnection, type WantedConnection } from "../../src/adapter/lumiverse/install-calls";
import { RPE_MARK, RPE_MARK_KEY } from "../../src/adapter/lumiverse/pipe-wire";
import { isRecord } from "../../src/shared/json";

interface Stored {
  id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  has_api_key: boolean;
  metadata: Record<string, unknown>;
}

/** Lumiverse's connections as the install meets them, and every call that changed something. */
function lumiverse(): { call: LumiverseCall; connections: Stored[]; changes: string[]; asked: string[] } {
  const connections: Stored[] = [];
  const changes: string[] = [];
  const asked: string[] = [];
  let made = 0;
  const call: LumiverseCall = async (method, path, body) => {
    asked.push(`${method} ${path}`);
    const url = new URL(path, "http://lumiverse.invalid");
    if (method === "GET" && url.pathname === "/api/v1/spindle") return Response.json({ extensions: [{ identifier: "invented_ext", enabled: true, permissions: ["generation"] }] });
    if (method === "GET" && url.pathname === "/api/v1/connections") {
      // `parsePagination`: 50 unless asked, held between 1 and 1,000.
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 1000);
      const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
      return Response.json({ data: connections.slice(offset, offset + limit), total: connections.length, limit, offset });
    }
    if (method === "POST" && url.pathname === "/api/v1/connections") {
      changes.push(`POST ${url.pathname}`);
      const input = isRecord(body) ? body : {};
      const stored: Stored = { id: `made-${++made}`, name: String(input.name), provider: String(input.provider), api_url: String(input.api_url ?? ""), model: String(input.model ?? ""), has_api_key: typeof input.api_key === "string", metadata: isRecord(input.metadata) ? input.metadata : {} };
      connections.push(stored);
      return Response.json(stored, { status: 201 });
    }
    const id = /^\/api\/v1\/connections\/([^/]+)$/.exec(url.pathname)?.[1];
    const found = connections.find((c) => c.id === id);
    if (found === undefined) return Response.json({ error: "Connection not found" }, { status: 404 });
    if (method === "GET") return Response.json(found);
    if (method === "PUT") {
      changes.push(`PUT ${url.pathname}`);
      const input = isRecord(body) ? body : {};
      for (const field of ["name", "provider", "api_url", "model"] as const) if (typeof input[field] === "string") found[field] = input[field];
      if (typeof input.api_key === "string") found.has_api_key = true;
      // Lumiverse replaces the metadata whole.
      if (isRecord(input.metadata)) found.metadata = input.metadata;
      return Response.json(found);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  };
  return { call, connections, changes, asked };
}

const wanted = (over: Partial<WantedConnection> = {}): WantedConnection => ({ apiUrl: "http://127.0.0.1:7871/v1", models: ["rpe"], hasKey: true, makeKey: () => "rpe_invented", ...over });

const other = (n: number): Stored => ({ id: `other-${n}`, name: `Connection ${n}`, provider: "deepseek", api_url: "https://api.invented.example", model: "invented-model", has_api_key: true, metadata: { note: `kept ${n}` } });

describe("the install's calls into Lumiverse", () => {
  test("the install's calls into Lumiverse are the adapter's, and src/app names no Lumiverse route", () => {
    const app = join(import.meta.dir, "../../src/app");
    // `rpe connection` calls RPE's own connections routes, which are at the path Lumiverse's are at.
    const files = ["up.ts", ...readdirSync(join(app, "commands")).filter((name) => name !== "connection.ts").map((name) => join("commands", name))];
    const named = files.filter((file) => /\/api\/v1\/(spindle|connections)|\/api\/auth\//.test(readFileSync(join(app, file), "utf8")));
    expect(named).toEqual([]);
    expect(readFileSync(join(import.meta.dir, "../../src/adapter/lumiverse/install-calls.ts"), "utf8")).toContain("/api/v1/connections");
  });

  test("RPE's connection is made and every change to it is written with RPE's mark, the rest of its metadata carried as it was", async () => {
    const lumi = lumiverse();
    const made = await settleConnection(lumi.call, null, wanted());
    expect(made).toMatchObject({ made: true, newKey: true, name: CONNECTION_NAME });
    // The mark is in the call that makes it.
    expect(lumi.connections[0]).toMatchObject({ provider: OPENAI_COMPATIBLE, model: "rpe", metadata: { [RPE_MARK_KEY]: RPE_MARK } });
    expect(lumi.changes).toEqual(["POST /api/v1/connections"]);

    // Again: nothing is changed.
    expect(await settleConnection(lumi.call, made.id, wanted())).toMatchObject({ made: false, changed: [], newKey: false });
    expect(lumi.changes).toHaveLength(1);

    // Moved and unmarked, with metadata of the user's own: the one change writes the address and the mark, and keeps the rest.
    const row = lumi.connections[0] as Stored;
    row.api_url = "http://127.0.0.1:9999/v1";
    row.metadata = { favourite: true, region: "somewhere" };
    const settled = await settleConnection(lumi.call, made.id, wanted());
    expect(settled.changed).toEqual(["api_url", "mark"]);
    expect(row.metadata).toEqual({ favourite: true, region: "somewhere", [RPE_MARK_KEY]: RPE_MARK });
    expect(lumi.changes).toHaveLength(2);

    // Marked by hand only: one change, the mark, and the rest of the connection is as it was.
    row.metadata = { favourite: true };
    expect((await settleConnection(lumi.call, made.id, wanted())).changed).toEqual(["mark"]);
    expect(row).toMatchObject({ api_url: "http://127.0.0.1:9999/v1".replace("9999", "7871"), metadata: { favourite: true, [RPE_MARK_KEY]: RPE_MARK } });
  });

  test("a connection is marked and unmarked by id, touching only RPE's one key of its metadata", async () => {
    const lumi = lumiverse();
    lumi.connections.push(other(1));
    expect(await markConnection(lumi.call, "other-1", true)).toBe(true);
    expect(lumi.connections[0]?.metadata).toEqual({ note: "kept 1", [RPE_MARK_KEY]: RPE_MARK });
    expect(await markConnection(lumi.call, "other-1", true)).toBe(false);
    expect(lumi.changes).toHaveLength(1);
    expect(await markConnection(lumi.call, "other-1", false)).toBe(true);
    expect(lumi.connections[0]?.metadata).toEqual({ note: "kept 1" });
    expect(await markConnection(lumi.call, "other-1", false)).toBe(false);
    await expect(markConnection(lumi.call, "no-such", true)).rejects.toThrow("Lumiverse refused the question about the connection no-such (404): Connection not found.");
  });

  test("the connection today's build made for its runtime is never changed", async () => {
    const lumi = lumiverse();
    lumi.connections.push({ ...other(1), id: "todays", provider: OPENAI_COMPATIBLE, model: "lumiah-loop", api_url: "http://127.0.0.1:7777/v1" });
    const settled = await settleConnection(lumi.call, "todays", wanted());
    expect(settled).toMatchObject({ made: true, todays: "todays" });
    expect(lumi.connections.find((c) => c.id === "todays")?.metadata).toEqual({ note: "kept 1" });
    expect(lumi.changes).toEqual(["POST /api/v1/connections"]);
  });

  test("with more connections than one page holds, the read finds one on a later page, and RPE's own connection is found there when config.json is lost", async () => {
    const lumi = lumiverse();
    for (let n = 0; n < 1100; n++) lumi.connections.push(other(n));
    lumi.connections.push({ id: "mine", name: "RPE", provider: OPENAI_COMPATIBLE, api_url: "http://127.0.0.1:7871/v1/", model: "rpe", has_api_key: true, metadata: {} });
    lumi.connections.push({ ...other(2000), id: "loop", provider: OPENAI_COMPATIBLE, model: "lumiah-x", api_url: "http://127.0.0.1:7777/v1" });
    for (let n = 3000; n < 3100; n++) lumi.connections.push(other(n));

    // Pages as large as Lumiverse allows, not the default of 50.
    expect(await connectionsWhere(lumi.call, ({ model }) => /^lumiah/.test(model))).toEqual([{ id: "loop", name: "Connection 2000", model: "lumiah-x" }]);
    expect(lumi.asked.filter((line) => line.startsWith("GET /api/v1/connections?"))).toEqual(["GET /api/v1/connections?limit=1000&offset=0", "GET /api/v1/connections?limit=1000&offset=1000"]);

    lumi.asked.length = 0;
    const settled = await settleConnection(lumi.call, null, wanted());
    // Found by its address and model on the second page: no second one is made, and it is marked.
    expect(settled).toMatchObject({ id: "mine", made: false, changed: ["mark"] });
    expect(lumi.connections.filter((c) => c.name === "RPE")).toHaveLength(1);
    expect(lumi.changes).toEqual(["PUT /api/v1/connections/mine"]);
  });

  test("the installed extension is read from Lumiverse's list", async () => {
    const lumi = lumiverse();
    expect(await installedExtension(lumi.call, "invented_ext")).toEqual({ on: true, permissions: ["generation"] });
    expect(await installedExtension(lumi.call, "missing")).toBeNull();
  });
});
