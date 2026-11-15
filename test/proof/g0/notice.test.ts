// The owner's notices (PlanGates-17 item 4): each finding the plan says he is told of is printed the moment
// it is found, with its figures and his options, and the line the lead enters under "Needs the owner" in
// `build/QUEUE.md`. A recorded failing run prints its notice; a pass and a run with no verdict print none;
// the floor model's form is told at G0; the other Phase 0 packages print their findings through the same
// module.

import { describe, expect, test } from "bun:test";
import { findingNotice, FIX_THE_DESIGN, formNotice, g0FailedNotice, KEEP_TWO_STEP, OTHER_MODEL, renderNotice, STOP_HERE, tell } from "../../../scripts/proof/g0/notice";
import { effortOf, g0Rows, g0Verdict } from "../../../scripts/proof/g0/verdict";
import { LEADS, partOf } from "../floor/replay";
import { counted, keepsTags, losesTags, reading, soundRun } from "./recorded";
import { playG0Replay } from "./replay";

const missing = (pair: number) => (pair <= 3 ? 1 : 0);

describe("a failed G0 is told the moment it is found", () => {
  test("a recorded failing run prints the notice with its figures, his options and the line for the queue", async () => {
    const played = await playG0Replay({ run: soundRun({ form: "tag", extraCalls: missing }) });
    const told = played.printed.join("");
    expect(played.printed).toHaveLength(1);
    expect(told).toContain("NOTICE FOR THE OWNER: G0 failed: model calls on the reply's path");
    expect(told).toContain("The plan says you are told of this when it is found (§18.1 G0's fail column, §20 risk 13).");
    // Every row's figure, the failing one first among the reasons.
    expect(told).toContain("Model calls on the reply's path: FAIL: exactly 1 in 7 of 10");
    expect(told).toContain("First words on screen: PASS: RPE 1.17 s");
    expect(told).toContain("What the model was sent: PASS: 10 of 10 RPE turns held every message");
    expect(told).toContain("the Author ran in the tag form at effort low; plain generation at low; the shipped Author definition names high");
    // His options, numbered, and what is built until he answers.
    expect(told).toContain(`1. ${FIX_THE_DESIGN}`);
    expect(told).toContain(`2. ${OTHER_MODEL}`);
    expect(told).toContain(`3. ${STOP_HERE}`);
    expect(told).toContain("Until you answer: nothing of wave 2 starts");
    // The lead enters it under "Needs the owner", never only in a decisions file.
    expect(told).toContain('enter the line below under "Needs the owner" in build/QUEUE.md');
    expect(told).toContain("never only in a decisions file");
    // It is kept beside the evidence, whole.
    expect(played.internal["notice-g0-failed.md"]).toBe(told);
  });

  test("the line for the queue carries the finding, the figures' headline and the choices in one line", async () => {
    const run = soundRun({ form: "tag", extraCalls: missing });
    const rows = g0Rows(run);
    const verdict = g0Verdict(run, rows, { is: "verdict", why: [] }, keepsTags());
    const notice = g0FailedNotice(run, rows, verdict, effortOf(run, "high"), null);
    if (notice === null) throw new Error("a failed run gave no notice");
    expect(notice.queue.includes("\n")).toBe(false);
    expect(notice.queue).toContain("G0 failed: model calls on the reply's path");
    expect(notice.queue).toContain(`(1) ${FIX_THE_DESIGN}`);
    expect(notice.queue).toContain(`(3) ${STOP_HERE}`);
    expect(notice.queue).toContain("Built until you rule:");
  });

  test("a variant that fails is told again, with the options, under its own name", async () => {
    const played = await playG0Replay({ run: soundRun({ form: "two-step", extraCalls: missing }), variant: "the two-step form" });
    const told = played.printed.join("");
    expect(told).toContain("NOTICE FOR THE OWNER: G0 failed on a variant (the two-step form): model calls on the reply's path");
    expect(told).toContain("exactly 2 in 7 of 10");
    expect(played.internal["notice-g0-variant-failed.md"]).toBe(told);
  });

  test("a pass tells the owner nothing but the report, and so does a run the plan gives no verdict on", async () => {
    expect((await playG0Replay({ run: soundRun({ form: "tag" }) })).printed).toEqual([]);
    expect((await playG0Replay({ run: soundRun({ form: "tag" }), ground: { observed: { plain: null, shipped: [], layers: [], off: [], leads: LEADS } } })).printed).toEqual([]);
    const played = await playG0Replay({ run: soundRun({ form: "tag", extraCalls: missing }), ground: { observed: { plain: null, shipped: [], layers: [], off: [], leads: LEADS } } });
    expect(played.printed).toEqual([]);
    expect(partOf(played, "verdict")[0]?.outcome).toBe("not judged");
  });
});

