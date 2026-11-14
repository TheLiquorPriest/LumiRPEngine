// Import boundaries of the standalone application. Each folder under src/ that belongs to it is a
// zone; every import in a zone is checked against what that zone may reach. The folders of the
// engine it carries along (shared, engine, packs) stay pure and are checked by the older
// boundaries test beside this one.
//
// What the rules keep true:
//   - the light extension holds nothing of the application (it runs inside Lumiverse);
//   - the pages hold nothing of the server;
//   - the store knows nothing of Lumiverse, of the harness, or of who calls it;
//   - today's build is read only by the migration, and LumiAH is imported nowhere else; Build takes
//     today's world store alone from it;
//   - the harness is reached through its package, never through pi directly.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const ZONES = ["app", "adapter", "store", "iface", "cast", "story", "lore", "turn", "ui", "ext", "migrate", "tree", "build"] as const;
type Zone = (typeof ZONES)[number];

/** The carried engine's folders a zone may import from, named by their first path segment. */
type Carried = "shared" | "engine" | "packs" | "backend" | "frontend";

interface Rule {
  /** Other zones this one may import. Its own folder is always allowed. */
  zones: readonly Zone[];
  carried: readonly Carried[];
  /** Runs in a browser or inside Lumiverse's worker: no `node:` or `bun:` module. */
  sandboxed?: true;
  /** May import the harness package. */
  harness?: true;
}

const PURE: readonly Carried[] = ["shared", "engine", "packs"];

/** The application's skeleton is what every server area plugs into, so each may import it. It imports none of them, but where it puts them together. */
const RULES: Record<Zone, Rule> = {
  store: { zones: [], carried: PURE },
  app: { zones: [], carried: ["shared"], harness: true },
  tree: { zones: ["app"], carried: ["shared"], harness: true },
  adapter: { zones: ["app"], carried: ["shared"], harness: true },
  lore: { zones: ["app", "store"], carried: PURE, harness: true },
  iface: { zones: ["app", "store"], carried: PURE, harness: true },
  cast: { zones: ["app", "store", "iface"], carried: PURE, harness: true },
  story: { zones: ["app", "store", "iface", "cast"], carried: PURE, harness: true },
  migrate: { zones: ["app", "store", "cast", "story"], carried: [...PURE, "backend"] },
  turn: { zones: ["app", "adapter", "store", "tree", "lore", "iface", "cast", "story"], carried: PURE, harness: true },
  ui: { zones: [], carried: ["shared", "frontend"], sandboxed: true },
  ext: { zones: ["adapter"], carried: ["shared", "backend"], sandboxed: true },
  build: { zones: ["app", "store"], carried: [...PURE, "backend"] },
};

/** The harness's contract is types only; importing it as types costs nothing anywhere, a page included. */
const CONTRACT = "rp-harness/contract";

/** The one place everything is put together: the application's entry may import every server zone. */
const COMPOSITION = /^app\/(main|cli|compose)\.ts$/;

/** What the extension may take from today's backend: the secrecy rules and the host's shapes, nothing else. */
const EXT_BACKEND = /^backend\/(lore-secrets|host)/;

/** What Build may take from today's backend: today's world store and the stored-JSON reader it uses, with what those two import. */
function buildBackend(): Set<string> {
  const out = new Set<string>();
  const queue = ["backend/worlds.ts", "backend/stored-json.ts"].map((rel) => join(SRC, rel));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (out.has(file) || !existsSync(file)) continue;
    out.add(file);
    for (const { spec } of specsOf(readFileSync(file, "utf8"))) {
      const target = spec.startsWith(".") ? resolveLocal(file, spec) : null;
      if (target !== null && relative(SRC, target).split("\\").join("/").startsWith("backend/")) queue.push(target);
    }
  }
  return out;
}

