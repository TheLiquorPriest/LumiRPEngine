// Dice notation: parsing, rolling through an injected seeded Rng, and exact outcome odds.
//
// Adapted from Warp's engine/dice.ts (see NOTICE). Every roll the engine makes goes through an
// Rng from engine/rng, so a roll is reproducible from its seed and never touched by a model.
// diceDistribution() counts every total exactly, in whole numbers of equally likely results, not by
// sampling or summing probabilities, so the odds the palette shows are the odds rollDice() really
// has, each rounded once from its exact fraction (`share`).
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
//     the total to bands", and probAtLeast(d, target) is the success chance. What tabletop checks
//     need on top is notation-level too: the natural die (`naturalDie`, the face `natural` bands
//     read), advantage as more natural dice (`withAdvantage`), an opposed roll as one notation
//     (`opposedDice`) and the joint law of the natural die and the total (`naturalSplit`).

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
  /**
   * counts[i] is how many of the expression's `outcomes` equally likely results total min + i,
   * counted exactly. An exploding die counts every sequence of its `maxExplodeExtra + 1` rolls.
   */
  readonly counts: readonly bigint[];
  /** How many equally likely results the expression has: the counts' sum. */
  readonly outcomes: bigint;
  /** probs[i] is counts[i] / outcomes rounded once: the probability that the total equals min + i. */
  readonly probs: readonly number[];
  /** Expected total, rounded once from its exact fraction. */
  readonly mean: number;
}

