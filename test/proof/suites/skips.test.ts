// No unexplained skip: the gate lists every skipped test with its reason, which a test that may be
// skipped gives at the end of its name while it is skipped, `(skipped: <why>)`, since Bun gives a
// skip no reason of its own; a skip with none is a defect that fails the run. A run filtered by `-t`
// judges no skips (Bun counts the tests it leaves out as skipped). And the tests that run Lumiverse's
// own macro engine are given the Lumiverse checkout RPE sits in, or the one `LRE_HOST_REPO` names;
// the summary says which, or that none was found.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHost, judge, runAll, summarize, type AllRun, type Host } from "../../../scripts/test-all";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "rpe-skips-"));
  mkdirSync(join(root, "test"));
  writeFileSync(
    join(root, "test/skips.test.ts"),
    'import { test } from "bun:test";\ntest("runs", () => {});\ntest.skipIf(true)("needs a checkout (skipped: there is no checkout here)", () => {});\ntest.skip("is left out for no reason it gives", () => {});\ntest.todo("is not written yet");\n',
  );
  writeFileSync(join(root, "test/reasoned.test.ts"), 'import { test } from "bun:test";\ntest("runs", () => {});\ntest.skipIf(true)("needs a checkout (skipped: there is no checkout here)", () => {});\n');
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

const NONE: Host = { path: null, given: false };

test("every skipped test is listed with its reason, and a skip that gives none fails the run", async () => {
  const judged = judge(await runAll({ root, jobs: 1, files: ["test/skips.test.ts"], host: NONE }));
  expect(judged.skips).toEqual([
    { file: "test/skips.test.ts", name: "needs a checkout", reason: "there is no checkout here" },
    { file: "test/skips.test.ts", name: "is left out for no reason it gives", reason: null },
    { file: "test/skips.test.ts", name: "is not written yet", reason: null },
  ]);
  const lines = summarize(judged);
  const skipped = lines.indexOf("Skipped, each with its reason (3):");
  expect(lines.slice(skipped + 1, skipped + 7)).toEqual([
    "  test/skips.test.ts: needs a checkout",
    "    why: there is no checkout here",
    "  test/skips.test.ts: is left out for no reason it gives",
    "    why: none given, a defect",
    "  test/skips.test.ts: is not written yet",
    "    why: none given, a defect",
  ]);
  expect(lines.at(-1)).toBe("Verdict: fail: 2 skipped tests with no reason given.");
}, 20_000);

test("a skip that gives its reason is listed with it, and the run passes", async () => {
  const judged = judge(await runAll({ root, jobs: 1, files: ["test/reasoned.test.ts"], host: NONE }));
  expect(judged.skips).toEqual([{ file: "test/reasoned.test.ts", name: "needs a checkout", reason: "there is no checkout here" }]);
  expect(judged.ok).toBe(true);
  expect(summarize(judged).at(-1)).toBe("Verdict: pass.");
}, 20_000);

test("a run filtered by -t judges no skips", async () => {
  const judged = judge(await runAll({ root, jobs: 1, files: ["test/skips.test.ts"], bun: ["-t", "^runs$"], host: NONE }));
  expect(judged.run.first).toMatchObject([{ ok: true, passed: 1 }]);
  expect(judged.skips).toEqual([]);
  expect(judged.ok).toBe(true);
}, 20_000);

test("the tests that run Lumiverse's macro engine are given the checkout this one sits in, or the one LRE_HOST_REPO names, and the summary says which", async () => {
  const lumiverse = mkdtempSync(join(tmpdir(), "rpe-checkout-"));
  try {
    // A Lumiverse checkout, as far as the tests that run its macro engine need one, with this suite inside it.
    mkdirSync(join(lumiverse, "src/macros"), { recursive: true });
    writeFileSync(join(lumiverse, "src/macros/index.ts"), "export {};\n");
    const inside = join(lumiverse, "extensions/rpe");
    mkdirSync(join(inside, "test"), { recursive: true });
    writeFileSync(join(inside, "test/host.test.ts"), `import { expect, test } from "bun:test";\ntest("is given the checkout", () => expect(process.env.LRE_HOST_REPO).toBe(${JSON.stringify(lumiverse)}));\n`);
    expect(findHost(inside, {})).toEqual({ path: lumiverse, given: false });
    expect(findHost(inside, { LRE_HOST_REPO: "/elsewhere" })).toEqual({ path: "/elsewhere", given: true });
    expect(findHost(inside, { LRE_HOST_REPO: "" })).toEqual({ path: null, given: true });
    expect(findHost(root, {})).toEqual(NONE);
    const given = await runAll({ root: inside, jobs: 1, host: findHost(inside, {}) });
    expect(given.first).toMatchObject([{ file: "test/host.test.ts", ok: true, passed: 1 }]);
    expect(summarize(judge(given))).toContain("Lumiverse's own macro engine, for the tests that run it: ../.., the Lumiverse checkout this one sits in (LRE_HOST_REPO).");
    const said = (host: Host): string[] => summarize(judge({ ...given, host } satisfies AllRun));
    expect(said({ path: join(lumiverse, "other"), given: true })).toContain("Lumiverse's own macro engine, for the tests that run it: ../../other, as LRE_HOST_REPO gives it.");
    expect(said({ path: null, given: true })).toContain("Lumiverse's own macro engine, for the tests that run it: LRE_HOST_REPO is set empty, so they skip.");
    expect(said(NONE)).toContain("Lumiverse's own macro engine, for the tests that run it: no Lumiverse checkout above this one, so they skip (set LRE_HOST_REPO to one).");
  } finally {
    rmSync(lumiverse, { recursive: true, force: true });
  }
}, 20_000);
