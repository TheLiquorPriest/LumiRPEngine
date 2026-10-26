// The engine's copy of a chat's messages (DESIGN §9.6) under the ledger gate's generated sequences:
// typed turns (some re-rendered by the host, some saved at the end), Regenerates and Re-narrates,
// Continues and their stops, Edit and Send in place and as a branch, swipes added, rewritten,
// navigated and deleted, messages edited and deleted, branches, imports, restarts, foreign writes and
// replies under way while the chat changes. The ledger reads and writes every chat through the copy,
// as the runtime does. After every operation the copy holds what the host reads, a chat was read
// whole once since the backend started or forgot it (`Runner.check`), and every ledger invariant
// holds as it does without the copy.

import { describe, test } from "bun:test";
import { Harness } from "../support/harness";
import { Runner, sequenceFor } from "../support/ops";

const RUNS = Number(process.env.LRE_COPY_RUNS ?? "24");
const MAX_OPS = 40;

describe("the copy of a chat's messages, under generated sequences", () => {
  test(
    `${RUNS} sequences: after every operation the copy equals the host's read, and each chat was read whole once since the start`,
    async () => {
      for (let i = 0; i < RUNS; i++) {
        const seed = `lre-copy-${i}`;
        const runner = new Runner(new Harness("fresh", { copy: true }));
        await runner.init();
        try {
          for (const op of sequenceFor(seed, MAX_OPS)) {
            await runner.run(op);
            await runner.earlierBuildStarts();
            await runner.check();
          }
        } catch (error) {
          throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    600_000,
  );
});
