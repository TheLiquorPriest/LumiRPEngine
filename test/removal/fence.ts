// The fence (PlanSwap-4): no file of the standalone application, of the kept code or of the tests
// imports, by value or by type, a file whose fate is "removed" (fates.tsv), but the imports
// `not-yet-moved.tsv` lists, each waiting for the package that moves what it takes. LumiAH is held to
// the same list wherever it is reached: a kept file that imports it fails, and so does every file of
// the application that reaches it through kept files (R-85: "LumiAH stops being a dependency of the
// tree with no exception"). The list only shrinks: an entry whose import is gone fails until it goes.
//
// Imports are read the way the boundary tests read them. Over today's tree that reading gives every
// edge TypeScript's own resolution gives (`tsc --explainFiles`), checked when the list was made.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type Fates, NEW_ZONES, ROOT } from "./fates";

const LIST = join(import.meta.dir, "not-yet-moved.tsv");

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** One import: `to` is a path from the repository's root, or null for a package (`spec`). */
export interface Edge {
  from: string;
  to: string | null;
  spec: string;
  typeOnly: boolean;
}

export function importsOf(source: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push({ spec: m[2] ?? "", typeOnly: m[1] !== undefined });
  for (const m of source.matchAll(DYNAMIC_RE)) out.push({ spec: m[1] ?? "", typeOnly: false });
  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * Every import of every source file under `src/` and `test/`, read from disk under `root`, with the
 * `planted` files (path from the root to source text) read as if they were there too.
 */
export function edgesOf(root: string = ROOT, planted: ReadonlyMap<string, string> = new Map()): Edge[] {
  const rel = (file: string) => relative(root, file).split("\\").join("/");
  const sources = new Map<string, string>();
  for (const file of [...walk(join(root, "src")), ...walk(join(root, "test"))]) sources.set(rel(file), readFileSync(file, "utf8"));
  for (const [path, source] of planted) sources.set(path, source);
  const there = (path: string) => planted.has(path) || (existsSync(join(root, path)) && statSync(join(root, path)).isFile());
  const edges: Edge[] = [];
  for (const [from, source] of sources) {
    for (const { spec, typeOnly } of importsOf(source)) {
      if (!spec.startsWith(".")) {
        edges.push({ from, to: null, spec, typeOnly });
        continue;
      }
      const base = rel(resolve(root, dirname(from), spec));
      const to = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(there) ?? base;
      edges.push({ from, to, spec, typeOnly });
    }
  }
  return edges;
}

/** An import the list allows while what it takes waits to move: `to` is a path, or a LumiAH module. */
export interface Listed {
  from: string;
  to: string;
  line: number;
}

export function readList(text: string = readFileSync(LIST, "utf8")): { entries: Listed[]; problems: string[] } {
  const entries: Listed[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of text.split("\n").entries()) {
    if (raw.trim() === "" || raw.startsWith("#")) continue;
    const [from = "", to = "", ...extra] = raw.split("\t");
    const at = `not-yet-moved.tsv:${index + 1}`;
    if (extra.length > 0 || from === "" || to === "") problems.push(`${at}: two fields, the importer and what it imports`);
    else if (seen.has(`${from}\t${to}`)) problems.push(`${at}: listed twice (${from} → ${to})`);
    seen.add(`${from}\t${to}`);
    entries.push({ from, to, line: index + 1 });
  }
  return { entries, problems };
}

const isLumiah = (spec: string) => spec === "lumi-ah" || spec.startsWith("lumi-ah/");

/** Whether a file goes with today's build: then what it imports is its own affair until it goes. */
function goes(path: string, fates: Fates): boolean {
  return fates.files.get(path)?.fate === "removed";
}

/** The imports of removed files by files that stay, that the list does not hold. */
export function fence(edges: readonly Edge[], fates: Fates, listed: readonly Listed[]): string[] {
  const allowed = new Set(listed.map((entry) => `${entry.from}\t${entry.to}`));
  const out = new Set<string>();
  for (const edge of edges) {
    if (edge.to === null || goes(edge.from, fates) || !goes(edge.to, fates)) continue;
    if (allowed.has(`${edge.from}\t${edge.to}`)) continue;
    const fate = fates.files.get(edge.to);
    const target = edge.to;
    const moving = fates.pieces.filter((piece) => piece.path === target).map((piece) => `${piece.what} → ${piece.home} (${piece.by})`);
    const where = moving.length > 0 ? `; what stays of it moves: ${moving.join("; ")}` : "";
    out.add(`${edge.from} imports ${edge.to}${edge.typeOnly ? " (types)" : ""}, which ${fate?.fate === "removed" ? fate.by : "a package"} removes (fates.tsv:${fate?.line})${where}`);
  }
  return [...out].sort();
}

/**
 * LumiAH reached by anything that stays, but through an import the list holds. Each import of it by a
 * file that stays is one; with it, the chain by which a file of the application reaches that file
 * through files that stay, when one does.
 */
export function lumiah(edges: readonly Edge[], fates: Fates, listed: readonly Listed[]): string[] {
  const allowed = new Set(listed.map((entry) => `${entry.from}\t${entry.to}`));
  const importers = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.to === null || goes(edge.from, fates) || goes(edge.to, fates)) continue;
    importers.set(edge.to, [...(importers.get(edge.to) ?? []), edge.from]);
  }
  const zone = (path: string) => (NEW_ZONES as readonly string[]).includes(path.split("/")[1] ?? "") && path.startsWith("src/");
  /** The shortest chain from a file of the application to `file`, through files that stay. */
  const chainTo = (file: string): string[] | null => {
    const back = new Map<string, string>([[file, ""]]);
    const queue = [file];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      if (zone(at)) {
        const chain = [at];
        for (let next = back.get(at); next !== undefined && next !== ""; next = back.get(next)) chain.push(next);
        return chain;
      }
      for (const from of importers.get(at) ?? []) {
        if (back.has(from)) continue;
        back.set(from, at);
        queue.push(from);
      }
    }
    return null;
  };
  const out = new Set<string>();
  for (const edge of edges) {
    if (edge.to !== null || !isLumiah(edge.spec) || goes(edge.from, fates)) continue;
    if (allowed.has(`${edge.from}\t${edge.spec}`)) continue;
    const chain = chainTo(edge.from);
    const through = chain !== null && chain.length > 1 ? `; the application reaches it: ${[...chain, edge.spec].join(" → ")}` : "";
    out.add(`${edge.from} imports ${edge.spec}, and LumiAH is no dependency of what stays${through}`);
  }
  return [...out].sort();
}

/** Entries of the list that no longer stand: the import is gone, or what it takes no longer goes. */
export function stale(edges: readonly Edge[], fates: Fates, listed: readonly Listed[]): string[] {
  const standing = new Set<string>();
  for (const edge of edges) {
    if (goes(edge.from, fates)) continue;
    if (edge.to !== null && goes(edge.to, fates)) standing.add(`${edge.from}\t${edge.to}`);
    if (edge.to === null && isLumiah(edge.spec)) standing.add(`${edge.from}\t${edge.spec}`);
  }
  return listed.filter((entry) => !standing.has(`${entry.from}\t${entry.to}`)).map((entry) => `not-yet-moved.tsv:${entry.line}: ${entry.from} → ${entry.to} no longer stands; take the line out`);
}
