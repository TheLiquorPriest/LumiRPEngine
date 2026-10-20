// The ledger gate (DESIGN §14): generated operation sequences on the fake host, with the
// reference fold as oracle and the ledger invariants checked after every operation. It runs at
// release (`bun run test:release`, in shards); regressions.test.ts replays the failures on every run.
//
//   LRE_PROPERTY_RUNS      sequences per run (default 200)
//   LRE_PROPERTY_OPS       longest sequence (default 60)
//   LRE_PROPERTY_SEED      replay one seed
//   LRE_PROPERTY_COVERAGE  write the run's coverage counts to this file, for a run split into shards
// Every failing seed is shrunk and must be added to test/ledger/regressions.json.

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { Harness } from "../support/harness";
import { coverageGaps, noCoverage, type Coverage } from "../support/coverage";
import { runSequence, sequenceFor, shrink, type Op } from "../support/ops";

const RUNS = Number(process.env.LRE_PROPERTY_RUNS ?? "200");
const MAX_OPS = Number(process.env.LRE_PROPERTY_OPS ?? "60");
const ONE = process.env.LRE_PROPERTY_SEED;
/** Seeds are `<base>-<i>`: fixed by default, so every run of this file is the same; set a base to explore new ones. */
const BASE = process.env.LRE_PROPERTY_BASE ?? "lre-fixed";
/** The first seed index (`LRE_PROPERTY_FROM`), so a long run can be split into shards that together cover `<base>-0…`. */
const FROM = Number(process.env.LRE_PROPERTY_FROM ?? "0");
const COVERAGE_FILE = process.env.LRE_PROPERTY_COVERAGE;

const make = () => new Harness();

async function failWith(seed: string, ops: Op[], error: string): Promise<never> {
  const small = await shrink(make, ops, error);
  throw new Error(`seed ${seed} failed: ${small.error}\nshrunk to ${small.ops.length} ops:\n${JSON.stringify(small.ops)}`);
}

describe("ledger property suite", () => {
  test(
    `${ONE ? `seed ${ONE}` : `${RUNS} generated sequences`} hold every invariant`,
    async () => {
      const seeds = ONE ? [ONE] : Array.from({ length: RUNS }, (_, i) => `${BASE}-${FROM + i}`);
      const coverage: Coverage = noCoverage();
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
      // A shard's counts are added up with the other shards' and held to the whole run's coverage.
      if (COVERAGE_FILE && !ONE) writeFileSync(COVERAGE_FILE, JSON.stringify({ base: BASE, from: FROM, runs: RUNS, coverage }));
      // Coverage the runs must reach (counted by this test's own runners; deterministic for the fixed base).
      if (!ONE) expect(coverageGaps(coverage, RUNS)).toEqual([]);
    },
    24 * 60 * 60 * 1000,
  );
});
