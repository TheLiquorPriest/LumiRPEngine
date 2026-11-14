// The application after an update of the extension (plan §4.6): it keeps its app file's hash from the
// start, reads the file again when the extension registers as another build and when asked, says the
// builds that meet at it, and restarts onto a new build that starts once no turn or job runs, where
// its service would start it again and its setting lets it. The app file is invented, in a folder of
// the test's own; the service is a stand-in, and nothing is started or stopped on this machine.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type App, lineLog, openApp } from "../../src/app";
import { runCli } from "../../src/app/cli";
import { type AppFile, type BuildsStatus, updateSettings, type UpdateSettings, versionOf } from "../../src/app/update";
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
  stand = { service: true, settings: { restart: true, versionWaitMs: 10_000, lookEveryMs: 1 }, restarts: 0, running: 0, looked: [] };
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

async function statusRoute(): Promise<BuildsStatus> {
  const body = (await (await fetch(`http://127.0.0.1:${port}/api/v1/status`)).json()) as { builds: BuildsStatus };
  return body.builds;
}

/** `rpe status`'s line about the builds. */
async function statusLine(): Promise<string | undefined> {
  const io = { ...cliIo(), env: { RPE_DATA: bed.paths.root } };
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

test("with update.restart off nothing exits, and rpe status says a restart is needed", async () => {
  // The user's own RPE-global.yml switches it off, over the shipped default.
  stand.settings = updateSettings([null, "# Mine.\nupdate:\n  restart: false\n"], lineLog(() => undefined));
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
