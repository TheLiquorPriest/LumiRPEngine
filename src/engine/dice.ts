// Dice notation: parsing, rolling through an injected seeded Rng, and exact outcome odds.
//
// Adapted from Warp's engine/dice.ts (see NOTICE). Every roll the engine makes goes through an
// Rng from engine/rng, so a roll is reproducible from its seed and never touched by a model.
// diceDistribution() computes the exact probability of every total by counting, not sampling,
// so the odds the palette shows are the odds rollDice() really has.
//
// Notation (case-insensitive; spaces allowed only around a + or -):
//   d20        one twenty-sided die            2d6      two six-sided dice
//   d100  d%   percentile (both mean d100)     1d8+2    a flat bonus
//   4d6kh3     roll 4, keep the 3 highest      2d20kl1  roll 2, keep the lowest
//   3d6!       exploding: a die showing its maximum is rolled again and the faces add up
//   2d6+1d4-1  several terms; the first may carry a sign too (-1d4 is allowed)
// A term is  [count]d<sides>[kh<n>|kl<n>][!]  or a whole number. At least one term must be dice.
//
// Limits (DICE_LIMITS): notation up to 128 characters and 16 terms; 1-100 dice per term; 2-1000
// sides; flat bonuses up to 1,000,000,000; an exploding die adds at most 20 extra rolls.
//
// Deliberate differences from Warp:
//   * The random source is an injected Rng object (rng.int), not a bare () => number, and the
//     seeded generator, hashSeed and randomSeed that lived here are gone (randomSeed read the
//     system entropy source, which an engine that must replay cannot use).
//   * Exploding dice: a die's value is the sum of its own chain of faces, and keep/drop chooses
//     among whole dice. Warp threw every extra face into the same pile as the original dice, so
//     `4d6kh3!` could keep two faces of one chain and drop another die entirely. With whole-die
//     semantics the odds are exact and match the usual tabletop reading. Without `kh`/`kl` the
//     totals are identical to Warp's.
//   * Whitespace inside a term is an error. Warp deleted all whitespace first, so `1d6 8` was
//     read as `1d68`.
//   * Notation length, term count and flat-bonus size are bounded.
//   * Warp's d20-only helpers (d20Tier, d20Odds, rollD20) are replaced by diceDistribution and
//     the probAt* functions, which cover any expression: a check is "roll an expression, compare
//     the total to bands", and probAtLeast(d, target) is the success chance.

import type { Rng } from "./rng";

export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceError";
  }
}

export const DICE_LIMITS = Object.freeze({
  maxNotationLength: 128,
  maxTerms: 16,
  maxCount: 100,
  minSides: 2,
  maxSides: 1000,
  maxFlat: 1_000_000_000,
  /** Extra rolls one exploding die can add (so a chain is at most 21 faces). */
  maxExplodeExtra: 20,
  /** Upper bound on arithmetic operations diceDistribution will spend; larger expressions throw DiceError. */
  maxExactWork: 20_000_000,
});

export interface DiceGroup {
  count: number;
  sides: number;
  keep?: { mode: "kh" | "kl"; n: number };
  explode?: boolean;
  sign: 1 | -1;
}

export interface ParsedDice {
  groups: DiceGroup[];
  flat: number;
  /** Largest single-die size, used to spot natural crits. */
  primarySides: number;
}

