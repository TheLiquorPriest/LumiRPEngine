// Which test files cover a change: the selection behind `bun run test` (scripts/test/run.ts).
//
// Each changed path picks test files:
//   - a test file picks itself;
//   - a module picks the tests named after it, then the tests that import it, then the other tests
//     of its own area that reach it through their imports, then every other test that reaches it;
//   - any other file (a doc, a template, a table) picks the code that names it, and goes on from
//     there as that code would.
// The suite's import graph is dense: almost every test reaches the engine through the packs, and
// every fake-host test reaches the whole backend through the rig. So the changed tests, the tests
// named after a changed module and the tests that read a changed file always run, and the rest are
// taken nearest first, then cheapest first, while their recorded time fits the budget. A hub such as
// `src/backend/runtime.ts` or `test/support/rig.ts` therefore runs its nearest and cheapest tests,
// not every test that reaches it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

/** The repository as the selection sees it. */
export interface Repo {
  /** Every file, repo-relative. */
  files: readonly string[];
  /** Each code file's runtime imports, resolved to repo files (type-only imports run nothing). */
  imports: ReadonlyMap<string, readonly string[]>;
  /** A code file's code without its comments (a path named in a comment reads nothing), asked only when a non-code file changes. */
  code(file: string): string;
}

export interface Options {
  /** Recorded milliseconds per test file; a file without a record counts as the median. */
  timings: ReadonlyMap<string, number>;
  /** Recorded milliseconds the run may spend on the tests it takes nearest first. */
  budget: number;
  /** Test files that run only when they changed or import what changed (the property suite). */
  releaseOnly: readonly string[];
}

export interface Pick {
  file: string;
  /** Why it was picked, for the run's report. */
  why: string;
  ms: number;
}

export interface Selection {
  /** A change to the test runner's own setup (bunfig, tsconfig, the lockfile): run everything. */
  all: boolean;
  run: Pick[];
  /** Tests that reach what changed but didn't fit the budget. */
  left: Pick[];
  /** Changed files no test reaches. */
  uncovered: string[];
}

/** Files every test runs under: a change to one is a change to all of them. */
export const GLOBAL_INPUTS: Readonly<Record<string, true>> = { "bunfig.toml": true, "tsconfig.json": true, "bun.lock": true };

export const isTest = (file: string): boolean => file.startsWith("test/") && /\.test\.tsx?$/.test(file);
const isCode = (file: string): boolean => /\.tsx?$/.test(file) && !file.endsWith(".d.ts");

/** The test directories of a module's own area, where its other tests live. */
export function areaOf(file: string): string[] {
  const parts = file.split("/");
  const [top, dir, sub] = parts;
  if (top === "src") {
    if (dir === "engine" && sub === "ledger") return ["test/ledger/", "test/engine/"];
    if (dir === "worker") return ["test/backend/"];
    if (dir === "packs") {
      if (parts.length === 3) return ["test/packs/"];
      if (sub === "starters") return ["test/packs/templates/"];
      return parts[3] === "ui" ? [`test/packs/${sub}/`, "test/frontend/"] : [`test/packs/${sub}/`];
    }
    return parts.length > 2 && dir ? [`test/${dir}/`] : [];
  }
  if (top === "scripts" && dir) return dir === "reference" ? ["test/docs/"] : dir === "test" ? ["test/scripts/"] : [`test/packs/${dir}/`];
  if (top === "dev") return ["test/frontend/"];
  // A test's own helpers (test/packs/economy/work-world.ts) belong to their directory; the shared
  // ones in test/support/ belong to every area, so they have none of their own.
  if (top === "test" && dir !== "support" && parts.length > 2) return [`${dirname(file)}/`];
  return [];
}

/** The name a module's own test carries: `skip.ts` → `skip`, a pack's `core/index.ts` → the pack. */
function stem(file: string): string | null {
  const name = basename(file).replace(/\.tsx?$/, "");
  if (name !== "index") return name;
  const parents = dirname(file).split("/").filter((p) => p !== "core" && p !== "ui");
  return parents.length > 1 ? (parents.at(-1) ?? null) : null;
}

/**
 * Whether `source` names `file`: a module by its path (a test that runs a script or the CLI as a
 * process); a data file also by its last two segments, its quoted file name or its directory (a
 * test that reads every template names their directory).
 */
function names(code: string, file: string): boolean {
  if (code.includes(file)) return true;
  if (isCode(file)) return false;
  const dir = dirname(file);
  return code.includes(file.split("/").slice(-2).join("/")) || code.includes(`"${basename(file)}"`) || code.includes(`/${basename(file)}`) || (dir.includes("/") && code.includes(dir));
}

function median(values: Iterable<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1000;
}

interface Near {
  tier: number;
  distance: number;
  why: string;
}

