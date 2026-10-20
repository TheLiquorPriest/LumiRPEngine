// Name checks at scale (DESIGN §9.6): every section's lines are checked against every name the POV
// can't see, so each name's patterns are compiled once, not once per line, and the answers stay
// those of a fresh check.

import { describe, expect, test } from "bun:test";
import { namesAny } from "../../src/engine/visibility";

/** Runs `check`, counting the regular expressions it compiles. */
function compiling(check: () => void): number {
  const Real = globalThis.RegExp;
  let compiled = 0;
  globalThis.RegExp = new Proxy(Real, {
    construct: (target, args: [string | RegExp, string?]) => {
      compiled++;
      return Reflect.construct(target, args);
    },
  });
  try {
    check();
  } finally {
    globalThis.RegExp = Real;
  }
  return compiled;
}

describe("name checks at scale", () => {
  test("checking many lines against many hidden names compiles each name's patterns once", () => {
    const people = Array.from({ length: 120 }, (_, i) => `Wren Halloway${i}`);
    const labels = Array.from({ length: 80 }, (_, i) => `The Sunken Vault ${i}`);
    const lines = Array.from({ length: 40 }, (_, i) => `Line ${i}: the rain keeps on over the harbor.`);
    const compiled = compiling(() => {
      for (const line of lines) expect(namesAny(line, people, labels)).toBe(false);
    });
    // Two spellings (plain and as written) of each person's two words and of each label.
    expect(compiled).toBeLessThanOrEqual(2 * (2 * people.length + labels.length) + lines.length);
    expect(namesAny("Halloway7 is watching.", people, labels)).toBe(true);
    expect(namesAny("They meet under the sunken vault 12.", people, labels)).toBe(true);
    expect(namesAny("They meet under a sunken vault.", people, labels)).toBe(false);
  });
});
