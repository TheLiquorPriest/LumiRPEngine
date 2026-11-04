// `shareAlike` (shared/json.ts): a document read again holds the earlier one's own copy of every
// part the two have alike, and its own of the rest, its values unchanged.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/shared/json";
import { shareAlike } from "../../src/shared/json";

const copy = (v: JsonValue): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

describe("shareAlike", () => {
  test("a document alike throughout is the earlier one", () => {
    const prev: JsonValue = { a: { b: [1, 2, { c: "x" }] }, d: null };
    expect(shareAlike(copy(prev), prev)).toBe(prev);
  });

  test("a document that differs in one place shares every other part, and keeps its own values", () => {
    const prev = { entities: { kept: { name: "Kept", tags: ["a"] }, changed: { name: "Old" } }, places: { p: { name: "P" } } };
    const next = { entities: { kept: { name: "Kept", tags: ["a"] }, changed: { name: "New" } }, places: { p: { name: "P" } } };
    const out = shareAlike(next, prev);
    expect(out).toBe(next);
    expect(out.places).toBe(prev.places);
    expect(out.entities.kept).toBe(prev.entities.kept);
    expect(out.entities).not.toBe(prev.entities);
    expect(out.entities.changed).not.toBe(prev.entities.changed);
    expect(out).toEqual({ entities: { kept: { name: "Kept", tags: ["a"] }, changed: { name: "New" } }, places: { p: { name: "P" } } });
    expect(prev.entities.changed.name).toBe("Old");
  });

  test("keys in another order, a longer array and another kind of value are not alike, though their alike parts are shared", () => {
    const prev = { order: { a: 1, b: 2 }, list: [{ x: 1 }, { y: 2 }], kind: [1] as JsonValue };
    const next = { order: { b: 2, a: 1 }, list: [{ x: 1 }, { y: 2 }, { z: 3 }], kind: { 0: 1 } as JsonValue };
    const out = shareAlike(next, prev);
    expect(out.order).not.toBe(prev.order);
    expect(Object.keys(out.order)).toEqual(["b", "a"]);
    expect(out.list).not.toBe(prev.list);
    expect(out.list[0]).toBe(prev.list[0]);
    expect(out.kind).toEqual({ 0: 1 });
  });

  test("a frozen part is left as it is, and an own __proto__ is never assigned", () => {
    const prev = JSON.parse('{"frozen":{"p":{"n":1}},"__proto__":{"q":1},"other":1}') as Record<string, JsonValue>;
    const next = JSON.parse('{"frozen":{"p":{"n":1}},"__proto__":{"q":1},"other":2}') as Record<string, JsonValue>;
    Object.freeze(next.frozen);
    const out = shareAlike(next, prev);
    expect(out.frozen).toBe(prev.frozen);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(out.other).toBe(2);
  });
});
