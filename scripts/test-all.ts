// `bun run test`, the gate, and `bun run test:all`, the same run (plan §17.5: "whole suites in both
// repos, each file in its own process"): every test file under test/, each in a process of its own,
// as `bun test <file>` runs it alone, n at a time: by default the machine's cores less two, and never
// more than its cores, so each file has a core to itself. The slowest start first, by their times in
// test/timings-all.json, so no long file is left running by itself at the end. A file the record
// doesn't hold yet (a lane added it since the last recording) runs at the record's middle time and
// is named in the summary as not yet timed, until `--record` times it, as the lead's check does at a
// wave's end. Each file runs on the Bun that runs this script, and so does every `bun` it starts:
// this Bun's folder comes first on the PATH each file is given.
//
// A file that fails among the others is run again once the others are done, alone. One that fails
// alone too has failed. One that passes alone is a defect: it fails only beside other files, because
// it leans on timing or on something another file shares or leaves behind, so it is named with its
// failing tests and the run does not pass. A file still running after `FILE_LIMIT_MS` never finished
// (its top level never finished loading, or something it started never let go): it is stopped, and
// fails as one that never finished, so the run always ends with its summary. Each test has
// `TIMEOUT_MS`: with every core busy a test that takes two seconds alone can take longer than Bun's
// five, and thirty still ends a hang.
//
// The run's wall time is printed with the cores it used, set against a bar, `BUDGET_S` (plan §17.5:
// "well under ten minutes"), beside the machine's load average when the run began and when it ended.
// The bar is a measure to report, not a test of the code: a run over it says so plainly, with that
// load, and the verdict and the exit code are the code's alone. A recording's time is not set
// against the bar: it runs fewer files at once on purpose.
//
// Each file is given a temporary folder of its own as TMPDIR, inside the run's own, so what a file
// leaves in the system's temporary folder is found and named with the file that left it: after its
// process ends, whatever is still in its folder is left behind, a defect that fails the run, and
// then the folder goes. The run's own folder goes at its end, so the runner leaves nothing itself.
//
// Each file is told its per-test limit, the one Bun is given, in `RPE_TEST_LIMIT_MS`: a test that
// must set a limit of its own (a guard over a long fixture) takes the runner's instead of a number
// fixed in the file (plan R-15: a timing test in the suite is a guard, not the gate, and must not
// fail because the machine is busy). `--busy <file>` runs one file as the gate runs a file, with
// every core busy: a process spinning on each core from before the file starts until after it ends,
// and says whether each spun throughout and what CPU they used, so a guard can be shown to hold on a
// loaded machine.
//
// Every skipped test is listed with its reason. Bun gives a skip no reason of its own, so a test that
// may be skipped says why at the end of its name while it is skipped, `(skipped: <why>)`; one that
// gives none is a defect that fails the run. (In a run filtered by `-t` or `--only`, Bun counts the
// tests left out as skipped, so skips are not judged there.) Two tests run Lumiverse's own macro
// engine, from the checkout `LRE_HOST_REPO` names: each file is given the Lumiverse checkout this one
// sits in, the nearest folder above it that holds the engine, unless the environment names one
// (empty, for none); the summary says which, or that none was found and those tests skip.
//
// The suite's known failures are data, test/proof/suites/known.json: each failing file with the
// package that fixes it and that package's wave, and what files are known to leave in the temporary
// folder, by a name's pattern (`*` for any run of characters), with theirs. A known one is reported
// with its owner and does not fail the run; any other failure does. A listed file that passes now,
// or that the suite no longer has, is named in the summary to be struck off, with no part in the
// verdict, since the list is bookkeeping and not the code, and a file whose failure hangs on the
// machine's load can pass by chance before its owner's package lands. `--strike` runs listed files
// alone and takes off the list those that pass or are gone: the files it is given, as the lead names
// them when their owner's package lands, or every listed file. The gate itself never writes the list,
// nor any other file git keeps. A pattern no file matched in a run is named too; leftovers come only
// when a run fails, so a pattern is taken off by hand.
//
// The gate runs the repository's own typecheck beside the files (`bun run typecheck`: here both
// projects, the preview's among them) and fails when it fails, printing what it said; a recording and
// a filtered run leave it out. Each run of the gate also writes what it came to, file by file, as
// data to .cache/suite.json (which git ignores), for the checks that read the last whole-suite run.
//
//   bun scripts/test-all.ts [files at once] [-- <bun test arguments>]   the gate
//   bun scripts/test-all.ts --list                                       the files it runs, one a line
//   bun scripts/test-all.ts --record [files at once]                     records test/timings-all.json
//   bun scripts/test-all.ts --busy <test file> [-- <bun test arguments>] that file with every core busy
//   bun scripts/test-all.ts --strike [listed test files]                 strikes those of them that pass now off the known list
//
//   --budget <s>      the bar, in seconds (default `BUDGET_S`); the owner changes it here
//   --root <folder>   runs the suite of another folder's test/ instead (the runner's own tests run their
//                     fixture suites so)
//
// What follows `--` (or the first argument that starts with "-" and is none of the above) goes on to
// each file's `bun test`, as `-t <pattern>` does; a file none of whose tests the pattern names runs
// nothing, and that fails nothing.
//
// `--record` runs every file a third of the cores at a time, so each runs as it would alone, and
// writes each one's time, its whole process's, to test/timings-all.json, which this run's order
// reads. `bun run check` (scripts/test/run.ts) budgets the tests it picks by a recording of its own,
// test/timings.json (`bun scripts/test/run.ts --timings`): each file's time in one `bun test` process
// that runs them one after another, without the starting and loading a process of its own spends,
// which is most of most files' time here. The two are kept apart, so neither run reads times in the
// other's unit.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { isTest, readTimings } from "./test/select";

