// The test runs (README "Tests") besides the gate: what to run during a change, before a commit and
// at release. The gate, every test file each in a process of its own, is `bun run test`
// (scripts/test-all.ts).
//
//   bun scripts/test/run.ts               the tests for what changed since the branch left main, and in the working tree
//   bun scripts/test/run.ts --check       both typechecks and the generated files' checks, then those tests (`bun run check`)
//   bun scripts/test/run.ts --release     the release gate: the checks, then every test file through the per-file runner
//   bun scripts/test/run.ts --timings     records test/timings.json again (every test file, one after another in one process)
//   bun scripts/test/run.ts <test files>  these files
//
//   --base <ref>      compare with <ref> instead of main (HEAD: only what isn't committed yet)
//   --budget <s>      seconds of recorded test time for the tests taken nearest first (default 60)
//   --list            print the selection and stop; with --release, every test file the per-file runner runs
//   -- <args>         passed on to `bun test` (`-t <pattern>`, `--bail`)
//
// The tests for what changed run in one `bun test` process, a worker per core, slowest first by
// test/timings.json, whose times are each file's in one `bun test` process that runs them one after
// another: the unit `--budget` is in. The release runs every test file as the gate does, each in a
// process of its own (scripts/test-all.ts), ordered by the per-file runner's own recording,
// test/timings-all.json (`bun run test:timings`), of each file's whole process.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { changedSince, isTest, readRepo, readTimings, selectTests, type Pick } from "./select";
import { TIMEOUT_MS, judge, readKnown, runAll, summarize, testFiles } from "../test-all";

const ROOT = resolve(import.meta.dir, "../..");
const TIMINGS = "test/timings.json";

interface Args {
  mode: "changed" | "check" | "release" | "timings" | "files";
  base: string;
  budget: number;
  list: boolean;
  files: string[];
  bun: string[];
}

