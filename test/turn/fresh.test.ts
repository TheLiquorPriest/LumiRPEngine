// A fresh RPE, which belongs to no Lumiverse user until `rpe up` sets one: that is the ordinary state of
// a new install, so its start logs no error. Its harness looks for the jobs a restart cut off, and finds
// none, since nothing can be kept for no one.

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataPaths, lineLog, openApp } from "../../src/app";
import { compose } from "../../src/app/compose";
import { configOf, prepareDataFolder } from "../../src/app/config";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("a fresh RPE starts its harness with no error in its log", async () => {
  const root = await mkdtemp(join(tmpdir(), "rpe-fresh-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const paths = dataPaths(join(root, "rpe"));
  await prepareDataFolder(paths);
  const lines: string[] = [];
  const composition = compose();
  const app = await openApp({ paths, config: configOf({ port: 0, lumiverse: { url: null, user: "user-fresh" } }, {}, "the test's config"), version: "build-9", areas: composition.areas, ui: null, log: lineLog((line) => lines.push(line), () => 0) });
  cleanups.push(() => app.close());
  const turns = composition.turns();
  expect(turns).not.toBeNull();
  // The harness's jobs settle what they found at the start before they answer anything.
  expect(await turns!.harness.jobs?.list({ user: "user-nobody" })).toEqual([]);
  expect(lines.filter((line) => /error/i.test(line))).toEqual([]);
});
