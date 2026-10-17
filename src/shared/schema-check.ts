// A small JSON Schema reader: the 2020-12 keywords the engine's published schemas use, checking a
// value and saying what's wrong in plain words, each problem with the JSON path it sits at. Pure
// and quick, so Build's map editor checks a map on every keystroke with the same schema authors
// and tools read (`lre-map-v1.schema.json`), and a studio checks a whole world with
// `schemas/lre-world-v1.schema.json`, which refers to the map schema by its `$id`.

import { hasOwn, isRecord } from "./json";

export type JsonPath = (string | number)[];

export interface SchemaProblem {
  path: JsonPath;
  message: string;
}

/** A schema node as this reader understands it; any other keyword is ignored. */
export interface Schema {
  /** The schema document's identity, which a `$ref` in another document names it by. */
  $id?: string;
  $ref?: string;
  $defs?: Record<string, Schema>;
  title?: string;
  description?: string;
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  propertyNames?: Schema;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  anyOf?: Schema[];
}

const TYPE_WORDS: Readonly<Record<string, string>> = { object: "an object", array: "a list", string: "text", number: "a number", integer: "a whole number", boolean: "true or false", null: "null" };

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return value === null;
  }
}

/** A path as people read it: `places[1].at`, `legend["#"]`; the first key is always bare. */
export function pathText(path: JsonPath): string {
  return path.map((part, i) => (typeof part === "number" ? `[${part}]` : i === 0 ? part : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`)).join("");
}

function quoted(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

/**
 * Every problem with `value` under `root`; none when it conforms. A `$ref` resolves within the
 * document it sits in (`#/$defs/…`), or names one of `others` (or the root) by its `$id`, whole or
 * with a `#/$defs/…` fragment inside it.
 */
export function checkSchema(root: Schema, value: unknown, others: readonly Schema[] = []): SchemaProblem[] {
  const out: SchemaProblem[] = [];
  const documents = [root, ...others];
  // A node with its refs followed, and the document its own `#/$defs/…` refs resolve in. An
  // unknown target reads as the empty schema, which accepts anything.
  const resolve = (schema: Schema, base: Schema): [Schema, Schema] => {
    let s = schema;
    let doc = base;
    for (let guard = 0; s.$ref && guard < 16; guard++) {
      const hash = s.$ref.indexOf("#");
      const uri = hash < 0 ? s.$ref : s.$ref.slice(0, hash);
      const name = hash < 0 ? "" : s.$ref.slice(hash);
      if (uri !== "") {
        const target = documents.find((d) => d.$id === uri);
        if (!target) return [{}, doc];
        doc = target;
      }
      if (name === "" || name === "#") {
        s = doc;
        continue;
      }
      const def = name.startsWith("#/$defs/") ? name.slice("#/$defs/".length) : "";
      const target = doc.$defs && hasOwn(doc.$defs, def) ? doc.$defs[def] : undefined;
      if (!target) return [{}, doc];
      s = target;
    }
    return [s, doc];
  };
  // `subject` names a key ("the key "ab" "); a value's own problems need none.
  const text = (schema: Schema, value: string, path: JsonPath, subject: string, into: SchemaProblem[]): void => {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) into.push({ path, message: schema.minLength === 1 ? `${subject}can't be empty` : `${subject}should be at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && length > schema.maxLength) into.push({ path, message: schema.maxLength === 1 ? `${subject}should be one character` : `${subject}should be at most ${schema.maxLength} characters` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) into.push({ path, message: `${subject}should be ${schema.description ?? `like ${schema.pattern}`}` });
  };
  const visit = (raw: Schema, value: unknown, path: JsonPath, into: SchemaProblem[], base: Schema): void => {
    const [schema, doc] = resolve(raw, base);
    const push = (message: string, at: JsonPath = path): void => void into.push({ path: at, message });
    if (schema.type !== undefined && !hasType(value, schema.type)) return push(`should be ${TYPE_WORDS[schema.type] ?? schema.type}`);
    if (schema.enum && !schema.enum.some((e) => e === value)) return push(`should be ${schema.enum.map(quoted).join(", ").replace(/, ([^,]*)$/, " or $1")}`);
    if (schema.anyOf) {
      const tries = schema.anyOf.map((branch) => {
        const found: SchemaProblem[] = [];
        visit(branch, value, path, found, doc);
        return { branch: resolve(branch, doc)[0], found };
      });
      if (tries.some((t) => t.found.length === 0)) return;
      // An object names its branch by a tag it carries ({"kind": "book"}: a property the branch
      // allows one value of), else by its keys ({"place": …}); report that branch's own problems.
      const objects = isRecord(value) ? tries.filter((t) => t.branch.type === "object") : [];
      const tagged = objects.filter((t) => {
        const tags = Object.entries(t.branch.properties ?? {}).flatMap(([key, s]) => {
          const allowed = resolve(s, doc)[0].enum;
          return allowed?.length === 1 ? [[key, allowed[0]] as const] : [];
        });
        return tags.length > 0 && isRecord(value) && tags.every(([key, tag]) => hasOwn(value, key) && value[key] === tag);
      });
      const named = tagged.length > 0 ? tagged : objects.filter((t) => isRecord(value) && (t.branch.required ?? []).every((k) => hasOwn(value, k)));
      if (named.length === 1 && named[0]) return void into.push(...named[0].found);
      return push(`should be ${tries.map((t) => t.branch.title ?? TYPE_WORDS[t.branch.type ?? ""] ?? "something else").join(", ").replace(/, ([^,]*)$/, " or $1")}`);
    }
    if (typeof value === "string") text(schema, value, path, "", into);
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) push(`should be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) push(`should be at most ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) push(`should be more than ${schema.exclusiveMinimum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) push(schema.minItems === schema.maxItems ? `should have ${schema.minItems} items` : `should have at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
      else if (schema.maxItems !== undefined && value.length > schema.maxItems) push(schema.minItems === schema.maxItems ? `should have ${schema.maxItems} items` : `should have at most ${schema.maxItems} items`);
      if (schema.items) value.forEach((item, i) => visit(schema.items ?? {}, item, [...path, i], into, doc));
    }
    if (isRecord(value)) {
      for (const key of schema.required ?? []) if (!hasOwn(value, key)) push(`needs "${key}"`);
      for (const [key, item] of Object.entries(value)) {
        const own = schema.properties && hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        if (schema.propertyNames) text(resolve(schema.propertyNames, doc)[0], key, [...path, key], `the key ${quoted(key)} `, into);
        if (own) visit(own, item, [...path, key], into, doc);
        else if (schema.additionalProperties === false) push(`${quoted(key)} isn't a field here`, [...path, key]);
        else if (isRecord(schema.additionalProperties)) visit(schema.additionalProperties, item, [...path, key], into, doc);
      }
    }
  };
  visit(root, value, [], out, root);
  return out;
}
