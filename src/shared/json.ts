// JSON value types and the one canonical record guard. Everything stored (world documents,
// records, journal entries) and everything sent between frontend and backend is plain JSON.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/** True for a plain object (not null, not an array). The only record guard in the codebase. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own-property lookup: a request or stored key never reaches the prototype chain. */
export function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Whether a key from outside (a request, a stored ledger, model output) may index a map: a
 * non-empty string of at most 200 characters that isn't a prototype key.
 */
export function safeKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= 200 && !UNSAFE_KEYS.has(key);
}
