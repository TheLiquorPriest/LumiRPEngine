// A file the per-file runner's record of times (test/timings-all.json) doesn't hold yet, one a lane
// has added since the last recording, is no fault of the suite's: the gate runs it at the record's
// middle time, after the slower files and before the quicker, and names it in its summary and in
// what it writes of the run as not yet timed, until a recording times it (`--record`, as the lead's
// check does at a wave's end, beside `bun scripts/test/run.ts --timings` for `bun run check`'s own
// record). The recording writes a time for every file it runs, from the per-file runner itself, and
// only theirs.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { judge, runAll, runRecord, summarize } from "../../../scripts/test-all";
import { readTimings } from "../../../scripts/test/select";

const RPE = resolve(import.meta.dir, "../../..");

const write = (at: string, file: string, body: string): void => {
  mkdirSync(join(at, file, ".."), { recursive: true });
  writeFileSync(join(at, file), `import { expect, test } from "bun:test";\n${body}\n`);
};

test("a file the record doesn't hold runs at the record's middle time and is named as not yet timed, which fails nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "rpe-untimed-"));
  try {
    for (const name of ["slow", "middle", "quick", "new"]) write(root, `test/${name}.test.ts`, `test("${name}", () => expect(1).toBe(1));`);
    writeFileSync(join(root, "test/timings-all.json"), `${JSON.stringify({ version: 1, files: { "test/slow.test.ts": 5000, "test/middle.test.ts": 1000, "test/quick.test.ts": 10 } })}\n`);
    // One file at a time, so they end in the order they started: the new one at the middle file's
    // time, which it shares, so the name settles which goes first.
    const run = await runAll({ root, jobs: 1 });
    expect(run.first.map((r) => r.file)).toEqual(["test/slow.test.ts", "test/middle.test.ts", "test/new.test.ts", "test/quick.test.ts"]);
    expect(run.untimed).toEqual(["test/new.test.ts"]);
    const judged = judge(run);
    const lines = summarize(judged);
    const said = lines.indexOf("Not yet timed, so each ran at the record's middle time until a recording (--record) times it (1):");
    expect(lines.slice(said, said + 2)).toEqual(["Not yet timed, so each ran at the record's middle time until a recording (--record) times it (1):", "  test/new.test.ts"]);
    expect(runRecord(judged, new Date()).untimed).toEqual(["test/new.test.ts"]);
    expect(lines.at(-1)).toBe("Verdict: pass.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("with no record at all, every file is untimed and they run in the order of their names", async () => {
  const root = mkdtempSync(join(tmpdir(), "rpe-untimed-"));
  try {
    for (const name of ["b", "a", "c"]) write(root, `test/${name}.test.ts`, `test("${name}", () => expect(1).toBe(1));`);
    const run = await runAll({ root, jobs: 1 });
    expect(run.first.map((r) => r.file)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
    expect(run.untimed).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("a recording runs every file through the per-file runner and writes each one's time, and only theirs", async () => {
  const root = mkdtempSync(join(tmpdir(), "rpe-timings-"));
  try {
    write(root, "test/quick.test.ts", 'test("one", () => expect(1).toBe(1));');
    write(root, "test/deep/also.test.ts", 'test("two", () => expect(2).toBe(2));');
    // A file the suite no longer has: the recording does not keep it.
    writeFileSync(join(root, "test/timings-all.json"), `${JSON.stringify({ version: 1, files: { "test/gone.test.ts": 900 } })}\n`);
    const child = Bun.spawn([process.execPath, "scripts/test-all.ts", "--record", "--root", root, "2"], { cwd: RPE, stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    const recorded = readTimings(join(root, "test/timings-all.json"));
    expect([...recorded.keys()].sort()).toEqual(["test/deep/also.test.ts", "test/quick.test.ts"]);
    expect([...recorded.values()].every((ms) => ms > 0)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
