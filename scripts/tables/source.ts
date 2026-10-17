// Reading `data-src` records: path selection for a mapping's `from`, and a field reader that
// tracks which source fields a row builder consumed, so a field nobody maps fails the build
// instead of being dropped silently.

import { isRecord } from "../../src/shared/json";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { Report, Rule } from "./issues";

export interface SourceNode {
  /** The property name for keyed entries and plain steps; the array index for items. */
  key: string;
  /** `item`: array element. `entry`: member of an object. `value`: a plain property. */
  kind: "item" | "entry" | "value";
  value: JsonValue;
  /** The fan-out nodes enclosing this one, outermost first (the category of a catalog item). */
  parents: SourceNode[];
}

/** `name`, `name[]`, `name{}`, `name{a,b}` or a bare `{a,b}` / `[]` applied to the current value. */
const TOKEN = /^([A-Za-z_]\w*)?(\[\]|\{([\w,]*)\})?$/;

function enclosing(node: SourceNode): SourceNode[] {
  return node.kind === "value" ? node.parents : [...node.parents, node];
}

/**
 * Resolves a mapping's `from`. Segments are separated by `.`:
 * - `name` descends into a property;
 * - `name[]` iterates an array (items);
 * - `name{}` iterates all members of an object, `name{a,b}` only the listed ones, in that order (entries);
 * - alternatives joined with `|` are concatenated in order.
 */
export function select(root: JsonValue, path: string, report: Report): SourceNode[] {
  const out: SourceNode[] = [];
  for (const alternative of path.split("|")) out.push(...walk(root, alternative, report));
  return out;
}

function walk(root: JsonValue, path: string, report: Report): SourceNode[] {
  let frontier: SourceNode[] = [{ key: "", kind: "value", value: root, parents: [] }];
  for (const token of path.split(".")) {
    const match = TOKEN.exec(token);
    if (!match || (!match[1] && !match[2])) {
      report("source", `bad path segment "${token}" in "${path}"`);
      return [];
    }
    const [, name, fan, listed] = match;
    const next: SourceNode[] = [];
    for (const node of frontier) {
      const outer = enclosing(node);
      let value = node.value;
      let key = node.key;
      if (name) {
        if (!isRecord(value) || !Object.hasOwn(value, name)) {
          report("source", `"${path}": no property "${name}"`);
          return [];
        }
        value = value[name];
        key = name;
      }
      if (!fan) {
        next.push({ key, kind: "value", value, parents: outer });
      } else if (fan === "[]") {
        if (!Array.isArray(value)) {
          report("source", `"${path}": "${token}" is not an array`);
          return [];
        }
        value.forEach((item, index) => next.push({ key: String(index), kind: "item", value: item, parents: outer }));
      } else {
        if (!isRecord(value)) {
          report("source", `"${path}": "${token}" is not an object`);
          return [];
        }
        for (const entry of listed ? listed.split(",") : Object.keys(value)) {
          if (!Object.hasOwn(value, entry)) {
            report("source", `"${path}": no member "${entry}"`);
            return [];
          }
          next.push({ key: entry, kind: "entry", value: value[entry], parents: outer });
        }
      }
    }
    frontier = next;
  }
  return frontier;
}

/** A source record that remembers which fields were read. */
export class Fields {
  private readonly used = new Set<string>();
  private readonly children: { key: string; fields: Fields }[] = [];
  /** The row being built; set by the build once the id is known. */
  at: string | undefined;

  constructor(
    private readonly data: JsonObject,
    private readonly sink: Report,
  ) {}

  /** Reads a field and marks it consumed. Absent fields are `undefined`. */
  take(key: string): JsonValue | undefined {
    this.used.add(key);
    return Object.hasOwn(this.data, key) ? this.data[key] : undefined;
  }

  /** Reads a nested object whose own fields are tracked too. */
  sub(key: string): Fields {
    const value = this.take(key);
    if (!isRecord(value)) this.fail("type", `"${key}" must be an object`);
    const fields = new Fields(isRecord(value) ? value : {}, this.sink);
    this.children.push({ key, fields });
    return fields;
  }

  /** Every field not yet consumed, as one object; they count as consumed afterwards. */
  rest(): JsonObject {
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(this.data)) {
      if (!this.used.has(key)) out[key] = value;
    }
    for (const key of Object.keys(out)) this.used.add(key);
    return out;
  }

  /** Dotted paths of fields never consumed, including inside `sub` objects. */
  leftovers(prefix = ""): string[] {
    const out = Object.keys(this.data)
      .filter((key) => !this.used.has(key))
      .map((key) => prefix + key);
    for (const child of this.children) out.push(...child.fields.leftovers(`${prefix}${child.key}.`));
    return out;
  }

  fail(rule: Rule, message: string, column?: string): void {
    this.sink(rule, message, { row: this.at, column });
  }
}
