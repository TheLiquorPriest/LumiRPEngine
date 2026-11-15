// The owner's G0 report, written from recorded runs (PlanGates-17 items 2 and 3): every row with its
// figure and verdict; whether the floor model needs the two-step form; the effort both arms ran at, the
// shipped definition's, and §22's low-effort figures beside it; each pair's two replies side by side; the
// call that is his. After a failed G0, the variants measured in runs of their own are listed with their
// figures, what each changed and the options. The report is the same whether it is made from the play's
// own run or read back from the bundle.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryOf, FIRST_BUILD_EFFORT, HIS_CALL, renderReport, type Entry } from "../../../scripts/proof/g0/report";
import { FIX_THE_DESIGN, KEEP_TWO_STEP, OTHER_MODEL, STOP_HERE } from "../../../scripts/proof/g0/notice";
import { LINES } from "../../../scripts/testbed/floor-fixture";
import { g0Rows } from "../../../scripts/proof/g0/verdict";
import { keepsTags, losesTags, noCounts, soundRun } from "./recorded";
import { playG0Replay, type G0Replay } from "./replay";

const scratches: string[] = [];
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** How many runs have been made, so each starts a minute after the one before and has a name of its own. */
let made = 0;

/** Plays G0 over a recorded run and reads its bundle back as the report reads it. */
async function entryFrom(replay: G0Replay): Promise<Entry> {
  const scratch = mkdtempSync(join(tmpdir(), "g0-report-"));
  scratches.push(scratch);
  const played = await playG0Replay({ at: new Date(Date.UTC(2026, 10, 20, 10, (made += 1))), ...replay }, scratch);
  return entryOf(played.dir);
}

describe("the report of a first run", () => {
  test("holds every row with its figure and verdict, the effort, §22's figures, each pair's replies and his question", async () => {
    const entry = await entryFrom({ run: soundRun({ form: "tag" }), forms: keepsTags() });
    const text = renderReport([entry]);
    expect(text).toContain("Result of the first run: PASSED");
    for (const row of g0Rows(entry.floor)) {
      expect(text).toContain(`### ${row.measure}: PASS`);
      expect(text).toContain(`- Measured: ${row.measured}`);
      expect(text).toContain(`- Asked: ${row.pass}`);
    }
    // The effort both arms ran at, the shipped definition's, and the first build's figures beside them.
    expect(text).toContain("The Author ran at: low. Plain generation, on the same model through Lumiverse, ran at: low. The two arms' effort is the same.");
    expect(text).toContain("The shipped Author definition names: high.");
    expect(text).toContain("Any change of the value is your choice, made in that file.");
    for (const r of FIRST_BUILD_EFFORT.rows) expect(text).toContain(`| ${r.effort} | ${r.first} | ${r.calls} |`);
    expect(text).toContain("| high | 16.9 s | exactly 2 calls in 16 of 20 turns |");
    expect(text).toContain("| low | 9.4 s | exactly 2 calls in 18 of 20 turns, the intent record written first in 20 of 20 |");
    // Each pair's two turns side by side, each arm with the line it was sent (one chat takes each line once).
    for (let pair = 1; pair <= 10; pair++) expect(text).toContain(`| ${pair} | ${LINES[2 * pair - 2]}\n\nThe invented reply of plain generation to line ${pair}a, written whole. | ${LINES[2 * pair - 1]}\n\nThe invented reply of RPE to line ${pair}b, written whole. |`.replace(/\n/g, "<br>"));
    // The call that is his.
    expect(text).toContain(HIS_CALL);
    expect(text).toContain("a frontier-model key on the test bed");
    expect(text).toContain("a checkpoint on your private server at wave 3");
    expect(text).toContain("no call is made to any other model");
  });

  test("says whether the floor model needs the two-step form, with both counts and where each was read", async () => {
    const lost = renderReport([await entryFrom({ run: soundRun({ form: "two-step" }), forms: losesTags() })]);
    expect(lost).toContain("The floor model needs the two-step form");
    expect(lost).toContain("A test model that cannot stream a reply is a poor floor to build on");
    expect(lost).toContain("tag form: kept in 8 of 30 turns (the plan asks 28 of 30)");
    expect(lost).toContain("two-step form: kept in 30 of 30 turns");
    expect(lost).toContain(KEEP_TWO_STEP);
    const kept = renderReport([await entryFrom({ run: soundRun({ form: "tag" }), forms: keepsTags() })]);
    expect(kept).toContain("The floor model keeps the tags");
    expect(kept).not.toContain("The floor model needs the two-step form");
    const unknown = renderReport([await entryFrom({ run: soundRun({ form: "tag" }), forms: noCounts() })]);
    expect(unknown).toContain("Whether the floor model needs the two-step form is not known");
    expect(unknown).toContain("no count was read: no run folder is named");
  });

  test("a run with no verdict is reported as that, with every reason, and the rows it measured still shown", async () => {
    const entry = await entryFrom({ run: soundRun({ form: "tag", pairs: 10 }), ground: { observed: { plain: null, shipped: [], layers: [], off: [], leads: { expected: "author", inForce: "author", from: null, levels: [] } } } });
    const text = renderReport([entry]);
    expect(text).toContain("Result of the first run: NO VERDICT (trial)");
    expect(text).toContain("### First words on screen: no verdict (trial)");
    expect(text).not.toContain("PASSED");
  });

  test("the effort is said as it was read: a shipped definition not read is named, and an effort that differs is not judged the same", async () => {
    const run = soundRun({ form: "tag", plain: { effort: "high" } });
    const entry = await entryFrom({ run, shipped: null });
    const text = renderReport([entry]);
    expect(text).toContain("The shipped Author definition names: not read.");
    expect(text).toContain("The comparison rows are not judged on effort: the Author thinks at low and plain generation at high: not the same thinking effort.");
  });

  test("written again from the bundle it gives the same report as from another read of the same play", async () => {
    const at = new Date("2026-11-20T10:00:00Z");
    const a = await entryFrom({ run: soundRun({ form: "tag" }), at });
    const b = await entryFrom({ run: soundRun({ form: "tag" }), at });
    expect(renderReport([a])).toBe(renderReport([b]));
  });
});

