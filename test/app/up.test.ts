// `rpe up`, against a stand-in that answers as Lumiverse's sign-in, session, connections and
// extensions routes do. A first run signs in, makes the provider key and RPE's OpenAI-compatible
// connection with it, keeps the connection's id, and says what is left to do; a second run asks for
// nothing and changes nothing; a connection changed or removed in Lumiverse is brought back; and a
// refusal from Lumiverse leaves the key before it working.

import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { secretHash } from "../../src/app/auth";
import { runCli } from "../../src/app/cli";
import { isRecord } from "../../src/shared/json";
import { type Bed, cliIo, freePort, makeBed, writeConfig } from "./helpers";

const ACCOUNT = { id: "user-reader-0001", username: "reader", password: "invented correct horse" };

interface Profile {
  id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  has_api_key: boolean;
  key: string | null;
}

interface StandIn {
  url: string;
  connections: Map<string, Profile>;
  extensions: { identifier: string; enabled: boolean }[];
  /** Every call that changes something, as `METHOD path`. */
  changes: string[];
  signIns: number;
  /** Session tokens Lumiverse still takes. */
  live: Set<string>;
  refusePut: boolean;
  stop(): Promise<void>;
}

/**
 * Lumiverse as `rpe up` meets it: the username sign-in and `get-session` (Better Auth), the
 * connections routes (`src/routes/connections.routes.ts`: 404 `{error}` for an unknown id, 201 for a
 * new one, `has_api_key` and never the key), and `GET /api/v1/spindle`. Every call but the sign-in
 * needs a live session's bearer.
 */