const ROOT = resolve(import.meta.dir, "..");
const TIMINGS = "test/timings-all.json";
const KNOWN = "test/proof/suites/known.json";
const RECORD = ".cache/suite.json";
/** Each test's limit: Bun's 5 s default guards against a hang, and with every core busy a test that takes 2 s alone can take longer than that. */
export const TIMEOUT_MS = 30_000;
/** How long one file may run before it is stopped as one that never finished: the slowest file takes about a minute and a quarter alone, and a few times that with every core busy. */
export const FILE_LIMIT_MS = 10 * 60_000;
/** The bar the gate's wall time is set against: plan §17.5 asks for both suites "finishing in well under ten minutes", read as at most six on the lead's machine, its cores less two at a time (PlanGates-1). A measure the summary reports with the machine's load, never a failure of the code. `--budget <s>` changes it. */
export const BUDGET_S = 360;

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
  /** What it left in its temporary folder: each entry's name, a folder's with a slash after it. */
  left: string[];
  /** Its skipped tests. */
  skipped: Skip[];
}

/** A skipped test, and why, as its name gives it (`(skipped: <why>)` at its end); null when it gives no reason. */
export interface Skip {
  name: string;
  reason: string | null;
}

/** Lumiverse's own macro engine, for the tests that run it: the checkout `LRE_HOST_REPO` names (`given`), or else the one this folder sits in; null for none. */
export interface Host {
  path: string | null;
  given: boolean;
}

export interface AllRun {
  /** The suite's folder. */
  root: string;
  jobs: number;
  /** The machine's cores. */
  cores: number;
  host: Host;
  /** Whether a `-t` pattern or `--only` left tests out, which Bun counts as skipped. */
  filtered: boolean;
  /** The files the timing record doesn't hold yet, which ran at its middle time. */
  untimed: string[];
  /** The machine's one-minute load average when the run began and when it ended. */
  load: { before: number; after: number };
  ms: number;
  /** Each file's run among the others, in the order they ended. */
  first: FileRun[];
  /** The run alone of each file that failed among the others. */
  alone: FileRun[];
}

/** Every test file under `root`'s test/, as `bun test` finds them there. */
export function testFiles(root: string): string[] {
  return [...new Bun.Glob("test/**/*.test.{ts,tsx}").scanSync({ cwd: root })].map((file) => file.split("\\").join("/")).filter(isTest).sort();
}

/** A failing file the suite knows of, with the package that fixes it, that package's wave, and why it fails. */
export interface KnownFailure {
  file: string;
  owner: string;
  wave: string;
  why: string;
}

/** What files are known to leave in the temporary folder, by a name's pattern, with the package that fixes it. */
export interface KnownLeft {
  name: string;
  owner: string;
  wave: string;
  why: string;
}

export interface Known {
  failures: KnownFailure[];
  leftovers: KnownLeft[];
}

/** The repository's own typecheck, as `bun run typecheck` ran it: whether it passed, how long it took, and what it said. */
export interface Typecheck {
  ok: boolean;
  ms: number;
  out: string;
}

/** Runs `root`'s own typecheck (`bun run typecheck`), keeping what it says. */
export async function typecheckOf(root: string): Promise<Typecheck> {
  const started = performance.now();
  const child = Bun.spawn([process.execPath, "run", "typecheck"], { cwd: root, env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter) }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { ok: code === 0, ms: performance.now() - started, out: `${out}\n${err}`.trim() };
}

/** Whether Bun's arguments leave tests out (a `-t` pattern, `--only`), which Bun then counts as skipped. */
const filtering = (bun: readonly string[]): boolean => bun.some((a) => a === "-t" || a.startsWith("--test-name-pattern") || a === "--only");

/** The suite's known failures (`test/proof/suites/known.json`); none when it has no such file. */
export function readKnown(root: string): Known {
  const path = join(root, KNOWN);
  if (!existsSync(path)) return { failures: [], leftovers: [] };
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const list = (key: "failures" | "leftovers", named: "file" | "name"): Record<string, string>[] => {
    const entries: unknown = typeof parsed === "object" && parsed !== null && key in parsed ? (parsed as Record<string, unknown>)[key] : [];
    if (!Array.isArray(entries)) throw new Error(`${KNOWN}: "${key}" is not a list`);
    return entries.map((entry: unknown, i) => {
      const fields = [named, "owner", "wave", "why"];
      if (typeof entry !== "object" || entry === null || fields.some((f) => typeof (entry as Record<string, unknown>)[f] !== "string")) throw new Error(`${KNOWN}: ${key}[${i}] needs ${fields.join(", ")}, each a text`);
      return entry as Record<string, string>;
    });
  };
  return {
    failures: list("failures", "file").map((e) => ({ file: e.file ?? "", owner: e.owner ?? "", wave: e.wave ?? "", why: e.why ?? "" })),
    leftovers: list("leftovers", "name").map((e) => ({ name: e.name ?? "", owner: e.owner ?? "", wave: e.wave ?? "", why: e.why ?? "" })),
  };
}

