// A time per output token needs a span on both sides (PlanGates-4-fix2 item 1): a reply that appeared
// whole on the page, its first and last word arriving together, has no time between them. A pair with
// either arm's reply whole is not measured for this row, named with the arm, and by the rule of ten
// measured pairs the row is then not judged: never a pass or a fail, and never "0.0 ms", "100.0% under
// plain" or "NaN%". The table says in a line of its own when RPE's replies did not stream in the tag form.

import { describe, expect, test } from "bun:test";
import { appearedWhole, floorHead, floorTable, measuredRows, tableText, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

/** The turns of one arm, their reply shown at its last word's moment: first and last word arrive together. */
function shownWhole(run: FloorRun, arm: "plain" | "rpe", pairs?: readonly number[]): FloorRun {
  for (const t of run.turns) if (t.arm === arm && t.page !== null && t.page.lastWord !== null && (pairs === undefined || pairs.includes(t.pair))) t.page.firstWord = t.page.lastWord;
  return run;
}

/** What none of the rows' words may hold for a reply that has no time between its words. */
function noInvented(text: string): void {
  expect(text).not.toContain("100.0% under");
  expect(text).not.toContain("NaN");
  expect(text).not.toMatch(/(^|[^\d.])0\.0 ms/);
}

describe("a reply that appeared whole has no time per token", () => {
  test("RPE's replies whole in the tag form: not judged, naming RPE, and none of the figures the check found printed", () => {
    const run = shownWhole(recordedRun({ form: "tag" }), "rpe");
    const row = measuredRows(run)["per-token"];
    expect(row.verdict).toBe("not judged");
    expect(row.why.join("\n")).toContain("0 of 10 pairs measured; pair 1: RPE: RPE's reply appeared whole: nothing streamed");
    expect(row.why.join("\n")).not.toContain("plain generation's reply appeared whole");
    noInvented(row.measured);
    noInvented(tableText(floorTable(run), floorHead(run), null, []));
  });

  test("both arms whole, as with a preset whose streaming is off: not judged, naming both arms", () => {
    const run = shownWhole(shownWhole(recordedRun({ form: "tag" }), "rpe"), "plain");
    const row = measuredRows(run)["per-token"];
    expect(row.verdict).toBe("not judged");
    expect(row.why.join("\n")).toContain("pair 1: plain: plain generation's reply appeared whole: nothing streamed; RPE: RPE's reply appeared whole: nothing streamed");
    noInvented(row.measured);
  });

  test("plain generation's reply whole alone is named as plain's, and the pair is left out of the median, never taken as a figure of 0 ms", () => {
    const run = shownWhole(recordedRun({ form: "tag" }), "plain", [4]);
    const row = measuredRows(run)["per-token"];
    expect(row.verdict).toBe("not judged");
    expect(row.why.join("\n")).toContain("9 of 10 pairs measured; pair 4: plain: plain generation's reply appeared whole: nothing streamed");
    noInvented(row.measured);
  });

  test("the two-step form, whose reported time per token is held to the same: plain whole is named, and so is a reply call whose pieces all arrived together", () => {
    const plainWhole = measuredRows(shownWhole(recordedRun({ form: "two-step" }), "plain"))["per-token"];
    expect(plainWhole.verdict).toBe("not judged");
    expect(plainWhole.why.join("\n")).toContain("pair 1: plain: plain generation's reply appeared whole: nothing streamed");
    noInvented(plainWhole.measured);
    const run = recordedRun({ form: "two-step" });
    const turn = run.turns.find((t) => t.arm === "rpe" && t.pair === 2)?.rpe;
    if (turn === undefined || turn === null) throw new Error("no RPE turn 2");
    // Every piece of the reply call at one moment.
    const at = turn.deltas.at(-1)?.at ?? 0;
    turn.deltas = turn.deltas.map((d) => ((d.text ?? "") !== "" ? { ...d, at } : d)).filter((d, i, all) => (d.text ?? "") === "" || all.findIndex((x) => (x.text ?? "") !== "" && x.call === d.call) === i);
    const row = measuredRows(run)["per-token"];
    expect(row.verdict).toBe("not judged");
    expect(row.why.join("\n")).toContain("pair 2: RPE: RPE's reply call's pieces arrived together: nothing streamed");
    noInvented(row.measured);
  });

  test("a reply whose words arrive within the page's resolution is whole, one that took longer is not, and one token is no reply to time", () => {
    const run = recordedRun({ form: "tag" });
    const turn = run.turns.find((t) => t.arm === "rpe");
    if (turn === undefined || turn.page === null || turn.page.firstWord === null) throw new Error("no RPE turn");
    expect(appearedWhole(turn)).toBe(false);
    turn.page.lastWord = turn.page.firstWord + turn.page.resolution;
    expect(appearedWhole(turn)).toBe(true);
    turn.page.lastWord = turn.page.firstWord + turn.page.resolution + 1;
    expect(appearedWhole(turn)).toBe(false);
    turn.page.lastWord = turn.page.firstWord;
    turn.visible = 1;
    expect(appearedWhole(turn)).toBe(false);
  });
});

describe("the table says when RPE's replies did not stream", () => {
  test("in a line of its own, naming the pairs, in the tag form", () => {
    const run = shownWhole(recordedRun({ form: "tag" }), "rpe", [2, 7]);
    const line = floorHead(run).filter((l) => l.startsWith("RPE's replies did not stream in the tag form"));
    expect(line).toEqual(["RPE's replies did not stream in the tag form: pair 2, pair 7 appeared whole on the page, so no time was measured between their first word and their last."]);
    expect(tableText(floorTable(run), floorHead(run), null, [])).toContain(`\n${line[0]}\n`);
  });

  test("not where they streamed, and not in the two-step form, where the message is shown whole by design", () => {
    expect(floorHead(recordedRun({ form: "tag" })).join("\n")).not.toContain("did not stream");
    expect(floorHead(shownWhole(recordedRun({ form: "two-step" }), "rpe")).join("\n")).not.toContain("did not stream");
  });
});
