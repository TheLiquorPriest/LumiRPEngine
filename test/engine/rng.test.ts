import { describe, expect, test } from "bun:test";
import { createRng, type Rng } from "../../src/engine/rng";
import { chiSquareUniform, thrown, withoutAmbient } from "./support";

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());
const U32 = 2 ** 32 - 1;

describe("reproducibility", () => {
  test("the same seed gives the same sequence, across instances and across method mixes", () => {
    const a = createRng("campaign-7");
    const b = createRng("campaign-7");
    expect(take(a, 500)).toEqual(take(b, 500));
    const c = createRng("campaign-7");
    const d = createRng("campaign-7");
    for (let i = 0; i < 200; i++) {
      expect(c.int(1, 20)).toBe(d.int(1, 20));
      expect(c.pick(["x", "y", "z"])).toBe(d.pick(["x", "y", "z"]));
      expect(c.weighted([{ value: 1, weight: 1 }, { value: 2, weight: 3 }])).toBe(d.weighted([{ value: 1, weight: 1 }, { value: 2, weight: 3 }]));
    }
  });

  test("known answers (cross-checked against an independent sfc32 + murmur3 implementation)", () => {
    const r = createRng("seed-1");
    expect([r.int(0, U32), r.int(0, U32), r.int(0, U32), r.int(0, U32)]).toEqual([3131672035, 2350162029, 4171871404, 3821969843]);
    const s = createRng("lre:world:42");
    expect([s.int(0, U32), s.int(0, U32), s.int(0, U32), s.int(0, U32)]).toEqual([1426093003, 281814806, 1983120803, 300674029]);
    expect(createRng("seed-1").next()).toBe(0.729149219000263);
  });

  test("different seeds give different sequences, including seeds that differ in one character", () => {
    const heads = new Set<string>();
    for (const seed of ["", "a", "b", "A", "seed", "seed ", "seed-1", "seed-2", "1", "2"]) heads.add(take(createRng(seed), 4).join(","));
    expect(heads.size).toBe(10);
  });

  test("touches neither Math.random nor the clock", () => {
    withoutAmbient(() => {
      const r = createRng("quiet");
      r.next(); r.int(1, 6); r.pick([1, 2, 3]); r.weighted([{ value: "a", weight: 1 }]); r.fork("child").next();
    });
  });

  test("exposes its seed and requires a string", () => {
    expect(createRng("s").seed).toBe("s");
    thrown(TypeError, () => createRng(undefined as unknown as string));
    thrown(TypeError, () => createRng(5 as unknown as string));
  });
});

describe("next()", () => {
  test("is in [0, 1) and uses the full double range, not 32-bit steps", () => {
    const xs = take(createRng("range"), 20_000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    // a 32-bit generator would give multiples of 2^-32 only
    expect(xs.filter((x) => (x * 2 ** 32) % 1 !== 0).length).toBeGreaterThan(19_000);
  });

  test("is uniform (chi-square over 16 buckets) and has mean 1/2", () => {
    const rng = createRng("uniform-check");
    const counts = new Array<number>(16).fill(0);
    let sum = 0;
    const n = 160_000;
    for (let i = 0; i < n; i++) { const x = rng.next(); counts[Math.floor(x * 16)]++; sum += x; }
    expect(chiSquareUniform(counts)).toBeLessThan(40); // 15 d.f.; p = 0.0004
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
  });

  test("successive draws are uncorrelated", () => {
    const xs = take(createRng("serial"), 40_001);
    expect(Math.abs(pearson(xs.slice(0, -1), xs.slice(1)))).toBeLessThan(0.03);
  });
});

describe("int()", () => {
  test("is inclusive at both ends and never leaves the range", () => {
    const rng = createRng("bounds");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < 2000; i++) { const v = rng.int(-3, 3); expect(v).toBeGreaterThanOrEqual(-3); expect(v).toBeLessThanOrEqual(3); }
    expect(rng.int(5, 5)).toBe(5);
    expect(rng.int(-(2 ** 31), 2 ** 31 - 1)).toBeGreaterThanOrEqual(-(2 ** 31));
  });

  test("a die is uniform (chi-square)", () => {
    const rng = createRng("die");
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[rng.int(1, 6) - 1]++;
    expect(chiSquareUniform(counts)).toBeLessThan(25); // 5 d.f.; p = 0.0001
  });

  test("has no modulo bias on a range that does not divide 2^32", () => {
    // range 3e9: with `x % range`, values below 2^32 - 3e9 = 1,294,967,296 occur twice as often.
    // Unbiased share of draws below that value: 1,294,967,296 / 3e9 = 0.4317 (biased: 0.6030).
    const rng = createRng("bias");
    let low = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (rng.int(0, 2_999_999_999) < 1_294_967_296) low++;
    expect(low / n).toBeGreaterThan(0.41);
    expect(low / n).toBeLessThan(0.45);
  });

  test("rejects bad bounds", () => {
    const rng = createRng("bad");
    thrown(RangeError, () => rng.int(3, 2));
    thrown(RangeError, () => rng.int(0.5, 2));
    thrown(RangeError, () => rng.int(0, 1.5));
    thrown(RangeError, () => rng.int(NaN, 2));
    thrown(RangeError, () => rng.int(0, Infinity));
    thrown(RangeError, () => rng.int(0, 2 ** 32)); // 2^32 + 1 values
    thrown(RangeError, () => rng.int(0, 2 ** 53));
    expect(rng.int(0, 2 ** 32 - 1)).toBeGreaterThanOrEqual(0); // exactly 2^32 values is allowed
  });
});

