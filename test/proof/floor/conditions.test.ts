// The plan's floor sentence is a part of its own (PlanGates-4-fix2 item 5; plan §17.1 l.1757): "Same
// chat, same preset, same model, under the shipped guidance, where the Author writes. Plain generation
// against a simple turn: ten pairs, interleaved, each turn sent after the previous one has finished."
// It is judged by code from the run's own record and goes to the runner as not judged, with the reason,
// on the floor's own trial and on a run stopped early; a part seen on screen claims only what its screen
// shows, never this sentence. The report of such a run holds no "Passed" for it, or for a measured part.

import { describe, expect, test } from "bun:test";
import { floorConditions, floorHead, noVerdict, noVerdictKind, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { partOf, playReplay } from "./replay";

const SENTENCE = "Same chat, same preset, same model, under the shipped guidance, where the Author writes. Plain generation against a simple turn: ten pairs, interleaved, each turn sent after the previous one has finished";

const MEASURED = ["conditions", "first-words", "per-token", "calls", "sent", "lore", "intake", "tools", "stack", "after-reply"];

/** The report's lines that say a part passed. */
const passedLines = (report: string): string[] => report.split("\n").filter((line) => line.includes("Passed"));

describe("the conditions of the whole test, from the run's own record", () => {
  test("a clean recorded run holds them: the runner is told the sentence is met, and no table line says otherwise", async () => {
    const played = await playReplay({ run: recordedRun({ form: "tag" }) });
    expect(partOf(played, "conditions")).toEqual([{ outcome: "met", why: expect.stringContaining("held: 10 pairs of a plain turn and an RPE turn in order, one chat, one preset, one model on one provider") }]);
    expect(played.report).toContain(`"${SENTENCE}" (code): Passed`);
    expect(played.table).toContain("(one chat, one preset, one model, the shipped guidance, the Author leading, ten pairs interleaved, each sent after the previous had finished): held.");
  });

  test("each condition that does not hold, or cannot be told, is named, and none is judged met", () => {
    const run = (edit: (r: FloorRun) => void): string[] => {
      const r = recordedRun({ form: "tag" });
      edit(r);
      return floorConditions(r);
    };
    expect(floorConditions(recordedRun({ form: "tag" }))).toEqual([]);
    expect(run((r) => r.turns.splice(18))).toEqual(["the run does not hold 10 pairs of a plain turn and then an RPE turn, in order: 18 turn(s) were played"]);
    expect(run((r) => r.turns.reverse())[0]).toContain("in order");
    expect(run((r) => {
      const t = r.turns[7];
      if (t !== undefined) t.chat = "another-chat";
    })).toEqual(["the lines went to 2 chats, not one"]);
    expect(run((r) => {
      const t = r.turns[3];
      if (t !== undefined) t.preset = "another-preset";
    })).toEqual(["the lines were sent with 2 presets, not one"]);
    expect(run((r) => {
      r.arms.rpe.model = "another-model";
      r.plain = r.plain === null ? null : { ...r.plain, model: "another-model" };
      r.arms.plain.model = "another-model";
    })[0]).toContain("not the same model");
    expect(run((r) => {
      r.arms.rpe.provider = "openrouter";
    })).toEqual(["plain generation ran on deepseek and the Author on openrouter: not the same provider"]);
    // A line sent before the turn before it had finished; a turn that failed, so that it finished is not known; an RPE run still going.
    expect(run((r) => {
      const t = r.turns[5];
      const before = r.turns[4];
      if (t !== undefined && before !== undefined) t.began = before.finished - 1;
    })).toEqual(["pair 3 RPE (turn t-3) was sent before pair 3 plain had finished"]);
    expect(run((r) => {
      const t = r.turns[2];
      if (t !== undefined) t.error = "no end heard";
    })).toEqual(["pair 2 plain failed (no end heard), so that it had finished before the next line was sent is not known"]);
    expect(run((r) => {
      const side = r.turns[1]?.rpe;
      if (side !== undefined && side !== null) side.status = "running";
    })).toEqual(["pair 1 RPE (turn t-1): RPE's run was still going when the next line was sent"]);
  });

  test("on a trial or a stop the head says the conditions are not judged, with that as why", () => {
    const stopped = { ...recordedRun({ form: "tag" }), stopped: "pair 5: RPE's run was still going 15 min after the reply" };
    expect(noVerdict(stopped)).toEqual({ kind: "stopped", why: "pair 5: RPE's run was still going 15 min after the reply" });
    expect(floorHead(stopped).join("\n")).toContain("each sent after the previous had finished): not judged: stopped: pair 5: RPE's run was still going 15 min after the reply.");
    const trial = { ...stopped, trials: ["a layer of the user's own holds guidance: TURN.md"] };
    expect(noVerdict(trial)?.kind).toBe("trial");
    expect(noVerdictKind(trial, false)).toBe("trial");
    expect(noVerdictKind(stopped, false)).toBe("stopped");
    expect(noVerdictKind(recordedRun({ form: "tag" }), true)).toBe("trial");
    expect(noVerdictKind(recordedRun({ form: "tag" }), false)).toBeNull();
  });
});

describe("a part seen on screen claims only what the screen shows", () => {
  test("the screen parts' words are not the floor's sentence, and on a trial the sentence is not judged while they show what they show", async () => {
    const trial = { ...recordedRun({ form: "tag" }), trials: ["a layer of the user's own holds guidance: TURN.md"] };
    const played = await playReplay({ run: trial, ground: { observed: { plain: null, shipped: [], layers: [], off: [], leads: { expected: "author", inForce: "author", from: null, levels: [] } } } });
    expect(played.report).not.toContain(`"${SENTENCE}" (code): Passed`);
    for (const line of passedLines(played.report)) expect(line).not.toContain("same preset");
    expect(partOf(played, "conditions")[0]?.outcome).not.toBe("met");
  });
});

describe("a run stopped early gives no part as met", () => {
  /** A recorded tag-form run whose fifth RPE run never ends. */
  function fifthNeverEnds(): FloorRun {
    const run = recordedRun({ form: "tag" });
    const fifth = run.turns.find((t) => t.arm === "rpe" && t.pair === 5)?.rpe;
    if (fifth === undefined || fifth === null) throw new Error("no fifth RPE turn");
    fifth.status = "running";
    fifth.timings = { ...fifth.timings, ended: null };
    return run;
  }

  test("through the runner's main, the fifth RPE run still going: every measured part, the floor's sentence with them, is not judged, and the printed report holds no Passed for any", async () => {
    const played = await playReplay({ run: fifthNeverEnds() });
    for (const id of MEASURED) {
      const instances = partOf(played, id);
      expect(instances).toHaveLength(1);
      expect(instances[0]?.outcome).toBe("not judged");
      expect(instances[0]?.why.startsWith("stopped: pair 5: RPE's run was still going 15 min after the reply")).toBe(true);
    }
    // The only parts that pass are the two seen on screen, each by its own words.
    const passed = passedLines(played.report);
    expect(passed).toHaveLength(2);
    expect(passed.join("\n")).toContain("The chat page shows RPE's last reply, whole, as the chat's last message");
    expect(passed.join("\n")).toContain("The Files page's stack view of the floor's chat shows the Author's parts in its opening block");
    expect(played.report).not.toContain(`"${SENTENCE}" (code): Passed`);
    // The table prints no verdict on any row, and says why.
    expect(played.table).toContain("STOPPED: pair 5:");
    expect(played.table).toContain("First words on screen: no verdict (stopped)");
    expect(played.table).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
  });
});
