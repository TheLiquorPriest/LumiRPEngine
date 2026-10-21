// toMatchObject on a copy of the received value. Bun's toMatchObject writes every asymmetric matcher
// it passes (expect.any, expect.objectContaining, expect.stringContaining…) over that property of
// the received value, so whatever reads the value afterwards, later in the test or in a test sharing
// the fixture, finds the matcher, which reads as an empty object, where the data was
// (oven-sh/bun#3521, fixed by oven-sh/bun#45727). Once the Bun the tests run on has that fix, call
// toMatchObject directly again and delete this file.

import { expect } from "bun:test";

/** `expect(received).toMatchObject(expected)`, asserted on a copy so `received` stays as it was. */
export function expectMatch(received: unknown, expected: object): void {
  copyable(received, "received", new Set());
  expect(structuredClone(received)).toMatchObject(expected);
}

// toMatchObject reads inherited getters and non-enumerable properties, which structuredClone drops
// (a class instance comes back a plain object); it also throws on a function. So the copy is taken
// only of plain data (objects, arrays, Maps, Sets, Dates and primitives, shared or cyclic
// references included, which it keeps), the copy then reading exactly as the value does.
function copyable(value: unknown, path: string, seen: Set<object>): void {
  if (typeof value === "function") throw new Error(`expectMatch copies plain data only, and ${path} is a function`);
  if (value === null || typeof value !== "object" || seen.has(value) || value instanceof Date) return;
  seen.add(value);
  if (value instanceof Map || value instanceof Set) {
    for (const [key, item] of value.entries()) {
      copyable(key, `${path} key`, seen);
      copyable(item, `${path}.get(${String(key)})`, seen);
    }
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) throw new Error(`expectMatch copies plain data only, and ${path} is a ${value.constructor.name}`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`expectMatch copies plain data only, and ${path} has symbol keys`);
  for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === "length") continue;
    if (!property.enumerable || !("value" in property)) throw new Error(`expectMatch copies plain data only, and ${path}.${key} is an accessor or not enumerable`);
    copyable(property.value, `${path}.${key}`, seen);
  }
}
