// Settings → Steps and connections: every step's prompt editor reads alike. Each shows the built-in
// it works with: the text a prompt replaces, which the editor starts from, or what the instructions a
// prompt goes before hold. Saving a replaced built-in as it is shown leaves the step on its default.

import { describe, expect, test } from "bun:test";
import { stepBuiltIn, stepPromptPatch } from "../../src/frontend/settings/steps";
import { STEP_LABEL } from "../../src/shared/steps";
import type { StepPurpose } from "../../src/shared/world";

const PURPOSES = Object.keys(STEP_LABEL) as StepPurpose[];

describe("each step's built-in prompt in Settings", () => {
  test("every step has one to show", () => {
    for (const purpose of PURPOSES) expect(stepBuiltIn(purpose).text.trim()).not.toBe("");
  });

  test("the steps whose prompt goes before their instructions are the two reading steps; the rest start from the text they replace", () => {
    expect(PURPOSES.filter((p) => stepBuiltIn(p).use === "added").sort()).toEqual(["extract", "interpret"]);
  });

  test("saving a replaced built-in unchanged keeps the step on its default", () => {
    for (const purpose of PURPOSES.filter((p) => stepBuiltIn(p).use === "replaced" && p !== "mind" && p !== "memory" && p !== "consolidate" && p !== "knowledge")) {
      const { text } = stepBuiltIn(purpose);
      expect(stepPromptPatch(purpose, text, text)).toEqual({ modelUse: { steps: { [purpose]: { template: null } } } });
    }
  });
});
