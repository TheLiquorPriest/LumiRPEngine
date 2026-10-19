// What keeps the `lumirpengine` CLI and the extension apart (the per-import rules are the `cli` zone in
// boundaries.test.ts): everything the CLI's entry reaches, import by import, stays clear of the
// frontend, the packs' UI and Preact, and of the backend; and the built backend carries nothing the
// host's install scan refuses, so the CLI's Node imports never leak into it.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;

function resolveLocal(file: string, spec: string): string | null {
  const base = resolve(dirname(file), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Every module the entry reaches by value or by type, and every package any of them names. */
function reach(entry: string): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const spec = m[1] ?? "";
      if (!spec.startsWith(".")) {
        packages.add(spec);
        continue;
      }
      const target = resolveLocal(file, spec);
      if (target !== null) queue.push(target);
    }
  }
  return { files: [...seen].map((f) => relative(ROOT, f).split("\\").join("/")), packages: [...packages] };
}

describe("the CLI bundle", () => {
  const { files, packages } = reach(join(SRC, "cli/main.ts"));

  test("reaches no frontend, pack UI or backend code, and no package but Node's own", () => {
    expect(files.filter((f) => /^src\/(frontend|backend|worker)\/|^src\/packs\/[^/]+\/ui\/|^src\/(frontend|backend)\.tsx?$/.test(f))).toEqual([]);
    expect(packages.filter((p) => !p.startsWith("node:"))).toEqual([]);
  });

  test("bundles the engine through the studio seam, and the docs and schemas it serves", () => {
    expect(files).toContain("src/studio-api.ts");
    for (const doc of ["AGENT-GUIDE", "REFERENCE", "EXPRESSIONS", "RECIPES", "DESIGN", "USER-GUIDE", "STUDIO", "PRESETS"]) expect(files).toContain(`docs/${doc}.md`);
    expect(files).toContain("schemas/lre-world-v1.schema.json");
  });
});

test.skipIf(!existsSync(join(ROOT, "dist/backend.js")))("the built backend has nothing the host's install scan refuses", () => {
  const js = readFileSync(join(ROOT, "dist/backend.js"), "utf8");
  for (const word of ["node:fs", "child_process", "node:net", "worker_threads", "lumirpengine login"]) expect({ word, found: js.includes(word) }).toEqual({ word, found: false });
});

test.skipIf(!existsSync(join(ROOT, "dist/lumirpengine.js")))("the built CLI starts with its shebang, so `npx` and the bin link can run it", () => {
  expect(readFileSync(join(ROOT, "dist/lumirpengine.js"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
});
