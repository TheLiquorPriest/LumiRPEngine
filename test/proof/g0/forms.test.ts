// G0 reads the floor model's reply form from the runs that counted it (PlanGates-17 items 1 and 2): the
// tags gate's and the two-step gate's own bundles, written by the runner. It stands on a count only when
// the folder reads back whole, the count is the folder's own, the play was a verdict, and the count stood
// on the same shipped files, the same model and the same place as G0's run; any other count is reported
// with its figures and with why it is not stood on.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldersWithCount, folderOf, needsTwoStep, readCount, readForms, usable, type Stands } from "../../../scripts/proof/g0/forms";
import { readBundle } from "../../../scripts/proof/route/evidence";
import { MODEL } from "../floor/recorded";
import { counted } from "./recorded";
import { playCountRun } from "./bundles";

const scratch = mkdtempSync(join(tmpdir(), "g0-forms-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** What G0's own run stands on when it reads a count made by a run on the same build, model and place. */
async function standsOf(dir: string): Promise<Stands> {
  return { mode: "rig", served: readBundle(dir).run.standing?.from?.served ?? null, model: MODEL };
}

describe("a count of the floor model's reply form", () => {
  test("a count a verdict run kept, on the same shipped files and model, is stood on, with its figures", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29) });
    const reading = readCount(dir, "tags", await standsOf(dir));
    expect(reading.not).toEqual([]);
    expect(usable(reading)).toBe(true);
    expect(reading.kept?.count).toMatchObject({ kept: 29, played: 30, verdict: "pass" });
    expect(needsTwoStep(reading)).toBe(false);
  });

  test("a count below the plan's 28 of 30 says the floor model needs the two-step form", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 8) });
    const reading = readCount(dir, "tags", await standsOf(dir));
    expect(usable(reading)).toBe(true);
    expect(needsTwoStep(reading)).toBe(true);
  });

  test("a count stood on other shipped files is reported and not stood on", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29) });
    const stands = await standsOf(dir);
    const reading = readCount(dir, "tags", { ...stands, served: "f".repeat(64) });
    expect(usable(reading)).toBe(false);
    expect(reading.kept?.count.kept).toBe(29);
    expect(reading.not.join(" ")).toContain("stood on other shipped files");
    // A figure below the plan's, taken from other files, never tells the owner the floor model needs the form.
    const low = await playCountRun(scratch, { form: "tags", kept: counted("tags", 8) });
    expect(needsTwoStep(readCount(low, "tags", { ...(await standsOf(low)), served: "f".repeat(64) }))).toBe(false);
  });

  test("a count played on another model than G0's Author is not stood on", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29) });
    const reading = readCount(dir, "tags", { ...(await standsOf(dir)), model: "another-model" });
    expect(reading.not.join(" ")).toContain(`played on ${MODEL} and this run's Author runs on another-model`);
  });

  test("a count played in the rig, read by a run on the bed, is not stood on", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29) });
    const reading = readCount(dir, "tags", { ...(await standsOf(dir)), mode: "live" });
    expect(reading.not.join(" ")).toContain("was played in the rig, and this run in the test bed");
  });

  test("a count whose run is not the folder's (moved from another run's bundle) is not stood on", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29, { run: "rig-20250101T000000Z", nonce: "someone-elses" }), asGiven: true });
    const reading = readCount(dir, "tags", await standsOf(dir));
    expect(usable(reading)).toBe(false);
    expect(reading.not.join(" ")).toContain("moved from another run's bundle");
  });

  test("a count that is not a count of the form asked for is not read at all", async () => {
    const dir = await playCountRun(scratch, { form: "two-step", kept: counted("tags", 29) });
    const reading = readCount(dir, "two-step", await standsOf(dir));
    expect(reading.kept).toBeNull();
    expect(reading.not.join(" ")).toContain("it counts the tags form, not the two-step form");
  });

  test("a run with no count of the form, and a folder that is not a bundle, are named", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29) });
    expect(readCount(dir, "two-step", await standsOf(dir)).not.join(" ")).toContain("holds no count of the two-step form");
    expect(readCount(join(scratch, "nowhere"), "tags", { mode: "rig", served: null, model: null }).not.join(" ")).toContain("could not be read back as a bundle");
  });

  test("a run whose play was a trial (the host gave no account of the guidance) is figures only", async () => {
    const dir = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29), edit: (facts) => (facts.guidance = null) });
    const reading = readCount(dir, "tags", { mode: "rig", served: null, model: MODEL });
    expect(usable(reading)).toBe(false);
    expect(reading.kept?.count.kept).toBe(29);
    expect(reading.not.join(" ")).toContain("trial");
  });
});

describe("where the counts are found", () => {
  test("named by option first, and else the newest run under the proof's output folder that holds one", async () => {
    const older = await playCountRun(scratch, { form: "tags", kept: counted("tags", 8), into: "shared-out", at: new Date("2026-11-15T10:00:00Z") });
    const newer = await playCountRun(scratch, { form: "tags", kept: counted("tags", 29), into: "shared-out", at: new Date("2026-11-15T10:05:00Z") });
    expect(folderOf({ G0_TAGS_RUN: older }, "tags")).toEqual({ dir: older });
    expect(folderOf({ G0_TAGS_RUN: join(scratch, "no-such-run") }, "tags")).toEqual({ why: `G0_TAGS_RUN names ${join(scratch, "no-such-run")}, which is not there` });
    const out = join(newer, "..");
    expect(foldersWithCount(out, "phase0-0.2-tags")).toEqual([newer, older]);
    expect(folderOf({ RPE_PROOF_OUT: out }, "tags")).toEqual({ dir: newer });
    expect(folderOf({ RPE_PROOF_OUT: out }, "two-step")).toEqual({ why: `no run under ${out} holds a count of the two-step form` });
    expect(folderOf({}, "tags")).toMatchObject({ why: expect.stringContaining("RPE_PROOF_OUT") });
  });

  test("both counts read together from their own folders", async () => {
    const tags = await playCountRun(scratch, { form: "tags", kept: counted("tags", 8) });
    const two = await playCountRun(scratch, { form: "two-step", kept: counted("two-step", 30) });
    const forms = readForms({ G0_TAGS_RUN: tags, G0_TWO_STEP_RUN: two }, await standsOf(tags));
    expect(needsTwoStep(forms.tags)).toBe(true);
    expect(forms.twoStep.kept?.calls).toMatchObject({ of: 30 });
    expect(forms.twoStep.not).toEqual([]);
  });
});
