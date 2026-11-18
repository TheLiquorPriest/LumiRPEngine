// config.json holds the install's facts alone (R-133): the app's limits are settings of RPE-global.yml,
// and an earlier build's config.json that still holds limits has them moved there at the first start,
// each value kept. Every writer of config.json takes the config's lock, so the command line's write and
// that move never lose each other's change. Every name and address here is invented.

import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineLog, openApp } from "../../src/app";
import { type DataPaths, dataPaths, loadConfig, moveLimits, updateConfigFile } from "../../src/app/config";

const USER = "user-invented";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** A data folder whose config.json is `config`, as an earlier build wrote it. */
async function folderWith(config: Record<string, unknown>): Promise<DataPaths> {
  const root = await mkdtemp(join(tmpdir(), "rpe-config-"));
  roots.push(root);
  const paths = dataPaths(join(root, "data"));
  await mkdir(paths.files, { recursive: true });
  await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`);
  return paths;
}

const FACTS = { v: 1, port: 7900, lumiverse: { url: "http://lumiverse.test:7860", user: USER, connection: "conn-rpe", models: ["rpe"] } };
const LIMITS = { address: "0.0.0.0", origins: ["https://rpe.example"], server: { bodyBytes: 2_097_152 }, auth: { webKeyDays: 30 }, live: { follows: 9 }, database: { busyMs: 7000 }, commandLine: { waitMs: 4000 } };

const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const yaml = async (path: string): Promise<unknown> => Bun.YAML.parse(await readFile(path, "utf8"));

test("a config.json that holds limits is read once: its limits stand in RPE-global.yml with the same values, it keeps only the install's facts, and an address that is not loopback becomes the listen setting", async () => {
  const paths = await folderWith({ ...FACTS, ...LIMITS });
  // Until they are moved, the file's own limits are in force.
  const before = await loadConfig(paths, {});
  expect(before).toMatchObject({ address: "0.0.0.0", origins: ["https://rpe.example"], server: { bodyBytes: 2_097_152 }, auth: { webKeyDays: 30 }, live: { follows: 9 }, database: { busyMs: 7000 }, commandLine: { waitMs: 4000 } });

  // RPE's first start on this build moves them, before it listens, and says so.
  const logged: string[] = [];
  const app = await openApp({ paths, config: before, version: "build-9", areas: [], ui: null, log: lineLog((line) => logged.push(line)) });
  await app.close();
  expect(logged.filter((line) => line.includes("config.json's limits are settings in RPE-global.yml now"))).toHaveLength(1);
  expect(await json(paths.config)).toEqual(FACTS);
  expect(await yaml(paths.globalConfig)).toEqual({
    server: { address: "0.0.0.0", origins: ["https://rpe.example"], maxBodyBytes: 2_097_152 },
    auth: { webKeyDays: 30 },
    liveSocket: { maxFollows: 9 },
    database: { busyMs: 7000 },
    commandLine: { waitMs: 4000 },
  });

  // The next start reads the same values from the settings, and moves nothing again.
  const after = await loadConfig(paths, {});
  expect(after).toEqual(before);
  expect(await moveLimits(paths, lineLog(() => undefined))).toEqual([]);
  expect(await json(paths.config)).toEqual(FACTS);
});

test("a loopback address in config.json is where RPE always listens: it is dropped, not made a setting", async () => {
  const paths = await folderWith({ ...FACTS, address: "127.0.0.1", server: { preflightSeconds: 60 } });
  expect(await moveLimits(paths, lineLog(() => undefined))).toEqual(["address", "server.preflightSeconds"]);
  expect(await json(paths.config)).toEqual(FACTS);
  expect(await yaml(paths.globalConfig)).toEqual({ server: { preflightSeconds: 60 } });
  expect((await loadConfig(paths, {})).address).toBe("127.0.0.1");
});

test("the command line's write and the first start's move, made at once, both land in config.json", async () => {
  for (let round = 0; round < 10; round++) {
    const paths = await folderWith({ ...FACTS, ...LIMITS });
    // `rpe lumiverse` names RPE's connection while RPE's first start moves the limits out of the same file.
    await Promise.all([
      updateConfigFile(paths, (raw) => {
        (raw.lumiverse as Record<string, unknown>).connection = `conn-round-${round}`;
      }),
      moveLimits(paths, lineLog(() => undefined)),
    ]);
    expect({ round, config: await json(paths.config) }).toEqual({ round, config: { ...FACTS, lumiverse: { ...FACTS.lumiverse, connection: `conn-round-${round}` } } });
    expect({ round, follows: (await loadConfig(paths, {})).live.follows }).toEqual({ round, follows: 9 });
  }
});
