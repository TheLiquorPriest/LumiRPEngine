// The application after an update of the extension (plan §4.6): it keeps its app file's hash from the
// start, reads the file again when the extension registers as another build and when asked, says the
// builds that meet at it, checks that a new build starts on its data (`rpe check`: its config read,
// its migrations applied to a copy of the database), and restarts onto a new build that starts once
// no turn or job runs, where its service would start it again and its setting lets it. The app file
// is invented, in a folder of the test's own; the service is a stand-in, and nothing is started or
// stopped on this machine.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, type Area, BUILDS_PATH, lineLog, openApp } from "../../src/app";
import { runCli } from "../../src/app/cli";
import { readConfig } from "../../src/app/config-read";
import { type AppFile, type BuildsStatus, startCheck, UPDATE_SETTINGS, updateSettings, type UpdateSettings, versionOf } from "../../src/app/update";
import { treeSums } from "../migrate/fixture";
import { openTurnBed, type TurnBed } from "../turn/bed";
import { bearer, type Bed, cliIo, freePort, LUMIVERSE, makeBed, makeKey, OWNER, writeConfig } from "./helpers";

const RUNNING = "a1b2c3d4";
const NEW = "e5f6a7b8";

/** An app file as the build writes one, as far as `--version` goes. */
const fileOf = (build: string): string => `if (process.argv[2] === "--version") console.log("rpe ${build}");\n`;

/** What stands in for RPE's service and the user's settings, and what the app asked of them. */
interface StandIn {
  service: boolean;
  settings: UpdateSettings;
  restarts: number;
  /** Turns and jobs running now. */
  running: number;
  /** How many times a restart looked whether anything runs, and what it found each time. */
  looked: number[];
}

let bed: Bed;
let port: number;
let file: string;
let stand: StandIn;
let app: App | null;
const beds: TurnBed[] = [];

beforeEach(async () => {
  bed = await makeBed();
  await mkdir(bed.paths.root, { recursive: true });
  port = freePort();
  await writeConfig(bed.paths, { port, lumiverse: { url: LUMIVERSE, user: OWNER } });
  file = join(bed.root, "rpe.js");
  await writeFile(file, fileOf(RUNNING));
  stand = { service: true, settings: { restart: true, versionWaitMs: 10_000, lookEveryMs: 1, startTries: 5, startWindowMs: 60_000, checkWaitMs: 10_000, keepCopies: 1 }, restarts: 0, running: 0, looked: [] };
  app = null;
});

afterEach(async () => {
  await app?.close();
  for (const b of beds.splice(0)) await b.close();
  await bed.remove();
});

/** RPE on the bed's data folder, run from the invented app file, its service and settings the stand-in's. */
async function rpe(): Promise<App> {
  const appFile: AppFile = {
    path: file,
    buildOf: (path, waitMs) => versionOf(process.execPath, path, waitMs),
    startsOn: (path, waitMs) => startCheck(process.execPath, path, bed.paths.root, waitMs),
    settings: async () => stand.settings,
    service: async () => stand.service,
    restart: () => {
      stand.restarts++;
    },
    // A look at the turns and jobs again comes at once: the stand-in says what each look finds.
    sleep: () => Promise.resolve(),
  };
  const opened = await openApp({ paths: bed.paths, config: bed.config({ port }), version: RUNNING, ui: null, log: lineLog((line) => bed.logs.push(line)), appFile });
  app = opened;
  opened.builds.counts(() => {
    stand.looked.push(stand.running);
    return stand.running;
  });
  await opened.start();
  return opened;
}

/** The builds as the status page's route gives them: a page's, so asked with a web key. */
async function statusRoute(): Promise<BuildsStatus> {
  if (app === null) throw new Error("RPE is not open");
  const body = (await (await fetch(`http://127.0.0.1:${port}${BUILDS_PATH}`, { headers: { authorization: `Bearer ${await makeKey(app, "web")}` } })).json()) as { builds: BuildsStatus };
  return body.builds;
}

/** `rpe status`'s line about the builds. */
async function statusLine(): Promise<string | undefined> {
  // The token the command line makes for the builds holds by the clock the running RPE reads: the real one.
  const io = { ...cliIo(), env: { RPE_DATA: bed.paths.root }, now: Date.now };
  expect(await runCli(["status"], io, { version: NEW })).toBe(0);
  return io.outs.find((line) => line.startsWith("Builds: "));
}

