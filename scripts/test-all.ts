// `bun run test:all [n] [-- <bun test arguments>]`: every test file under test/, each in a process of
// its own, as `bun test <file>` runs it alone (files of this suite interfere when they share one), n
// at a time: by default the machine's cores less two, and never more than its cores, so each file
// has a core to itself. What follows `--` (or the first argument that starts with "-") goes on to
// each file's `bun test`, as `-t <pattern>` does; a file none of whose tests the pattern names runs
// nothing, and that fails nothing. The slowest start first, by their times in
// test/timings-all.json, and a file the record doesn't list before them all, so no long file is left
// running by itself at the end.
//
// A file that fails is run again once the others are done, alone: it fails the run only if it fails
// alone too, and is listed as passed alone otherwise. A file still running after `FILE_LIMIT_MS`
// never finished (its top level never finished loading, or something it started never let go): it
// is stopped, and fails as one that never finished, so the run always ends with its summary. Each
// test has `TIMEOUT_MS`, as in the repository's other parallel runs (scripts/test/run.ts): with
// every core busy a test that takes two seconds alone can take longer than Bun's five, and thirty
// still ends a hang. The summary gives the wall time, the files and the tests passed, each file that
// failed alone with its failing tests' names, the files that passed alone, and the ten slowest
// files. The exit code is 1 when a file failed alone.
//
// `bun run test:timings` (`--record`) runs every file a third of the cores at a time, so each runs as
// it would alone, and writes each one's time, its whole process's, to test/timings-all.json, which
// this run's order reads. `bun run test` (scripts/test/run.ts) budgets by a recording of its own,
// test/timings.json: each file's time in one `bun test` process that runs them one after another,
// without the starting and loading a process of its own spends, which is most of most files' time
// here. The two are kept apart, so neither run reads times in the other's unit.
//
// The property suite (test/ledger/properties.test.ts) runs its everyday sample here, as everywhere
// its count isn't set; `bun run test:properties` runs it whole.

import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { isTest, readTimings } from "./test/select";

const ROOT = resolve(import.meta.dir, "..");
const TIMINGS = "test/timings-all.json";
/** Each test's limit in a parallel run: Bun's 5 s default guards against a hang, and with every core busy a test that takes 2 s alone can take longer than that. */
export const TIMEOUT_MS = 30_000;
/** How long one file may run before it is stopped as one that never finished: the slowest file takes about a minute and a quarter alone, and a few times that with every core busy. */
const FILE_LIMIT_MS = 10 * 60_000;

/** One file's run: whether it passed, its tests passed and failed, and what failed between its tests. */
export interface FileRun {
  file: string;
  ok: boolean;
  passed: number;
  /** The failing tests' names, each after the blocks it is in (`block > test`). */
  failed: string[];
  /** The first error Bun reported between the tests, or how the process ended when no failing test says why. */
  error: string | null;
  ms: number;
}

export interface AllRun {
  jobs: number;
  ms: number;
  /** Each file's run among the others, in the order they ended. */
  first: FileRun[];
  /** The run alone of each file that failed among the others. */
  alone: FileRun[];
}

/** Every test file under `root`'s test/, as `bun test` finds them there. */
export function testFiles(root: string): string[] {
  return [...new Bun.Glob("test/**/*.test.{ts,tsx}").scanSync({ cwd: root })].map((file) => file.split("\\").join("/")).filter(isTest);
}

