import { describe, expect, test } from "bun:test";
import { encodeUtf8, hash32, hashBytes, hashJson, hashParts, hashWords } from "../../src/shared/hash";
import { thrown, withoutAmbient } from "./support";

describe("MurmurHash3 x86_128 core", () => {
  test("matches the SMHasher verification value 0xB3ECE62A", () => {
    // SMHasher: hash the keys {}, {0}, {0,1}, … (256 of them, seed 256 - length), concatenate the
    // 16-byte digests (little-endian words), hash that with seed 0; the first word is the value.
    const key = new Uint8Array(256).map((_, i) => i);
    const all = new Uint8Array(256 * 16);
    for (let len = 0; len < 256; len++) {
      hashBytes(key.subarray(0, len), 256 - len).forEach((w, j) => {
        const o = len * 16 + j * 4;
        all[o] = w & 255; all[o + 1] = (w >>> 8) & 255; all[o + 2] = (w >>> 16) & 255; all[o + 3] = (w >>> 24) & 255;
      });
    }
    expect(hashBytes(all, 0)[0]).toBe(0xb3ece62a);
  });

  test("empty input with seed 0 hashes to zero; the seed matters", () => {
    expect([...hashBytes(new Uint8Array(0), 0)]).toEqual([0, 0, 0, 0]);
    expect([...hashBytes(new Uint8Array(0), 1)]).not.toEqual([0, 0, 0, 0]);
  });

  test("every tail length 0..40 is distinguished from its neighbours", () => {
    const seen = new Set<string>();
    for (let n = 0; n <= 40; n++) seen.add(hashBytes(new Uint8Array(n).fill(7)).join(","));
    expect(seen.size).toBe(41);
  });
});

describe("hashParts", () => {
  test("length prefix: part boundaries change the hash", () => {
    expect(hashParts("ab", "c")).not.toBe(hashParts("a", "bc"));
    expect(hashParts("a", "b")).not.toBe(hashParts("ab"));
    expect(hashParts("a", "")).not.toBe(hashParts("a"));
    expect(hashParts("", "a")).not.toBe(hashParts("a"));
    expect(hashParts()).not.toBe(hashParts(""));
    expect(hashParts("", "")).not.toBe(hashParts(""));
  });

  test("types are part of the identity", () => {
    const all = [hashParts(1), hashParts("1"), hashParts(true), hashParts("true"), hashParts(null), hashParts("null"), hashParts(false), hashParts(0), hashParts("")];
    expect(new Set(all).size).toBe(all.length);
  });

  test("known answers (cross-checked against an independent implementation)", () => {
    expect(hashParts("a", "b")).toBe("f3fe5414e3973c3365968f142e7e6a41");
    expect(hashParts("ab")).toBe("62fd8b3f257ef2545f2c21375f2c2137");
    expect(hashParts("lre", "x", 1, true, null, "héllo😀")).toBe("6325b0221f293a5ff0fb0a5284656b3e");
  });

  test("32 lowercase hex digits, stable across calls, no ambient inputs", () => {
    withoutAmbient(() => {
      const h = hashParts("seed", 42, false, null);
      expect(h).toMatch(/^[0-9a-f]{32}$/);
      for (let i = 0; i < 50; i++) expect(hashParts("seed", 42, false, null)).toBe(h);
    });
  });

  test("-0 and 0 are the same part; non-finite numbers and other types are rejected", () => {
    expect(hashParts(-0)).toBe(hashParts(0));
    for (const bad of [NaN, Infinity, -Infinity]) thrown(TypeError, () => hashParts(bad));
    thrown(TypeError, () => hashParts(undefined as unknown as string));
    thrown(TypeError, () => hashParts({} as unknown as string));
    thrown(TypeError, () => hashParts(1n as unknown as string));
  });

  test("hash32 is the first 8 hex digits of hashParts; hashWords the four words", () => {
    for (const parts of [["a"], ["a", "b"], [1, 2, 3], [""]] as const) {
      expect(hash32(...parts).toString(16).padStart(8, "0")).toBe(hashParts(...parts).slice(0, 8));
      expect(hashWords(...parts).map((w) => w.toString(16).padStart(8, "0")).join("")).toBe(hashParts(...parts));
    }
  });

  test("no collisions among 20,000 sequential keys and every output bit is balanced", () => {
    const n = 20_000;
    const seen = new Set<number>();
    const ones = new Array<number>(32).fill(0);
    for (let i = 0; i < n; i++) {
      const h = hash32("key", i);
      seen.add(h);
      for (let b = 0; b < 32; b++) ones[b] += (h >>> b) & 1;
    }
    expect(seen.size).toBe(n);
    for (const c of ones) {
      expect(c).toBeGreaterThan(n * 0.47);
      expect(c).toBeLessThan(n * 0.53);
    }
  });

  test("flipping one input bit flips about half of the output bits", () => {
    let total = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const a = hashWords("avalanche", i);
      const b = hashWords("avalanche", i ^ 1);
      for (let w = 0; w < 4; w++) {
        let x = (a[w] ^ b[w]) >>> 0;
        while (x) { total += x & 1; x >>>= 1; }
      }
    }
    const mean = total / trials;
    expect(mean).toBeGreaterThan(56);
    expect(mean).toBeLessThan(72);
  });
});

