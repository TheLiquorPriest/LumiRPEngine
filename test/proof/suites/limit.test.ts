// Each test file is told its per-test limit, the one the runner gives Bun, in `RPE_TEST_LIMIT_MS`,
// so a guard over a long fixture takes the runner's limit rather than a number fixed in the file
// (READINGS R-15: a timing test in the suite is a guard, not the gate). And the busy-cores fixture
// (`bun scripts/test-all.ts --busy <file>`) runs a file as the gate runs it, with a process spinning
// on every core from before the file starts until after it ends, and says that it did.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { TIMEOUT_MS, busy, runAll, summarizeBusy, type Busy } from "../../../scripts/test-all";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "rpe-limit-"));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "test/told.test.ts"), `import { expect, test } from "bun:test";\ntest("is told the runner's per-test limit", () => expect(process.env.RPE_TEST_LIMIT_MS).toBe("${TIMEOUT_MS}"));\n`);
  // A real wait, five times the limit: it is Bun's own clock in the file's own process that stops it,
  // and a limit of two seconds stops it on a busy machine as on a quiet one.
  writeFileSync(join(root, "test/held.test.ts"), 'import { expect, test } from "bun:test";\ntest("is told the limit", () => expect(process.env.RPE_TEST_LIMIT_MS).toBe("2000"));\ntest("is held to it", async () => {\n  await Bun.sleep(10_000);\n});\n');
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

test("a test file reads RPE_TEST_LIMIT_MS, and it is the per-test limit Bun holds each of its tests to", async () => {
  const told = await runAll({ root, jobs: 1, files: ["test/told.test.ts"] });
  expect(told.first).toMatchObject([{ file: "test/told.test.ts", ok: true, passed: 1 }]);
  // With a limit of its own, the file is told that limit, and Bun stops the test that runs past it.
  const held = await runAll({ root, jobs: 1, files: ["test/held.test.ts"], testLimitMs: 2000 });
  expect(held.first).toMatchObject([{ file: "test/held.test.ts", ok: false, passed: 1, failed: ["is held to it"] }]);
}, 30_000);

test("the busy-cores fixture runs a file with a process spinning on every core throughout, and says so", async () => {
  const loaded = await busy({ root, file: "test/told.test.ts" });
  expect(loaded.burners).toHaveLength(availableParallelism());
  expect(loaded.burners.every((b) => b.throughout && b.cpuMs > 0)).toBe(true);
  expect(loaded.run).toMatchObject({ file: "test/told.test.ts", ok: true, passed: 1 });
  const lines = summarizeBusy(loaded);
  expect(lines[1]).toMatch(new RegExp(`^With every core busy: ${availableParallelism()} processes, one per core, kept spinning from before test/told\\.test\\.ts started until after it ended, and used \\d+\\.\\d s of CPU between them in its \\d+\\.\\d s\\.$`));
  expect(lines.slice(2)).toEqual(["test/told.test.ts passed: 1 test.", "Verdict: pass."]);
}, 30_000);

test("a run in which a core was let go is said to be one, and does not pass", () => {
  const run = { file: "test/told.test.ts", ok: true, passed: 1, failed: [], error: null, ms: 400, left: [], skipped: [] };
  const partly: Busy = { run, burners: [{ throughout: true, cpuMs: 400 }, { throughout: false, cpuMs: 120 }] };
  expect(summarizeBusy(partly)).toEqual(["", "Not every core was busy: only 1 of 2 processes, one per core, kept spinning until test/told.test.ts ended.", "test/told.test.ts passed: 1 test.", "Verdict: fail: not every core was busy throughout."]);
});