describe("the report over a failed first run and the variants measured after it", () => {
  const missing = (pair: number) => (pair <= 3 ? 1 : 0);

  test("lists the first run and both variants with their figures, what each changed, and the options", async () => {
    const first = await entryFrom({ run: soundRun({ form: "tag", extraCalls: missing }), forms: keepsTags() });
    const twoStep = await entryFrom({ run: soundRun({ form: "two-step", extraCalls: missing }), forms: keepsTags(), variant: "the two-step form, wording as shipped" });
    const lowered = await entryFrom({ run: soundRun({ form: "tag", extraCalls: (pair) => (pair <= 2 ? 1 : 0), effort: "low", plain: { effort: "low" } }), forms: keepsTags(), variant: "the Author's effort set to low in its definition" });
    const text = renderReport([first, twoStep, lowered]);
    expect(text).toContain("Result of the first run: FAILED");
    expect(text).toContain("## Variants measured after the first run");
    // Both variants, each with its figures.
    expect(text).toContain("(the two-step form, wording as shipped)");
    expect(text).toContain("- Changed against the first run: reply form the tags → the two-step form; its label: the two-step form, wording as shipped.");
    expect(text).toContain("its label: the Author's effort set to low in its definition");
    const figures = (e: Entry) => g0Rows(e.floor).map((r) => `- ${r.measure}: ${r.verdict === "pass" ? "PASS" : r.verdict === "fail" ? "FAIL" : r.verdict === "reported" ? "REPORTED" : "NOT JUDGED"}: ${r.measured} (${r.stands})`);
    for (const line of [...figures(twoStep), ...figures(lowered)]) expect(text).toContain(line);
    expect(text).toContain("exactly 2 in 7 of 10");
    expect(text).toContain("exactly 1 in 8 of 10");
    // None passed: the plan's options, and his call.
    expect(text).toContain(`1. ${FIX_THE_DESIGN}`);
    expect(text).toContain(`2. ${STOP_HERE}`);
    expect(text).toContain(`3. ${OTHER_MODEL}`);
  });

  test("a variant that passes is named as the design to keep, and the choice is his", async () => {
    const first = await entryFrom({ run: soundRun({ form: "tag", extraCalls: missing }), forms: keepsTags() });
    const second = await entryFrom({ run: soundRun({ form: "two-step" }), forms: keepsTags(), variant: "the two-step form" });
    const text = renderReport([first, second]);
    expect(text).toContain("Keep the design of a run that passed (");
    expect(text).toContain("which is your choice to make (the Author's effort is the `effort:` of its definition)");
    expect(text).not.toContain(FIX_THE_DESIGN);
    expect(text).toContain(OTHER_MODEL);
  });

  test("a report is of at least one run", () => {
    expect(() => renderReport([])).toThrow("at least one run");
  });
});

describe("a folder that is not a run of G0", () => {
  test("is refused by name, never reported on", () => {
    expect(() => entryOf(join(tmpdir(), "no-such-g0-run"))).toThrow();
  });
});