async function until<T>(what: string, check: () => T | null | undefined | false): Promise<T> {
  const end = Date.now() + 5_000;
  for (;;) {
    const got = check();
    if (got) return got;
    if (Date.now() > end) throw new Error(`waited five seconds for ${what}`);
    await Bun.sleep(5);
  }
}

test("a replaced app file is noticed when the extension registers as another build, and the status route and rpe status say the three builds and whether they agree", async () => {
  stand.service = false;
  const running = await rpe();
  expect(await statusRoute()).toMatchObject({ running: RUNNING, disk: RUNNING, extension: null, agree: true, restart: "none" });
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}, the build of its app file on disk; the extension has not said its build yet.`);

  // Lumiverse replaces the extension's files, the app file among them; the running build goes on.
  await writeFile(file, fileOf(NEW));
  running.builds.registered(NEW);
  await until("the new file to be read", () => running.builds.status().disk === NEW);
  expect(running.builds.status()).toMatchObject({ running: RUNNING, disk: NEW, extension: NEW, broken: null, agree: false, restart: "by hand" });
  expect(await statusRoute()).toMatchObject({ running: RUNNING, disk: NEW, extension: NEW, agree: false });
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}; its app file on disk is build ${NEW}; the extension is build ${NEW}. A restart is needed to run build ${NEW}: RPE was started by hand, so nothing would start it again. Stop it, and start it again.`);
  // Run by hand, nothing exits.
  expect(stand.restarts).toBe(0);
});

test("the extension says its own build when it takes RPE's registration, through Lumiverse", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  // The bed's extension runs from source, as the development build; its RPE is another build, and runs from no single file.
  const status = await until("the extension's build", () => (b.app.builds.status().extension === null ? null : b.app.builds.status()));
  expect(status).toMatchObject({ extension: "dev", disk: null, agree: false, restart: "none" });
});

test("a new build that starts is restarted onto only once no turn or job runs, and rpe status says it is waiting", async () => {
  const running = await rpe();
  stand.running = 2;
  await writeFile(file, fileOf(NEW));
  expect(await running.builds.check()).toMatchObject({ disk: NEW, restart: "waiting" });
  await until("a look that finds the turns running", () => stand.looked.length > 1);
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}; its app file on disk is build ${NEW}; the extension has not said its build yet. RPE restarts on build ${NEW} once no turn or job is running.`);
  expect(stand.restarts).toBe(0);
  stand.running = 0;
  await until("the restart", () => stand.restarts === 1);
  expect(stand.looked.at(-1)).toBe(0);
  expect(stand.looked.slice(0, -1).every((n) => n === 2)).toBe(true);
  expect(running.builds.status().restart).toBe("restarting");
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}; its app file on disk is build ${NEW}; the extension has not said its build yet. RPE is restarting on build ${NEW}.`);
});

