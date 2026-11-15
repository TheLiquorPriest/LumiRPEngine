// A reported row carries its figure, and a pass value has one home (PlanGates-4-fix1 item 6; findings 5,
// 20): the stack row, the run after the reply, the two-step time per token and intake on the floor's chat
// reach the runner's report with their figures; a row with no figure goes as not judged with why, never
// as met; the gate reads the share 9 of 10 from `PASS` and does not write it again.

import { describe, expect, test } from "bun:test";
import gate from "../../../scripts/proof/floor/gate";
import { judge } from "../../../scripts/proof/floor/play";
import { floorTable, PASS, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { partOf, playReplay } from "./replay";

/** What `judge` told the runner, part by part. */
async function told(run: FloorRun): Promise<{ judged: Map<string, { pass: boolean; what: string }[]>; notJudged: Map<string, string> }> {
  const judged = new Map<string, { pass: boolean; what: string }[]>();
  const notJudged = new Map<string, string>();
  await judge(
    {
      judge: async (part, verdict) => {
        judged.set(part, [...(judged.get(part) ?? []), verdict]);
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

describe("the gate's judge", () => {
  test("with no openingTokens the stack row is not judged: no first call of the Author carries openingTokens, never met", async () => {
    const { judged, notJudged } = await told(recordedRun({ form: "two-step", openingTokens: null }));
    expect(judged.has("stack")).toBe(false);
    expect(notJudged.get("stack")?.startsWith("no first call of the Author carries openingTokens")).toBe(true);
  });

  test("with figures, the stack, the run after the reply, the two-step time per token and intake each reach the runner's report with them", async () => {
    const played = await playReplay({ run: recordedRun({ form: "two-step" }) });
    const met = (id: string) => partOf(played, id);
    expect(met("stack")).toEqual([{ outcome: "met", why: expect.stringContaining("reported: 5,800 tokens in the Author's opening block on its first call") }]);
    expect(met("after-reply")).toEqual([{ outcome: "met", why: expect.stringContaining("reported: median 0.60 s, longest 0.60 s") }]);
    expect(met("per-token")).toEqual([{ outcome: "met", why: expect.stringContaining("reported: RPE's reply call 8.1 ms per token") }]);
    expect(met("intake")).toEqual([{ outcome: "met", why: expect.stringContaining("reported: 0.05 s on the floor's chat") }]);
    // The runner's report of the gate, its notes, carries each figure behind its part.
    for (const figure of ["5,800 tokens in the Author's opening block", "median 0.60 s, longest 0.60 s", "RPE's reply call 8.1 ms per token", "0.05 s on the floor's chat"]) expect(played.notes).toContain(figure);
  });

  test("a reported row with no figure, the run after the reply with no run ended, goes to the runner as not judged with why", async () => {
    const run = recordedRun({ form: "tag" });
    for (const t of run.turns) if (t.rpe !== null) t.rpe.timings = { ...t.rpe.timings, ended: null };
    const { judged, notJudged } = await told(run);
    expect(judged.has("after-reply")).toBe(false);
    expect(notJudged.get("after-reply")).toContain("RPE turns whose run after the reply is not known");
  });

  test("the gate reads the share of the calls row from PASS: changing PASS.share changes what the gate wants", () => {
    const calls = gate.parts.find((p) => p.id === "calls");
    expect(calls !== undefined && "wants" in calls ? calls.wants : null).toEqual({ hits: 9, of: 10 });
    const share = PASS.share as { hits: number; of: number };
    share.hits = 8;
    try {
      expect(calls !== undefined && "wants" in calls ? calls.wants : null).toEqual({ hits: 8, of: 10 });
    } finally {
      share.hits = 9;
    }
  });
});
