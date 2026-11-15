// Time per output token and calls on the reply's path, by form (PlanGates-4 item 5, PlanGates-4-fix1
// item 7; §17.1 l.1762-1763, l.1773; R-96): both arms' time per token divides the span between the first
// and last word shown by one count of the shown reply, Lumiverse's own for the one model, never a
// provider's completion count nor the count RPE reports; gated at 15% in the tag form, reported in the
// two-step form from the reply call's own streamed pieces; exactly 1 or exactly 2 calls in at least 9 of 10.

import { describe, expect, test } from "bun:test";
import { measuredRows, pathCalls } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

describe("time per output token", () => {
  test("tag form: first word to last word on the page over the shown reply's tokens less one, gated at 15% over plain", () => {
    // Plain: 1.70 s over 119 tokens, 14.3 ms. RPE: 2.30 s over 149, 15.4 ms (8.1% over); over 119, 19.3 ms (35.3% over).
    const passing = measuredRows(recordedRun({ form: "tag" }))["per-token"];
    expect(passing.measured).toBe("RPE 15.4 ms, plain 14.3 ms per token; 8.1% over plain");
    expect(passing.verdict).toBe("pass");
    const failing = measuredRows(recordedRun({ form: "tag", visible: { plain: 120, rpe: 120 } }))["per-token"];
    expect(failing.measured).toContain("35.3% over plain");
    expect(failing.verdict).toBe("fail");
  });

  test("a plain arm whose provider count holds its reasoning and an RPE arm whose reported count is RPH's budget give equal times when their shown texts and spans are equal", () => {
    // Both spans 2.30 s, both shown replies 150 tokens by Lumiverse's own count: 15.4 ms each. The provider's
    // 900 for plain holds its reasoning; the 4,000 RPE reported is RPH's turn budget: neither is counted.
    const row = measuredRows(recordedRun({ form: "tag", plainLast: 3400, visible: { plain: 150, rpe: 150 }, tokens: { plain: 900, rpe: 4000 } }))["per-token"];
    expect(row.measured).toBe("RPE 15.4 ms, plain 15.4 ms per token; 0.0% under plain");
    expect(row.verdict).toBe("pass");
  });

  test("a turn whose shown reply Lumiverse did not count leaves its pair unmeasured, by name", () => {
    const run = recordedRun({ form: "tag" });
    const plain = run.turns.find((t) => t.arm === "plain" && t.pair === 3);
    if (plain === undefined) throw new Error("no plain turn 3");
    plain.visible = null;
    plain.visibleWhy = "Lumiverse's count of the shown reply failed: 500";
    const row = measuredRows(run)["per-token"];
    expect(row.verdict).toBe("not judged");
    expect(row.why).toContain("9 of 10 pairs measured; pair 3: plain: Lumiverse's count of the shown reply failed: 500");
  });

  test("two-step form: the reply call's streamed pieces over the shown reply's tokens, reported and not gated", () => {
    // The reply call streamed from 2.3 s to 3.5 s; the shown reply is 150 tokens: 1.20 s / 149 = 8.1 ms.
    const row = measuredRows(recordedRun({ form: "two-step" }))["per-token"];
    expect(row.verdict).toBe("reported");
    expect(row.measured).toContain("RPE's reply call 8.1 ms per token");
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
