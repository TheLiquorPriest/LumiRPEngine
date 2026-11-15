// Each part the floor measures and does not judge is told to the runner with why (PlanGates-42 item 2;
// PlanScenarios-8 item 5): the floor's reasons go through `play.notJudged(part, why)`, so the runner's
// report shows "not judged" and the reason, never "its form never judged it" and never a pass.

import { describe, expect, test } from "bun:test";
import { recordedRun } from "./recorded";
import { partOf, playReplay } from "./replay";

const FIRST_WORDS = "First words on screen: from the request to the reply's first word, less the time the model spent writing its intent record: median within 3 s of plain generation's time from request to first word, on the same model at the same thinking effort. Thinking time is reported for both, and the intent record's own time beside them";

describe("a part the floor does not judge, told with why", () => {
  test("over a recorded streamed run, the first-words part reads 'not judged: streamed' in the runner's report", async () => {
    const played = await playReplay({ run: recordedRun({ form: "two-step", streamed: true }) });
    expect(partOf(played, "first-words")).toEqual([{ outcome: "not judged", why: expect.stringMatching(/^streamed: run\.json says the Author's connection streams/) }]);
    expect(played.report).toContain(`  - "${FIRST_WORDS}" (code): Not judged: streamed: run.json says the Author's connection streams (agents[].streams)`);
    expect(played.report).not.toContain("its form never judged it");
    // The same reason in the floor's own table.
    expect(played.table).toContain("  not judged: streamed: run.json says the Author's connection streams (agents[].streams)");
  });

  test("fewer pairs than ten, each failed pair named: the timing rows are not judged, and the runner says why", async () => {
    const run = recordedRun({ form: "tag" });
    const tenth = run.turns.find((t) => t.arm === "rpe" && t.pair === 10);
    if (tenth === undefined) throw new Error("no tenth RPE turn");
    tenth.error = "the provider closed the connection";
    tenth.rpe = null;
    const played = await playReplay({ run });
    for (const part of ["first-words", "per-token"]) expect(partOf(played, part)[0]?.why).toContain("9 of 10 pairs measured; pair 10: RPE: the provider closed the connection");
    expect(played.report).toContain("Not judged: 9 of 10 pairs measured; pair 10: RPE: the provider closed the connection");
  });
});