/** One test of a file, from Bun's JUnit report of it. */
interface Case {
  /** After the blocks it is in (`block > test`), as Bun names a failing test on the console. */
  name: string;
  state: "passed" | "failed" | "skipped";
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (text: string): string =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => (code.startsWith("#x") || code.startsWith("#X") ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : (ENTITIES[code] ?? whole)));
const attribute = (attributes: string, name: string): string | null => {
  const found = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return found === null ? null : unescape(found[1] ?? "");
};

/**
 * Every test of a file, from the JUnit report `bun test --reporter=junit` writes of it: the report's
 * outermost suite is the file, and each suite inside it a block. (A case's `classname` lists its
 * blocks innermost first, so the names are read from the suites instead.)
 */
export function readReport(xml: string): Case[] {
  const cases: Case[] = [];
  const suites: string[] = [];
  let open: Case | null = null;
  for (const [, closing, tag, attributes = "", selfClosing] of xml.matchAll(/<(\/?)(testsuite|testcase|failure|error|skipped)\b([^>]*?)(\/?)>/g)) {
    if (tag === "testsuite") {
      if (closing) suites.pop();
      else if (!selfClosing) suites.push(attribute(attributes, "name") ?? "");
    } else if (tag === "testcase") {
      if (closing) {
        if (open !== null) cases.push(open);
        open = null;
      } else {
        const name = [...suites.slice(1), attribute(attributes, "name") ?? ""].join(" > ");
        if (selfClosing) cases.push({ name, state: "passed" });
        else open = { name, state: "passed" };
      }
    } else if (open !== null && !closing) open.state = tag === "skipped" ? "skipped" : "failed";
  }
  return cases;
}

interface RunOptions {
  /** What each file's `bun test` is given too. */
  bun: readonly string[];
  /** How long the file may run. */
  limitMs: number;
  /** Each test's limit, given to Bun and told to the file in `RPE_TEST_LIMIT_MS`. */
  testLimitMs: number;
  env: Record<string, string | undefined>;
  /** The run's own scratch folder, for each file's report and its temporary folder. */
  scratch: string;
  /** This file's run's number in the run, which names its report and its temporary folder. */
  n: number;
}

/** Runs `file` as `bun test <file>` runs it, Bun given `bun` too, and reads Bun's report of it; stopped after `limitMs`, as one that never finished. */
async function runFile(root: string, file: string, o: RunOptions): Promise<FileRun> {
  const started = performance.now();
  const report = join(o.scratch, `${o.n}.xml`);
  const tmp = join(o.scratch, String(o.n));
  mkdirSync(tmp);
  // A file none of whose tests a `-t` pattern names runs no test, which fails nothing.
  const child = Bun.spawn([process.execPath, "test", `--timeout=${o.testLimitMs}`, "--pass-with-no-tests", "--reporter=junit", `--reporter-outfile=${report}`, ...o.bun, `./${file}`], { cwd: root, env: { ...o.env, TMPDIR: tmp }, stdout: "pipe", stderr: "pipe" });
  const limit = Promise.withResolvers<null>();
  const timer = setTimeout(() => limit.resolve(null), o.limitMs);
  const done = await Promise.race([Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]), limit.promise]);
  clearTimeout(timer);
  if (done === null) {
    // Its output isn't waited for: whatever it started may hold that open after it is stopped.
    child.kill("SIGKILL");
    return { file, ok: false, passed: 0, failed: [], error: `it never finished: it was still running after ${o.limitMs / 1000} s, so it was stopped`, ms: performance.now() - started, left: leftIn(tmp), skipped: [] };
  }
  const [out, err, code] = done;
  const text = `${out}\n${err}`;
  // Bun writes no report for a file that broke before its tests: the console says what happened.
  const cases = existsSync(report) ? readReport(readFileSync(report, "utf8")) : null;
  const counted = /^ (\d+) pass$/m.exec(text);
  const failed = cases !== null ? cases.filter((c) => c.state === "failed").map((c) => c.name) : [...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => m[1] ?? "");
  const passed = cases !== null ? cases.filter((c) => c.state === "passed").length : Number(counted?.[1] ?? 0);
  const skipped = (cases ?? [])
    .filter((c) => c.state === "skipped")
    .map((c): Skip => {
      const said = /^(.*?) ?\(skipped: (.+)\)$/.exec(c.name);
      return said === null ? { name: c.name, reason: null } : { name: said[1] ?? c.name, reason: said[2] ?? null };
    });
  const between = /# Unhandled error between tests[\s\S]*?^error: (.+)$/m.exec(text)?.[1];
  const ended = failed.length === 0 || counted === null ? `it ended with exit code ${code}${counted === null ? ", before Bun counted its tests" : ""}` : null;
  return { file, ok: code === 0, passed, failed, error: code === 0 ? null : (between ?? ended), ms: performance.now() - started, left: leftIn(tmp), skipped };
}

/** What a file left in its temporary folder, each entry's name, a folder's with a slash after it; then the folder goes. */
function leftIn(folder: string): string[] {
  const left = readdirSync(folder, { withFileTypes: true }).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).sort();
  rmSync(folder, { recursive: true, force: true });
  return left;
}

/** The checkout `LRE_HOST_REPO` names, or else the nearest folder above `root` that holds Lumiverse's macro engine: the Lumiverse checkout this one sits in. */
export function findHost(root: string, env: Record<string, string | undefined> = process.env): Host {
  const named = env.LRE_HOST_REPO;
  if (named !== undefined) return { path: named === "" ? null : named, given: true };
  for (let dir = dirname(resolve(root)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "src/macros/index.ts"))) return { path: dir, given: false };
    if (dirname(dir) === dir) return { path: null, given: false };
  }
}

