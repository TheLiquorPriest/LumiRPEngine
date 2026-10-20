// The targeted run's selection (scripts/test/select.ts): what a change runs, nearest first, within
// its budget, and what it reports as not run.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readRepo, readTimings, selectTests, type Repo, type Selection } from "../../scripts/test/select";

/** A repository of `imports` (each file's runtime imports) and `code` (what the files that read others run). */
function fixture(imports: Record<string, string[]>, code: Record<string, string> = {}): Repo {
  const files = [...new Set([...Object.keys(imports), ...Object.values(imports).flat(), ...Object.keys(code)])].sort();
  return { files, imports: new Map(Object.entries(imports)), code: (file) => code[file] ?? "" };
}

const run = (selection: Selection): string[] => selection.run.map((p) => p.file).sort();

// The backend's shape in miniature: every fake-host test reaches the runtime through the rig.
const backend = fixture({
  "src/backend/skip.ts": [],
  "src/backend/runtime.ts": ["src/backend/skip.ts"],
  "test/support/rig.ts": ["src/backend/runtime.ts"],
  "test/backend/runtime.test.ts": ["test/support/rig.ts"],
  "test/backend/skip.test.ts": ["test/support/rig.ts", "src/backend/skip.ts"],
  "test/backend/cheap.test.ts": ["test/support/rig.ts"],
  "test/backend/dear.test.ts": ["test/support/rig.ts"],
  "test/engine/time.test.ts": ["src/backend/runtime.ts"],
  "test/frontend/far.test.ts": ["test/support/rig.ts"],
});
const ms = new Map([
  ["test/backend/runtime.test.ts", 3000],
  ["test/backend/skip.test.ts", 10_000],
  ["test/backend/cheap.test.ts", 1000],
  ["test/backend/dear.test.ts", 20_000],
  ["test/engine/time.test.ts", 2000],
  ["test/frontend/far.test.ts", 500],
]);

describe("a targeted run", () => {
  test("a changed module runs its own test and the tests that import it, then its area's, then the rest, while they fit the budget", () => {
    const all = selectTests(backend, ["src/backend/skip.ts"], { timings: ms, budget: 100_000, releaseOnly: [] });
    expect(all.run.map((p) => p.file)).toEqual(["test/backend/skip.test.ts", "test/backend/cheap.test.ts", "test/backend/runtime.test.ts", "test/backend/dear.test.ts", "test/engine/time.test.ts", "test/frontend/far.test.ts"]);
    expect(all.run[0]?.why).toBe("named after src/backend/skip.ts");
    // Its own test always runs; past it, the area's tests go cheapest first, a dear one waits, and a cheap one further out still runs.
    const tight = selectTests(backend, ["src/backend/skip.ts"], { timings: ms, budget: 15_000, releaseOnly: [] });
    expect(run(tight)).toEqual(["test/backend/cheap.test.ts", "test/backend/runtime.test.ts", "test/backend/skip.test.ts", "test/frontend/far.test.ts"]);
    expect(tight.left.map((p) => p.file)).toEqual(["test/backend/dear.test.ts", "test/engine/time.test.ts"]);
  });

  test("a hub runs its nearest and cheapest tests, not every test that reaches it", () => {
    const rig = selectTests(backend, ["test/support/rig.ts"], { timings: ms, budget: 6000, releaseOnly: [] });
    expect(run(rig)).toEqual(["test/backend/cheap.test.ts", "test/backend/runtime.test.ts", "test/frontend/far.test.ts"]);
    expect(rig.left.map((p) => p.file).sort()).toEqual(["test/backend/dear.test.ts", "test/backend/skip.test.ts"]);
    // A test that imports the runtime itself goes before the ones the rig carries to it.
    const runtime = selectTests(backend, ["src/backend/runtime.ts"], { timings: ms, budget: 6000, releaseOnly: [] });
    expect(runtime.run.map((p) => p.file)).toEqual(["test/backend/runtime.test.ts", "test/engine/time.test.ts", "test/backend/cheap.test.ts"]);
  });

  test("a changed test runs itself whatever it costs, and a release-only test runs only when it imports what changed", () => {
    expect(run(selectTests(backend, ["test/backend/dear.test.ts"], { timings: ms, budget: 0, releaseOnly: [] }))).toEqual(["test/backend/dear.test.ts"]);
    const releaseOnly = ["test/backend/cheap.test.ts", "test/engine/time.test.ts"];
    expect(run(selectTests(backend, ["src/backend/runtime.ts"], { timings: ms, budget: 100_000, releaseOnly }))).toEqual(["test/backend/dear.test.ts", "test/backend/runtime.test.ts", "test/backend/skip.test.ts", "test/engine/time.test.ts", "test/frontend/far.test.ts"]);
  });

  test("a doc or data file runs the tests that read it, and those of the scripts that read it", () => {
    const repo = fixture(
      { "test/docs/recipes.test.ts": [], "scripts/templates/build.ts": [], "test/packs/templates/starters.test.ts": ["scripts/templates/build.ts"], "test/docs/other.test.ts": [] },
      { "test/docs/recipes.test.ts": 'join(import.meta.dir, "../../docs/RECIPES.md")', "scripts/templates/build.ts": 'join(ROOT, "data-src/templates", `${file}.json`)', "docs/RECIPES.md": "", "data-src/templates/town.json": "" },
    );
    const opts = { timings: new Map<string, number>(), budget: 60_000, releaseOnly: [] };
    expect(run(selectTests(repo, ["docs/RECIPES.md"], opts))).toEqual(["test/docs/recipes.test.ts"]);
    expect(run(selectTests(repo, ["data-src/templates/town.json"], opts))).toEqual(["test/packs/templates/starters.test.ts"]);
  });

  test("what no test reaches is reported, and a change to the runner's own setup runs everything", () => {
    const repo = fixture({ "src/frontend/palette.tsx": [], "test/frontend/a.test.ts": [] });
    const opts = { timings: new Map<string, number>(), budget: 60_000, releaseOnly: [] };
    expect(selectTests(repo, ["src/frontend/palette.tsx"], opts)).toMatchObject({ all: false, run: [], uncovered: ["src/frontend/palette.tsx"] });
    expect(selectTests(repo, ["bunfig.toml"], opts).all).toBe(true);
  });
});

