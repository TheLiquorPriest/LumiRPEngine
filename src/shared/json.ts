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

/**
 * `value`, frozen through and through: a value many readers share (a ledger decoded once, the parts
 * of a state view kept from one build to the next) can't then be changed by one of them. A part
 * already frozen is taken as frozen through. Plain JSON only.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value)) deepFreeze(v);
  return value;
}

/**
 * `next` holding `prev`'s own copy of every part the two have alike (the same keys in the same
 * order, the same array positions, the same values throughout), so two versions of a document that
 * differ in a few places keep one copy of the rest: `prev` itself when they are alike throughout,
 * else `next`, its parts swapped in place (one frozen is left as it is). Both are plain JSON that
 * nothing changes afterwards: what one holds, the other may now hold too.
 */
export function shareAlike<T>(next: T, prev: T): T {
  return alikePart(next, prev) as T;
}

function alikePart(next: unknown, prev: unknown): unknown {
  if (next === prev) return prev;
  if (typeof next !== "object" || next === null || typeof prev !== "object" || prev === null || Array.isArray(next) !== Array.isArray(prev)) return next;
  const swap = !Object.isFrozen(next);
  let alike = true;
  if (Array.isArray(next) && Array.isArray(prev)) {
    if (next.length !== prev.length) alike = false;
    for (let i = 0; i < next.length; i++) {
      const part = i < prev.length ? alikePart(next[i], prev[i]) : next[i];
      if (part !== prev[i]) alike = false;
      if (swap) next[i] = part;
    }
    return alike ? prev : next;
  }
  const n = next as Record<string, unknown>;
  const p = prev as Record<string, unknown>;
  const keys = Object.keys(n);
  const before = Object.keys(p);
  if (keys.length !== before.length) alike = false;
  keys.forEach((key, i) => {
    if (!hasOwn(p, key)) {
      alike = false;
      return;
    }
    if (before[i] !== key) alike = false;
    const part = alikePart(n[key], p[key]);
    if (part !== p[key]) alike = false;
    // An own `__proto__` (parsed JSON can hold one) is compared, never assigned: that would set the prototype.
    if (swap && key !== "__proto__") n[key] = part;
  });
  return alike ? prev : next;
}
