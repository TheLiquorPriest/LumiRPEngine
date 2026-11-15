// The fence (PlanSwap-4, and the fix of its landing review). Nothing that stays loads a file whose
// fate is "removed" (fates.tsv), by value or by type, in any way TypeScript or Bun loads a module
// (imports.ts), but the imports `not-yet-moved.tsv` lists, each with the names it takes today and the
// package that ends it. A file moved in part (a moved file with pieces: today's protocol and settings
// registry) is fenced by name: what its pieces' allowances let a file take, it may take, and every
// other name is fenced as a removed file's. LumiAH is held to the same list wherever it is reached
// (R-85: "LumiAH stops being a dependency of the tree with no exception"). A load that cannot be read
// (an `import()` of a template or a sum) fails, unless `unread.tsv` names it with why. The source, the
// tests, the scripts and the preview are read.
//
// The list only shrinks, by its lines and by their names, never by a count: a line, or a name of a
// line, that the committed list does not hold fails. A package that moves code takes out, in the
// commit that removes an import, that import's line or names, and adds none; a line whose import is
// gone fails until it goes. The allowances of fates.tsv and the lines of unread.tsv shrink the same way.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allowed, type Fates, items, NEW_ZONES, NO_PACKAGE, PACKAGE, ROOT } from "./fates";
import { type Tree, tokens } from "./imports";

const LIST = join(import.meta.dir, "not-yet-moved.tsv");
const UNREAD = join(import.meta.dir, "unread.tsv");

/** An import the list allows while what it takes waits: `to` is a path, or a LumiAH module; `names` are what it may take (`*`, the whole module). */
export interface Listed {
  from: string;
  to: string;
  names: ReadonlySet<string>;
  by: string;
  note: string;
  line: number;
}

/**
 * The list's lines: the importer, what it imports, the names it takes, the package that ends the line
 * (or "no package yet") and a note. `legacy` reads the first list's two fields as taking every name, to
 * compare with a commit made before the list named them.
 */
export function readList(text: string = readFileSync(LIST, "utf8"), legacy = false): { entries: Listed[]; problems: string[] } {
  const entries: Listed[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of text.split("\n").entries()) {
    if (raw.trim() === "" || raw.startsWith("#")) continue;
    const line = index + 1;
    const fields = raw.split("\t");
    const at = `not-yet-moved.tsv:${line}`;
    const [from = "", to = "", names = "", by = "", note = "", ...extra] = fields;
    if (legacy && fields.length === 2) {
      entries.push({ from, to, names: new Set(["*"]), by: "", note: "", line });
      continue;
    }
    const list = items(names);
    if (extra.length > 0 || from === "" || to === "" || list.length === 0 || by === "") problems.push(`${at}: the importer, what it imports, the names it takes, the package that ends it, and a note if any`);
    else if (!PACKAGE.test(by) && by !== NO_PACKAGE) problems.push(`${at}: "${by}" is no package; name the one that ends the line, or "${NO_PACKAGE}"`);
    if (list.includes("*") && list.length > 1) problems.push(`${at}: * takes the whole module, so it stands alone`);
    if (seen.has(`${from}\t${to}`)) problems.push(`${at}: listed twice (${from} → ${to})`);
    seen.add(`${from}\t${to}`);
    entries.push({ from, to, names: new Set(list), by, note, line });
  }
  return { entries, problems };
}

/** A load that cannot be read and is known: the file, the source of what it loads, and why it is safe. */
export interface Unreadable {
  from: string;
  expr: string;
  why: string;
  line: number;
}

export function readUnread(text: string = readFileSync(UNREAD, "utf8")): { entries: Unreadable[]; problems: string[] } {
  const entries: Unreadable[] = [];
  const problems: string[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    if (raw.trim() === "" || raw.startsWith("#")) continue;
    const [from = "", expr = "", why = "", ...extra] = raw.split("\t");
    if (extra.length > 0 || from === "" || expr === "" || why === "") problems.push(`unread.tsv:${index + 1}: the file, the source of what it loads, and why it is safe`);
    entries.push({ from, expr, why, line: index + 1 });
  }
  return { entries, problems };
}