/** Exact counts of equally likely results over consecutive integers starting at `lo`. */
interface Dist {
  lo: number;
  w: bigint[];
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

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `num / den` as a number, rounded once (`den` is positive). Within 2^53 both are exact doubles and
 * one division rounds the fraction to its nearest double: the double a decimal of the same value
 * reads as, so 19 / 20 is 0.95, exactly as `0.95` is. Past 2^53 the quotient is first taken to 64
 * significant bits, which keeps it within one unit in the last place.
 */
export function share(num: bigint, den: bigint): number {
  if (num === 0n) return 0;
  const negative = num < 0n;
  const n = negative ? -num : num;
  let q: number;
  if (n <= MAX_SAFE && den <= MAX_SAFE) q = Number(n) / Number(den);
  else {
    const shift = Math.max(0, 64 + den.toString(2).length - n.toString(2).length);
    q = Number((n << BigInt(shift)) / den);
    // Scaled back a power of two at a time, so no single step overflows or underflows.
    for (let left = shift; left > 0; left -= 1000) q *= 2 ** -Math.min(left, 1000);
  }
  return negative ? -q : q;
}

function convolve(a: Dist, b: Dist, work: Work): Dist {
  work.spend(a.w.length * b.w.length);
  const w = new Array<bigint>(a.w.length + b.w.length - 1).fill(0n);
  for (let i = 0; i < a.w.length; i++) {
    const ai = a.w[i];
    if (ai === 0n) continue;
    for (let j = 0; j < b.w.length; j++) w[i + j] += ai * b.w[j];
  }
  return { lo: a.lo + b.lo, w };
}

/**
 * The value counts of one die: each face once; or an exploding die's chains, counted over every
 * sequence of its `maxExplodeExtra + 1` rolls. A chain of m maximums and then a lower face leaves
 * the rest of the sequence free, so it stands for sides^(maxExplodeExtra − m) sequences; the whole
 * chain at the maximum stands for one.
 */
function dieDist(sides: number, explode: boolean): Dist {
  if (!explode) return { lo: 1, w: new Array<bigint>(sides).fill(1n) };
  const rolls = DICE_LIMITS.maxExplodeExtra + 1;
  const s = BigInt(sides);
  const w = new Array<bigint>(rolls * sides).fill(0n);
  for (let m = 0; m < rolls; m++) {
    const sequences = s ** BigInt(rolls - 1 - m);
    for (let f = 1; f < sides; f++) w[m * sides + f - 1] = sequences;
  }
  w[rolls * sides - 1] = 1n;
  return { lo: 1, w };
}

/**
 * Sum of `count` plain dice with `sides` faces, by a sliding window, O(count × support). It counts
 * exactly, so even the far tails are exact (all ones is one result of sides^count). A plain sum's
 * counts read the same from either end, so each step runs the window to the middle and mirrors it.
 */
function plainSumDist(count: number, sides: number, work: Work): Dist {
  let cur: Dist = { lo: 0, w: [1n] };
  for (let d = 0; d < count; d++) {
    const len = cur.w.length;
    const size = len + sides - 1;
    work.spend(len + sides);
    const next = new Array<bigint>(size);
    const half = Math.ceil(size / 2);
    let window = 0n;
    for (let k = 0; k < half; k++) {
      if (k < len) window += cur.w[k];
      if (k >= sides) window -= cur.w[k - sides];
      next[k] = window;
    }
    for (let k = half; k < size; k++) next[k] = next[size - 1 - k];
    cur = { lo: cur.lo + 1, w: next };
  }
  return cur;
}

/**
 * The sum of the `keep` highest (or lowest) of `count` independent dice with value counts `die`.
 * Walks the values from the kept end; the state is (dice placed so far, sum of kept dice), and
 * placing c dice on a value counts C(remaining, c) × q^c results, which is the multinomial law.
 */
function keepSumDist(die: Dist, count: number, keep: number, mode: "kh" | "kl", work: Work): Dist {
  const values: number[] = [];
  for (let i = 0; i < die.w.length; i++) if (die.w[i] > 0n) values.push(die.lo + i);
  if (mode === "kh") values.reverse();
  const top = values.reduce((a, v) => Math.max(a, v), 0);
  const width = keep * top + 1;
  work.spend(values.length * ((count + 1) * (count + 2) / 2) * width);

  const binom: bigint[][] = [];
  for (let n = 0; n <= count; n++) {
    binom[n] = [];
    for (let k = 0; k <= n; k++) binom[n][k] = k === 0 || k === n ? 1n : binom[n - 1][k - 1] + binom[n - 1][k];
  }

  let cur = new Array<bigint>((count + 1) * width).fill(0n);
  cur[0] = 1n;
  for (const v of values) {
    const q = die.w[v - die.lo];
    const pw: bigint[] = [1n];
    for (let c = 1; c <= count; c++) pw[c] = pw[c - 1] * q;
    const next = new Array<bigint>(cur.length).fill(0n);
    for (let j = 0; j <= count; j++) {
      for (let s = 0; s < width; s++) {
        const w = cur[j * width + s];
        if (w === 0n) continue;
        const room = Math.max(0, keep - j);
        for (let c = 0; c <= count - j; c++) {
          const kept = Math.min(c, room);
          next[(j + c) * width + s + v * kept] += w * binom[count - j][c] * pw[c];
        }
      }
    }
    cur = next;
  }
  return { lo: 0, w: cur.slice(count * width, (count + 1) * width) };
}

function negate(d: Dist): Dist {
  return { lo: -(d.lo + d.w.length - 1), w: [...d.w].reverse() };
}

function groupDist(g: DiceGroup, work: Work): Dist {
  const die = dieDist(g.sides, g.explode === true);
  let dist: Dist;
  if (g.keep && g.keep.n < g.count) {
    dist = keepSumDist(die, g.count, g.keep.n, g.keep.mode, work);
  } else if (!g.explode) {
    dist = plainSumDist(g.count, g.sides, work);
  } else {
    dist = { lo: 0, w: [1n] };
    for (let i = 0; i < g.count; i++) dist = convolve(dist, die, work);
  }
  return g.sign === -1 ? negate(dist) : dist;
}

/** The sum of every total times its count: the mean's numerator over `outcomes`. */
function totalOf(min: number, counts: readonly bigint[]): bigint {
  let total = 0n;
  for (let i = 0; i < counts.length; i++) total += counts[i] * BigInt(min + i);
  return total;
}

/** Drops the zero tails; each share and the mean are rounded once from their exact fractions. */
function finish(dist: Dist): DiceDistribution {
  let first = 0;
  let last = dist.w.length - 1;
  while (first < last && dist.w[first] === 0n) first++;
  while (last > first && dist.w[last] === 0n) last--;
  const counts = dist.w.slice(first, last + 1);
  const min = dist.lo + first;
  const outcomes = counts.reduce((a, b) => a + b, 0n);
  return { min, max: dist.lo + last, counts, outcomes, probs: counts.map((c) => share(c, outcomes)), mean: share(totalOf(min, counts), outcomes) };
}

/**
 * The exact counts of every total of a notation, including keep/drop and exploding dice (with the
 * same 21-face chain cap rollDice uses). Throws DiceError for invalid notation and for expressions
 * too large to count (DICE_LIMITS.maxExactWork), e.g. 100d1000kh50; rolling those is still fine.
 */
export function diceDistribution(notation: string): DiceDistribution {
  const parsed = parseDice(notation);
  const work = new Work();
  let dist: Dist = { lo: parsed.flat, w: [1n] };
  for (const g of parsed.groups) dist = convolve(dist, groupDist(g, work), work);
  return finish(dist);
}

/**
 * The expected total rounded down, exactly: the dice's average as a passive score reads it (10 on
 * a d20, 7 on 2d6, 0 on an opposed d20), never a float a hair below a whole number.
 */
export function meanFloor(d: DiceDistribution): number {
  const total = totalOf(d.min, d.counts);
  const q = total / d.outcomes;
  // BigInt division truncates toward zero; a negative total with a remainder floors one lower.
  return Number(total < 0n && q * d.outcomes !== total ? q - 1n : q);
}

// ───────────────────────────── the natural die, advantage, opposed rolls ─────────────────────────────

/**
 * A notation's natural die: its first dice term when that term keeps exactly one plain die (`d20`,
 * `2d20kh1`, `3d20kl1`), else null (`3d6`, `4d6kh3`, an exploding `d6!`). Its face is
 * `DiceRoll.natural`; checks match `natural` bands and apply advantage on it.
 */
export function naturalDie(parsed: ParsedDice): DiceGroup | null {
  const g = parsed.groups[0];
  if (!g || g.explode) return null;
  const kept = g.keep && g.keep.n < g.count ? g.keep.n : g.count;
  return kept === 1 ? g : null;
}

/** Writes parsed dice back as notation: the terms in order, then the flat part (`2d20kh1+1d4-1`). */
export function formatDice(parsed: Pick<ParsedDice, "groups" | "flat">): string {
  let out = "";
  parsed.groups.forEach((g, i) => {
    const sign = g.sign === -1 ? "-" : i === 0 ? "" : "+";
    const keep = g.keep && g.keep.n < g.count ? `${g.keep.mode}${g.keep.n}` : "";
    out += `${sign}${g.count}d${g.sides}${keep}${g.explode ? "!" : ""}`;
  });
  if (parsed.flat !== 0) out += parsed.flat > 0 ? `+${parsed.flat}` : `-${-parsed.flat}`;
  return out;
}

/**
 * The notation with advantage applied: +1 rolls one more natural die and keeps the highest, −1 one
 * more and keeps the lowest (`d20` → `2d20kh1` or `2d20kl1`, `d100` → `2d100kh1`). A notation that
 * already keeps one of several counts its extra dice signed, so the two cancel a die at a time
 * (`2d20kh1` with +1 is `3d20kh1`, with −1 is `1d20`). Other terms and the flat part are untouched.
 * Zero returns the notation as it is; null when it has no natural die to apply the advantage to.
 */
export function withAdvantage(notation: string, advantage: number): string | null {
  if (advantage === 0) return notation;
  const parsed = parseDice(notation);
  const die = naturalDie(parsed);
  if (!die) return null;
  const extra = (die.count - 1) * (die.keep?.mode === "kl" ? -1 : 1) + Math.sign(advantage);
  const count = Math.abs(extra) + 1;
  if (count > DICE_LIMITS.maxCount) return null;
  const next: DiceGroup = { count, sides: die.sides, sign: die.sign, ...(extra !== 0 ? { keep: { mode: extra > 0 ? "kh" : "kl", n: 1 } } : {}) };
  return formatDice({ groups: [next, ...parsed.groups.slice(1)], flat: parsed.flat });
}

/**
 * An opposed roll as one notation: `a` minus `b` (`1d20` against `1d20+2` is `1d20-1d20-2`), so its
 * exact odds come from one distribution and its natural die stays `a`'s. Throws DiceError when the
 * combination leaves the notation's limits.
 */
export function opposedDice(a: string, b: string): string {
  const pa = parseDice(a);
  const pb = parseDice(b);
  const flipped = pb.groups.map((g): DiceGroup => ({ ...g, sign: g.sign === 1 ? -1 : 1 }));
  const out = formatDice({ groups: [...pa.groups, ...flipped], flat: pa.flat - pb.flat });
  parseDice(out);
  return out;
}

/**
 * The exact joint law of a notation's natural die and the rest of its total. The natural face and
 * the sum of the other terms plus the flat part are independent, so the results with natural = n
 * and total = t number `natural(n) × rest(t − sign·n)`, out of `natural.outcomes × rest.outcomes`.
 * Null when the notation has no natural die.
 */
export function naturalSplit(notation: string): { sign: 1 | -1; natural: DiceDistribution; rest: DiceDistribution } | null {
  const parsed = parseDice(notation);
  const die = naturalDie(parsed);
  if (!die) return null;
  const work = new Work();
  let rest: Dist = { lo: parsed.flat, w: [1n] };
  for (const g of parsed.groups.slice(1)) rest = convolve(rest, groupDist(g, work), work);
  return { sign: die.sign, natural: finish(groupDist({ ...die, sign: 1 }, work)), rest: finish(rest) };
}

/** P(total = t). */
export function probEqual(d: DiceDistribution, t: number): number {
  return t < d.min || t > d.max ? 0 : share(d.counts[t - d.min] ?? 0n, d.outcomes);
}

/** P(total >= t): the success chance of "roll at least t", counted, then rounded once. */
export function probAtLeast(d: DiceDistribution, t: number): number {
  if (t <= d.min) return 1;
  if (t > d.max) return 0;
  let made = 0n;
  for (let i = t - d.min; i < d.counts.length; i++) made += d.counts[i];
  return share(made, d.outcomes);
}

/** P(total <= t), counted, then rounded once. */
export function probAtMost(d: DiceDistribution, t: number): number {
  if (t >= d.max) return 1;
  if (t < d.min) return 0;
  let made = 0n;
  for (let i = 0; i <= t - d.min; i++) made += d.counts[i];
  return share(made, d.outcomes);
}