test("a file that does not start is never restarted onto, and is reported", async () => {
  const running = await rpe();
  await writeFile(file, 'throw new Error("half written");\n');
  const status = await running.builds.check();
  expect(status).toMatchObject({ running: RUNNING, disk: null, agree: false, restart: "none" });
  expect(status.broken).toBe("it exited with 1: error: half written");
  // The extension that brought it says its build: the file is read again, and still not restarted onto.
  running.builds.registered(NEW);
  expect(await running.builds.check()).toMatchObject({ disk: null, extension: NEW, restart: "none" });
  expect(stand.looked).toEqual([]);
  expect(stand.restarts).toBe(0);
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}. Its app file on disk was replaced by one that does not start (it exited with 1: error: half written), so RPE goes on running build ${RUNNING}; the extension is build ${NEW}.`);
  expect(bed.logs.some((line) => line.includes("replaced by one that does not start"))).toBe(true);
});

test("a build whose app file fails to start is shown by its place under the install, and the reply holds no absolute path", async () => {
  const running = await rpe();
  // The new file reaches for a part of the install that is not there, and Bun names the file it came from in full.
  await writeFile(file, 'import "./parts/tide-table.js";\n');
  expect((await running.builds.check()).broken).toBe("it exited with 1: error: Cannot find module './parts/tide-table.js' from 'rpe.js'");
  const reply = JSON.stringify(await statusRoute());
  expect(reply).toContain("from 'rpe.js'");
  const absolute = [bed.root, await realpath(bed.root), tmpdir(), await realpath(tmpdir())];
  expect(absolute.filter((path) => reply.includes(path))).toEqual([]);
  // A spawn that fails words its error the same: the program it could not start by its last part.
  const spawned = await versionOf(join(bed.root, "no-such-bun"), file, 10_000);
  const words = "failed" in spawned ? spawned.failed : "";
  expect(words).toContain("no-such-bun");
  expect(absolute.filter((path) => words.includes(path))).toEqual([]);
});

test("a new build that says its build and does not start on this RPE's data is never restarted onto, rpe status says why, and its check leaves no copy behind", async () => {
  const running = await rpe();
  const told = join(bed.root, "check-folder.txt");
  // It takes the folder its check is given, puts a copy there, and then fails as a migration of its own would on this database.
  await writeFile(
    file,
    [
      'const fs = require("node:fs");',
      `if (process.argv[2] === "--version") console.log("rpe ${NEW}");`,
      'if (process.argv[2] === "check") {',
      '  const into = process.argv[process.argv.indexOf("--into") + 1];',
      '  fs.writeFileSync(`${into}/rpe.db`, "a copy of the database");',
      `  fs.writeFileSync(${JSON.stringify(told)}, into);`,
      '  console.error("The store\'s migration 9 failed on this database: no such column: invented");',
      "  process.exit(1);",
      "}",
      "",
    ].join("\n"),
  );
  running.builds.registered(NEW);
  const status = await until("the new file to be read", () => (running.builds.status().broken === null ? null : running.builds.status()));
  const why = "it does not start on this RPE's data (its check exited with 1: The store's migration 9 failed on this database: no such column: invented)";
  expect(status).toMatchObject({ running: RUNNING, disk: null, extension: NEW, broken: why, restart: "none" });
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}. Its app file on disk was replaced by one that does not start (${why}), so RPE goes on running build ${RUNNING}; the extension is build ${NEW}.`);
  expect(stand.restarts).toBe(0);
  expect(existsSync(await readFile(told, "utf8"))).toBe(false);
});

test("a check that does not end in time is stopped, counts as not starting, and leaves no copy behind", async () => {
  stand.settings = { ...stand.settings, checkWaitMs: 300 };
  const running = await rpe();
  const told = join(bed.root, "check-folder.txt");
  // The spawn's own time limit is what is under test, so the check really hangs, and the limit is short.
  await writeFile(file, [`if (process.argv[2] === "--version") console.log("rpe ${NEW}");`, 'if (process.argv[2] === "check") {', `  require("node:fs").writeFileSync(${JSON.stringify(told)}, process.argv[process.argv.indexOf("--into") + 1]);`, "  setTimeout(() => {}, 60_000);", "}", ""].join("\n"));
  expect(await running.builds.check()).toMatchObject({ disk: null, broken: "it did not finish checking that it starts on this RPE's data within 0.3 s", restart: "none" });
  expect(stand.restarts).toBe(0);
  expect(existsSync(await readFile(told, "utf8"))).toBe(false);
});

test('a check that failed for a passing reason is asked again by "Update now", the file unchanged, and the new build is restarted onto once it starts', async () => {
  stand.settings = { ...stand.settings, checkWaitMs: 300 };
  const running = await rpe();
  const slow = join(bed.root, "slow-check");
  await writeFile(slow, "");
  // While the marker is there its check takes longer than update.checkWait allows, as a check on a machine under load may; the file itself does not change. The spawn's own time limit is what fails it, so the check really hangs.
  await writeFile(file, [`if (process.argv[2] === "--version") console.log("rpe ${NEW}");`, `if (process.argv[2] === "check" && require("node:fs").existsSync(${JSON.stringify(slow)})) setTimeout(() => {}, 60_000);`, ""].join("\n"));
  expect(await running.builds.check()).toMatchObject({ disk: null, broken: "it did not finish checking that it starts on this RPE's data within 0.3 s", restart: "none" });
  await rm(slow);
  stand.settings = { ...stand.settings, checkWaitMs: 10_000 };
  stand.running = 1;
  const asked = await fetch(`http://127.0.0.1:${port}/api/v1/update`, { method: "POST", headers: bearer(await makeKey(running, "web")) });
  expect(await asked.json()).toMatchObject({ disk: NEW, broken: null, restart: "waiting" });
  stand.running = 0;
  await until("the restart", () => stand.restarts === 1);
});

