// No pair sent over a running run (PlanGates-4-fix1 item 2; finding 12): the next pair is sent only once
// RPE's run has ended; a run still going at the floor's limit stops the floor, the table names the pair
// and says its run was still going, the run after the reply counts that run as longer than the limit in
// its median and its longest, and the rows that need ten pairs are then not judged.

import { describe, expect, test } from "bun:test";
import { LINES } from "../../../scripts/testbed/floor-fixture";
import { afterReply, LIMITS } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { partOf, playReplay } from "./replay";

/** A recorded tag-form run whose fifth RPE run never ends: at the floor's limit it is still going. */
function fifthNeverEnds() {
  const run = recordedRun({ form: "tag" });
  const fifth = run.turns.find((t) => t.arm === "rpe" && t.pair === 5)?.rpe;
  if (fifth === undefined || fifth === null) throw new Error("no fifth RPE turn");
  fifth.status = "running";
  fifth.timings = { ...fifth.timings, ended: null };
  return run;
}

describe("no pair sent over a running run", () => {
  test("a fifth RPE run that never ends: no sixth pair is sent, and the table and the run after the reply say so", async () => {
    const played = await playReplay({ run: fifthNeverEnds() });
    // Five pairs, plain then RPE: ten lines sent, and nothing after the fifth RPE turn.
    expect(played.sent).toHaveLength(10);
    expect(played.sent.at(-1)).toEqual({ connection: "rpe-floor", line: LINES[9] });
    expect(played.table).toContain(`STOPPED: pair 5: RPE's run was still going ${LIMITS.runEnd / 60_000} min after the reply (LIMITS.runEnd), so no later pair was sent over it.`);
    expect(played.table).toContain(`longest longer than ${LIMITS.runEnd / 60_000} min`);
    expect(played.table).toContain(`still going at the floor's limit of ${LIMITS.runEnd / 60_000} min: pair 5`);
    // The rows that need ten pairs are not judged, each unplayed pair named with why.
    const why = partOf(played, "first-words")[0]?.why ?? "";
    expect(why).toContain("5 of 10 pairs measured; pair 6: plain: not played (pair 5: RPE's run was still going");
    expect(partOf(played, "calls")).toEqual([{ outcome: "not judged", why: expect.stringContaining("the share is judged on 10 turns; 5 RPE turn(s) were played (pair 5: RPE's run was still going") }]);
  });

  test("the run still going counts as longer than the limit in the median and the longest, never left out", () => {
    const run = fifthNeverEnds();
    run.turns = run.turns.filter((t) => t.pair <= 5);
    const after = afterReply(run);
    expect(after.spans).toEqual([600, 600, 600, 600, Number.POSITIVE_INFINITY]);
    expect(after.longest).toBe(Number.POSITIVE_INFINITY);
    expect(after.running).toEqual(["pair 5"]);
    // A next message would have waited for it no longer than limits.previousRunSeconds (20 s), and then that run is stopped.
    expect(after.waited.longest).toBe(20_000);
  });
});
