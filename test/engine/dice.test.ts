import { describe, expect, test } from "bun:test";
import {
  DICE_LIMITS,
  DiceError,
  diceDistribution,
  parseDice,
  probAtLeast,
  probAtMost,
  probEqual,
  rollDice,
} from "../../src/engine/dice";
import { createRng } from "../../src/engine/rng";
import { enumerateOutcomes, scriptedRng, thrown, withoutAmbient } from "./support";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("parseDice", () => {
  test("accepts every documented form", () => {
    expect(parseDice("d20").groups).toEqual([{ count: 1, sides: 20, sign: 1 }]);
    expect(parseDice("2d6").groups).toEqual([{ count: 2, sides: 6, sign: 1 }]);
    expect(parseDice("d%").groups[0].sides).toBe(100);
    expect(parseDice("d100").groups[0].sides).toBe(100);
    expect(parseDice("4d6kh3").groups[0].keep).toEqual({ mode: "kh", n: 3 });
    expect(parseDice("2d20kl1").groups[0].keep).toEqual({ mode: "kl", n: 1 });
    expect(parseDice("3d6!").groups[0].explode).toBe(true);
    expect(parseDice("4d6kh3!").groups[0]).toMatchObject({ keep: { mode: "kh", n: 3 }, explode: true });
    const p = parseDice("2d6+1d4-1");
    expect(p.groups.map((g) => [g.count, g.sides, g.sign])).toEqual([[2, 6, 1], [1, 4, 1]]);
    expect(p.flat).toBe(-1);
    expect(p.primarySides).toBe(6);
    expect(parseDice("-1d4+2").groups[0].sign).toBe(-1);
    expect(parseDice("1d8 + 2").flat).toBe(2);
    expect(parseDice("  D20 ").groups[0].sides).toBe(20);
  });

  test("rejects malformed notation", () => {
    for (const bad of ["", "   ", "abc", "5", "2d", "d", "d1", "d1001", "0d6", "101d6", "4d6kh5", "4d6kh0", "d20+", "d20 d6", "2d6 3", "2 d6", "2d6!!", "kh3", "d20++1", "2d6x"]) {
      thrown(DiceError, () => parseDice(bad));
    }
  });

  test("whitespace inside a term is an error, not a merge (Warp read `1d6 8` as 1d68)", () => {
    thrown(DiceError, () => parseDice("1d6 8"));
    expect(parseDice("1d68").groups[0].sides).toBe(68);
  });

  test("size limits", () => {
    expect(parseDice(Array.from({ length: DICE_LIMITS.maxTerms }, () => "d6").join("+")).groups.length).toBe(16);
    thrown(DiceError, () => parseDice(Array.from({ length: DICE_LIMITS.maxTerms + 1 }, () => "d6").join("+")));
    expect(parseDice("1000000000+d6").flat).toBe(1_000_000_000);
    thrown(DiceError, () => parseDice("1000000001+d6"));
    thrown(DiceError, () => parseDice("d6+" + "1".repeat(200)));
    expect(parseDice("100d1000").groups[0]).toMatchObject({ count: 100, sides: 1000 });
  });

  test("non-strings are rejected", () => {
    thrown(DiceError, () => parseDice(20 as unknown as string));
  });
});

