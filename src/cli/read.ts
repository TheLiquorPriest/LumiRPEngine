// Reading a large JSON value a piece at a time. An answer holds at most ANSWER_LIMIT characters (an
// MCP client hands each one to the model whole), and a world is ten times that, so a value too big
// for one answer comes back as an outline of its keys, with counts and ids to read deeper from by
// pointer, or as its JSON text page by page from an offset.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { getAt, parsePointer, pointerOf } from "../shared/json-patch";

/** The most one answer holds. */
export const ANSWER_LIMIT = 24_000;
/** What a value's text may take in an answer, leaving room for its header and hints. */
export const BODY_LIMIT = 20_000;

export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/**
 * Where text may be cut at `end` without splitting a surrogate pair (an emoji, a rarer letter): one
 * unit earlier when `end` falls between a pair's halves. A lone half becomes U+FFFD in UTF-8, so a
 * split pair would make "the pages together are the file" untrue.
 */
export function cutAt(text: string, end: number): number {
  const code = text.charCodeAt(end - 1);
  return end > 0 && end < text.length && code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

/** `text` cut to `max` characters, saying how much was left out. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = cutAt(text, max);
  return `${text.slice(0, end)}…[${count(text.length - end, "more character")}]`;
}

/**
 * The JSON text a value is read and paged in. One-space indents keep a page readable; `compact`
 * (an export file, read to be saved) packs more into each page. The same value always gives the
 * same text, so an offset from one answer is good for the next.
 */
export function jsonText(value: unknown, compact = false): string {
  return (compact ? JSON.stringify(value) : JSON.stringify(value, null, 1)) ?? "null";
}

/** An item's own name, for outlines and listings. */
export function nameOf(item: unknown): string | null {
  if (!isRecord(item)) return null;
  for (const key of ["name", "title", "label"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (isRecord(value)) return `an object of ${count(Object.keys(value).length, "key")}`;
  if (typeof value === "string") return `text of ${count(value.length, "character")}`;
  return value === null ? "null" : typeof value;
}

/** One line of an outline: what the value is, small enough to scan, with what to read next. */
function outlineLine(label: string, value: unknown): string {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    // A collection (an object of objects keyed by id) lists its ids: they are what a pointer names.
    const collection = keys.length > 0 && keys.every((k) => isRecord(value[k]));
    const shown = keys.slice(0, 60).join(", ");
    const more = keys.length > 60 ? `, … ${keys.length - 60} more` : "";
    return `- ${label}: ${collection ? count(keys.length, "item") : `an object of ${count(keys.length, "key")}`}${keys.length > 0 ? ` (${shown}${more})` : ""}`;
  }
  if (Array.isArray(value)) return `- ${label}: a list of ${value.length} (${count(jsonText(value).length, "character")} as JSON)`;
  if (typeof value === "string") return `- ${label}: ${clip(JSON.stringify(value), 200)}`;
  return `- ${label}: ${JSON.stringify(value) ?? "null"}`;
}

function itemLine(index: number, item: unknown): string {
  const name = nameOf(item);
  const id = isRecord(item) && typeof item.id === "string" ? item.id : null;
  if (name !== null || id !== null) return `- [${index}] ${[id, name].filter((x) => x !== null).join(": ")} (${count(jsonText(item).length, "character")})`;
  return `- [${index}] ${clip(JSON.stringify(item) ?? "null", 160)}`;
}

/** The outline of a large object or list, within BODY_LIMIT. */
function outline(value: unknown, pointer: string): string {
  const lines: string[] = [];
  let used = 0;
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : isRecord(value) ? Object.entries(value) : [];
  for (const [i, [key, v]] of entries.entries()) {
    const line = Array.isArray(value) ? itemLine(i, v) : outlineLine(key, v);
    if (used + line.length > BODY_LIMIT) {
      lines.push(`(${count(entries.length - i, "more entry", "more entries")}: read ${pointer}/<${Array.isArray(value) ? "index" : "key"}>)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export type ReadResult = { ok: true; text: string } | { ok: false; text: string };

export interface ReadOptions {
  /** What is read, for the header: "the draft of Brindlemere (w_1)", "the world schema". */
  what: string;
  /** A JSON Pointer into it; "" (the default) is the whole value. */
  pointer?: string;
  /** Read the value's JSON text from this character instead of outlining it. */
  offset?: number;
  compact?: boolean;
}

/** A value at a pointer, as one answer: whole when it fits, else outlined, or a page of its JSON from `offset`. */
export function readAt(root: unknown, options: ReadOptions): ReadResult {
  const pointer = options.pointer ?? "";
  let tokens: string[];
  try {
    tokens = parsePointer(pointer);
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
  // Every value read here came from JSON (a world, a schema, an export file).
  const doc = root as JsonValue;
  const value = getAt(doc, tokens);
  const where = pointer === "" ? options.what : `${options.what} at ${pointer}`;
  if (value === undefined) {
    // Say what the deepest part that exists holds, so the next pointer can be right.
    let depth = tokens.length - 1;
    while (depth > 0 && getAt(doc, tokens.slice(0, depth)) === undefined) depth--;
    const parent = getAt(doc, tokens.slice(0, depth));
    const at = pointerOf(tokens.slice(0, depth)) || "the top";
    const keys = Array.isArray(parent) ? [`indexes 0–${parent.length - 1}`] : isRecord(parent) ? Object.keys(parent) : [];
    const holds = keys.length > 0 ? ` ${at} holds ${clip(keys.join(", "), 1500)}.` : ` ${at} is ${kindOf(parent)}.`;
    return { ok: false, text: `Nothing at ${pointer} in ${options.what}.${holds}` };
  }
  const text = jsonText(value, options.compact);
  if (options.offset !== undefined) {
    let offset = Math.floor(options.offset);
    if (!(offset >= 0) || offset >= text.length) return { ok: false, text: `offset ${options.offset} is outside ${where}: its JSON text has ${count(text.length, "character")} (offsets 0–${text.length - 1}).` };
    // An offset between a pair's halves starts at the pair: the page then holds the whole character.
    if (offset > 0 && cutAt(text, offset) < offset) offset -= 1;
    const end = cutAt(text, Math.min(text.length, offset + BODY_LIMIT));
    const next = end < text.length ? `\n\n(Continues: read on with offset ${end}.)` : "\n\n(That is the end.)";
    return { ok: true, text: `${where}, characters ${offset}–${end} of ${text.length}:\n\n${text.slice(offset, end)}${next}` };
  }
  if (text.length <= BODY_LIMIT) return { ok: true, text: `${where}, ${kindOf(value)}:\n\n${text}` };
  if (!isRecord(value) && !Array.isArray(value)) {
    const end = cutAt(text, BODY_LIMIT);
    return { ok: true, text: `${where}, ${kindOf(value)}, characters 0–${end} of ${text.length}:\n\n${text.slice(0, end)}\n\n(Continues: read on with offset ${end}.)` };
  }
  const deeper = Array.isArray(value) ? `${pointer}/0` : `${pointer}/<key>`;
  return { ok: true, text: `${where} is ${kindOf(value)}, ${count(text.length, "character")} as JSON: too big for one answer, so here is its outline. Read a part with pointer "${deeper}", or page through its JSON with offset 0.\n\n${outline(value, pointer)}` };
}
