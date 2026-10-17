// Typed decisions ("System 1" questions) and the rule that goes with them: a model only ever
// returns probabilities; when the engine needs an actual pick it samples from them with its own
// seeded Rng. The same probabilities, the same seed and the same draw count always give the same
// pick, whatever order the model happened to list its options in.
//
// Adapted from Warp's engine/decide.ts (see NOTICE). The question and answer shapes mirror the
// Decision API's choice / score / noul primitives so any provider can fill them in.
//
// Tie-breaking and ordering. Options are visited in a canonical order: the `keys` array when the
// caller passes one (normally the author's criteria order), otherwise sorted by UTF-16 code
// units. Object key insertion order is never used. A draw lands on the first option whose
// cumulative share exceeds it, so an exact boundary belongs to the later option and an option
// with probability 0 can never be picked. mostLikely breaks exact ties toward the earlier option.
//
// Deliberate differences from Warp:
//   * Invalid probabilities throw DecideError (NaN, Infinity, negative, not a number). Warp
//     silently counted them as 0, which let a malformed model answer through. A missing key is
//     still 0.
//   * An answer with no probability mass at all throws. Warp spread it uniformly, which turned
//     "the model said nothing" into a random pick; the caller now decides the fallback.
//   * sample() could return a zero-probability option when the draw was exactly 0 and the first
//     option had probability 0; it cannot now.
//   * sample() draws in canonical order instead of insertion order.
//   * normalize() cannot overflow: weights are scaled by the largest before summing.
//   * The Decider/DecideOptions interfaces are dropped: they were tied to Warp's two providers
//     ("jev" | "llm"), and the engine's provider abstraction lives elsewhere.

import type { Rng } from "./rng";

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export type Answer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number };

export type Questions = Record<string, Question>;
export type Answers = Record<string, Answer>;

/** A probability map or answer that cannot be used. */
export class DecideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecideError";
  }
}

type Probs = Readonly<Record<string, number>>;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The options to consider, in canonical order. */
function orderedKeys(p: Probs, keys?: readonly string[]): string[] {
  const ks = keys ? [...keys] : Object.keys(p).sort();
  if (ks.length === 0) throw new DecideError("No options to choose from");
  if (new Set(ks).size !== ks.length) throw new DecideError("Duplicate option keys");
  return ks;
}

/** Validated raw weights for the keys, in order. Missing or undefined entries are 0. */
function weightsOf(p: Probs, ks: readonly string[]): number[] {
  return ks.map((k) => {
    const v: unknown = hasOwn(p, k) ? p[k] : undefined;
    if (v === undefined) return 0;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new DecideError(`Probability for "${k}" must be a finite number ≥ 0, got ${String(v)}`);
    }
    return v;
  });
}

/** Validated, normalized probabilities as parallel arrays in canonical order (object key order is never relied on). */
function normalized(p: Probs, keys?: readonly string[]): { ks: string[]; probs: number[] } {
  const ks = orderedKeys(p, keys);
  const w = weightsOf(p, ks);
  const top = Math.max(...w);
  if (top === 0) throw new DecideError("Probabilities have no mass (all zero)");
  // Scaling by the largest weight keeps the sum from overflowing and from underflowing to 0.
  const scaled = w.map((x) => x / top);
  const sum = scaled.reduce((a, b) => a + b, 0);
  return { ks, probs: scaled.map((x) => x / sum) };
}

/**
 * Probabilities that sum to 1 over `keys` (default: every key of `p`, sorted). Entries must be
 * finite and non-negative; missing keys count as 0; keys of `p` that are not in `keys` are
 * ignored. Throws DecideError if there is nothing to choose from or every weight is 0. (The
 * returned object follows JavaScript's property order, which lists integer-like keys such as
 * "10" first; use `keys` plus sample/mostLikely when order matters.)
 */
export function normalize(p: Probs, keys?: readonly string[]): Record<string, number> {
  const { ks, probs } = normalized(p, keys);
  return Object.fromEntries(ks.map((k, i) => [k, probs[i]]));
}

/** Weighted draw — the engine's dice, the model's odds. See the header for ordering and ties. */
export function sample(p: Probs, rng: Pick<Rng, "next">, keys?: readonly string[]): string {
  const { ks, probs } = normalized(p, keys);
  const u = rng.next();
  let cum = 0;
  let last = 0;
  for (let i = 0; i < ks.length; i++) {
    if (probs[i] === 0) continue;
    last = i;
    cum += probs[i];
    if (u < cum) return ks[i];
  }
  return ks[last]; // rounding left u at the very top of the range
}

/** The option with the highest probability; exact ties go to the earlier option in canonical order. */
export function mostLikely(p: Probs, keys?: readonly string[]): string {
  const ks = orderedKeys(p, keys);
  const w = weightsOf(p, ks);
  if (Math.max(...w) === 0) throw new DecideError("Probabilities have no mass (all zero)");
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
  return ks[best];
}

function checkNoul(p: number): void {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
    throw new DecideError(`A yes/no probability must be a number from 0 to 1, got ${String(p)}`);
  }
}

/** Resolve a yes/no answer: true with probability p (a draw below p). p = 0 never, p = 1 always. */
export function sampleNoul(p: number, rng: Pick<Rng, "next">): boolean {
  checkNoul(p);
  return rng.next() < p;
}

/** How sure a yes/no answer is: 0 at 50/50, 1 at certainty. */
export function noulConfidence(p: number): number {
  checkNoul(p);
  return Math.abs(2 * p - 1);
}

/** Map a fractional score (0..levels-1) to the nearest index; null for a non-score answer or a non-finite score. */
export function scoreIndex(a: Answer | undefined, levels: number): number | null {
  if (!a || a.type !== "score" || !Number.isFinite(a.score) || !Number.isInteger(levels) || levels < 1) return null;
  return Math.max(0, Math.min(levels - 1, Math.round(a.score)));
}
