// The gate, `bun run test` (scripts/test-all.ts), on a suite of its own: every test file under test/
// runs in a process of its own; a file that fails among the others is run again alone; one that
// fails there too fails the run, named with its failing tests or what went wrong between them; one
// that passes alone failed only beside another file, and is named as a defect with its failing tests,
// so the run does not pass; one that never finishes is stopped at the limit and fails, named; what a
// file leaves in the temporary folder is named with it and fails the run; what follows `--` reaches
// each file's `bun test`; the summary gives the time against the bar and ends on the verdict, and the
// exit code follows it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { judge, parseArgs, runAll, summarize, testFiles, type AllRun, type Judged } from "../../../scripts/test-all";

const RPE = resolve(import.meta.dir, "../../..");

/** Writes a test file of the fixture suite: `body` after the imports every fixture file uses. */
const write = (root: string, file: string, body: string): void => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), `import { describe, expect, test } from "bun:test";\nimport { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";\n${body}\n`);
};

/** A suite's own `typecheck` that passes, for the fixtures whose subject is something else: the gate runs `bun run typecheck` in each whole run. */
const PACKAGE = `${JSON.stringify({ name: "fixture", private: true, scripts: { typecheck: "true" } })}\n`;

// Two files that share a folder of the suite's: the holder takes it while it runs, and the other
// file fails whenever it finds it taken, so it fails beside the holder and passes alone. They run in
// processes of their own, so the folder is the only signal between them, and each polls it for as
// long as the per-test limit the runner hands each file (`RPE_TEST_LIMIT_MS`) allows, less five
// seconds: a busy machine only makes them wait longer.
const HOLDER = `const shared = \`\${import.meta.dir}/../shared\`;
test("holds the shared folder while it runs", async () => {
  const by = Date.now() + Number(process.env.RPE_TEST_LIMIT_MS) - 5_000;
  mkdirSync(shared, { recursive: true });
  writeFileSync(\`\${shared}/busy\`, "");
  while (Date.now() < by && !existsSync(\`\${shared}/looked\`)) await Bun.sleep(25);
  rmSync(\`\${shared}/busy\`);
  writeFileSync(\`\${shared}/done\`, "");
});`;
const CLASH = `const shared = \`\${import.meta.dir}/../shared\`;
test("finds the shared folder free", async () => {
  const by = Date.now() + Number(process.env.RPE_TEST_LIMIT_MS) - 5_000;
  while (Date.now() < by && !existsSync(\`\${shared}/busy\`) && !existsSync(\`\${shared}/done\`)) await Bun.sleep(25);
  if (existsSync(\`\${shared}/busy\`)) {
    writeFileSync(\`\${shared}/looked\`, "");
    throw new Error("another file has the shared folder");
  }
});`;

let root = "";
let run: AllRun;
let judged: Judged;

/** The fixture suite: a file that fails alone, one that breaks before its tests, two that share a folder, two that see each other's globals if they share a process, and passing ones. */
function makeSuite(at: string): void {
  write(at, "test/passes.test.ts", 'test("one", () => expect(1).toBe(1));\ntest("two", () => expect(2).toBe(2));');
  write(at, "test/fails.test.ts", 'describe("a block", () => {\n  test("holds", () => expect(1).toBe(1));\n  test("does not hold", () => expect(1).toBe(2));\n});');
  write(at, "test/breaks.test.ts", 'throw new Error("broken before its tests");\ntest("never runs", () => {});');
  write(at, "test/holder.test.ts", HOLDER);
  write(at, "test/clash.test.ts", CLASH);
  // Each file's own process: a global one file sets is not there in another.
  write(at, "test/deep/apart-one.test.ts", 'test("sets a global", () => {\n  (globalThis as Record<string, unknown>).seen = true;\n});');
  write(at, "test/deep/apart-two.test.ts", 'test("sees no other file\'s global", () => expect((globalThis as Record<string, unknown>).seen).toBeUndefined());');
  writeFileSync(join(at, "test/helper.ts"), "export const notATest = true;\n");
  writeFileSync(join(at, "package.json"), PACKAGE);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "rpe-runner-"));
  makeSuite(root);
  // Every file at once, so the two that share a folder run side by side.
  run = await runAll({ root, jobs: 7 });
  judged = judge(run);
}, 60_000);

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