export function parseDice(src: string): ParsedDice {
  if (typeof src !== "string") throw new DiceError("Dice notation must be a string");
  if (src.length > DICE_LIMITS.maxNotationLength) throw new DiceError(`Dice notation is longer than ${DICE_LIMITS.maxNotationLength} characters`);
  const s = src.trim().toLowerCase();
  if (!s) throw new DiceError("Dice notation is empty");
  const term = /\s*([+-]?)\s*(?:(\d*)d(\d+|%)(?:(kh|kl)(\d+))?(!)?|(\d+))/y;
  const groups: DiceGroup[] = [];
  let flat = 0;
  let pos = 0;
  let terms = 0;
  while (pos < s.length) {
    term.lastIndex = pos;
    const m = term.exec(s);
    if (!m) break;
    if (terms > 0 && !m[1]) break; // every term after the first needs its own + or -
    if (++terms > DICE_LIMITS.maxTerms) throw new DiceError(`"${src}": more than ${DICE_LIMITS.maxTerms} terms`);
    const sign = m[1] === "-" ? -1 : 1;
    if (m[7] !== undefined) {
      const n = Number(m[7]);
      if (n > DICE_LIMITS.maxFlat) throw new DiceError(`"${src}": flat bonus is larger than ${DICE_LIMITS.maxFlat}`);
      flat += sign * n;
    } else {
      const count = m[2] ? Number(m[2]) : 1;
      const sides = m[3] === "%" ? 100 : Number(m[3]);
      if (count < 1 || count > DICE_LIMITS.maxCount) throw new DiceError(`"${src}": dice count must be 1–${DICE_LIMITS.maxCount}`);
      if (sides < DICE_LIMITS.minSides || sides > DICE_LIMITS.maxSides) throw new DiceError(`"${src}": dice need ${DICE_LIMITS.minSides}–${DICE_LIMITS.maxSides} sides`);
      const g: DiceGroup = { count, sides, sign };
      if (m[4]) {
        const n = Number(m[5]);
        if (n < 1 || n > count) throw new DiceError(`"${src}": can't keep ${n} of ${count} dice`);
        g.keep = { mode: m[4] as "kh" | "kl", n };
      }
      if (m[6]) g.explode = true;
      groups.push(g);
    }
    pos = term.lastIndex;
  }
  if (pos !== s.length) throw new DiceError(`"${src}" isn't valid dice notation (try d20, 2d6, d100, 4d6kh3)`);
  if (!groups.length) throw new DiceError(`"${src}" has no dice in it`);
  return { groups, flat, primarySides: Math.max(...groups.map((g) => g.sides)) };
}

// ───────────────────────────── rolling ─────────────────────────────

export interface RolledDie {
  /** Index of the term (among the dice terms, in notation order) this die belongs to. */
  group: number;
  sides: number;
  /** The die's value: its face, or for an exploding die the sum of its chain. */
  value: number;
  /** Every face rolled for this die, in order (more than one only when it exploded). */
  faces: number[];
  /** False for dice dropped by kh/kl. */
  kept: boolean;
}

export interface DiceRoll {
  notation: string;
  /** Every die rolled, including dropped ones, in roll order. */
  dice: RolledDie[];
  total: number;
  /** The face of the first term's single kept die when it did not explode, else null; for natural 1 / natural 20 checks. */
  natural: number | null;
  primarySides: number;
}

/**
 * Roll a notation. Draws only `rng.int(1, sides)`, die by die in notation order, finishing each
 * die's explosions before the next die. Ties for kh/kl keep the earlier die.
 */
export function rollDice(notation: string, rng: Rng): DiceRoll {
  const parsed = parseDice(notation);
  const dice: RolledDie[] = [];
  let total = parsed.flat;
  let natural: number | null = null;
  parsed.groups.forEach((g, gi) => {
    const rolled: RolledDie[] = [];
    for (let i = 0; i < g.count; i++) {
      const faces = [rng.int(1, g.sides)];
      let extra = 0;
      while (g.explode && faces[faces.length - 1] === g.sides && extra++ < DICE_LIMITS.maxExplodeExtra) {
        faces.push(rng.int(1, g.sides));
      }
      rolled.push({ group: gi, sides: g.sides, value: faces.reduce((a, b) => a + b, 0), faces, kept: true });
    }
    if (g.keep && g.keep.n < g.count) {
      const order = Array.from(rolled, (_, i) => i).sort((x, y) => {
        const dv = g.keep!.mode === "kh" ? rolled[y].value - rolled[x].value : rolled[x].value - rolled[y].value;
        return dv !== 0 ? dv : x - y;
      });
      const keep = new Set(order.slice(0, g.keep.n));
      rolled.forEach((d, i) => { d.kept = keep.has(i); });
    }
    for (const d of rolled) if (d.kept) total += g.sign * d.value;
    const keptDice = rolled.filter((d) => d.kept);
    if (gi === 0 && keptDice.length === 1 && keptDice[0].faces.length === 1) natural = keptDice[0].value;
    dice.push(...rolled);
  });
  return { notation, dice, total, natural, primarySides: parsed.primarySides };
}

