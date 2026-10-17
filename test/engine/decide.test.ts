import { describe, expect, test } from "bun:test";
import {
  DecideError,
  mostLikely,
  noulConfidence,
  normalize,
  sample,
  sampleNoul,
  scoreIndex,
  type Answer,
} from "../../src/engine/decide";
import { createRng } from "../../src/engine/rng";
import { thrown, withoutAmbient } from "./support";

const fixed = (u: number) => ({ next: () => u });
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("normalize", () => {
  test("scales to sum 1 and keeps the ratios", () => {
    const n = normalize({ a: 1, b: 1, c: 2 });
    expect(n).toEqual({ a: 0.25, b: 0.25, c: 0.5 });
    const m = normalize({ a: 0.2, b: 0.3 });
    expect(m.a).toBeCloseTo(0.4, 14);
    expect(m.b).toBeCloseTo(0.6, 14);
  });

  test("renormalising an already-normalised map changes nothing; scale does not matter", () => {
    const p = { x: 0.1, y: 0.2, z: 0.7 };
    const once = normalize(p);
    const twice = normalize(once);
    for (const k of ["x", "y", "z"]) expect(twice[k]).toBeCloseTo(once[k], 15);
    const scaled = normalize({ x: 1000, y: 2000, z: 7000 });
    for (const k of ["x", "y", "z"]) expect(scaled[k]).toBeCloseTo(once[k], 14);
  });

  test("always sums to 1, across wildly different magnitudes", () => {
    const rng = createRng("normalize-sum");
    for (let i = 0; i < 300; i++) {
      const p: Record<string, number> = {};
      const n = rng.int(1, 8);
      for (let j = 0; j < n; j++) p[`k${j}`] = rng.next() * 10 ** rng.int(-300, 300);
      if (Object.values(p).every((v) => v === 0)) continue;
      expect(sum(Object.values(normalize(p)))).toBeCloseTo(1, 12);
    }
  });

  test("cannot overflow or underflow", () => {
    expect(normalize({ a: 1e308, b: 1e308 })).toEqual({ a: 0.5, b: 0.5 });
    expect(normalize({ a: Number.MAX_VALUE, b: Number.MAX_VALUE, c: Number.MAX_VALUE })).toEqual({ a: 1 / 3, b: 1 / 3, c: 1 / 3 });
    expect(normalize({ a: 5e-324, b: 5e-324 })).toEqual({ a: 0.5, b: 0.5 });
  });

  test("a missing key counts as 0, an undefined entry too; extra keys are ignored", () => {
    expect(normalize({ a: 1 }, ["a", "b"])).toEqual({ a: 1, b: 0 });
    expect(normalize({ a: 1, b: undefined as unknown as number }, ["a", "b"])).toEqual({ a: 1, b: 0 });
    expect(normalize({ a: 1, b: 1, stray: 100 }, ["a", "b"])).toEqual({ a: 0.5, b: 0.5 });
  });

  test("rejects non-finite, negative and non-numeric probabilities", () => {
    for (const bad of [NaN, Infinity, -Infinity, -0.1, -1e-300]) {
      expect(thrown(DecideError, () => normalize({ a: 1, b: bad })).message).toContain('"b"');
    }
    for (const bad of ["0.5", null, {}, [1], true]) {
      thrown(DecideError, () => normalize({ a: 1, b: bad as unknown as number }));
    }
  });

  test("rejects an empty or all-zero distribution instead of inventing a uniform one", () => {
    thrown(DecideError, () => normalize({}));
    thrown(DecideError, () => normalize({ a: 0, b: 0 }));
    thrown(DecideError, () => normalize({ a: 1 }, []));
    thrown(DecideError, () => normalize({ a: 0 }, ["a", "b"]));
  });

  test("rejects duplicate keys", () => {
    thrown(DecideError, () => normalize({ a: 1 }, ["a", "a"]));
  });

  test("inherited and prototype names are not probabilities", () => {
    expect(normalize({ a: 1 }, ["a", "toString", "constructor"])).toEqual({ a: 1, toString: 0, constructor: 0 });
    const parsed = JSON.parse('{"__proto__": 1, "a": 1}') as Record<string, number>;
    expect(normalize(parsed)).toEqual(Object.fromEntries([["__proto__", 0.5], ["a", 0.5]]));
  });
});

