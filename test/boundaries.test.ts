// Module boundary lint (ARCHITECTURE §2). Every import in src/ is classified by zone and
// checked against the allowed edges; the `spindle` global is confined to the backend adapter,
// and the page reaches Lumiverse only through Spindle's messages.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

type Zone =
  | { kind: "shared" }
  | { kind: "engine" }
  | { kind: "pack-core"; pack: string }
  | { kind: "pack-ui"; pack: string }
  | { kind: "backend" }
  | { kind: "worker" }
  | { kind: "frontend" }
  | { kind: "studio" }
  | { kind: "augment" }
  | { kind: "entry-backend" }
  | { kind: "entry-frontend" }
  | { kind: "pack-index" }
  /** `src/packs/starters/**`: converted starter worlds (data plus a typed index), imported only by the pack index. */
  | { kind: "pack-starters" }
  /** `src/cli/**`: the `lumirpengine` command line and MCP server, bundled on its own; no other zone imports it. */
  | { kind: "cli" }
  | { kind: "outside" };

function zoneOf(file: string): Zone {
  const rel = relative(SRC, file).split("\\").join("/");
  if (rel.startsWith("..")) return { kind: "outside" };
  if (rel.startsWith("cli/")) return { kind: "cli" };
  if (rel === "studio-api.ts") return { kind: "studio" };
  if (rel === "spindle-augment.ts") return { kind: "augment" };
  if (rel === "backend.ts") return { kind: "entry-backend" };
  if (rel === "frontend.ts" || rel === "frontend.tsx") return { kind: "entry-frontend" };
  if (rel === "packs/index.ts") return { kind: "pack-index" };
  const [top, pack, side] = rel.split("/");
  if (top === "packs" && pack === "starters") return { kind: "pack-starters" };
  if (top === "shared") return { kind: "shared" };
  if (top === "engine") return { kind: "engine" };
  if (top === "backend") return { kind: "backend" };
  if (top === "worker") return { kind: "worker" };
  if (top === "frontend") return { kind: "frontend" };
  if (top === "packs" && pack && side === "core") return { kind: "pack-core", pack };
  if (top === "packs" && pack && side === "ui") return { kind: "pack-ui", pack };
  return { kind: "outside" };
}

interface Edge {
  spec: string;
  typeOnly: boolean;
}

