// The suite's known failures, kept as data beside the runner (test/proof/suites/known.json): a
// failure not on the list fails the gate; a listed one is reported with the package that fixes it and
// that package's wave, and does not. The gate never writes the list: a listed file that passes now
// fails the gate until `--strike` takes it off, and a leftover's pattern that nothing matched is only
// said, since a leftover comes only when a run fails. Every file here is a small one made for it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Known } from "../../../scripts/test-all";

const RPE = resolve(import.meta.dir, "../../..");
const KNOWN = "test/proof/suites/known.json";

let root = "";

const write = (file: string, body: string): void => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), `import { expect, test } from "bun:test";\n${body}\n`);
};

const LIST: Known = {
  failures: [
    { file: "test/listed.test.ts", owner: "PlanX-1", wave: "2", why: "it waits on what PlanX-1 builds" },
    { file: "test/fixed.test.ts", owner: "PlanY-2", wave: "1", why: "it failed until PlanY-2 landed" },
  ],
  leftovers: [
    { name: "rpe-standin-*", owner: "PlanAdapter-S17", wave: "the ground", why: "the stand-in's folder goes only when it is closed" },
    { name: "never-left-*", owner: "PlanZ-3", wave: "3", why: "nothing leaves this any more" },
  ],
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "rpe-known-"));
  write("test/unlisted.test.ts", 'test("fails, and is on no list", () => expect(1).toBe(2));');
  write("test/listed.test.ts", 'test("fails as the list says", () => expect(1).toBe(2));');
  write("test/fixed.test.ts", 'test("passes now", () => expect(1).toBe(1));');
  write("test/stand.test.ts", 'import { mkdirSync } from "node:fs";\nimport { tmpdir } from "node:os";\ntest("leaves a stand-in\'s folder", () => {\n  mkdirSync(`${tmpdir()}/rpe-standin-AbC123`);\n});');
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "fixture", private: true, scripts: { typecheck: "true" } })}\n`);
  mkdirSync(join(root, "test/proof/suites"), { recursive: true });
  writeFileSync(join(root, KNOWN), `${JSON.stringify(LIST, null, 2)}\n`);
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

/** The runner on the fixture suite with these arguments: its exit code and what it printed. */
async function cli(...args: string[]): Promise<{ code: number; out: string }> {
  const child = Bun.spawn([process.execPath, "scripts/test-all.ts", "--root", root, ...args], { cwd: RPE, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, out };
}

const listed = (): string => readFileSync(join(root, KNOWN), "utf8");

const STRIKE = "On the known list but passing now, or gone: strike them off once their owner's package has landed (bun scripts/test-all.ts --strike)";

test("a failure not on the list fails the gate; a listed one is reported with its owner and wave; a listed file that passes now is named to strike off, apart from the verdict; the gate never writes the list", async () => {
  const before = listed();
  const first = await cli("4");
  expect(first.code).toBe(1);
  expect(first.out).toContain("Failed, also when run alone (1):\n  test/unlisted.test.ts\n    fails, and is on no list\n");
  expect(first.out).toContain("Known failures, each with the package that fixes it and its wave (1):\n  test/listed.test.ts: PlanX-1, wave 2: it waits on what PlanX-1 builds\n    fails as the list says\n");
  expect(first.out).toContain("Known leftovers in the temporary folder, each with the package that fixes it and its wave (1):\n  test/stand.test.ts: rpe-standin-AbC123/ (PlanAdapter-S17, the ground: the stand-in's folder goes only when it is closed)\n");
  expect(first.out).toContain(`${STRIKE} (1):\n  test/fixed.test.ts: it passes now (PlanY-2, wave 1)\n`);
  expect(first.out).toContain("Known leftovers that no file left this time, kept on the list, since a leftover comes only when a run fails (1):\n  never-left-* (PlanZ-3, wave 3)\n");
  expect(first.out.trimEnd().split("\n").at(-1)).toBe("Verdict: fail: 1 file failed.");
  expect(listed()).toBe(before);
  // With the unlisted failure gone the gate passes: the listed file that passes is still named, and the list stays as it was.
  rmSync(join(root, "test/unlisted.test.ts"));
  const second = await cli("4");
  expect(second.out).toContain(`${STRIKE} (1):\n  test/fixed.test.ts: it passes now (PlanY-2, wave 1)\n`);
  expect(second.out.trimEnd().split("\n").at(-1)).toBe("Verdict: pass.");
  expect(second.code).toBe(0);
  expect(listed()).toBe(before);
}, 60_000);

test("`--strike` runs listed files alone and takes off the list those that pass or are gone, the ones named or else every one, keeping its leftover patterns", async () => {
  rmSync(join(root, "test/unlisted.test.ts"), { force: true });
  write("test/also-fixed.test.ts", 'test("passes now too", () => expect(1).toBe(1));');
  const more = [
    { file: "test/also-fixed.test.ts", owner: "PlanV-5", wave: "2", why: "it failed until PlanV-5 landed" },
    { file: "test/gone.test.ts", owner: "PlanW-4", wave: "4", why: "the suite had it once" },
  ];
  writeFileSync(join(root, KNOWN), `${JSON.stringify({ ...LIST, failures: [...LIST.failures, ...more] }, null, 2)}\n`);
  // Named: only that file is struck, though another listed file passes too.
  const one = await cli("--strike", "test/also-fixed.test.ts");
  expect(one.code).toBe(0);
  expect(one.out).toBe(`Struck off the known list (${KNOWN}), as passing now or gone (1):\n  test/also-fixed.test.ts (PlanV-5, wave 2)\nLeft on it: 3 known failures.\n`);
  expect(JSON.parse(listed())).toEqual({ failures: [...LIST.failures, more[1]], leftovers: LIST.leftovers });
  // A file the list doesn't hold is refused, and the list is left as it is.
  const named = listed();
  const stray = await cli("--strike", "test/also-fixed.test.ts");
  expect(stray.code).toBe(2);
  expect(listed()).toBe(named);
  // None named: every listed file that passes alone, or is gone.
  const all = await cli("--strike");
  expect(all.out).toBe(`Struck off the known list (${KNOWN}), as passing now or gone (2):\n  test/fixed.test.ts (PlanY-2, wave 1)\n  test/gone.test.ts (PlanW-4, wave 4)\nLeft on it: 1 known failure.\n`);
  expect(JSON.parse(listed())).toEqual({ failures: [LIST.failures[0]], leftovers: LIST.leftovers });
  // Nothing left to strike: the listed failure is reported with its owner, nothing is named to strike off, and the gate passes.
  const after = await cli("4");
  expect(after.out).toContain("Known failures, each with the package that fixes it and its wave (1):\n  test/listed.test.ts: PlanX-1, wave 2: it waits on what PlanX-1 builds\n");
  expect(after.out).not.toContain(STRIKE);
  expect(after.out.trimEnd().split("\n").at(-1)).toBe("Verdict: pass.");
  expect(after.code).toBe(0);
  // Struck again, nothing on the list passes: it stays as it is.
  const settled = listed();
  const again = await cli("--strike");
  expect(again.out).toBe(`Nothing struck off the known list (${KNOWN}): no file on it passes now or is gone.\nLeft on it: 1 known failure.\n`);
  expect(listed()).toBe(settled);
}, 60_000);
