// Every pair accounted for (PlanGates-4-fix1 item 1; findings 1, 9, 17): the timing rows are judged only
// when all ten pairs were measured on both sides, a pair not measured named with its cause, never a
// median of the rest; each read of the RPE side stands alone, so a lore route not served leaves only the
// lore row not judged and the calls row is judged on the calls the trace holds, a failed turn a miss; a
// turn where no intent record began is judged with nothing taken off, named.

import { describe, expect, test } from "bun:test";
import { measuredRows, NO_RECORD, floorTable } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

/** The check's probe: RPE slower by nothing on pairs 1 to 4, 2.7 s on pair 5 and 3.0 s on pairs 6 to 10. */
const probe = () => recordedRun({ form: "two-step", slower: (pair) => (pair <= 4 ? 0 : pair === 5 ? 2700 : 3000) });

describe("every pair accounted for", () => {
  test("the check's probe fails as measured; with pair 10's RPE turn failed it is not judged, 9 of 10 pairs measured, naming pair 10, never a pass", () => {
    expect(measuredRows(probe())["first-words"].verdict).toBe("fail");
    const run = probe();
    const tenth = run.turns.find((t) => t.arm === "rpe" && t.pair === 10);
    if (tenth === undefined) throw new Error("no tenth RPE turn");
    tenth.error = "the provider closed the connection";
    tenth.rpe = null;
    const rows = measuredRows(run);
    for (const id of ["first-words", "per-token"] as const) {
      expect(rows[id].verdict).toBe("not judged");
      expect(rows[id].why).toContain("9 of 10 pairs measured; pair 10: RPE: the provider closed the connection");
    }
    expect(rows["first-words"].stands).toBe("9 RPE turn(s) and 9 plain turn(s), of 9 pair(s) measured");
    // The failed turn is a miss of the calls row, judged on the ten turns: 9 of 10 meets the share.
    expect(rows.calls.measured).toBe("exactly 2 in 9 of 10 (2, 2, 2, 2, 2, 2, 2, 2, 2, miss)");
    expect(rows.calls.verdict).toBe("pass");
  });

  test("fewer pairs than ten counts pairs measured, not pairs played: a plain turn whose page timed nothing leaves its pair out by name", () => {
    const run = recordedRun({ form: "tag" });
    const plain = run.turns.find((t) => t.arm === "plain" && t.pair === 7);
    if (plain === undefined) throw new Error("no plain turn 7");
    plain.page = null;
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.why).toContain("9 of 10 pairs measured; pair 7: plain: the page timed nothing");
  });

  test("with the lore route not served, lore is not judged by name and calls are judged on the calls the trace holds", () => {
    const run = recordedRun({ form: "tag" });
    for (const t of run.turns) {
      if (t.rpe === null) continue;
      t.rpe.lore = { map: [], entries: null };
      t.rpe.missing = { lore: "RPE's lore route is not served (PlanLore-13)" };
    }
    const rows = floorTable(run);
    const lore = rows.find((r) => r.id === "lore");
    expect(lore?.verdict).toBe("not judged");
    expect(lore?.why.join(" ")).toContain("RPE's lore route is not served (PlanLore-13)");
    expect(rows.find((r) => r.id === "calls")?.verdict).toBe("pass");
    expect(rows.find((r) => r.id === "first-words")?.verdict).toBe("pass");
  });

  test("a turn with timings.intent null is judged with nothing taken off, named, and left out of the count beside the record's own time", () => {
    const row = measuredRows(recordedRun({ form: "tag", intent: (pair) => (pair === 2 ? null : { from: 1000, to: 1600 }) }))["first-words"];
    expect(row.verdict).toBe("pass");
    expect(row.notes).toContain(`${NO_RECORD}: pair 2`);
    expect(row.measured).toContain("over the 9 turn(s) that had one");
  });
});
