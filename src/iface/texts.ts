// The words of the engine's tools come from files, never from code (plan §5.4, §6.8): a tool's
// description and each argument's text from its file in `.tools/`, and every sentence an answer
// needs from a named line of `.prompts/engine-answers.md`. This reads those files and fills them.
//
// The syntax is the one the lead fixed for every guidance file and RPH reads the same way: a header
// between two `---` lines (YAML), then a body. `{{name.path}}` puts a field in; `{{#name}}…{{/name}}`
// shows its block when the field is there and not empty (once per item for a list, `{{.}}` being
// the item); `{{^name}}…{{/name}}` shows its block when the field is absent or empty. A line that
// holds only a block's tag leaves nothing behind. A part whose header says `format: lines` holds one
// `name: text` template per line; a line the user deleted is a line that is not said.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderTemplate } from "rp-harness/helpers";

/** The folder the shipped guidance lives in, in this repository: the lowest level of every chat's files. */
export const SHIPPED_GUIDANCE = join(import.meta.dir, "..", "..", "guidance");

/** The kinds of guidance file the engine's tools read. */
export type TextKind = "tools" | "prompts";

/**
 * Where the engine's tools read their files: the text of the file of a name in force for a chat
 * (the nearest level that has it and has not switched it off), or undefined when none is. The turn
 * lane gives one over the chat's file tree; `shippedTexts` reads the shipped level alone.
 */
export interface GuidanceFiles {
  read(kind: TextKind, name: string): Promise<string | undefined>;
}

