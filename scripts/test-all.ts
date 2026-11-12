// `bun run test:all [n]`: every test file under test/, each in a process of its own, as `bun test
// <file>` runs it alone (files of this suite interfere when they share one), n at a time: by default
// the machine's cores less two, and never more than its cores, so each file has a core to itself.
// The slowest start first, by their times in test/timings.json, and a file the record doesn't list
// before them all, so no long file is left running by itself at the end.
//
// A file that fails is run again once the others are done, alone: it fails the run only if it fails
// alone too, and is listed as passed alone otherwise. Each test has `TIMEOUT_MS`, as in the
// repository's other parallel runs (scripts/test/run.ts): with every core busy a test that takes two
// seconds alone can take longer than Bun's five, and thirty still ends a hang. The
// summary gives the wall time, the files and the tests passed, each file that failed alone with its
// failing tests' names, the files that passed alone, and the ten slowest files. The exit code is 1
// when a file failed alone.
//
// `bun run test:timings` (`--record`) runs every file a third of the cores at a time, so each runs as
// it would alone, and writes each one's time to test/timings.json: this run's order and the budget of
// `bun run test` (scripts/test/run.ts) read it.
//
// The property suite (test/ledger/properties.test.ts) runs its everyday sample here, as everywhere
// its count isn't set; `bun run test:properties` runs it whole.

import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { isTest, readTimings } from "./test/select";

const ROOT = resolve(import.meta.dir, "..");
const TIMINGS = "test/timings.json";
/** Each test's limit in a parallel run: Bun's 5 s default guards against a hang, and with every core busy a test that takes 2 s alone can take longer than that. */
export const TIMEOUT_MS = 30_000;

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

/** Runs `file` as `bun test <file>` runs it, and reads Bun's report of it. */
async function runFile(root: string, file: string): Promise<FileRun> {
  const started = performance.now();
  const child = Bun.spawn([process.execPath, "test", `--timeout=${TIMEOUT_MS}`, `./${file}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const text = `${out}\n${err}`;
  const counted = /^ (\d+) pass$/m.exec(text);
  const failed = [...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => m[1] ?? "");
  const between = /# Unhandled error between tests[\s\S]*?^error: (.+)$/m.exec(text)?.[1];
  const ended = failed.length === 0 || counted === null ? `it ended with exit code ${code}${counted === null ? ", before Bun counted its tests" : ""}` : null;
  return { file, ok: code === 0, passed: Number(counted?.[1] ?? 0), failed, error: code === 0 ? null : (between ?? ended), ms: performance.now() - started };
}

/**
 * Runs `files` (all of `root`'s test files when not given), `jobs` at a time, the slowest by
 * `root`'s test/timings.json first and the files it doesn't list before them; then each file that
 * failed, again, alone. `heard` hears each file's first run as it ends.
 */
export async function runAll(options: { root?: string; jobs: number; files?: readonly string[]; heard?: (run: FileRun, done: number, of: number) => void }): Promise<AllRun> {
  const root = options.root ?? ROOT;
  const timings = readTimings(join(root, TIMINGS));
  const queue = [...(options.files ?? testFiles(root))].sort((a, b) => (timings.get(b) ?? Infinity) - (timings.get(a) ?? Infinity) || a.localeCompare(b));
  const of = queue.length;
  const started = performance.now();
  const first: FileRun[] = [];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const run = await runFile(root, file);
      first.push(run);
      options.heard?.(run, first.length, of);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.jobs, of)) }, worker));
  const alone: FileRun[] = [];
  for (const run of first) if (!run.ok) alone.push(await runFile(root, run.file));
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

async function main(argv: readonly string[]): Promise<number> {
  const cores = availableParallelism();
  const record = argv.includes("--record");
  const given = argv.filter((a) => a !== "--record");
  if (given.length > 1 || (given[0] !== undefined && !/^[1-9]\d*$/.test(given[0]))) {
    console.error("usage: bun run test:all [files at once]   (bun run test:timings records each file's time)");
    return 2;
  }
  const asked = given[0] === undefined ? (record ? Math.floor(cores / 3) : cores - 2) : Number(given[0]);
  const jobs = Math.max(1, Math.min(asked, cores));
  const files = testFiles(ROOT);
  if (asked > cores) console.log(`${asked} at once is more than this machine's ${cores} cores: running ${jobs}, so each file has a core.`);
  console.log(`${files.length} test files, ${jobs} at a time, the slowest first${record ? `; each one's time goes to ${TIMINGS}` : ""}.`);
  const run = await runAll({
    jobs,
    files,
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