describe("rollDice", () => {
  test("draws exactly rng.int(1, sides) once per die, in notation order", () => {
    const rng = scriptedRng([3, 5, 2, 6, 4]);
    const r = rollDice("4d6kh3+1d4", rng);
    expect(rng.calls).toEqual([[1, 6], [1, 6], [1, 6], [1, 6], [1, 4]]);
    expect(r.dice.map((d) => d.value)).toEqual([3, 5, 2, 6, 4]);
    expect(r.dice.map((d) => d.kept)).toEqual([true, true, false, true, true]);
    expect(r.total).toBe(3 + 5 + 6 + 4);
    expect(r.natural).toBeNull(); // three dice kept in the first group
  });

  test("keep lowest, sign and flat modifier", () => {
    const r = rollDice("2d20kl1-1d4+10", scriptedRng([14, 7, 3]));
    expect(r.total).toBe(7 - 3 + 10);
    expect(r.natural).toBe(7);
  });

  test("ties keep the earlier die", () => {
    const r = rollDice("3d6kh2", scriptedRng([4, 4, 4]));
    expect(r.dice.map((d) => d.kept)).toEqual([true, true, false]);
    expect(r.total).toBe(8);
  });

  test("natural is the lone kept die of the first term, unless it exploded", () => {
    expect(rollDice("d20+5", scriptedRng([20])).natural).toBe(20);
    expect(rollDice("d20+5", scriptedRng([1])).natural).toBe(1);
    expect(rollDice("2d6", scriptedRng([3, 4])).natural).toBeNull();
    expect(rollDice("d6!", scriptedRng([6, 6, 3])).natural).toBeNull();
    expect(rollDice("d6!", scriptedRng([5])).natural).toBe(5);
  });

  test("an exploding die rolls again on its maximum and its faces add up", () => {
    const rng = scriptedRng([6, 6, 3]);
    const r = rollDice("d6!", rng);
    expect(r.total).toBe(15);
    expect(r.dice).toEqual([{ group: 0, sides: 6, value: 15, faces: [6, 6, 3], kept: true }]);
    expect(rng.calls.length).toBe(3);
  });

  test("keep/drop chooses between whole exploding dice (Warp mixed all faces in one pile)", () => {
    // die 1 chains 6, 6, 2 = 14; die 2 is a 5. Keeping the highest die keeps all of die 1.
    const r = rollDice("2d6kh1!", scriptedRng([6, 6, 2, 5]));
    expect(r.total).toBe(14);
    expect(r.dice.map((d) => d.kept)).toEqual([true, false]);
  });

  test("explosions stop after 20 extra rolls", () => {
    let calls = 0;
    const alwaysMax = { ...scriptedRng([]), int: (_min: number, max: number) => { calls++; return max; } };
    const r = rollDice("d4!", alwaysMax);
    expect(calls).toBe(21);
    expect(r.total).toBe(84);
  });

  test("reproducible from a seed, different for different seeds, no ambient inputs", () => {
    const run = (seed: string) => rollDice("4d6kh3+2d8!-1", createRng(seed));
    const [first, again] = withoutAmbient(() => [run("a"), run("a")]);
    expect(first).toEqual(again);
    const totals = new Set(Array.from({ length: 30 }, (_, i) => run(`seed${i}`).total));
    expect(totals.size).toBeGreaterThan(8);
  });

  test("totals always lie between the possible minimum and maximum", () => {
    const rng = createRng("bounds");
    const d = diceDistribution("3d6kh2+4");
    for (let i = 0; i < 3000; i++) {
      const t = rollDice("3d6kh2+4", rng).total;
      expect(t).toBeGreaterThanOrEqual(d.min);
      expect(t).toBeLessThanOrEqual(d.max);
    }
  });
});

