// JSON Pointers (RFC 6901) for reading a world, a schema or an export file at a path, and the
// order-blind equality the diffs compare items with.

import { hasOwn, isRecord } from "../shared/json";

/** The tokens of a pointer: `""` is the whole value, `/entities/a~1b` is `["entities", "a/b"]`. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`"${pointer}" isn't a JSON Pointer: one starts with "/" ("/entities/mara"), or is "" for the whole document`);
  // ~1 before ~0, so "~01" reads as the key "~1" (RFC 6901 §4).
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** A pointer from tokens (the inverse of `parsePointer`). */
export function pointerOf(tokens: readonly string[]): string {
  return tokens.map((t) => `/${t.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

const INDEX = /^(0|[1-9][0-9]*)$/;

/** The value at a pointer's tokens, or undefined when nothing is there. */
export function getAt(doc: unknown, tokens: readonly string[]): unknown {
  let at: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(at)) at = INDEX.test(token) ? at[Number(token)] : undefined;
    else if (isRecord(at)) at = hasOwn(at, token) ? at[token] : undefined;
    else return undefined;
    if (at === undefined) return undefined;
  }
  return at;
}

/** Deep equality of JSON values, whatever the order of their keys. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}
