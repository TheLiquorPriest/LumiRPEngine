// Every way a TypeScript or Bun source file loads another module, read from its tokens (PlanSwap-4,
// the fix of its landing review): static imports and re-exports wherever they stand on a line,
// `import type`, `import x = require()`, `require()`, and `import()` in code or in a type, each with
// the names it takes. Comments and the text inside strings are never read as imports. An `import()`
// or a `require()` whose specifier is not one plain string cannot be read, and is returned as such:
// the fence and the boundary tests fail it rather than let it pass.
//
// A specifier resolves as TypeScript (`moduleResolution: bundler`) and Bun resolve it: with or
// without its extension, `.js` naming the `.ts` file, or a folder's index.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** One load of a module. `names` are the names it takes; `*` is the whole module (a namespace, a side effect, a dynamic import). */
export interface Load {
  spec: string;
  typeOnly: boolean;
  names: readonly string[];
  line: number;
}

/** A dynamic load whose specifier is not one plain string; `expr` is the source of what it loads, its spaces collapsed. */
export interface Unread {
  line: number;
  what: string;
  expr: string;
}

type Kind = "id" | "str" | "tpl" | "punct" | "num" | "regex";
interface Token {
  kind: Kind;
  text: string;
  line: number;
  /** Where the token starts in the source. */
  pos: number;
  /** A string's value, or a template's when it holds no `${…}`. */
  value?: string;
}

/** Keywords after which a `/` starts a regular expression rather than a division. */
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/** The source's tokens, comments dropped. */
export function tokens(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const at = (k: number) => source.charCodeAt(k);
  const isIdStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
  const isId = (c: number) => isIdStart(c) || (c >= 48 && c <= 57);
  const regexAllowed = (): boolean => {
    const prev = out.at(-1);
    if (prev === undefined) return true;
    if (prev.kind === "punct") return prev.text !== ")" && prev.text !== "]" && prev.text !== "}";
    return prev.kind === "id" && BEFORE_REGEX.has(prev.text);
  };
  /** Reads code until an unmatched `}` when `inTemplate`, else to the end. */
  const code = (inTemplate: boolean): void => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i] as string;
      if (c === "\n") {
        line++;
        i++;
      } else if (c === " " || c === "\t" || c === "\r") i++;
      else if (c === "/" && source[i + 1] === "/") {
        while (i < source.length && source[i] !== "\n") i++;
      } else if (c === "/" && source[i + 1] === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end < 0 ? source.length : end + 2;
        for (let k = i; k < stop; k++) if (source[k] === "\n") line++;
        i = stop;
      } else if (c === "'" || c === '"') {
        const start = line;
        const pos = i;
        let value = "";
        i++;
        while (i < source.length && source[i] !== c && source[i] !== "\n") {
          if (source[i] === "\\") {
            value += source[i + 1] ?? "";
            i += 2;
          } else value += source[i++];
        }
        if (source[i] === c) i++;
        out.push({ kind: "str", text: `${c}${value}${c}`, line: start, pos, value });
      } else if (c === "`") {
        const start = line;
        const pos = i;
        let value = "";
        let dynamic = false;
        i++;
        while (i < source.length && source[i] !== "`") {
          if (source[i] === "\\") {
            value += source[i + 1] ?? "";
            i += 2;
          } else if (source[i] === "$" && source[i + 1] === "{") {
            dynamic = true;
            i += 2;
            code(true);
            i++;
          } else {
            if (source[i] === "\n") line++;
            value += source[i++];
          }
        }
        i++;
        out.push({ kind: "tpl", text: "`…`", line: start, pos, ...(dynamic ? {} : { value }) });
      } else if (c === "/" && regexAllowed()) {
        const start = i;
        let inClass = false;
        i++;
        while (i < source.length && source[i] !== "\n") {
          if (source[i] === "\\") i += 2;
          else if (source[i] === "[") (inClass = true), i++;
          else if (source[i] === "]") (inClass = false), i++;
          else if (source[i] === "/" && !inClass) break;
          else i++;
        }
        i++;
        while (i < source.length && isId(at(i))) i++;
        out.push({ kind: "regex", text: source.slice(start, i), line, pos: start });
      } else if (isIdStart(at(i))) {
        const start = i;
        while (i < source.length && isId(at(i))) i++;
        out.push({ kind: "id", text: source.slice(start, i), line, pos: start });
      } else if (c >= "0" && c <= "9") {
        const start = i;
        while (i < source.length && (isId(at(i)) || source[i] === ".")) i++;
        out.push({ kind: "num", text: source.slice(start, i), line, pos: start });
      } else {
        if (inTemplate && c === "}" && depth === 0) return;
        if (c === "{") depth++;
        if (c === "}") depth--;
        out.push({ kind: "punct", text: c, line, pos: i });
        i++;
      }
    }
  };
  code(false);
  return out;
}

