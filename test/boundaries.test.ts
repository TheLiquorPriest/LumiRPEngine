// Module boundary lint (ARCHITECTURE §2) of today's build. Every import in today's layers (shared,
// the engine, the packs' cores and panels, the backend, the frontend, the worker, the CLI and the
// three files at the top of src/) is classified by zone and checked against the allowed edges; the
// `spindle` global is confined to the backend adapter, and the page reaches Lumiverse only through
// Spindle's messages. The standalone application's folders, Build and the play area among them, are
// the standalone boundaries test's; a folder of src/ that is neither today's nor one of theirs fails
// here, so no folder is read by neither test. Until PlanSwap-8 and PlanSwap-9 remove today's backend
// and frontend, each may import the homes PlanSwap-5 and PlanSwap-6 make for what moves out of it
// (fates.tsv, test/removal/), and nothing else of the new tree.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { atHome, homes, NEW_ZONES, OLD_FILES, OLD_FOLDERS, readFates } from "./removal/fates";
import { resolveSpec, scan } from "./removal/imports";

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
  | { kind: "augment" }
  | { kind: "entry-backend" }
  | { kind: "entry-frontend" }
  | { kind: "pack-index" }
  /** `src/packs/starters/**`: converted starter worlds (data plus a typed index), imported only by the pack index. */
  | { kind: "pack-starters" }
  /** `src/cli/**`: the `lumirpengine` command line and MCP server, bundled on its own; no other zone imports it. */
  | { kind: "cli" }
  /** A home made for what leaves today's backend or frontend (`leaving`), outside today's layers. */
  | { kind: "home"; leaving: readonly string[] }
  | { kind: "outside" };

/**
 * The homes PlanSwap-5 and PlanSwap-6 make for what leaves today's backend and frontend, each with
 * the folder it leaves: a move leaves one copy (PlanSwap-5), so until the old folder goes it imports
 * its moved code there. The homes other packages make are the new tree's own: the old dispatcher
 * reaching a typed route's handler would be a second road to it. A home that is a whole folder opens
 * it to the backend only; what leaves the frontend is named file by file, so the panels do not reach
 * into the new pages.
 */
const MAKERS = new Set(["PlanSwap-5", "PlanSwap-6"]);
const HOMES = homes(readFates()).flatMap(({ from, home, by }) => {
  const leaving = from.split("/")[1] ?? "";
  if (!MAKERS.has(by)) return [];
  return leaving === "backend" || (leaving === "frontend" && !home.endsWith("/")) ? [{ leaving, home }] : [];
});

/**
 * What PlanSwap-15 moves out of the agents engine's shared files into the pure engine (the pieces of
 * fates.tsv by that package that name a file of `src/engine/` or `src/shared/`): until PlanSwap-10 removes
 * today's shared files, those take them back from the new home. What went into a page's own file (the
 * review card's label, the jobs page's time in words) is not taken back: no shared or backend file imports
 * the frontend, so the old files keep what they read of it.
 */