test("rpe check reads the config and applies this build's migrations to a copy of the database, writes nothing to the data folder and leaves no copy; a migration that fails on this database, or a config this build refuses, fails it", async () => {
  // RPE runs on the data folder meanwhile, as when it checks a new build of its own file.
  await rpe();
  const into = await mkdtemp(join(tmpdir(), "rpe-check-test-"));
  try {
    // The data folder by path and checksum; SQLite's log and index beside the database are RPE's own, which runs meanwhile.
    const kept = async (): Promise<Map<string, string>> => new Map([...(await treeSums(bed.paths.root))].filter(([path]) => !path.endsWith("-shm") && !path.endsWith("-wal")));
    const before = await kept();
    const check = async (areas: readonly Area[]): Promise<{ code: number; out: string; err: string }> => {
      const io = { ...cliIo(), env: { RPE_DATA: bed.paths.root } };
      const code = await runCli(["check", "--into", into], io, { version: NEW, areas });
      return { code, out: io.outs.join("\n"), err: io.errs.join("\n") };
    };
    const passed = await check([]);
    expect(passed.code).toBe(0);
    expect(passed.out).toContain(`RPE ${NEW} starts on the data folder ${bed.paths.root}: its config reads, and its database takes this build's tables`);
    expect(readdirSync(into)).toEqual([]);
    expect(await kept()).toEqual(before);

    const broken: Area = { name: "broken", tables: [{ area: "build", migrations: [{ version: 1, name: "a table the database has already", sql: "CREATE TABLE switch (x)" }] }] };
    const failed = await check([broken]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("switch already exists");
    expect(readdirSync(into)).toEqual([]);

    await writeConfig(bed.paths, { port: "not a port" });
    const refused = await check([]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("port");
    expect(readdirSync(into)).toEqual([]);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test("with update.restart off nothing exits, and rpe status says a restart is needed", async () => {
  // The user's own RPE-global.yml switches it off, over the shipped default.
  stand.settings = updateSettings(readConfig([{ level: "global", file: "RPE-global.yml", text: "# Mine.\nupdate:\n  restart: false\n" }], lineLog(() => undefined), UPDATE_SETTINGS));
  expect(stand.settings.restart).toBe(false);
  const running = await rpe();
  await writeFile(file, fileOf(NEW));
  expect(await running.builds.check()).toMatchObject({ disk: NEW, restart: "off" });
  expect(await statusLine()).toBe(`Builds: RPE runs build ${RUNNING}; its app file on disk is build ${NEW}; the extension has not said its build yet. A restart is needed to run build ${NEW}: RPE does not restart by itself while update.restart is off. Choose "Update now", or restart RPE's service.`);
  expect(stand.looked).toEqual([]);
  expect(stand.restarts).toBe(0);
});

test('"Update now" restarts onto the new build whatever update.restart says, once no turn or job runs, and answers what RPE will do; run by hand, it says it cannot', async () => {
  stand.settings = { ...stand.settings, restart: false };
  stand.running = 1;
  const running = await rpe();
  await writeFile(file, fileOf(NEW));
  expect(await running.builds.check()).toMatchObject({ restart: "off" });
  const update = async (headers: Record<string, string>): Promise<Response> => await fetch(`http://127.0.0.1:${port}/api/v1/update`, { method: "POST", headers });
  expect((await update({})).status).toBe(401);
  const page = bearer(await makeKey(running, "web"));

  stand.service = false;
  expect(await (await update(page)).json()).toMatchObject({ restart: "by hand", words: `RPE runs build ${RUNNING}; its app file on disk is build ${NEW}; the extension has not said its build yet. A restart is needed to run build ${NEW}: RPE was started by hand, so nothing would start it again. Stop it, and start it again.` });
  expect(stand.restarts).toBe(0);

  stand.service = true;
  const asked = await update(page);
  expect(asked.status).toBe(200);
  expect(await asked.json()).toMatchObject({ disk: NEW, restart: "waiting", words: `RPE runs build ${RUNNING}; its app file on disk is build ${NEW}; the extension has not said its build yet. RPE restarts on build ${NEW} once no turn or job is running.` });
  await until("a look that finds a turn running", () => stand.looked.length > 0);
  expect(stand.restarts).toBe(0);
  stand.running = 0;
  await until("the restart", () => stand.restarts === 1);
});