/** The string a token holds when it is one plain string: a quoted string, or a template with no `${…}`. */
const plain = (t: Token | undefined): string | undefined => (t !== undefined && (t.kind === "str" || t.kind === "tpl") ? t.value : undefined);
const is = (t: Token | undefined, kind: Kind, text?: string): boolean => t !== undefined && t.kind === kind && (text === undefined || t.text === text);

/** Members a module promise is read through as a value; anything else read off `import(…)` is a type. */
const PROMISE_MEMBERS = new Set(["then", "catch", "finally"]);

/** Every load of a module in `source`, and every dynamic load whose specifier cannot be read. */
export function scan(source: string): { loads: Load[]; unread: Unread[] } {
  const t = tokens(source);
  const loads: Load[] = [];
  const unread: Unread[] = [];
  const consumed = new Set<number>();
  /** The named specifiers of a `{ … }` clause starting at `k`: the names taken, whether each is a type, and the index after `}`. */
  const braces = (k: number): { names: string[]; allTypes: boolean; next: number } => {
    const names: string[] = [];
    let allTypes = true;
    let j = k + 1;
    while (j < t.length && !is(t[j], "punct", "}")) {
      let type = false;
      if (is(t[j], "id", "type") && (is(t[j + 1], "id") || is(t[j + 1], "str"))) {
        type = true;
        j++;
      }
      const name = t[j]?.kind === "str" ? (t[j]?.value ?? "") : (t[j]?.text ?? "");
      if (name !== "" && name !== ",") {
        names.push(name);
        if (!type) allTypes = false;
      }
      while (j < t.length && !is(t[j], "punct", ",") && !is(t[j], "punct", "}")) j++;
      if (is(t[j], "punct", ",")) j++;
    }
    return { names, allTypes: allTypes && names.length > 0, next: j + 1 };
  };
  /** The source between the `(` at `k` and its matching `)`, spaces collapsed. */
  const argument = (k: number): string => {
    let depth = 0;
    for (let j = k; j < t.length; j++) {
      if (is(t[j], "punct", "(")) depth++;
      else if (is(t[j], "punct", ")") && --depth === 0) return source.slice((t[k]?.pos ?? 0) + 1, t[j]?.pos ?? source.length).replace(/\s+/g, " ").trim();
    }
    return source.slice((t[k]?.pos ?? 0) + 1).replace(/\s+/g, " ").trim();
  };
  const dynamicArg = (k: number, what: string): void => {
    // `k` is the index of `(`.
    const spec = plain(t[k + 1]);
    if (spec !== undefined && (is(t[k + 2], "punct", ")") || is(t[k + 2], "punct", ","))) {
      const close = is(t[k + 2], "punct", ")") ? k + 2 : k + 3;
      const member = is(t[close + 1], "punct", ".") ? t[close + 2] : undefined;
      const typeOnly = is(t[k - 2], "id", "typeof") || (member !== undefined && member.kind === "id" && !PROMISE_MEMBERS.has(member.text));
      loads.push({ spec, typeOnly: what === "import" && typeOnly, names: ["*"], line: t[k]?.line ?? 0 });
      return;
    }
    unread.push({ line: t[k]?.line ?? 0, what: `${what}(…) of something that is not one plain string`, expr: argument(k) });
  };
  for (let k = 0; k < t.length; k++) {
    const tok = t[k] as Token;
    if (tok.kind !== "id" || consumed.has(k)) continue;
    const prev = t[k - 1];
    if (is(prev, "punct", ".") || is(prev, "punct", "?")) continue;
    if (tok.text === "import") {
      const next = t[k + 1];
      if (is(next, "punct", "(")) {
        dynamicArg(k + 1, "import");
        continue;
      }
      if (is(next, "punct", ".") || is(next, "punct", ":") || is(next, "punct", ",") || is(next, "punct", ")")) continue;
      if (plain(next) !== undefined) {
        loads.push({ spec: plain(next) as string, typeOnly: false, names: ["*"], line: tok.line });
        continue;
      }
      let j = k + 1;
      let typeOnly = false;
      if (is(t[j], "id", "type") && !is(t[j + 1], "punct", ",") && !is(t[j + 1], "id", "from") && !is(t[j + 1], "punct", "=")) {
        typeOnly = true;
        j++;
      }
      // `import x = require("…")`; `import x = A.b` is no load.
      if (is(t[j], "id") && is(t[j + 1], "punct", "=")) {
        if (is(t[j + 2], "id", "require") && is(t[j + 3], "punct", "(")) {
          consumed.add(j + 2);
          const spec = plain(t[j + 4]);
          if (spec !== undefined && is(t[j + 5], "punct", ")")) loads.push({ spec, typeOnly, names: ["*"], line: tok.line });
          else unread.push({ line: tok.line, what: "import … = require(…) of something that is not one plain string", expr: argument(j + 3) });
        }
        continue;
      }
      const names: string[] = [];
      let allTypes = false;
      if (is(t[j], "id") && !is(t[j], "id", "from")) {
        names.push("default");
        j++;
        if (is(t[j], "punct", ",")) j++;
      }
      if (is(t[j], "punct", "*")) {
        names.push("*");
        j += 3; // * as name
      } else if (is(t[j], "punct", "{")) {
        const clause = braces(j);
        names.push(...clause.names);
        allTypes = clause.allTypes && names.length === clause.names.length;
        j = clause.next;
      }
      if (is(t[j], "id", "from") && plain(t[j + 1]) !== undefined) {
        loads.push({ spec: plain(t[j + 1]) as string, typeOnly: typeOnly || allTypes, names: names.length > 0 ? names : ["*"], line: tok.line });
      }
      continue;
    }
    if (tok.text === "export") {
      let j = k + 1;
      let typeOnly = false;
      if (is(t[j], "id", "type") && (is(t[j + 1], "punct", "{") || is(t[j + 1], "punct", "*"))) {
        typeOnly = true;
        j++;
      }
      let names: string[] = [];
      let allTypes = false;
      if (is(t[j], "punct", "*")) {
        names = ["*"];
        j++;
        if (is(t[j], "id", "as")) j += 2;
      } else if (is(t[j], "punct", "{")) {
        const clause = braces(j);
        names = clause.names;
        allTypes = clause.allTypes;
        j = clause.next;
      } else continue;
      if (is(t[j], "id", "from") && plain(t[j + 1]) !== undefined) {
        loads.push({ spec: plain(t[j + 1]) as string, typeOnly: typeOnly || allTypes, names: names.length > 0 ? names : ["*"], line: tok.line });
      }
      continue;
    }
    if (tok.text === "require" && is(t[k + 1], "punct", "(") && !is(prev, "id", "function")) dynamicArg(k + 1, "require");
  }
  return { loads, unread };
}

