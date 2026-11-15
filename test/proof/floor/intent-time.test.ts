// The intent record's own time (PlanGates-4 item 3; R-185, R-91; PlanGates-4-fix1 items 1 and 11): exactly
// `timings.intent`'s length is taken off in both forms, the thinking is printed beside it and taken off
// nowhere; a turn where no record began is judged with nothing taken off and named; a time not measured
// leaves its pair unmeasured. The trace's own measure is a cross-check for the lead, taken from the
// `file_write` of `scratch/intent.md` in the two-step form, and "trace incomplete" where the live socket
// missed pieces. The chat page's check finds RPE's last reply as the page's last message, by its whole text.

import { describe, expect, test } from "bun:test";
import { replyIsLast } from "../../../scripts/proof/floor/play";
import { intentCrossCheck, measuredRows, NO_RECORD } from "../../../scripts/testbed/floor-measure";
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

  test("a turn where no intent record began is judged with nothing taken off, named, and left out of the record's own time", () => {
    const run = recordedRun({ form: "two-step", intent: (pair) => (pair === 5 ? null : { from: 1000, to: 1600 }) });
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("pass");
    expect(row.notes).toContain(`${NO_RECORD}: pair 5`);
    // Nine records of 0.60 s; pair 5's 3.60 s to the page counts whole in the median.
    expect(row.measured).toContain("The intent record's own time: 0.60 s, over the 9 turn(s) that had one");
  });

  test("a record that began and did not end, or a time not served, leaves its pair unmeasured and the row not judged, each named", () => {
    const run = recordedRun({ form: "two-step", intent: (pair) => (pair === 4 ? "not served" : pair === 6 ? { from: 1000, to: null } : { from: 1000, to: 1600 }) });
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.why).toContain("8 of 10 pairs measured; pair 4: RPE: the turn route gives no timings.intent (PlanTurn-3 item 4); pair 6: RPE: its intent record began and did not end");
  });
});

describe("the cross-check", () => {
  test("where the trace's measure and the route's differ by more than the page's resolution, the turn is listed for the lead", () => {
    for (const form of ["tag", "two-step"] as const) {
      const listed = intentCrossCheck(recordedRun({ form, traceSkew: (pair) => (pair === 3 ? 100 : pair === 8 ? 15 : 0) }));
      // Pair 3's trace sees 0.50 s against the route's 0.60 s; pair 8's 15 ms is inside the page's 20 ms.
      expect(listed).toEqual([{ turn: "pair 3 RPE (turn t-3)", route: 600, trace: 500, resolution: 20 }]);
    }
  });

  test("a record call that reads before it writes is cross-checked from its write of scratch/intent.md", () => {
    const run = recordedRun({ form: "two-step" });
    const rpe = run.turns.find((t) => t.arm === "rpe" && t.pair === 2)?.rpe;
    const ended = rpe?.trace.find((r) => r.event.kind === "call_ended" && r.event.call === 1);
    if (rpe === undefined || rpe === null || ended?.event.kind !== "call_ended") throw new Error("no record call");
    // A read begun 0.4 s before the write: from it, the trace would see 1.00 s against the route's 0.60 s.
    ended.event.toolCalls.unshift({ id: "c0", name: "file_read", args: { path: "scratch/brief.md" }, began: rpe.timings.received + 600 } as (typeof ended.event.toolCalls)[number]);
    expect(intentCrossCheck(run)).toEqual([]);
    // A read begun after the write, before the record was kept, is no write either.
    ended.event.toolCalls.push({ id: "c2", name: "file_read", args: { path: "scratch/intent.md" }, began: rpe.timings.received + 1300 } as (typeof ended.event.toolCalls)[number]);
    expect(intentCrossCheck(run)).toEqual([]);
  });

  test("a tag-form turn whose live socket missed pieces is listed as trace incomplete, with no figure", () => {
    const run = recordedRun({ form: "tag" });
    const rpe = run.turns.find((t) => t.arm === "rpe" && t.pair === 6)?.rpe;
    if (rpe === undefined || rpe === null) throw new Error("no RPE turn 6");
    rpe.deltasMissed = true;
    expect(intentCrossCheck(run)).toEqual([{ turn: "pair 6 RPE (turn t-6)", route: 600, trace: "trace incomplete", resolution: 20 }]);
  });
});

describe("the chat page's check", () => {
  const reply = "Marta sets the kettle on the stove. \"The storm will blow itself out by morning,\" she says, and pours.";
  const plain = "Marta looks up from the logbook and nods at the window.";

  test("RPE's last reply, whole, as the page's last message passes", () => {
    expect(replyIsLast(`Lumiverse chat\n${plain}\n${reply}\nType a message`, reply, [plain])).toBe(true);
  });

  test("a page that holds the reply's first six words elsewhere fails the check", () => {
    const other = "Marta sets the kettle on the stove, then thinks better of it.";
    // The first six words are on the page, as the last message's start; the reply itself is not.
    expect(replyIsLast(`Lumiverse chat\n${plain}\n${other}\nType a message`, reply, [plain, other])).toBe(false);
    // The reply whole but with another message after it: it is not the page's last message.
    expect(replyIsLast(`Lumiverse chat\n${reply}\n${plain}\nType a message`, reply, [plain])).toBe(false);
  });
});

