// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/link/json.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// JSON as the link carries it. The link is its own part (DESIGN §1): both ends import it, so it keeps
// its own few helpers rather than reach into another part's.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A plain object (not null, not an array): its fields are still to be checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `key` is the object's own: never one it inherits, so `__proto__` and the like read as absent. */
export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** A deep copy of host data as JSON: functions, `undefined` and non-finite numbers dropped, as `JSON.stringify` would. */
export function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) return toJsonObject(value);
  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  const out: JsonObject = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") out[k] = toJson(v);
  return out;
}
