// JSON Pointers (RFC 6901) and JSON Patch operations (RFC 6902) over a whole world document, for
// `lre.editor patch` (DESIGN §23). A patch applies to a copy, all of its operations or none, and
// every refusal names the operation and says where and why, so the client can correct it.
// Pure, like the rest of shared/: the backend checks what the patched document may change.

import { hasOwn, isRecord } from "./json";
import type { JsonValue } from "./json";
import type { JsonPatchOp } from "./protocol";

export class PatchError extends Error {
  constructor(
    /** The failing operation's position in the patch, from 0. */
    readonly index: number,
    message: string,
    op?: { op: string; path: string },
  ) {
    super(`operation ${index + 1}${op ? ` (${op.op} ${op.path === "" ? '""' : op.path})` : ""}: ${message}`);
    this.name = "PatchError";
  }
}

/** Keys that reach an object's prototype: a document never holds one. (Built from entries, so `__proto__` is an own key here.) */
const PROTOTYPE_KEYS: Record<string, true> = Object.fromEntries(["__proto__", "constructor", "prototype"].map((key) => [key, true] as const));

export function isPrototypeKey(key: string): boolean {
  return hasOwn(PROTOTYPE_KEYS, key);
}

/** The tokens of a pointer: `""` is the whole document; `/entities/a~1b` is `["entities", "a/b"]`. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`"${pointer}" isn't a JSON Pointer (it starts with "/", or is "" for the whole draft)`);
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** A pointer from tokens (the inverse of `parsePointer`). */
export function pointerOf(tokens: readonly string[]): string {
  return tokens.map((t) => `/${t.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

function arrayIndex(token: string, length: number, forAdd: boolean): number {
  if (forAdd && token === "-") return length;
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Error(`"${token}" isn't an array index`);
  const index = Number(token);
  if (index > length || (!forAdd && index === length)) throw new Error(`index ${index} is past the end (length ${length})`);
  return index;
}

/** The value at a pointer, or undefined when nothing is there. */
export function getAt(doc: JsonValue, tokens: readonly string[]): JsonValue | undefined {
  let at: JsonValue | undefined = doc;
  for (const token of tokens) {
    if (Array.isArray(at)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      at = at[Number(token)];
    } else if (isRecord(at)) {
      at = hasOwn(at, token) ? at[token] : undefined;
    } else return undefined;
    if (at === undefined) return undefined;
  }
  return at;
}

/** The container a pointer's last token lives in, and that token; the whole document has none. */
function parentOf(doc: JsonValue, tokens: readonly string[], what: string): { parent: JsonValue; key: string } {
  if (tokens.length === 0) throw new Error(`${what} needs a path inside the draft, not the whole draft`);
  const parent = getAt(doc, tokens.slice(0, -1));
  if (parent === undefined || (!Array.isArray(parent) && !isRecord(parent))) throw new Error(`there is no object or list at ${pointerOf(tokens.slice(0, -1)) || "the top"} to hold it`);
  return { parent, key: tokens[tokens.length - 1] ?? "" };
}

/** Deep equality of JSON values, whatever the order of their keys. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

/** The leaves of a merge patch, by token path: what each says the value becomes (null: deleted). */
function mergeLeaves(patch: JsonValue, at: readonly string[] = []): { tokens: string[]; value: JsonValue }[] {
  if (!isRecord(patch)) return [{ tokens: [...at], value: patch }];
  // An empty object merges as nothing changing there, so it says nothing to check.
  return Object.entries(patch).flatMap(([key, value]) => mergeLeaves(value as JsonValue, [...at, key]));
}

/** One leaf of a merge patch that came out other than sent. */
export interface MergeAdjustment {
  pointer: string;
  sent: JsonValue;
  now: JsonValue | undefined;
}

/**
 * What a merge patch came out as where it isn't what was sent, by JSON Pointer: a value the reader
 * kept within what it takes, of the wrong kind, or a key it doesn't know (now `undefined`). Settings
 * and the MCP tools both say these.
 */
export function mergeAdjusted(patch: JsonValue, after: JsonValue): MergeAdjustment[] {
  return mergeLeaves(patch).flatMap(({ tokens, value }) => {
    const now = getAt(after, tokens);
    return (value === null ? now === undefined : jsonEqual(now, value)) ? [] : [{ pointer: pointerOf(tokens), sent: value, now }];
  });
}

function insert(doc: JsonValue, tokens: readonly string[], value: JsonValue, replace: boolean): JsonValue {
  if (tokens.length === 0) return value;
  const { parent, key } = parentOf(doc, tokens, replace ? "replace" : "add");
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, !replace);
    if (replace) parent[index] = value;
    else parent.splice(index, 0, value);
    return doc;
  }
  if (!isRecord(parent)) throw new Error("not an object");
  if (isPrototypeKey(key)) throw new Error(`"${key}" can't be a key`);
  if (replace && !hasOwn(parent, key)) throw new Error(`nothing at ${pointerOf(tokens)} to replace (use add)`);
  parent[key] = value;
  return doc;
}

