// The ledger gate's regression set (DESIGN §14): every generated sequence that ever failed, shrunk,
// replayed on every run. Each must hold every invariant, as in the property suite.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Harness } from "../support/harness";
import { runSequence, type Op } from "../support/ops";

interface Regression {
  seed: string;
  ops: Op[];
  note: string;
}

const regressions = JSON.parse(readFileSync(join(import.meta.dir, "regressions.json"), "utf8")) as Regression[];

describe("ledger regressions", () => {
  test.each(regressions.map((r) => [r.seed, r] as const))("regression %s", async (_seed, r) => {
    expect(await runSequence(() => new Harness(), r.ops)).toBeNull();
  });
});
