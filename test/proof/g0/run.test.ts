// G0's run on recorded turns (PlanGates-17 item 1): ten pairs of plain generation beside RPE, judged for
// §17.1's first four rows and for nothing else, with row 0.2's tags count read, not counted. The plan's
// verdict only where it gives one: a run in which what the model was sent was not measured gives none, a
// trial or a stop gives none on any part, a tag-form run on a floor model whose tags were lost gives none.

import { describe, expect, test } from "bun:test";
import gate from "../../../scripts/proof/g0/gate";
import { g0Rows, g0Verdict } from "../../../scripts/proof/g0/verdict";
import type { FormsReading } from "../../../scripts/proof/g0/forms";
import { type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "../floor/recorded";
import { LEADS, partOf } from "../floor/replay";
import { counted, keepsTags, losesTags, noCounts, reading, soundRun } from "./recorded";
import { playG0Replay } from "./replay";

const verdictOf = (run: FloorRun, forms: FormsReading, standing: { is: "verdict" | "trial"; why: string[] } = { is: "verdict", why: [] }) => g0Verdict(run, g0Rows(run), standing, forms);

describe("G0 judges a recorded run", () => {
  test("a sound tag-form run, what the model was sent measured and the tags kept, passes, and the runner has every part met", async () => {
    const played = await playG0Replay({ run: soundRun({ form: "tag" }) });
    for (const id of ["conditions", "first-words", "per-token", "sent", "tags", "verdict"]) expect(partOf(played, id).map((i) => i.outcome)).toEqual(["met"]);
    expect(partOf(played, "calls").map((i) => i.outcome)).toEqual(Array.from({ length: 10 }, () => "met"));
    expect(partOf(played, "verdict")[0]?.why).toContain("passed");
    expect(played.code).toBe(0);
    expect(played.printed).toEqual([]);
    expect(JSON.parse(played.internal["g0.json"] ?? "null").verdict.kind).toBe("passed");
  });

  test("the four rows are the only ones it judges: no intake, tools, stack, run after the reply or lore", async () => {
    const played = await playG0Replay({ run: soundRun({ form: "tag" }) });
    expect(played.result.parts.map((p) => p.id)).toEqual(["conditions", "first-words", "per-token", "calls", "sent", "tags", "verdict"]);
    expect(gate.parts.map((p) => p.id)).toEqual(played.result.parts.map((p) => p.id));
    expect(played.table).toContain("G0: the floor test in miniature");
    for (const measure of ["First words on screen", "Time per output token", "Model calls on the reply's path", "What the model was sent"]) expect(played.table).toContain(measure);
    for (const measure of ["Intake", "The Author's tools", "Activated lore", "The run after the reply"]) expect(played.table).not.toContain(`${measure}:`);
  });

  test("a run in which what the model was sent was not measured gives no G0 verdict, whatever the other three say", async () => {
    // The floor's recorded run keeps no request or stored prompt: the sent row is not judged.
    const run = recordedRun({ form: "tag" });
    const verdict = verdictOf(run, keepsTags());
    expect(g0Rows(run).find((r) => r.id === "sent")?.verdict).toBe("not judged");
    expect(g0Rows(run).filter((r) => r.id !== "sent").map((r) => r.verdict)).toEqual(["pass", "pass", "pass"]);
    expect(verdict.verdict).toBe("none");
    expect(verdict.kind).toBe("not judged");
    expect(verdict.why.join(" ")).toContain("What the model was sent");
    const played = await playG0Replay({ run });
    expect(partOf(played, "verdict")).toEqual([{ outcome: "not judged", why: expect.stringContaining("What the model was sent") }]);
    expect(partOf(played, "sent")[0]?.outcome).toBe("not judged");
    expect(partOf(played, "first-words")[0]?.outcome).toBe("met");
    expect(played.code).not.toBe(0);
  });

  test("a row that misses fails G0, the verdict part is unmet, and what is missed is named", async () => {
    // Three turns made an extra call before the reply: exactly 1 in 7 of 10, below 9 of 10.
    const run = soundRun({ form: "tag", extraCalls: (pair) => (pair <= 3 ? 1 : 0) });
    const verdict = verdictOf(run, keepsTags());
    expect(verdict.verdict).toBe("fail");
    expect(verdict.why[0]).toContain("Model calls on the reply's path");
    const played = await playG0Replay({ run });
    expect(partOf(played, "verdict")).toEqual([{ outcome: "unmet", why: expect.stringContaining("Model calls on the reply's path") }]);
    expect(played.code).toBe(1);
  });

  test("a failed row is a fail even where another row was not measured, and says so", () => {
    const run = recordedRun({ form: "tag", extraCalls: (pair) => (pair <= 3 ? 1 : 0) });
    const verdict = verdictOf(run, keepsTags());
    expect(verdict.verdict).toBe("fail");
    expect(verdict.why.some((w) => w.startsWith("What the model was sent was not judged"))).toBe(true);
  });

  test("the two-step form is judged by its own reading: calls exactly 2, time per token reported and not gated, and it passes", () => {
    const run = soundRun({ form: "two-step" });
    const rows = g0Rows(run);
    expect(rows.map((r) => r.verdict)).toEqual(["pass", "reported", "pass", "pass"]);
    expect(verdictOf(run, keepsTags()).verdict).toBe("pass");
  });
});

describe("G0 gives no verdict where the plan gives none", () => {
  test("a trial the floor found makes every part not judged, the counts and the verdict included, and prints no pass", async () => {
    // The shipped tree RPE serves the floor's chat is not the build's: the floor's own reason for a trial, found before the first pair.
    const run = soundRun({ form: "tag" });
    const played = await playG0Replay({ run, ground: { observed: { plain: run.plain, shipped: [], layers: [], off: [], leads: LEADS } } });
    for (const id of ["conditions", "first-words", "per-token", "sent", "tags", "verdict"]) expect(partOf(played, id).map((i) => i.outcome)).toEqual(["not judged"]);
    expect(partOf(played, "calls").map((i) => i.outcome)).toEqual(["not judged"]);
    expect(partOf(played, "verdict")[0]?.why).toContain("trial");
    expect(partOf(played, "tags")[0]?.why).toContain("tag form: kept in 29 of 30 turns");
    expect(played.table).toContain("no verdict (trial)");
    expect(played.printed).toEqual([]);
  });

  test("a stop before the last pair gives no verdict on any part, the rows it reported included", async () => {
    const run = soundRun({ form: "tag", pairs: 6 });
    run.stopped = "pair 6: RPE's run was still going 15 min after the reply";
    const verdict = verdictOf(run, keepsTags());
    expect(verdict.verdict).toBe("none");
    expect(verdict.kind).toBe("stopped");
  });

  test("a runner's trial is a trial for G0 too", () => {
    const verdict = verdictOf(soundRun({ form: "tag" }), keepsTags(), { is: "trial", why: ["a layer of the user's own holds guidance"] });
    expect(verdict).toMatchObject({ verdict: "none", kind: "trial" });
    expect(verdict.why).toContain("a layer of the user's own holds guidance");
  });

  test("conditions of the whole test not held (a turn failed) leave no verdict", () => {
    const run = soundRun({ form: "tag" });
    const t = run.turns[3];
    if (t === undefined) throw new Error("no fourth turn");
    t.error = "Lumiverse told no end of the generation";
    const verdict = verdictOf(run, keepsTags());
    expect(verdict.verdict).toBe("none");
    expect(verdict.kind).toBe("conditions");
  });
});

describe("G0 reads the tags count and tells what follows", () => {
  test("the floor model that lost its tags, played in the tag form, gives no verdict: the connection works the two-step way", async () => {
    const run = soundRun({ form: "tag" });
    const verdict = verdictOf(run, losesTags());
    expect(verdict).toMatchObject({ verdict: "none", kind: "form" });
    expect(verdict.why[0]).toContain("8 of 30");
    const played = await playG0Replay({ run, forms: losesTags() });
    expect(partOf(played, "verdict")[0]?.outcome).toBe("not judged");
    expect(partOf(played, "tags")[0]?.outcome).toBe("met");
    expect(partOf(played, "tags")[0]?.why).toContain("below the plan's 28 of 30: the floor model works the two-step way, and the owner is told");
    expect(played.printed.join("")).toContain("NOTICE FOR THE OWNER: the floor model cannot keep the reply's tags");
  });

  test("played in the two-step form on that model, G0 can pass, and the owner is told at once that the model needs the form", async () => {
    const played = await playG0Replay({ run: soundRun({ form: "two-step" }), forms: losesTags() });
    expect(partOf(played, "verdict")[0]?.outcome).toBe("met");
    const told = played.printed.join("");
    expect(told).toContain("NOTICE FOR THE OWNER");
    expect(told).toContain("kept in 8 of 30 turns");
    expect(played.internal["notice-floor-form.md"]).toBe(told);
  });

  test("with no count read, the tags are not judged, and the rows are still judged in the form the run was in", async () => {
    const played = await playG0Replay({ run: soundRun({ form: "tag" }), forms: noCounts() });
    expect(partOf(played, "tags")).toEqual([{ outcome: "not judged", why: expect.stringContaining("the tags run's count was not read: no run folder is named") }]);
    expect(partOf(played, "verdict")[0]?.outcome).toBe("met");
    expect(played.printed).toEqual([]);
  });

  test("a count G0 may not stand on is reported with its figures and never taken: not judged, no notice, no mismatch", async () => {
    const forms: FormsReading = { tags: reading(counted("tags", 8), ["the count stood on other shipped files (aaaaaaaaaaaa) than this run (bbbbbbbbbbbb)"]), twoStep: reading(null, ["none"]) };
    const run = soundRun({ form: "tag" });
    expect(verdictOf(run, forms).verdict).toBe("pass");
    const played = await playG0Replay({ run, forms });
    expect(partOf(played, "tags")[0]?.outcome).toBe("not judged");
    expect(partOf(played, "tags")[0]?.why).toContain("G0 does not stand on the tags run's count");
    expect(partOf(played, "tags")[0]?.why).toContain("kept in 8 of 30 turns");
    expect(played.printed).toEqual([]);
  });
});
