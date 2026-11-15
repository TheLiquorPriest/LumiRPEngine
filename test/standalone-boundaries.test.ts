// Import boundaries of the standalone application. Each folder under src/ that belongs to it is a
// zone; every import in a zone is checked against what that zone may reach. The folders of the
// engine it carries along (shared, engine, packs) stay pure and are checked by the older
// boundaries test beside this one.
//
// What the rules keep true:
//   - the light extension holds nothing of the application (it runs inside Lumiverse);
//   - the pages hold nothing of the server;
//   - the store knows nothing of Lumiverse, of the harness, or of who calls it;
//   - which zones may still import today's build at all; which of its files each still imports, and
//     LumiAH, are the fence's (test/removal/): every file of today's build has a fate, nothing that
//     stays imports one that goes but the imports listed as not yet moved, and LumiAH is reached
//     through none of what stays;
//   - the homes made for what leaves today's build are zones of their own: Build, the operations and
//     the migration take his worlds from `worlds`, and the extension and the lore take the secrecy
//     rule from `secrecy`, which runs inside Lumiverse too;
//   - the harness is reached through its package, never through pi directly.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { NEW_ZONES } from "./removal/fates";
import { scan } from "./removal/imports";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");

const ZONES = NEW_ZONES;
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
  /** May import RPH's module of pure helpers (`HELPERS`) though not the harness: the migration, which carries today's settings into RPH's. */
  helpers?: true;
}

const PURE: readonly Carried[] = ["shared", "engine", "packs"];

/** The application's skeleton is what every server area plugs into, so each may import it. It imports none of them, but where it puts them together. */
const RULES: Record<Zone, Rule> = {
  store: { zones: [], carried: PURE },
  app: { zones: [], carried: ["shared"], harness: true },
  tree: { zones: ["app"], carried: ["shared"], harness: true },
  adapter: { zones: ["app"], carried: ["shared"], harness: true },
  lore: { zones: ["app", "store", "secrecy"], carried: PURE, harness: true },
  iface: { zones: ["app", "store", "worlds"], carried: PURE, harness: true },
  cast: { zones: ["app", "store", "iface"], carried: PURE, harness: true },
  story: { zones: ["app", "store", "iface", "cast"], carried: PURE, harness: true },
  // The migration's database is whole: the story's writes count the lore's overlays, so it lays the lore's tables too.
  migrate: { zones: ["app", "store", "cast", "story", "build", "lore", "worlds"], carried: [...PURE, "backend"], helpers: true },
  turn: { zones: ["app", "adapter", "store", "tree", "lore", "iface", "cast", "story"], carried: PURE, harness: true },
  ui: { zones: [], carried: ["shared", "frontend"], sandboxed: true },
  ext: { zones: ["adapter", "secrecy"], carried: ["shared", "backend"], sandboxed: true },
  build: { zones: ["app", "store", "worlds"], carried: [...PURE, "backend"] },
  // A panel's payment keeps the books the way an agent's does, so it uses the engine tools' own bookkeeping.
  play: { zones: ["app", "store", "iface"], carried: [...PURE, "backend"] },
  // His worlds behind one world service over the store: today's world store moves here (PlanSwap-5), the service beside it (PlanChatUI-B1).
  worlds: { zones: ["app", "store"], carried: PURE },
  // The secrecy half of the World Info gate (§9.6), one rule that RPE's answer and the extension's fail-closed answer both run (PlanSwap-6).
  secrecy: { zones: [], carried: PURE, sandboxed: true },
};

/** The harness's contract is types only; importing it as types costs nothing anywhere, a page included. */
const CONTRACT = "rp-harness/contract";

/** RPH's one module of pure helpers (its settings list and the merge of levels, among others): data and functions that read only what they are given, no pi and no `node:` module. */
const HELPERS = "rp-harness/helpers";

/** The entries RPH names for a host (CONTRACT condition 4, RPH `package.json` `exports`): RPE imports RPH through these and no other, a deep `rp-harness/src/...` never. */
const HARNESS_ENTRIES: readonly string[] = ["rp-harness", CONTRACT, HELPERS, "rp-harness/hosts/folder", "rp-harness/testing/rig", "rp-harness/testing/kit"];

/** Why a zone's import of the harness package breaks its rule, or null where it keeps it. */
function harnessImport(spec: string, typeOnly: boolean, zone: Zone, rule: Rule): string | null {
  if (!HARNESS_ENTRIES.includes(spec)) return `${zone}: ${spec} is none of the entries RPH names (${HARNESS_ENTRIES.join(", ")})`;
  if (rule.harness) return null;
  if (typeOnly && spec === CONTRACT) return null;
  if (rule.helpers && spec === HELPERS) return null;
  return `${zone}: the harness package is not imported here`;
}

