// Reading a large JSON value a piece at a time. An answer holds at most ANSWER_LIMIT characters (an
// MCP client hands each one to the model whole), and a world is ten times that, so a value too big
// for one answer comes back as an outline of its keys, with counts and ids to read deeper from by
// pointer, page by page from an entry (`from`, `limit`), or as its JSON text page by page from an
// offset. A pointer's token on a list names an index or, keyed, one of its items by its id or name
// (`/money/danny_okafor`, `/orgs/Alder Automotive`, `/entities/pov`).

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { parsePointer, pointerOf } from "../shared/json-patch";
import { keyedItem } from "../shared/gm-parts";
import { nameOf } from "../shared/world-diff";

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
    // An item says what it is: among a world's entities, an account or a flow is told from a person only so.
    const kind = typeof value.kind === "string" && value.kind !== "" ? value.kind : null;
    const name = nameOf(value);
    if (!collection && (kind !== null || name !== null)) return `- ${label}: ${[kind, name === null ? null : clip(JSON.stringify(name), 80)].filter((x) => x !== null).join(" ")} (${count(keys.length, "key")})`;
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

/** The outline of a large object or list from its entry `from`, within BODY_LIMIT, saying where the next page starts. */
function outline(value: unknown, pointer: string, from = 0): string {
  const lines: string[] = [];
  let used = 0;
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : isRecord(value) ? Object.entries(value) : [];
  for (let i = from; i < entries.length; i++) {
    const [key, v] = entries[i] ?? ["", null];
    const line = Array.isArray(value) ? itemLine(i, v) : outlineLine(key, v);
    if (used + line.length > BODY_LIMIT) {
      lines.push(`(${count(entries.length - i, "more entry", "more entries")}: read on with from ${i}, or read one with pointer ${pointer}/<${Array.isArray(value) ? "index, id or name" : "key"}>)`);
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
  /** Read a list's or object's entries from this one (0 is the first), whole when they fit, else outlined. */
  from?: number;
  /** With `from` (0 by default), at most this many entries. */
  limit?: number;
  compact?: boolean;
}

/** An item's key in a list, for a keyed token: its `id`, a party's money by `party`, an organization's page by its `page.id`. */
export function itemKey(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item.id === "string") return item.id;
  if (typeof item.party === "string") return item.party;
  return isRecord(item.page) && typeof item.page.id === "string" ? item.page.id : null;
}

/**
 * Where `tokens` lead in `doc`: a token on a list is an index, else, keyed, the item it names by key
 * or name (`keyedItem`). The tokens that resolved, as they read (a keyed token as its index), and
 * the value there, or what the first that didn't named; refused when a name names several items.
 */
function resolve(doc: JsonValue, tokens: readonly string[]): { at: string[]; value: JsonValue | undefined; parent: JsonValue } | { refused: string } {
  let value: JsonValue = doc;
  const at: string[] = [];
  for (const token of tokens) {
    let next: JsonValue | undefined;
    if (Array.isArray(value)) {
      if (/^(0|[1-9]\d*)$/.test(token)) next = value[Number(token)];
      else {
        const found = keyedItem(value, token, itemKey, (item) => nameOf(item) ?? (isRecord(item) ? nameOf(item.page) : null));
        if (found && "ambiguous" in found) return { refused: `${pointerOf([...at, token])} names ${found.ambiguous.length} items: ${found.ambiguous.join(", ")}. Read one by its id.` };
        if (found) {
          at.push(String(found.index));
          value = found.item;
          continue;
        }
      }
    } else if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, token)) next = value[token];
    if (next === undefined) return { at, value: undefined, parent: value };
    at.push(token);
    value = next;
  }
  return { at, value, parent: value };
}

/**
 * A value at a pointer, as one answer: whole when it fits, else outlined; entries of a list or an
 * object from `from` (`limit` of them at most); or a page of its JSON from `offset`.
 */
export function readAt(root: unknown, options: ReadOptions): ReadResult {
  const pointer = options.pointer ?? "";
  let tokens: string[];
  try {
    tokens = parsePointer(pointer);
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
  // Every value read here came from JSON (a world, a schema, an export file).
  const found = resolve(root as JsonValue, tokens);
  if ("refused" in found) return { ok: false, text: found.refused };
  const { value, at, parent } = found;
  // A keyed token reads as the index it named, so the next pointer can be either.
  const indexed = pointerOf(at);
  const shown = indexed === pointer || value === undefined ? pointer : `${pointer} (${indexed})`;
  const where = pointer === "" ? options.what : `${options.what} at ${shown}`;
  if (value === undefined) {
    // Say what the deepest part that exists holds, so the next pointer can be right.
    const there = pointerOf(at) || "the top";
    const keys = Array.isArray(parent) ? [`indexes 0–${parent.length - 1}${parent.some((item) => itemKey(item) !== null) ? ", or an item's id or name" : ""}`] : isRecord(parent) ? Object.keys(parent) : [];
    const holds = keys.length > 0 ? ` ${there} holds ${clip(keys.join(", "), 1500)}.` : ` ${there} is ${kindOf(parent)}.`;
    return { ok: false, text: `Nothing at ${pointer} in ${options.what}.${holds}` };
  }
  if (options.from !== undefined || options.limit !== undefined) return entriesOf(value, where, indexed, options.from ?? 0, options.limit);
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
  const deeper = Array.isArray(value) ? `${indexed}/0` : `${indexed}/<key>`;
  return { ok: true, text: `${where} is ${kindOf(value)}, ${count(text.length, "character")} as JSON: too big for one answer, so here is its outline. Read a part with pointer "${deeper}", page through its entries with from, or through its JSON with offset 0.\n\n${outline(value, indexed)}` };
}

/** A page of a list's or object's entries from `from`: whole when they fit, else outlined, saying where the next page starts. */
function entriesOf(value: JsonValue, where: string, pointer: string, from: number, limit: number | undefined): ReadResult {
  if (!Array.isArray(value) && !isRecord(value)) return { ok: false, text: `from and limit page a list or an object, and ${where} is ${kindOf(value)}: read it with offset instead.` };
  const entries = Array.isArray(value) ? value.map((v, i): [string, JsonValue] => [String(i), v]) : Object.entries(value);
  const start = Math.floor(from);
  if (!(start >= 0) || (start >= entries.length && entries.length > 0)) return { ok: false, text: `from ${from} is outside ${where}: it has ${count(entries.length, "entry", "entries")} (from 0–${Math.max(0, entries.length - 1)}).` };
  const end = Math.min(entries.length, limit === undefined ? entries.length : start + Math.max(1, Math.floor(limit)));
  const page = Array.isArray(value) ? value.slice(start, end) : Object.fromEntries(entries.slice(start, end));
  const text = jsonText(page);
  const next = (at: number): string => (at < entries.length ? `(Continues: read on with from ${at}.)` : "(That is the end.)");
  if (text.length <= BODY_LIMIT) return { ok: true, text: `${where}, entries ${start}–${Math.max(start, end - 1)} of ${entries.length}${Array.isArray(value) ? " (by index)" : ""}:\n\n${text}\n\n${next(end)}` };
  // Too big whole: an outline of the entries from `from`, which says where it stopped.
  return { ok: true, text: `${where}, entries from ${start} of ${entries.length}, too big for one answer as JSON, so here is their outline:\n\n${outline(Array.isArray(value) ? value.slice(0, end) : Object.fromEntries(entries.slice(0, end)), pointer, start)}` };
}