function standIn(): StandIn {
  const state: Omit<StandIn, "url" | "stop"> = { connections: new Map(), extensions: [], changes: [], signIns: 0, live: new Set(), refusePut: false };
  const shown = (p: Profile) => ({ id: p.id, name: p.name, provider: p.provider, api_url: p.api_url, model: p.model, preset_id: null, is_default: false, has_api_key: p.has_api_key, metadata: {}, created_at: 1, updated_at: 1 });
  let made = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const body: unknown = request.method === "POST" || request.method === "PUT" ? await request.json() : null;
      if (request.method === "POST" && pathname === "/api/auth/sign-in/username") {
        state.signIns++;
        if (!isRecord(body) || body.username !== ACCOUNT.username || body.password !== ACCOUNT.password) return Response.json({ message: "Invalid username or password" }, { status: 401 });
        const token = `invented-session-token-${state.signIns}`;
        state.live.add(token);
        return Response.json({ token, user: { id: ACCOUNT.id, username: ACCOUNT.username } });
      }
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (pathname === "/api/auth/get-session") return Response.json(state.live.has(token) ? { session: { token }, user: { id: ACCOUNT.id } } : null);
      if (!state.live.has(token)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (request.method === "GET" && pathname === "/api/v1/spindle") return Response.json({ extensions: state.extensions, isPrivileged: false });
      if (request.method !== "GET") state.changes.push(`${request.method} ${pathname}`);
      if (request.method === "POST" && pathname === "/api/v1/connections") {
        if (!isRecord(body) || !body.name || !body.provider) return Response.json({ error: "name and provider are required" }, { status: 400 });
        const key = typeof body.api_key === "string" && body.api_key !== "" ? body.api_key : null;
        const p: Profile = { id: `connection-${++made}`, name: String(body.name), provider: String(body.provider), api_url: String(body.api_url ?? ""), model: String(body.model ?? ""), has_api_key: key !== null, key };
        state.connections.set(p.id, p);
        return Response.json(shown(p), { status: 201 });
      }
      const id = /^\/api\/v1\/connections\/([^/]+)$/.exec(pathname)?.[1];
      const p = id === undefined ? undefined : state.connections.get(id);
      if (p === undefined) return Response.json({ error: "Not found" }, { status: 404 });
      if (request.method === "GET") return Response.json(shown(p));
      if (request.method === "PUT" && isRecord(body)) {
        if (state.refusePut) return Response.json({ error: "The connection is locked" }, { status: 500 });
        for (const field of ["name", "provider", "api_url", "model"] as const) if (typeof body[field] === "string") p[field] = body[field];
        if (typeof body.api_key === "string") [p.key, p.has_api_key] = body.api_key === "" ? [null, false] : [body.api_key, true];
        return Response.json(shown(p));
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  return Object.assign(state, { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) });
}

describe("rpe up", () => {
  let lumiverse: StandIn;
  let bed: Bed;
  let port: number;

  beforeAll(() => {
    lumiverse = standIn();
  });

  afterAll(async () => {
    await lumiverse.stop();
  });

  beforeEach(async () => {
    bed = await makeBed();
    port = freePort();
    Object.assign(lumiverse, { changes: [], signIns: 0, extensions: [], refusePut: false });
    lumiverse.connections.clear();
    lumiverse.live.clear();
    await mkdir(bed.paths.root, { recursive: true });
    await writeConfig(bed.paths, { port });
  });

  afterEach(async () => {
    await bed.remove();
  });

  async function up(password: string | null = null): Promise<{ code: number; out: string; err: string; asked: number }> {
    const io = cliIo({ secret: password });
    let asked = 0;
    const counted = { ...io, secret: async (q: string) => (asked++, await io.secret(q)) };
    const code = await runCli(["up", "--url", lumiverse.url, "--user", ACCOUNT.username, "--data", bed.paths.root], counted, { version: "1.0.0" });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n"), asked };
  }

  /** The provider keys RPE keeps, as hashes, with whether each is in force. */
  function providerKeys(): { hash: string; retired: number | null }[] {
    const db = new Database(bed.paths.database, { readonly: true });
    try {
      return db.query<{ hash: string; retired: number | null }, []>("SELECT hash, retired FROM app_key WHERE kind = 'provider' ORDER BY made, rowid").all();
    } finally {
      db.close();
    }
  }

  const inForce = (): string[] => providerKeys().flatMap((k) => (k.retired === null ? [k.hash] : []));
  const config = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(bed.paths.config, "utf8"));
  const only = (): Profile => {
    expect(lumiverse.connections.size).toBe(1);
    return [...lumiverse.connections.values()][0] as Profile;
  };

  test("a first run signs in, makes the key and an OpenAI-compatible connection at RPE's /v1 with it, keeps its id, and says what is left", async () => {
    const first = await up(ACCOUNT.password);
    expect(first.code).toBe(0);
    const made = only();
    expect(made).toMatchObject({ name: "RPE", provider: "custom", api_url: `http://127.0.0.1:${port}/v1`, model: "rpe", has_api_key: true });
    expect(inForce()).toEqual([secretHash(made.key ?? "")]);
    expect((await config()).lumiverse).toEqual({ url: lumiverse.url, user: ACCOUNT.id, connection: made.id });
    expect(first.out).toContain(`Made RPE's connection in Lumiverse, "RPE" (${made.id})`);
    expect(first.out).toContain("What is left for you to do:");
    expect(first.out).toContain("Install RPE's extension in Lumiverse");
    expect(first.out).toContain("Start RPE: rpe serve.");
    expect(first.out).toContain(`choose the connection "RPE"`);
    expect(first.out + first.err).not.toContain(made.key ?? "-");
  });

  test("a second run asks for nothing and changes nothing", async () => {
    expect((await up(ACCOUNT.password)).code).toBe(0);
    lumiverse.extensions.push({ identifier: "lumi_rp_engine", enabled: true });
    const files = [await readFile(bed.paths.config, "utf8"), await readFile(bed.paths.secrets, "utf8")];
    const keys = providerKeys();
    const connections = JSON.stringify([...lumiverse.connections]);
    lumiverse.changes.length = 0;
    const again = await up(null);
    expect(again.code).toBe(0);
    expect(again.asked).toBe(0);
    expect(lumiverse.signIns).toBe(1);
    expect(lumiverse.changes).toEqual([]);
    expect([await readFile(bed.paths.config, "utf8"), await readFile(bed.paths.secrets, "utf8")]).toEqual(files);
    expect(providerKeys()).toEqual(keys);
    expect(JSON.stringify([...lumiverse.connections])).toBe(connections);
    expect(again.out).toContain("is already as it should be");
    expect(again.out).not.toContain("Install RPE's extension");
  });

  test("a connection changed in Lumiverse is put back, with a new key when it lost its own, and the key before stops working", async () => {
    await up(ACCOUNT.password);
    const before = only();
    const oldKey = before.key;
    Object.assign(before, { api_url: "http://127.0.0.1:1/v1", model: "another-model", has_api_key: false, key: null, name: "My RPE" });
    const fixed = await up(null);
    expect(fixed.code).toBe(0);
    const after = only();
    expect(after).toMatchObject({ id: before.id, name: "My RPE", provider: "custom", api_url: `http://127.0.0.1:${port}/v1`, model: "rpe", has_api_key: true });
    expect(after.key).not.toBe(oldKey);
    expect(inForce()).toEqual([secretHash(after.key ?? "")]);
    expect(fixed.out).toContain("up to date: api_url, model, key");
    expect(fixed.out).toContain("the one before it no longer works");
  });

  test("a connection removed in Lumiverse is made again, and its new id kept", async () => {
    await up(ACCOUNT.password);
    const gone = only().id;
    lumiverse.connections.clear();
    expect((await up(null)).code).toBe(0);
    const remade = only();
    expect(remade.id).not.toBe(gone);
    expect(((await config()).lumiverse as Record<string, unknown>).connection).toBe(remade.id);
    expect(inForce()).toEqual([secretHash(remade.key ?? "")]);
  });

  test("an ended sign-in asks for the password again", async () => {
    await up(ACCOUNT.password);
    lumiverse.live.clear();
    const again = await up(ACCOUNT.password);
    expect(again.code).toBe(0);
    expect(again.asked).toBe(1);
    expect(lumiverse.signIns).toBe(2);
  });

  test("when Lumiverse refuses the change, the key before it keeps working", async () => {
    await up(ACCOUNT.password);
    const kept = inForce();
    Object.assign(only(), { has_api_key: false, key: null });
    lumiverse.refusePut = true;
    const refused = await up(null);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("The connection is locked");
    expect(inForce()).toEqual(kept);
  });
});
