// The arithmetic the check found untested (PlanGates-4-fix1 item 14; finding 21): the run after the reply
// (median, longest, how long a next message would have waited, up to `limits.previousRun`) and intake on
// the floor's chat (the request reaching RPE to its run starting).

import { describe, expect, test } from "bun:test";
import { afterReply, intakeSpans, measuredRows, median } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

describe("the run after the reply", () => {
  test("release to the run's end, median and longest, and the wait a next message would have had, capped by limits.previousRun", () => {
    const run = recordedRun({ form: "tag" });
    // Runs of 0.6 s, but for pair 3's of 31.6 s and pair 8's of 2.6 s.
    for (const [pair, ms] of [
      [3, 31_600],
      [8, 2_600],
    ] as const) {
      const rpe = run.turns.find((t) => t.arm === "rpe" && t.pair === pair)?.rpe;
      if (rpe === undefined || rpe === null || rpe.timings.released === null) throw new Error(`no RPE turn ${pair}`);
      rpe.timings = { ...rpe.timings, ended: rpe.timings.released + ms };
    }
    const after = afterReply(run);
    expect(after.spans).toEqual([600, 600, 31_600, 600, 600, 600, 600, 2_600, 600, 600]);
    expect(after.median).toBe(600);
    expect(after.longest).toBe(31_600);
    // limits.previousRun is 20 s: no next message waits longer, and the run before it is stopped then.
    expect(after.waited).toEqual({ median: 600, longest: 20_000 });
    const row = measuredRows(run)["after-reply"];
    expect(row.verdict).toBe("reported");
    expect(row.measured).toBe("median 0.60 s, longest 31.60 s; a next message sent at the release would have waited 0.60 s (median), 20.00 s (longest), 20 s at most (limits.previousRun), after which that run is stopped");
  });

  test("with no previousRun given, a next message waits as long as the run", () => {
    const run = { ...recordedRun({ form: "tag" }), previousRun: null };
    expect(afterReply(run).waited).toEqual({ median: 600, longest: 600 });
  });

  test("an even count of runs takes the mean of the two middle ones", () => {
    expect(median([100, 400, 300, 200])).toBe(250);
    expect(median([])).toBeNull();
  });
});

describe("intake on the floor's chat", () => {
  test("each RPE turn's request reaching RPE to its run starting, its median reported", () => {
    const run = recordedRun({ form: "tag" });
    const fourth = run.turns.find((t) => t.arm === "rpe" && t.pair === 4)?.rpe;
    if (fourth === undefined || fourth === null || fourth.timings.started === null) throw new Error("no RPE turn 4");
    fourth.timings = { ...fourth.timings, started: fourth.timings.received + 140 };
    expect(intakeSpans(run)).toEqual([50, 50, 50, 140, 50, 50, 50, 50, 50, 50]);
    const row = measuredRows(run).intake;
    expect(row.verdict).toBe("reported");
    expect(row.measured).toBe("0.05 s on the floor's chat, from the request reaching RPE to its run starting");
    expect(row.stands).toBe("10 RPE turn(s)");
  });
});
