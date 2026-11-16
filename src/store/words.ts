// No words of the store's reach an agent (BUILD.md, "No prompt text in code"; plan §17.2). The tree
// view, the fold and the world state return structure: lines as data (the kind of line, which is the
// name of the template that words it, and its values) and reports as a code with its values. This
// is the one place they are worded, from a prompt part the caller hands over (the world state's
// layout, `.prompts/world-state.md`, as the chat has it), so the turn folder, the world state and
// the engine's tools all word a view the same way.
//
// The part is read in the syntax every guidance file uses, as RPH and the engine's tools read it: a
// header between two `---` lines (YAML), then a body. `{{name.path}}` puts a field in;
// `{{#name}}…{{/name}}` shows its block when the field is there and not empty (once per item for a
// list, `{{.}}` the item); `{{^name}}…{{/name}}` shows it when the field is absent or empty; a list
// put in whole is joined by ", "; a line holding only a block's tag leaves nothing behind. The
// store may not import either reader (test/standalone-boundaries.test.ts), so it carries its own.
//
// The header's `lines:` names a template for each kind of line; a kind the part has no template
// for is not said. `keys:` gives words for the keys the store names by a code (`time_zone`); any
// other key is the data's own and is shown as it is. The body is the world state's layout.

import type { JsonObject, JsonValue } from "../shared/json";
import { StoreInputError } from "./types";

/** A list put in whole is joined by this, as in every guidance file. */
const LIST_JOIN = ", ";

/** Levels of a view are indented by this much per level: the tree's shape, not a word. */
const INDENT = "  ";

type Node = { type: "text"; text: string } | { type: "field"; path: string } | { type: "block"; path: string; inverted: boolean; children: Node[] };

const PATH = /^(?:\.|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/;
const TAG = /\{\{(.*?)\}\}/g;
const FENCE = /^---[ \t]*$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === "" || v === 0 || Number.isNaN(v)) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObject(v)) return Object.keys(v).length === 0;
  return false;
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter((s) => s !== "").join(LIST_JOIN);
  return "";
}

function lookup(path: string, contexts: readonly unknown[]): unknown {
  if (path === ".") return contexts.at(-1);
  const [head = "", ...rest] = path.split(".");
  for (let i = contexts.length - 1; i >= 0; i--) {
    const c = contexts[i];
    if (!isObject(c) || !Object.hasOwn(c, head) || c[head] === undefined) continue;
    let v: unknown = c[head];
    for (const name of rest) {
      if (!isObject(v) || !Object.hasOwn(v, name)) return undefined;
      v = v[name];
    }
    return v;
  }
  return undefined;
}

function renderNodes(nodes: readonly Node[], contexts: readonly unknown[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === "text") out.push(node.text);
    else if (node.type === "field") out.push(textOf(lookup(node.path, contexts)));
    else {
      const v = lookup(node.path, contexts);
      if (node.inverted) {
        if (isEmpty(v)) renderNodes(node.children, contexts, out);
      } else if (!isEmpty(v)) {
        if (Array.isArray(v)) for (const item of v) renderNodes(node.children, [...contexts, item], out);
        else renderNodes(node.children, [...contexts, v], out);
      }
    }
  }
}

/** A template, parsed once and filled as often as asked. */
export class Template {
  private constructor(private readonly nodes: Node[]) {}

