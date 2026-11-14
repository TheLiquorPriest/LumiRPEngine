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
  /** What Lumiverse says the installed extension's manifest asks for. */
  extension: { permissions: string[] };
  /** Every call that changes something, as `METHOD path`. */
  changes: string[];
  stop(): Promise<void>;
}

/** Lumiverse as `rpe up` meets it: the username sign-in and `get-session`, the connections routes, and the extensions list. Today's build's own connection is there already, at `todaysUrl`. */
function lumiverseStandIn(todaysUrl: string): LumiverseStandIn {
  const connections = new Map<string, Profile>([[TODAYS_CONNECTION, { id: TODAYS_CONNECTION, name: "LumiRPEngine", provider: "custom", api_url: todaysUrl, model: TODAYS_MODEL, has_api_key: true }]]);
  const extension = { permissions: [...LIGHT] };
  const changes: string[] = [];
  /** Live session tokens, by the user each signs in as. */
  const live = new Map<string, string>();
  let made = 0;
  const shown = (p: Profile) => ({ ...p, preset_id: null, is_default: false, metadata: {}, created_at: 1, updated_at: 1 });
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
      if (request.method === "GET" && pathname === "/api/v1/spindle") return Response.json({ extensions: [{ identifier: IDENT, enabled: true, permissions: extension.permissions }] });
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
 * address: today's runs while its flag file is there, RPE's while its is. Told to, it plays today's
 * build writing a file no row names as its service stops, and RPE failing to come up.
 */
const SYSTEMCTL = `#!/bin/sh
echo "systemctl $*" >> "$RPE_SWAP_LOG"
case "$*" in
  "--user is-active --quiet lumiah-home.service") [ -e "$RPE_SWAP_TODAY" ] || exit 3 ;;
  "--user is-active --quiet rpe-"*) [ -e "$RPE_SWAP_RPE" ] || exit 3 ;;
  "--user stop lumiah-home.service")
    rm -f "$RPE_SWAP_TODAY"
    if [ -n "$RPE_SWAP_STRAY" ]; then echo "written as it stopped" > "$RPE_SWAP_STRAY"; fi ;;
  "--user start lumiah-home.service") touch "$RPE_SWAP_TODAY" ;;
  "--user restart rpe-"*|"--user start rpe-"*) if [ -z "$RPE_SWAP_RPE_FAILS" ]; then touch "$RPE_SWAP_RPE"; fi ;;
  "--user stop rpe-"*|"--user disable --now rpe-"*) rm -f "$RPE_SWAP_RPE" ;;
esac
`;

describe("the swap, and going back", () => {
  let fixture: Fixture;
  let lumiverse: LumiverseStandIn;
  let place: Server<undefined>;
  /** What today's runtime says it has under way, one answer per ask; the last stays. */
  let answers: { turns: number; requests: number }[] = [];
  let data: string;
  let log: string;
  let home: string;
  let unitFolder: string;
  let flags: { today: string; rpe: string };
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
      return db.query<{ hash: string }, []>("SELECT hash FROM app_key WHERE kind = 'provider' AND retired IS NULL").all().map((r) => r.hash);
    } finally {
      db.close();
    }
  };

  async function rpe(line: string[], more: Record<string, string> = {}): Promise<{ code: number; out: string }> {
    const lines: string[] = [];
    const io: CliIO = {
      out: (t) => lines.push(t),
      err: (t) => lines.push(t),
      env: { PATH: `${join(fixture.root, "bin")}:/usr/bin:/bin`, RPE_SWAP_LOG: log, RPE_SWAP_TODAY: flags.today, RPE_SWAP_RPE: flags.rpe, XDG_RUNTIME_DIR: join(fixture.root, "run"), ...more },
      home,
      now: () => Date.UTC(2026, 10, 14, 12, 0, 0),
      secret: async () => PASSWORD,
      stopped: () => new Promise(() => {}),
      fetch: (url, init) => fetch(url, init),
    };
    const code = await runCli(line, io, { version: "test" });
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
    flags = { today: join(fixture.root, "today-runs"), rpe: join(fixture.root, "rpe-runs") };
    await writeFile(flags.today, "");
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
    await writeFile(join(data, "config.json"), JSON.stringify({ port: ownPort, commandLine: { waitMs: 200, startMs: 1000 }, lumiverse: { connection: TODAYS_CONNECTION } }));
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
      expect(out).toContain(`Lumiverse still has today's build of the extension (${IDENT}) installed: its manifest asks for the permissions the previous build asks for. Switch the installed extension to the new build's branch in Lumiverse and approve its permissions first, then run rpe up again. Nothing was stopped or changed.`);
      // Not even today's runtime was asked whether it is busy.
      expect(await asked()).toEqual([]);
      expect(existsSync(join(data, "backups")) ? (await treeSums(join(data, "backups"))).size : 0).toBe(0);
      expect(await todays()).toEqual(before);
      expect(lumiverse.changes).toEqual([]);
    } finally {
      lumiverse.extension.permissions = [...LIGHT];
    }
  });

  test("where no runtime of today's is taken and something other than RPE answers where RPE's config has it answer, `rpe up` refuses before it stops anything", async () => {
    const other = Bun.serve({ hostname: "127.0.0.1", port: ownPort, fetch: () => new Response("Not here.", { status: 404 }) });
    try {
      const before = await todays();
      const { code, out } = await up({}, ["--no-runtime"]);
      expect(code).toBe(1);
      expect(out).toContain(`Something other than RPE answers at http://127.0.0.1:${ownPort}, where RPE's config has it answer: give RPE a free port ("port" in its config, or RPE_PORT), and run rpe up again. Nothing was stopped or changed.`);
      expect(await asked()).toEqual([]);
      expect(existsSync(join(data, "backups")) ? (await treeSums(join(data, "backups"))).size : 0).toBe(0);
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
    expect(out).toContain(`Today's runtime ${RUNTIME} still has 1 turn(s) and 1 request(s) under way after 2 seconds: nothing was stopped or changed.`);
    expect((await asked()).filter((line) => line.startsWith("systemctl"))).toEqual([]);
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    expect(existsSync(join(data, "backups")) ? (await treeSums(join(data, "backups"))).size : 0).toBe(0);
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
    expect(out).toContain("The swap did not go through: the run was refused, as the report says.");
    expect(out).toContain("Put back as it was: lumiah-home.service runs again.");
    expect(out).toContain("Nothing of today's was changed.");
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
    expect(out).toContain(`The swap did not go through: RPE did not answer at http://127.0.0.1:${place.port} within 1 seconds of its service starting`);
    expect(out).toContain(`Put back as it was: ${UNIT} is removed; RPE's config is as it was; lumiah-home.service runs again.`);
    // Today's build answers again; RPE's service is gone; nothing of today's changed.
    expect(existsSync(flags.today)).toBe(true);
    expect(existsSync(join(unitFolder, UNIT))).toBe(false);
    expect(existsSync(join(unitFolder, "lumiah-home.service"))).toBe(true);
    expect(await readFile(join(data, "config.json"), "utf8")).toBe(configBefore);
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
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
    expect(out).toContain("Today's runtime: took home, registered with this Lumiverse for this user");
    // Today's unit, which the config doesn't name, is backed up whole, and left where today's install line finds it.
    const backup = /Backup taken: (\S+) \(/.exec(out)?.[1] ?? "";
    expect(backup).toContain(join(data, "backups"));
    const entries = await new Bun.Archive(await Bun.file(backup).bytes()).files();
    const kept = [...entries].filter(([name]) => name.endsWith("unit/lumiah-home.service"));
    expect(kept.length).toBe(1);
    expect(await kept[0]?.[1].text()).toBe(TODAYS_UNIT);
    expect(await readFile(join(unitFolder, "lumiah-home.service"), "utf8")).toBe(TODAYS_UNIT);
    expect(out).toContain(`RPE's connection in Lumiverse is to be "LumiRPEngine" (${TODAYS_CONNECTION}), the one today's build made for its runtime: it is left as it is`);
    expect(out).toContain(`Started ${UNIT}, RPE's service: RPE answers at http://127.0.0.1:${place.port}, where today's runtime home did, under its model name (${TODAYS_MODEL}) and with its key.`);
    expect(out).toContain("Stopped and switched off lumiah-home.service, today's service.");
    // No new connection to choose chat by chat: the chats on today's connection are RPE's now.
    expect(out).not.toContain("choose the connection");
    const text = await readFile(join(unitFolder, UNIT), "utf8");
    expect(text).toContain(`# RPE's data folder: ${data}`);
    expect(text).toContain(`serve --data ${data}`);
    // RPE listens where today's runtime did, answers to its model name, and its connection in Lumiverse is today's.
    expect(await rpeConfig()).toMatchObject({ address: "127.0.0.1", port: place.port, lumiverse: { connection: TODAYS_CONNECTION, models: ["rpe", TODAYS_MODEL] } });
    expect(providerKeys()).toContain(sha256(LOOPBACK_KEY));
    // Today's storage and today's runtime's folders as they were; nothing changed in Lumiverse.
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
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

  let chats = 0;

  test("a second `rpe up --lumiverse` waits for nothing where RPE answers in today's place, migrates again with RPE's service stopped meanwhile, and duplicates nothing", async () => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      chats = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM chat WHERE user = ?").get(USER)?.n ?? -1;
    } finally {
      db.close();
    }
    await rm(log, { force: true });
    const before = await todays();
    const started = performance.now();
    const { code } = await up();
    expect(code).toBe(0);
    // No wait for today's "Wait before restart": RPE, not today's runtime, answers there.
    expect(performance.now() - started).toBeLessThan(1500);
    expect(await asked()).toEqual([`systemctl --user is-active --quiet ${UNIT}`, `systemctl --user stop ${UNIT}`, "systemctl --user is-active --quiet lumiah-home.service", "systemctl --user daemon-reload", `systemctl --user enable ${UNIT}`, `systemctl --user restart ${UNIT}`, "systemctl --user disable lumiah-home.service"]);
    const again = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      expect(again.query<{ n: number }, [string]>("SELECT count(*) AS n FROM chat WHERE user = ?").get(USER)?.n).toBe(chats);
      // The run of the swap RPE didn't come up for, the first swap's, and this one's.
      expect(again.query<{ n: number }, [string]>("SELECT count(*) AS n FROM migration_run WHERE user = ?").get(USER)?.n).toBe(3);
    } finally {
      again.close();
    }
    expect(await todays()).toEqual(before);
    expect(lumiverse.changes).toEqual([]);
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
    expect(out).toContain("To go back to the previous build: today's data was never changed, and neither was its connection in Lumiverse.");
    expect(out).toContain(`switch the installed extension (${IDENT}) to the branch the previous build is kept on`);
    expect(out).toContain(`approve the permissions the previous build asks for, then switch the extension off and on again, so that it starts with them in hand: ${PREVIOUS_PERMISSIONS.join(", ")}.`);
    expect(out).toContain(`bun <the extension's folder>/dist/lumiah.js up --name ${RUNTIME} --systemd. It reads its address from its own config, keeps its registration, and takes up its service's unit, which the swap only switched off, with the memory cap it holds: all as the swap left them.`);
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
    const echo = { name: "echo", mount: (app: App) => app.routes.add("echo", [rawRoute({ method: "POST", path: "/v1/chat/completions", access: "provider", raw: asked })]) };
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
