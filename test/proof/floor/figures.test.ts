// The behaviours the check of the floor found without a test that fails when their code is put back
// (PlanGates-4-fix2 item 9; finding 10): intake with no figure is not judged; the two-step time per
// token with no figure is not judged; the table the play keeps honours run.json's trial; and a turn for
// which Lumiverse's socket told no WORLD_INFO_ACTIVATED is not judged for lore, "the event was not
// heard", never judged on an empty list. Lumiverse sends that event only when an entry activated
// (`src/services/prompt-assembly.service.ts:4455-4456`, `src/services/generate.service.ts:2869`), and
// the floor's book holds a constant entry that activates on every line, so silence is a lost event.

import { describe, expect, test } from "bun:test";
import { judge } from "../../../scripts/proof/floor/play";
import { floorTable, measuredRows, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { factsOf, partOf, playReplay } from "./replay";

/** What `judge` told the runner. */
async function told(run: FloorRun): Promise<{ judged: string[]; notJudged: Map<string, string> }> {
  const judged: string[] = [];
  const notJudged = new Map<string, string>();
  await judge(
    {
      judge: async (part) => {
        judged.push(part);
      },
      notJudged: async (part, why) => {
        notJudged.set(part, why);
      },
    },
    run,
    floorTable(run),
  );
  return { judged, notJudged };
}

describe("intake with no figure", () => {
  test("no turn that gives both timings: the row is not judged, never reported, and the runner is told so with why", async () => {
    const run = recordedRun({ form: "tag" });
    for (const t of run.turns) if (t.rpe !== null) t.rpe.timings = { ...t.rpe.timings, started: null };
    const row = measuredRows(run).intake;
    expect(row.verdict).toBe("not judged");
    expect(row.why).toEqual(["no RPE turn gives both timings.received and timings.started"]);
    const said = await told(run);
    expect(said.judged).not.toContain("intake");
    expect(said.notJudged.get("intake")).toContain("no RPE turn gives both timings.received and timings.started");
  });
});

describe("the two-step time per token with no figure", () => {
  test("no streamed piece of the reply call was heard: not judged with why, and not sent to the runner as reported", async () => {
    const run = recordedRun({ form: "two-step" });
    for (const t of run.turns) if (t.rpe !== null) t.rpe.deltas = t.rpe.deltas.filter((d) => (d.text ?? "") === "");
    const row = measuredRows(run)["per-token"];
    expect(row.verdict).toBe("not judged");
    expect(row.why.join("\n")).toContain("0 of 10 pairs measured; pair 1: RPE: the reply call's streamed pieces were not heard");
    const said = await told(run);
    expect(said.judged).not.toContain("per-token");
    expect(said.notJudged.get("per-token")).toContain("the reply call's streamed pieces were not heard");
  });
});

describe("the table the play keeps", () => {
  test("honours run.json's trial: a run whose tree held changes is printed with no verdict on any row", async () => {
    const run = recordedRun({ form: "tag" });
    const played = await playReplay({
      run,
      facts: factsOf(run, (facts) => {
        facts.rpe = { commit: "4f1c2a9e7b3d5a61", dirty: true };
      }),
    });
    expect(played.table).toContain("TRIAL: no verdict. RPE's tree held changes beyond its commit 4f1c2a9e7b3d5a61");
    expect(played.table).toContain("First words on screen: no verdict (trial)");
    expect(played.table).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
    // And a clean run's is printed with its verdicts.
    const clean = await playReplay({ run: recordedRun({ form: "tag" }) });
    expect(clean.table).toContain("First words on screen: PASS");
  });
});

describe("a turn for which no WORLD_INFO_ACTIVATED was heard", () => {
  /** Ten RPE turns that each activated the one constant entry and have it in their lore map. */
  function activated(): FloorRun {
    const run = recordedRun({ form: "tag" });
    for (const t of run.turns) {
      if (t.rpe === null) continue;
      t.socket.lore = [{ id: "entry-1", book: "book-1", title: "Skerry Rock", source: "keyword" }];
      t.rpe.lore = { map: ["e-1"], entries: [{ id: "e-1", entry: "entry-1", book: "book-1", title: "Skerry Rock", how: "constant" }] };
    }
    return run;
  }
  const loreRow = (run: FloorRun) => floorTable(run).find((r) => r.id === "lore");

  test("every event heard: the row passes", () => {
    expect(loreRow(activated())?.verdict).toBe("pass");
  });

  test("one generation with none heard: that turn is not judged, the event was not heard, never judged on an empty list", () => {
    const run = activated();
    const third = run.turns.find((t) => t.arm === "rpe" && t.pair === 3);
    if (third === undefined) throw new Error("no third RPE turn");
    third.socket.lore = null;
    const row = loreRow(run);
    expect(row?.verdict).toBe("not judged");
    expect(row?.why.join("\n")).toContain("pair 3 RPE (turn t-3): the event was not heard: Lumiverse's socket told no WORLD_INFO_ACTIVATED for the generation");
    expect(row?.measured).toContain("9 of 10 turns with every activated entry in the lore map, 1 not judged");
    // On an empty list it would have passed: the row names the turn instead.
    third.socket.lore = [];
    expect(loreRow(run)?.verdict).not.toBe("pass");
  });

  test("through the runner, the lore part is told as not judged and the table says why", async () => {
    const run = activated();
    const first = run.turns.find((t) => t.arm === "rpe" && t.pair === 1);
    if (first === undefined) throw new Error("no first RPE turn");
    first.socket.lore = null;
    const played = await playReplay({ run });
    expect(partOf(played, "lore")).toEqual([{ outcome: "not judged", why: expect.stringContaining("the event was not heard") }]);
    expect(played.table).toContain("not judged: 1 RPE turn(s) not judged: turn pair 1 RPE (turn t-1): the event was not heard");
  });
});