  /** Parses a template; a tag that is not one of the syntax's, or a block left open, is input that cannot be read. */
  static parse(source: string, what: string): Template {
    const root: Node[] = [];
    const stack: { path: string; children: Node[] }[] = [];
    const into = (): Node[] => stack.at(-1)?.children ?? root;
    const text = source.replace(/^[ \t]*(\{\{[#^/][^}]*\}\})[ \t]*\n/gm, "$1");
    let last = 0;
    for (const m of text.matchAll(TAG)) {
      if (m.index > last) into().push({ type: "text", text: text.slice(last, m.index) });
      last = m.index + m[0].length;
      const tag = (m[1] ?? "").trim();
      const sigil = tag[0];
      if (sigil === "#" || sigil === "^") {
        const path = tag.slice(1).trim();
        if (!PATH.test(path)) throw new StoreInputError(`${what}: {{${tag}}} names no field`);
        const block: Node = { type: "block", path, inverted: sigil === "^", children: [] };
        into().push(block);
        stack.push({ path, children: block.children });
      } else if (sigil === "/") {
        const path = tag.slice(1).trim();
        const open = stack.pop();
        if (open === undefined || open.path !== path) throw new StoreInputError(`${what}: {{/${path}}} closes no open block`);
      } else {
        if (!PATH.test(tag)) throw new StoreInputError(`${what}: {{${tag}}} names no field`);
        into().push({ type: "field", path: tag });
      }
    }
    if (last < text.length) into().push({ type: "text", text: text.slice(last) });
    if (stack.length > 0) throw new StoreInputError(`${what}: {{#${stack.at(-1)?.path}}} is never closed`);
    return new Template(root);
  }

  /** The text filled from `contexts`, innermost last. */
  render(...contexts: readonly unknown[]): string {
    const out: string[] = [];
    renderNodes(this.nodes, contexts, out);
    return out.join("");
  }

  /** The fields the template reads at its top level, block names included. */
  get fields(): string[] {
    const names = new Set<string>();
    for (const n of this.nodes) if (n.type !== "text" && n.path !== ".") names.add(n.path.split(".")[0] ?? n.path);
    return [...names];
  }
}

/** A prompt part as the store reads it. */
export interface Part {
  /** The header's fields: every template reads them too. */
  header: Readonly<Record<string, unknown>>;
  /** A template for each kind of line, in the order the part lists them. */
  lines: ReadonlyMap<string, Template>;
  /** Words for the keys the store names by a code. */
  keys: Readonly<Record<string, string>>;
  /** The body: for the world state's part, its layout. */
  body: Template;
}

/** Reads a part's text. A header or a template that cannot be read is refused, saying where. */
export function readPart(text: string, what = "the prompt part"): Part {
  const all = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n?/g, "\n").split("\n");
  let header: Record<string, unknown> = {};
  let body = all;
  if (FENCE.test(all[0] ?? "")) {
    const end = all.findIndex((line, i) => i > 0 && FENCE.test(line));
    if (end === -1) throw new StoreInputError(`${what}: the header that starts on line 1 has no closing line`);
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(all.slice(1, end).join("\n"));
    } catch (error) {
      throw new StoreInputError(`${what}: the header does not read as YAML (${error instanceof Error ? error.message : String(error)})`);
    }
    if (parsed !== null && parsed !== undefined && !isObject(parsed)) throw new StoreInputError(`${what}: the header is not name: value lines`);
    header = (parsed ?? {}) as Record<string, unknown>;
    body = all.slice(end + 1);
  }
  const lines = new Map<string, Template>();
  if (isObject(header.lines)) for (const [name, said] of Object.entries(header.lines)) if (typeof said === "string") lines.set(name, Template.parse(said, `${what} (lines: ${name})`));
  const keys: Record<string, string> = {};
  if (isObject(header.keys)) for (const [code, said] of Object.entries(header.keys)) if (typeof said === "string") keys[code] = said;
  return { header, lines, keys, body: Template.parse(body.join("\n"), what) };
}

// ---------------------------------------------------------------- views as data

/** One line of a view as data: its kind, which names the part's template for it, how far in it sits, and its values. */
export interface ViewLine {
  kind: string;
  /** Levels in from the view's point. */
  depth: number;
  fields: JsonObject;
}

/**
 * A view: its lines in order. A field named `reflection` holds a level's reflection as parts
 * (`{ kind, fields }`), each worded by its own template and said in the order the part lists them;
 * the line's template reads them as `reflection.parts`, joined as a list is.
 */
export interface View {
  lines: ViewLine[];
}

/** A part of a composite field (a reflection): its kind and its values. */
export interface Piece {
  kind: string;
  fields: JsonObject;
}

function piecesOf(v: JsonValue | undefined): Piece[] | null {
  if (!isObject(v) || !Array.isArray(v.pieces)) return null;
  return (v.pieces as JsonValue[]).filter((p): p is JsonObject => isObject(p)).map((p) => ({ kind: String(p.kind), fields: isObject(p.fields) ? (p.fields as JsonObject) : {} }));
}

/** Pieces worded by their templates, in the order the part lists the templates; a piece with none is not said. */
function wordPieces(part: Part, pieces: readonly Piece[]): string[] {
  const out: string[] = [];
  for (const [kind, template] of part.lines) {
    for (const p of pieces) {
      if (p.kind !== kind) continue;
      const text = template.render(part.header, p.fields).trim();
      if (text !== "") out.push(text);
    }
  }
  return out;
}

/** A line's fields as its template reads them: keys in the part's words, composite fields worded. */
function fieldsFor(part: Part, fields: JsonObject): JsonObject {
  const out: JsonObject = { ...fields };
  if (typeof fields.key === "string" && Object.hasOwn(part.keys, fields.key)) out.key = part.keys[fields.key] ?? fields.key;
  for (const [name, v] of Object.entries(fields)) {
    const pieces = piecesOf(v);
    if (pieces === null) continue;
    const parts = wordPieces(part, pieces);
    if (parts.length > 0) out[name] = { parts };
    else delete out[name];
  }
  return out;
}

/** One line worded by the part, or null when the part has no template for its kind or it fills to nothing. */
export function wordLine(part: Part, line: ViewLine): string | null {
  const template = part.lines.get(line.kind);
  if (!template) return null;
  const text = template.render(part.header, fieldsFor(part, line.fields));
  if (text.trim() === "") return null;
  if (line.depth === 0) return text;
  const pad = INDENT.repeat(line.depth);
  return text.includes("\n") ? pad + text.replaceAll("\n", `\n${pad}`) : pad + text;
}

/** A view as indented text, worded by a part (its text, or as read). */
export function renderView(view: View | readonly ViewLine[], part: Part | string): string {
  const p = typeof part === "string" ? readPart(part) : part;
  const lines = Array.isArray(view) ? (view as readonly ViewLine[]) : (view as View).lines;
  const out: string[] = [];
  for (const line of lines) {
    const text = wordLine(p, line);
    if (text !== null) out.push(text);
  }
  return out.join("\n");
}
