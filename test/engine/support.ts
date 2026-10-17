import type { Rng } from "../../src/engine/rng";

/**
 * Run `fn` with the ambient sources of nondeterminism (Math.random, Date, performance.now)
 * replaced by functions that throw, then restore them. Proves the code under test never reads
 * them; it must stay synchronous and must not call test assertions inside.
 */
export function withoutAmbient<T>(fn: () => T): T {
  const realRandom = Math.random;
  const RealDate = globalThis.Date;
  const realPerfNow = performance.now.bind(performance);
  const forbidden = (what: string) => () => { throw new Error(`${what} used inside a deterministic function`); };
  Math.random = forbidden("Math.random");
  performance.now = forbidden("performance.now");
  globalThis.Date = new Proxy(RealDate, {
    construct: forbidden("new Date()"),
    apply: forbidden("Date()"),
    get(target, prop) {
      if (prop === "now") return forbidden("Date.now");
      return Reflect.get(target, prop);
    },
  });
  try {
    return fn();
  } finally {
    Math.random = realRandom;
    performance.now = realPerfNow;
    globalThis.Date = RealDate;
  }
}

/** Call `fn`, which must throw an instance of `cls`; return it. */
export function thrown<E extends Error>(cls: new (...args: never[]) => E, fn: () => unknown): E {
  try {
    fn();
  } catch (e) {
    if (e instanceof cls) return e;
    throw e;
  }
  throw new Error(`expected ${cls.name} to be thrown`);
}

/** Chi-square statistic of observed counts against equal expected counts. */
export function chiSquareUniform(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / counts.length;
  return counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
}

/**
 * Every outcome of a function that rolls dice through `rng.int`, with its exact probability.
 * Explores the whole decision tree: each run is replayed with a different sequence of choices.
 * `run` receives an Rng whose int() is the only usable method and returns the outcome key.
 */
export function enumerateOutcomes(run: (rng: Rng) => number): Map<number, number> {
  const tally = new Map<number, number>();
  const choices: number[] = [];
  for (;;) {
    const sizes: number[] = [];
    const rng: Rng = {
      seed: "enumerate",
      int(min, max) {
        const pos = sizes.length;
        sizes.push(max - min + 1);
        if (pos >= choices.length) choices.push(0);
        return min + choices[pos];
      },
      next() { throw new Error("next() not expected"); },
      pick() { throw new Error("pick() not expected"); },
      weighted() { throw new Error("weighted() not expected"); },
      fork() { throw new Error("fork() not expected"); },
    };
    const key = run(rng);
    choices.length = sizes.length;
    const p = sizes.reduce((acc, s) => acc / s, 1);
    tally.set(key, (tally.get(key) ?? 0) + p);
    let i = sizes.length - 1;
    while (i >= 0 && choices[i] === sizes[i] - 1) i--;
    if (i < 0) return tally;
    choices[i]++;
    choices.length = i + 1;
  }
}

/** An Rng that plays back scripted ints and records the (min, max) of every request. */
export function scriptedRng(values: readonly number[]): Rng & { calls: [number, number][] } {
  const calls: [number, number][] = [];
  let i = 0;
  return {
    seed: "scripted",
    calls,
    int(min, max) {
      calls.push([min, max]);
      if (i >= values.length) throw new Error("script exhausted");
      const v = values[i++];
      if (v < min || v > max) throw new Error(`scripted value ${v} outside ${min}..${max}`);
      return v;
    },
    next() { throw new Error("next() not expected"); },
    pick() { throw new Error("pick() not expected"); },
    weighted() { throw new Error("weighted() not expected"); },
    fork() { throw new Error("fork() not expected"); },
  };
}