/** The environment each file runs in: this Bun's folder first on the PATH, so a `bun` a test starts is this one; the per-test limit the file is given; and the Lumiverse checkout found for it. */
function fileEnv(testLimitMs: number, host: Host): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter), RPE_TEST_LIMIT_MS: String(testLimitMs) };
  if (!host.given && host.path !== null) env.LRE_HOST_REPO = host.path;
  return env;
}

/** Which Lumiverse checkout the tests that run its macro engine are given, in a line. */
function hostLine(root: string, host: Host): string {
  const where =
    host.path !== null
      ? `${relative(root, host.path) || "."}, ${host.given ? "as LRE_HOST_REPO gives it" : "the Lumiverse checkout this one sits in (LRE_HOST_REPO)"}.`
      : host.given
        ? "LRE_HOST_REPO is set empty, so they skip."
        : "no Lumiverse checkout above this one, so they skip (set LRE_HOST_REPO to one).";
  return `Lumiverse's own macro engine, for the tests that run it: ${where}`;
}

/**
 * Runs `files` (all of `root`'s test files when not given), `jobs` at a time, the slowest by
 * `root`'s test/timings-all.json first and the files it doesn't list before them; then each file
 * that failed, again, alone. `bun`: what each file's `bun test` is given too; `limitMs`: how long a
 * file may run (`FILE_LIMIT_MS`). `heard` hears each file's first run as it ends.
 */
export async function runAll(options: { root?: string; jobs: number; files?: readonly string[]; bun?: readonly string[]; limitMs?: number; testLimitMs?: number; host?: Host; heard?: (run: FileRun, done: number, of: number) => void }): Promise<AllRun> {
  const root = options.root ?? ROOT;
  const loadBefore = loadavg()[0] ?? 0;
  const timings = readTimings(join(root, TIMINGS));
  const files = [...(options.files ?? testFiles(root))];
  // A file the record doesn't hold yet runs at the record's middle time, until a recording times it.
  const recorded = [...timings.values()].sort((a, b) => a - b);
  const middle = recorded[Math.floor(recorded.length / 2)] ?? 0;
  const untimed = files.filter((file) => !timings.has(file)).sort();
  const queue = files.sort((a, b) => (timings.get(b) ?? middle) - (timings.get(a) ?? middle) || a.localeCompare(b));
  const of = queue.length;
  const scratch = mkdtempSync(join(tmpdir(), "rpe-suite-"));
  let n = 0;
  const testLimitMs = options.testLimitMs ?? TIMEOUT_MS;
  const host = options.host ?? findHost(root);
  const bun = options.bun ?? [];
  const run = (file: string): Promise<FileRun> => runFile(root, file, { bun, limitMs: options.limitMs ?? FILE_LIMIT_MS, testLimitMs, env: fileEnv(testLimitMs, host), scratch, n: ++n });
  try {
    const started = performance.now();
    const first: FileRun[] = [];
    const worker = async (): Promise<void> => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        const done = await run(file);
        first.push(done);
        options.heard?.(done, first.length, of);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(options.jobs, of)) }, worker));
    const alone: FileRun[] = [];
    for (const done of first) if (!done.ok) alone.push(await run(done.file));
    return { root, jobs: options.jobs, cores: availableParallelism(), host, filtered: filtering(bun), untimed, load: { before: loadBefore, after: loadavg()[0] ?? 0 }, ms: performance.now() - started, first, alone };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * What a run came to: the files that failed alone too; the defects, each the run among the others of
 * a file that passed alone; what the files left behind; every skipped test; and its time against the
 * bar, which is reported and no part of the verdict. Failures and leftovers on the known list are kept
 * apart with their owners; listed files this run showed passing or gone are named for `--strike` to
 * take off, and listed leftovers no file left are named; neither is any part of the verdict.
 */
export interface Judged {
  run: AllRun;
  failed: FileRun[];
  beside: FileRun[];
  /** Each thing a file left in its temporary folder, among the others or alone, that the known list doesn't name. */
  left: { file: string; name: string }[];
  /** Every skipped test, each with the file it is in; none in a filtered run, where Bun counts the tests left out as skipped. */
  skips: (Skip & { file: string })[];
  /** Failing files on the known list: each with its entry, its last run, and whether it failed only beside the others. */
  knownFailing: { entry: KnownFailure; run: FileRun; beside: boolean }[];
  /** Leftovers the known list names. */
  knownLeft: { file: string; name: string; entry: KnownLeft }[];
  /** Listed files this run showed passing, or that the suite no longer has: named in the summary for `--strike` to take off the list, and no part of `ok`. None in a filtered run. */
  toStrike: KnownFailure[];
  /** Leftover patterns on the list that no file matched in this run. A leftover comes only when a run fails, so this strikes nothing. None in a filtered run. */
  unseen: KnownLeft[];
  /** The repository's typecheck, or null when this run didn't run it (a recording, a filtered run, the release's pass after its own checks). */
  typecheck: Typecheck | null;
  /** The bar the wall time was set against, or null when this run's time is not (a recording, the release's pass). */
  budgetMs: number | null;
  /** Whether the wall time was over the bar: reported, and no part of `ok`. */
  overBar: boolean;
  ok: boolean;
}

