// RPE's update of its own installed copy (plan §4.6; READINGS R-12, R-13): a new app file is taken
// only on the extension's word with the hash stated for it, only when every file matches, only when it
// starts, and is swapped in once no turn or job runs, the copy it replaces kept as known-good; a
// swapped-in build that does not come up is put back by the unit's pre-start step.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineLog } from "../../src/app";
import { appCopyPlaces, copyUpdate, installCopy } from "../../src/app/app-copy";
import { statedHash, STATEMENT_FILE, statementOf, statementText } from "../../src/app/build-statement";
import { ARRIVED_PATH, serviceRoutes } from "../../src/app/service-routes";
import { type AppFile, Builds, type UpdateSettings } from "../../src/app/update";
import { bearer, makeBed, makeKey, OWNER } from "./helpers";

const SETTINGS: UpdateSettings = { restart: true, versionWaitMs: 1000, lookEveryMs: 1, startTries: 2, startWindowMs: 60_000, checkWaitMs: 1000, keepCopies: 1 };

describe("RPE's own copy takes a new build", () => {
  let root: string;
  let data: string;
  let dist: string;

  /** A build in `dist`: its app file and what it reads beside it, with its statement; what the extension states for it. */
  async function build(name: string, shipped = "shipped"): Promise<string> {
    await rm(dist, { recursive: true, force: true });
    for (const folder of ["guidance", "guidance-harness", "ui"]) await mkdir(join(dist, folder), { recursive: true });
    await writeFile(join(dist, "rpe.js"), `// build ${name}\n`);
    await writeFile(join(dist, "guidance", "a.md"), shipped);
    await writeFile(join(dist, "guidance-harness", "b.md"), "harness");
    await writeFile(join(dist, "ui", "index.html"), `<html>${name}</html>`);
    const text = statementText(await statementOf(dist, name));
    await writeFile(join(dist, STATEMENT_FILE), text);
    return statedHash(text);
  }

  const current = (): Promise<string> => readFile(join(appCopyPlaces(data).current, "rpe.js"), "utf8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rpe-update-copy-"));
    data = join(root, "data");
    dist = join(root, "extension", "dist");
    await mkdir(data, { recursive: true });
    await build("old1");
    await installCopy(data, join(dist, "rpe.js"), 1);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** RPE running as its installed copy, with a start test that answers `starts`, and a restart that runs what the app does after it has closed. */
  function running(starts: { why: string | null }) {
    const state = { busy: 0, restarted: Promise.withResolvers<void>(), restarts: 0 };
    const copy = copyUpdate(data, join(dist, "rpe.js"), async () => starts.why);
    const file: AppFile = {
      path: join(appCopyPlaces(data).current, "rpe.js"),
      buildOf: async () => ({ failed: "not asked" }),
      startsOn: async () => null,
      settings: async () => SETTINGS,
      service: async () => true,
      restart: (after) => {
        state.restarts++;
        void (after?.() ?? Promise.resolve()).then(() => state.restarted.resolve());
      },
      sleep: (ms) => Bun.sleep(ms),
      copy,
    };
    const builds = new Builds({ version: "old1", file, log: lineLog(() => undefined) });
    builds.counts(() => state.busy);
    return { builds, state, copy };
  }

  test("a new app file whose files do not match the hash stated for it is not taken, a word with no stated hash is not taken, and RPE says why and runs on", async () => {
    const stated = await build("new2");
    const { builds, state } = running({ why: null });
    await builds.start();
    expect(await builds.arrived(null)).toMatchObject({ taken: false });
    expect(builds.status().broken).toContain("no hash");
    expect(await builds.arrived("0".repeat(64))).toMatchObject({ taken: false });
    expect(builds.status().broken).toContain("not the same build");
    // A file changed after the build stated it.
    await writeFile(join(dist, "guidance", "a.md"), "changed after the statement");
    expect(await builds.arrived(stated)).toMatchObject({ taken: false });
    expect(builds.status().broken).toContain("guidance/a.md is not the file the build stated");
    expect(builds.status().words).toContain("not taken");
    expect(state.restarts).toBe(0);
    expect(await current()).toContain("old1");
  });

  test("a new build that does not start is not taken; one that does is swapped in once no turn or job runs, the one it replaces kept as known-good, and Update now restarts at once", async () => {
    const stated = await build("new2");
    const starts: { why: string | null } = { why: "it does not start on this RPE's data (its check exited with 1)" };
    const { builds, state } = running(starts);
    await builds.start();
    expect(await builds.arrived(stated)).toMatchObject({ taken: false });
    expect(builds.status().broken).toContain("does not start");
    expect(await Bun.file(join(appCopyPlaces(data).next, "rpe.js")).exists()).toBe(false);

    starts.why = null;
    state.busy = 1;
    expect(await builds.arrived(stated)).toMatchObject({ taken: true });
    expect(builds.status()).toMatchObject({ disk: "new2", broken: null, restart: "waiting" });
    expect(state.restarts).toBe(0);
    state.busy = 0;
    await state.restarted.promise;
    expect(state.restarts).toBe(1);
    expect(await current()).toContain("new2");
    expect(await readFile(join(appCopyPlaces(data).knownGood, "rpe.js"), "utf8")).toContain("old1");
    expect(JSON.parse(await readFile(appCopyPlaces(data).swapped, "utf8"))).toMatchObject({ from: "old1", to: "new2", starts: 0 });

    // Update now restarts at once, though a turn runs.
    const again = running({ why: null });
    await again.builds.start();
    const next = await build("new3");
    again.state.busy = 3;
    expect(await again.builds.arrived(next, false)).toMatchObject({ taken: true });
    expect(again.state.restarts).toBe(0);
    await again.builds.now();
    await again.state.restarted.promise;
    expect(again.state.restarts).toBe(1);
  });

  test("a swapped-in build that never comes up is replaced by the known-good copy after update.startTries starts, and status says what happened", async () => {
    const stated = await build("new2");
    const { builds, state, copy } = running({ why: null });
    await builds.start();
    await builds.arrived(stated);
    await state.restarted.promise;
    const places = appCopyPlaces(data);
    // The unit's pre-start step, as the service runs it: each start counts while the new build has not come up.
    const preStart = async (): Promise<void> => {
      const run = Bun.spawn([process.execPath, places.beforeStart, data, String(SETTINGS.startTries)], { stdout: "ignore", stderr: "pipe" });
      expect(await run.exited).toBe(0);
    };
    await preStart();
    await preStart();
    expect(await current()).toContain("new2");
    await preStart();
    expect(await current()).toContain("old1");
    expect(await Bun.file(places.swapped).exists()).toBe(false);
    expect(await copy.fellBack()).toContain("did not come up");
    const told = running({ why: null });
    await told.builds.start();
    expect(told.builds.status().words).toContain("put back the known-good copy");
    // A build that comes up lets its mark go, and is never put back.
    await mkdir(places.knownGood, { recursive: true });
    await writeFile(places.swapped, JSON.stringify({ from: "old1", to: "new2", starts: 1 }));
    await copy.cameUp();
    await preStart();
    expect(await Bun.file(places.swapped).exists()).toBe(false);
    expect(await current()).toContain("old1");
  });
});

describe("the extension's word that an app file arrived", () => {
  test("the extension's key calls the route and a word with no stated hash is not taken; a page token cannot call it", async () => {
    const bed = await makeBed();
    try {
      const app = await bed.open({ areas: [{ name: "service", mount: (a) => a.routes.add("service", serviceRoutes({ builds: a.builds })) }] });
      const server = await app.start();
      const url = `http://127.0.0.1:${server.port}${ARRIVED_PATH}`;
      const ask = (token: string): Promise<Response> => fetch(url, { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: "{}" });
      const extension = await makeKey(app, "extension");
      const word = await ask(extension);
      expect(word.status).toBe(200);
      expect(await word.json()).toMatchObject({ taken: false });
      const page = await app.auth.mintPageToken(OWNER, "extension");
      expect((await ask(page.token)).status).toBeGreaterThanOrEqual(401);
      expect((await ask(page.token)).status).toBeLessThan(500);
    } finally {
      await bed.remove();
    }
  });
});