// ───────────────────────────── exact odds ─────────────────────────────

export interface DiceDistribution {
  /** Smallest possible total. */
  readonly min: number;
  /** Largest possible total (at most `maxExplodeExtra + 1` faces per exploding die). */
  readonly max: number;
  /** probs[i] is the probability that the total equals min + i. Sums to 1. */
  readonly probs: readonly number[];
  /** Expected total. */
  readonly mean: number;
}

/** A probability table over consecutive integers starting at `lo`. */
interface Dist {
  lo: number;
  p: Float64Array;
}

class Work {
  private spent = 0;
  spend(n: number): void {
    this.spent += n;
    if (this.spent > DICE_LIMITS.maxExactWork) {
      throw new DiceError("This expression is too large to compute exact odds for");
    }
  }
}

function convolve(a: Dist, b: Dist, work: Work): Dist {
  work.spend(a.p.length * b.p.length);
  const p = new Float64Array(a.p.length + b.p.length - 1);
  for (let i = 0; i < a.p.length; i++) {
    const ai = a.p[i];
    if (ai === 0) continue;
    for (let j = 0; j < b.p.length; j++) p[i + j] += ai * b.p[j];
  }
  return { lo: a.lo + b.lo, p };
}

/** The value distribution of one die: a plain face, or the sum of an exploding chain. */
function dieDist(sides: number, explode: boolean): Dist {
  if (!explode) return { lo: 1, p: new Float64Array(sides).fill(1 / sides) };
  const maxValue = (DICE_LIMITS.maxExplodeExtra + 1) * sides;
  const p = new Float64Array(maxValue);
  // m maximum faces in a row, then a face below the maximum; or the whole chain of
  // maxExplodeExtra + 1 faces all at the maximum.
  for (let m = 0; m <= DICE_LIMITS.maxExplodeExtra; m++) {
    const pm = (1 / sides) ** m / sides;
    for (let f = 1; f < sides; f++) p[m * sides + f - 1] = pm;
  }
  p[maxValue - 1] = (1 / sides) ** (DICE_LIMITS.maxExplodeExtra + 1);
  return { lo: 1, p };
}

/** Direct convolution is used for plain sums while it costs at most this many operations. */
const DIRECT_SUM_WORK = 3_000_000;

/**
 * Sum of `count` plain dice with `sides` faces. Small sums are convolved directly, which keeps
 * the far tails accurate to the last digit (the probability of rolling all ones is exactly
 * sides^-count). Large sums use a sliding window, O(count × support), whose subtractions leave
 * rounding dust of about 1e-16 in the extreme tails: totals whose true probability is below
 * that are only approximate there.
 */
function plainSumDist(count: number, sides: number, work: Work): Dist {
  let cur: Dist = { lo: 0, p: Float64Array.of(1) };
  if (((count * (count + 1)) / 2) * sides * sides <= DIRECT_SUM_WORK) {
    const die = dieDist(sides, false);
    for (let d = 0; d < count; d++) cur = convolve(cur, die, work);
    return cur;
  }
  for (let d = 0; d < count; d++) {
    const len = cur.p.length;
    work.spend(len + sides);
    const next = new Float64Array(len + sides - 1);
    let window = 0;
    for (let k = 0; k < next.length; k++) {
      if (k < len) window += cur.p[k];
      if (k >= sides) window -= cur.p[k - sides];
      next[k] = Math.max(0, window) / sides;
    }
    cur = { lo: cur.lo + 1, p: next };
  }
  return cur;
}

/**
 * The sum of the `keep` highest (or lowest) of `count` independent dice with value table `die`.
 * Walks the values from the kept end; the state is (dice placed so far, sum of kept dice), and
 * placing c dice on a value has weight C(remaining, c) × q^c, which is the multinomial law.
 */