function removeAt(doc: JsonValue, tokens: readonly string[]): JsonValue {
  const { parent, key } = parentOf(doc, tokens, "remove");
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(key, parent.length, false), 1);
    return doc;
  }
  if (!isRecord(parent) || !hasOwn(parent, key)) throw new Error(`nothing at ${pointerOf(tokens)} to remove`);
  delete parent[key];
  return doc;
}

/** Reads one operation from what the client sent, or says what's wrong with it. */
export function readOp(raw: unknown, index: number): JsonPatchOp {
  if (!isRecord(raw)) throw new PatchError(index, "not an object");
  const { op, path, from, value } = raw;
  if (typeof path !== "string") throw new PatchError(index, "needs a path (a JSON Pointer string)");
  if (op === "remove") return { op, path };
  if (op === "add" || op === "replace" || op === "test") {
    if (value === undefined) throw new PatchError(index, `${op} needs a value`, { op, path });
    return { op, path, value: value as JsonValue };
  }
  if (op === "move" || op === "copy") {
    if (typeof from !== "string") throw new PatchError(index, `${op} needs a from (a JSON Pointer string)`, { op, path });
    return { op, from, path };
  }
  throw new PatchError(index, `unknown op ${JSON.stringify(op)} (add, remove, replace, move, copy or test)`);
}

/** What a patch may bring in: `size`, characters of JSON across the values it adds or replaces and what it copies; `depth`, how deep the document may nest where it writes. */
export interface PatchBudget {
  size: number;
  depth: number;
}

/**
 * How deep a JSON value nests (a scalar is 0; `[]` and `{}` are 1) and about how many characters
 * its JSON takes, walked without recursion and given up as soon as either passes its cap, so a huge
 * or deeply nested value costs no more than the caps: then which cap it passed.
 */
export function measure(value: unknown, caps: PatchBudget): { size: number; depth: number } | "size" | "depth" {
  let size = 0;
  let depth = 0;
  const stack: { value: unknown; level: number }[] = [{ value, level: 0 }];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const v = top.value;
    if (Array.isArray(v) || isRecord(v)) {
      const level = top.level + 1;
      if (level > caps.depth) return "depth";
      depth = Math.max(depth, level);
      size += 2;
      for (const [key, item] of Array.isArray(v) ? v.map((x, i): [string, unknown] => [String(i), x]) : Object.entries(v)) {
        size += Array.isArray(v) ? 1 : key.length + 4;
        if (size > caps.size) return "size";
        stack.push({ value: item, level });
      }
    } else size += typeof v === "string" ? v.length + 2 : String(v).length;
    if (size > caps.size) return "size";
  }
  return { size, depth };
}

/**
 * Applies the operations to a copy of the document, all or none. With a `budget`, each value an
 * operation adds, replaces or copies is measured before it goes in: their sizes add up against
 * the budget's size (a copy can double the document, so it counts like a value sent), and none may
 * nest the document past its depth where it lands (moves included).
 */
export function applyPatch(doc: JsonValue, ops: readonly JsonPatchOp[], budget?: PatchBudget): JsonValue {
  let out = structuredClone(doc);
  let spent = 0;
  const afford = (value: JsonValue, tokens: readonly string[], counts: boolean): void => {
    if (!budget) return;
    const fits = measure(value, { size: counts ? budget.size - spent : Number.MAX_SAFE_INTEGER, depth: budget.depth - tokens.length });
    if (fits === "size") throw new Error(`the patch brings in more than ${Math.round(budget.size / (1024 * 1024))} MiB of JSON (the values it adds and what it copies count)`);
    if (fits === "depth") throw new Error(`the value would nest the world deeper than ${budget.depth} levels`);
    if (counts) spent += fits.size;
  };
  ops.forEach((op, index) => {
    try {
      const tokens = parsePointer(op.path);
      if (op.op === "add" || op.op === "replace") afford(op.value, tokens, true);
      if (op.op === "add") out = insert(out, tokens, structuredClone(op.value), false);
      else if (op.op === "replace") out = insert(out, tokens, structuredClone(op.value), true);
      else if (op.op === "remove") out = removeAt(out, tokens);
      else if (op.op === "test") {
        if (!jsonEqual(getAt(out, tokens), op.value)) throw new Error(`the value at ${op.path || "the top"} isn't the one given`);
      } else {
        const fromTokens = parsePointer(op.from);
        const value = getAt(out, fromTokens);
        if (value === undefined) throw new Error(`nothing at ${op.from} to ${op.op}`);
        afford(value, tokens, op.op === "copy");
        if (op.op === "move") {
          if (op.path.startsWith(`${op.from}/`)) throw new Error("can't move a value into itself");
          out = removeAt(out, fromTokens);
        }
        out = insert(out, tokens, structuredClone(value), false);
      }
    } catch (error) {
      throw error instanceof PatchError ? error : new PatchError(index, error instanceof Error ? error.message : String(error), op);
    }
  });
  return out;
}
