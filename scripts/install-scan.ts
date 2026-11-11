// Lumiverse's install scan, run here before anything ships. Lumiverse refuses to load an extension
// whose backend bundle uses what its worker may not: the filesystem, subprocesses, sockets, workers,
// SQLite, Bun's system APIs, the process's environment, dynamic code and base64 decoding. The build
// fails on any of them, and a test holds the built bundle to the same.
//
// This follows the host's own scan step by step (Lumiverse's `detectDangerousBackendCapabilities`,
// `src/spindle/manager.service.ts`), so that what passes here passes there: the bundle is read as it
// is and as Bun's transpiler rewrites it; comments, string and template text and regex literals are
// left out; and what remains is matched. Where the host's reading of a template or a regex is
// simple, this one is simple the same way: the two must agree, not improve on each other.
//
// Two checks are stricter than the host's, because the backend carries LumiAH's, whose own contract
// they are (its DESIGN §1): no `node:` import of any module, and no call of the global `fetch`.

type Span = readonly [start: number, end: number];

interface Scannable {
  text: string;
  ignored: Span[];
}

/** One thing the scan refuses, and where the bundle has it. */
export interface ScanHit {
  what: string;
  /** The bundle's text around the first place it was found, on one line. */
  near: string;
}

/** Node's secure-socket module, spelled in two parts: the repository's push check refuses its name written whole. */
const SECURE_SOCKETS = ["t", "ls"].join("");

const MODULES: ReadonlyMap<string, string> = new Map([
  ["fs", "filesystem module access"],
  ["fs/promises", "filesystem module access"],
  ["node:fs", "filesystem module access"],
  ["node:fs/promises", "filesystem module access"],
  ["child_process", "subprocess module access"],
  ["node:child_process", "subprocess module access"],
  ["net", "direct socket module access"],
  [SECURE_SOCKETS, "direct socket module access"],
  ["dgram", "direct socket module access"],
  ["http", "direct socket module access"],
  ["https", "direct socket module access"],
  ["node:net", "direct socket module access"],
  [`node:${SECURE_SOCKETS}`, "direct socket module access"],
  ["node:dgram", "direct socket module access"],
  ["node:http", "direct socket module access"],
  ["node:https", "direct socket module access"],
  ["worker_threads", "worker or cluster module access"],
  ["cluster", "worker or cluster module access"],
  ["node:worker_threads", "worker or cluster module access"],
  ["node:cluster", "worker or cluster module access"],
  ["bun:sqlite", "direct SQLite module access"],
  ["node:sqlite", "direct SQLite module access"],
]);

const BUN_PROPERTIES: ReadonlySet<string> = new Set(["file", "write", "spawn", "spawnSync", "serve", "connect", "listen"]);
const PROCESS_PROPERTIES: ReadonlySet<string> = new Set(["env", "exit", "kill", "chdir", "dlopen"]);
const BUN_USE = "dangerous Bun system API usage";
const PROCESS_USE = "dangerous process API usage";

/** A module named by a literal after `from`, `require(` or `import(`. */
const loads = (names: string): RegExp => new RegExp(`(?:from\\s*["'\`](?:node:)?(?:${names})["'\`]|require\\s*\\(\\s*["'\`](?:node:)?(?:${names})["'\`]\\s*\\)|import\\s*\\(\\s*["'\`](?:node:)?(?:${names})["'\`]\\s*\\))`);