export function judge(run: AllRun, options: { budgetMs?: number | null; known?: Known; typecheck?: Typecheck | null } = {}): Judged {
  const known = options.known ?? { failures: [], leftovers: [] };
  const listed = new Map(known.failures.map((e) => [e.file, e]));
  const aloneOf = new Map(run.alone.map((r) => [r.file, r]));
  const failedAlone = run.alone.filter((r) => !r.ok);
  const failedBeside = run.first.filter((r) => !r.ok && aloneOf.get(r.file)?.ok === true);
  const knownFailing = [...failedAlone.map((r) => ({ run: r, beside: false })), ...failedBeside.map((r) => ({ run: r, beside: true }))].flatMap(({ run: r, beside }) => {
    const entry = listed.get(r.file);
    return entry === undefined ? [] : [{ entry, run: r, beside }];
  });
  const matching = (name: string): KnownLeft | undefined => known.leftovers.find((e) => new Bun.Glob(e.name).match(name.replace(/\/$/, "")));
  const leftovers = [...run.first, ...run.alone].flatMap((r) => r.left.map((name) => ({ file: r.file, name, entry: matching(name) })));
  const left = leftovers.flatMap(({ file, name, entry }) => (entry === undefined ? [{ file, name }] : []));
  const knownLeft = leftovers.flatMap(({ file, name, entry }) => (entry === undefined ? [] : [{ file, name, entry }]));
  const ran = new Map(run.first.map((r) => [r.file, r]));
  const toStrike = run.filtered ? [] : known.failures.filter((e) => ran.get(e.file)?.ok !== false);
  const unseen = run.filtered ? [] : known.leftovers.filter((e) => !knownLeft.some((l) => l.entry === e));
  const failed = failedAlone.filter((r) => !listed.has(r.file));
  const beside = failedBeside.filter((r) => !listed.has(r.file));
  const skips = run.filtered ? [] : run.first.flatMap((r) => (aloneOf.get(r.file) ?? r).skipped.map((s) => ({ ...s, file: r.file })));
  const budgetMs = options.budgetMs ?? null;
  const overBar = budgetMs !== null && run.ms > budgetMs;
  const typecheck = options.typecheck ?? null;
  // The bar is a measure the summary reports, not a test of the code, and so is the known list's
  // bookkeeping: the verdict is the code's alone.
  const ok = failed.length === 0 && beside.length === 0 && left.length === 0 && skips.every((s) => s.reason !== null) && typecheck?.ok !== false;
  return { run, failed, beside, left, skips, knownFailing, knownLeft, toStrike, unseen, typecheck, budgetMs, overBar, ok };
}

/**
 * Runs each named file on the known list alone (every listed file, when none is named) and takes off
 * the list those that pass, and those the suite no longer has; the list's leftover patterns are kept.
 * Only this writes the list.
 */
export async function strike(root: string, named: readonly string[] = []): Promise<{ struck: KnownFailure[]; kept: KnownFailure[] }> {
  const known = readKnown(root);
  const suite = new Set(testFiles(root));
  const asked = named.length === 0 ? known.failures : known.failures.filter((e) => named.includes(e.file));
  const run = await runAll({ root, jobs: 1, files: asked.map((e) => e.file).filter((file) => suite.has(file)) });
  const passing = new Set(run.first.filter((r) => r.ok).map((r) => r.file));
  const struck = asked.filter((e) => !suite.has(e.file) || passing.has(e.file));
  const kept = known.failures.filter((e) => !struck.includes(e));
  writeFileSync(join(root, KNOWN), `${JSON.stringify({ failures: kept, leftovers: known.leftovers }, null, 2)}\n`);
  return { struck, kept };
}

/**
 * What a run of the gate came to, as data, file by file: each file's result (`passed`; `failed`, also
 * when run alone; `beside`, failed only beside the others; `known`, a failure on the known list), its
 * tests passed, its failing tests, its skips with their reasons and what it left behind; then the
 * typecheck, the time against the bar, the known failures and the verdict.
 */
export function runRecord(judged: Judged, at: Date): Record<string, unknown> {
  const { run } = judged;
  const aloneOf = new Map(run.alone.map((r) => [r.file, r]));
  const known = new Set(judged.knownFailing.map((k) => k.run.file));
  const beside = new Set(judged.beside.map((r) => r.file));
  return {
    version: 1,
    at: at.toISOString(),
    whole: !run.filtered,
    verdict: judged.ok ? "pass" : "fail",
    ms: Math.round(run.ms),
    jobs: run.jobs,
    cores: run.cores,
    budgetMs: judged.budgetMs,
    typecheck: judged.typecheck === null ? null : { ok: judged.typecheck.ok, ms: Math.round(judged.typecheck.ms) },
    host: run.host.path === null ? null : relative(run.root, run.host.path) || ".",
    files: run.first.map((r) => {
      const last = aloneOf.get(r.file) ?? r;
      const result = r.ok ? "passed" : known.has(r.file) ? "known" : beside.has(r.file) ? "beside" : "failed";
      return { file: r.file, result, passed: last.passed, failed: r.ok ? [] : r.failed, skipped: last.skipped, left: [...r.left, ...(aloneOf.get(r.file)?.left ?? [])], ms: Math.round(r.ms) };
    }),
    known: judged.knownFailing.map(({ entry, beside: only }) => ({ ...entry, beside: only })),
    knownLeft: judged.knownLeft.map(({ file, name, entry }) => ({ file, name, owner: entry.owner, wave: entry.wave })),
    toStrike: judged.toStrike,
    unseen: judged.unseen,
    untimed: run.untimed,
    overBar: judged.overBar,
    load: run.load,
  };
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
/** A known entry's owner and its wave, as said: "PlanSwap-4, wave 1"; a wave that is no number ("the ground") as it is written. */
const owned = (e: { owner: string; wave: string }): string => `${e.owner}, ${/^\d+$/.test(e.wave) ? `wave ${e.wave}` : e.wave}`;
const duration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  const [min, sec] = [Math.floor(s / 60), s % 60];
  return min === 0 ? `${sec} s` : sec === 0 ? `${min} min` : `${min} min ${sec} s`;
};