/** Runs `file` as `bun test <file>` runs it, Bun given `bun` too, and reads Bun's report of it; stopped after `limitMs`, as one that never finished. */
async function runFile(root: string, file: string, bun: readonly string[], limitMs: number): Promise<FileRun> {
  const started = performance.now();
  // A file none of whose tests a `-t` pattern names runs no test, which fails nothing.
  const child = Bun.spawn([process.execPath, "test", `--timeout=${TIMEOUT_MS}`, "--pass-with-no-tests", ...bun, `./${file}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const limit = Promise.withResolvers<null>();
  const timer = setTimeout(() => limit.resolve(null), limitMs);
  const done = await Promise.race([Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]), limit.promise]);
  clearTimeout(timer);
  if (done === null) {
    // Its output isn't waited for: whatever it started may hold that open after it is stopped.
    child.kill("SIGKILL");
    return { file, ok: false, passed: 0, failed: [], error: `it never finished: it was still running after ${limitMs / 1000} s, so it was stopped`, ms: performance.now() - started };
  }
  const [out, err, code] = done;
  const text = `${out}\n${err}`;
  const counted = /^ (\d+) pass$/m.exec(text);
  const failed = [...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => m[1] ?? "");
  const between = /# Unhandled error between tests[\s\S]*?^error: (.+)$/m.exec(text)?.[1];
  const ended = failed.length === 0 || counted === null ? `it ended with exit code ${code}${counted === null ? ", before Bun counted its tests" : ""}` : null;
  return { file, ok: code === 0, passed: Number(counted?.[1] ?? 0), failed, error: code === 0 ? null : (between ?? ended), ms: performance.now() - started };
}

/**
 * Runs `files` (all of `root`'s test files when not given), `jobs` at a time, the slowest by
 * `root`'s test/timings-all.json first and the files it doesn't list before them; then each file
 * that failed, again, alone. `bun`: what each file's `bun test` is given too; `limitMs`: how long a
 * file may run (`FILE_LIMIT_MS`). `heard` hears each file's first run as it ends.
 */
export async function runAll(options: { root?: string; jobs: number; files?: readonly string[]; bun?: readonly string[]; limitMs?: number; heard?: (run: FileRun, done: number, of: number) => void }): Promise<AllRun> {
  const root = options.root ?? ROOT;
  const bun = options.bun ?? [];
  const limitMs = options.limitMs ?? FILE_LIMIT_MS;
  const timings = readTimings(join(root, TIMINGS));
  const queue = [...(options.files ?? testFiles(root))].sort((a, b) => (timings.get(b) ?? Infinity) - (timings.get(a) ?? Infinity) || a.localeCompare(b));
  const of = queue.length;
  const started = performance.now();
  const first: FileRun[] = [];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const run = await runFile(root, file, bun, limitMs);
      first.push(run);
      options.heard?.(run, first.length, of);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.jobs, of)) }, worker));
  const alone: FileRun[] = [];
  for (const run of first) if (!run.ok) alone.push(await runFile(root, run.file, bun, limitMs));
  return { jobs: options.jobs, ms: performance.now() - started, first, alone };
}

/** What a run came to, in short: the lines printed at its end. */
export function summarize(run: AllRun): string[] {
  const aloneOf = new Map(run.alone.map((r) => [r.file, r]));
  const last = run.first.map((r) => aloneOf.get(r.file) ?? r);
  const failing = run.alone.filter((r) => !r.ok);
  const passedAlone = run.first.filter((r) => !r.ok && aloneOf.get(r.file)?.ok === true);
  const wall = Math.round(run.ms / 1000);
  const lines = [
    "",
    `Every test file, each in a process of its own, ${run.jobs} at a time: ${wall >= 60 ? `${Math.floor(wall / 60)} min ` : ""}${wall % 60} s.`,
    `${run.first.length} files, ${last.reduce((sum, r) => sum + r.passed, 0).toLocaleString("en-US")} tests passed.`,
  ];
  if (failing.length > 0) {
    lines.push(`Failed, also when run alone (${failing.length}):`);
    for (const r of failing) {
      lines.push(`  ${r.file}`);
      for (const name of r.failed) lines.push(`    ${name}`);
      if (r.error !== null) lines.push(`    ${r.failed.length > 0 ? "and between its tests: " : ""}${r.error}`);
    }
  }
  if (passedAlone.length > 0) {
    lines.push(`Passed alone (${passedAlone.length}): failed among the others, passed when run again alone:`);
    for (const r of passedAlone) lines.push(`  ${r.file}: ${r.failed.length > 0 ? r.failed.join("; ") : (r.error ?? "")}`);
  }
  lines.push("The ten slowest files in this run:");
  for (const r of [...run.first].sort((a, b) => b.ms - a.ms).slice(0, 10)) lines.push(`  ${`${(r.ms / 1000).toFixed(1)} s`.padStart(7)}  ${r.file}`);
  return lines;
}

/**
 * The command line: `--record`, how many files at once, and from `--` or the first other argument
 * that starts with "-" on, what each file's `bun test` is given too. Null for anything else, and for
 * a recording given Bun's arguments: a filtered file's time isn't the file's.
 */
export function parseArgs(argv: readonly string[]): { record: boolean; jobs: number | null; bun: string[] } | null {
  const at = argv.findIndex((a) => a === "--" || (a.startsWith("-") && a !== "--record"));
  const own = at === -1 ? argv : argv.slice(0, at);
  const bun = at === -1 ? [] : argv.slice(argv[at] === "--" ? at + 1 : at);
  const record = own.includes("--record");
  const given = own.filter((a) => a !== "--record");
  if (given.length > 1 || (given[0] !== undefined && !/^[1-9]\d*$/.test(given[0])) || (record && bun.length > 0)) return null;
  return { record, jobs: given[0] === undefined ? null : Number(given[0]), bun };
}

async function main(argv: readonly string[]): Promise<number> {
  const cores = availableParallelism();
  const args = parseArgs(argv);
  if (args === null) {
    console.error("usage: bun run test:all [files at once] [-- <bun test arguments>]   (bun run test:timings [files at once] records each file's time)");
    return 2;
  }
  const { record, bun } = args;
  const asked = args.jobs ?? (record ? Math.floor(cores / 3) : cores - 2);
  const jobs = Math.max(1, Math.min(asked, cores));
  const files = testFiles(ROOT);
  if (asked > cores) console.log(`${asked} at once is more than this machine's ${cores} cores: running ${jobs}, so each file has a core.`);
  console.log(`${files.length} test files, ${jobs} at a time, the slowest first${bun.length > 0 ? `, each given ${bun.join(" ")}` : ""}${record ? `; each one's time goes to ${TIMINGS}` : ""}.`);
  const run = await runAll({
    jobs,
    files,
    bun,
    heard: (r, done, of) => {
      if (!r.ok) console.log(`${process.stdout.isTTY ? "\r" : ""}failed among the others, to run again alone at the end: ${r.file}${r.failed.length > 0 ? ` (${r.failed.length} test${r.failed.length === 1 ? "" : "s"})` : ""}`);
      if (process.stdout.isTTY) process.stdout.write(`\r${done}/${of} files`);
    },
  });
  if (process.stdout.isTTY) process.stdout.write("\n");
  for (const line of summarize(run)) console.log(line);
  if (record) {
    // A failing run's time says little of a passing one's: a file that passed alone keeps that time, and one that failed there too keeps the record's earlier time where it has one.
    const before = readTimings(join(ROOT, TIMINGS));
    const aloneOf = new Map(run.alone.map((r) => [r.file, r]));
    const timeOf = (r: FileRun): number => {
      if (r.ok) return r.ms;
      const alone = aloneOf.get(r.file);
      return alone?.ok ? alone.ms : (before.get(r.file) ?? r.ms);
    };
    const recorded = Object.fromEntries(run.first.map((r) => [r.file, Math.round(timeOf(r))] as const).sort(([, a], [, b]) => b - a));
    writeFileSync(join(ROOT, TIMINGS), `${JSON.stringify({ version: 1, files: recorded }, null, 2)}\n`);
    console.log(`Each file's time is in ${TIMINGS}.`);
  }
  return run.alone.some((r) => !r.ok) ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
