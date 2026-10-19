// A patch's budget (src/shared/json-patch.ts): what it adds, replaces and copies is measured before
// it goes in, so copies that double the document stop at the size cap, and nothing lands past the
// depth cap; without a budget a patch applies as the RFC says.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/shared/json";
import { applyPatch, measure, PatchError } from "../../src/shared/json-patch";
import type { JsonPatchOp } from "../../src/shared/protocol";

function refusal(doc: JsonValue, ops: JsonPatchOp[], budget: { size: number; depth: number }): PatchError {
  try {
    applyPatch(doc, ops, budget);
  } catch (error) {
    if (error instanceof PatchError) return error;
    throw error;
  }
  throw new Error("the patch applied");
}

describe("measure", () => {
  test("counts depth from the value's own containers and about its JSON length, and gives up at either cap", () => {
    expect(measure(1, { size: 100, depth: 5 })).toEqual({ size: 1, depth: 0 });
    const sample = { a: [1, "xy"], b: { c: null } };
    const measured = measure(sample, { size: 100, depth: 5 });
    // The size is an estimate that never falls short of the JSON's length, so nothing slips in under the cap.
    expect(typeof measured === "object" && [measured.depth, measured.size >= JSON.stringify(sample).length]).toEqual([2, true]);
    expect(measure([[[]]], { size: 100, depth: 2 })).toBe("depth");
    expect(measure({ text: "x".repeat(50) }, { size: 40, depth: 5 })).toBe("size");
    // A wide value stops as soon as it passes the size cap, not after walking all of it.
    expect(measure(Array.from({ length: 100_000 }, () => 0), { size: 1_000, depth: 5 })).toBe("size");
  });
});

describe("applyPatch's budget", () => {
  const budget = { size: 1_000, depth: 6 };

  test("copies count against the size, so doubling the document stops, all or none", () => {
    const doc: JsonValue = { a: { text: "x".repeat(100) } };
    const ops: JsonPatchOp[] = Array.from({ length: 12 }, (_, i) => ({ op: "copy", from: "", path: `/c${i}` }));
    const error = refusal(doc, ops, budget);
    expect(error.message).toMatch(/^operation \d+ \(copy \/c\d+\): the patch brings in more than 0 MiB of JSON/);
    expect(error.index).toBeLessThan(5);
    expect(doc).toEqual({ a: { text: "x".repeat(100) } });
    // Without a budget the same patch applies.
    expect(Object.keys(applyPatch(doc, ops.slice(0, 3)) as Record<string, unknown>)).toEqual(["a", "c0", "c1", "c2"]);
  });

  test("added and replaced values count; moves and tests don't", () => {
    const doc: JsonValue = { a: "x".repeat(600), b: {} };
    expect(refusal(doc, [{ op: "add", path: "/c", value: "y".repeat(600) }, { op: "replace", path: "/a", value: "z".repeat(600) }], budget).index).toBe(1);
    expect(applyPatch(doc, [{ op: "move", from: "/a", path: "/b/a" }, { op: "test", path: "/b/a", value: "x".repeat(600) }, { op: "add", path: "/c", value: "y".repeat(600) }], budget)).toEqual({ b: { a: "x".repeat(600) }, c: "y".repeat(600) });
  });

  test("nothing lands deeper than the depth: where it lands counts, for moves and copies too", () => {
    const doc: JsonValue = { a: { b: { c: {} } }, d: [[1]] };
    expect(refusal(doc, [{ op: "add", path: "/a/b/c/x", value: [[[1]]] }], budget).message).toBe("operation 1 (add /a/b/c/x): the value would nest the world deeper than 6 levels");
    expect(refusal(doc, [{ op: "copy", from: "/d", path: "/a/b/c/x" }, { op: "copy", from: "/a", path: "/a/b/c/y" }], budget).index).toBe(1);
    expect(refusal(doc, [{ op: "move", from: "/a", path: "/d/0/a" }, { op: "move", from: "/d", path: "/x/0" }], { size: 1_000, depth: 4 }).index).toBe(0);
    expect(applyPatch(doc, [{ op: "add", path: "/a/b/c/x", value: [[1]] }], budget)).toEqual({ a: { b: { c: { x: [[1]] } } }, d: [[1]] });
  });
});