/** Adapter modules the extension shares with RPE must hold no server code; they are checked as sandboxed too. */
function sharedWithExtension(): Set<string> {
  const out = new Set<string>();
  const queue = files(join(SRC, "ext"));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const { spec } of specsOf(readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      const target = resolveLocal(file, spec);
      const rel = relative(SRC, target).split("\\").join("/");
      if (rel.startsWith("adapter/") && !out.has(target) && existsSync(target)) {
        out.add(target);
        queue.push(target);
      }
    }
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

interface Edge {
  spec: string;
  /** `import type` or `export type`: erased when the code is built. */
  typeOnly: boolean;
}

function specsOf(source: string): Edge[] {
  const out: Edge[] = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push({ spec: m[2] ?? "", typeOnly: m[1] !== undefined });
  for (const m of source.matchAll(DYNAMIC_RE)) out.push({ spec: m[1] ?? "", typeOnly: false });
  return out;
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
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

function isZone(name: string): name is Zone {
  return (ZONES as readonly string[]).includes(name);
}

function withoutComments(source: string): string {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
}

describe("the standalone application's boundaries", () => {
  const all = ZONES.flatMap((zone) => files(join(SRC, zone)));
  const shared = sharedWithExtension();
  const build = buildBackend();

  test("every import stays inside what its zone may reach", () => {
    const violations: string[] = [];
    for (const file of all) {
      const rel = relative(SRC, file).split("\\").join("/");
      const zone = rel.split("/")[0] as Zone;
      const rule = RULES[zone];
      const composes = COMPOSITION.test(rel);
      const sandboxed = rule.sandboxed === true || shared.has(file);
      for (const { spec, typeOnly } of specsOf(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".")) {
          const target = relative(SRC, resolveLocal(file, spec)).split("\\").join("/");
          if (target.startsWith("..")) {
            violations.push(`${rel}: imports outside src (${spec})`);
            continue;
          }
          const top = target.split("/")[0] ?? "";
          if (top === zone) continue;
          if (isZone(top)) {
            if (composes && !RULES[top].sandboxed) continue;
            if (!rule.zones.includes(top)) violations.push(`${rel} (${zone}) → ${target}: ${zone} may not import ${top}`);
            else if (sandboxed && !shared.has(resolveLocal(file, spec))) violations.push(`${rel} → ${target}: not among what the extension shares`);
          } else if (!(rule.carried as readonly string[]).includes(top)) {
            violations.push(`${rel} (${zone}) → ${target}: ${zone} may not import ${top}`);
          } else if (zone === "ext" && top === "backend" && !EXT_BACKEND.test(target)) {
            violations.push(`${rel} → ${target}: the extension takes only the secrecy rules and the host's shapes from today's backend`);
          } else if (zone === "build" && top === "backend" && !build.has(resolveLocal(file, spec))) {
            violations.push(`${rel} → ${target}: Build takes only today's world store from today's backend`);
          }
        } else if (spec.startsWith("node:") || spec.startsWith("bun:") || spec === "bun") {
          if (sandboxed) violations.push(`${rel}: ${spec} in code that runs in a page or inside Lumiverse`);
        } else if (spec === "rp-harness" || spec.startsWith("rp-harness/")) {
          if (!rule.harness && !(typeOnly && spec === CONTRACT)) violations.push(`${rel} (${zone}): the harness package is not imported here`);
        } else if (spec.startsWith("lumi-ah")) {
          if (zone !== "migrate") violations.push(`${rel}: ${spec} is imported only by the migration`);
        } else if (spec.startsWith("@earendil-works/")) {
          violations.push(`${rel}: pi is reached through the harness package, not directly (${spec})`);
        } else if (spec === "preact" || spec.startsWith("preact/")) {
          if (zone !== "ui") violations.push(`${rel} (${zone}): ${spec} belongs to the pages`);
        } else if (spec === "lumiverse-spindle-types") {
          if (zone !== "ext") violations.push(`${rel} (${zone}): Spindle's types belong to the extension`);
        } else {
          violations.push(`${rel} (${zone}): package ${spec} is not on the list`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("only the extension touches the spindle global", () => {
    const offenders = all
      .filter((file) => !relative(SRC, file).split("\\").join("/").startsWith("ext/"))
      .filter((file) => /(^|[^.\w$])spindle\s*\.\s*[a-zA-Z_]/m.test(withoutComments(readFileSync(file, "utf8"))))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  test("nothing the engine carries along imports the application", () => {
    const offenders: string[] = [];
    for (const carried of ["shared", "engine", "packs"]) {
      for (const file of files(join(SRC, carried))) {
        for (const { spec } of specsOf(readFileSync(file, "utf8"))) {
          if (!spec.startsWith(".")) continue;
          const top = relative(SRC, resolveLocal(file, spec)).split("\\").join("/").split("/")[0] ?? "";
          if (isZone(top)) offenders.push(`${relative(SRC, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