/** The one place everything is put together: the application's entry may import every server zone. */
const COMPOSITION = /^app\/(main|cli|compose)\.ts$/;

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

interface Edge {
  spec: string;
  /** `import type` or `export type`: erased when the code is built. */
  typeOnly: boolean;
}

/** Every module the source loads, read the way the fence reads it: every form TypeScript and Bun load (test/removal/imports.ts). */
function specsOf(source: string): Edge[] {
  return scan(source).loads.map(({ spec, typeOnly }) => ({ spec, typeOnly }));
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

/** The file a relative specifier names, as TypeScript and Bun resolve it: `.js` names the `.ts` file. */
function resolveLocal(file: string, spec: string): string {
  const base = resolve(dirname(file), spec);
  const stem = base.replace(/\.(m|c)?jsx?$/, "");
  const candidates = [base, ...(stem !== base ? [`${stem}.ts`, `${stem}.tsx`] : []), `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const candidate of candidates) {
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
            else if (sandboxed && !RULES[top].sandboxed && !shared.has(resolveLocal(file, spec))) violations.push(`${rel} → ${target}: not among what the extension shares`);
          } else if (!(rule.carried as readonly string[]).includes(top)) {
            violations.push(`${rel} (${zone}) → ${target}: ${zone} may not import ${top}`);
          }
        } else if (spec.startsWith("node:") || spec.startsWith("bun:") || spec === "bun") {
          if (sandboxed) violations.push(`${rel}: ${spec} in code that runs in a page or inside Lumiverse`);
        } else if (spec === "rp-harness" || spec.startsWith("rp-harness/")) {
          const broken = harnessImport(spec, typeOnly, zone, rule);
          if (broken !== null) violations.push(`${rel} (${broken})`);
        } else if (spec === "lumi-ah" || spec.startsWith("lumi-ah/")) {
          // LumiAH is the fence's (test/removal/fence.ts), judged through every chain of what stays.
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

  test("a zone that imports rp-harness through any other entry, a deep import of rp-harness/src/... among them, fails; each named entry passes", () => {
    for (const entry of HARNESS_ENTRIES) {
      expect(harnessImport(entry, false, "turn", RULES.turn)).toBeNull();
      expect(harnessImport(entry, true, "turn", RULES.turn)).toBeNull();
    }
    for (const other of ["rp-harness/src/harness/settings", "rp-harness/src/helpers.ts", "rp-harness/src/contract/index.ts", "rp-harness/hosts", "rp-harness/testing", "rp-harness/package.json", "rp-harness/contract/settings"]) {
      expect(harnessImport(other, false, "turn", RULES.turn)).toContain("none of the entries RPH names");
      expect(harnessImport(other, true, "migrate", RULES.migrate)).toContain("none of the entries RPH names");
    }
    // A named entry is still imported only where the zone's rule allows it.
    expect(harnessImport(CONTRACT, true, "store", RULES.store)).toBeNull();
    expect(harnessImport(CONTRACT, false, "store", RULES.store)).toContain("not imported here");
    expect(harnessImport(HELPERS, false, "migrate", RULES.migrate)).toBeNull();
    expect(harnessImport(HELPERS, false, "store", RULES.store)).toContain("not imported here");
    expect(harnessImport("rp-harness", false, "migrate", RULES.migrate)).toContain("not imported here");
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

  test("every way a module is loaded is read: a .js name, require(), import =, import() in a type, a second import on one line", () => {
    for (const source of ['import { readRun } from "../backend/runtime.js";', 'const r = require("../backend/runtime");', 'import r = require("../backend/runtime");', 'type R = import("../backend/runtime").ChatRun;', 'const a = 1; import { readRun } from "../backend/runtime";']) {
      expect(specsOf(source).map(({ spec }) => spec)).toEqual([expect.stringMatching(/^\.\.\/backend\/runtime(\.js)?$/)]);
    }
    expect(relative(SRC, resolveLocal(join(SRC, "play/planted.ts"), "../shared/json.js"))).toBe("shared/json.ts");
    // Text that only looks like an import is none: a comment, a string.
    expect(specsOf('// import { a } from "../backend/runtime";\nconst s = \'import { b } from "../backend/view";\';')).toEqual([]);
  });
});
