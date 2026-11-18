// The swap and going back, through RPE's own command line: `rpe up` against the migration fixture, a
// stand-in for the address today's runtime listens on (its `GET /healthz` while today's service runs,
// RPE's status once RPE's service runs), the account's systemctl as a program on the PATH that writes
// down what it is asked and starts and stops those two, and a stand-in Lumiverse for the sign-in, the
// connections and the extensions list. `up` stops today's service only once it is idle, then backs up
// and migrates; RPE takes today's loopback (its address, its model name, its key), so today's
// connection, never changed, reaches RPE; RPE's service starts in today's place, and today's is
// switched off only once RPE answers. A failure from the stop on puts back what was done. A second
// `up` waits for nothing and duplicates nothing; `down` stops and removes RPE's service and leaves its
// data; and today's storage keeps its checksums throughout.

import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type App, lineLog, openApp, rawRoute } from "../../src/app";
import { type CliIO, runCli } from "../../src/app/cli";
import { dataPaths, loadConfig } from "../../src/app/config";
import { sha256 } from "../../src/migrate/files";
import { PREVIOUS_PERMISSIONS } from "../../src/migrate/going-back";
import { isRecord } from "../../src/shared/json";
import { buildFixture, IDENT, OTHER_USER, RUNTIME, STRAY, treeSums, USER, USERNAME, type Fixture } from "./fixture";

const PASSWORD = "invented swap password";
const TODAYS_CONNECTION = "conn-today";
/** The call that marks today's connection as RPE's, and (the same call) takes the mark off; what the put-back says of it. */
const MARKED = `PUT /api/v1/connections/${TODAYS_CONNECTION}`;
const MARK_OFF = `the mark on "LumiRPEngine" (${TODAYS_CONNECTION}) is taken off`;
/** The loopback key whose hash the fixture's registry holds, and the model name today's connection names. */
const LOOPBACK_KEY = "lah_key";
const TODAYS_MODEL = `lumiah-${IDENT}`;
const UNIT = `rpe-${USERNAME}.service`;
/** The light build's manifest asks for these (`spindle.json`). */
const LIGHT = ["interceptor", "generation_parameters", "generation", "cors_proxy", "ui_panels"];
/** The fixture's other Lumiverse user, by the name it signs in with: theirs is the same invented password. */
const OTHER_NAME = "someone-else";
const ACCOUNTS: Readonly<Record<string, string>> = { [USERNAME]: USER, [OTHER_NAME]: OTHER_USER };
/** Today's service unit, as an older `lumiah up --systemd` wrote it: the only place its memory cap is kept. */
const TODAYS_UNIT = "[Service]\nExecStart=/opt/bun/bin/bun lumiah.js serve\nMemoryMax=3G\n";
/** The build this rpe is, as the tests run it. */
const BUILD = "test";
/** A backend file as the build stamps one, as far as its build goes: `scripts/build.ts` writes the id in where the code reads it. */
const backendOf = (build: string): string => `// @bun\nfunction pipeOptions(options) {\n  return { build: options.build ?? ${JSON.stringify(build)} ?? "dev" };\n}\n`;
/** Lumiverse's id for the installed extension, as its list gives it beside the identifier. */
const EXTENSION_ID = "ext-installed-1";

interface Profile {
  id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  has_api_key: boolean;
  /** What a connection holds of its own; Lumiverse replaces it whole when it is updated. */
  metadata?: Record<string, unknown>;
}

interface LumiverseStandIn {
  url: string;
  connections: Map<string, Profile>;
  /** What Lumiverse says the installed extension's manifest asks for, and the permissions it has granted it. */
  extension: { permissions: string[]; granted: string[] };
  /** Every call that changes something, as `METHOD path`. */
  changes: string[];
  stop(): Promise<void>;
}