/** The shipped level only: `<root>/.tools/<name>.md` and `<root>/.prompts/<name>.md`. */
export function shippedTexts(root: string = SHIPPED_GUIDANCE): GuidanceFiles {
  return {
    async read(kind, name) {
      try {
        return await readFile(join(root, `.${kind}`, `${name}.md`), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
  };
}

/** Values a template reads: JSON, or anything that reads as it. */
export type Fields = Readonly<Record<string, unknown>>;

/** A file split into its header's fields and its body. A file that does not start with `---` has no header. */
export interface Split {
  header: Record<string, unknown>;
  body: string;
}

const FENCE = /^---[ \t]*$/;

/** Splits a guidance file. A header that does not parse throws, saying which file. */
export function splitFile(text: string, what: string): Split {
  const lines = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n?/g, "\n").split("\n");
  if (!FENCE.test(lines[0] ?? "")) return { header: {}, body: lines.join("\n") };
  const end = lines.findIndex((line, i) => i > 0 && FENCE.test(line));
  if (end === -1) throw new Error(`${what}: the header that starts on line 1 has no closing line`);
  const parsed: unknown = Bun.YAML.parse(lines.slice(1, end).join("\n"));
  if (parsed !== null && parsed !== undefined && (typeof parsed !== "object" || Array.isArray(parsed))) throw new Error(`${what}: the header is not name: value lines`);
  return { header: (parsed ?? {}) as Record<string, unknown>, body: lines.slice(end + 1).join("\n") };
}

// ---------------------------------------------------------------- templates

type Node = { type: "text"; text: string } | { type: "field"; path: string } | { type: "block"; path: string; inverted: boolean; children: Node[] };

/** A field's path: `.`, or names of letters, digits, `_` and `-` joined by dots. */
const PATH = /^(?:\.|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/;
const TAG = /\{\{(.*?)\}\}/g;
/** What a list put in with `{{name}}` is joined by. */
export const LIST_JOIN = ", ";

/** A template, parsed once and filled as often as asked. */
export class Template {
  private constructor(
    private readonly nodes: Node[],
    private readonly source: string,
  ) {}

  /** Parses a template; a tag that is not one of the syntax's, or a block left open, throws. */
  static parse(source: string, what: string): Template {
    const root: Node[] = [];
    const stack: { path: string; children: Node[] }[] = [];
    const into = (): Node[] => stack.at(-1)?.children ?? root;
    // A line holding only a block's tag (and spaces) leaves nothing behind, the line break included.
    const text = source.replace(/^[ \t]*(\{\{[#^/][^}]*\}\})[ \t]*\n/gm, "$1");
    let last = 0;
    for (const m of text.matchAll(TAG)) {
      if (m.index > last) into().push({ type: "text", text: text.slice(last, m.index) });
      last = m.index + m[0].length;
      const tag = (m[1] ?? "").trim();
      const sigil = tag[0];
      if (sigil === "#" || sigil === "^") {
        const path = tag.slice(1).trim();
        if (!PATH.test(path)) throw new Error(`${what}: {{${tag}}} names no field`);
        const block: Node = { type: "block", path, inverted: sigil === "^", children: [] };
        into().push(block);
        stack.push({ path, children: block.children });
      } else if (sigil === "/") {
        const path = tag.slice(1).trim();
        const open = stack.pop();
        if (open === undefined || open.path !== path) throw new Error(`${what}: {{/${path}}} closes no open block`);
      } else {
        if (!PATH.test(tag)) throw new Error(`${what}: {{${tag}}} names no field`);
        into().push({ type: "field", path: tag });
      }
    }
    if (last < text.length) into().push({ type: "text", text: text.slice(last) });
    if (stack.length > 0) throw new Error(`${what}: {{#${stack.at(-1)?.path}}} is never closed`);
    return new Template(root, source);
  }

  /** The text filled from `contexts`, innermost last. */
  render(...contexts: readonly Fields[]): string {
    // The one renderer of both repositories (R-44): the contexts merged, the innermost winning where it has a value.
    const merged: Record<string, unknown> = {};
    for (const context of contexts) for (const [key, value] of Object.entries(context)) if (value !== undefined) merged[key] = value;
    return renderTemplate(this.source, merged as Parameters<typeof renderTemplate>[1]).text ?? "";
  }

  /** A pattern every text this template can fill to matches: its words as written, anything where a field goes, a block any number of times. */
  pattern(): RegExp {
    const of = (nodes: readonly Node[]): string => nodes.map((n) => (n.type === "text" ? n.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : n.type === "field" ? "[\\s\\S]*?" : `(?:${of(n.children)})*`)).join("");
    return new RegExp(`^${of(this.nodes)}$`);
  }

  /** The fields the template reads at its top level, block names included. */
  get fields(): string[] {
    const names = new Set<string>();
    const walk = (nodes: readonly Node[]): void => {
      for (const n of nodes) {
        if (n.type === "field" && n.path !== ".") names.add(n.path.split(".")[0] ?? n.path);
        if (n.type === "block") {
          names.add(n.path.split(".")[0] ?? n.path);
          walk(n.children);
        }
      }
    };
    walk(this.nodes);
    return [...names];
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The text a value puts in. */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter((s) => s !== "").join(LIST_JOIN);
  return "";
}

// ---------------------------------------------------------------- the two kinds of file

/** A tool's file: its description for the model, and each argument's, by its path in the arguments (`operations.to`). */
export interface ToolText {
  description: string;
  arguments: Readonly<Record<string, string>>;
  /** What of the file could not be read; the description is then the file's own words as written. */
  problem?: string;
}

/**
 * A tool's file read: its body filled with its header's fields, and its `arguments:` map. A file a
 * user edited must never end a turn: where its header or a tag in its body cannot be read, the
 * description is the text as written (the body, where the header reads) and `problem` says what.
 */
export function toolText(text: string, what: string): ToolText {
  let file: { header: Record<string, unknown>; body: string };
  try {
    file = splitFile(text, what);
  } catch (error) {
    return { description: text.trim(), arguments: {}, problem: error instanceof Error ? error.message : String(error) };
  }
  const given = file.header.arguments;
  const args: Record<string, string> = {};
  if (isObject(given)) for (const [name, said] of Object.entries(given)) if (typeof said === "string") args[name] = said.trim();
  try {
    return { description: Template.parse(file.body, what).render(file.header).trim(), arguments: args };
  } catch (error) {
    return { description: file.body.trim(), arguments: args, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** A `format: lines` part: each named line a template, filled with the header's fields and the caller's. */
export class Lines {
  private constructor(
    private readonly header: Record<string, unknown>,
    private readonly templates: ReadonlyMap<string, Template>,
    /** Each line's template as written, by name. */
    readonly source: ReadonlyMap<string, string>,
    /** What of the file could not be read, each said once: those lines are left out, and the rest stands. */
    readonly problems: readonly string[] = [],
    private readonly watcher?: (name: string, fields: Fields) => void,
  ) {}

  /**
   * The lines of a part's text. A file a user edited must never end a turn: a line that is not
   * `name: text`, or whose text is no template, is left out and said in `problems`; a file whose
   * header cannot be read gives no lines at all (every answer is then given with no words), and says so.
   */
  static parse(text: string, what: string): Lines {
    const problems: string[] = [];
    let file: { header: Record<string, unknown>; body: string };
    try {
      file = splitFile(text, what);
      if (file.header.format !== "lines") throw new Error(`${what}: its header does not say format: lines`);
    } catch (error) {
      return new Lines({}, new Map(), new Map(), [error instanceof Error ? error.message : String(error)]);
    }
    const templates = new Map<string, Template>();
    const source = new Map<string, string>();
    for (const [i, raw] of file.body.split("\n").entries()) {
      if (raw.trim() === "") continue;
      const m = /^([A-Za-z0-9_-]+):[ \t]?(.*)$/.exec(raw);
      if (m === null) {
        problems.push(`${what}: body line ${i + 1} is not name: text`);
        continue;
      }
      const name = m[1] ?? "";
      if (templates.has(name)) continue;
      const said = (m[2] ?? "").trimEnd();
      try {
        templates.set(name, Template.parse(said, `${what} (${name})`));
        source.set(name, said);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    return new Lines(file.header, templates, source, problems);
  }

  /** A part with no lines: every answer is given with no words. */
  static none(): Lines {
    return new Lines({}, new Map(), new Map());
  }

  /** The line `name` filled with `fields`; undefined when the part has no such line. A line said is told to the watcher, if there is one. */
  line(name: string, fields: Fields = {}): string | undefined {
    const template = this.templates.get(name);
    if (template === undefined) return undefined;
    this.watcher?.(name, fields);
    return template.render(this.header, fields);
  }

  /** These lines, each line said through them told to `watcher` as its name and the fields it was filled with: what one call says, kept as the part's last use. */
  watching(watcher: (name: string, fields: Fields) => void): Lines {
    return new Lines(this.header, this.templates, this.source, this.problems, watcher);
  }

  /** A pattern for each line, which any filling of it matches. */
  patterns(): RegExp[] {
    return [...this.templates.values()].map((t) => t.pattern());
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  get names(): string[] {
    return [...this.templates.keys()];
  }
}
