// RFC 6901 pointers and RFC 6902 patches (src/shared/json-patch.ts): the operations as the RFC
// gives them, every refusal naming its operation, and a patch that fails changing nothing.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/shared/json";
import { applyPatch, getAt, isPrototypeKey, jsonEqual, parsePointer, PatchError, pointerOf, readOp } from "../../src/shared/json-patch";
import type { JsonPatchOp } from "../../src/shared/protocol";

const patch = (doc: JsonValue, ops: JsonPatchOp[]): JsonValue => applyPatch(doc, ops);

function refusal(doc: JsonValue, ops: JsonPatchOp[]): PatchError {
  try {
    applyPatch(doc, ops);
  } catch (error) {
    if (error instanceof PatchError) return error;
    throw error;
  }
  throw new Error("the patch applied");
}

describe("JSON Pointer", () => {
  test("tokens unescape ~1 to / and ~0 to ~, in that order; the empty pointer is the whole document", () => {
    expect(parsePointer("")).toEqual([]);
    expect(parsePointer("/a~1b/m~0n/~01")).toEqual(["a/b", "m~n", "~1"]);
    expect(parsePointer("/")).toEqual([""]);
    expect(pointerOf(["a/b", "m~n", "~1"])).toBe("/a~1b/m~0n/~01");
    expect(() => parsePointer("a/b")).toThrow("isn't a JSON Pointer");
  });

  test("the RFC 6901 examples resolve, and nothing resolves through a prototype or past an end", () => {
    const doc: JsonValue = { foo: ["bar", "baz"], "": 0, "a/b": 1, "c%d": 2, "e^f": 3, "g|h": 4, "i\\j": 5, 'k"l': 6, " ": 7, "m~n": 8 };
    expect(getAt(doc, parsePointer(""))).toEqual(doc);
    expect(getAt(doc, parsePointer("/foo"))).toEqual(["bar", "baz"]);
    expect(getAt(doc, parsePointer("/foo/0"))).toBe("bar");
    expect(getAt(doc, parsePointer("/"))).toBe(0);
    expect(getAt(doc, parsePointer("/a~1b"))).toBe(1);
    expect(getAt(doc, parsePointer("/m~0n"))).toBe(8);
    expect(getAt(doc, parsePointer("/ "))).toBe(7);
    expect(getAt(doc, parsePointer("/foo/2"))).toBeUndefined();
    expect(getAt(doc, parsePointer("/foo/01"))).toBeUndefined();
    expect(getAt(doc, parsePointer("/toString"))).toBeUndefined();
    expect(getAt(doc, parsePointer("/__proto__"))).toBeUndefined();
  });
});