describe("encodeUtf8", () => {
  test("is byte-identical to TextEncoder, including astral characters and lone surrogates", () => {
    const samples = ["", "plain ascii", "héllo wörld", "日本語", "😀 grin", "a\u{10FFFF}b", "\uD800", "x\uD800y", "\uDC00", "\uD83D", "😀\uD83D", "\uDE00😀", "\u0000\u007f\u0080\u07ff\u0800\uffff"];
    const enc = new TextEncoder();
    for (const s of samples) expect([...encodeUtf8(s)]).toEqual([...enc.encode(s)]);
  });

  test("hashing a string equals hashing its TextEncoder bytes through the same framing", () => {
    // Lone surrogates collapse to U+FFFD, so these two strings are the same text.
    expect(hashParts("\uD800")).toBe(hashParts("\uFFFD"));
  });
});

describe("hashJson", () => {
  test("object key order never matters; array order does", () => {
    expect(hashJson({ a: 1, b: [1, 2, null] })).toBe(hashJson({ b: [1, 2, null], a: 1 }));
    expect(hashJson({ a: { x: 1, y: 2 } })).toBe(hashJson({ a: { y: 2, x: 1 } }));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });

  test("known answer", () => {
    expect(hashJson({ b: [1, 2, null], a: 1 })).toBe("84dce0ab7120ee1650183ede73f4dd52");
  });

  test("types and structure stay distinct", () => {
    const all = [hashJson(1), hashJson("1"), hashJson(true), hashJson(null), hashJson([]), hashJson({}), hashJson([null]), hashJson({ a: null }), hashJson("a"), hashJson(["a"])];
    expect(new Set(all).size).toBe(all.length);
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: "1" }));
    expect(hashJson(["ab", "c"])).not.toBe(hashJson(["a", "bc"]));
  });

  test("undefined properties are omitted and undefined array entries are null, as in JSON", () => {
    expect(hashJson({ a: 1, b: undefined })).toBe(hashJson({ a: 1 }));
    expect(hashJson([1, undefined, 3])).toBe(hashJson([1, null, 3]));
  });

  test("rejects values that JSON would silently mangle", () => {
    for (const bad of [NaN, Infinity, 1n, () => 1, Symbol("s"), new Date(0), new Map(), new (class A { x = 1; })(), undefined]) {
      thrown(TypeError, () => hashJson(bad));
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    thrown(TypeError, () => hashJson(cyclic));
  });

  test("accepts null-prototype objects", () => {
    const o = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(hashJson(o)).toBe(hashJson({ a: 1 }));
  });
});