/** Lumiverse as `rpe up` meets it: the username sign-in and `get-session`, the connections routes, and the extensions list. Today's build's own connection is there already, at `todaysUrl`. */
function lumiverseStandIn(todaysUrl: string): LumiverseStandIn {
  const connections = new Map<string, Profile>([[TODAYS_CONNECTION, { id: TODAYS_CONNECTION, name: "LumiRPEngine", provider: "custom", api_url: todaysUrl, model: TODAYS_MODEL, has_api_key: true }]]);
  const extension = { permissions: [...LIGHT], granted: [...LIGHT] };
  const changes: string[] = [];
  /** Live session tokens, by the user each signs in as. */
  const live = new Map<string, string>();
  let made = 0;
  const shown = (p: Profile) => ({ ...p, preset_id: null, is_default: false, metadata: p.metadata ?? {}, created_at: 1, updated_at: 1 });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const body: unknown = request.method === "POST" || request.method === "PUT" ? await request.json() : null;
      if (request.method === "POST" && pathname === "/api/auth/sign-in/username") {
        const id = isRecord(body) && typeof body.username === "string" ? ACCOUNTS[body.username] : undefined;
        if (!isRecord(body) || id === undefined || body.password !== PASSWORD) return Response.json({ message: "Invalid username or password" }, { status: 401 });
        const token = `invented-session-${live.size + 1}`;
        live.set(token, id);
        return Response.json({ token, user: { id, username: body.username } });
      }
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (pathname === "/api/auth/get-session") return Response.json(live.has(token) ? { session: { token }, user: { id: live.get(token) } } : null);
      if (!live.has(token)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (request.method === "GET" && pathname === "/api/v1/spindle") return Response.json({ extensions: [{ id: EXTENSION_ID, identifier: IDENT, enabled: true, permissions: extension.permissions }] });
      if (request.method === "GET" && pathname === `/api/v1/spindle/${EXTENSION_ID}/permissions`) return Response.json({ granted: extension.granted });
      if (request.method !== "GET") changes.push(`${request.method} ${pathname}`);
      if (request.method === "GET" && pathname === "/api/v1/connections") return Response.json({ data: [...connections.values()].map(shown), total: connections.size, limit: 50, offset: 0 });
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
  return { url: `http://127.0.0.1:${server.port}`, connections, extension, changes, stop: () => server.stop(true) };
}

/**
 * The account's systemctl: writes down what it is asked, and plays the two services on the one
 * address: today's runs while its flag file is there, and is started at boot while its "on" file is;
 * RPE's runs while its flag file is there. Told to, it plays today's build writing a file no row
 * names as its service stops, RPE failing to come up, and the terminal closing as one call is made.
 * A terminal hangs up its whole foreground process group: the command line, and the systemctl it
 * waits on, which dies (as the manager goes on with the job it was given). The stand-in signals those
 * two alone, not the group, which in a test run may hold the shell that started it.
 */
const SYSTEMCTL = `#!/bin/sh
echo "systemctl $*" >> "$RPE_SWAP_LOG"
case "$*" in
  "--user is-active --quiet lumiah-home.service") [ -e "$RPE_SWAP_TODAY" ] || exit 3 ;;
  "--user is-enabled --quiet lumiah-home.service") [ -e "$RPE_SWAP_TODAY_ON" ] || exit 1 ;;
  "--user is-active --quiet rpe-"*) [ -e "$RPE_SWAP_RPE" ] || exit 3 ;;
  "--user stop lumiah-home.service")
    rm -f "$RPE_SWAP_TODAY"
    if [ -n "$RPE_SWAP_STRAY" ]; then echo "written as it stopped" > "$RPE_SWAP_STRAY"; fi ;;
  "--user start lumiah-home.service") touch "$RPE_SWAP_TODAY" ;;
  "--user disable lumiah-home.service") rm -f "$RPE_SWAP_TODAY_ON" ;;
  "--user enable lumiah-home.service") touch "$RPE_SWAP_TODAY_ON" ;;
  "--user restart rpe-"*|"--user start rpe-"*) if [ -z "$RPE_SWAP_RPE_FAILS" ]; then touch "$RPE_SWAP_RPE"; fi ;;
  "--user stop rpe-"*|"--user disable --now rpe-"*) rm -f "$RPE_SWAP_RPE" ;;
esac
if [ -n "$RPE_SWAP_HANGUP" ] && [ "$*" = "--user $RPE_SWAP_HANGUP" ]; then kill -HUP "$PPID"; sleep 0.2; kill -HUP "$$"; fi
`;

describe("the swap, and going back", () => {
  let fixture: Fixture;
  let lumiverse: LumiverseStandIn;
  let place: Server<undefined>;
  /** What today's runtime says it has under way, one answer per ask; the last stays. */
  let answers: { turns: number; requests: number }[] = [];
  let data: string;
  let log: string;
  /** The backups the real run made before the swap left in RPE's data folder: the swap goes ahead only after a real run of his data has passed (§15.3 step 10). */
  let backupsBefore = 0;
  let home: string;
  let unitFolder: string;
  let flags: { today: string; todayOn: string; rpe: string };
  /** The port RPE's config names before the swap. */
  let ownPort: number;

  /** Today's storage and today's runtime's folders, by path and checksum: Lumiverse's data folder, and the runtime's config and data folders. */
  const todays = async (): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const [at, root] of [["lumiverse", fixture.sources.lumiverse], ["config", fixture.sources.runtime?.configDir ?? ""], ["data", fixture.sources.runtime?.dataDir ?? ""]] as const) for (const [path, sum] of await treeSums(root)) if (!path.endsWith(".db-shm")) out.set(`${at}/${path}`, sum);
    return out;
  };
  /** What the stand-ins were asked, in order: `health busy|idle` and `systemctl --user …`. */
  const asked = async (): Promise<string[]> => (existsSync(log) ? (await readFile(log, "utf8")).trimEnd().split("\n") : []);
  const rpeConfig = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(data, "config.json"), "utf8"));
  /** The provider keys in force in RPE's database, by hash. */
  const providerKeys = (): string[] => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      return db.query<{ hash: string }, []>("SELECT hash FROM provider_key").all().map((r) => r.hash);
    } finally {
      db.close();
    }
  };

  /** The build the light extension said at its last registration, as RPE's builds route gives it; null before it registered. */
  let registered: string | null = BUILD;
  /** RPE's own command socket, while RPE's service runs: its status, its builds as `rpe up` waits on them, and the few things the swap's last lines ask. Nothing answers there while it does not run. */
  function onSocket(url: string): Response {
    if (!existsSync(flags.rpe) || existsSync(flags.today)) throw new TypeError(`Unable to connect to ${url}`);
    const path = new URL(url).pathname;
    if (path === "/api/v1/status") return Response.json({ name: "rpe", version: BUILD });
    if (path === "/api/v1/status/builds") return Response.json({ name: "rpe", version: BUILD, started: 1, builds: { running: BUILD, disk: BUILD, broken: null, extension: registered, agree: true, restart: "none", words: "" } });
    if (path === "/api/v1/command/status") return Response.json({ keys: [{ kind: "web", last4: null, made: 1, ends: null, taken: false }], switches: [], builds: null });
    if (path === "/api/v1/connections") return Response.json({ connections: [] });
    return Response.json({ error: `No ${path}.` }, { status: 404 });
  }

  async function rpe(line: string[], more: Record<string, string> = {}): Promise<{ code: number; out: string }> {
    const lines: string[] = [];
    const io: CliIO = {
      out: (t) => lines.push(t),
      err: (t) => lines.push(t),
      env: { PATH: `${join(fixture.root, "bin")}:/usr/bin:/bin`, RPE_SWAP_LOG: log, RPE_SWAP_TODAY: flags.today, RPE_SWAP_TODAY_ON: flags.todayOn, RPE_SWAP_RPE: flags.rpe, XDG_RUNTIME_DIR: join(fixture.root, "run"), ...more },
      home,
      now: () => Date.UTC(2026, 10, 14, 12, 0, 0),
      secret: async () => PASSWORD,
      ask: async () => null,
      stopped: () => new Promise(() => {}),
      // Nothing listens at today's address while neither service runs there: a call to it can't connect.
      fetch: (url, init) => {
        if ((init as { unix?: string } | undefined)?.unix !== undefined) {
          try {
            return Promise.resolve(onSocket(url));
          } catch (error) {
            return Promise.reject(error);
          }
        }
        return url.startsWith(`http://127.0.0.1:${place.port}/`) && !existsSync(flags.today) && !existsSync(flags.rpe) ? Promise.reject(new TypeError(`Unable to connect to ${url}`)) : fetch(url, init);
      },
    };
    // RPE's command socket is a file the command line looks for before it asks (`onSocket` answers on it only while RPE's service runs).
    const socket = join(data, "command.sock");
    await writeFile(socket, "");
    let code: number;
    try {
      code = await runCli(line, io, { version: BUILD, appFile: join(fixture.root, "build", "rpe.js") });
    } finally {
      await rm(socket, { force: true });
    }
    return { code, out: lines.join("\n") };
  }
  const up = (more: Record<string, string> = {}, line: string[] = []): Promise<{ code: number; out: string }> => rpe(["up", "--url", lumiverse.url, "--user", USERNAME, "--lumiverse", fixture.sources.lumiverse, "--data", data, ...line], more);

  /** The address today's runtime listens on: its health while today's service runs, RPE's status while RPE's does. */
  const serve = (port: number): Server<undefined> =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/healthz" && existsSync(flags.today)) {
          const now = (answers.length > 1 ? answers.shift() : answers[0]) ?? { turns: 0, requests: 0 };
          appendFileSync(log, `health ${now.turns + now.requests > 0 ? "busy" : "idle"}\n`);
          return Response.json({ ok: true, link: "up", backend: "LumiRPEngine", turns: now.turns, requests: now.requests });
        }
        if (path === "/api/v1/status" && existsSync(flags.rpe) && !existsSync(flags.today)) return Response.json({ name: "rpe", version: "test", started: 1, belongsToUser: true });
        return Response.json({ error: `No ${request.method} ${path}.` }, { status: 404 });
      },
    });

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    home = join(fixture.root, "home");
    unitFolder = join(home, ".config", "systemd", "user");
    data = join(fixture.root, "rpe-data");
    log = join(fixture.root, "asked.log");
    flags = { today: join(fixture.root, "today-runs"), todayOn: join(fixture.root, "today-on"), rpe: join(fixture.root, "rpe-runs") };
    await writeFile(flags.today, "");
    await writeFile(flags.todayOn, "");
    place = serve(0);
    lumiverse = lumiverseStandIn(`http://127.0.0.1:${place.port}/v1`);
    // Today's runtime listens where the stand-in answers, and waits for replies as its own settings say: 1.5 seconds, asking every half second.
    const configFile = join(fixture.sources.runtime?.configDir ?? "", `${RUNTIME}.json`);
    const config = JSON.parse(await readFile(configFile, "utf8")) as { runtime: Record<string, unknown> };
    // Its config is one written before `lumiah up --systemd` recorded its unit there: the unit is found where that line put it, and holds the memory cap alone.
    Object.assign(config.runtime, { port: place.port, tuning: { drainMs: 1500, drainPollMs: 500 }, service: null });
    await writeFile(configFile, JSON.stringify(config, null, 2));
    await writeFile(join(unitFolder, "lumiah-home.service"), TODAYS_UNIT);
    await mkdir(join(fixture.root, "bin"), { recursive: true });
    await writeFile(join(fixture.root, "bin", "systemctl"), SYSTEMCTL);
    await chmod(join(fixture.root, "bin", "systemctl"), 0o755);
    // RPE's config names today's own connection, as a user might have set it by hand, and a port of its own; it gives RPE a second to come up.
    await mkdir(data, { recursive: true });
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    ownPort = probe.port ?? 0;
    void probe.stop(true);
    await writeFile(join(data, "config.json"), JSON.stringify({ port: ownPort, commandLine: { waitMs: 200, startMs: 1000 }, lumiverse: { connection: TODAYS_CONNECTION, user: USER } }));
    // The extension's backend where Lumiverse loads it from, switched to this build.
    const repo = join(fixture.sources.lumiverse, "extensions", IDENT, "repo");
    await mkdir(join(repo, "dist"), { recursive: true });
    await writeFile(join(repo, "dist", "backend.js"), backendOf(BUILD));
    // The app file this rpe runs from, with the folders it reads beside it: the swap starts RPE's service on a copy of it (PlanOps-3).
    await mkdir(join(fixture.root, "build", "guidance"), { recursive: true });
    await mkdir(join(fixture.root, "build", "guidance-harness"), { recursive: true });
    await writeFile(join(fixture.root, "build", "rpe.js"), "// the app, as built\n");
    await writeFile(join(fixture.root, "build", "guidance", "a.md"), "shipped");
    // A real run of his own data has passed here: `rpe migrate` makes it, and the swap's own run comes after it.
    const proven = await rpe(["migrate", "--lumiverse", fixture.sources.lumiverse, "--user", USER, "--data", data]);
    if (proven.code !== 0) throw new Error(`the real run before the switch stopped: ${proven.out}`);
    backupsBefore = (await treeSums(join(data, "backups"))).size;
  });

  afterAll(async () => {
    await place.stop(true);
    await lumiverse.stop();
    await fixture.remove();
  });

  test("while Lumiverse still has today's build of the extension installed, `rpe up` refuses before it reads, stops or changes anything", async () => {
    lumiverse.extension.permissions = [...PREVIOUS_PERMISSIONS];
    try {
      const before = await todays();
      const { code, out } = await up();
      expect(code).toBe(1);
      expect(out).toContain(`Lumiverse still has the previous build of the extension (${IDENT}) installed: its manifest asks for the permissions the previous build asks for. Switch the installed extension to the new build's branch in Lumiverse and approve its permissions first, then run rpe up again. Nothing was stopped or changed.`);
      // Not even today's runtime was asked whether it is busy.
      expect(await asked()).toEqual([]);
      expect((await treeSums(join(data, "backups"))).size).toBe(backupsBefore);
      expect(await todays()).toEqual(before);
      expect(lumiverse.changes).toEqual([]);
    } finally {
      lumiverse.extension.permissions = [...LIGHT];
    }
  });

  test("while the extension's backend is another build than this rpe, under the light build's manifest, `rpe up` refuses before it reads, stops or changes anything", async () => {
    // The branch was switched to a commit whose dist/ was not built again: Lumiverse loads today's backend as it is.
    const backend = join(fixture.sources.lumiverse, "extensions", IDENT, "repo", "dist", "backend.js");
    await writeFile(backend, `// @bun\nvar BUILD = "9f8e7d6c";\n`);
    try {
      const before = await todays();
      const { code, out } = await up();
      expect(code).toBe(1);
      expect(out).toContain(`The extension Lumiverse has installed (${IDENT}) is another build than this rpe (${BUILD}): its backend, ${backend}, does not carry build ${BUILD}. Switch the installed extension to the new build's branch in Lumiverse, or put the new build's files in its folder (${join(fixture.sources.lumiverse, "extensions", IDENT, "repo")}) and switch the extension off and on in Lumiverse so that it runs them, then run rpe up again.`);
      // Lumiverse runs the light extension by now: what has changed and the way back are said.
      expect(out).toContain(`What has changed: Lumiverse runs the new build of the extension (${IDENT}) now`);
      expect(out).toContain(PREVIOUS_PERMISSIONS.join(", "));
      expect(await asked()).toEqual([]);
      expect((await treeSums(join(data, "backups"))).size).toBe(backupsBefore);
      expect(await todays()).toEqual(before);
      expect(lumiverse.changes).toEqual([]);
    } finally {
      await writeFile(backend, backendOf(BUILD));
    }
  });

  test("where no runtime of today's is taken and something other than RPE answers where RPE's config has it answer, `rpe up` refuses before it stops anything", async () => {
    const other = Bun.serve({ hostname: "127.0.0.1", port: ownPort, fetch: () => new Response("Not here.", { status: 404 }) });
    try {
      const before = await todays();
      const { code, out } = await up({}, ["--no-runtime"]);
      expect(code).toBe(1);
      expect(out).toContain(`Something other than RPE answers at http://127.0.0.1:${ownPort}, where RPE's config has it answer: give RPE a free port ("port" in its config, or RPE_PORT), and run rpe up again.`);
      expect(out).toContain(`What has changed: Lumiverse runs the new build of the extension (${IDENT}) now`);
      expect(await asked()).toEqual([]);
      expect((await treeSums(join(data, "backups"))).size).toBe(backupsBefore);
      expect(await todays()).toEqual(before);
      expect(lumiverse.changes).toEqual([]);
    } finally {
      await other.stop(true);
    }
  });

  test("while today's build stays busy, `rpe up` stops nothing and changes nothing of today's, nor anything in Lumiverse", async () => {
    answers = [{ turns: 1, requests: 1 }];
    const before = await todays();
    const { code, out } = await up();
    expect(code).toBe(1);
    expect(out).toContain(`The previous runtime ${RUNTIME} still has 1 turn(s) and 1 request(s) under way after 2 seconds, and the switch stops nothing while it is busy. Run rpe up again once it is idle.`);
    expect(out).toContain(`What has changed: Lumiverse runs the new build of the extension (${IDENT}) now`);
    expect((await asked()).filter((line) => line.startsWith("systemctl"))).toEqual([]);
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    expect((await treeSums(join(data, "backups"))).size).toBe(backupsBefore);
    expect(await todays()).toEqual(before);
    // Today's connection is the one RPE will take over as it is: nothing is made beside it, and it is never changed.
    expect(lumiverse.changes).toEqual([]);
    expect(lumiverse.connections.get(TODAYS_CONNECTION)).toMatchObject({ api_url: `http://127.0.0.1:${place.port}/v1`, model: TODAYS_MODEL, has_api_key: true });
  });

  test("a run that doesn't go through once today's service is stopped starts that service again, and removes nothing", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 0, requests: 0 }];
    const stray = join(fixture.userFolder, STRAY);
    const before = await todays();
    const { code, out } = await up({ RPE_SWAP_STRAY: stray });
    expect(code).toBe(1);
    expect(await asked()).toEqual(["health idle", "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user stop lumiah-home.service", "systemctl --user start lumiah-home.service"]);
    expect(out).toContain(`found, not classified: user storage: ${STRAY}`);
    expect(out).toContain("The switch did not go through: the run was refused, as the report says.");
    expect(out).toContain("Put back as it was: lumiah-home.service runs again.");
    expect(out).toContain("Nothing of the previous build's was changed.");
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    expect(existsSync(flags.today)).toBe(true);
    // Past the file today's build wrote as it stopped, today's storage is as it was.
    await rm(stray);
    expect(await todays()).toEqual(before);
  });

  test("when RPE doesn't answer once its service is started, today's service runs again and RPE's is removed, its config as it was", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 0, requests: 0 }];
    const [configBefore, before] = [await readFile(join(data, "config.json"), "utf8"), await todays()];
    const { code, out } = await up({ RPE_SWAP_RPE_FAILS: "1" });
    expect(code).toBe(1);
    expect(await asked()).toEqual(["health idle", "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user stop lumiah-home.service", "systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`, `systemctl --user disable --now ${UNIT}`, "systemctl --user daemon-reload", "systemctl --user start lumiah-home.service"]);
    expect(out).toContain(`The switch did not go through: RPE did not answer at http://127.0.0.1:${place.port} within 1 seconds of its service starting`);
    expect(out).toContain(`Put back as it was: ${UNIT} is removed; ${MARK_OFF}; RPE's config is as it was; the switch's record is taken out; lumiah-home.service runs again.`);
    // Today's build answers again; RPE's service is gone; nothing of today's changed.
    expect(existsSync(flags.today)).toBe(true);
    expect(existsSync(join(unitFolder, UNIT))).toBe(false);
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    expect(await readFile(join(data, "config.json"), "utf8")).toBe(configBefore);
    expect(await todays()).toEqual(before);
    // The connection was marked as RPE's before RPE's service started, and the mark is off again.
    expect(lumiverse.changes).toEqual([MARKED, MARKED]);
    expect(lumiverse.connections.get(TODAYS_CONNECTION)?.metadata ?? {}).toEqual({});
    lumiverse.changes.length = 0;
  });

  test("told to stop as it stops today's service (a closed terminal), the swap ends there and starts today's service again, changing nothing", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 0, requests: 0 }];
    const [configBefore, before] = [await readFile(join(data, "config.json"), "utf8"), await todays()];
    const { code, out } = await up({ RPE_SWAP_HANGUP: "stop lumiah-home.service" });
    expect(code).toBe(1);
    expect(out).toContain(`The previous runtime ${RUNTIME} stops now, and RPE answers in its place once the migration has run again: do not interrupt the switch. Interrupted all the same, it puts back what it did before it ends.`);
    expect(out).toContain("Told to stop (SIGHUP): the switch ends once the step under way is done, and puts back what it did.");
    expect(out).toContain("The switch did not go through: it was told to stop (SIGHUP).");
    expect(out).toContain("Put back as it was: lumiah-home.service runs again.");
    expect(await asked()).toEqual(["health idle", "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user stop lumiah-home.service", "systemctl --user start lumiah-home.service"]);
    expect(existsSync(flags.today)).toBe(true);
    expect(existsSync(join(unitFolder, UNIT))).toBe(false);
    expect(await readFile(join(data, "config.json"), "utf8")).toBe(configBefore);
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
  });

  test("told to stop once RPE's service is started and before today's is switched off, the swap removes RPE's service, puts its config back and starts today's again", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 0, requests: 0 }];
    const [configBefore, before] = [await readFile(join(data, "config.json"), "utf8"), await todays()];
    const { code, out } = await up({ RPE_SWAP_HANGUP: `restart ${UNIT}` });
    expect(code).toBe(1);
    expect(out).toContain("The switch did not go through: it was told to stop (SIGHUP).");
    expect(out).toContain(`Put back as it was: ${UNIT} is removed; ${MARK_OFF}; RPE's config is as it was; the switch's record is taken out; lumiah-home.service runs again.`);
    expect(await asked()).toEqual(["health idle", "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user stop lumiah-home.service", "systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`, `systemctl --user disable --now ${UNIT}`, "systemctl --user daemon-reload", "systemctl --user start lumiah-home.service"]);
    // Never both on: today's unit runs, and is still started at boot; RPE's is gone.
    expect(existsSync(flags.today)).toBe(true);
    expect(existsSync(flags.todayOn)).toBe(true);
    expect(existsSync(join(unitFolder, UNIT))).toBe(false);
    expect(await readFile(join(data, "config.json"), "utf8")).toBe(configBefore);
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([MARKED, MARKED]);
    expect(lumiverse.connections.get(TODAYS_CONNECTION)?.metadata ?? {}).toEqual({});
    lumiverse.changes.length = 0;
  });

  test("once today's build is idle, `rpe up` stops today's service, migrates, has RPE take today's loopback and start in its place, and only then switches today's off", async () => {
    await rm(log, { force: true });
    answers = [{ turns: 1, requests: 0 }, { turns: 0, requests: 1 }, { turns: 0, requests: 0 }];
    const before = await todays();
    const { code, out } = await up();
    expect(code).toBe(0);
    // Stopped only after it said it was idle; switched off only after RPE answered in its place.
    expect(await asked()).toEqual(["health busy", "health busy", "health idle", "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user stop lumiah-home.service", "systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`, "systemctl --user disable lumiah-home.service"]);
    expect(out).toContain("Migration real run");
    expect(out).toContain("The previous runtime: took home, registered with this Lumiverse for this user");
    // Today's unit, which the config doesn't name, is backed up whole, and left where today's install line finds it.
    const backup = /Backup taken: (\S+) \(/.exec(out)?.[1] ?? "";
    expect(backup).toContain(join(data, "backups"));
    const entries = await new Bun.Archive(await Bun.file(backup).bytes()).files();
    const kept = [...entries].filter(([name]) => name.endsWith("unit/lumiah-home.service"));
    expect(kept.length).toBe(1);
    expect(await kept[0]?.[1].text()).toBe(TODAYS_UNIT);
    expect(await readFile(join(unitFolder, "lumiah-home.service"), "utf8")).toBe(TODAYS_UNIT);
    expect(out).toContain(`RPE answers on "LumiRPEngine" (${TODAYS_CONNECTION}), a connection in Lumiverse that reached the previous runtime, under its model name (${TODAYS_MODEL}): it is left as it is`);
    expect(out).toContain(`Started ${UNIT}, RPE's service: RPE answers at http://127.0.0.1:${place.port}, where the previous runtime home did, under its model name (${TODAYS_MODEL}) and with its key.`);
    expect(out).toContain("Stopped and switched off lumiah-home.service, the previous build's service.");
    // No new connection to choose chat by chat: the chats on today's connection are RPE's now.
    expect(out).not.toContain("choose the connection");
    const text = await readFile(join(unitFolder, UNIT), "utf8");
    expect(text).toContain(`# RPE's data folder: ${data}`);
    expect(text).toContain(`serve --data ${data}`);
    // RPE listens where today's runtime did, answers to its model name, and its connection in Lumiverse is today's.
    expect(await rpeConfig()).toMatchObject({ address: "127.0.0.1", port: place.port, lumiverse: { connections: [TODAYS_CONNECTION], models: ["rpe", TODAYS_MODEL] } });
    expect(providerKeys()).toContain(sha256(LOOPBACK_KEY));
    // Today's storage and today's runtime's folders as they were; in Lumiverse only the one key of the connection's metadata, RPE's mark, was written, and nothing else of it.
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([MARKED]);
    expect(lumiverse.connections.get(TODAYS_CONNECTION)?.metadata).toEqual({ rpe: { v: 1 } });
    lumiverse.changes.length = 0;
    expect(lumiverse.connections.get(TODAYS_CONNECTION)).toMatchObject({ api_url: `http://127.0.0.1:${place.port}/v1`, model: TODAYS_MODEL, has_api_key: true });
  });

  test("another Lumiverse user's swap into this RPE is refused once Lumiverse has taken the password, before anything is written", async () => {
    await rm(log, { force: true });
    const keep = async (root: string): Promise<Map<string, string>> => new Map([...(await treeSums(root))].filter(([path]) => !path.endsWith(".db-shm")));
    const [dataBefore, before] = [await keep(data), await todays()];
    const other = (folder: string) => rpe(["up", "--url", lumiverse.url, "--user", OTHER_NAME, "--lumiverse", fixture.sources.lumiverse, "--data", folder]);
    const { code, out } = await other(data);
    expect(code).toBe(1);
    expect(out).toContain(`This RPE belongs to the Lumiverse user ${USER}, and this run is for ${OTHER_USER}: one RPE serves one Lumiverse user.`);
    expect(out).toContain(`An earlier run carried the data of the Lumiverse user ${USER} into this data folder, and this run is for ${OTHER_USER}: one RPE serves one Lumiverse user.`);
    expect(out).toContain("Nothing was stopped or changed.");
    // Its config, its sign-in, its keys and its runs as they were; nothing asked of systemctl or changed in Lumiverse.
    expect(await keep(data)).toEqual(dataBefore);
    expect(await asked()).toEqual([]);
    expect(lumiverse.changes).toEqual([]);
    expect(await todays()).toEqual(before);
    // An RPE set up for this user and not yet migrated into is refused the same way.
    const setUp = join(fixture.root, "rpe-set-up");
    await mkdir(setUp, { recursive: true });
    await writeFile(join(setUp, "config.json"), JSON.stringify({ port: ownPort, lumiverse: { url: lumiverse.url, user: USER } }));
    const setUpBefore = await keep(setUp);
    const again = await other(setUp);
    expect(again.code).toBe(1);
    expect(again.out).toContain(`This RPE belongs to the Lumiverse user ${USER}, and this run is for ${OTHER_USER}: one RPE serves one Lumiverse user.`);
    expect(await keep(setUp)).toEqual(setUpBefore);
  });

  test("a later `rpe up` without the swap leaves today's connection, now RPE's, as it is, and its key in force", async () => {
    await rm(log, { force: true });
    const before = await todays();
    const { code, out } = await rpe(["up", "--url", lumiverse.url, "--user", USERNAME, "--data", data]);
    expect(code).toBe(0);
    expect(out).toContain(`RPE's connection in Lumiverse, "LumiRPEngine" (${TODAYS_CONNECTION}), is already as it should be.`);
    expect(lumiverse.changes).toEqual([]);
    expect(providerKeys()).toContain(sha256(LOOPBACK_KEY));
    expect(await asked()).toEqual(["systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`]);
    expect(await todays()).toEqual(before);
  });

  test("the unit `rpe up` writes stops starting RPE after the starts its update settings allow, within the time they give", async () => {
    // The defaults, from the first swap's unit; then the user's own RPE-global.yml, which a later `rpe up` writes into the unit.
    expect((await readFile(join(unitFolder, UNIT), "utf8")).split("\n")).toEqual(expect.arrayContaining(["StartLimitIntervalSec=60", "StartLimitBurst=6", "Restart=always"]));
    const global = dataPaths(data).globalConfig;
    await writeFile(global, `${(await readFile(global, "utf8").catch(() => "")).trimEnd()}\nupdate:\n  startTries: 3\n  startWindowSeconds: 30\n`);
    await rm(log, { force: true });
    expect((await rpe(["up", "--url", lumiverse.url, "--user", USERNAME, "--data", data])).code).toBe(0);
    expect((await readFile(join(unitFolder, UNIT), "utf8")).split("\n")).toEqual(expect.arrayContaining(["StartLimitIntervalSec=30", "StartLimitBurst=4"]));
  });

  /** RPE's chats and the migration's runs for the user, and the backups taken, as RPE's data folder holds them. */
  const held = async (): Promise<{ chats: number; runs: number; backups: number }> => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const count = (table: string): number => db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM ${table} WHERE user = ?`).get(USER)?.n ?? -1;
      return { chats: count("chat"), runs: count("migration_run"), backups: (await treeSums(join(data, "backups"))).size };
    } finally {
      db.close();
    }
  };

  test("where the swap stands, a second `rpe up --lumiverse` says what stands and finishes: it stops nothing, makes no run and takes no backup", async () => {
    await rm(log, { force: true });
    const [before, had] = [await todays(), await held()];
    const started = performance.now();
    const { code, out } = await up();
    expect(code).toBe(0);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(await asked()).toEqual([`systemctl --user is-active --quiet ${UNIT}`, "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user is-enabled --quiet lumiah-home.service"]);
    expect(out).toContain(`The switch stands: RPE's service ${UNIT} runs, and RPE answers at http://127.0.0.1:${place.port}, where the previous runtime ${RUNTIME} answered; the previous build's service lumiah-home.service is switched off; the extension Lumiverse has installed is this build (${BUILD}). Nothing was stopped or changed, and the migration was not made again.`);
    expect(out).toContain("carries what changed on the previous build's side since the last run (read at ");
    expect(out).toContain(`): stop RPE's service (systemctl --user stop ${UNIT}), run rpe migrate --lumiverse ${fixture.sources.lumiverse} --user ${USER} --data ${data}, then start it again (systemctl --user start ${UNIT}).`);
    expect(await held()).toEqual(had);
    expect(existsSync(flags.rpe)).toBe(true);
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
  });

  test("where RPE's service doesn't answer, `rpe up --lumiverse` makes the whole swap again, and duplicates nothing", async () => {
    // RPE's service stopped: nothing answers at today's address.
    await rm(flags.rpe);
    await rm(log, { force: true });
    const [before, had] = [await todays(), await held()];
    const { code, out } = await up();
    expect(code).toBe(0);
    expect(out).not.toContain("The switch stands");
    expect(await asked()).toEqual([`systemctl --user is-active --quiet ${UNIT}`, "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`, "systemctl --user disable lumiah-home.service"]);
    expect(await held()).toEqual({ chats: had.chats, runs: had.runs + 1, backups: had.backups + 1 });
    expect(existsSync(flags.rpe)).toBe(true);
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
  });

  test("where today's unit is switched on again, `rpe up --lumiverse` makes the whole swap again and switches it off; a connection of RPE's own its config named is said to be played no longer", async () => {
    // Today's unit is started at boot again, as going back's own install line leaves it; and RPE's config names a connection a plain `rpe up` made for it, which the user moved chats to.
    await writeFile(flags.todayOn, "");
    const config = await rpeConfig();
    await writeFile(join(data, "config.json"), JSON.stringify({ ...config, lumiverse: { ...(config.lumiverse as object), connections: ["connection-own"] } }));
    await rm(log, { force: true });
    const [before, had] = [await todays(), await held()];
    const { code, out } = await up();
    expect(code).toBe(0);
    expect(out).not.toContain("The switch stands");
    expect(await asked()).toEqual([`systemctl --user is-active --quiet ${UNIT}`, "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user is-enabled --quiet lumiah-home.service", `systemctl --user is-active --quiet ${UNIT}`, `systemctl --user stop ${UNIT}`, "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`, "systemctl --user disable lumiah-home.service"]);
    expect(existsSync(flags.todayOn)).toBe(false);
    expect(out).toContain(`The connection connection-own in Lumiverse, RPE's own until now, is played no longer once RPE answers in the previous runtime's place: the chats on it belong on "LumiRPEngine".`);
    expect(await rpeConfig()).toMatchObject({ lumiverse: { connections: [TODAYS_CONNECTION] } });
    expect(await held()).toEqual({ chats: had.chats, runs: had.runs + 1, backups: had.backups + 1 });
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
  });

  test("where Lumiverse holds no connection of today's, the swap gives RPE a connection of its own, and its last line does not say RPE answers under today's model name", async () => {
    // Today's connection is gone from Lumiverse, and RPE's service is stopped: the whole swap is made again.
    const todaysConnection = lumiverse.connections.get(TODAYS_CONNECTION);
    lumiverse.connections.delete(TODAYS_CONNECTION);
    await rm(flags.rpe);
    try {
      const { code, out } = await up();
      expect(code).toBe(0);
      expect(out).toContain(`Started ${UNIT}, RPE's service: RPE answers at http://127.0.0.1:${place.port}, where the previous runtime home did, with its key.`);
      expect(out).not.toContain("under its model name");
    } finally {
      if (todaysConnection !== undefined) lumiverse.connections.set(TODAYS_CONNECTION, todaysConnection);
    }
  });

  test("`rpe down` stops and removes RPE's service, leaves its data where it is, and gives the four steps of going back with the permissions by name", async () => {
    await rm(log, { force: true });
    const keep = async (): Promise<Map<string, string>> => new Map([...(await treeSums(data))].filter(([path]) => !path.endsWith(".db-shm")));
    const [dataBefore, before] = [await keep(), await todays()];
    const { code, out } = await rpe(["down", "--data", data]);
    expect(code).toBe(0);
    expect(await asked()).toEqual([`systemctl --user disable --now ${UNIT}`, "systemctl --user daemon-reload"]);
    expect(existsSync(join(unitFolder, UNIT))).toBe(false);
    expect(await keep()).toEqual(dataBefore);
    expect(await todays()).toEqual(before);
    expect(out).toContain(`Stopped and removed ${UNIT}. RPE's data stays where it is, in ${data}.`);
    expect(out).toContain("To go back to the previous build: its data was never changed, and neither was its connection in Lumiverse.");
    expect(out).toContain(`switch the installed extension (${IDENT}) to the branch the previous build is kept on`);
    expect(out).toContain(`Then switch the extension off and on again, so that it starts with them in hand. The ${PREVIOUS_PERMISSIONS.length} permissions it asks for: ${PREVIOUS_PERMISSIONS.join(", ")}.`);
    expect(out).toContain(`bun <the extension's folder>/dist/lumiah.js up --name ${RUNTIME} --systemd. It reads its address from its own config, keeps its registration, and takes up its service's unit, which the switch only switched off, with the memory cap it holds: all as the switch left them.`);
    // Today's unit is where today's install line finds it, switched off, with the memory cap it held.
    expect(await readFile(join(unitFolder, "lumiah-home.service"), "utf8")).toBe(TODAYS_UNIT);
    // RPE answered on today's connection: no chat was moved to one of RPE's own.
    expect(out).not.toContain("  5. ");
    // A second `rpe down` has nothing to stop, and says so.
    expect((await rpe(["down", "--data", data])).out).toContain(`RPE has no service for the data folder ${data}: nothing to stop.`);
  });

  test("Lumiverse's call on today's connection, with today's key and model, reaches RPE where today's runtime answered", async () => {
    // Today's runtime is stopped, and RPE runs from its data folder as its service would, on today's address.
    const port = place.port ?? 0;
    await place.stop(true);
    const paths = dataPaths(data);
    const asked = async (request: Request): Promise<Response> => {
      const body: unknown = await request.json();
      return Response.json({ asked: isRecord(body) ? (body.model ?? null) : null });
    };
    const echo = { name: "echo", mount: (app: App) => app.routes.add("echo", [rawRoute({ method: "POST", path: "/v1/chat/completions", access: "provider", group: "provider", does: "A test's provider endpoint.", answers: "JSON", raw: asked })]) };
    const app = await openApp({ paths, config: await loadConfig(paths, {}), version: "test", areas: [echo], ui: null, log: lineLog(() => {}) });
    try {
      const running = await app.start();
      expect(running.url).toBe(`http://127.0.0.1:${port}`);
      const call = (key: string) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: TODAYS_MODEL, messages: [] }) });
      const answered = await call(LOOPBACK_KEY);
      expect(answered.status).toBe(200);
      expect(await answered.json()).toEqual({ asked: TODAYS_MODEL });
      expect((await call("lah_another_key")).status).toBe(401);
      expect(app.config.lumiverse.models).toContain(TODAYS_MODEL);
    } finally {
      await app.close();
      place = serve(port);
    }
  });
});
