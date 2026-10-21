// What keeps the `lumirpengine` CLI and the extension apart (the per-import rules are the `cli` zone in
// boundaries.test.ts): everything the CLI's core and its agent kit reach, import by import, stays
// clear of the frontend, the packs' UI and Preact, and of the backend; the core reaches no tool code,
// so following the extension's kit changes everything but the transport (DESIGN §23); and the built
// backend carries nothing the host's install scan refuses, so the CLI's Node imports never leak into it.

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

/** Every module the entry reaches by value or by type (or by value only), and every package any of them names. */
function reach(entry: string, valuesOnly = false): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const spec = m[1] ?? "";
      // A type import is erased: it bundles nothing.
      if (valuesOnly && /^\s*(?:import|export)\s+type\s/.test(m[0].replace(/^\n/, ""))) continue;
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

describe("the CLI bundles", () => {
  const core = reach(join(SRC, "cli/main.ts"));
  const kit = reach(join(SRC, "cli/agent-kit.ts"));

  test("reach no frontend, pack UI or backend code, and no package but Node's own", () => {
    for (const { files, packages } of [core, kit]) {
      expect(files.filter((f) => /^src\/(frontend|backend|worker)\/|^src\/packs\/[^/]+\/ui\/|^src\/(frontend|backend)\.tsx?$/.test(f))).toEqual([]);
      expect(packages.filter((p) => !p.startsWith("node:"))).toEqual([]);
    }
  });

  test("the kit bundles the engine through the studio seam, and the docs and schemas it serves", () => {
    expect(kit.files).toContain("src/studio-api.ts");
    for (const doc of ["AGENT-GUIDE", "REFERENCE", "EXPRESSIONS", "RECIPES", "DESIGN", "USER-GUIDE", "STUDIO", "PRESETS"]) expect(kit.files).toContain(`docs/${doc}.md`);
    expect(kit.files).toContain("schemas/lre-world-v1.schema.json");
  });

  test("the core bundles no tool, doc, schema or engine: the transport, the sign-in, the connection and the kit loader", () => {
    const { files } = reach(join(SRC, "cli/main.ts"), true);
    expect(files.filter((f) => /^(docs|schemas)\/|^src\/(engine|packs)\/|^src\/studio-api\.ts$|^src\/cli\/(tools|live|offline|texts|commands|agent-kit)\.ts$/.test(f))).toEqual([]);
    expect(files).toEqual(expect.arrayContaining(["src/cli/mcp.ts", "src/cli/connection.ts", "src/cli/credentials.ts", "src/cli/follow.ts", "src/cli/serve.ts"]));
  });
});

test.skipIf(!existsSync(join(ROOT, "dist/backend.js")))("the built backend has nothing the host's install scan refuses", () => {
  const js = readFileSync(join(ROOT, "dist/backend.js"), "utf8");
  // `process.env` is refused too: the build defines the build id and the kit's hash into the backend, and none may be left to read.
  for (const word of ["node:fs", "child_process", "node:net", "worker_threads", "lumirpengine login", "process.env"]) expect({ word, found: js.includes(word) }).toEqual({ word, found: false });
});

test.skipIf(!existsSync(join(ROOT, "dist/lumirpengine.js")))("the built CLI starts with its shebang, so `npx` and the bin link can run it", () => {
  expect(readFileSync(join(ROOT, "dist/lumirpengine.js"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
});
