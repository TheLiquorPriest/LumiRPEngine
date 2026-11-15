// The token rows (PlanGates-4 item 8; §17.1 l.1767-1768, R-67, R-136): the largest `toolTokens` over every
// call of the Author, under 8,000; the Author's guidance stack, `openingTokens` of its first call, reported
// against about 6,000.

import { describe, expect, test } from "bun:test";
import { measuredRows } from "../../../scripts/testbed/floor-measure";
import { LEAD, recordedRun } from "./recorded";

describe("the Author's tools", () => {
  test("under 8,000 on every call passes, and the largest call is named", () => {
    const row = measuredRows(recordedRun({ form: "two-step", toolTokens: 6400 })).tools;
    expect(row.verdict).toBe("pass");
    expect(row.measured).toContain("the largest 6,400 tokens");
    expect(row.stands).toBe("20 call(s) of the Author over 10 RPE turn(s) read");
  });

  test("a call at 8,000 fails: the row asks under", () => {
    expect(measuredRows(recordedRun({ form: "tag", toolTokens: 8000 })).tools.verdict).toBe("fail");
  });

  test("a sub-agent's tools are not the Author's", () => {
    const run = recordedRun({ form: "tag" });
    const rpe = run.turns.find((t) => t.arm === "rpe")?.rpe;
    if (!rpe) throw new Error("no RPE turn");
    const at = rpe.timings.received + 2000;
    rpe.trace.push({ seq: rpe.trace.length + 1, run: rpe.turn, scope: { user: "u-floor", chat: "chat-floor", session: "s-floor", turn: rpe.turn }, at, agent: { id: "gm-1", definition: "gm", parent: LEAD.id }, event: { kind: "call_started", call: 1, connection: "rpe-floor", model: "deepseek-v4-flash", messages: 4, tools: 40, toolTokens: 12_000, openingTokens: 3000 } });
    const row = measuredRows(run).tools;
    expect(row.verdict).toBe("pass");
    expect(row.measured).toContain("the largest 6,400 tokens");
  });

  test("calls without RPH's count leave the row not judged", () => {
    const row = measuredRows(recordedRun({ form: "tag", toolTokens: null })).tools;
    expect(row.verdict).toBe("not judged");
    expect(row.why.join(" ")).toContain("carry no toolTokens");
  });
});

describe("the Author's guidance stack", () => {
  test("reported from the opening block of the Author's first call, against about 6,000", () => {
    const row = measuredRows(recordedRun({ form: "tag", openingTokens: 5800 })).stack;
    expect(row.verdict).toBe("reported");
    expect(row.measured).toContain("5,800 tokens in the Author's opening block on its first call");
    expect(row.pass).toContain("about 6,000 tokens");
  });
});
