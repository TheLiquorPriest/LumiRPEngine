// The build (`scripts/build.ts`), bundle by bundle: what this test builds is read off the script,
// with its flags, so a change there changes what runs here. Each bundle's inputs are listed (Bun's
// metafile) and none lies outside the repository, so a bundle holds the same code wherever it is
// built; `supports-color`, which nothing here installs and nothing needs, is in none of them; the
// runtime built so starts from a folder with nothing around it; the backend holds nothing
// Lumiverse's install scan refuses; and the runtime's model layer, built as the runtime is, ends an
// agent's session on a runtime that has called no provider yet.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { LEFT_OUT, RUNTIME_FLAGS } from "../../node_modules/lumi-ah/scripts/bundle-flags";
import { installScan } from "../../scripts/install-scan";

const ROOT = resolve(import.meta.dir, "../..");
const SCRIPT = readFileSync(join(ROOT, "scripts/build.ts"), "utf8");

/** The runtime's entry, as the script names it. */
const RUNTIME_ENTRY = /const RUNTIME_ENTRY = "([^"]+)";/.exec(SCRIPT)?.[1] ?? "";

/** Each bundle the script makes, in its order, as its `bundle(...)` calls name them, with the flags each is given: LumiAH's runtime flags where the call passes them. */
const BUNDLES = [...SCRIPT.matchAll(/\bbundle\((RUNTIME_ENTRY|"[^"]+"), "([^"]+)", "(bun|node|browser)"([^;]*)\);/g)].map((m) => ({ entry: m[1] === "RUNTIME_ENTRY" ? RUNTIME_ENTRY : (m[1] ?? "").slice(1, -1), out: m[2] ?? "", target: m[3] ?? "", flags: /\bRUNTIME_FLAGS\b/.test(m[4] ?? "") ? RUNTIME_FLAGS : [] }));

/** What every bundle leaves out, as the script leaves it out. */
const LEFT = LEFT_OUT.flatMap((name) => ["--external", name]);

/** Every constant the script defines into a bundle, each given a made-up value here: the build id is this test's own. */
const DEFINES = [...new Set([...SCRIPT.matchAll(/"(process\.env\.[A-Z0-9_]+)":/g)].map((m) => m[1] ?? ""))].flatMap((name) => ["--define", `${name}=${JSON.stringify(name.endsWith("BUILD_ID") ? "build-test" : "0")}`]);

/** A path from the repository's root that leads out of it. */
const outside = (path: string): boolean => {
  const from = relative(ROOT, resolve(ROOT, path));
  return from.startsWith("..") || isAbsolute(from);
};

describe("the build", () => {
  let dir = "";
  /** What each bundle came to: its inputs, each by its path from the repository's root, or why it wasn't built. */
  const built = new Map<string, { inputs: string[] } | { failed: string }>();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lre-build-test-"));
    for (const { entry, out, target, flags } of BUNDLES) {
      const file = join(dir, out);
      mkdirSync(dirname(file), { recursive: true });
      // As the script bundles it, into a folder of this test's own: the same entry, target and flags, the packages left out, the inputs listed, and the constants defined.
      const meta = `${file}.meta.json`;
      const run = Bun.spawnSync([process.execPath, "build", entry, "--outfile", file, "--target", target, ...flags, ...LEFT, `--metafile=${meta}`, ...DEFINES], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
      built.set(out, run.exitCode === 0 ? { inputs: Object.keys(JSON.parse(readFileSync(meta, "utf8")).inputs) } : { failed: `bun build failed (${run.exitCode}): ${run.stderr.toString()}${run.stdout.toString()}` });
    }
  }, 120_000);

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  const inputsOf = (out: string): string[] => {
    const one = built.get(out);
    if (one === undefined || "failed" in one) throw new Error(`${out}: ${one === undefined ? "not built" : one.failed}`);
    return one.inputs;
  };

  test("builds every bundle `bun run build` makes, the runtime with LumiAH's runtime flags, each with what LumiAH leaves out left out and its inputs listed", () => {
    expect(BUNDLES.map((b) => [b.out, b.target, b.flags])).toEqual([
      ["dist/lumiah.js", "bun", RUNTIME_FLAGS],
      ["dist/agent-kit.js", "node", []],
      ["dist/backend.js", "bun", []],
      ["dist/frontend.js", "browser", []],
      ["dist/worker/background-lane.js", "bun", []],
      ["dist/lumirpengine.js", "node", []],
    ]);
    expect(RUNTIME_ENTRY).toBe("node_modules/lumi-ah/src/runtime/main.ts");
    // The script takes both lists from LumiAH's file, as this test does, and gives them to `bun build` as this test does.
    expect(SCRIPT).toContain('import { LEFT_OUT, RUNTIME_FLAGS } from "../node_modules/lumi-ah/scripts/bundle-flags";');
    expect(SCRIPT).toContain('const left = LEFT_OUT.flatMap((name) => ["--external", name]);');
    expect(SCRIPT).toContain('[process.execPath, "build", entry, "--outfile", out, "--target", target, ...flags, ...left, `--metafile=${meta}`, ...defines]');
    expect([...built].flatMap(([out, one]) => ("failed" in one ? [`${out}: ${one.failed}`] : []))).toEqual([]);
  });

  test("no bundle takes a file from outside the repository, so each holds the same code wherever it is built", () => {
    for (const { out } of BUNDLES) {
      const inputs = inputsOf(out);
      expect({ out, some: inputs.length > 0 }).toEqual({ out, some: true });
      expect({ out, outside: inputs.filter(outside) }).toEqual({ out, outside: [] });
    }
  });

  test("no bundle holds supports-color, nor has-flag, which came only with it; the runtime built without it starts from a folder with nothing around it", () => {
    for (const { out } of BUNDLES) expect({ out, held: inputsOf(out).filter((path) => /(^|\/)node_modules\/(supports-color|has-flag)\//.test(path)) }).toEqual({ out, held: [] });
    // debug, which asks for it in a try/catch, is in the runtime: the ask stays a require of its name, which fails where nothing provides it, and debug does without it.
    expect(inputsOf("dist/lumiah.js").some((path) => /(^|\/)node_modules\/debug\//.test(path))).toBe(true);
    expect(readFileSync(join(dir, "dist/lumiah.js"), "utf8")).toMatch(/require\("supports-color"\)/);
    const alone = mkdtempSync(join(tmpdir(), "lre-build-alone-"));
    try {
      copyFileSync(join(dir, "dist/lumiah.js"), join(alone, "lumiah.js"));
      const run = Bun.spawnSync([process.execPath, "lumiah.js", "--version"], { cwd: alone, stdout: "pipe", stderr: "pipe" });
      expect({ code: run.exitCode, said: run.stdout.toString().trim(), err: run.stderr.toString() }).toEqual({ code: 0, said: expect.stringMatching(/^lumiah \S+ \(build build-test\)$/), err: "" });
    } finally {
      rmSync(alone, { recursive: true, force: true });
    }
  });

  test("the backend holds nothing Lumiverse's install scan refuses, so it installs", () => {
    expect(inputsOf("dist/backend.js").length).toBeGreaterThan(0);
    expect(installScan(readFileSync(join(dir, "dist/backend.js"), "utf8"))).toEqual([]);
  });

  test("the runtime's model layer, built as the runtime is, ends an agent's session on a runtime that has called no provider yet", () => {
    // Bun's bundler starts a module lazily when another loads it with `import()`, and for a package that declares its modules free of side effects (the model library is one) it leaves that start out for whoever imports the module the plain way: built without LumiAH's runtime flags, the end of every agent's session threw ("undefined is not an object") on a runtime that had called no Anthropic model. A runtime whose connections are all of one provider never loads the others' code, so nothing that code would have started may be needed to end a session.
    const runtime = BUNDLES.find((b) => b.out === "dist/lumiah.js");
    if (runtime === undefined) throw new Error("the script builds no dist/lumiah.js");
    const scratch = mkdtempSync(join(tmpdir(), "lre-build-ended-"));
    try {
      const entry = join(scratch, "entry.ts");
      const bundled = join(scratch, "entry.js");
      // The model layer exactly as the runtime makes it, and the one thing the end of an agent's run asks of it.
      writeFileSync(
        entry,
        [
          `import { createModelLayer } from ${JSON.stringify(join(ROOT, "node_modules/lumi-ah/src/runtime/models/index.ts"))};`,
          "const layer = createModelLayer({ dir: process.argv[2] ?? '.', now: () => Date.now(), id: () => crypto.randomUUID(), uuid: () => crypto.randomUUID(), log: () => {}, fetch, setTimeout, clearTimeout, caching: () => ({}), passConnection: async () => null, env: {} });",
          'layer.models.ended("a session");',
          'console.log("ended");',
          "process.exit(0);",
        ].join("\n"),
      );
      const made = Bun.spawnSync([process.execPath, "build", entry, "--outfile", bundled, "--target", runtime.target, ...runtime.flags, ...LEFT], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
      expect({ code: made.exitCode, err: made.exitCode === 0 ? "" : made.stderr.toString() }).toEqual({ code: 0, err: "" });
      const ran = Bun.spawnSync([process.execPath, bundled, scratch], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
      expect({ out: ran.stdout.toString().trim(), err: ran.stderr.toString().trim(), code: ran.exitCode }).toEqual({ out: "ended", err: "", code: 0 });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});