describe("on this repository", () => {
  const root = resolve(import.meta.dir, "../..");
  const repo = readRepo(root);
  const timings = readTimings(resolve(root, "test/timings.json"));
  const opts = { timings, budget: 60_000, releaseOnly: ["test/ledger/properties.test.ts"] };

  test("the docs and the starter templates reach the tests that read them", () => {
    expect(run(selectTests(repo, ["docs/RECIPES.md"], opts))).toContain("test/docs/recipes.test.ts");
    expect(run(selectTests(repo, ["docs/AGENT-GUIDE.md"], opts))).toEqual(expect.arrayContaining(["test/docs/agent-guide.test.ts", "test/cli/tools.test.ts"]));
    expect(run(selectTests(repo, ["data-src/templates/fantasy-town.json"], opts))).toEqual(expect.arrayContaining(["test/packs/templates/starters.test.ts", "test/backend/agent-api.test.ts"]));
    expect(run(selectTests(repo, ["test/ledger/regressions.json"], opts))).toEqual(["test/ledger/regressions.test.ts"]);
  });

  test("a change to the property suite's runner takes the suite and its regressions; nothing further out takes the suite", () => {
    expect(run(selectTests(repo, ["test/support/ops.ts"], opts))).toEqual(expect.arrayContaining(["test/ledger/properties.test.ts", "test/ledger/regressions.test.ts"]));
    expect(run(selectTests(repo, ["src/engine/ledger/fold.ts"], opts))).not.toContain("test/ledger/properties.test.ts");
  });

  test("the hubs keep to the budget and still run their own tests", () => {
    for (const hub of ["src/backend/runtime.ts", "test/support/rig.ts", "src/shared/json.ts", "src/packs/index.ts"]) {
      const picked = selectTests(repo, [hub], opts);
      const spent = picked.run.reduce((sum, p) => sum + p.ms, 0);
      const own = picked.run.filter((p) => p.why.startsWith("named after")).reduce((sum, p) => sum + p.ms, 0);
      expect(spent).toBeLessThanOrEqual(Math.max(opts.budget, own));
      expect(picked.left.length).toBeGreaterThan(0);
    }
    expect(run(selectTests(repo, ["src/backend/runtime.ts"], opts))).toContain("test/backend/runtime.test.ts");
  });
});