const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function edgesOf(source: string): Edge[] {
  const out: Edge[] = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push({ spec: m[3] ?? "", typeOnly: m[2] !== undefined });
  for (const m of source.matchAll(DYNAMIC_RE)) out.push({ spec: m[1] ?? "", typeOnly: false });
  return out;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Packages each zone may import, and whether only with `import type`. */
const PACKAGES: Record<Zone["kind"], Record<string, "value" | "type">> = {
  shared: {},
  engine: {},
  "pack-core": {},
  "pack-ui": { preact: "value", "preact/hooks": "value", "preact/jsx-runtime": "value" },
  backend: { "lumiverse-spindle-types": "type" },
  worker: { "lumiverse-spindle-types": "type" },
  frontend: { preact: "value", "preact/hooks": "value", "preact/jsx-runtime": "value", "lumiverse-spindle-types": "type" },
  studio: {},
  augment: { "lumiverse-spindle-types": "type" },
  "entry-backend": { "lumiverse-spindle-types": "type" },
  "entry-frontend": { "lumiverse-spindle-types": "type" },
  "pack-index": {},
  "pack-starters": {},
  cli: {},
  outside: {},
};

function allowedLocal(from: Zone, to: Zone, typeOnly: boolean, targetRel: string): boolean {
  const pure = to.kind === "shared" || to.kind === "engine";
  switch (from.kind) {
    case "shared":
      return to.kind === "shared";
    case "engine":
      return pure;
    case "pack-core":
      if (pure) return true;
      if (to.kind !== "pack-core") return false;
      // Another pack's core only through its public index, types only.
      return to.pack === from.pack || (typeOnly && targetRel === `packs/${to.pack}/core/index.ts`);
    case "pack-ui":
      return to.kind === "shared" || (to.kind === "pack-core" && to.pack === from.pack) || (to.kind === "pack-ui" && to.pack === from.pack) || to.kind === "frontend" || (to.kind === "augment" && typeOnly);
    case "backend":
      return pure || to.kind === "pack-core" || to.kind === "pack-index" || to.kind === "backend" || (to.kind === "augment" && typeOnly);
    case "worker":
      return pure || to.kind === "pack-core" || to.kind === "pack-index" || to.kind === "worker";
    case "frontend":
      return to.kind === "shared" || to.kind === "pack-ui" || to.kind === "frontend" || (to.kind === "augment" && typeOnly);
    case "studio":
      return pure || to.kind === "pack-core" || to.kind === "pack-index";
    case "pack-index":
      // The one list of every pack: each pack's core through its public index, and the starter worlds.
      return pure || to.kind === "pack-starters" || (to.kind === "pack-core" && targetRel === `packs/${to.pack}/core/index.ts`);
    case "pack-starters":
      return to.kind === "shared" || to.kind === "pack-starters";
    case "augment":
      return false;
    case "entry-backend":
      return to.kind === "backend" || to.kind === "shared" || (to.kind === "augment" && typeOnly);
    case "entry-frontend":
      return to.kind === "frontend" || to.kind === "shared" || to.kind === "pack-ui" || (to.kind === "augment" && typeOnly);
    case "cli":
      // The studio seam, the pack index for the starters, and pure code; never the backend, the frontend or a pack's UI.
      return pure || to.kind === "studio" || to.kind === "pack-index" || to.kind === "cli";
    case "outside":
      return false;
  }
}

function resolveLocal(file: string, spec: string): string {
  const base = resolve(dirname(file), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return base;
}

/** Files allowed to reference the `spindle` global. */
const SPINDLE_GLOBAL = new Set(["backend.ts", "backend/spindle-host.ts"]);

/** What the CLI may import from outside src, by path from the repo root: the docs it serves, the schemas, its version. */
const CLI_BUNDLED = /^(docs\/[A-Z-]+\.md|schemas\/[a-z0-9-]+\.schema\.json|package\.json)$/;

describe("module boundaries", () => {
  const all = files(SRC);

  test("every import crosses only an allowed boundary", () => {
    const violations: string[] = [];
    for (const file of all) {
      const from = zoneOf(file);
      const rel = relative(SRC, file);
      for (const edge of edgesOf(readFileSync(file, "utf8"))) {
        if (edge.spec.startsWith(".")) {
          const target = resolveLocal(file, edge.spec);
          const to = zoneOf(target);
          const targetRel = relative(SRC, target).split("\\").join("/");
          if (to.kind === "outside") {
            // The CLI bundles the docs, the schemas and its package version as text and data.
            if (!(from.kind === "cli" && CLI_BUNDLED.test(relative(ROOT, target).split("\\").join("/")))) violations.push(`${rel}: imports outside src (${edge.spec})`);
          } else if (!allowedLocal(from, to, edge.typeOnly, targetRel)) violations.push(`${rel} (${from.kind}) → ${targetRel} (${to.kind})${edge.typeOnly ? " [type]" : ""}`);
        } else if (edge.spec.startsWith("node:") || edge.spec.startsWith("bun:")) {
          // The CLI's entry is the one file that touches the disk, the terminal and the process.
          if (!(rel.split("\\").join("/") === "cli/main.ts" && edge.spec.startsWith("node:"))) violations.push(`${rel}: runtime module ${edge.spec} (only backend I/O may use host storage through HostPort, and only the CLI's entry may use node:)`);
        } else {
          const rule = PACKAGES[from.kind][edge.spec];
          if (!rule) violations.push(`${rel} (${from.kind}): package ${edge.spec} not allowed`);
          else if (rule === "type" && !edge.typeOnly) violations.push(`${rel}: ${edge.spec} must be imported with \`import type\``);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("only the backend adapter touches the spindle global", () => {
    const offenders = all
      .filter((file) => !SPINDLE_GLOBAL.has(relative(SRC, file).split("\\").join("/")))
      .filter((file) => /(^|[^.\w$])spindle\s*\.\s*[a-zA-Z_]/m.test(readFileSync(file, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  test("the frontend and the packs' UI send nothing but Spindle's messages: no route of Lumiverse's own is called from the page", () => {
    // Lumiverse's own REST routes aren't Spindle's, and an extension that set the command Lumiverse runs
    // for an MCP server would run code outside Spindle's sandbox (DESIGN §23).
    const offenders = all
      .filter((file) => ["frontend", "pack-ui", "entry-frontend"].includes(zoneOf(file).kind))
      .filter((file) => /\bfetch\s*\(|\bXMLHttpRequest\b|\bEventSource\b|\bWebSocket\b|\bsendBeacon\b|\/api\/v1\//.test(readFileSync(file, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