function parse(argv: readonly string[]): Args {
  const args: Args = { mode: "changed", base: "main", budget: 60, list: false, files: [], bun: [] };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--") {
      args.bun.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--check" || a === "--release" || a === "--timings") args.mode = a.slice(2) as Args["mode"];
    else if (a === "--list") args.list = true;
    else if (a === "--base") args.base = value(i++, a);
    else if (a === "--budget") args.budget = Number(value(i++, a));
    else if (a.startsWith("-")) args.bun.push(a);
    else args.files.push(a.replace(/^\.\//, ""));
  }
  if (args.files.length > 0 && args.mode === "changed") args.mode = "files";
  if (!Number.isFinite(args.budget) || args.budget < 0) throw new Error("--budget takes a number");
  return args;
}

interface Done {
  label: string;
  ok: boolean;
  ms: number;
  /** The output of a step that ran quietly, printed when it fails. */
  out: string;
}

/** Runs a command from the repository root; `quiet` keeps its output for a failure. */
function exec(label: string, cmd: readonly string[], options: { quiet?: boolean; env?: Record<string, string>; cwd?: string } = {}): Promise<Done> {
  const started = performance.now();
  const [file, ...rest] = cmd;
  if (file === undefined) throw new Error(`${label}: no command`);
  const child = spawn(file, rest, { cwd: options.cwd ?? ROOT, env: { ...process.env, ...options.env }, stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
  let out = "";
  child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString()));
  const { promise, resolve: done } = Promise.withResolvers<Done>();
  child.on("close", (code) => done({ label, ok: code === 0, ms: performance.now() - started, out }));
  return promise;
}

const bun = process.execPath;
const tsc = join(ROOT, "node_modules/.bin/tsc");

/** The tests in one `bun test` process; each file is told the per-test limit Bun is given, as the gate tells it (`RPE_TEST_LIMIT_MS`). */
function bunTest(label: string, files: readonly string[], extra: readonly string[], env: Record<string, string> = {}): Promise<Done> {
  return exec(label, [bun, "test", "--parallel", `--timeout=${TIMEOUT_MS}`, `--timings=${TIMINGS}`, ...extra, ...files.map((f) => `./${f}`)], { env: { RPE_TEST_LIMIT_MS: String(TIMEOUT_MS), ...env } });
}

/** Both typechecks and the generated files: the static half of `--check` and of the release gate. */
function checks(): Promise<Done[]> {
  return Promise.all([
    exec("typecheck: src, test and scripts", [tsc, "--noEmit", "-p", "."], { quiet: true }),
    exec("typecheck: dev/preview", [tsc, "--noEmit", "-p", "dev/preview"], { quiet: true }),
    exec("docs/REFERENCE.md is current", [bun, "scripts/reference/build.ts", "--check"], { quiet: true }),
    exec("the starter worlds are current", [bun, "scripts/templates/build.ts", "--check"], { quiet: true }),
    exec("the starter templates validate", [bun, "validate.ts"], { quiet: true, cwd: join(ROOT, "data-src/templates") }),
  ]);
}

/** Every test file through the per-file runner, each in a process of its own as `bun run test` runs them, judged as the gate judges them (its known failures reported with their owners), with that run's summary. */
async function suite(extra: readonly string[]): Promise<Done> {
  const started = performance.now();
  const judged = judge(await runAll({ jobs: Math.max(1, availableParallelism() - 2), files: testFiles(ROOT), bun: extra }), { known: readKnown(ROOT) });
  for (const line of summarize(judged)) console.log(line);
  return { label: `tests: every test file, each in a process of its own (${judged.run.first.length})`, ok: judged.ok, ms: performance.now() - started, out: "" };
}

function report(title: string, steps: readonly Done[], started: number): boolean {
  const failed = steps.filter((s) => !s.ok);
  for (const s of failed) if (s.out) console.log(`\n--- ${s.label}\n${s.out.trimEnd()}`);
  console.log(`\n${title} (${((performance.now() - started) / 1000).toFixed(1)} s):`);
  for (const s of steps) console.log(`  ${s.ok ? "ok  " : "FAIL"}  ${s.label}  ${(s.ms / 1000).toFixed(1)} s`);
  return failed.length === 0;
}

/** Prints what a targeted run takes and why; the nearest picks one by one, the rest counted. */
function describe(changed: readonly string[], since: string, base: string, run: readonly Pick[], left: readonly Pick[], uncovered: readonly string[], all: boolean, list: boolean): void {
  console.log(`Changed since ${base} (${since.slice(0, 8)}) and in the working tree: ${changed.length} file(s)`);
  for (const f of list || changed.length <= 12 ? changed : changed.slice(0, 12)) console.log(`  ${f}`);
  if (!list && changed.length > 12) console.log(`  … and ${changed.length - 12} more`);
  if (all) {
    console.log("A change to bunfig.toml, tsconfig.json or bun.lock reaches every test: running them all.");
    return;
  }
  const seconds = run.reduce((sum, p) => sum + p.ms, 0) / 1000;
  console.log(`Running ${run.length} test file(s), ${seconds.toFixed(0)} s of recorded test time:`);
  const shown = list ? run : run.filter((p) => !p.why.startsWith("reaches "));
  for (const p of shown) console.log(`  ${p.file}  (${p.why})`);
  const further = run.length - shown.length;
  if (further > 0) console.log(`  … and ${further} more that reach what changed through their imports (--list names them)`);
  if (left.length > 0) console.log(`${left.length} more test file(s) reach what changed but didn't fit the budget; \`bun run test\` runs every one.`);
  if (list) for (const p of left) console.log(`  not run: ${p.file}  (${p.why})`);
  if (uncovered.length > 0) console.log(`No test reaches: ${uncovered.join(", ")}`);
}

async function targeted(args: Args): Promise<Done | null> {
  const { since, files: changed } = changedSince(ROOT, args.base);
  const timings = readTimings(join(ROOT, TIMINGS));
  const selection = selectTests(readRepo(ROOT), changed, { timings, budget: args.budget * 1000, releaseOnly: [] });
  describe(changed, since, args.base, selection.run, selection.left, selection.uncovered, selection.all, args.list);
  if (args.list) return null;
  if (selection.all) return bunTest("tests: every test file", [], args.bun);
  if (selection.run.length === 0) {
    console.log("Nothing to run.");
    return null;
  }
  const files = selection.run.map((p) => p.file).sort();
  return bunTest(`tests: ${files.length} file(s) for what changed`, files, args.bun);
}

async function main(): Promise<boolean> {
  const args = parse(process.argv.slice(2));
  const started = performance.now();
  switch (args.mode) {
    case "changed": {
      const done = await targeted(args);
      return done?.ok ?? true;
    }
    case "files": {
      const missing = args.files.filter((f) => !isTest(f));
      if (missing.length > 0) throw new Error(`not test files: ${missing.join(", ")}`);
      return (await bunTest("tests", args.files, args.bun)).ok;
    }
    case "check": {
      const steps = await checks();
      const tests = await targeted(args);
      return report("Checks before a commit", tests ? [...steps, tests] : steps, started);
    }
    case "timings": {
      // One file after another in one process, as plain `bun test` runs them, so a file's time is its own and not a share of the machine's.
      rmSync(join(ROOT, TIMINGS), { force: true });
      return (await exec("timings", [bun, "test", `--timings=${TIMINGS}`, "--update-timings"])).ok;
    }
    case "release": {
      if (args.list) {
        for (const file of testFiles(ROOT)) console.log(file);
        return true;
      }
      const steps = await checks();
      const tests = suite(args.bun);
      const done = [...steps, await tests];
      return report("Release gate", done, started);
    }
  }
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