describe("sample", () => {
  test("follows cumulative shares, with a draw on a boundary going to the later option", () => {
    const p = { a: 0.5, b: 0.5 };
    expect(sample(p, fixed(0))).toBe("a");
    expect(sample(p, fixed(0.4999999999999999))).toBe("a");
    expect(sample(p, fixed(0.5))).toBe("b");
    expect(sample(p, fixed(0.9999999999999999))).toBe("b");
  });

  test("an option with probability 0 is never picked, even on a draw of exactly 0 (Warp could)", () => {
    expect(sample({ a: 0, b: 1 }, fixed(0))).toBe("b");
    expect(sample({ a: 1, b: 0 }, fixed(0.9999999999999999))).toBe("a");
    expect(sample({ a: 0, b: 0.3, c: 0, d: 0.7 }, fixed(0.3))).toBe("d");
    expect(sample({ a: 0, b: 0.3, c: 0, d: 0.7 }, fixed(0.2999))).toBe("b");
  });

  test("when rounding leaves the draw above the summed shares, the last option with probability wins, never a trailing zero", () => {
    // ten shares of 0.1 add up to 0.9999999999999999, and the largest possible draw is the same number
    const p: Record<string, number> = { zz: 0 };
    for (let i = 0; i < 10; i++) p[`a${i}`] = 1;
    expect(sample(p, fixed(1 - 2 ** -53))).toBe("a9");
  });

  test("unnormalised input is renormalised first", () => {
    expect(sample({ a: 2, b: 2 }, fixed(0.49))).toBe("a");
    expect(sample({ a: 2, b: 2 }, fixed(0.51))).toBe("b");
    expect(sample({ a: 30, b: 70 }, fixed(0.29))).toBe("a");
    expect(sample({ a: 30, b: 70 }, fixed(0.31))).toBe("b");
  });

  test("key insertion order never changes the pick; default order is sorted by key", () => {
    for (const u of [0, 0.1, 0.24, 0.26, 0.5, 0.74, 0.76, 0.99]) {
      expect(sample({ b: 0.5, a: 0.25, c: 0.25 }, fixed(u))).toBe(sample({ c: 0.25, a: 0.25, b: 0.5 }, fixed(u)));
    }
    // sorted order is a, b, c, so a owns [0, .25), b [.25, .75), c [.75, 1)
    expect(sample({ c: 0.25, b: 0.5, a: 0.25 }, fixed(0.2))).toBe("a");
    expect(sample({ c: 0.25, b: 0.5, a: 0.25 }, fixed(0.3))).toBe("b");
    expect(sample({ c: 0.25, b: 0.5, a: 0.25 }, fixed(0.8))).toBe("c");
  });

  test("an explicit key order wins, including for integer-like keys", () => {
    const p = { "10": 0.5, "2": 0.5 };
    expect(sample(p, fixed(0.25), ["2", "10"])).toBe("2");
    expect(sample(p, fixed(0.75), ["2", "10"])).toBe("10");
    expect(sample(p, fixed(0.25), ["10", "2"])).toBe("10");
    expect(sample(p, fixed(0.75), ["10", "2"])).toBe("2");
  });

  test("keys outside the key list are ignored; missing ones have no share", () => {
    expect(sample({ a: 1, b: 1, zzz: 100 }, fixed(0.75), ["a", "b"])).toBe("b");
    expect(sample({ a: 1 }, fixed(0.99), ["a", "b"])).toBe("a");
  });

  test("long-run frequencies match the probabilities (seeded)", () => {
    const rng = createRng("sample-frequencies");
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const p = { a: 0.2, b: 0.3, c: 0.5, d: 0 };
    const n = 50_000;
    for (let i = 0; i < n; i++) counts[sample(p, rng)]++;
    expect(counts.d).toBe(0);
    expect(Math.abs(counts.a / n - 0.2)).toBeLessThan(0.01);
    expect(Math.abs(counts.b / n - 0.3)).toBeLessThan(0.01);
    expect(Math.abs(counts.c / n - 0.5)).toBeLessThan(0.01);
  });

  test("same seed, same probabilities, same sequence of picks; no ambient inputs", () => {
    const run = () => {
      const rng = createRng("picks");
      return Array.from({ length: 200 }, () => sample({ x: 0.1, y: 0.4, z: 0.5 }, rng));
    };
    const [first, second] = withoutAmbient(() => [run(), run()]);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(3);
  });

  test("propagates validation errors", () => {
    thrown(DecideError, () => sample({ a: NaN, b: 1 }, fixed(0.5)));
    thrown(DecideError, () => sample({}, fixed(0.5)));
  });
});

