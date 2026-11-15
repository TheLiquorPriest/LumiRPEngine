// The release gate (`bun run test:release`, scripts/test/run.ts --release) runs every test file
// through the per-file runner, each in a process of its own, as the gate does: the files it names are
// the whole suite's. And the whole suite is every test file under test/, the proof scripts' tests in
// test/proof/ among them.

import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { testFiles } from "../../../scripts/test-all";

const RPE = resolve(import.meta.dir, "../../..");

/** The files a command names with `--list`, one a line. */
async function listed(script: string, ...args: string[]): Promise<string[]> {
  const child = Bun.spawn([process.execPath, script, ...args, "--list"], { cwd: RPE, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${script} ${args.join(" ")} --list exited ${code}: ${err}`);
  return out.split("\n").filter((line) => line.length > 0);
}

test("--release runs every test file through the per-file runner: its list is the whole suite's", async () => {
  const [release, gate] = await Promise.all([listed("scripts/test/run.ts", "--release"), listed("scripts/test-all.ts")]);
  expect(release).toEqual(gate);
  // The property suite is one of them, as in the gate; its shards on the fixed and fresh seeds come after. (Named by its end only: `bun run check`'s selection takes a test that names a folder as reading that folder's data files.)
  expect(release.filter((file) => file.endsWith("ledger/properties.test.ts"))).toHaveLength(1);
}, 20_000);

test("the whole suite's list is every test file under test/, test/proof/ among them", async () => {
  const gate = await listed("scripts/test-all.ts");
  expect(gate).toEqual(testFiles(RPE));
  expect(gate).toContain("test/proof/suites/release.test.ts");
  expect(gate.filter((file) => file.startsWith("test/proof/route/")).length).toBeGreaterThan(0);
  // The folders the first build's list left out are in it.
  for (const area of ["backend", "frontend", "packs", "engine", "cli", "shared", "ledger", "loop-sim", "docs", "scripts"]) expect(gate.some((file) => file.startsWith(`test/${area}/`))).toBe(true);
  for (const file of ["test/boundaries.test.ts", "test/cli-boundaries.test.ts", "test/manifest.test.ts"]) expect(gate).toContain(file);
}, 20_000);