describe("exact odds", () => {
  describe("known results", () => {
    test("d20 is uniform", () => {
      const d = diceDistribution("d20");
      expect([d.min, d.max, d.probs.length]).toEqual([1, 20, 20]);
      for (const p of d.probs) expect(p).toBeCloseTo(0.05, 14);
      expect(d.mean).toBeCloseTo(10.5, 12);
    });

    test("2d6 is the triangle", () => {
      const d = diceDistribution("2d6");
      expect([d.min, d.max]).toEqual([2, 12]);
      for (let t = 2; t <= 12; t++) expect(probEqual(d, t)).toBeCloseTo((6 - Math.abs(t - 7)) / 36, 14);
      expect(d.mean).toBeCloseTo(7, 12);
    });

    test("4d6 keep highest 3: P(3) = 1/1296, P(18) = 21/1296, mean 12.2446", () => {
      const d = diceDistribution("4d6kh3");
      expect([d.min, d.max]).toEqual([3, 18]);
      expect(probEqual(d, 3)).toBeCloseTo(1 / 1296, 14);
      expect(probEqual(d, 18)).toBeCloseTo(21 / 1296, 14);
      expect(d.mean).toBeCloseTo(12.2446, 4);
    });

    test("advantage and disadvantage on a d20", () => {
      const low = diceDistribution("2d20kl1");
      expect(probEqual(low, 1)).toBeCloseTo(39 / 400, 14);
      expect(probEqual(low, 20)).toBeCloseTo(1 / 400, 14);
      expect(low.mean).toBeCloseTo(7.175, 12);
      const high = diceDistribution("2d20kh1");
      expect(probEqual(high, 20)).toBeCloseTo(39 / 400, 14);
      expect(high.mean).toBeCloseTo(13.825, 12);
    });

    test("percentile dice", () => {
      for (const n of ["d%", "d100"]) {
        const d = diceDistribution(n);
        expect(d.probs.length).toBe(100);
        expect(d.probs.every((p) => Math.abs(p - 0.01) < 1e-14)).toBe(true);
      }
    });

    test("exploding d2 has the geometric shape and only odd totals below the cap", () => {
      const d = diceDistribution("d2!");
      expect(probEqual(d, 1)).toBeCloseTo(0.5, 14);
      expect(probEqual(d, 2)).toBe(0);
      expect(probEqual(d, 3)).toBeCloseTo(0.25, 14);
      expect(probEqual(d, 5)).toBeCloseTo(0.125, 14);
      expect(d.max).toBe(42); // 21 faces of 2
      expect(probEqual(d, 42)).toBeCloseTo(2 ** -21, 20);
    });

    test("exploding mean is s(s+1) / (2(s-1)) per die (cap effect is below 1e-9)", () => {
      expect(diceDistribution("3d6!").mean).toBeCloseTo(3 * (6 * 7) / (2 * 5), 9);
      expect(diceDistribution("d20!").mean).toBeCloseTo((20 * 21) / (2 * 19), 9);
    });

    test("flat bonus shifts, a negative term mirrors", () => {
      const d = diceDistribution("2d6+3");
      expect([d.min, d.max]).toEqual([5, 15]);
      const m = diceDistribution("1d6-1d6");
      expect([m.min, m.max]).toEqual([-5, 5]);
      expect(m.mean).toBeCloseTo(0, 12);
      for (let i = 0; i < m.probs.length; i++) expect(m.probs[i]).toBeCloseTo(m.probs[m.probs.length - 1 - i], 14);
      expect(probEqual(m, 0)).toBeCloseTo(6 / 36, 14);
    });

    test("keeping every die is the same as a plain sum", () => {
      const a = diceDistribution("4d6kh4");
      const b = diceDistribution("4d6");
      expect(a.probs.length).toBe(b.probs.length);
      a.probs.forEach((p, i) => expect(p).toBeCloseTo(b.probs[i], 14));
    });
  });

  describe("they sum to 1", () => {
    const notations = ["d2", "d20", "2d6", "10d10", "4d6kh3", "2d20kl1", "5d8kl2+3", "3d6!", "2d6kh1!", "d%", "d100+d20-d4", "1d6-1d6", "20d100", "100d1000", "8d6kh3!", "100d6"];
    for (const n of notations) {
      test(n, () => {
        const d = diceDistribution(n);
        expect(sum(d.probs)).toBeCloseTo(1, 12);
        expect(d.probs.every((p) => p >= 0 && Number.isFinite(p))).toBe(true);
        expect(d.max - d.min + 1).toBe(d.probs.length);
        expect(d.probs[0]).toBeGreaterThan(0);
        expect(d.probs[d.probs.length - 1]).toBeGreaterThan(0);
        expect(sum(d.probs.map((p, i) => p * (d.min + i)))).toBeCloseTo(d.mean, 9);
      });
    }

    test("100d1000 has mean 50050", () => {
      expect(diceDistribution("100d1000").mean).toBeCloseTo(50_050, 4);
    });

    test("small sums keep their extreme tails exact: all ones is 100^-20", () => {
      const d = diceDistribution("20d100");
      expect(probEqual(d, 20) / 1e-40).toBeCloseTo(1, 9);
      expect(probEqual(d, 2000) / 1e-40).toBeCloseTo(1, 9);
    });
  });

  describe("they match exhaustive enumeration of the real roller", () => {
    // enumerateOutcomes replays rollDice over every possible sequence of faces and adds up the
    // probability of each total, so any disagreement between rolling and odds shows up here.
    const small = [
      "d6", "2d4", "3d3", "2d6-1d4+2", "3d4kh2", "3d4kl1", "4d3kh3", "2d6kl1+3", "d2!", "2d3!", "3d3kh2!", "2d4kl1!", "1d4-2d3kh1", "d3!+d4",
    ];
    for (const n of small) {
      test(n, () => {
        const odds = diceDistribution(n);
        const real = enumerateOutcomes((rng) => rollDice(n, rng).total);
        expect([...real.keys()].sort((a, b) => a - b)).toEqual(odds.probs.map((_, i) => odds.min + i).filter((t) => probEqual(odds, t) > 0));
        for (const [total, p] of real) expect(Math.abs(probEqual(odds, total) - p)).toBeLessThan(1e-12);
        expect(sum([...real.values()])).toBeCloseTo(1, 12);
      });
    }
  });

  describe("tail helpers", () => {
    const d = diceDistribution("2d6");
    test("probAtLeast / probAtMost / probEqual", () => {
      expect(probAtLeast(d, 10)).toBeCloseTo(6 / 36, 14);
      expect(probAtMost(d, 7)).toBeCloseTo(21 / 36, 14);
      expect(probAtLeast(d, 2)).toBe(1);
      expect(probAtLeast(d, -100)).toBe(1);
      expect(probAtLeast(d, 13)).toBe(0);
      expect(probAtMost(d, 12)).toBe(1);
      expect(probAtMost(d, 1)).toBe(0);
      expect(probEqual(d, 1)).toBe(0);
      expect(probEqual(d, 13)).toBe(0);
    });
    test("at-least and at-most are complements", () => {
      for (let t = 1; t <= 13; t++) expect(probAtLeast(d, t) + probAtMost(d, t - 1)).toBeCloseTo(1, 12);
    });
  });

  test("expressions too large to count throw DiceError instead of hanging", () => {
    thrown(DiceError, () => diceDistribution("100d1000kh50"));
    thrown(DiceError, () => diceDistribution("100d20!"));
    expect(rollDice("100d1000kh50", createRng("big")).dice.length).toBe(100); // rolling is unaffected
  });

  test("invalid notation is rejected", () => {
    thrown(DiceError, () => diceDistribution("nope"));
  });

  test("never touches the clock or Math.random", () => {
    withoutAmbient(() => {
      diceDistribution("4d6kh3+2d8!");
    });
  });
});
