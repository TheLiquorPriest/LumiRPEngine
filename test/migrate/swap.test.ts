// The swap and going back, through RPE's own command line: `rpe up` against the migration fixture,
// a stand-in for today's service (its runtime's `GET /healthz`, and the account's systemctl as a
// program on the PATH that writes down what it is asked), and a stand-in Lumiverse for the sign-in
// and the connections. `up` stops today's service only once it is idle, then backs up, migrates and
// starts RPE's service in its place; while today's build stays busy it stops and changes nothing; a
// second `up` duplicates nothing; it never changes today's own connection in Lumiverse; `down` stops
// and removes RPE's service and leaves its data; and today's storage keeps its checksums throughout.

import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CliIO, runCli } from "../../src/app/cli";
import { PREVIOUS_PERMISSIONS } from "../../src/migrate/going-back";
import { isRecord } from "../../src/shared/json";
import { buildFixture, IDENT, RUNTIME, STRAY, treeSums, USER, USERNAME, type Fixture } from "./fixture";

const PASSWORD = "invented swap password";
const TODAYS_CONNECTION = "conn-today";

interface Profile {
  id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  has_api_key: boolean;
}

interface LumiverseStandIn {
  url: string;
  connections: Map<string, Profile>;
  /** Every call that changes something, as `METHOD path`. */
  changes: string[];
  stop(): Promise<void>;
}

