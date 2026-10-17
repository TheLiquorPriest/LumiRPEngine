// Seeded, portable pseudo-random numbers. Every random draw the engine makes goes through
// one of these generators, so a result is a pure function of its seed string and never
// depends on the clock, Math.random, the platform or the number of earlier draws elsewhere.
//
// Generator: sfc32 (Chris Doty-Humphrey, public domain; 128 bits of state, 32-bit integer
// arithmetic only). The state is seeded from the 128-bit hash of the seed string
// (hashWords from shared/hash), then 15 outputs are discarded. The same seed gives the same
// sequence in the backend, in a child process and in the browser.
//
// Replaces the xmur3 + mulberry32 pair in Warp's engine/dice.ts (32 bits of state, so seeds
// collapsed to four billion streams). See NOTICE.

import { hashParts, hashWords } from "../shared/hash";

/** A seeded random source. Build one with createRng; pass it wherever randomness is needed. */
export interface Rng {
  /** The seed string this stream was built from (for logs and replays). */
  readonly seed: string;
  /** A float in [0, 1) with 53 bits of resolution (two 32-bit draws). */
  next(): number;
  /** A uniform integer in [min, max], both inclusive and both safe integers; range at most 2^32. No modulo bias. */
  int(min: number, max: number): number;
  /** A uniformly chosen element. Throws RangeError on an empty array. */
  pick<T>(items: readonly T[]): T;
  /**
   * An element chosen with probability proportional to its weight. Weights must be finite and
   * non-negative with a positive total; zero-weight items are never chosen. Items are scanned in
   * array order, so equal draws always resolve to the same item.
   */
  weighted<T>(items: readonly { readonly value: T; readonly weight: number }[]): T;
  /**
   * An independent child stream derived from this stream's seed and a label. It does not read or
   * advance this stream, so adding or removing draws on the parent never changes any child.
   * Forking the same label twice gives identical streams.
   */
  fork(label: string): Rng;
}

const TWO_32 = 4294967296;
const WARMUP = 15;

/** Create a stream from a seed string. Equal seeds give equal sequences on every platform. */
export function createRng(seed: string): Rng {
  if (typeof seed !== "string") throw new TypeError("createRng: seed must be a string");

  let [a, b, c, d] = hashWords("lre-rng-v1", seed);
  a |= 0; b |= 0; c |= 0; d |= 0;

  const u32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < WARMUP; i++) u32();

  const next = (): number => {
    const hi = u32() >>> 5; // 27 bits
    const lo = u32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 2 ** 53;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) throw new RangeError(`int(${min}, ${max}): bounds must be safe integers`);
    if (min > max) throw new RangeError(`int(${min}, ${max}): min is greater than max`);
    const range = max - min + 1;
    if (range > TWO_32) throw new RangeError(`int(${min}, ${max}): range is larger than 2^32`);
    // Rejection sampling: drop the draws that would make some values more likely than others.
    const limit = TWO_32 - (TWO_32 % range);
    let x = u32();
    while (x >= limit) x = u32();
    return min + (x % range);
  };

  return {
    seed,
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("pick: empty array");
      return items[int(0, items.length - 1)];
    },
    weighted<T>(items: readonly { readonly value: T; readonly weight: number }[]): T {
      if (items.length === 0) throw new RangeError("weighted: no items");
      let top = 0;
      for (const it of items) {
        if (typeof it.weight !== "number" || !Number.isFinite(it.weight) || it.weight < 0) {
          throw new RangeError(`weighted: weights must be finite and non-negative, got ${String(it.weight)}`);
        }
        if (it.weight > top) top = it.weight;
      }
      if (top === 0) throw new RangeError("weighted: total weight is zero");
      // Scale by the largest weight so the sum cannot overflow.
      let total = 0;
      for (const it of items) total += it.weight / top;
      const x = next() * total;
      let cum = 0;
      let last = -1;
      for (let i = 0; i < items.length; i++) {
        const w = items[i].weight / top;
        if (w === 0) continue;
        last = i;
        cum += w;
        if (x < cum) return items[i].value;
      }
      return items[last].value; // rounding left x at the very top of the range
    },
    fork(label: string): Rng {
      if (typeof label !== "string") throw new TypeError("fork: label must be a string");
      return createRng(hashParts("lre-rng-fork-v1", seed, label));
    },
  };
}
