// The floor is "where the Author writes" (STANDALONE-PLAN §17.1 l.1757; PlanGates-4-fix2 item 2): the lead
// the floor expects is the shipped default of RPE's `lead` setting, read from RPE and written nowhere in
// the script. Before the first pair the floor reads who leads at every level of settings, and a lead that
// is not that default is one of the floor's own trials, "the turn's lead is <name>, not the Author"; each
// turn's trace is checked too, and a turn led by another definition makes the run a trial. A trial gives
// no verdict on any part.

import { describe, expect, test } from "bun:test";
import type { SettingView } from "../../../src/shared/api";
import { floorTrials, leadInFile, leadsOf, leadTrials, type Leads } from "../../../scripts/proof/lib/record";
import { floorConditions, ledByOthers, noVerdict, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { factsOf, LEADS, partOf, playReplay, recordOf, SERVED } from "./replay";

/** RPE's `lead` setting as its settings route shows it. */
function leadSetting(value: string, from: SettingView["from"], fallback = "author"): SettingView {
  return { key: "lead", value, default: fallback, from, file: from === null ? null : `@${from}/RPE.yml`, takes: { type: "text" }, takesWords: "a line of text that is not blank", none: null, orNone: false, levels: ["global", "character", "chat"], passed: null };
}

/** The recorded run with every record of every RPE turn's trace made by another definition: the check's case. */
function ledBy(definition: string): FloorRun {
  const run = recordedRun({ form: "tag" });
  for (const t of run.turns) if (t.rpe !== null) t.rpe.trace = t.rpe.trace.map((r) => ({ ...r, agent: { ...r.agent, definition } }));
  return run;
}

describe("who leads, read from RPE's own settings", () => {
  test("the shipped default is the Author the floor expects, wherever RPE's setting puts it: the script names none", () => {
    expect(leadTrials(leadsOf({ settings: [leadSetting("author", null)] }, []))).toEqual([]);
    // A build whose shipped default is another definition is that build's Author: nothing in the script says "author".
    const other = leadsOf({ settings: [leadSetting("scribe", null, "scribe")] }, []);
    expect(other).toEqual({ expected: "scribe", inForce: "scribe", from: null, levels: [] });
    expect(leadTrials(other)).toEqual([]);
  });

  test("a lead the chat's settings change is one of the floor's own trials, naming the lead and the level that sets it", () => {
    const leads = leadsOf({ settings: [leadSetting("gm", "chat")] }, [
      { level: "global", file: "@global/RPE-global.yml", text: "history:\n  window: 40\n", problem: null },
      { level: "chat", file: "@chat/RPE.yml", text: "lead: gm\n", problem: null },
    ]);
    expect(leads.levels).toEqual([
      { level: "global", file: "@global/RPE-global.yml", lead: null, problem: null },
      { level: "chat", file: "@chat/RPE.yml", lead: "gm", problem: null },
    ]);
    expect(leadTrials(leads)).toEqual(["the turn's lead is gm, not the Author (the shipped default of the lead setting is author; the chat level's file sets it)"]);
    // Through the floor's trials, beside the others, and with a lead that is the default none.
    const run = recordOf(factsOf(recordedRun({ form: "tag" })));
    expect(floorTrials(run, { shipped: SERVED, layers: [], off: [], leads }, null)).toEqual(leadTrials(leads));
  });

  test("a lead RPE's settings do not give is a trial too, never taken to be the Author", () => {
    expect(leadTrials(leadsOf({ settings: [] }, []))).toEqual(["RPE's settings give no `lead` setting with a default, so who leads the turn is not known"]);
    const noValue: Leads = { expected: "author", inForce: null, from: null, levels: [] };
    expect(leadTrials(noValue)).toEqual(["RPE's settings give no value in force for `lead`, so who leads the turn is not known"]);
  });

  test("a level's own file is read for the lead it sets; one that does not parse or could not be read is named, and the value in force still decides", () => {
    expect(leadInFile("lead: gm\n")).toEqual({ lead: "gm", problem: null });
    expect(leadInFile("history:\n  window: 40\n")).toEqual({ lead: null, problem: null });
    expect(leadInFile("lead: [unclosed\n").problem).toContain("does not parse");
    const leads = leadsOf({ settings: [leadSetting("author", null)] }, [{ level: "chat", file: "@chat/RPE.yml", text: null, problem: "it could not be read: 500" }]);
    expect(leads.levels).toEqual([{ level: "chat", file: "@chat/RPE.yml", lead: null, problem: "it could not be read: 500" }]);
    expect(leadTrials(leads)).toEqual([]);
  });
});

describe("a turn led by another definition", () => {
  test("every lead record's definition gm, the check's case: no verdict on any part, and the trial named", async () => {
    const played = await playReplay({ run: ledBy("gm") });
    const why = "trial: a turn was led by another definition than the Author (author): pair 1 by gm, pair 2 by gm";
    for (const id of ["conditions", "first-words", "per-token", "calls", "sent", "lore", "intake", "tools", "stack", "after-reply"]) {
      const instances = partOf(played, id);
      expect(instances).toHaveLength(1);
      expect(instances[0]?.outcome).toBe("not judged");
      expect(instances[0]?.why.startsWith(why)).toBe(true);
    }
    expect(played.table).toContain("TRIAL: no verdict. a turn was led by another definition than the Author (author): pair 1 by gm, pair 2 by gm");
    expect(played.table).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
    expect(played.report).not.toContain("where the Author writes. Plain generation against a simple turn: ten pairs, interleaved, each turn sent after the previous one has finished\" (code): Passed");
  });

  test("a lead the settings name that is not the default gives the same: no verdict, before the first pair", async () => {
    const leads: Leads = { expected: "author", inForce: "gm", from: "chat", levels: [] };
    const played = await playReplay({ run: recordedRun({ form: "tag" }), ground: { observed: { plain: null, shipped: SERVED, layers: [], off: [], leads } } });
    expect(partOf(played, "first-words")[0]?.outcome).toBe("not judged");
    expect(partOf(played, "first-words")[0]?.why.startsWith("trial: the turn's lead is gm, not the Author")).toBe(true);
    expect(partOf(played, "conditions")[0]?.outcome).toBe("not judged");
  });

  test("the lead the floor holds the traces to is the one RPE's setting gives: a run led by `scribe` is the Author's where the shipped default is `scribe`", async () => {
    const leads: Leads = { expected: "scribe", inForce: "scribe", from: null, levels: [] };
    const played = await playReplay({ run: ledBy("scribe"), ground: { observed: { plain: null, shipped: SERVED, layers: [], off: [], leads } } });
    expect(partOf(played, "conditions")).toEqual([{ outcome: "met", why: expect.stringContaining("the Author leading every turn") }]);
    expect(played.table).not.toContain("TRIAL");
    // And the same traces under the default `author` are another definition's.
    expect(ledByOthers("author", ledBy("scribe").turns)[0]).toContain("pair 1 by scribe");
  });

  test("the conditions of the whole test name a lead that is not the Author, and a run whose lead was not read", () => {
    expect(floorConditions(recordedRun({ form: "tag" }))).toEqual([]);
    expect(floorConditions(ledBy("gm"))).toEqual(["a turn was led by another definition than the Author (author): pair 1 by gm, pair 2 by gm, pair 3 by gm, pair 4 by gm, pair 5 by gm, pair 6 by gm, pair 7 by gm, pair 8 by gm, pair 9 by gm, pair 10 by gm"]);
    expect(floorConditions({ ...recordedRun({ form: "tag" }), lead: null })).toContain("who the Author is was not read from RPE's lead setting");
    expect(noVerdict(recordedRun({ form: "tag" }))).toBeNull();
    expect(LEADS.expected).toBe("author");
  });
});
