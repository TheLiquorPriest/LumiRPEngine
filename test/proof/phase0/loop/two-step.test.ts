// Row 0.2's two-step form on recorded turns (PlanGates-24 item 2): the same thirty lines with the connection
// set to the two-step form; a turn is kept when the intent record was written first, the reply was released
// as a message of its own, and no working text was shown; calls on the reply's path against exactly 2.
// Reported beside the tags, never judged: nothing is told the owner of it, and the count is kept for G0.

import { describe, expect, test } from "bun:test";
import { LINES_30 } from "../../../../scripts/testbed/floor-fixture";
import { partOf } from "../../floor/replay";
import { playLoop, tagsTrace, twoStepTrace, TWO_STEP_GATE } from "./replay";

/** Thirty turns of the shape a test names by line number. */
const turns = (shape: (i: number) => ReturnType<typeof twoStepTrace>) => ({ turns: LINES_30.map((_, i) => shape(i)) });

describe("the two-step form, thirty turns", () => {
  test("thirty kept turns of exactly 2 calls: both parts met thirty times, the connection set to the two-step form, the count kept with its calls", async () => {
    const played = await playLoop(TWO_STEP_GATE, turns(() => twoStepTrace()));
    expect(partOf(played, "two-step")).toHaveLength(30);
    expect(partOf(played, "two-step").every((i) => i.outcome === "met")).toBe(true);
    expect(partOf(played, "calls").every((i) => i.outcome === "met" && i.why.endsWith("2 call(s) before the reply's release"))).toBe(true);
    expect(played.log.writes).toEqual([{ chat: "chat-floor", key: "connections.rpe-floor.reply.form", value: "two-step" }]);
    const count = JSON.parse(played.internal["count.json"] ?? "null");
    expect(count).toMatchObject({ form: "two-step", count: { kept: 30, played: 30, unread: 0 }, calls: { exact: 30, of: 30 } });
    expect(played.printed).toEqual([]);
  });

  test("the first build's way of missing is shown turn by turn: an extra call is a turn not of exactly 2 calls, a reply before the intent record is not kept, working text is named", async () => {
    const played = await playLoop(
      TWO_STEP_GATE,
      turns((i) => (i === 2 ? twoStepTrace({ extra: 1 }) : i === 5 ? twoStepTrace({ writesIntent: false }) : i === 8 ? twoStepTrace({ workingText: "Let me think about the scene first." }) : twoStepTrace())),
    );
    const calls = partOf(played, "calls");
    expect(calls.filter((i) => i.outcome === "unmet").map((i) => i.why)).toEqual(["turn 3: 3 call(s) before the reply's release"]);
    const kept = partOf(played, "two-step").filter((i) => i.outcome === "unmet").map((i) => i.why);
    expect(kept).toEqual(["turn 6: the intent record was not the first tool call written", "turn 9: working text was shown in a message, or leaked into the reply"]);
    expect(JSON.parse(played.internal["count.json"] ?? "null").calls).toMatchObject({ exact: 29, of: 30 });
  });

  test("the plan gives this form no pass of its own: a count under 28 is told to no one, and the figures are kept for G0's report", async () => {
    const played = await playLoop(TWO_STEP_GATE, turns((i) => (i < 12 ? twoStepTrace({ writesIntent: false }) : twoStepTrace())));
    expect(played.printed).toEqual([]);
    expect(JSON.parse(played.internal["count.json"] ?? "null").count).toMatchObject({ kept: 18, played: 30 });
  });

  test("the tag form's trace is not a kept turn of this form: a release as tags names no reply as a message", async () => {
    const played = await playLoop(TWO_STEP_GATE, { turns: LINES_30.map(() => tagsTrace()) });
    expect(partOf(played, "two-step").every((i) => i.outcome === "unmet")).toBe(true);
  });

  test("a turn that could not be read is not judged on either part, and a connection that could not be set leaves nothing played", async () => {
    const unread = await playLoop(TWO_STEP_GATE, { turns: LINES_30.map((_, i) => (i === 0 ? null : twoStepTrace())) });
    expect(partOf(unread, "two-step")[0]).toMatchObject({ outcome: "not judged" });
    expect(partOf(unread, "calls")[0]).toMatchObject({ outcome: "not judged" });
    expect(JSON.parse(unread.internal["count.json"] ?? "null").count.unread).toBe(1);
    const failed = await playLoop(TWO_STEP_GATE, { ...turns(() => twoStepTrace()), writeFails: "RPE PUT /api/v1/settings: 500" });
    expect(failed.log.sent).toEqual([]);
    expect(partOf(failed, "two-step")[0]?.outcome).toBe("not judged");
    expect(partOf(failed, "calls")[0]?.outcome).toBe("not judged");
  });
});
