// G0's command line: the report and the notices written again from run folders alone (PlanGates-17 items 2
// to 4). A bundle gives the same report the play kept; a folder that is not a run of G0 is named and
// refused; the notices of a run are the ones its play printed.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../scripts/proof/g0/run";
import { keepsTags, losesTags, soundRun } from "./recorded";
import { playG0Replay, type G0Played, type G0Replay } from "./replay";

const scratches: string[] = [];
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** How many runs have been made, so each starts a minute after the one before. */
let made = 0;

/** Plays G0 over a recorded run into a folder of its own, left for the test's end. */
async function bundle(replay: G0Replay): Promise<G0Played> {
  const scratch = mkdtempSync(join(tmpdir(), "g0-cli-"));
  scratches.push(scratch);
  return playG0Replay({ at: new Date(Date.UTC(2026, 10, 20, 11, (made += 1))), ...replay }, scratch);
}

/** What a command printed and the code it gave. */
async function run(...argv: string[]): Promise<{ code: number; text: string }> {
  const printed: string[] = [];
  const code = await main(argv, (text) => void printed.push(text));
  return { code, text: printed.join("") };
}

describe("the report from run folders alone", () => {
  test("the first folder is the first run and each after it a variant; the same report the play kept for its own run", async () => {
    const first = await bundle({ run: soundRun({ form: "tag", extraCalls: (pair) => (pair <= 3 ? 1 : 0) }), forms: keepsTags() });
    const variant = await bundle({ run: soundRun({ form: "two-step" }), forms: keepsTags(), variant: "the two-step form" });
    const alone = await run("report", first.dir);
    expect(alone.code).toBe(0);
    expect(alone.text.trimEnd()).toBe(first.internal["report.md"]?.trimEnd() ?? "no report kept");
    const both = await run("report", first.dir, variant.dir);
    expect(both.text).toContain("## Variants measured after the first run");
    expect(both.text).toContain("(the two-step form): PASSED");
  });

  test("a folder that is not a run of G0, or a command without one, is refused with usage and a code", async () => {
    const nowhere = await run("report", join(tmpdir(), "no-such-g0-run"));
    expect(nowhere.code).toBe(1);
    expect(nowhere.text).toContain("run.json");
    const none = await run("report");
    expect(none.code).toBe(2);
    expect(none.text).toContain("usage:");
    expect((await run("notices", "a", "b")).code).toBe(2);
    expect((await run("sing", "a")).code).toBe(2);
  });
});

describe("the notices of a run from its folder", () => {
  test("a failed run's notices are the ones its play printed", async () => {
    const failed = await bundle({ run: soundRun({ form: "two-step", extraCalls: (pair) => (pair <= 3 ? 1 : 0) }), forms: losesTags() });
    const told = await run("notices", failed.dir);
    expect(told.code).toBe(0);
    expect(told.text).toBe(failed.printed.join(""));
    expect(told.text).toContain("the floor model cannot keep the reply's tags");
    expect(told.text).toContain("G0 failed: model calls on the reply's path");
  });

  test("a run that calls for none says so", async () => {
    const passed = await bundle({ run: soundRun({ form: "tag" }), forms: keepsTags() });
    const told = await run("notices", passed.dir);
    expect(told.code).toBe(0);
    expect(told.text).toContain("calls for no notice");
  });
});
