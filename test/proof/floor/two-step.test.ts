// The two-step form timed as §17.1 l.1773 says (PlanGates-4 item 2): the reply is shown when its message
// ends, so RPE's time is taken to that moment and compared with plain's time to its last word; a run whose
// connection streams anyway is reported beside it and never judged.

import { describe, expect, test } from "bun:test";
import { measuredRows } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

describe("first words on a two-step connection", () => {
  test("an unstreamed run is judged to the moment the message ended and was shown whole, against plain's last word", () => {
    const row = measuredRows(recordedRun({ form: "two-step" }))["first-words"];
    // Ended on the page at 3.60 s, less the record's 0.60 s; plain's last word at 2.80 s.
    expect(row.measured).toContain("RPE 3.00 s");
    expect(row.measured).toContain("plain 2.80 s");
    expect(row.verdict).toBe("pass");
  });

  test("the comparison is with plain's last word, not its first: 1.70 s over the last passes where 3.40 s over the first would fail", () => {
    const row = measuredRows(recordedRun({ form: "two-step", slower: () => 1500 }))["first-words"];
    expect(row.measured).toContain("RPE less plain 1.70 s");
    expect(row.verdict).toBe("pass");
    expect(measuredRows(recordedRun({ form: "two-step", slower: () => 3000 }))["first-words"].verdict).toBe("fail");
  });

  test("a streamed run is printed as streamed, reported and not judged, beside the measure the verdict would need", () => {
    const row = measuredRows(recordedRun({ form: "two-step", streamed: true }))["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.notes.join(" ")).toContain("streamed: reported, not judged");
    // Its first streamed word, 2.37 s on the page less the record's 0.60 s, is shown and judges nothing.
    expect(row.measured).toContain("Streamed: RPE's first streamed word less the record 1.77 s: reported, not judged");
  });

  test("a turn released in the tag form on a two-step run leaves the row not judged, naming it", () => {
    const run = recordedRun({ form: "two-step" });
    const turn = run.turns.find((t) => t.arm === "rpe" && t.pair === 7);
    const released = turn?.rpe?.trace.find((r) => r.event.kind === "released");
    if (released?.event.kind !== "released") throw new Error("the recorded turn has no release");
    released.event.release.form = "tags";
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.notes.join(" ")).toContain('pair 7 rpe (turn t-7) was released as "tags", not "message"');
  });
});