/** Lumiverse as `rpe up` meets it: the username sign-in and `get-session`, the connections routes, and the extensions list. Today's build's own connection is there already. */
function lumiverseStandIn(): LumiverseStandIn {
  const connections = new Map<string, Profile>([[TODAYS_CONNECTION, { id: TODAYS_CONNECTION, name: "LumiRPEngine", provider: "custom", api_url: "http://127.0.0.1:7861/v1", model: `lumiah-${IDENT}`, has_api_key: true }]]);
  const changes: string[] = [];
  const live = new Set<string>();
  let made = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const body: unknown = request.method === "POST" || request.method === "PUT" ? await request.json() : null;
      if (request.method === "POST" && pathname === "/api/auth/sign-in/username") {
        if (!isRecord(body) || body.username !== USERNAME || body.password !== PASSWORD) return Response.json({ message: "Invalid username or password" }, { status: 401 });
        const token = `invented-session-${live.size + 1}`;
        live.add(token);
        return Response.json({ token, user: { id: USER, username: USERNAME } });
      }
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (pathname === "/api/auth/get-session") return Response.json(live.has(token) ? { session: { token }, user: { id: USER } } : null);
      if (!live.has(token)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (request.method === "GET" && pathname === "/api/v1/spindle") return Response.json({ extensions: [{ identifier: IDENT, enabled: true }] });
      if (request.method !== "GET") changes.push(`${request.method} ${pathname}`);
      const shown = (p: Profile) => ({ ...p, preset_id: null, is_default: false, metadata: {}, created_at: 1, updated_at: 1 });
      if (request.method === "POST" && pathname === "/api/v1/connections" && isRecord(body)) {
        const p: Profile = { id: `connection-${++made}`, name: String(body.name), provider: String(body.provider), api_url: String(body.api_url ?? ""), model: String(body.model ?? ""), has_api_key: typeof body.api_key === "string" };
        connections.set(p.id, p);
        return Response.json(shown(p), { status: 201 });
      }
      const p = connections.get(/^\/api\/v1\/connections\/([^/]+)$/.exec(pathname)?.[1] ?? "");
      if (p === undefined) return Response.json({ error: "Not found" }, { status: 404 });
      if (request.method === "GET") return Response.json(shown(p));
      if (request.method === "PUT" && isRecord(body)) {
        Object.assign(p, body);
        return Response.json(shown(p));
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, connections, changes, stop: () => server.stop(true) };
}

describe("the swap, and going back", () => {
  let fixture: Fixture;
  let lumiverse: LumiverseStandIn;
  let health: Server<undefined>;
  /** What today's runtime says it has under way, one answer per ask; the last stays. */
  let answers: { turns: number; requests: number }[] = [];
  let data: string;
  let log: string;
  let home: string;
  let unitFolder: string;

  /** Today's storage and today's runtime's folders, by path and checksum: Lumiverse's data folder, and the runtime's config and data folders. */
  const todays = async (): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const [at, root] of [["lumiverse", fixture.sources.lumiverse], ["config", fixture.sources.runtime?.configDir ?? ""], ["data", fixture.sources.runtime?.dataDir ?? ""]] as const) for (const [path, sum] of await treeSums(root)) if (!path.endsWith(".db-shm")) out.set(`${at}/${path}`, sum);
    return out;
  };
  /** What the stand-ins were asked, in order: `health busy|idle` and `systemctl --user …`. */
  const asked = async (): Promise<string[]> => (existsSync(log) ? (await readFile(log, "utf8")).trimEnd().split("\n") : []);

  async function rpe(line: string[], more: Record<string, string> = {}): Promise<{ code: number; out: string }> {
    const lines: string[] = [];
    const io: CliIO = {
      out: (t) => lines.push(t),
      err: (t) => lines.push(t),
      env: { PATH: `${join(fixture.root, "bin")}:/usr/bin:/bin`, RPE_SWAP_LOG: log, XDG_RUNTIME_DIR: join(fixture.root, "run"), ...more },
      home,
      now: () => Date.UTC(2026, 10, 14, 12, 0, 0),
      secret: async () => PASSWORD,
      stopped: () => new Promise(() => {}),
      fetch: (url, init) => fetch(url, init),
    };
    const code = await runCli(line, io, { version: "test" });
    return { code, out: lines.join("\n") };
  }
  const up = (more: Record<string, string> = {}): Promise<{ code: number; out: string }> => rpe(["up", "--url", lumiverse.url, "--user", USERNAME, "--lumiverse", fixture.sources.lumiverse, "--data", data], more);

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    home = join(fixture.root, "home");
    unitFolder = join(home, ".config", "systemd", "user");
    data = join(fixture.root, "rpe-data");
    log = join(fixture.root, "asked.log");
    lumiverse = lumiverseStandIn();
    health = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname !== "/healthz") return new Response(null, { status: 404 });
        const now = (answers.length > 1 ? answers.shift() : answers[0]) ?? { turns: 0, requests: 0 };
        appendFileSync(log, `health ${now.turns + now.requests > 0 ? "busy" : "idle"}\n`);
        return Response.json({ ok: true, link: "up", backend: "LumiRPEngine", turns: now.turns, requests: now.requests });
      },
    });
    // Today's runtime listens where the stand-in answers, and waits for replies as its own settings say: 1.5 seconds, asking every half second.
    const configFile = join(fixture.sources.runtime?.configDir ?? "", `${RUNTIME}.json`);
    const config = JSON.parse(await readFile(configFile, "utf8")) as { runtime: Record<string, unknown> };
    Object.assign(config.runtime, { port: health.port, tuning: { drainMs: 1500, drainPollMs: 500 } });
    await writeFile(configFile, JSON.stringify(config, null, 2));
    // The account's systemctl: writes down what it is asked. Told to, it plays today's build writing a file no row names as its service stops.
    await mkdir(join(fixture.root, "bin"), { recursive: true });
    await writeFile(join(fixture.root, "bin", "systemctl"), '#!/bin/sh\necho "systemctl $*" >> "$RPE_SWAP_LOG"\nif [ "$*" = "--user stop lumiah-home.service" ] && [ -n "$RPE_SWAP_STRAY" ]; then echo "written as it stopped" > "$RPE_SWAP_STRAY"; fi\n');
    await chmod(join(fixture.root, "bin", "systemctl"), 0o755);
    // RPE's config names today's own connection, as a user might have set it by hand.
    await mkdir(data, { recursive: true });
    const port = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    await writeFile(join(data, "config.json"), JSON.stringify({ port: port.port, lumiverse: { connection: TODAYS_CONNECTION } }));
    void port.stop(true);
  });

  afterAll(async () => {
    await health.stop(true);
    await lumiverse.stop();
    await fixture.remove();
  });

  test("while today's build stays busy, `rpe up` stops nothing and changes nothing of today's, nor today's own connection in Lumiverse", async () => {
    answers = [{ turns: 1, requests: 1 }];
    const before = await todays();
    const { code, out } = await up();
    expect(code).toBe(1);
    expect(out).toContain(`Today's runtime ${RUNTIME} still has 1 turn(s) and 1 request(s) under way after 2 seconds: nothing was stopped or changed.`);
    expect((await asked()).filter((line) => line.startsWith("systemctl"))).toEqual([]);
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    expect(existsSync(join(data, "backups")) ? (await treeSums(join(data, "backups"))).size : 0).toBe(0);
    expect(await todays()).toEqual(before);
    // RPE's config named today's own connection: RPE made its own beside it, and today's was never changed.
    expect(out).toContain(`The connection ${TODAYS_CONNECTION} that RPE's config named is the one today's build made for its runtime: it is left as it is, for going back.`);
    expect(lumiverse.changes).toEqual(["POST /api/v1/connections"]);
    expect(lumiverse.connections.get(TODAYS_CONNECTION)).toMatchObject({ api_url: "http://127.0.0.1:7861/v1", model: `lumiah-${IDENT}` });
  });

  test("a run that doesn't go through once today's service is stopped starts that service again, and removes nothing", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 0, requests: 0 }];
    const stray = join(fixture.userFolder, STRAY);
    const { code, out } = await up({ RPE_SWAP_STRAY: stray });
    expect(code).toBe(1);
    expect(await asked()).toEqual(["health idle", "systemctl --user stop lumiah-home.service", "systemctl --user start lumiah-home.service"]);
    expect(out).toContain(`found, not classified: user storage: ${STRAY}`);
    expect(out).toContain("The swap did not go through. lumiah-home.service run(s) again, as before. Nothing of today's was changed.");
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    await rm(stray);
  });

  test("once today's build is idle, `rpe up` stops today's service, backs up, migrates, removes it and starts RPE's in its place", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 1, requests: 0 }, { turns: 0, requests: 1 }, { turns: 0, requests: 0 }];
    const before = await todays();
    const { code, out } = await up();
    expect(code).toBe(0);
    const unit = `rpe-${USERNAME}.service`;
    // Stopped only after it said it was idle; removed only after the run went through; RPE's started last.
    expect(await asked()).toEqual(["health busy", "health busy", "health idle", "systemctl --user stop lumiah-home.service", "systemctl --user disable lumiah-home.service", "systemctl --user daemon-reload", "systemctl --user daemon-reload", `systemctl --user enable ${unit}`, `systemctl --user restart ${unit}`]);
    expect(out).toContain("Migration real run");
    expect(out).toContain("Today's runtime: took home, registered with this Lumiverse for this user");
    expect(out).toMatch(/Backup taken: .*rpe-data\/backups\//);
    expect(out).toContain(`Started ${unit}, RPE's service, in the place of lumiah-home.service.`);
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(false);
    const text = await readFile(join(unitFolder, unit), "utf8");
    expect(text).toContain(`# RPE's data folder: ${data}`);
    expect(text).toContain(`serve --data ${data}`);
    // Today's storage and today's runtime's folders as they were; nothing more asked of Lumiverse.
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual(["POST /api/v1/connections"]);
  });

  let chats = 0;

  test("a second `rpe up` migrates again with RPE's service stopped meanwhile, and duplicates nothing", async () => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      chats = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM chat WHERE user = ?").get(USER)?.n ?? -1;
    } finally {
      db.close();
    }
    await rm(log, { force: true });
    await health.stop(true);
    const before = await todays();
    const { code } = await up();
    expect(code).toBe(0);
    const unit = `rpe-${USERNAME}.service`;
    expect(await asked()).toEqual([`systemctl --user stop ${unit}`, "systemctl --user daemon-reload", `systemctl --user enable ${unit}`, `systemctl --user restart ${unit}`]);
    const again = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      expect(again.query<{ n: number }, [string]>("SELECT count(*) AS n FROM chat WHERE user = ?").get(USER)?.n).toBe(chats);
      expect(again.query<{ n: number }, [string]>("SELECT count(*) AS n FROM migration_run WHERE user = ?").get(USER)?.n).toBe(2);
    } finally {
      again.close();
    }
    expect(await todays()).toEqual(before);
  });

  test("`rpe down` stops and removes RPE's service, leaves its data where it is, and gives the four steps of going back with the permissions by name", async () => {
    await rm(log, { force: true });
    const keep = async (): Promise<Map<string, string>> => new Map([...(await treeSums(data))].filter(([path]) => !path.endsWith(".db-shm")));
    const [dataBefore, before] = [await keep(), await todays()];
    const { code, out } = await rpe(["down", "--data", data]);
    expect(code).toBe(0);
    const unit = `rpe-${USERNAME}.service`;
    expect(await asked()).toEqual([`systemctl --user disable --now ${unit}`, "systemctl --user daemon-reload"]);
    expect(existsSync(join(unitFolder, unit))).toBe(false);
    expect(await keep()).toEqual(dataBefore);
    expect(await todays()).toEqual(before);
    expect(out).toContain(`Stopped and removed ${unit}. RPE's data stays where it is, in ${data}.`);
    expect(out).toContain(`switch the installed extension (${IDENT}) to the branch the previous build is kept on`);
    expect(out).toContain(`approve the permissions the previous build asks for, then switch the extension off and on again, so that it starts with them in hand: ${PREVIOUS_PERMISSIONS.join(", ")}.`);
    expect(out).toContain(`bun <the extension's folder>/dist/lumiah.js up --name ${RUNTIME} --systemd`);
    // A second `rpe down` has nothing to stop, and says so.
    expect((await rpe(["down", "--data", data])).out).toContain(`RPE has no service for the data folder ${data}: nothing to stop.`);
  });
});
