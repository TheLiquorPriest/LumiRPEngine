// The intent record's own time (PlanGates-4 item 3; R-185, R-91): exactly `timings.intent`'s length is
// taken off in both forms, the thinking is printed beside it and taken off nowhere, a turn without the
// record's time leaves the row not judged, and the trace's own measure is a cross-check for the lead.

import { describe, expect, test } from "bun:test";
import { intentCrossCheck, measuredRows } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

describe("the intent record's own time", () => {
  test("tag form: exactly timings.intent is taken off, not the thinking before it", () => {
    // The record from 1.0 s to 1.5 s (0.50 s); 0.60 s of thinking before it; first word on the page at 1.77 s.
    const row = measuredRows(recordedRun({ form: "tag", intent: () => ({ from: 1000, to: 1500 }) }))["first-words"];
    expect(row.measured).toContain("RPE 1.27 s (to the page without taking the record off: 1.77 s)");
    expect(row.measured).toContain("Thinking: RPE 0.60 s");
    expect(row.measured).toContain("The intent record's own time: 0.50 s");
  });

  test("two-step form: exactly timings.intent is taken off the time to the message's end; RPE's thinking is both calls' spans", () => {
    const row = measuredRows(recordedRun({ form: "two-step", intent: () => ({ from: 1000, to: 1500 }) }))["first-words"];
    expect(row.measured).toContain("RPE 3.10 s (to the page without taking the record off: 3.60 s)");
    // 0.60 s in the record's call and 0.40 s in the reply's call.
    expect(row.measured).toContain("Thinking: RPE 1.00 s");
  });

  test("a turn without the record's time leaves the row not judged and names it: not served, none begun, or begun and not ended", () => {
    const run = recordedRun({ form: "two-step", intent: (pair) => (pair === 4 ? "not served" : pair === 5 ? null : pair === 6 ? { from: 1000, to: null } : { from: 1000, to: 1600 }) });
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("not judged");
    const notes = row.notes.join(" ");
    expect(notes).toContain("pair 4 rpe (turn t-4): the turn route gives no timings.intent");
    expect(notes).toContain("pair 5 rpe (turn t-5): no intent record began");
    expect(notes).toContain("pair 6 rpe (turn t-6): its intent record began and did not end");
  });

  test("where the trace's measure and the route's differ by more than the page's resolution, the turn is listed for the lead", () => {
    for (const form of ["tag", "two-step"] as const) {
      const listed = intentCrossCheck(recordedRun({ form, traceSkew: (pair) => (pair === 3 ? 100 : pair === 8 ? 15 : 0) }));
      // Pair 3's trace sees 0.50 s against the route's 0.60 s; pair 8's 15 ms is inside the page's 20 ms.
      expect(listed).toEqual([{ turn: "pair 3 rpe (turn t-3)", route: 600, trace: 500, resolution: 20 }]);
    }
  });
});