/** What a run came to, in short: the lines printed at its end, the verdict last. */
export function summarize(judged: Judged): string[] {
  const { run, failed, beside, budgetMs } = judged;
  const aloneOf = new Map(run.alone.map((r) => [r.file, r]));
  const last = run.first.map((r) => aloneOf.get(r.file) ?? r);
  const bar = budgetMs === null ? "its time is not set against the bar in this run." : `${judged.overBar ? "over" : "within"} the bar of ${duration(budgetMs)} (--budget ${budgetMs / 1000}).`;
  const lines = [
    "",
    `Every test file, each in a process of its own: ${plural(run.first.length, "file")}, ${plural(last.reduce((sum, r) => sum + r.passed, 0), "test")} passed.`,
    `Time: ${duration(run.ms)}, on ${run.jobs} of the machine's ${run.cores} cores (a file on each): ${bar}`,
    `Load: the machine's load average was ${run.load.before.toFixed(1)} when the run began and ${run.load.after.toFixed(1)} when it ended, on ${run.cores} cores, ${Math.max(0, run.cores - run.jobs)} of them left to other work.`,
    hostLine(run.root, run.host),
    judged.typecheck === null ? "Typecheck (bun run typecheck): not run in this run." : `Typecheck (bun run typecheck): ${judged.typecheck.ok ? "passed" : "failed"} in ${(judged.typecheck.ms / 1000).toFixed(1)} s${judged.typecheck.ok ? "." : ":"}`,
    ...(judged.typecheck?.ok === false ? judged.typecheck.out.split("\n").map((line) => `    ${line}`) : []),
  ];
  if (failed.length > 0) {
    lines.push(`Failed, also when run alone (${failed.length}):`);
    for (const r of failed) {
      lines.push(`  ${r.file}`);
      for (const name of r.failed) lines.push(`    ${name}`);
      if (r.error !== null) lines.push(`    ${r.failed.length > 0 ? "and between its tests: " : ""}${r.error}`);
    }
  }
  if (beside.length > 0) {
    lines.push(`Defects: failed beside the other files and passed when run again alone (${beside.length}):`);
    for (const r of beside) {
      lines.push(`  ${r.file}`);
      for (const name of r.failed) lines.push(`    ${name}`);
      if (r.error !== null) lines.push(`    ${r.failed.length > 0 ? "and between its tests: " : ""}${r.error}`);
    }
  }
  if (judged.left.length > 0) {
    lines.push(`Left in the temporary folder, each after the file that left it (${judged.left.length}):`);
    for (const l of judged.left) lines.push(`  ${l.file}: ${l.name}`);
  }
  if (judged.knownFailing.length > 0) {
    lines.push(`Known failures, each with the package that fixes it and its wave (${judged.knownFailing.length}):`);
    for (const { entry, run: r, beside: only } of judged.knownFailing) {
      lines.push(`  ${r.file}: ${owned(entry)}${only ? " (it failed beside the others and passed alone)" : ""}: ${entry.why}`);
      for (const name of r.failed) lines.push(`    ${name}`);
      if (r.error !== null) lines.push(`    ${r.failed.length > 0 ? "and between its tests: " : ""}${r.error}`);
    }
  }
  if (judged.knownLeft.length > 0) {
    lines.push(`Known leftovers in the temporary folder, each with the package that fixes it and its wave (${judged.knownLeft.length}):`);
    for (const { file, name, entry } of judged.knownLeft) lines.push(`  ${file}: ${name} (${owned(entry)}: ${entry.why})`);
  }
  if (judged.toStrike.length > 0) {
    lines.push(`On the known list but passing now, or gone: strike them off once their owner's package has landed (bun scripts/test-all.ts --strike) (${judged.toStrike.length}):`);
    for (const e of judged.toStrike) lines.push(`  ${e.file}: ${judged.run.first.some((r) => r.file === e.file) ? "it passes now" : "the suite no longer has it"} (${owned(e)})`);
  }
  if (judged.unseen.length > 0) {
    lines.push(`Known leftovers that no file left this time, kept on the list, since a leftover comes only when a run fails (${judged.unseen.length}):`);
    for (const e of judged.unseen) lines.push(`  ${e.name} (${owned(e)})`);
  }
  if (run.untimed.length > 0) {
    lines.push(`Not yet timed, so each ran at the record's middle time until a recording (--record) times it (${run.untimed.length}):`);
    for (const file of run.untimed) lines.push(`  ${file}`);
  }
  if (judged.skips.length > 0) {
    lines.push(`Skipped, each with its reason (${judged.skips.length}):`);
    for (const s of judged.skips) lines.push(`  ${s.file}: ${s.name}`, `    why: ${s.reason ?? "none given, a defect"}`);
  }
  lines.push("The ten slowest files in this run:");
  for (const r of [...run.first].sort((a, b) => b.ms - a.ms).slice(0, 10)) lines.push(`  ${`${(r.ms / 1000).toFixed(1)} s`.padStart(7)}  ${r.file}`);
  const why = [
    failed.length > 0 ? `${plural(failed.length, "file")} failed` : null,
    beside.length > 0 ? `${plural(beside.length, "file")} failed only beside the others` : null,
    judged.left.length > 0 ? `${plural(judged.left.length, "thing")} left in the temporary folder` : null,
    judged.skips.some((s) => s.reason === null) ? `${plural(judged.skips.filter((s) => s.reason === null).length, "skipped test")} with no reason given` : null,
    judged.typecheck?.ok === false ? "the typecheck failed" : null,
  ].filter((w) => w !== null);
  if (judged.overBar && budgetMs !== null) lines.push(`Over the bar: ${duration(run.ms)} against ${duration(budgetMs)}, with the machine's load average at ${run.load.before.toFixed(1)} when the run began. That is a measure to report, not a failure of the code.`);
  lines.push(judged.ok ? "Verdict: pass." : `Verdict: fail: ${why.join("; ")}.`);
  return lines;
}

