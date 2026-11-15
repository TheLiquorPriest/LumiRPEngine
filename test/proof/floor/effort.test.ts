// Same model, same thinking effort (PlanGates-4 item 4; R-92, N-7): the Author's effort from its
// `agent_started`, plain generation's from what Lumiverse holds; no verdict when they differ, and never
// when RPE's thinking is off while plain's is on.

import { describe, expect, test } from "bun:test";
import { effortRefusal, measuredRows } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

describe("the thinking effort of both arms", () => {
  test("a recorded run with RPE's thinking off while plain generation thinks is not judged", () => {
    const rows = measuredRows(recordedRun({ form: "two-step", effort: "off" }));
    expect(rows["first-words"].verdict).toBe("not judged");
    expect(rows["first-words"].why.join(" ")).toContain("RPE's thinking is off while plain generation's is on (at low)");
    expect(rows["per-token"].verdict).toBe("reported");
    const tag = measuredRows(recordedRun({ form: "tag", effort: "off" }));
    expect(tag["per-token"].verdict).toBe("not judged");
  });

  test("the same effort on both arms is judged; another effort, an effort Lumiverse leaves to the provider, or another model is not", () => {
    expect(effortRefusal(recordedRun({ form: "tag", effort: "low" }))).toBeNull();
    expect(measuredRows(recordedRun({ form: "tag", effort: "low" }))["first-words"].verdict).toBe("pass");
    expect(effortRefusal(recordedRun({ form: "tag", effort: "high" }))).toBe("the Author thinks at high and plain generation at low: not the same thinking effort");
    expect(effortRefusal(recordedRun({ form: "tag", plain: { apiReasoning: true, effort: "auto" } }))).toBe("the Author thinks at low and plain generation at auto: not the same thinking effort");
    expect(effortRefusal(recordedRun({ form: "tag", plain: { apiReasoning: null, effort: null } }))).toContain("not set in Lumiverse");
    expect(effortRefusal(recordedRun({ form: "tag", plain: { model: "another-model" } }))).toContain("not the same model");
    expect(effortRefusal(recordedRun({ form: "tag", effort: null }))).toContain("names no effort");
    expect(effortRefusal(recordedRun({ form: "tag", plain: { customBody: { from: "preset", reasoningKeys: ["reasoning_effort"] } } }))).toContain("sets reasoning_effort");
  });

  test("both arms with thinking off are the same effort", () => {
    expect(effortRefusal(recordedRun({ form: "tag", effort: "off", plain: { apiReasoning: false, effort: null } }))).toBeNull();
  });
});
