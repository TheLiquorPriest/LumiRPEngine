// The test runs (README "Tests"): what to run during a change, before a commit and at release.
//
//   bun scripts/test/run.ts               the tests for what changed since the branch left main, and in the working tree
//   bun scripts/test/run.ts --check       both typechecks and the generated files' checks, then those tests
//   bun scripts/test/run.ts --all         every test file but the property suite
//   bun scripts/test/run.ts --release     the release gate: the checks, every test file, the property suite on the fixed seeds and fresh ones
//   bun scripts/test/run.ts --properties  the property suite alone, on the fixed seeds and fresh ones
//   bun scripts/test/run.ts --timings     records test/timings.json again (every test file but the property suite, one at a time)
//   bun scripts/test/run.ts <test files>  these files
//
//   --base <ref>      compare with <ref> instead of main (HEAD: only what isn't committed yet)
//   --budget <s>      seconds of recorded test time for the tests taken nearest first (default 60)
//   --list            print the selection and stop
//   --fresh <n>       fresh sequences for --release and --properties (default 200; 0 for none)
//   --seed-base <b>   the fresh sequences' seed base (default a new one), to run a release's again
//   -- <args>         passed on to `bun test` (`-t <pattern>`, `--bail`)
//
// Test files run in parallel, one process per core, slowest first by test/timings.json.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addCoverage, coverageGaps, noCoverage, type Coverage } from "../../test/support/coverage";
import { changedSince, isTest, readRepo, readTimings, selectTests, type Pick } from "./select";

const ROOT = resolve(import.meta.dir, "../..");
const TIMINGS = "test/timings.json";
const PROPERTIES = "test/ledger/properties.test.ts";
/** Bun's 5 s default guards against a hang; with every core busy, a test that takes 2 s alone can take longer than that. */
const TIMEOUT_MS = 30_000;
/** Sequences a shard of the fixed sample runs: a multiple of ten, so its L31 double runs are the whole run's. */
const FIXED_SHARD = 20;
/** Sequences a shard of fresh seeds runs: enough that each is held to the minds' coverage, as a run of 40 is. */
const FRESH_SHARD = 40;
/** The property suite's sequences when a targeted run takes it because its own code changed. */
const SMOKE_RUNS = "20";

interface Args {
  mode: "changed" | "check" | "all" | "release" | "properties" | "timings" | "files";
  base: string;
  budget: number;
  list: boolean;
  fresh: number;
  seedBase: string;
  files: string[];
  bun: string[];
}

