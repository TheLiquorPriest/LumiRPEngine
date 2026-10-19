// Price arithmetic for holdings and property (DESIGN §27): seeded normal draws, a geometric
// Brownian step, Black-Scholes-Merton for options, a coupon bond's present value, and FIFO lots.
// Pure numbers only: nothing here reads the state, so every model and test shares one formula.

import type { Rng } from "../../../engine/rng";

/** Minutes in a year, for option and bond time (365 days, as the market's year counts). */
export const YEAR_MINUTES = 365 * 1440;

/** A standard normal draw (Box-Muller): two uniforms in, one normal out, so each stream is one draw per step. */
export function normal(rng: Rng): number {
  const u1 = Math.max(Number.MIN_VALUE, rng.next());
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * A shock correlated with a common factor: `rho` of the factor's draw and the rest the asset's own,
 * so assets of one market fall together on a bad day and still wander apart.
 */
export function correlated(factor: number, own: number, rho: number): number {
  const r = Math.min(1, Math.max(0, rho));
  return r * factor + Math.sqrt(1 - r * r) * own;
}

/** One geometric Brownian step: drift and volatility in yearly percent, `dt` in years, `z` a standard normal. */
export function gbmStep(price: number, driftPct: number, volPct: number, dt: number, z: number): number {
  const mu = driftPct / 100;
  const sigma = volPct / 100;
  return price * Math.exp((mu - (sigma * sigma) / 2) * dt + sigma * Math.sqrt(dt) * z);
}

/**
 * The standard normal distribution function, to double precision (Hart's 1968 approximation as
 * W. J. West gives it), so an option's price is the same in every fold and on every platform.
 */
export function normCdf(x: number): number {
  const ax = Math.abs(x);
  let c: number;
  if (ax > 37) c = 0;
  else {
    const e = Math.exp((-ax * ax) / 2);
    if (ax < 7.07106781186547) {
      let n = 3.52624965998911e-2 * ax + 0.700383064443688;
      n = n * ax + 6.37396220353165;
      n = n * ax + 33.912866078383;
      n = n * ax + 112.079291497871;
      n = n * ax + 221.213596169931;
      n = n * ax + 220.206867912376;
      let d = 8.83883476483184e-2 * ax + 1.75566716318264;
      d = d * ax + 16.064177579207;
      d = d * ax + 86.7807322029461;
      d = d * ax + 296.564248779674;
      d = d * ax + 637.333633378831;
      d = d * ax + 793.826512519948;
      d = d * ax + 440.413735824752;
      c = (e * n) / d;
    } else {
      let b = ax + 0.65;
      b = ax + 4 / b;
      b = ax + 3 / b;
      b = ax + 2 / b;
      b = ax + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

export interface OptionInputs {
  right: "call" | "put";
  /** The underlying's price and the strike, per unit of the underlying, in the same units. */
  spot: number;
  strike: number;
  /** Time to expiry in years; at or below zero the option is worth what exercising it pays. */
  years: number;
  ratePct: number;
  volPct: number;
  /** The underlying's dividend yield, which lowers a call and raises a put. */
  yieldPct: number;
}

/** What exercising pays per unit of the underlying, never below nothing. */
export function intrinsic(right: "call" | "put", spot: number, strike: number): number {
  return Math.max(0, right === "call" ? spot - strike : strike - spot);
}

/** Black-Scholes-Merton with a continuous dividend yield: the option's value per unit of the underlying. */
export function blackScholes(o: OptionInputs): number {
  if (!(o.spot > 0) || !(o.strike > 0)) return o.years <= 0 ? intrinsic(o.right, Math.max(0, o.spot), Math.max(0, o.strike)) : 0;
  if (o.years <= 0) return intrinsic(o.right, o.spot, o.strike);
  const r = o.ratePct / 100;
  const q = o.yieldPct / 100;
  const sigma = o.volPct / 100;
  const forward = o.spot * Math.exp(-q * o.years);
  const discounted = o.strike * Math.exp(-r * o.years);
  // No volatility: the option is worth its discounted forward payoff, a limit the formula can't reach.
  if (!(sigma > 0)) return Math.max(0, o.right === "call" ? forward - discounted : discounted - forward);
  const sd = sigma * Math.sqrt(o.years);
  const d1 = (Math.log(o.spot / o.strike) + (r - q + (sigma * sigma) / 2) * o.years) / sd;
  const d2 = d1 - sd;
  return o.right === "call" ? forward * normCdf(d1) - discounted * normCdf(d2) : discounted * normCdf(-d2) - forward * normCdf(-d1);
}

export interface BondInputs {
  face: number;
  couponPct: number;
  /** The market's yield for it, yearly percent, compounded once per coupon period. */
  yieldPct: number;
  /** Years to maturity; at or below zero it is worth its face. */
  years: number;
  /** Coupons a year. */
  frequency: number;
}

/**
 * A coupon bond's price with its accrued interest (the dirty price): every coupon still to come and
 * the face at maturity, each discounted to now. It falls by a coupon when the coupon is paid, which
 * the holder receives as interest, and pulls to its face as maturity nears.
 */
export function bondPrice(b: BondInputs): number {
  if (b.years <= 0) return b.face;
  const m = Math.max(1, Math.round(b.frequency));
  const periods = b.years * m;
  const n = Math.ceil(periods - 1e-9);
  const coupon = (b.face * b.couponPct) / 100 / m;
  const y = b.yieldPct / 100 / m;
  let price = 0;
  for (let k = 1; k <= n; k++) {
    const t = periods - (n - k);
    price += coupon / Math.pow(1 + y, t);
  }
  return price + b.face / Math.pow(1 + y, periods);
}

/** One purchase of units: how many are left of it, what they cost in all (minor units), and when it was bought (a clock reading). */
export interface OpenLot {
  qty: number;
  cost: number;
  at: number;
}

/** A part of a lot that a sale consumed: the units, their share of the lot's cost, and when the lot was bought. */
export type TakenLot = OpenLot;

/** Units count as none below this, so fractional shares never leave a dust lot. */
export const QTY_EPSILON = 1e-9;

/** Units rounded to a millionth, the precision positions keep. */
export function roundQty(qty: number): number {
  return Math.round(qty * 1e6) / 1e6;
}

/**
 * Takes `qty` units first in, first out: whole lots oldest first, then part of the next with its
 * share of the cost (rounded, so the parts of a lot always add back to its cost). Null when the lots
 * hold fewer units.
 */
export function takeFifo(lots: readonly OpenLot[], qty: number): { left: OpenLot[]; taken: TakenLot[] } | null {
  const held = lots.reduce((a, l) => a + l.qty, 0);
  if (qty > held + QTY_EPSILON) return null;
  const left: OpenLot[] = [];
  const taken: TakenLot[] = [];
  let want = qty;
  for (const lot of lots) {
    if (want <= QTY_EPSILON) {
      left.push({ ...lot });
      continue;
    }
    if (lot.qty <= want + QTY_EPSILON) {
      taken.push({ ...lot });
      want -= lot.qty;
      continue;
    }
    const part = roundQty(want);
    const cost = Math.round((lot.cost * part) / lot.qty);
    taken.push({ qty: part, cost, at: lot.at });
    left.push({ qty: roundQty(lot.qty - part), cost: lot.cost - cost, at: lot.at });
    want = 0;
  }
  return { left, taken };
}