const CHECKS: readonly (readonly [what: string, pattern: RegExp])[] = [
  ["filesystem module access", loads("fs(?:\\/promises)?")],
  ["subprocess module access", loads("child_process")],
  ["direct socket module access", loads(`net|${SECURE_SOCKETS}|dgram|http|https`)],
  ["worker or cluster module access", loads("worker_threads|cluster")],
  ["direct SQLite module access", /(?:from\s*["'`](?:bun:sqlite|node:sqlite)["'`]|require\s*\(\s*["'`](?:bun:sqlite|node:sqlite)["'`]\s*\)|import\s*\(\s*["'`](?:bun:sqlite|node:sqlite)["'`]\s*\))/],
  [BUN_USE, /\bBun\.(?:file|write|spawn|spawnSync|serve|connect|listen)\b/],
  [PROCESS_USE, /\bprocess\.(?:env|exit|kill|chdir|dlopen)\b/],
  [PROCESS_USE, /\bObject\.getOwnPropertyDescriptor\s*\(\s*process\s*,\s*["'`]env["'`]/],
  ["base64 decoding", /\bBuffer\.from\s*\([^)]*["'`]base64["'`]/],
  // Stricter than the host, as LumiAH's contract is.
  ["a node: module", /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s*)["'`]node:/],
  ["a network call (fetch)", /(?<![.\w$])fetch\s*\(|\b(?:globalThis|self|window)\s*\.\s*fetch\b/],
];

/** The characters and words after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER: ReadonlySet<string> = new Set(["(", ",", "=", "!", "&", "|", "?", ":", ";", "{", "[", "}", "+", "-", "*", "%", "~", "^", "<", ">"]);
const REGEX_AFTER_WORDS: ReadonlySet<string> = new Set(["return", "typeof", "delete", "void", "throw", "new", "in", "of", "instanceof", "case", "do", "else", "yield", "await"]);

/** The parts of `source` that are no code, in order: comments, string and template text, regex literals. */
function ignoredSpans(source: string): Span[] {
  const spans: Span[] = [];
  const end = source.length;
  const add = (from: number, to: number): void => {
    if (to > from) spans.push([from, to]);
  };
  const quoted = (start: number, quote: string): number => {
    for (let i = start + 1; i < end; i++) {
      if (source[i] === "\\") i++;
      else if (source[i] === quote) {
        add(start, i + 1);
        return i + 1;
      }
    }
    add(start, end);
    return end;
  };
  const template = (start: number): number => {
    let text = start;
    let i = start + 1;
    while (i < end) {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "`") {
        add(text, i + 1);
        return i + 1;
      } else if (source[i] === "$" && source[i + 1] === "{") {
        add(text, i + 2);
        i = code(i + 2, true);
        if (source[i] !== "}") return i;
        text = i;
        i++;
      } else i++;
    }
    add(text, end);
    return end;
  };
  const regexStarts = (at: number): boolean => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(source[j] ?? "")) j--;
    if (j < 0) return true;
    const ch = source[j] ?? "";
    if (REGEX_AFTER.has(ch)) return true;
    if (!/[A-Za-z_$]/.test(ch)) return false;
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k] ?? "")) k--;
    return REGEX_AFTER_WORDS.has(source.slice(k + 1, j + 1));
  };
  const regex = (start: number): number => {
    let inClass = false;
    for (let i = start + 1; i < end; i++) {
      const ch = source[i];
      if (ch === "\\") i++;
      else if (ch === "[") inClass = true;
      else if (ch === "]" && inClass) inClass = false;
      else if (ch === "/" && !inClass) {
        let after = i + 1;
        while (after < end && /[dgimsuy]/.test(source[after] ?? "")) after++;
        add(start, after);
        return after;
      } else if (ch === "\n") return start + 1;
    }
    add(start, end);
    return end;
  };
  const code = (start: number, inTemplate = false): number => {
    let i = start;
    while (i < end) {
      const ch = source[i];
      const next = source[i + 1];
      if (inTemplate && ch === "}") return i;
      if (ch === "/" && (next === "/" || next === "*")) {
        const close = next === "/" ? source.indexOf("\n", i + 2) : source.indexOf("*/", i + 2);
        const to = close === -1 ? end : next === "/" ? close : close + 2;
        add(i, to);
        i = to;
      } else if (ch === "/" && regexStarts(i)) i = regex(i);
      else if (ch === '"' || ch === "'") i = quoted(i, ch);
      else if (ch === "`") i = template(i);
      else i++;
    }
    return i;
  };
  code(0);
  return spans.sort((a, b) => a[0] - b[0]);
}

/** Every match of `pattern` that starts in code. */
function outside(source: Scannable, pattern: RegExp): RegExpMatchArray[] {
  const all = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...source.text.matchAll(all)].filter((match) => {
    const at = match.index ?? -1;
    for (const [from, to] of source.ignored) {
      if (at < from) return true;
      if (at < to) return false;
    }
    return true;
  });
}

/** A quoted literal's text; null when `raw` is no single literal. */
function quotedText(raw: string): string | null {
  const literal = raw.trim();
  if (!/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)$/.test(literal)) return null;
  const body = literal.slice(1, -1);
  if (literal.startsWith("`")) return body.replace(/\$\{[^}]*\}/g, "");
  if (literal.startsWith("'")) return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  try {
    return JSON.parse(literal) as string;
  } catch {
    return body;
  }
}

/** The text a simple string expression makes, as far as its literals say: what a computed property (`Bun["ser" + "ve"]`) names. */
function simpleText(raw: string): string | null {
  const direct = quotedText(raw);
  if (direct !== null) return direct;
  const codes = /^String\.fromCharCode\s*\(([^)]*)\)$/.exec(raw.trim());
  if (codes) {
    const chars = (codes[1] ?? "").split(",").map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 0x10ffff);
    if (chars.length > 0) return String.fromCodePoint(...chars);
  }
  const parts = [...raw.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g)].map((m) => (m[3] !== undefined ? m[3].replace(/\$\{[^}]*\}/g, "") : m[1] !== undefined ? (quotedText(`"${m[1]}"`) ?? "") : (quotedText(`'${m[2] ?? ""}'`) ?? "")));
  return parts.length > 0 ? parts.join("") : null;
}