function parse(argv: readonly string[]): Args {
  const args: Args = { mode: "changed", base: "main", budget: 60, list: false, fresh: 200, seedBase: `lre-${Date.now().toString(36)}`, files: [], bun: [] };
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
    if (a === "--check" || a === "--all" || a === "--release" || a === "--properties" || a === "--timings") args.mode = a.slice(2) as Args["mode"];
    else if (a === "--list") args.list = true;
    else if (a === "--base") args.base = value(i++, a);
    else if (a === "--budget") args.budget = Number(value(i++, a));
    else if (a === "--fresh") args.fresh = Number(value(i++, a));
    else if (a === "--seed-base") args.seedBase = value(i++, a);
    else if (a.startsWith("-")) args.bun.push(a);
    else args.files.push(a.replace(/^\.\//, ""));
  }
  if (args.files.length > 0 && args.mode === "changed") args.mode = "files";
  if (!Number.isFinite(args.budget) || args.budget < 0 || !Number.isInteger(args.fresh) || args.fresh < 0) throw new Error("--budget and --fresh take a number");
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

function bunTest(label: string, files: readonly string[], extra: readonly string[], env: Record<string, string> = {}): Promise<Done> {
  return exec(label, [bun, "test", "--parallel", `--timeout=${TIMEOUT_MS}`, `--timings=${TIMINGS}`, ...extra, ...files.map((f) => `./${f}`)], { env });
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

/**
 * The property suite in shards: the fixed sample's 200 sequences, held together to their coverage,
 * and `fresh` sequences from `seedBase`, each shard held to its own. `narrow` shards run at a time
 * until `widen` settles (the other test files are done with the cores), then one per core.
 */
async function properties(fresh: number, seedBase: string, narrow: number, widen: Promise<unknown>): Promise<Done[]> {
  const dir = mkdtempSync(join(tmpdir(), "lre-properties-"));
  const shard = (label: string, env: Record<string, string>) => async (): Promise<Done> => {
    // Every knob set, so a seed or a base left in the shell's environment can't change the gate's sequences.
    const done = await exec(label, [bun, "test", `./${PROPERTIES}`], { quiet: true, env: { LRE_PROPERTY_SEED: "", LRE_PROPERTY_OPS: "60", LRE_PROPERTY_COVERAGE: "", ...env } });
    console.log(`${done.ok ? "ok  " : "FAIL"} ${label} (${(done.ms / 1000).toFixed(1)} s)`);
    return done;
  };
  const fixed = Array.from({ length: 200 / FIXED_SHARD }, (_, k) => k * FIXED_SHARD);
  const freshFrom = Array.from({ length: Math.ceil(fresh / FRESH_SHARD) }, (_, k) => k * FRESH_SHARD);
  // The longer fresh shards first, so the last to finish is a short one.
  const tasks = [
    ...freshFrom.map((from) => {
      const runs = Math.min(FRESH_SHARD, fresh - from);
      return shard(`properties: ${seedBase}-${from}…${from + runs - 1}`, { LRE_PROPERTY_BASE: seedBase, LRE_PROPERTY_FROM: `${from}`, LRE_PROPERTY_RUNS: `${runs}` });
    }),
    ...fixed.map((from) => shard(`properties: lre-fixed-${from}…${from + FIXED_SHARD - 1}`, { LRE_PROPERTY_BASE: "lre-fixed", LRE_PROPERTY_FROM: `${from}`, LRE_PROPERTY_RUNS: `${FIXED_SHARD}`, LRE_PROPERTY_COVERAGE: join(dir, `${from}.json`) })),
  ];
  const started = performance.now();
  const results: Done[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      if (task) results[i] = await task();
    }
  };
  const workers = Array.from({ length: Math.min(narrow, tasks.length) }, worker);
  await widen;
  workers.push(...Array.from({ length: Math.max(0, availableParallelism() - narrow) }, worker));
  await Promise.all(workers);
  if (results.slice(freshFrom.length).every((r) => r.ok)) {
    const sum = noCoverage();
    let counted = 0;
    for (const from of fixed) {
      const shardRun = JSON.parse(readFileSync(join(dir, `${from}.json`), "utf8")) as { runs: number; coverage: Coverage };
      addCoverage(sum, shardRun.coverage);
      counted += shardRun.runs;
    }
    const gaps = coverageGaps(sum, counted);
    results.push({ label: `properties: the fixed sample reaches its coverage (${counted} sequences)`, ok: gaps.length === 0, ms: performance.now() - started, out: gaps.length > 0 ? `never reached: ${gaps.join(", ")}\n` : "" });
  }
  rmSync(dir, { recursive: true, force: true });
  return results;
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
  if (left.length > 0) console.log(`${left.length} more test file(s) reach what changed but didn't fit the budget; \`bun run test:all\` runs every one.`);
  if (list) for (const p of left) console.log(`  not run: ${p.file}  (${p.why})`);
  if (uncovered.length > 0) console.log(`No test reaches: ${uncovered.join(", ")}`);
}

async function targeted(args: Args): Promise<Done | null> {
  const { since, files: changed } = changedSince(ROOT, args.base);
  const timings = readTimings(join(ROOT, TIMINGS));
  const selection = selectTests(readRepo(ROOT), changed, { timings, budget: args.budget * 1000, releaseOnly: [PROPERTIES] });
  describe(changed, since, args.base, selection.run, selection.left, selection.uncovered, selection.all, args.list);
  if (args.list) return null;
  if (selection.all) return bunTest("tests: every test file but the property suite", [], [`--path-ignore-patterns=${PROPERTIES}`, ...args.bun]);
  if (selection.run.length === 0) {
    console.log("Nothing to run.");
    return null;
  }
  const files = selection.run.map((p) => p.file).sort();
  const env: Record<string, string> = files.includes(PROPERTIES) && process.env.LRE_PROPERTY_RUNS === undefined ? { LRE_PROPERTY_RUNS: SMOKE_RUNS } : {};
  if (env.LRE_PROPERTY_RUNS) console.log(`The property suite runs ${SMOKE_RUNS} sequences here; the release gate runs 200 fixed and ${200} fresh.`);
  return bunTest(`tests: ${files.length} file(s) for what changed`, files, args.bun, env);
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
    case "all":
      return (await bunTest("tests: every test file but the property suite", [], [`--path-ignore-patterns=${PROPERTIES}`, ...args.bun])).ok;
    case "properties": {
      const props = await properties(args.fresh, args.seedBase, availableParallelism(), Promise.resolve());
      if (args.fresh > 0) console.log(`Fresh sequences: LRE_PROPERTY_BASE=${args.seedBase} (LRE_PROPERTY_SEED=${args.seedBase}-<i> replays one).`);
      return report("Property suite", props, started);
    }
    case "timings": {
      // One file at a time, as plain `bun test` runs them, so a file's time is its own and not a share of the machine's.
      rmSync(join(ROOT, TIMINGS), { force: true });
      return (await exec("timings", [bun, "test", `--timings=${TIMINGS}`, "--update-timings", `--path-ignore-patterns=${PROPERTIES}`])).ok;
    }
    case "release": {
      const steps = await checks();
      const tests = bunTest("tests: every test file but the property suite", [], [`--path-ignore-patterns=${PROPERTIES}`, ...args.bun]);
      // The shards spend much of their time waiting on the fake host's event loop, so a few share
      // the cores with the test files, and the rest start as the files finish.
      const props = properties(args.fresh, args.seedBase, Math.max(2, Math.floor(availableParallelism() / 3)), tests);
      const done = [...steps, await tests, ...(await props)];
      if (args.fresh > 0) console.log(`Fresh sequences: LRE_PROPERTY_BASE=${args.seedBase} (LRE_PROPERTY_SEED=${args.seedBase}-<i> replays one).`);
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