/** The file a relative specifier names from `from`, as TypeScript and Bun resolve it; `there` says whether a path is a file. */
export function resolveSpec(from: string, spec: string, there: (path: string) => boolean, root: string): string {
  const base = relative(root, resolve(root, dirname(from), spec)).split("\\").join("/");
  const stem = base.replace(/\.(m|c)?jsx?$/, "");
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.tsx`];
  if (stem !== base) candidates.splice(1, 0, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.d.ts`);
  return candidates.find(there) ?? base;
}

/** One import between files of the tree. `to` is a path from the root, or null for a package (`spec`). */
export interface Edge {
  from: string;
  to: string | null;
  spec: string;
  typeOnly: boolean;
  names: readonly string[];
  line: number;
}

/** Source files: what TypeScript and Bun load. */
const SOURCE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", "data", ".git"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (SOURCE.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** The folders whose files are read: the source, the tests, the scripts and the preview. */
export const READ_FOLDERS = ["src", "test", "scripts", "dev"] as const;

/** The loads of a tree: every import between its files, and every load that cannot be read, with the file that makes it. */
export interface Tree {
  edges: Edge[];
  unread: (Unread & { from: string })[];
}

/**
 * Every load of every source file under `root`'s read folders, with the `planted` files (path from
 * the root to source text) read as if they were there too; and every load that cannot be read.
 */
export function readTree(root: string, planted: ReadonlyMap<string, string> = new Map(), folders: readonly string[] = READ_FOLDERS): Tree {
  const rel = (file: string) => relative(root, file).split("\\").join("/");
  const sources = new Map<string, string>();
  for (const folder of folders) for (const file of walk(join(root, folder))) sources.set(rel(file), readFileSync(file, "utf8"));
  for (const [path, source] of planted) sources.set(path, source);
  const there = (path: string) => planted.has(path) || (existsSync(join(root, path)) && statSync(join(root, path)).isFile());
  const edges: Edge[] = [];
  const unread: (Unread & { from: string })[] = [];
  for (const [from, source] of sources) {
    const read = scan(source);
    for (const u of read.unread) unread.push({ from, ...u });
    for (const load of read.loads) {
      const to = load.spec.startsWith(".") ? resolveSpec(from, load.spec, there, root) : null;
      edges.push({ from, to, spec: load.spec, typeOnly: load.typeOnly, names: load.names, line: load.line });
    }
  }
  return { edges, unread };
}