const of = (file: string) => run.first.find((r) => r.file === file);
const aloneOf = (file: string) => run.alone.find((r) => r.file === file);

test("runs every test file under test/, each in a process of its own, and nothing else", () => {
  expect(testFiles(root)).toEqual(["test/breaks.test.ts", "test/clash.test.ts", "test/deep/apart-one.test.ts", "test/deep/apart-two.test.ts", "test/fails.test.ts", "test/holder.test.ts", "test/passes.test.ts"]);
  expect(run.first.map((r) => r.file).sort()).toEqual(testFiles(root));
  expect(of("test/deep/apart-two.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(of("test/passes.test.ts")).toMatchObject({ ok: true, passed: 2, failed: [], error: null });
});

test("a file that fails alone fails the run; one that fails only beside another file is a defect, named with its tests, and the run does not pass; a passing file passes", () => {
  // Every file that failed among the others ran again alone, and only those.
  expect(run.alone.map((r) => r.file).sort()).toEqual(["test/breaks.test.ts", "test/clash.test.ts", "test/fails.test.ts"]);
  expect(judged.failed.map((r) => r.file).sort()).toEqual(["test/breaks.test.ts", "test/fails.test.ts"]);
  expect(aloneOf("test/fails.test.ts")).toMatchObject({ ok: false, passed: 1, failed: ["a block > does not hold"], error: null });
  expect(aloneOf("test/breaks.test.ts")).toMatchObject({ ok: false, passed: 0, failed: [], error: "broken before its tests" });
  // The defect is named with the tests that failed beside the holder, though it passed alone.
  expect(aloneOf("test/clash.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(judged.beside.map((r) => ({ file: r.file, failed: r.failed }))).toEqual([{ file: "test/clash.test.ts", failed: ["finds the shared folder free"] }]);
  expect(of("test/holder.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(judged.ok).toBe(false);
});

test("the summary names what failed alone and why, each defect with its failing tests, the slowest files, and ends on the verdict", () => {
  const lines = summarize(judged);
  // Every test that passed: the clash's as it passed alone, and the one that holds in the file that fails.
  expect(lines).toContain("Every test file, each in a process of its own: 7 files, 7 tests passed.");
  const failing = lines.slice(lines.indexOf("Failed, also when run alone (2):") + 1, lines.findIndex((l) => l.startsWith("Defects:")));
  expect(failing).toHaveLength(4);
  expect(failing[failing.indexOf("  test/fails.test.ts") + 1]).toBe("    a block > does not hold");
  expect(failing[failing.indexOf("  test/breaks.test.ts") + 1]).toBe("    broken before its tests");
  const defects = lines.indexOf("Defects: failed beside the other files and passed when run again alone (1):");
  expect(lines.slice(defects + 1, defects + 3)).toEqual(["  test/clash.test.ts", "    finds the shared folder free"]);
  const slowest = lines.slice(lines.indexOf("The ten slowest files in this run:") + 1, -1);
  expect(slowest).toHaveLength(7);
  expect(slowest.every((l) => /^ +\d+\.\d s {2}test\//.test(l))).toBe(true);
  expect(lines.at(-1)).toBe("Verdict: fail: 2 files failed; 1 file failed only beside the others.");
});

/** The command, run on a fixture suite: its exit code and what it printed. */
async function cli(at: string, ...args: string[]): Promise<{ code: number; out: string }> {
  rmSync(join(at, "shared"), { recursive: true, force: true });
  const child = Bun.spawn([process.execPath, "scripts/test-all.ts", "--root", at, ...args], { cwd: RPE, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, out };
}

test("the command exits 1 on that suite, naming the defect, and 0 on a suite that passes", async () => {
  const failing = await cli(root, "7");
  expect(failing.code).toBe(1);
  expect(failing.out).toContain("Defects: failed beside the other files and passed when run again alone (1):\n  test/clash.test.ts\n    finds the shared folder free\n");
  // What it came to, file by file, as data for the checks that read the last whole-suite run.
  const recorded = JSON.parse(readFileSync(join(root, ".cache/suite.json"), "utf8")) as { verdict: string; whole: boolean; typecheck: { ok: boolean }; files: { file: string; result: string; failed: string[] }[] };
  expect([recorded.verdict, recorded.whole, recorded.typecheck.ok]).toEqual(["fail", true, true]);
  const result = Object.fromEntries(recorded.files.map((f) => [f.file, f.result]));
  expect(result).toEqual({ "test/breaks.test.ts": "failed", "test/clash.test.ts": "beside", "test/deep/apart-one.test.ts": "passed", "test/deep/apart-two.test.ts": "passed", "test/fails.test.ts": "failed", "test/holder.test.ts": "passed", "test/passes.test.ts": "passed" });
  expect(recorded.files.find((f) => f.file === "test/clash.test.ts")?.failed).toEqual(["finds the shared folder free"]);
  const passing = mkdtempSync(join(tmpdir(), "rpe-runner-passing-"));
  try {
    write(passing, "test/passes.test.ts", 'test("one", () => expect(1).toBe(1));');
    writeFileSync(join(passing, "package.json"), PACKAGE);
    const passed = await cli(passing);
    expect(passed.out.trimEnd().split("\n").at(-1)).toBe("Verdict: pass.");
    expect(passed.code).toBe(0);
  } finally {
    rmSync(passing, { recursive: true, force: true });
  }
}, 60_000);

test("the summary gives the wall time with the cores used and the machine's load, set against the bar, which is a measure to report and never fails the run", async () => {
  const timed = (ms: number, ok = true): AllRun => {
    const one = { file: "test/a.test.ts", ok, passed: ok ? 3 : 2, failed: ok ? [] : ["does not hold"], error: null, ms: 900, left: [], skipped: [] };
    return { root: RPE, jobs: 10, cores: 12, host: { path: null, given: false }, filtered: false, untimed: [], load: { before: 9.2, after: 11.4 }, ms, first: [one], alone: ok ? [] : [one] };
  };
  const within = summarize(judge(timed(233_000), { budgetMs: 360_000 }));
  expect(within).toContain("Time: 3 min 53 s, on 10 of the machine's 12 cores (a file on each): within the bar of 6 min (--budget 360).");
  expect(within).toContain("Load: the machine's load average was 9.2 when the run began and 11.4 when it ended, on 12 cores, 2 of them left to other work.");
  expect(within.some((line) => line.startsWith("Over the bar"))).toBe(false);
  expect(within.at(-1)).toBe("Verdict: pass.");
  // Over the bar: said plainly, with the load, and the code's verdict stands.
  const over = judge(timed(400_000), { budgetMs: 360_000 });
  expect(over).toMatchObject({ overBar: true, ok: true });
  expect(summarize(over)).toContain("Time: 6 min 40 s, on 10 of the machine's 12 cores (a file on each): over the bar of 6 min (--budget 360).");
  expect(summarize(over).slice(-2)).toEqual(["Over the bar: 6 min 40 s against 6 min, with the machine's load average at 9.2 when the run began. That is a measure to report, not a failure of the code.", "Verdict: pass."]);
  // A run over the bar whose code fails, fails for its code alone.
  expect(summarize(judge(timed(400_000, false), { budgetMs: 360_000 })).at(-1)).toBe("Verdict: fail: 1 file failed.");
  // A recording's time is printed and not set against the bar.
  expect(summarize(judge(timed(400_000), { budgetMs: null }))).toContain("Time: 6 min 40 s, on 10 of the machine's 12 cores (a file on each): its time is not set against the bar in this run.");
  // The command: the bar it was given and the load, printed; a run over the bar still exits on its code.
  const at = mkdtempSync(join(tmpdir(), "rpe-runner-bar-"));
  try {
    write(at, "test/passes.test.ts", 'test("one", () => expect(1).toBe(1));');
    writeFileSync(join(at, "package.json"), PACKAGE);
    const ran = await cli(at, "1");
    expect(ran.out).toMatch(/^Time: \d+ s, on 1 of the machine's \d+ cores \(a file on each\): within the bar of 6 min \(--budget 360\)\.$/m);
    expect(ran.out).toMatch(/^Load: the machine's load average was \d+\.\d when the run began and \d+\.\d when it ended, on \d+ cores, \d+ of them left to other work\.$/m);
    const short = await cli(at, "1", "--budget", "0.001");
    expect(short.out).toMatch(/^Time: \d+ s, on 1 of the machine's \d+ cores \(a file on each\): over the bar of 0 s \(--budget 0\.001\)\.$/m);
    const [said, verdict] = short.out.trimEnd().split("\n").slice(-2);
    expect(said).toMatch(/^Over the bar: \d+ s against 0 s, with the machine's load average at \d+\.\d when the run began\. That is a measure to report, not a failure of the code\.$/);
    expect(verdict).toBe("Verdict: pass.");
    expect(short.code).toBe(0);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}, 30_000);

test("what a file leaves in the temporary folder is named with that file and fails the run; the runner leaves nothing of its own", async () => {
  const at = mkdtempSync(join(tmpdir(), "rpe-runner-left-"));
  // The run's own folder is made in this test's temporary folder, so whatever the runner itself left would show here.
  const own = mkdtempSync(join(tmpdir(), "rpe-runner-own-"));
  const given = process.env.TMPDIR;
  try {
    write(at, "test/leaves.test.ts", 'import { tmpdir } from "node:os";\nimport { mkdtempSync } from "node:fs";\ntest("makes a folder and a file in the temporary folder and keeps them", () => {\n  mkdtempSync(`${tmpdir()}/left-behind-`);\n  writeFileSync(`${tmpdir()}/stray.txt`, "");\n});');
    write(at, "test/tidy.test.ts", 'import { tmpdir } from "node:os";\nimport { mkdtempSync } from "node:fs";\ntest("makes a folder in the temporary folder and takes it away", () => {\n  rmSync(mkdtempSync(`${tmpdir()}/tidy-`), { recursive: true });\n});');
    process.env.TMPDIR = own;
    const judged = judge(await runAll({ root: at, jobs: 2 }));
    if (given === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = given;
    expect(judged.left.map((l) => `${l.file}: ${l.name.replace(/^left-behind-\w+/, "left-behind-")}`)).toEqual(["test/leaves.test.ts: left-behind-/", "test/leaves.test.ts: stray.txt"]);
    const lines = summarize(judged);
    const left = lines.indexOf("Left in the temporary folder, each after the file that left it (2):");
    expect(lines[left + 1]).toMatch(/^ {2}test\/leaves\.test\.ts: left-behind-\w+\/$/);
    expect(lines[left + 2]).toBe("  test/leaves.test.ts: stray.txt");
    expect(lines.at(-1)).toBe("Verdict: fail: 2 things left in the temporary folder.");
    expect(readdirSync(own)).toEqual([]);
  } finally {
    if (given === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = given;
    rmSync(at, { recursive: true, force: true });
    rmSync(own, { recursive: true, force: true });
  }
}, 30_000);

test("the gate runs the suite's own typecheck beside the files, prints what it said, and fails when it fails", async () => {
  const at = mkdtempSync(join(tmpdir(), "rpe-runner-types-"));
  try {
    write(at, "test/passes.test.ts", 'test("one", () => expect(1).toBe(1));');
    mkdirSync(join(at, "src"));
    writeFileSync(join(at, "src/sum.ts"), 'export const total: number = "not a number";\n');
    writeFileSync(join(at, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["src"] })}\n`);
    writeFileSync(join(at, "package.json"), `${JSON.stringify({ name: "fixture", private: true, scripts: { typecheck: `${join(RPE, "node_modules/.bin/tsc")} --noEmit -p .` } })}\n`);
    const broken = await cli(at, "1");
    expect(broken.code).toBe(1);
    expect(broken.out).toMatch(/^Typecheck \(bun run typecheck\): failed in \d+\.\d s:$/m);
    expect(broken.out).toContain("    src/sum.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(broken.out.trimEnd().split("\n").at(-1)).toBe("Verdict: fail: the typecheck failed.");
    writeFileSync(join(at, "src/sum.ts"), "export const total: number = 3;\n");
    const mended = await cli(at, "1");
    expect(mended.out).toMatch(/^Typecheck \(bun run typecheck\): passed in \d+\.\d s\.$/m);
    expect(mended.out.trimEnd().split("\n").at(-1)).toBe("Verdict: pass.");
    expect(mended.code).toBe(0);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}, 60_000);

test("a file that never finishes is stopped at the limit, in its first run and run again alone, and fails the run named as one that never finished", async () => {
  const hung = mkdtempSync(join(tmpdir(), "rpe-runner-hung-"));
  try {
    mkdirSync(join(hung, "test"));
    // Its top level never finishes loading: what it starts never lets go.
    writeFileSync(join(hung, "test/hangs.test.ts"), 'import { test } from "bun:test";\nawait new Promise(() => setInterval(() => undefined, 1000));\ntest("never reached", () => {});\n');
    // A real limit, and short: the file runs in a process of its own, whose time no fake clock here
    // moves. It is the suite's only file, so the short limit stops nothing that would have finished.
    const stopped = await runAll({ root: hung, jobs: 1, limitMs: 1500 });
    const runs = [...stopped.first, ...stopped.alone];
    expect(runs.map((r) => [r.file, r.ok])).toEqual([["test/hangs.test.ts", false], ["test/hangs.test.ts", false]]);
    expect(runs.every((r) => r.error?.includes("never finished"))).toBe(true);
    const lines = summarize(judge(stopped));
    const failing = lines.slice(lines.indexOf("Failed, also when run alone (1):") + 1);
    expect(failing[0]).toBe("  test/hangs.test.ts");
    expect(failing[1]).toContain("never finished");
  } finally {
    rmSync(hung, { recursive: true, force: true });
  }
}, 20_000);

test("what follows `--` goes on to each file's `bun test`: a pattern runs only the tests it names, and a file it names none of passes", async () => {
  expect(parseArgs(["-t", "one"])).toMatchObject({ mode: "gate", jobs: null, bun: ["-t", "one"] });
  expect(parseArgs(["6", "--", "-t", "one"])).toMatchObject({ mode: "gate", jobs: 6, bun: ["-t", "one"] });
  expect(parseArgs(["--record"])).toMatchObject({ mode: "record", jobs: null, bun: [] });
  expect(parseArgs(["--strike"])).toMatchObject({ mode: "strike", jobs: null, strikeFiles: [], bun: [] });
  expect(parseArgs(["--strike", "./test/a.test.ts", "test/b.test.ts"])).toMatchObject({ mode: "strike", strikeFiles: ["test/a.test.ts", "test/b.test.ts"] });
  expect(parseArgs(["--root", "elsewhere", "3"])).toMatchObject({ mode: "gate", jobs: 3, root: "elsewhere", bun: [] });
  // Anything else is refused with the usage line, and so is a recording of filtered files, and a strike given Bun's arguments or a number of files at once.
  expect(parseArgs(["six"])).toBeNull();
  expect(parseArgs(["--record", "--", "-t", "one"])).toBeNull();
  expect(parseArgs(["--strike", "--", "-t", "one"])).toBeNull();
  expect(parseArgs(["3", "--strike"])).toBeNull();
  const named = await runAll({ root, jobs: 2, files: ["test/passes.test.ts", "test/fails.test.ts"], bun: ["-t", "^one$"] });
  expect(named.first.find((r) => r.file === "test/passes.test.ts")).toMatchObject({ ok: true, passed: 1 });
  expect(named.first.find((r) => r.file === "test/fails.test.ts")).toMatchObject({ ok: true, passed: 0 });
  expect(named.alone).toEqual([]);
}, 20_000);
