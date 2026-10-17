// Model-use preset notes state the preset's real per-turn ceiling of model steps, computed here
// from its steps and phase budgets (DESIGN §5.3), so a budget change can't leave the note behind.
// Each step run takes one call from its phase's budget when it starts; a disabled step never runs,
// and puzzle.answer is on unless set. No note claims a typical count: the call meter shows each
// turn's real one. Settings saved by a build that still managed lore load without its retired keys.

import { describe, expect, test } from "bun:test";
import { defaultSettings, MODEL_USE_PRESETS, SettingsStore } from "../../src/backend/settings-store";
import { PRESET_NOTE } from "../../src/frontend/settings/steps";
import type { ModelUseSettings } from "../../src/shared/settings";
import type { StepPurpose } from "../../src/shared/world";
import { FakeHost } from "../support/fake-host";

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

describe("settings saved by a build that still managed lore", () => {
  const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((x, k) => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>)[k] : undefined), v);

  test("load without the lore keys, keep the preset and the user's other choices, and save clean", async () => {
    const host = new FakeHost();
    const user = host.userId;
    const current = defaultSettings();
    const old = {
      ...current,
      swipeDefault: "renarrate",
      passThroughBooks: ["book-1"],
      modelUse: {
        ...current.modelUse,
        steps: { ...current.modelUse.steps, select: { enabled: true, signals: ["uncached"], route: null, template: null } },
        budgets: { ...current.modelUse.budgets, select: { calls: 1, ms: 8000 } },
        tokens: { sections: 600, lore: 800 },
      },
    };
    await host.storage.write("settings.json", JSON.stringify(old), user);
    const store = new SettingsStore(host);
    const loaded = await store.get(user);
    expect(loaded.modelUse.preset).toBe("standard");
    expect(loaded.swipeDefault).toBe("renarrate");
    expect(at(loaded, "modelUse", "steps", "select")).toBeUndefined();
    expect(at(loaded, "modelUse", "budgets", "select")).toBeUndefined();
    expect(loaded.modelUse.tokens).toEqual({ sections: 600 });
    expect(at(loaded, "passThroughBooks")).toBeUndefined();
    await store.set(user, { swipeDefault: "renarrate" });
    const saved: unknown = JSON.parse((await host.storage.read("settings.json", user)) ?? "null");
    for (const path of [["passThroughBooks"], ["modelUse", "steps", "select"], ["modelUse", "budgets", "select"], ["modelUse", "tokens", "lore"]]) expect(at(saved, ...path)).toBeUndefined();
    expect(at(saved, "swipeDefault")).toBe("renarrate");
  });
});
