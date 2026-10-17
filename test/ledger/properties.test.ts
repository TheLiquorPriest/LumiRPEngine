// The ledger gate (DESIGN §14, §17): generated operation sequences on the fake host, with the
// reference fold as oracle and the named invariants checked after every operation.
//
//   LRE_PROPERTY_RUNS   sequences per run (CI: 10000; default 200)
//   LRE_PROPERTY_OPS    longest sequence (CI: 200; default 60)
//   LRE_PROPERTY_SEED   replay one seed
// Every failing seed is shrunk and must be added to test/ledger/regressions.json.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Harness } from "../support/harness";
import { runSequence, sequenceFor, shrink, type Coverage, type Op } from "../support/ops";

const RUNS = Number(process.env.LRE_PROPERTY_RUNS ?? "200");
const MAX_OPS = Number(process.env.LRE_PROPERTY_OPS ?? "60");
const ONE = process.env.LRE_PROPERTY_SEED;
/** Seeds are `<base>-<i>`: fixed by default, so every run of this file is the same; set a base to explore new ones. */
const BASE = process.env.LRE_PROPERTY_BASE ?? "lre-fixed";
/** The first seed index (`LRE_PROPERTY_FROM`), so a long run can be split into shards that together cover `<base>-0…`. */
const FROM = Number(process.env.LRE_PROPERTY_FROM ?? "0");

interface Regression {
  seed: string;
  ops: Op[];
  note: string;
}

const regressions = JSON.parse(readFileSync(join(import.meta.dir, "regressions.json"), "utf8")) as Regression[];
const make = () => new Harness();

async function failWith(seed: string, ops: Op[], error: string): Promise<never> {
  const small = await shrink(make, ops, error);
  throw new Error(`seed ${seed} failed: ${small.error}\nshrunk to ${small.ops.length} ops:\n${JSON.stringify(small.ops)}`);
}

describe("ledger property suite", () => {
  test.each(regressions.map((r) => [r.seed, r] as const))("regression %s", async (_seed, r) => {
    expect(await runSequence(make, r.ops)).toBeNull();
  });

  test(
    `${ONE ? `seed ${ONE}` : `${RUNS} generated sequences`} hold every invariant`,
    async () => {
      const seeds = ONE ? [ONE] : Array.from({ length: RUNS }, (_, i) => `${BASE}-${FROM + i}`);
      const coverage: Coverage = { fundsDrops: 0, groupDrops: 0, carried: 0, carryDrops: 0 };
      for (const [i, seed] of seeds.entries()) {
        const ops = sequenceFor(seed, MAX_OPS);
        // L31: every tenth sequence runs twice and must end identically.
        const first: string[] = [];
        const error = await runSequence(make, ops, i % 10 === 0 ? first : undefined, coverage);
        if (error) await failWith(seed, ops, error);
        if (i % 10 === 0) {
          const second: string[] = [];
          await runSequence(make, ops, second);
          if (second.join("\n") !== first.join("\n")) throw new Error(`seed ${seed} failed: L31: two runs of the same operations ended differently`);
        }
      }
      // L40/L41 coverage: the generated runs do rebase a payment, and a grouped purchase, onto a branch
      // that can't cover it (counted by this test's own runners; deterministic for the fixed base).
      // L43 coverage: Re-runs do carry fixes forward, and drop ones that no longer apply.
      if (!ONE && RUNS >= 100) expect(coverage.fundsDrops).toBeGreaterThan(0);
      if (!ONE && RUNS >= 100) expect(coverage.groupDrops).toBeGreaterThan(0);
      if (!ONE && RUNS >= 100) expect(coverage.carried).toBeGreaterThan(0);
      if (!ONE && RUNS >= 100) expect(coverage.carryDrops).toBeGreaterThan(0);
    },
    24 * 60 * 60 * 1000,
  );
});
