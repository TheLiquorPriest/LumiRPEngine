// `bun run test:all` (scripts/test-all.ts) on a suite of its own: every file runs in a process of its
// own; a file that fails among the others is run again alone and counts as failing only if it fails
// there too, named with its failing tests or what went wrong between them; one that passes alone is
// listed as passed alone; one that never finishes is stopped at the limit and fails, named; what
// follows `--` reaches each file's `bun test`; the summary says how long the run took and which files
// were slowest.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, runAll, summarize, testFiles, type AllRun } from "../../scripts/test-all";

let root = "";
let run: AllRun;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "lre-test-all-"));
  mkdirSync(join(root, "test/deep"), { recursive: true });
  const write = (file: string, body: string): void => writeFileSync(join(root, file), `import { describe, expect, test } from "bun:test";\nimport { existsSync, writeFileSync } from "node:fs";\n${body}\n`);
  write("test/passes.test.ts", 'test("one", () => expect(1).toBe(1));\ntest("two", () => expect(2).toBe(2));');
  write("test/fails.test.ts", 'describe("a block", () => {\n  test("holds", () => expect(1).toBe(1));\n  test("does not hold", () => expect(1).toBe(2));\n});');
  // Fails the first time it runs and passes the next, as a test starved among the others passes alone.
  write("test/deep/starved.test.ts", 'test("in time alone", () => {\n  const ran = `${import.meta.dir}/ran`;\n  if (!existsSync(ran)) {\n    writeFileSync(ran, "");\n    throw new Error("out of time among the others");\n  }\n});');
  write("test/breaks.test.ts", 'throw new Error("broken before its tests");\ntest("never runs", () => {});');
  // Each file's own process: a global one file sets is not there in another.
  write("test/deep/apart-one.test.ts", 'test("sets a global", () => {\n  (globalThis as Record<string, unknown>).seen = true;\n});');
  write("test/deep/apart-two.test.ts", 'test("sees no other file\'s global", () => expect((globalThis as Record<string, unknown>).seen).toBeUndefined());');
  writeFileSync(join(root, "test/helper.ts"), "export const notATest = true;\n");
  run = await runAll({ root, jobs: 3 });
}, 60_000);

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

const of = (file: string) => run.first.find((r) => r.file === file);

test("runs every test file under test/, each in a process of its own, and nothing else", () => {
  expect(testFiles(root).sort()).toEqual(["test/breaks.test.ts", "test/deep/apart-one.test.ts", "test/deep/apart-two.test.ts", "test/deep/starved.test.ts", "test/fails.test.ts", "test/passes.test.ts"]);
  expect(run.first.map((r) => r.file).sort()).toEqual(testFiles(root).sort());
  expect(of("test/deep/apart-two.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(of("test/passes.test.ts")).toMatchObject({ ok: true, passed: 2, failed: [], error: null });
});

test("a file that fails among the others runs again alone, and fails the run only if it fails there too", () => {
  expect(run.alone.map((r) => r.file).sort()).toEqual(["test/breaks.test.ts", "test/deep/starved.test.ts", "test/fails.test.ts"]);
  expect(run.alone.find((r) => r.file === "test/deep/starved.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(run.alone.find((r) => r.file === "test/fails.test.ts")).toMatchObject({ ok: false, passed: 1, failed: ["a block > does not hold"], error: null });
  expect(run.alone.find((r) => r.file === "test/breaks.test.ts")).toMatchObject({ ok: false, passed: 0, failed: [], error: "broken before its tests" });
});

test("the summary gives the wall time, the tests passed, what failed alone too and why, what passed alone, and the slowest files", () => {
  const lines = summarize(run);
  expect(lines).toContain(`Every test file, each in a process of its own, 3 at a time: ${Math.round(run.ms / 1000)} s.`);
  // Every test that passed: the starved file's as it passed alone, and the one that holds in the file that fails.
  expect(lines).toContain("6 files, 6 tests passed.");
  const failing = lines.slice(lines.indexOf("Failed, also when run alone (2):") + 1, lines.findIndex((l) => l.startsWith("Passed alone")));
  expect(failing).toHaveLength(4);
  expect(failing[failing.indexOf("  test/fails.test.ts") + 1]).toBe("    a block > does not hold");
  expect(failing[failing.indexOf("  test/breaks.test.ts") + 1]).toBe("    broken before its tests");
  const slowest = lines.slice(lines.indexOf("The ten slowest files in this run:") + 1);
  expect(slowest).toHaveLength(6);
  expect(slowest.every((l) => /^ +\d+\.\d s {2}test\//.test(l))).toBe(true);
});

test("a file that never finishes is stopped at the limit, among the others and alone, and fails the run named as one that never finished", async () => {
  const hung = mkdtempSync(join(tmpdir(), "lre-test-all-hung-"));
  try {
    mkdirSync(join(hung, "test"));
    // Its top level never finishes loading: what it starts never lets go.
    writeFileSync(join(hung, "test/hangs.test.ts"), 'import { test } from "bun:test";\nawait new Promise(() => setInterval(() => undefined, 1000));\ntest("never reached", () => {});\n');
    writeFileSync(join(hung, "test/passes.test.ts"), 'import { expect, test } from "bun:test";\ntest("one", () => expect(1).toBe(1));\n');
    // A real limit, and short: the file runs in a process of its own, whose time no fake clock here moves.
    const stopped = await runAll({ root: hung, jobs: 2, limitMs: 1500 });
    expect(stopped.first.find((r) => r.file === "test/passes.test.ts")).toMatchObject({ ok: true, passed: 1 });
    const runs = [...stopped.first, ...stopped.alone].filter((r) => r.file === "test/hangs.test.ts");
    expect(runs.map((r) => r.ok)).toEqual([false, false]);
    expect(runs.every((r) => r.error?.includes("never finished"))).toBe(true);
    const lines = summarize(stopped);
    const failing = lines.slice(lines.indexOf("Failed, also when run alone (1):") + 1);
    expect(failing[0]).toBe("  test/hangs.test.ts");
    expect(failing[1]).toContain("never finished");
  } finally {
    rmSync(hung, { recursive: true, force: true });
  }
}, 20_000);

test("what follows `--` goes on to each file's `bun test`: a pattern runs only the tests it names, and a file it names none of passes", async () => {
  expect(parseArgs(["-t", "one"])).toEqual({ record: false, jobs: null, bun: ["-t", "one"] });
  expect(parseArgs(["6", "--", "-t", "one"])).toEqual({ record: false, jobs: 6, bun: ["-t", "one"] });
  expect(parseArgs(["--record"])).toEqual({ record: true, jobs: null, bun: [] });
  // Anything else is refused with the usage line, and so is a recording of filtered files.
  expect(parseArgs(["six"])).toBeNull();
  expect(parseArgs(["--record", "--", "-t", "one"])).toBeNull();
  const named = await runAll({ root, jobs: 2, files: ["test/passes.test.ts", "test/fails.test.ts"], bun: ["-t", "^one$"] });
  expect(named.first.find((r) => r.file === "test/passes.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(named.first.find((r) => r.file === "test/fails.test.ts")).toMatchObject({ ok: true, passed: 0 });
  expect(named.alone).toEqual([]);
}, 20_000);