describe("JSON Patch", () => {
  test("add puts a member, inserts into a list at an index or at its end (-), and replaces the whole document at the top", () => {
    expect(patch({ a: 1 }, [{ op: "add", path: "/b", value: { c: [1] } }])).toEqual({ a: 1, b: { c: [1] } });
    expect(patch({ a: 1 }, [{ op: "add", path: "/a", value: 2 }])).toEqual({ a: 2 });
    expect(patch({ l: ["x", "z"] }, [{ op: "add", path: "/l/1", value: "y" }])).toEqual({ l: ["x", "y", "z"] });
    expect(patch({ l: ["x"] }, [{ op: "add", path: "/l/-", value: "y" }])).toEqual({ l: ["x", "y"] });
    expect(patch({ l: ["x"] }, [{ op: "add", path: "/l/1", value: "y" }])).toEqual({ l: ["x", "y"] });
    expect(patch({ a: 1 }, [{ op: "add", path: "", value: [1, 2] }])).toEqual([1, 2]);
  });

  test("remove, replace, move and copy follow the RFC", () => {
    expect(patch({ a: 1, b: 2 }, [{ op: "remove", path: "/a" }])).toEqual({ b: 2 });
    expect(patch({ l: [1, 2, 3] }, [{ op: "remove", path: "/l/1" }])).toEqual({ l: [1, 3] });
    expect(patch({ a: { b: 1 } }, [{ op: "replace", path: "/a/b", value: null }])).toEqual({ a: { b: null } });
    expect(patch({ a: { b: 1 }, c: {} }, [{ op: "move", from: "/a/b", path: "/c/d" }])).toEqual({ a: {}, c: { d: 1 } });
    expect(patch({ l: ["a", "b", "c"] }, [{ op: "move", from: "/l/0", path: "/l/-" }])).toEqual({ l: ["b", "c", "a"] });
    expect(patch({ a: 1 }, [{ op: "move", from: "/a", path: "/a" }])).toEqual({ a: 1 });
    const copied = patch({ a: { b: [1] } }, [{ op: "copy", from: "/a", path: "/c" }]);
    expect(copied).toEqual({ a: { b: [1] }, c: { b: [1] } });
    // A copy is its own value: changing it later leaves the source alone.
    expect(patch(copied, [{ op: "add", path: "/c/b/-", value: 2 }])).toEqual({ a: { b: [1] }, c: { b: [1, 2] } });
  });

  test("test compares deeply, ignoring key order and telling 1 from \"1\"", () => {
    expect(patch({ a: { x: 1, y: [2, { z: null }] } }, [{ op: "test", path: "/a", value: { y: [2, { z: null }], x: 1 } }])).toEqual({ a: { x: 1, y: [2, { z: null }] } });
    expect(refusal({ a: 1 }, [{ op: "test", path: "/a", value: "1" }]).message).toBe('operation 1 (test /a): the value at /a isn\'t the one given');
    expect(refusal({ a: [1, 2] }, [{ op: "test", path: "/a", value: [2, 1] }]).index).toBe(0);
    expect(refusal({}, [{ op: "test", path: "/missing", value: null }]).index).toBe(0);
  });

  test("each RFC refusal is an error naming the operation, its op and its path", () => {
    const doc: JsonValue = { a: { b: 1 }, l: [1, 2], s: "text" };
    const cases: [JsonPatchOp, string][] = [
      [{ op: "replace", path: "/missing", value: 1 }, "operation 2 (replace /missing): nothing at /missing to replace (use add)"],
      [{ op: "remove", path: "/missing" }, "operation 2 (remove /missing): nothing at /missing to remove"],
      [{ op: "remove", path: "" }, 'operation 2 (remove ""): remove needs a path inside the draft, not the whole draft'],
      [{ op: "add", path: "/x/y", value: 1 }, "operation 2 (add /x/y): there is no object or list at /x to hold it"],
      [{ op: "add", path: "/s/0", value: 1 }, "operation 2 (add /s/0): there is no object or list at /s to hold it"],
      [{ op: "add", path: "/l/3", value: 1 }, "operation 2 (add /l/3): index 3 is past the end (length 2)"],
      [{ op: "add", path: "/l/01", value: 1 }, 'operation 2 (add /l/01): "01" isn\'t an array index'],
      [{ op: "replace", path: "/l/-", value: 1 }, 'operation 2 (replace /l/-): "-" isn\'t an array index'],
      [{ op: "remove", path: "/l/2" }, "operation 2 (remove /l/2): index 2 is past the end (length 2)"],
      [{ op: "move", from: "/a", path: "/a/b/c" }, "operation 2 (move /a/b/c): can't move a value into itself"],
      [{ op: "copy", from: "/nothing", path: "/c" }, "operation 2 (copy /c): nothing at /nothing to copy"],
      [{ op: "add", path: "/a/__proto__", value: { polluted: true } }, 'operation 2 (add /a/__proto__): "__proto__" can\'t be a key'],
      [{ op: "add", path: "/a/constructor", value: 1 }, 'operation 2 (add /a/constructor): "constructor" can\'t be a key'],
      [{ op: "add", path: "no-slash", value: 1 }, 'operation 2 (add no-slash): "no-slash" isn\'t a JSON Pointer (it starts with "/", or is "" for the whole draft)'],
    ];
    for (const [op, message] of cases) {
      const error = refusal(doc, [{ op: "test", path: "/s", value: "text" }, op]);
      expect({ op, message: error.message, index: error.index }).toEqual({ op, message, index: 1 });
    }
    const fresh: Record<string, unknown> = {};
    expect(fresh.polluted).toBeUndefined();
  });

  test("a patch applies to a copy, all of its operations or none", () => {
    const doc: JsonValue = { a: 1, l: [1] };
    const before = JSON.stringify(doc);
    const error = refusal(doc, [
      { op: "add", path: "/b", value: 2 },
      { op: "remove", path: "/l/0" },
      { op: "test", path: "/a", value: 2 },
    ]);
    expect(error.index).toBe(2);
    expect(JSON.stringify(doc)).toBe(before);
    const added = { deep: { n: 1 } };
    const out = patch(doc, [{ op: "add", path: "/v", value: added }]);
    expect(out).toEqual({ a: 1, l: [1], v: { deep: { n: 1 } } });
    expect(JSON.stringify(doc)).toBe(before);
    // The value went in as a copy: changing the caller's object later changes nothing in the result.
    added.deep.n = 9;
    expect(getAt(out, ["v", "deep", "n"])).toBe(1);
  });

  test("an operation read from outside is checked for its op, path, value and from", () => {
    expect(readOp({ op: "add", path: "/a", value: 0 }, 0)).toEqual({ op: "add", path: "/a", value: 0 });
    expect(readOp({ op: "move", from: "/a", path: "/b", extra: 1 }, 0)).toEqual({ op: "move", from: "/a", path: "/b" });
    expect(readOp({ op: "add", path: "/a", value: null }, 0)).toEqual({ op: "add", path: "/a", value: null });
    const message = (raw: unknown): string => {
      try {
        readOp(raw, 4);
      } catch (error) {
        return error instanceof PatchError ? error.message : `not a PatchError: ${String(error)}`;
      }
      return "read";
    };
    expect(message("add")).toBe("operation 5: not an object");
    expect(message({ op: "add", value: 1 })).toBe("operation 5: needs a path (a JSON Pointer string)");
    expect(message({ op: "replace", path: "/a" })).toBe("operation 5 (replace /a): replace needs a value");
    expect(message({ op: "copy", path: "/a" })).toBe("operation 5 (copy /a): copy needs a from (a JSON Pointer string)");
    expect(message({ op: "merge", path: "/a" })).toBe('operation 5: unknown op "merge" (add, remove, replace, move, copy or test)');
  });

  test("equality ignores key order, and prototype keys are told apart from ordinary ones", () => {
    expect(jsonEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(["__proto__", "constructor", "prototype"].every(isPrototypeKey)).toBe(true);
    expect(["toString", "proto", "", "__proto"].some(isPrototypeKey)).toBe(false);
  });
});
