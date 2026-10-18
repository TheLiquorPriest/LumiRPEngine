// A step no preset configures (DESIGN §5.2): Settings → Steps shows the config the turn runs it
// with, and its switch flips exactly that, so Puzzle answers reads On while it runs and Enabled
// turns it on rather than leaving it with no signals.

import { describe, expect, test } from "bun:test";
import { stepConfigOf } from "../../src/shared/settings";
import { defaultSettings } from "../../src/backend/settings-store";
import { noFacts, runsOf } from "../../src/backend/turn-steps";
import { baseWorld } from "../packs/support";

describe("a step no preset configures", () => {
  test("Puzzle answers shows On while it runs, and its switch turns it off and back on", () => {
    const world = baseWorld();
    const modelUse = defaultSettings().modelUse;
    expect(modelUse.steps["puzzle.answer"]).toBeUndefined();
    const card = stepConfigOf(modelUse.steps, "puzzle.answer");
    expect(card.enabled).toBe(true);
    expect(runsOf(modelUse, world, "puzzle.answer", noFacts())).toHaveLength(1);
    // The switch saves the card's config with `enabled` flipped.
    const flipped = (enabled: boolean) => ({ ...modelUse, steps: { ...modelUse.steps, "puzzle.answer": { ...card, enabled } } });
    expect(runsOf(flipped(false), world, "puzzle.answer", noFacts())).toEqual([]);
    expect(runsOf(flipped(true), world, "puzzle.answer", noFacts())).toHaveLength(1);
    // Any other step a preset leaves out is off, and shows Off.
    expect(stepConfigOf({}, "choices").enabled).toBe(false);
  });
});