const MOVED_OUT = new Set(readFates().pieces.filter((piece) => piece.by === "PlanSwap-15" && !piece.home.endsWith("/") && !piece.home.startsWith("src/frontend/")).map((piece) => piece.home.replace(/^src\//, "")));

function zoneOf(file: string): Zone {
  const rel = relative(SRC, file).split("\\").join("/");
  if (rel.startsWith("..")) return { kind: "outside" };
  if (rel.startsWith("cli/")) return { kind: "cli" };
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
  const leaving = HOMES.filter(({ home }) => atHome(`src/${rel}`, home)).map((h) => h.leaving);
  if (leaving.length > 0) return { kind: "home", leaving };
  return { kind: "outside" };
}

interface Edge {
  spec: string;
  typeOnly: boolean;
}

/** Every module the source loads, read the way the fence reads it (test/removal/imports.ts). */
function edgesOf(source: string): Edge[] {
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

/** Packages each zone may import, and whether only with `import type`. */
const PACKAGES: Record<Zone["kind"], Record<string, "value" | "type">> = {
  shared: {},
  engine: {},
  "pack-core": {},
  "pack-ui": { preact: "value", "preact/hooks": "value", "preact/jsx-runtime": "value" },
  backend: { "lumiverse-spindle-types": "type" },
  worker: { "lumiverse-spindle-types": "type" },
  frontend: { preact: "value", "preact/hooks": "value", "preact/jsx-runtime": "value", "lumiverse-spindle-types": "type" },
  augment: { "lumiverse-spindle-types": "type" },
  "entry-backend": { "lumiverse-spindle-types": "type" },
  "entry-frontend": { "lumiverse-spindle-types": "type" },
  "pack-index": {},
  "pack-starters": {},
  cli: {},
  home: {},
  outside: {},
};

/**
 * LumiAH, the agent harness built into the extension (docs/HARNESS.md), is named in two places
 * only: the backend's side of the boundary (`backend/harness/`), which mounts LumiAH's backend and
 * hands its shapes on, and the frontend's (`frontend/harness/`), which mounts its pages. Nothing
 * else under `src/` imports the package, so what RPEngine takes of it can be read in two folders.
 */
const HARNESS_PACKAGE = /^lumi-ah\//;
const HARNESS_DOORS: readonly { under: string; packages: readonly string[] }[] = [
  { under: "backend/harness/", packages: ["lumi-ah/core", "lumi-ah/extension/backend", "lumi-ah/shared"] },
  { under: "frontend/harness/", packages: ["lumi-ah/extension/frontend", "lumi-ah/shared"] },
];

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
      return to.kind === "shared" || (to.kind === "pack-core" && to.pack === from.pack) || (to.kind === "pack-ui" && to.pack === from.pack) || to.kind === "frontend" || (to.kind === "augment" && typeOnly) || (to.kind === "home" && to.leaving.includes("frontend"));
    case "backend":
      return pure || to.kind === "pack-core" || to.kind === "pack-index" || to.kind === "backend" || (to.kind === "augment" && typeOnly) || (to.kind === "home" && to.leaving.includes("backend"));
    case "worker":
      return pure || to.kind === "pack-core" || to.kind === "pack-index" || to.kind === "worker";
    case "frontend":
      return to.kind === "shared" || to.kind === "pack-ui" || to.kind === "frontend" || (to.kind === "augment" && typeOnly) || (to.kind === "home" && to.leaving.includes("frontend"));
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
      // The pack index (for the starters and the local engine's registry), and pure code; never the backend, the frontend or a pack's UI.
      return pure || to.kind === "pack-index" || to.kind === "cli";
    case "home":
    case "outside":
      return false;
  }
}

/** The file a relative specifier names, as TypeScript and Bun resolve it, the planted files among the files there. */
function resolveLocal(file: string, spec: string, planted: ReadonlySet<string>): string {
  const there = (path: string) => planted.has(join(ROOT, path)) || (existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isFile());
  return join(ROOT, resolveSpec(relative(ROOT, file).split("\\").join("/"), spec, there, ROOT));
}

/** Files allowed to reference the `spindle` global. */
const SPINDLE_GLOBAL = new Set(["backend.ts", "backend/spindle-host.ts"]);

/** What the CLI may import from outside src, by path from the repo root: the docs it serves, the schemas, its version. */
const CLI_BUNDLED = /^(docs\/[A-Z-]+\.md|schemas\/[a-z0-9-]+\.schema\.json|package\.json)$/;

/** Today's layers, the only files this test reads: the standalone application's folders, and the homes made for what leaves today's build, are the standalone boundaries test's. */
function todaysFiles(): string[] {
  return [...OLD_FOLDERS.flatMap((folder) => files(join(SRC, folder))), ...OLD_FILES.map((path) => join(ROOT, path)).filter((file) => existsSync(file))];
}

/** Every import of today's layers that crosses a boundary it may not, with the `planted` files (path from the repository's root to source) read as if they were there. */
function violationsOf(planted: ReadonlyMap<string, string> = new Map()): string[] {
  const plantedFiles = new Map([...planted].map(([path, source]) => [join(ROOT, path), source] as const));
  const isToday = (file: string) => OLD_FOLDERS.some((folder) => file.startsWith(join(SRC, folder) + "/")) || OLD_FILES.some((path) => file === join(ROOT, path));
  const all = [...new Set([...todaysFiles(), ...[...plantedFiles.keys()].filter(isToday)])];
  const violations: string[] = [];
  for (const file of all) {
    const from = zoneOf(file);
    const rel = relative(SRC, file);
    for (const edge of edgesOf(plantedFiles.get(file) ?? readFileSync(file, "utf8"))) {
      if (edge.spec.startsWith(".")) {
        const target = resolveLocal(file, edge.spec, new Set(plantedFiles.keys()));
        const to = zoneOf(target);
        const targetRel = relative(SRC, target).split("\\").join("/");
        if (to.kind === "outside") {
          // The CLI bundles the docs, the schemas and its package version as text and data.
          if (!(from.kind === "cli" && CLI_BUNDLED.test(relative(ROOT, target).split("\\").join("/")))) violations.push(`${rel}: imports outside today's layers (${edge.spec})`);
        } else if (!allowedLocal(from, to, edge.typeOnly, targetRel) && !MOVED_OUT.has(targetRel)) violations.push(`${rel} (${from.kind}) → ${targetRel} (${to.kind})${edge.typeOnly ? " [type]" : ""}`);
      } else if (edge.spec.startsWith("node:") || edge.spec.startsWith("bun:")) {
        // The CLI's entry is the one file that touches the disk, the terminal and the process.
        const spec = rel.split("\\").join("/");
        if (!(spec === "cli/main.ts" && edge.spec.startsWith("node:"))) violations.push(`${rel}: runtime module ${edge.spec} (only backend I/O may use host storage through HostPort, and only the CLI's entry may use node:)`);
      } else if (HARNESS_PACKAGE.test(edge.spec)) {
        const door = HARNESS_DOORS.find((d) => rel.split("\\").join("/").startsWith(d.under));
        if (!door) violations.push(`${rel}: ${edge.spec} is imported only under ${HARNESS_DOORS.map((d) => `src/${d.under}`).join(" and ")}`);
        else if (!door.packages.includes(edge.spec)) violations.push(`${rel}: ${edge.spec} isn't one of the package's entries this side takes (${door.packages.join(", ")})`);
      } else {
        const rule = PACKAGES[from.kind][edge.spec];
        if (!rule) violations.push(`${rel} (${from.kind}): package ${edge.spec} not allowed`);
        else if (rule === "type" && !edge.typeOnly) violations.push(`${rel}: ${edge.spec} must be imported with \`import type\``);
      }
    }
  }
  return violations;
}

describe("module boundaries", () => {
  const all = todaysFiles();

  test("every import crosses only an allowed boundary", () => {
    expect(violationsOf()).toEqual([]);
  });

  test("a planted import of src/engine/ from src/shared/ fails", () => {
    expect(violationsOf(new Map([["src/shared/planted.ts", 'import { createRng } from "../engine/rng";']]))).toEqual(["shared/planted.ts (shared) → engine/rng.ts (engine)"]);
  });

  test("today's backend and frontend may import the homes made for what leaves them, and nothing else of the new tree", () => {
    const planted = new Map([
      ["src/migrate/today/reader.ts", "export const reader = 1;"],
      ["src/ui/store.ts", "export const store = 1;"],
      ["src/backend/planted.ts", 'import { reader } from "../migrate/today/reader";'],
      ["src/backend/planted-turn.ts", 'import { TurnService } from "../turn/turns";'],
      ["src/shared/planted.ts", 'import { reader } from "../migrate/today/reader";'],
      ["src/frontend/planted.tsx", 'import { store } from "../ui/store";'],
      ["src/packs/calendar/ui/planted.tsx", 'import { store } from "../../../ui/store";'],
      ["src/frontend/planted-page.tsx", 'import { WebShell } from "../ui/web";'],
    ]);
    expect(violationsOf(planted)).toEqual(["backend/planted-turn.ts: imports outside today's layers (../turn/turns)", "shared/planted.ts (shared) → migrate/today/reader.ts (home)", "frontend/planted-page.tsx: imports outside today's layers (../ui/web)"]);
  });

  test("only the homes PlanSwap-5 and PlanSwap-6 make are open to the old backend, not every piece's home", () => {
    // Build's typed routes are PlanChatUI-B6's home: the old dispatcher reaching them would be a second road.
    const planted = new Map([
      ["src/build/worlds-routes.ts", "export const worldsRoutes = 1;"],
      ["src/backend/planted.ts", 'import { worldsRoutes } from "../build/worlds-routes";'],
    ]);
    expect(violationsOf(planted)).toEqual(["backend/planted.ts: imports outside today's layers (../build/worlds-routes)"]);
  });

  test("the shared files take back what PlanSwap-15 moved into the pure engine from its new home, and nothing else of the engine, and no shared or backend file takes anything from the frontend", () => {
    const planted = new Map([
      ["src/shared/planted.ts", 'import { isAgentKnowledge } from "../engine/workspace";\nimport { createRng } from "../engine/rng";'],
      ["src/backend/planted.ts", 'import { agentLabel } from "../frontend/review-card";\nimport { hud } from "../frontend/hud";'],
    ]);
    expect(violationsOf(planted)).toEqual(["shared/planted.ts (shared) → engine/rng.ts (engine)", "backend/planted.ts (backend) → frontend/review-card.tsx (frontend)", "backend/planted.ts (backend) → frontend/hud.tsx (frontend)"]);
  });

  test("an import written with a .js name is read as the file it names", () => {
    expect(violationsOf(new Map([["src/shared/planted.ts", 'import { createRng } from "../engine/rng.js";']]))).toEqual(["shared/planted.ts (shared) → engine/rng.ts (engine)"]);
  });

  test("every folder of src/ is today's or one of the standalone application's zones, so each is read by a boundaries test", () => {
    const folders = (planted: readonly string[]) =>
      [...new Set([...readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory()), ...planted.map((path) => path.split("/")[1] ?? "")])]
        .filter((name) => !(OLD_FOLDERS as readonly string[]).includes(name) && !(NEW_ZONES as readonly string[]).includes(name))
        .sort();
    expect(folders([])).toEqual([]);
    expect(folders(["src/elsewhere/planted.ts"])).toEqual(["elsewhere"]);
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