/** A file of the tree as the given commit holds it, or null where it holds none. */
export function committed(path: string, root: string = ROOT, commit = "HEAD"): string | null {
  const shown = Bun.spawnSync(["git", "show", `${commit}:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return shown.exitCode === 0 ? shown.stdout.toString() : null;
}

export const isLumiah = (spec: string): boolean => spec === "lumi-ah" || spec.startsWith("lumi-ah/");

/** Whether a file goes with today's build: then what it loads is its own affair until it goes. */
function goes(path: string, fates: Fates): boolean {
  return fates.files.get(path)?.fate === "removed";
}

/** How `path` is fenced: whole (removed), by name (moved in part: a moved file with pieces), or not at all. */
function fencing(path: string, fates: Fates): "whole" | "names" | null {
  const fate = fates.files.get(path);
  if (fate?.fate === "removed") return "whole";
  if (fate?.fate === "moved" && fates.pieces.some((piece) => piece.path === path)) return "names";
  return null;
}

/** The names a load takes that neither its line nor its target's allowances let it take. */
function unallowed(from: string, to: string, names: readonly string[], fates: Fates, listed: ReadonlySet<string> | undefined): string[] {
  const allow = allowed(fates, from, to);
  return names.filter((name) => !(listed?.has("*") || listed?.has(name) || (name !== "*" && allow.has(name))));
}

/** The loads of fenced files by files that stay that neither the list nor an allowance lets them make, and the loads that cannot be read. */
export function fence(tree: Tree, fates: Fates, listed: readonly Listed[], known: readonly Unreadable[]): string[] {
  const lines = new Map(listed.map((entry) => [`${entry.from}\t${entry.to}`, entry.names]));
  const out = new Set<string>();
  for (const edge of tree.edges) {
    if (edge.to === null || goes(edge.from, fates) || fencing(edge.to, fates) === null) continue;
    const left = unallowed(edge.from, edge.to, edge.names, fates, lines.get(`${edge.from}\t${edge.to}`));
    if (left.length === 0) continue;
    const target = edge.to;
    const fate = fates.files.get(target);
    const how = fate?.fate === "removed" ? `which ${fate.by} removes (fates.tsv:${fate.line})` : `whose names go with it but those its pieces move (fates.tsv:${fate?.line})`;
    const moving = fates.pieces.filter((piece) => piece.path === target).map((piece) => `${piece.what} → ${piece.home} (${piece.by})`);
    const where = moving.length > 0 ? `; what stays of it moves: ${moving.join("; ")}` : "";
    out.add(`${edge.from}:${edge.line} imports ${left.join(", ")} from ${target}${edge.typeOnly ? " (types)" : ""}, ${how}${where}`);
  }
  const ok = new Set(known.map((entry) => `${entry.from}\t${entry.expr}`));
  for (const load of tree.unread) {
    if (goes(load.from, fates) || ok.has(`${load.from}\t${load.expr}`)) continue;
    out.add(`${load.from}:${load.line} loads ${load.expr}, an ${load.what}: it cannot be read, so load one plain string, or name it in unread.tsv with why`);
  }
  return [...out].sort();
}

/**
 * LumiAH loaded by anything that stays, but through a line of the list and the names it takes. Each
 * load of it by a file that stays is one; with it, the chain by which a file of the application
 * reaches that file through files that stay, when one does.
 */
export function lumiah(tree: Tree, fates: Fates, listed: readonly Listed[]): string[] {
  const lines = new Map(listed.map((entry) => [`${entry.from}\t${entry.to}`, entry.names]));
  const importers = new Map<string, string[]>();
  for (const edge of tree.edges) {
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
  for (const edge of tree.edges) {
    if (edge.to !== null || !isLumiah(edge.spec) || goes(edge.from, fates)) continue;
    const listedNames = lines.get(`${edge.from}\t${edge.spec}`);
    const left = edge.names.filter((name) => !(listedNames?.has("*") || listedNames?.has(name)));
    if (left.length === 0) continue;
    const chain = chainTo(edge.from);
    const through = chain !== null && chain.length > 1 ? `; the application reaches it: ${[...chain, edge.spec].join(" → ")}` : "";
    out.add(`${edge.from}:${edge.line} imports ${left.join(", ")} from ${edge.spec}, and LumiAH is no dependency of what stays${through}`);
  }
  return [...out].sort();
}

/** What `source` exports by a declaration of its own: a name it re-exports, or exports from an import, is not its own. */
export function ownExports(source: string): Set<string> {
  const t = tokens(source);
  const declared = new Set<string>();
  const imported = new Set<string>();
  const exported: { name: string; local: string }[] = [];
  const own = new Set<string>();
  const DECLARES = new Set(["function", "class", "const", "let", "var", "interface", "type", "enum", "namespace"]);
  for (let k = 0; k < t.length; k++) {
    const tok = t[k];
    if (tok?.kind !== "id") continue;
    if (DECLARES.has(tok.text) && t[k + 1]?.kind === "id" && !(tok.text === "type" && t[k + 2]?.text !== "=" && t[k + 2]?.text !== "<")) declared.add(t[k + 1]?.text ?? "");
    if (tok.text === "function" && t[k + 1]?.text === "*" && t[k + 2]?.kind === "id") declared.add(t[k + 2]?.text ?? "");
    if (tok.text === "import" && t[k - 1]?.text !== ".") {
      // The local names an import statement binds.
      for (let j = k + 1; j < t.length && t[j]?.text !== "from" && t[j]?.text !== ";" && t[j]?.kind !== "str"; j++) {
        const cur = t[j];
        if (cur?.kind !== "id" || cur.text === "type" || cur.text === "as") continue;
        const next = t[j + 1];
        if (next?.text === "as") continue;
        imported.add(cur.text);
      }
    }
    if (tok.text !== "export" || t[k - 1]?.text === ".") continue;
    let j = k + 1;
    while (["declare", "async", "abstract"].includes(t[j]?.text ?? "")) j++;
    if (t[j]?.text === "const" && t[j + 1]?.text === "enum") j++;
    const head = t[j];
    if (head?.text === "default") own.add("default");
    else if (head?.kind === "id" && DECLARES.has(head.text)) {
      const name = head.text === "function" && t[j + 1]?.text === "*" ? t[j + 2] : t[j + 1];
      if (name?.kind === "id") own.add(name.text);
      // `export const a = 1, b = 2`: the names after commas at the same depth.
      if (head.text === "const" || head.text === "let" || head.text === "var") {
        let depth = 0;
        for (let m = j + 2; m < t.length; m++) {
          const cur = t[m];
          if (cur?.text === "(" || cur?.text === "[" || cur?.text === "{") depth++;
          else if (cur?.text === ")" || cur?.text === "]" || cur?.text === "}") depth--;
          else if (depth === 0 && cur?.text === ";") break;
          else if (depth === 0 && cur?.text === "," && t[m + 1]?.kind === "id" && t[m + 2]?.text === "=") own.add(t[m + 1]?.text ?? "");
          if (depth < 0) break;
        }
      }
    } else if (head?.text === "{") {
      // `export { a, b as c }`, without `from`: own when the local is declared here and not imported.
      const names: { name: string; local: string }[] = [];
      let m = j + 1;
      while (m < t.length && t[m]?.text !== "}") {
        if (t[m]?.text === "type") m++;
        const local = t[m]?.text ?? "";
        const name = t[m + 1]?.text === "as" ? (t[m + 2]?.text ?? local) : local;
        if (local !== "," && local !== "") names.push({ name, local });
        while (m < t.length && t[m]?.text !== "," && t[m]?.text !== "}") m++;
        if (t[m]?.text === ",") m++;
      }
      if (t[m + 1]?.text !== "from") exported.push(...names);
    }
  }
  for (const { name, local } of exported) if (declared.has(local) && !imported.has(local)) own.add(name);
  return own;
}

/** Names a line takes from a removed file that the file does not declare itself: one it only re-exports could come from anywhere, LumiAH included. */
export function reexported(fates: Fates, listed: readonly Listed[], root: string = ROOT): string[] {
  const out: string[] = [];
  const cache = new Map<string, Set<string>>();
  for (const entry of listed) {
    if (entry.names.has("*") || !goes(entry.to, fates) || !existsSync(join(root, entry.to))) continue;
    const own = cache.get(entry.to) ?? ownExports(readFileSync(join(root, entry.to), "utf8"));
    cache.set(entry.to, own);
    const foreign = [...entry.names].filter((name) => !own.has(name));
    if (foreign.length > 0) out.push(`not-yet-moved.tsv:${entry.line}: ${entry.from} takes ${foreign.join(", ")} from ${entry.to}, which does not declare ${foreign.length > 1 ? "them" : "it"} itself`);
  }
  return out;
}

/** Lines of the list that no longer stand as written: the import is gone, or takes fewer names now. */
export function stale(tree: Tree, fates: Fates, listed: readonly Listed[]): string[] {
  const taken = new Map<string, Set<string>>();
  for (const edge of tree.edges) {
    if (goes(edge.from, fates)) continue;
    const key = edge.to !== null ? (fencing(edge.to, fates) !== null ? `${edge.from}\t${edge.to}` : null) : isLumiah(edge.spec) ? `${edge.from}\t${edge.spec}` : null;
    if (key === null) continue;
    const allow = edge.to !== null ? allowed(fates, edge.from, edge.to) : new Set<string>();
    const names = taken.get(key) ?? new Set<string>();
    for (const name of edge.names) if (name === "*" || !allow.has(name)) names.add(name);
    taken.set(key, names);
  }
  const out: string[] = [];
  for (const entry of listed) {
    const now = taken.get(`${entry.from}\t${entry.to}`);
    const at = `not-yet-moved.tsv:${entry.line}: ${entry.from} → ${entry.to}`;
    if (now === undefined || now.size === 0) out.push(`${at} no longer stands; take the line out`);
    else if (entry.names.has("*") && !now.has("*")) out.push(`${at} takes ${[...now].sort().join(", ")} now, not the whole module; list those names`);
    else {
      const gone = [...entry.names].filter((name) => name !== "*" && !now.has(name));
      if (gone.length > 0) out.push(`${at} no longer takes ${gone.join(", ")}; take ${gone.length > 1 ? "them" : "it"} out`);
    }
  }
  return out;
}

/** Lines, or names of lines, that the committed list does not hold: the list gains neither. */
export function added(listed: readonly Listed[], before: readonly Listed[]): string[] {
  const held = new Map(before.map((entry) => [`${entry.from}\t${entry.to}`, entry.names]));
  const out: string[] = [];
  for (const entry of listed) {
    const names = held.get(`${entry.from}\t${entry.to}`);
    const at = `not-yet-moved.tsv:${entry.line}: ${entry.from} → ${entry.to}`;
    if (names === undefined) out.push(`${at} is not a line of the committed list, and the list gains no line`);
    else if (!names.has("*")) {
      const extra = [...entry.names].filter((name) => !names.has(name));
      if (extra.length > 0) out.push(`${at} takes ${extra.join(", ")}, which the committed line does not, and a line gains no name`);
    }
  }
  return out;
}

/** Allowances of fates.tsv, or names of them, that the committed fates do not hold: they shrink as the list does. */
export function allowancesAdded(fates: Fates, before: Fates): string[] {
  const held = new Set(before.pieces.flatMap((piece) => piece.for.flatMap((home) => piece.names.map((name) => `${piece.path}\t${home}\t${name}`))));
  const out: string[] = [];
  for (const piece of fates.pieces) {
    const extra = piece.for.flatMap((home) => piece.names.filter((name) => !held.has(`${piece.path}\t${home}\t${name}`)).map((name) => `${name} for ${home}`));
    if (extra.length > 0) out.push(`fates.tsv:${piece.line}: ${piece.path} allows ${extra.join(", ")}, which the committed fates do not`);
  }
  return out;
}

/** Lines of unread.tsv that the committed one does not hold. */
export function unreadAdded(known: readonly Unreadable[], before: readonly Unreadable[]): string[] {
  const held = new Set(before.map((entry) => `${entry.from}\t${entry.expr}`));
  return known.filter((entry) => !held.has(`${entry.from}\t${entry.expr}`)).map((entry) => `unread.tsv:${entry.line}: ${entry.from} loading ${entry.expr} is not a line of the committed list`);
}
