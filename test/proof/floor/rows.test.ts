// Time per output token and calls on the reply's path, by form (PlanGates-4 item 5; §17.1 l.1762-1763,
// l.1773; R-96): gated at 15% in the tag form, reported in the two-step form from the reply call's own
// streamed pieces; exactly 1 or exactly 2 calls in at least 9 of 10.

import { describe, expect, test } from "bun:test";
import { measuredRows, pathCalls } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

describe("time per output token", () => {
  test("tag form: first word to last word on the page over Lumiverse's count less one, gated at 15% over plain", () => {
    // Plain: 1.70 s over 119 tokens, 14.3 ms. RPE: 2.30 s over 149, 15.4 ms (8.1% over); over 119, 19.3 ms (35.3% over).
    const passing = measuredRows(recordedRun({ form: "tag" }))["per-token"];
    expect(passing.measured).toBe("RPE 15.4 ms, plain 14.3 ms per token; 8.1% over plain");
    expect(passing.verdict).toBe("pass");
    const failing = measuredRows(recordedRun({ form: "tag", tokens: { plain: 120, rpe: 120 } }))["per-token"];
    expect(failing.measured).toContain("35.3% over plain");
    expect(failing.verdict).toBe("fail");
  });

  test("two-step form: the reply call's streamed pieces over its output tokens, reported and not gated", () => {
    // The reply call streamed from 2.3 s to 3.5 s over 130 output tokens: 1.20 s / 129 = 9.3 ms.
    const row = measuredRows(recordedRun({ form: "two-step" }))["per-token"];
    expect(row.verdict).toBe("reported");
    expect(row.measured).toContain("RPE's reply call 9.3 ms per token");
    expect(row.measured).toContain("plain 14.3 ms per token");
  });
});

describe("model calls on the reply's path", () => {
  test("tag form: one call before the reply's first piece left RPE, in all ten", () => {
    const run = recordedRun({ form: "tag" });
    expect(run.turns.filter((t) => t.arm === "rpe").map((t) => pathCalls(run, t))).toEqual(Array.from({ length: 10 }, () => ({ calls: 1 })));
    expect(measuredRows(run).calls.verdict).toBe("pass");
  });

  test("two-step form: exactly 2 before the release in at least 9 of 10; 8 of 10 fails", () => {
    const nine = measuredRows(recordedRun({ form: "two-step", extraCalls: (pair) => (pair === 2 ? 1 : 0) })).calls;
    expect(nine.measured).toBe("exactly 2 in 9 of 10 (2, 3, 2, 2, 2, 2, 2, 2, 2, 2)");
    expect(nine.verdict).toBe("pass");
    const eight = measuredRows(recordedRun({ form: "two-step", extraCalls: (pair) => (pair === 2 || pair === 5 ? 1 : 0) })).calls;
    expect(eight.verdict).toBe("fail");
  });

  test("a call begun before the reply's first piece counts in the tag form too, and fewer than ten turns are not judged", () => {
    const tag = measuredRows(recordedRun({ form: "tag", extraCalls: (pair) => (pair <= 2 ? 1 : 0) })).calls;
    expect(tag.measured).toBe("exactly 1 in 8 of 10 (2, 2, 1, 1, 1, 1, 1, 1, 1, 1)");
    expect(tag.verdict).toBe("fail");
    const short = measuredRows(recordedRun({ form: "two-step", pairs: 9 })).calls;
    expect(short.verdict).toBe("not judged");
  });
});
