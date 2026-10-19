// The price arithmetic holdings and options share (DESIGN §27.2, §27.7): Black-Scholes against
// textbook values and put-call parity, a bond's price around par and at maturity, the normal
// distribution function, and first-in-first-out lots.
import { describe, expect, test } from "bun:test";
import { createRng } from "../../../src/engine/rng";
import { blackScholes, bondPrice, correlated, gbmStep, intrinsic, normal, normCdf, takeFifo } from "../../../src/packs/economy/core/pricing";
import { paymentMonths } from "../../../src/packs/economy/core/income";

describe("pricing: options", () => {
  test("Black-Scholes matches the textbook values (S = K = 100, a year, 5 % rate, 20 % volatility)", () => {
    const base = { spot: 100, strike: 100, years: 1, ratePct: 5, volPct: 20, yieldPct: 0 };
    expect(blackScholes({ ...base, right: "call" })).toBeCloseTo(10.4506, 3);
    expect(blackScholes({ ...base, right: "put" })).toBeCloseTo(5.5735, 3);
  });

  test("put-call parity holds with a dividend yield, in and out of the money", () => {
    for (const spot of [60, 95, 100, 140]) {
      const o = { spot, strike: 100, years: 0.75, ratePct: 4, volPct: 30, yieldPct: 1.5 };
      const parity = spot * Math.exp(-0.015 * 0.75) - 100 * Math.exp(-0.04 * 0.75);
      expect(blackScholes({ ...o, right: "call" }) - blackScholes({ ...o, right: "put" })).toBeCloseTo(parity, 8);
    }
  });

  test("at or past expiry an option is worth what exercising it pays; with no volatility, its discounted payoff", () => {
    expect(blackScholes({ right: "call", spot: 120, strike: 100, years: 0, ratePct: 5, volPct: 20, yieldPct: 0 })).toBe(20);
    expect(blackScholes({ right: "put", spot: 120, strike: 100, years: -1, ratePct: 5, volPct: 20, yieldPct: 0 })).toBe(0);
    expect(intrinsic("put", 80, 100)).toBe(20);
    expect(blackScholes({ right: "call", spot: 100, strike: 90, years: 1, ratePct: 0, volPct: 0, yieldPct: 0 })).toBeCloseTo(10, 10);
  });

  test("a call is worth more as the underlying rises and as time to expiry grows", () => {
    const call = (spot: number, years: number): number => blackScholes({ right: "call", spot, strike: 100, years, ratePct: 4, volPct: 25, yieldPct: 1 });
    expect(call(110, 0.5)).toBeGreaterThan(call(100, 0.5));
    expect(call(100, 1)).toBeGreaterThan(call(100, 0.25));
  });

  test("the normal distribution function is symmetric and exact at its landmarks", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1.959963985)).toBeCloseTo(0.975, 8);
    for (const x of [0.3, 1.1, 2.7, 6]) expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 12);
    expect(normCdf(-40)).toBe(0);
  });
});

describe("pricing: bonds and paths", () => {
  test("a bond is at par when its coupon is its yield, below par when yields are higher, and its face at maturity", () => {
    const b = { face: 100000, couponPct: 5, years: 10, frequency: 2 };
    expect(bondPrice({ ...b, yieldPct: 5 })).toBeCloseTo(100000, 4);
    expect(bondPrice({ ...b, yieldPct: 6 })).toBeCloseTo(92561.3, 0);
    expect(bondPrice({ ...b, yieldPct: 4 })).toBeGreaterThan(100000);
    expect(bondPrice({ ...b, yieldPct: 6, years: 0 })).toBe(100000);
  });

  test("a bond priced between coupons carries the coming coupon, and drops by it once paid", () => {
    const before = bondPrice({ face: 100000, couponPct: 6, yieldPct: 6, years: 2.0001, frequency: 2 });
    const after = bondPrice({ face: 100000, couponPct: 6, yieldPct: 6, years: 1.9999, frequency: 2 });
    expect(before - after).toBeCloseTo(3000, -1);
  });

  test("a geometric Brownian step with no shock grows by the drift less half the variance", () => {
    expect(gbmStep(100, 10, 0, 1, 0)).toBeCloseTo(100 * Math.exp(0.1), 10);
    expect(gbmStep(100, 10, 20, 1, 0)).toBeCloseTo(100 * Math.exp(0.1 - 0.02), 10);
  });

  test("seeded normal draws repeat, and a fully correlated shock is the market's", () => {
    expect(normal(createRng("a"))).toBe(normal(createRng("a")));
    expect(normal(createRng("a"))).not.toBe(normal(createRng("b")));
    expect(correlated(1.2, -0.4, 1)).toBe(1.2);
    expect(correlated(1.2, -0.4, 0)).toBe(-0.4);
  });

  test("payments a year fall in evenly spaced months ending on the last one", () => {
    expect(paymentMonths(4, 12)).toEqual([3, 6, 9, 12]);
    expect(paymentMonths(2, 5)).toEqual([5, 11]);
    expect(paymentMonths(12, 12)).toHaveLength(12);
    expect(paymentMonths(1, 7)).toEqual([7]);
  });
});

describe("pricing: lots", () => {
  const lots = [
    { qty: 10, cost: 100000, at: 0 },
    { qty: 5, cost: 60000, at: 100 },
  ];

  test("a sale takes the oldest lots first, and part of the next with its share of the cost", () => {
    const out = takeFifo(lots, 12);
    expect(out?.taken).toEqual([
      { qty: 10, cost: 100000, at: 0 },
      { qty: 2, cost: 24000, at: 100 },
    ]);
    expect(out?.left).toEqual([{ qty: 3, cost: 36000, at: 100 }]);
  });

  test("the parts of a lot always add back up to its cost", () => {
    const odd = [{ qty: 3, cost: 1000, at: 0 }];
    const out = takeFifo(odd, 1);
    expect((out?.taken[0]?.cost ?? 0) + (out?.left[0]?.cost ?? 0)).toBe(1000);
  });

  test("selling more than is held takes nothing", () => {
    expect(takeFifo(lots, 15.5)).toBeNull();
    expect(takeFifo(lots, 15)?.left).toEqual([]);
  });
});
