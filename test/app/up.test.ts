// `rpe up`, against a stand-in that answers as Lumiverse's sign-in, session, connections and
// extensions routes do. A first run signs in, makes the provider key and RPE's OpenAI-compatible
// connection with it, keeps the connection's id, and says what is left to do; a second run asks for
// nothing and changes nothing; a connection changed or removed in Lumiverse is brought back; and a
// refusal from Lumiverse leaves the key before it working.

import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliOptions } from "../../src/app/cli";
import { serviceRoutes } from "../../src/app/service-routes";
import { serviceNameOf, unitNameRefusal } from "../../src/app/up";
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
  metadata: Record<string, unknown>;
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
  const shown = (p: Profile) => ({ id: p.id, name: p.name, provider: p.provider, api_url: p.api_url, model: p.model, preset_id: null, is_default: false, has_api_key: p.has_api_key, metadata: p.metadata, created_at: 1, updated_at: 1 });
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
      if (request.method === "GET" && pathname === "/api/v1/connections") {
        // `parsePagination`: 50 unless asked, held between 1 and 1,000; the answer is `{ data, total, limit, offset }`.
        const query = new URL(request.url).searchParams;
        const limit = Math.min(Math.max(Number(query.get("limit") ?? 50), 1), 1000);
        const offset = Math.max(Number(query.get("offset") ?? 0), 0);
        return Response.json({ data: [...state.connections.values()].slice(offset, offset + limit).map(shown), total: state.connections.size, limit, offset });
      }
      if (request.method !== "GET") state.changes.push(`${request.method} ${pathname}`);
      if (request.method === "POST" && pathname === "/api/v1/connections") {
        if (!isRecord(body) || !body.name || !body.provider) return Response.json({ error: "name and provider are required" }, { status: 400 });
        const key = typeof body.api_key === "string" && body.api_key !== "" ? body.api_key : null;
        const p: Profile = { id: `connection-${++made}`, name: String(body.name), provider: String(body.provider), api_url: String(body.api_url ?? ""), model: String(body.model ?? ""), has_api_key: key !== null, key, metadata: isRecord(body.metadata) ? body.metadata : {} };
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
        // Lumiverse replaces a connection's metadata whole (`connections.service.ts:517`).
        if (isRecord(body.metadata)) p.metadata = body.metadata;
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

  /** `rpe up` as typed: `line` is what follows `rpe up`, `answers` the lines the user types when asked, `extra` the machine it runs on. It serves in the foreground, so it is told to stop before it starts. */
  async function up(password: string | null = null, line: string[] = ["--url", lumiverse.url, "--user", ACCOUNT.username], answers: string[] = [], extra: { env?: Record<string, string>; options?: Partial<CliOptions> } = {}): Promise<{ code: number; out: string; err: string; asked: number; asks: string[] }> {
    const io = cliIo({ secret: password });
    io.stop();
    let asked = 0;
    const asks: string[] = [];
    const counted = { ...io, env: extra.env ?? io.env, secret: async (q: string) => (asked++, await io.secret(q)), ask: async (q: string) => (asks.push(q), answers[asks.length - 1] ?? null) };
    const code = await runCli(["up", ...line, "--data", bed.paths.root], counted, { version: "1.0.0", ...extra.options });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n"), asked, asks };
  }

  /** The provider keys RPE keeps, as hashes, with whether each is in force. */
  function providerKeys(): { hash: string; retired: number | null }[] {
    const db = new Database(bed.paths.database, { readonly: true });
    try {
      return db.query<{ hash: string; retired: number | null }, []>("SELECT hash, NULL AS retired FROM provider_key ORDER BY made, rowid").all();
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
    expect((await config()).lumiverse).toEqual({ url: lumiverse.url, user: ACCOUNT.id, connections: [made.id] });
    expect(first.out).toContain(`Made RPE's connection in Lumiverse, "RPE" (${made.id})`);
    expect(first.out).toContain("What is left for you to do:");
    expect(first.out).toContain("Install RPE's extension in Lumiverse");
    expect(first.out).toContain("RPE serves in the foreground now");
    expect(first.out).toMatch(/The token for RPE's web app, shown this once[\s\S]*rpw_[0-9a-f]{64}[\s\S]*It has no end/);
    expect(first.out).toContain(`choose the connection "RPE"`);
    expect(first.out + first.err).not.toContain(made.key ?? "-");
  });

  test("the plan's line, up --url <lumiverse>, asks for the username and the password and sets RPE up; again with no --url it takes the config's address and asks for nothing", async () => {
    const first = await up(ACCOUNT.password, ["--url", lumiverse.url], [ACCOUNT.username]);
    expect(first.code).toBe(0);
    expect(first.asks).toEqual(["Lumiverse username: "]);
    expect(first.asked).toBe(1);
    expect(only()).toMatchObject({ name: "RPE", has_api_key: true });
    const again = await up(null, []);
    expect(again.code).toBe(0);
    expect(again.asks).toEqual([]);
    expect(again.asked).toBe(0);
    expect(lumiverse.signIns).toBe(1);
    // The token is shown at the first run, and a later one says how to make a new one.
    expect(first.out).toContain("rpw_");
    expect(again.out).not.toContain("rpw_");
    expect(again.out).toContain("is not shown again");
  });

  test("with something else on RPE's port, up says so and names how to move RPE; with a free one after it, a first install takes that", async () => {
    await mkdir(bed.paths.files, { recursive: true });
    await writeFile(bed.paths.globalConfig, "service:\n  lastPort: 65535\n");
    const squatter = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("not rpe", { status: 200 }) });
    try {
      const first = await up(ACCOUNT.password);
      expect(first.code).toBe(0);
      expect(first.out).toMatch(/Port \d+ is taken, so RPE uses \d+/);
      const used = Number(/RPE uses (\d+)/.exec(first.out)?.[1]);
      expect(used).toBeGreaterThan(port);
      expect(only().api_url).toBe(`http://127.0.0.1:${used}/v1`);
      expect((await config()).port).toBe(used);
      // Installed: its port is its connection's, so what holds it is said and RPE does not move by itself.
      await squatter.stop(true);
      const held = Bun.serve({ hostname: "127.0.0.1", port: used, fetch: () => new Response("not rpe", { status: 200 }) });
      try {
        const again = await up(null);
        expect(again.code).toBe(1);
        expect(again.out).toContain(`Something other than RPE answers at http://127.0.0.1:${used}`);
        expect(again.out).toContain("--port");
      } finally {
        await held.stop(true);
      }
    } finally {
      await squatter.stop(true);
    }
  });

  test("`rpe down` after an install on a connection of RPE's own says to give the chats moved to it the connection they had", async () => {
    await up(ACCOUNT.password);
    const made = only();
    const io = cliIo();
    expect(await runCli(["down", "--data", bed.paths.root], io, { version: "1.0.0" })).toBe(0);
    expect(io.outs.join("\n")).toContain(`  5. In Lumiverse, give every chat you moved to RPE's connection ${made.id} the connection it had before: RPE no longer answers there.`);
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
    expect(((await config()).lumiverse as Record<string, unknown>).connections).toEqual([remade.id]);
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

  /** A machine with systemd, as far as `rpe up --systemd` can tell: programs on its PATH that write down what they were asked, the extension's folder in Lumiverse's data folder, and a Bun to run RPE with. */
  async function machine(): Promise<{ extension: string; appFile: string; bun: string; calls: () => Promise<string>; env: Record<string, string>; unit: string; options: Partial<CliOptions>; remove(): Promise<void> }> {
    const root = await mkdtemp(join(tmpdir(), "rpe-machine-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const log = join(root, "calls.log");
    const program = async (name: string, body: string): Promise<void> => {
      await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
      await chmod(join(bin, name), 0o755);
    };
    await program("systemctl", `echo "systemctl $*" >> "${log}"`);
    await program("loginctl", `echo "loginctl $*" >> "${log}"\ncase "$1" in show-user) echo yes;; esac`);
    await program("id", "echo tester");
    await program("bun", "exit 0");
    const bun = await realpath(join(bin, "bun"));
    const extension = join(root, "lumiverse", "extensions", "lumi_rp_engine", "repo");
    await mkdir(join(extension, "dist", "guidance"), { recursive: true });
    await mkdir(join(extension, "dist", "guidance-harness"), { recursive: true });
    await mkdir(join(extension, "dist", "ui"), { recursive: true });
    await writeFile(join(extension, "dist", "rpe.js"), "// the app, as built\n");
    await writeFile(join(extension, "dist", "guidance", "a.md"), "shipped");
    await writeFile(join(extension, "dist", "ui", "index.html"), "<html></html>");
    const config = join(root, "config");
    return {
      extension,
      appFile: join(extension, "dist", "rpe.js"),
      bun,
      calls: async () => (await readFile(log, "utf8").catch(() => "")),
      env: { PATH: bin, XDG_CONFIG_HOME: config },
      unit: join(config, "systemd", "user", "rpe-reader.service"),
      options: { appFile: join(extension, "dist", "rpe.js"), host: { platform: "linux", uid: process.getuid?.() ?? null, bun } },
      remove: () => rm(root, { recursive: true, force: true }),
    };
  }

  test("a first up --systemd installs RPE's own copy and a unit that runs it, records the file it ran from, and the extension's folder is not what the service runs; the unit carries the restart wait and the memory cap from their settings", async () => {
    const m = await machine();
    try {
      const first = await up(ACCOUNT.password, ["--url", lumiverse.url, "--user", ACCOUNT.username, "--systemd", "--memory", "768M"], [], { env: m.env, options: m.options });
      expect(first.err).toBe("");
      expect(first.code).toBe(0);
      const copy = join(bed.paths.root, "app", "current");
      expect(await readFile(join(copy, "rpe.js"), "utf8")).toBe("// the app, as built\n");
      expect(await readFile(join(copy, "guidance", "a.md"), "utf8")).toBe("shipped");
      expect(await readFile(join(copy, "ui", "index.html"), "utf8")).toBe("<html></html>");
      expect(JSON.parse(await readFile(join(bed.paths.root, "app", "source.json"), "utf8")).file).toBe(m.appFile);
      const unit = await readFile(m.unit, "utf8");
      expect(unit).toContain(`ExecStart=${m.bun} ${join(copy, "rpe.js")} serve --data ${bed.paths.root}`);
      expect(unit).not.toContain(m.extension);
      expect(unit).toContain(`ExecStartPre=${m.bun} ${join(bed.paths.root, "app", "before-start.mjs")} ${bed.paths.root} 5`);
      expect(unit).toContain("RestartSec=2");
      expect(unit).toContain("MemoryMax=768M");
      expect(unit).toContain("StartLimitBurst=6");
      expect(await readFile(bed.paths.globalConfig, "utf8")).toContain("memory: 768M");
      const calls = await m.calls();
      expect(calls).toContain("systemctl --user enable rpe-reader.service");
      expect(calls).toContain("systemctl --user restart rpe-reader.service");
      // Lingering was on already: nothing asked to turn it on.
      expect(calls).not.toContain("enable-linger");
      expect(first.out).toContain(`Installed RPE's own copy in ${copy}`);
    } finally {
      await m.remove();
    }
  });

  test("as root up --systemd is refused with nothing changed; with no systemctl it says so and how to keep RPE running, then serves in the foreground", async () => {
    const m = await machine();
    try {
      const root = await up(ACCOUNT.password, ["--url", lumiverse.url, "--user", ACCOUNT.username, "--systemd"], [], { env: m.env, options: { ...m.options, host: { platform: "linux", uid: 0, bun: m.bun } } });
      expect(root.code).toBe(1);
      expect(root.err).toContain("root's account has none");
      expect(lumiverse.signIns).toBe(0);
      const bare = await up(ACCOUNT.password, ["--url", lumiverse.url, "--user", ACCOUNT.username, "--systemd"], [], { env: { PATH: "" }, options: m.options });
      expect(bare.code).toBe(0);
      expect(bare.err).toContain("there is no systemctl on this machine's PATH, so none is installed here");
      expect(bare.err).toContain("To keep RPE running here");
      expect(bare.out).toContain("RPE serves in the foreground now");
      // RPE's own copy is installed all the same, and the line to keep running is that copy's (R-13).
      expect(await Bun.file(join(bed.paths.root, "app", "current", "rpe.js")).exists()).toBe(true);
      expect(bare.err).toContain(join("app", "current", "rpe.js"));
    } finally {
      await m.remove();
    }
  });

  test("a later up waits for the turn under way to end before it restarts RPE's service, and restarts it at the end of service.drainWaitSeconds all the same", async () => {
    const m = await machine();
    try {
      const line = ["--url", lumiverse.url, "--user", ACCOUNT.username, "--systemd"];
      expect((await up(ACCOUNT.password, line, [], { env: m.env, options: m.options })).code).toBe(0);
      await writeFile(bed.paths.globalConfig, "service:\n  drainWaitSeconds: 3\nupdate:\n  lookEverySeconds: 1\n");
      let running = 1;
      const app = await bed.open({ config: { port, lumiverse: { url: lumiverse.url, user: ACCOUNT.id } }, areas: [{ name: "service", mount: (a) => a.routes.add("service", serviceRoutes(a)) }] });
      app.builds.counts(() => running);
      await app.start();
      // The turn ends a moment after: up waits for it, and does not wait the whole of drainWait.
      setTimeout(() => (running = 0), 300);
      const began = performance.now();
      const waited = await up(null, line, [], { env: m.env, options: m.options });
      expect(waited.code).toBe(0);
      expect(waited.out).toContain("RPE has 1 turn(s) or job(s) under way: waiting up to 3 s");
      expect(waited.out).not.toContain("all the same");
      expect(performance.now() - began).toBeLessThan(2900);
      // One that does not end is waited for as long as the setting says, and the service is restarted at its end all the same.
      running = 1;
      await writeFile(bed.paths.globalConfig, "service:\n  drainWaitSeconds: 1\nupdate:\n  lookEverySeconds: 1\n");
      const held = await up(null, line, [], { env: m.env, options: m.options });
      expect(held.out).toContain("1 still under way after 1 s: restarting RPE's service all the same.");
      expect((await m.calls()).match(/systemctl --user restart rpe-reader.service/g)?.length).toBe(3);
    } finally {
      await m.remove();
    }
  });

  test("a service name is held to systemd's rule for unit names and to no length of RPE's", async () => {
    expect(unitNameRefusal("reader")).toBeNull();
    expect(unitNameRefusal("a".repeat(100))).toBeNull();
    expect(unitNameRefusal("a".repeat(244))).toContain("255");
    expect(unitNameRefusal("two words")).toContain("ASCII letters");
    expect(serviceNameOf("A".repeat(100))).toBe("a".repeat(100));
    expect(unitNameRefusal(serviceNameOf("x".repeat(400)))).toBeNull();
  });
});