/** What the busy-cores fixture saw: the file's run, and each process that kept a core busy while it ran (whether it spun throughout, and the CPU it used). */
export interface Busy {
  run: FileRun;
  burners: { throughout: boolean; cpuMs: number }[];
}

/** A process that keeps a core busy: it says so once, then spins until it is stopped. */
const BURN = 'process.stdout.write("spinning\\n"); for (;;) {}';

/**
 * Runs one test file as the gate runs a file, with every core busy (`cores` of them, the machine's by
 * default): a process spinning on each, each spinning before the file starts and stopped once it has
 * ended; then reports whether each spun throughout and the CPU time each used.
 */
export async function busy(options: { root?: string; file: string; bun?: readonly string[]; cores?: number }): Promise<Busy> {
  const burners = Array.from({ length: options.cores ?? availableParallelism() }, () => Bun.spawn([process.execPath, "-e", BURN], { stdout: "pipe", stderr: "ignore" }));
  const scratch = mkdtempSync(join(tmpdir(), "rpe-suite-"));
  try {
    // Each says it is spinning before the file starts; one that ended first says nothing, and shows below as not spinning throughout.
    await Promise.all(burners.map((b) => b.stdout.getReader().read()));
    const root = options.root ?? ROOT;
    const run = await runFile(root, options.file, { bun: options.bun ?? [], limitMs: FILE_LIMIT_MS, testLimitMs: TIMEOUT_MS, env: fileEnv(TIMEOUT_MS, findHost(root)), scratch, n: 1 });
    const throughout = burners.map((b) => b.exitCode === null && b.signalCode === null);
    for (const b of burners) b.kill("SIGKILL");
    await Promise.all(burners.map((b) => b.exited));
    return { run, burners: burners.map((b, i) => ({ throughout: throughout[i] === true, cpuMs: Number(b.resourceUsage()?.cpuTime.total ?? 0) / 1000 })) };
  } finally {
    for (const b of burners) b.kill("SIGKILL");
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** What a run with every core busy came to: the load, the file's result, the verdict last. */
export function summarizeBusy(b: Busy): string[] {
  const { run, burners } = b;
  const held = burners.filter((x) => x.throughout).length;
  const cpu = burners.reduce((sum, x) => sum + x.cpuMs, 0);
  const lines = [
    "",
    held === burners.length
      ? `With every core busy: ${plural(burners.length, "process", "processes")}, one per core, kept spinning from before ${run.file} started until after it ended, and used ${(cpu / 1000).toFixed(1)} s of CPU between them in its ${(run.ms / 1000).toFixed(1)} s.`
      : `Not every core was busy: only ${held} of ${plural(burners.length, "process", "processes")}, one per core, kept spinning until ${run.file} ended.`,
    run.ok ? `${run.file} passed: ${plural(run.passed, "test")}.` : `${run.file} failed:`,
  ];
  if (!run.ok) {
    for (const name of run.failed) lines.push(`  ${name}`);
    if (run.error !== null) lines.push(`  ${run.failed.length > 0 ? "and between its tests: " : ""}${run.error}`);
  }
  const why = [run.ok ? null : `${run.file} failed`, held === burners.length ? null : "not every core was busy throughout"].filter((w) => w !== null);
  lines.push(why.length === 0 ? "Verdict: pass." : `Verdict: fail: ${why.join("; ")}.`);
  return lines;
}

export interface Args {
  mode: "gate" | "list" | "record" | "busy" | "strike";
  jobs: number | null;
  root: string | null;
  /** The bar, in seconds (`BUDGET_S`). */
  budgetS: number;
  /** The file `--busy` runs. */
  busyFile: string | null;
  /** The listed files `--strike` is to strike off if they pass alone; none names every listed file. */
  strikeFiles: string[];
  bun: string[];
}

/**
 * The command line. Null for anything it doesn't take, for a recording given Bun's arguments (a
 * filtered file's time isn't the file's), and for a strike given them or a number of files at once (a
 * filtered file's pass isn't the file's, and a strike runs each listed file alone).
 */
export function parseArgs(argv: readonly string[]): Args | null {
  const args: Args = { mode: "gate", jobs: null, root: null, budgetS: BUDGET_S, busyFile: null, strikeFiles: [], bun: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--") {
      args.bun = argv.slice(i + 1);
      break;
    }
    if (a === "--record" || a === "--list" || a === "--strike") {
      if (args.mode !== "gate") return null;
      args.mode = a === "--record" ? "record" : a === "--list" ? "list" : "strike";
    } else if (a === "--root" || a === "--budget" || a === "--busy") {
      const value = argv[++i];
      if (value === undefined) return null;
      if (a === "--root") args.root = value;
      else if (a === "--budget") {
        if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) return null;
        args.budgetS = Number(value);
      } else {
        if (args.mode !== "gate") return null;
        args.mode = "busy";
        args.busyFile = value.replace(/^\.\//, "");
      }
    } else if (a.startsWith("-")) {
      args.bun = argv.slice(i);
      break;
    } else if (args.mode === "strike") args.strikeFiles.push(a.replace(/^\.\//, ""));
    else if (/^[1-9]\d*$/.test(a) && args.jobs === null) args.jobs = Number(a);
    else return null;
  }
  if (args.mode === "record" && args.bun.length > 0) return null;
  if (args.mode === "strike" && (args.bun.length > 0 || args.jobs !== null)) return null;
  return args;
}

const USAGE = "usage: bun scripts/test-all.ts [files at once] [--budget <s>] [--root <folder>] [-- <bun test arguments>]   (--list names the files; --record [files at once] records each file's time; --busy <test file> runs it with every core busy; --strike [listed test files] takes off the known list those that pass now, every listed file when none is named)";

async function main(argv: readonly string[]): Promise<number> {
  const cores = availableParallelism();
  const args = parseArgs(argv);
  if (args === null) {
    console.error(USAGE);
    return 2;
  }
  const root = resolve(args.root ?? ROOT);
  const files = testFiles(root);
  if (args.mode === "list") {
    for (const file of files) console.log(file);
    return 0;
  }
  if (args.mode === "strike") {
    const listed = new Set(readKnown(root).failures.map((e) => e.file));
    const stray = args.strikeFiles.filter((file) => !listed.has(file));
    if (stray.length > 0) {
      console.error(`not on the known list (${KNOWN}): ${stray.join(", ")}`);
      return 2;
    }
    const { struck, kept } = await strike(root, args.strikeFiles);
    console.log(struck.length === 0 ? `Nothing struck off the known list (${KNOWN}): no file ${args.strikeFiles.length === 0 ? "on it" : "named"} passes now or is gone.` : `Struck off the known list (${KNOWN}), as passing now or gone (${struck.length}):`);
    for (const e of struck) console.log(`  ${e.file} (${owned(e)})`);
    console.log(`Left on it: ${plural(kept.length, "known failure")}.`);
    return 0;
  }
  if (args.mode === "busy") {
    const file = args.busyFile ?? "";
    if (!files.includes(file)) {
      console.error(`not a test file of this suite: ${file}`);
      return 2;
    }
    console.log(`${file}, as the gate runs it, with a process spinning on every core.`);
    const loaded = await busy({ root, file, bun: args.bun });
    const lines = summarizeBusy(loaded);
    for (const line of lines) console.log(line);
    return lines.at(-1) === "Verdict: pass." ? 0 : 1;
  }
  const { bun } = args;
  const record = args.mode === "record";
  const asked = args.jobs ?? (record ? Math.floor(cores / 3) : cores - 2);
  const jobs = Math.max(1, Math.min(asked, cores));
  if (asked > cores) console.log(`${asked} at once is more than this machine's ${cores} cores: running ${jobs}, so each file has a core.`);
  console.log(`${files.length} test files, ${jobs} at a time, the slowest first${bun.length > 0 ? `, each given ${bun.join(" ")}` : ""}${record ? `; each one's time goes to ${TIMINGS}` : ""}.`);
  const host = findHost(root);
  console.log(hostLine(root, host));
  const started = performance.now();
  // The typecheck runs beside the files: a gate's whole run, never a recording or a filtered run.
  const checking = record || filtering(bun) ? null : typecheckOf(root);
  const ran = await runAll({
    root,
    jobs,
    host,
    files,
    bun,
    heard: (r, done, of) => {
      if (!r.ok) console.log(`${process.stdout.isTTY ? "\r" : ""}failed among the others, to run again alone at the end: ${r.file}${r.failed.length > 0 ? ` (${plural(r.failed.length, "test")})` : ""}`);
      if (process.stdout.isTTY) process.stdout.write(`\r${done}/${of} files`);
    },
  });
  const typecheck = checking === null ? null : await checking;
  // The gate's wall time is the typecheck's too, should it end after the files.
  const run: AllRun = { ...ran, ms: performance.now() - started };
  if (process.stdout.isTTY) process.stdout.write("\n");
  const known = readKnown(root);
  const judged = judge(run, { budgetMs: record ? null : args.budgetS * 1000, known, typecheck });
  if (!record) {
    mkdirSync(join(root, dirname(RECORD)), { recursive: true });
    writeFileSync(join(root, RECORD), `${JSON.stringify(runRecord(judged, new Date()), null, 2)}\n`);
  }
  for (const line of summarize(judged)) console.log(line);
  if (record) {
    // A failing run's time says little of a passing one's: a file that passed alone keeps that time, and one that failed there too keeps the record's earlier time where it has one.
    const before = readTimings(join(root, TIMINGS));
    const aloneOf = new Map(run.alone.map((r) => [r.file, r]));
    const timeOf = (r: FileRun): number => {
      if (r.ok) return r.ms;
      const alone = aloneOf.get(r.file);
      return alone?.ok ? alone.ms : (before.get(r.file) ?? r.ms);
    };
    const recorded = Object.fromEntries(run.first.map((r) => [r.file, Math.round(timeOf(r))] as const).sort(([, a], [, b]) => b - a));
    writeFileSync(join(root, TIMINGS), `${JSON.stringify({ version: 1, files: recorded }, null, 2)}\n`);
    console.log(`Each file's time is in ${TIMINGS}.`);
  }
  return judged.ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