describe("pick()", () => {
  test("chooses uniformly and only from the array", () => {
    const rng = createRng("pick");
    const items = ["a", "b", "c", "d"];
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) counts[items.indexOf(rng.pick(items))]++;
    expect(chiSquareUniform(counts)).toBeLessThan(21); // 3 d.f.; p = 0.0001
    expect(rng.pick(["only"])).toBe("only");
    thrown(RangeError, () => rng.pick([]));
  });
});

describe("weighted()", () => {
  test("frequencies follow the weights", () => {
    const rng = createRng("weights");
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 100_000; i++) counts[rng.weighted([{ value: "a", weight: 1 }, { value: "b", weight: 2 }, { value: "c", weight: 7 }])]++;
    expect(Math.abs(counts.a - 10_000)).toBeLessThan(700);
    expect(Math.abs(counts.b - 20_000)).toBeLessThan(800);
    expect(Math.abs(counts.c - 70_000)).toBeLessThan(900);
  });

  test("zero-weight items are never chosen, wherever they sit", () => {
    const rng = createRng("zero");
    const items = [{ value: "z1", weight: 0 }, { value: "x", weight: 1 }, { value: "z2", weight: 0 }, { value: "y", weight: 1 }, { value: "z3", weight: 0 }];
    for (let i = 0; i < 20_000; i++) expect(["x", "y"]).toContain(rng.weighted(items));
  });

  test("a single positive weight is always chosen", () => {
    const rng = createRng("single");
    for (let i = 0; i < 100; i++) expect(rng.weighted([{ value: 0, weight: 0 }, { value: 1, weight: 1e-300 }])).toBe(1);
  });

  test("huge weights do not overflow the total", () => {
    const rng = createRng("huge");
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.weighted([{ value: "a", weight: 1e308 }, { value: "b", weight: 1e308 }]));
    expect(seen.size).toBe(2);
  });

  test("rejects invalid weights", () => {
    const rng = createRng("invalid");
    thrown(RangeError, () => rng.weighted([]));
    thrown(RangeError, () => rng.weighted([{ value: 1, weight: 0 }]));
    thrown(RangeError, () => rng.weighted([{ value: 1, weight: -1 }, { value: 2, weight: 5 }]));
    thrown(RangeError, () => rng.weighted([{ value: 1, weight: NaN }]));
    thrown(RangeError, () => rng.weighted([{ value: 1, weight: Infinity }]));
    thrown(RangeError, () => rng.weighted([{ value: 1, weight: "2" as unknown as number }]));
  });
});

describe("fork()", () => {
  test("a child is independent of how much the parent has been used", () => {
    const parent = createRng("root");
    const before = take(parent.fork("combat"), 50);
    take(parent, 1234);
    parent.int(1, 6);
    expect(take(parent.fork("combat"), 50)).toEqual(before);
  });

  test("drawing from a child does not move the parent", () => {
    const a = createRng("root");
    const b = createRng("root");
    take(a.fork("x"), 100);
    expect(take(a, 20)).toEqual(take(b, 20));
  });

  test("same label gives the same stream; different labels, seeds and nesting give different ones", () => {
    const root = createRng("root");
    expect(take(root.fork("a"), 20)).toEqual(take(root.fork("a"), 20));
    const heads = new Set([
      take(root, 8).join(),
      take(root.fork("a"), 8).join(),
      take(root.fork("b"), 8).join(),
      take(root.fork("a").fork("b"), 8).join(),
      take(root.fork("b").fork("a"), 8).join(),
      take(root.fork(""), 8).join(),
      take(createRng("other").fork("a"), 8).join(),
    ]);
    expect(heads.size).toBe(7);
  });

  test("the seed/label boundary matters", () => {
    expect(take(createRng("ab").fork("c"), 8)).not.toEqual(take(createRng("a").fork("bc"), 8));
  });

  test("a child's seed is a pure function of parent seed and label", () => {
    expect(createRng("seed-1").fork("combat").seed).toBe("e3e89e3a59732c2c7a224746b5fd18d4");
    expect(createRng("seed-1").fork("combat").seed).toBe(createRng("seed-1").fork("combat").seed);
  });

  test("sibling streams are uncorrelated", () => {
    const root = createRng("siblings");
    const xs = take(root.fork("alpha"), 20_000);
    const ys = take(root.fork("beta"), 20_000);
    expect(Math.abs(pearson(xs, ys))).toBeLessThan(0.05);
    // and a child is not a shifted copy of its parent either
    const parent = take(root, 20_004);
    const child = take(root.fork("alpha"), 20_000);
    for (const shift of [0, 1, 2, 3]) expect(Math.abs(pearson(parent.slice(shift, shift + 20_000), child))).toBeLessThan(0.05);
  });

  test("forking requires a string label", () => {
    thrown(TypeError, () => createRng("s").fork(1 as unknown as string));
  });
});

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