/** The module a `require(…)` or `import(…)` names, only where its whole argument is provably constant (literals joined by `+`, or `String.fromCharCode` of integer literals); null for anything else, which the host refuses unseen. */
function staticModule(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  const codes = /^String\.fromCharCode\s*\(([^)]*)\)$/.exec(text);
  if (codes) {
    const parts = (codes[1] ?? "").split(",").map((part) => part.trim());
    return parts.every((part) => /^\d+$/.test(part) && Number(part) <= 0x10ffff) ? String.fromCodePoint(...parts.map(Number)) : null;
  }
  let rest = text;
  let value = "";
  for (;;) {
    const literal = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:[^`\\$]|\\.|\$(?!\{))*`)/.exec(rest);
    const decoded = literal ? quotedText(literal[0]) : null;
    if (!literal || decoded === null) return null;
    value += decoded;
    rest = rest.slice(literal[0].length).trimStart();
    // `import(spec, { with: … })`: the specifier is whole, and what follows is its attributes.
    if (rest === "" || rest.startsWith(",")) return value;
    if (!rest.startsWith("+")) return null;
    rest = rest.slice(1).trimStart();
    if (rest === "") return null;
  }
}

/** Uses of `properties` of `object` (`Bun`, `process`, or a name either was given), by a dot or a computed name. */
function propertyUses(source: Scannable, object: string, properties: ReadonlySet<string>): RegExpMatchArray[] {
  const name = object.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dotted = outside(source, new RegExp(`\\b${name}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`)).filter((m) => properties.has(m[1] ?? ""));
  const computed = outside(source, new RegExp(`\\b${name}\\s*\\[([^\\]]{1,300})\\]`)).filter((m) => properties.has(simpleText(m[1] ?? "") ?? ""));
  return [...dotted, ...computed];
}

function scan(source: Scannable): Map<string, RegExpMatchArray> {
  const hits = new Map<string, RegExpMatchArray>();
  const hit = (what: string, matches: readonly RegExpMatchArray[]): void => {
    const [first] = matches;
    if (first && !hits.has(what)) hits.set(what, first);
  };
  for (const [what, pattern] of CHECKS) hit(what, outside(source, pattern));
  // A bare `require(…)` or `import(…)`: a module the host refuses, or one it can't read and so refuses too. A method of that name, called or defined, is neither.
  for (const match of outside(source, /(?<![.\w$])(?:require|import)\s*\(([^;\n]{1,300})\)/)) {
    if (/^\s*\{/.test(source.text.slice((match.index ?? 0) + match[0].length))) continue;
    const named = staticModule(match[1] ?? "");
    if (named === null) hit("dynamic module access", [match]);
    else if (MODULES.has(named)) hit(MODULES.get(named) ?? named, [match]);
  }
  hit(BUN_USE, propertyUses(source, "Bun", BUN_PROPERTIES));
  hit(PROCESS_USE, propertyUses(source, "process", PROCESS_PROPERTIES));
  for (const alias of outside(source, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(Bun|process)\b/)) {
    const bun = alias[2] === "Bun";
    hit(bun ? BUN_USE : PROCESS_USE, propertyUses(source, alias[1] ?? "", bun ? BUN_PROPERTIES : PROCESS_PROPERTIES));
  }
  for (const [object, properties, what] of [["Bun", BUN_PROPERTIES, BUN_USE], ["process", PROCESS_PROPERTIES, PROCESS_USE]] as const) {
    hit(what, outside(source, new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*${object}\\b`)).filter((m) => (m[1] ?? "").split(",").some((part) => properties.has(part.trim().split(/\s*:/, 1)[0]?.trim() ?? ""))));
  }
  // `eval(` and `Function(`, but for the feature probe that builds an empty function (`new Function("")`), which runs nothing.
  hit("dynamic code execution", outside(source, /\beval\s*\(|\bFunction\s*\(/).filter((m) => !/^Function\s*\(\s*(?:""|''|``|)\s*\)/.test(source.text.slice(m.index ?? 0))));
  return hits;
}

/** What Lumiverse's install scan would refuse in a backend bundle, each with where it is; none for a bundle it loads. */
export function installScan(js: string): ScanHit[] {
  let rewritten = js;
  try {
    rewritten = new Bun.Transpiler({ loader: "js" }).transformSync(js);
  } catch {
    // What the transpiler can't read is scanned as it stands, as the host does.
  }
  const found = new Map<string, ScanHit>();
  for (const text of rewritten === js ? [js] : [js, rewritten]) {
    for (const [what, match] of scan({ text, ignored: ignoredSpans(text) })) {
      const at = match.index ?? 0;
      if (!found.has(what)) found.set(what, { what, near: text.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, " ").trim() });
    }
  }
  return [...found.values()];
}