describe("mostLikely", () => {
  test("picks the highest probability, with or without normalisation", () => {
    expect(mostLikely({ a: 0.2, b: 0.5, c: 0.3 })).toBe("b");
    expect(mostLikely({ a: 20, b: 5, c: 30 })).toBe("c");
  });

  test("exact ties go to the earlier option in canonical order, not to insertion order", () => {
    expect(mostLikely({ b: 0.5, a: 0.5 })).toBe("a"); // sorted: a before b
    expect(mostLikely({ a: 0.5, b: 0.5 })).toBe("a");
    expect(mostLikely({ b: 0.5, a: 0.5 }, ["b", "a"])).toBe("b"); // author order
    expect(mostLikely({ x: 0.25, y: 0.5, z: 0.5 }, ["z", "y", "x"])).toBe("z");
  });

  test("a tie is exact: a hair above wins", () => {
    expect(mostLikely({ a: 0.5, b: 0.5000000000000001 })).toBe("b");
  });

  test("rejects an empty or all-zero distribution", () => {
    thrown(DecideError, () => mostLikely({}));
    thrown(DecideError, () => mostLikely({ a: 0, b: 0 }));
    thrown(DecideError, () => mostLikely({ a: -1, b: 2 }));
  });
});

describe("yes/no answers", () => {
  test("sampleNoul: 0 never, 1 always, strict comparison at the boundary", () => {
    expect(sampleNoul(0, fixed(0))).toBe(false);
    expect(sampleNoul(1, fixed(0.9999999999999999))).toBe(true);
    expect(sampleNoul(0.5, fixed(0.4999999999999999))).toBe(true);
    expect(sampleNoul(0.5, fixed(0.5))).toBe(false);
    const rng = createRng("noul");
    for (let i = 0; i < 2000; i++) { expect(sampleNoul(0, rng)).toBe(false); expect(sampleNoul(1, rng)).toBe(true); }
  });

  test("sampleNoul frequency matches p", () => {
    const rng = createRng("noul-freq");
    let yes = 0;
    for (let i = 0; i < 40_000; i++) if (sampleNoul(0.3, rng)) yes++;
    expect(Math.abs(yes / 40_000 - 0.3)).toBeLessThan(0.01);
  });

  test("probabilities outside [0, 1] or non-finite are rejected", () => {
    for (const bad of [-0.01, 1.01, NaN, Infinity, "0.5" as unknown as number]) {
      thrown(DecideError, () => sampleNoul(bad, fixed(0.5)));
      thrown(DecideError, () => noulConfidence(bad));
    }
  });

  test("confidence is 0 at 50/50 and 1 at certainty", () => {
    expect(noulConfidence(0.5)).toBe(0);
    expect(noulConfidence(0)).toBe(1);
    expect(noulConfidence(1)).toBe(1);
    expect(noulConfidence(0.75)).toBeCloseTo(0.5, 15);
    expect(noulConfidence(0.25)).toBeCloseTo(0.5, 15);
  });
});

describe("scoreIndex", () => {
  const score = (s: number): Answer => ({ type: "score", score: s, probabilities: {}, confidence: 1 });
  test("rounds to the nearest level and clamps", () => {
    expect(scoreIndex(score(0.4), 3)).toBe(0);
    expect(scoreIndex(score(1.6), 3)).toBe(2);
    expect(scoreIndex(score(2.5), 4)).toBe(3);
    expect(scoreIndex(score(-4), 3)).toBe(0);
    expect(scoreIndex(score(99), 3)).toBe(2);
  });
  test("null for other answer types, missing answers, non-finite scores and bad level counts", () => {
    expect(scoreIndex({ type: "noul", noul: 0.5 }, 3)).toBeNull();
    expect(scoreIndex(undefined, 3)).toBeNull();
    expect(scoreIndex(score(NaN), 3)).toBeNull();
    expect(scoreIndex(score(Infinity), 3)).toBeNull();
    expect(scoreIndex(score(1), 0)).toBeNull();
    expect(scoreIndex(score(1), 2.5)).toBeNull();
  });
});