function keepSumDist(die: Dist, count: number, keep: number, mode: "kh" | "kl", work: Work): Dist {
  const values: number[] = [];
  for (let i = 0; i < die.p.length; i++) if (die.p[i] > 0) values.push(die.lo + i);
  if (mode === "kh") values.reverse();
  const top = values.reduce((a, v) => Math.max(a, v), 0);
  const width = keep * top + 1;
  work.spend(values.length * ((count + 1) * (count + 2) / 2) * width);

  const binom: number[][] = [];
  for (let n = 0; n <= count; n++) {
    binom[n] = [];
    for (let k = 0; k <= n; k++) binom[n][k] = k === 0 || k === n ? 1 : binom[n - 1][k - 1] + binom[n - 1][k];
  }

  let cur = new Float64Array((count + 1) * width);
  cur[0] = 1;
  for (const v of values) {
    const q = die.p[v - die.lo];
    const pw: number[] = [1];
    for (let c = 1; c <= count; c++) pw[c] = pw[c - 1] * q;
    const next = new Float64Array(cur.length);
    for (let j = 0; j <= count; j++) {
      for (let s = 0; s < width; s++) {
        const w = cur[j * width + s];
        if (w === 0) continue;
        const room = Math.max(0, keep - j);
        for (let c = 0; c <= count - j; c++) {
          const kept = Math.min(c, room);
          next[(j + c) * width + s + v * kept] += w * binom[count - j][c] * pw[c];
        }
      }
    }
    cur = next;
  }
  const p = cur.slice(count * width, (count + 1) * width);
  return { lo: 0, p };
}

function negate(d: Dist): Dist {
  return { lo: -(d.lo + d.p.length - 1), p: Float64Array.from(d.p).reverse() };
}

function groupDist(g: DiceGroup, work: Work): Dist {
  const die = dieDist(g.sides, g.explode === true);
  let dist: Dist;
  if (g.keep && g.keep.n < g.count) {
    dist = keepSumDist(die, g.count, g.keep.n, g.keep.mode, work);
  } else if (!g.explode) {
    dist = plainSumDist(g.count, g.sides, work);
  } else {
    dist = { lo: 0, p: Float64Array.of(1) };
    for (let i = 0; i < g.count; i++) dist = convolve(dist, die, work);
  }
  return g.sign === -1 ? negate(dist) : dist;
}

/**
 * The exact probability of every total of a notation, including keep/drop and exploding dice
 * (with the same 21-face chain cap rollDice uses). Throws DiceError for invalid notation and for
 * expressions too large to count (DICE_LIMITS.maxExactWork), e.g. 100d1000kh50; rolling those is
 * still fine.
 */
export function diceDistribution(notation: string): DiceDistribution {
  const parsed = parseDice(notation);
  const work = new Work();
  let dist: Dist = { lo: parsed.flat, p: Float64Array.of(1) };
  for (const g of parsed.groups) dist = convolve(dist, groupDist(g, work), work);

  // Drop zero tails, clamp float dust and renormalise so the table sums to 1.
  let first = 0;
  let last = dist.p.length - 1;
  while (first < last && dist.p[first] <= 0) first++;
  while (last > first && dist.p[last] <= 0) last--;
  const probs = Array.from(dist.p.subarray(first, last + 1), (x) => Math.max(0, x));
  const sum = probs.reduce((a, b) => a + b, 0);
  let mean = 0;
  for (let i = 0; i < probs.length; i++) {
    probs[i] /= sum;
    mean += probs[i] * (dist.lo + first + i);
  }
  return { min: dist.lo + first, max: dist.lo + last, probs, mean };
}

/** P(total = t). */
export function probEqual(d: DiceDistribution, t: number): number {
  return t < d.min || t > d.max ? 0 : d.probs[t - d.min] ?? 0;
}

/** P(total >= t): the success chance of "roll at least t". */
export function probAtLeast(d: DiceDistribution, t: number): number {
  if (t <= d.min) return 1;
  if (t > d.max) return 0;
  let s = 0;
  for (let i = d.probs.length - 1; i >= t - d.min; i--) s += d.probs[i];
  return Math.min(1, s);
}

/** P(total <= t). */
export function probAtMost(d: DiceDistribution, t: number): number {
  if (t >= d.max) return 1;
  if (t < d.min) return 0;
  let s = 0;
  for (let i = 0; i <= t - d.min; i++) s += d.probs[i];
  return Math.min(1, s);
}
