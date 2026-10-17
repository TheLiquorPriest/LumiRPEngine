// Model-use preset notes state the preset's real per-turn ceiling of model steps, computed here
// from its steps and phase budgets (DESIGN §5.3), so a budget change can't leave the note behind.
// Each step run takes one call from its phase's budget when it starts; a disabled step never runs,
// and puzzle.answer is on unless set. No note claims a typical count: the call meter shows each
// turn's real one.

import { describe, expect, test } from "bun:test";
import { MODEL_USE_PRESETS } from "../../src/backend/settings-store";
import { PRESET_NOTE } from "../../src/frontend/settings/steps";
import type { ModelUseSettings } from "../../src/shared/settings";
import type { StepPurpose } from "../../src/shared/world";

const PRE: StepPurpose[] = ["interpret", "npc.choose", "puzzle.answer", "brief", "outline"];
const POST: StepPurpose[] = ["extract", "npc.choose", "contradiction", "choices"];

function ceiling(m: Omit<ModelUseSettings, "preset">): number {
  const on = (p: StepPurpose): boolean => m.steps[p]?.enabled ?? p === "puzzle.answer";
  // A Decision-routed interpret takes a second call to fill the chosen action's params.
  const runs = (p: StepPurpose): number => (!on(p) ? 0 : p === "interpret" && m.steps.interpret?.route?.provider === "decision" ? 2 : 1);
  const sum = (ps: StepPurpose[]): number => ps.reduce((s, p) => s + runs(p), 0);
  return Math.min(m.budgets.pre.calls, sum(PRE)) + Math.min(m.budgets.post.calls, sum(POST));
}

describe("model-use preset notes", () => {
  for (const id of ["lean", "standard", "full"] as const) {
    test(`${id}: the note's ceiling is the one its steps and budgets allow`, () => {
      const most = Number(PRESET_NOTE[id].match(/up to (\d+) model steps/)?.[1]);
      expect(most).toBe(ceiling(MODEL_USE_PRESETS[id]));
    });
  }

  test("no note guesses ('about 8') or claims a typical count; every note points at the call meter", () => {
    for (const note of Object.values(PRESET_NOTE)) {
      expect(note).not.toMatch(/about \d|typical/);
      expect(note).toMatch(/call meter/i);
    }
  });
});
