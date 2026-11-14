// A key of a YAML file the user also edits (`RPE-global.yml`, a chat's `RPE.yml`), changed without
// touching the rest of the file: the user's comments, order and layout elsewhere stay as they wrote them.

import { YAML } from "bun";
import { OneAtATime } from "./disk";

const WRITERS = new Map<string, OneAtATime>();

/** One change at a time to the config file at `path`, whichever part of RPE makes it, so that none is lost under another. */
export function configWrites(path: string): OneAtATime {
  let writes = WRITERS.get(path);
  if (writes === undefined) {
    writes = new OneAtATime();
    WRITERS.set(path, writes);
  }
  return writes;
}

/** `value` as JSON with every object's keys sorted, so two values compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The YAML document in `text` as a mapping; `{}` for an empty file. Throws for text that is not one mapping. */
export function yamlMapping(text: string, where: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (error) {
    throw new Error(`${where} is not YAML that RPE can read (${error instanceof Error ? error.message : String(error)}): fix it, then try again.`);
  }
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${where} must hold one mapping of names to values.`);
  return doc as Record<string, unknown>;
}

/**
 * `text` with its top-level `key` set to `value`. The key's own block (its line, and the indented
 * and blank lines under it) is replaced, or added at the end; every other line is kept as it was.
 * When that would not read back as the same document with only `key` changed (a layout this does
 * not follow, such as a flow-style block running over lines at the margin), the document is written
 * whole instead, which keeps every value but not the comments.
 */
export function withTopLevelKey(text: string, key: string, value: unknown, where: string): string {
  const before = yamlMapping(text, where);
  const wanted = { ...before, [key]: value };
  // Bun writes a space after a key whose value starts on the next line; it is left off.
  const block = YAML.stringify({ [key]: value }, null, 2).replace(/:[ ]+$/gm, ":").replace(/\n+$/, "").split("\n");
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  let next: string[];
  if (at === -1) {
    const kept = text.replace(/\n+$/, "");
    next = kept === "" ? block : [...kept.split("\n"), "", ...block];
  } else {
    let end = at + 1;
    while (end < lines.length && (lines[end] === "" || /^[ \t]/.test(lines[end] ?? ""))) end++;
    while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end--;
    next = [...lines.slice(0, at), ...block, ...lines.slice(end)];
  }
  const spliced = `${next.join("\n").replace(/\n+$/, "")}\n`;
  let reread: unknown = null;
  try {
    reread = YAML.parse(spliced);
  } catch {
    // Read below as a mismatch.
  }
  if (canonical(reread ?? {}) === canonical(wanted)) return spliced;
  return YAML.stringify(wanted, null, 2).replace(/:[ ]+$/gm, ":");
}

type Doc = Record<string, unknown>;

function isDoc(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a document holds at `path`; undefined where it holds nothing. */
function at(doc: Doc, path: readonly string[]): unknown {
  let here: unknown = doc;
  for (const part of path) here = isDoc(here) ? here[part] : undefined;
  return here;
}

/** `doc` with `path` set to `value`, or taken away where `value` is undefined; a mapping that leaves empty is taken away with it. */
function changed(doc: Doc, path: readonly string[], value: unknown): Doc {
  const out = structuredClone(doc);
  const [head, ...rest] = path;
  if (head === undefined) return out;
  if (rest.length === 0) {
    if (value === undefined) delete out[head];
    else out[head] = value;
    return out;
  }
  const below = out[head];
  if (value === undefined && !isDoc(below)) return out;
  const inner = changed(isDoc(below) ? below : {}, rest, value);
  if (Object.keys(inner).length === 0) delete out[head];
  else out[head] = inner;
  return out;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A line that holds nothing: blank, or a comment alone. */
function empty(line: string): boolean {
  const text = line.trim();
  return text === "" || text.startsWith("#");
}

const KEY_LINE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s"'#][^#]*?))[ \t]*:(?:[ \t]|$)/;

/** The key a line of a block mapping starts at `indent` with; null for any other line. */
function keyOf(line: string, indent: number): string | null {
  if (empty(line) || indentOf(line) !== indent) return null;
  const text = line.slice(indent);
  if (text === "-" || text.startsWith("- ")) return null;
  const m = KEY_LINE.exec(text);
  if (m === null) return null;
  if (m[1] !== undefined) {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return null;
    }
  }
  return m[2] !== undefined ? m[2].replaceAll("''", "'") : (m[3] ?? null);
}

/** An entry of a block mapping: its key's line, and the end of the lines under it (blank ones at its end left out). */
interface Entry {
  at: number;
  end: number;
  indent: number;
}

/** The entry `key` among the lines `[from, to)`, which hold a block mapping's entries at `indent`. */
function entryOf(lines: readonly string[], from: number, to: number, indent: number, key: string): Entry | null {
  for (let i = from; i < to; i++) {
    if (keyOf(lines[i] ?? "", indent) !== key) continue;
    let end = i + 1;
    // Its lines: those deeper than its key, and a list written at its key's own depth.
    while (end < to) {
      const line = lines[end] ?? "";
      const deeper = line.trim() === "" || indentOf(line) > indent || (indentOf(line) === indent && /^-( |$)/.test(line.slice(indent)));
      if (!deeper) break;
      end++;
    }
    while (end > i + 1 && (lines[end - 1] ?? "").trim() === "") end--;
    return { at: i, end, indent };
  }
  return null;
}

/** The depth an entry's block mapping holds its keys at; null where its value is not a block mapping (written on its line, or a list). */
function childIndent(lines: readonly string[], entry: Entry): number | null {
  for (let i = entry.at + 1; i < entry.end; i++) {
    const line = lines[i] ?? "";
    if (empty(line)) continue;
    return indentOf(line) > entry.indent && !/^-( |$)/.test(line.trimStart()) ? indentOf(line) : null;
  }
  return null;
}

/** The entries of `path` the lines hold, outermost first, as far as they go as block mappings. */
function entriesOf(lines: readonly string[], path: readonly string[]): Entry[] {
  const found: Entry[] = [];
  let from = 0;
  let to = lines.length;
  let indent = 0;
  for (const part of path) {
    const entry = entryOf(lines, from, to, indent, part);
    if (entry === null) break;
    found.push(entry);
    const child = childIndent(lines, entry);
    if (child === null) break;
    from = entry.at + 1;
    to = entry.end;
    indent = child;
  }
  return found;
}

/** `{ key: value }` as the block a file writes, at `indent`. */
function blockOf(key: string, value: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);
  // Bun writes a space after a key whose value starts on the next line; it is left off.
  return YAML.stringify({ [key]: value }, null, 2)
    .replace(/:[ ]+$/gm, ":")
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => `${pad}${line}`);
}

/**
 * `text` with the key at `path` set to `value`, or taken away where `value` is undefined, a mapping
 * that leaves empty with it. Only the lines of the deepest entry the change reaches are written: the
 * key's own, or those of the mapping it is added to. When that would not read back as the same
 * document with only that key changed (a layout this does not follow), the document is written whole
 * instead, which keeps every value but not the comments.
 */
export function withKeyAt(text: string, path: readonly string[], value: unknown, where: string): string {
  const wanted = changed(yamlMapping(text, where), path, value);
  let lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") lines = [];
  const entries = entriesOf(lines, path);
  const deepest = entries.at(-1);
  const depth = entries.length - 1;
  if (deepest === undefined || (depth < path.length - 1 && childIndent(lines, deepest) !== null)) {
    // The key is not there: added at the end of the deepest mapping that is, or of the file.
    const key = path[depth + 1] ?? "";
    const added = at(wanted, path.slice(0, depth + 2));
    if (added !== undefined) {
      if (deepest === undefined) lines = [...lines, ...(lines.length === 0 ? [] : [""]), ...blockOf(key, added, 0)];
      else lines.splice(deepest.end, 0, ...blockOf(key, added, childIndent(lines, deepest) ?? 0));
    }
  } else {
    // The key is there, or a value written on its line stands where its mapping would: that entry is written again, or taken away.
    const now = at(wanted, path.slice(0, depth + 1));
    lines.splice(deepest.at, deepest.end - deepest.at, ...(now === undefined ? [] : blockOf(path[depth] ?? "", now, deepest.indent)));
    // A mapping above it that is left empty goes, its key's line with it.
    for (let d = depth - 1; d >= 0 && at(wanted, path.slice(0, d + 1)) === undefined; d--) {
      const above = entriesOf(lines, path.slice(0, d + 1))[d];
      if (above !== undefined) lines.splice(above.at, above.end - above.at);
    }
  }
  const spliced = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  let reread: unknown = null;
  try {
    reread = YAML.parse(spliced);
  } catch {
    // Read below as a mismatch.
  }
  if (canonical(reread ?? {}) === canonical(wanted)) return spliced;
  return Object.keys(wanted).length === 0 ? "" : YAML.stringify(wanted, null, 2).replace(/:[ ]+$/gm, ":");
}