export function selectTests(repo: Repo, changed: readonly string[], options: Options): Selection {
  const exists = new Set(repo.files);
  const tests = repo.files.filter(isTest);
  const importers = new Map<string, string[]>();
  for (const [file, deps] of repo.imports) for (const dep of deps) importers.set(dep, [...(importers.get(dep) ?? []), file]);
  const fallback = median(options.timings.values());
  const ms = (file: string): number => options.timings.get(file) ?? fallback;

  const must = new Map<string, string>();
  const near = new Map<string, Near>();
  const uncovered: string[] = [];
  let all = false;

  const offer = (test: string, tier: number, distance: number, why: string): void => {
    const known = near.get(test);
    if (!known || tier < known.tier || (tier === known.tier && distance < known.distance)) near.set(test, { tier, distance, why });
  };

  /** Picks the tests of a module, a test helper or an imported data file; returns whether any test reaches it. */
  const fromModule = (module: string, reason: string): boolean => {
    let found = false;
    const own = stem(module);
    const area = areaOf(module);
    // Within the module's area: a `build.ts` of the templates is not the tables' `build.test.ts`.
    const named = own === null ? [] : tests.filter((t) => basename(t) === `${own}.test.ts` && t !== module && (area.length === 0 || area.some((a) => t.startsWith(a))));
    for (const t of named) {
      must.set(t, must.get(t) ?? `named after ${module}${reason}`);
      found = true;
    }
    // Breadth first over importers: the first time a test is met is its nearest path to the module.
    const seen = new Set<string>([module]);
    let layer = [module];
    for (let distance = 1; layer.length > 0; distance++) {
      const next: string[] = [];
      for (const node of layer) {
        for (const importer of importers.get(node) ?? []) {
          if (seen.has(importer)) continue;
          seen.add(importer);
          if (!isTest(importer)) {
            next.push(importer);
            continue;
          }
          found = true;
          const tier = distance === 1 ? 0 : area.some((a) => importer.startsWith(a)) ? 1 : 2;
          offer(importer, tier, distance, distance === 1 ? `imports ${module}${reason}` : `reaches ${module} through ${node}${reason}`);
        }
      }
      layer = next;
    }
    return found;
  };

  for (const file of changed) {
    if (Object.hasOwn(GLOBAL_INPUTS, file)) {
      all = true;
      continue;
    }
    // A deleted file's importers changed with it, and they are in the change themselves.
    if (!exists.has(file)) continue;
    if (isTest(file)) {
      must.set(file, "changed");
      continue;
    }
    // Its importers (a JSON or Markdown import counts), then the tests and scripts that name it: a
    // test reads a doc or a template by its path, or runs a script or the CLI as a process. Engine
    // code takes its data only by importing it, and the selection and its tests name files without
    // reading them.
    let found = fromModule(file, "");
    for (const reader of repo.files) {
      if (reader === file || !isCode(reader) || !/^(test|scripts)\//.test(reader) || /^(scripts\/test|test\/scripts)\//.test(reader) || !names(repo.code(reader), file)) continue;
      found = true;
      if (isTest(reader)) must.set(reader, must.get(reader) ?? `reads ${file}`);
      else fromModule(reader, `, which reads ${file}`);
    }
    if (!found) uncovered.push(file);
  }

  const run: Pick[] = [...must].map(([file, why]) => ({ file, why, ms: ms(file) }));
  const left: Pick[] = [];
  let spent = run.reduce((sum, p) => sum + p.ms, 0);
  const ranked = [...near]
    .filter(([file, n]) => !must.has(file) && (n.tier === 0 || !options.releaseOnly.includes(file)))
    .sort(([fa, a], [fb, b]) => a.tier - b.tier || a.distance - b.distance || ms(fa) - ms(fb) || fa.localeCompare(fb));
  for (const [file, n] of ranked) {
    const pick = { file, why: n.why, ms: ms(file) };
    // Over the budget, a dearer test is left and cheaper ones further out still run.
    if (spent + pick.ms <= options.budget) {
      run.push(pick);
      spent += pick.ms;
    } else left.push(pick);
  }
  return { all, run, left, uncovered };
}

// ------------------------------------------------------------------ the repository on disk

const git = (root: string, args: string[]): string[] => {
  const out = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.trim()}`);
  return out.stdout.split("\n").filter((line) => line.length > 0);
};

/** Files changed since the branch left `base` (committed, staged or not), and untracked ones. */
export function changedSince(root: string, base: string): { since: string; files: string[] } {
  const [since] = git(root, ["merge-base", base, "HEAD"]);
  if (!since) throw new Error(`no merge base with ${base}`);
  const files = [...git(root, ["diff", "--name-only", "--no-renames", since]), ...git(root, ["ls-files", "--others", "--exclude-standard"])];
  return { since, files: [...new Set(files)].sort() };
}

/** The repository's files and their runtime imports, as the working tree has them. */
export function readRepo(root: string): Repo {
  const files = [...new Set([...git(root, ["ls-files"]), ...git(root, ["ls-files", "--others", "--exclude-standard"])])].filter((f) => existsSync(join(root, f))).sort();
  const known = new Set(files);
  const ts = new Bun.Transpiler({ loader: "ts" });
  const tsx = new Bun.Transpiler({ loader: "tsx" });
  const resolve = (from: string, spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const target = normalize(join(dirname(from), spec));
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`, target.replace(/\.js$/, ".ts")]) if (known.has(candidate)) return candidate;
    return null;
  };
  const imports = new Map<string, string[]>();
  for (const file of files) {
    if (!isCode(file)) continue;
    // The scanner reads a shebang line as code.
    const text = readFileSync(join(root, file), "utf8").replace(/^#!/, "//");
    const deps = (file.endsWith(".tsx") ? tsx : ts).scanImports(text).flatMap((i) => resolve(file, i.path) ?? []);
    imports.set(file, [...new Set(deps)]);
  }
  const compiled = new Map<string, string>();
  const code = (file: string): string => {
    let text = compiled.get(file);
    if (text === undefined) {
      text = (file.endsWith(".tsx") ? tsx : ts).transformSync(readFileSync(join(root, file), "utf8").replace(/^#!/, "//"));
      compiled.set(file, text);
    }
    return text;
  };
  return { files, imports, code };
}

/** Per-file durations as `bun test --timings` records them (`{ version, files }`). */
export function readTimings(path: string): Map<string, number> {
  if (!existsSync(path)) return new Map();
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const files = typeof parsed === "object" && parsed !== null && "files" in parsed ? parsed.files : null;
  if (typeof files !== "object" || files === null) return new Map();
  return new Map(Object.entries(files).flatMap(([file, value]) => (typeof value === "number" ? [[file, value] as const] : [])));
}