describe("the floor model's form is told at G0", () => {
  test("a tags count below the plan's 28 of 30 prints the notice with both counts and both his choices", () => {
    const notice = formNotice(losesTags());
    if (notice === null) throw new Error("no notice for a lost tag form");
    const text = renderNotice(notice);
    expect(text).toContain("NOTICE FOR THE OWNER: the floor model cannot keep the reply's tags, so it works in the two-step form");
    expect(text).toContain("(§17.1 l.1773 and §18.1 row 0.2, told at G0 before anything is widened)");
    expect(text).toContain("in their tags in 8 of 30 turns, below the 28 of 30 the plan asks");
    expect(text).toContain("a test model that cannot stream a reply is a poor floor to build on");
    expect(text).toContain("tag form: kept in 8 of 30 turns (the plan asks 28 of 30); missed: 22 no-intent-tag");
    expect(text).toContain("two-step form: kept in 30 of 30 turns");
    expect(text).toContain(`1. ${KEEP_TWO_STEP}`);
    expect(text).toContain(`2. ${OTHER_MODEL}`);
    expect(notice.queue).toContain("the floor model cannot keep the reply's tags");
  });

  test("the notice is made only from a count G0 may stand on, and only when the count is below the plan's", () => {
    expect(formNotice(keepsTags())).toBeNull();
    const other = { tags: reading(counted("tags", 8), ["the count stood on other shipped files"]), twoStep: reading(null, ["no count"]) };
    expect(formNotice(other)).toBeNull();
    const none = { tags: reading(null, ["no run folder is named"]), twoStep: reading(null, ["no run folder is named"]) };
    expect(formNotice(none)).toBeNull();
  });

  test("a two-step count not read is said, never left out of the figures", () => {
    const notice = formNotice({ tags: reading(counted("tags", 8)), twoStep: reading(null, ["no run folder is named"]) });
    expect(notice?.figures.join("\n")).toContain("the two-step form's own count was not read, or G0 may not stand on it: no run folder is named");
  });
});

describe("the notice module is the one every Phase 0 finding is printed through", () => {
  const loop = {
    id: "loop",
    title: "pi's loop fell short in three places",
    at: "§18.1 row 0.2's fail column",
    found: ["Stop, follow-ups after terminate and sampling per request each fell short."],
    figures: ["stop: pi waits on a tool until it settles", "follow-ups: pi reads them after terminate"],
    options: ["Fix around pi in RPH.", "Keep LumiAH's loop for now."],
    until: "what the plan builds stands (section 6).",
  };

  test("a finding is printed with its figures and options, numbered, and its queue line is made from them", () => {
    const text = renderNotice(findingNotice(loop));
    expect(text).toContain("NOTICE FOR THE OWNER: pi's loop fell short in three places");
    expect(text).toContain("  - stop: pi waits on a tool until it settles");
    expect(text).toContain("  1. Fix around pi in RPH.");
    expect(text).toContain("  2. Keep LumiAH's loop for now.");
    expect(text).toContain("Until you answer: what the plan builds stands (section 6).");
    expect(findingNotice(loop).queue).toBe("pi's loop fell short in three places: Stop, follow-ups after terminate and sampling per request each fell short. Your choices: (1) Fix around pi in RPH. (2) Keep LumiAH's loop for now. Built until you rule: what the plan builds stands (section 6).");
  });

  test("telling prints at once and keeps the notice under its own name", async () => {
    const printed: string[] = [];
    const kept: [string, string][] = [];
    await tell(findingNotice(loop), { out: (text) => printed.push(text), keep: async (name, text) => void kept.push([name, text]) });
    expect(printed).toHaveLength(1);
    expect(kept).toEqual([["notice-loop.md", printed[0] ?? ""]]);
  });

  test("telling with nowhere to keep it still prints", async () => {
    const printed: string[] = [];
    await tell(findingNotice(loop), { out: (text) => printed.push(text) });
    expect(printed[0]).toContain("pi's loop fell short in three places");
  });
});
