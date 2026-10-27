// Model-use preset notes state the preset's real per-turn ceiling of model steps, computed here
// from its steps and phase budgets (DESIGN §5.3), so a budget change can't leave the note behind;
// the same for lore lookups. Each step run takes one call from its phase's budget when it starts;
// a disabled step never runs, and puzzle.answer is on unless set. No note claims a typical count:
// the call meter shows each turn's real one. Settings saved by a build that still managed lore, or
// that still had the contradiction check, load without their retired keys; settings saved before
// lore policies existed load with their preset's.

import { describe, expect, test } from "bun:test";
import { defaultSettings, MODEL_USE_PRESETS, SettingsStore } from "../../src/backend/settings-store";
import { PRESET_NOTE } from "../../src/frontend/settings/steps";
import type { ModelUseSettings, StepConfig } from "../../src/shared/settings";
import { DEFAULT_STEP_LORE, stepLoreOf } from "../../src/shared/settings";
import type { StepPurpose } from "../../src/shared/world";
import { FakeHost } from "../support/fake-host";

const PRE: StepPurpose[] = ["interpret", "npc.choose", "puzzle.answer", "judge", "brief", "outline"];
const POST: StepPurpose[] = ["extract", "npc.choose", "choices"];

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

  for (const id of ["lean", "standard", "full"] as const) {
    test(`${id}: the note's lore lookups are the ones its budgets allow`, () => {
      const { pre, post } = MODEL_USE_PRESETS[id].budgets;
      const lookups = (pre.lookup?.calls ?? 0) + (post.lookup?.calls ?? 0);
      const said = PRESET_NOTE[id].match(/plus up to (\d+) lore lookups/)?.[1];
      expect(said === undefined ? 0 : Number(said)).toBe(lookups);
      if (lookups === 0) expect(PRESET_NOTE[id]).toContain("no lore lookups");
    });
  }

  test("no note guesses ('about 8') or claims a typical count; every note points at the call meter", () => {
    for (const note of Object.values(PRESET_NOTE)) {
      expect(note).not.toMatch(/about \d|typical/);
      expect(note).toMatch(/call meter/i);
    }
  });
});

/** The value at `path` in a settings file as stored. */
const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((x, k) => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>)[k] : undefined), v);

describe("settings saved by a build that still managed lore", () => {
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

describe("settings saved while the contradiction check was a step", () => {
  test("load without it, keep the preset and the user's other steps, and save clean", async () => {
    const host = new FakeHost();
    const user = host.userId;
    const current = defaultSettings();
    // Full as it was, with the check on the user's own connection and prompt.
    const check = { enabled: true, signals: ["reply"], route: { provider: "helper", connectionId: "conn-check", model: null }, template: "Does the reply break a fact?" };
    const old = { ...current, modelUse: { preset: "full", ...structuredClone(MODEL_USE_PRESETS.full), steps: { ...structuredClone(MODEL_USE_PRESETS.full.steps), contradiction: check } } };
    await host.storage.write("settings.json", JSON.stringify(old), user);
    const store = new SettingsStore(host);
    const loaded = await store.get(user);
    expect(loaded.modelUse.preset).toBe("full");
    expect(at(loaded, "modelUse", "steps", "contradiction")).toBeUndefined();
    expect(loaded.modelUse.steps).toEqual(MODEL_USE_PRESETS.full.steps);
    await store.set(user, { swipeDefault: "renarrate" });
    const saved: unknown = JSON.parse((await host.storage.read("settings.json", user)) ?? "null");
    expect(at(saved, "modelUse", "steps", "contradiction")).toBeUndefined();
    expect(at(saved, "modelUse", "preset")).toBe("full");
  });
});

describe("settings saved before lore policies existed", () => {
  const without = (steps: ModelUseSettings["steps"]): Record<string, Omit<StepConfig, "lore">> => Object.fromEntries(Object.entries(steps).map(([p, s]) => [p, { enabled: s.enabled, signals: [...s.signals], ...(s.route ? { route: { ...s.route } } : {}), ...(s.maxTokens !== undefined ? { maxTokens: s.maxTokens } : {}) }]));

  for (const id of ["lean", "standard", "full"] as const) {
    test(`${id}: loads with the preset's lore policies and lookups, and everything else as saved`, async () => {
      const host = new FakeHost();
      const preset = MODEL_USE_PRESETS[id];
      const { pre, post } = preset.budgets;
      const old = { ...defaultSettings(), swipeDefault: "renarrate", modelUse: { preset: id, steps: without(preset.steps), budgets: { pre: { calls: pre.calls }, post: { calls: post.calls } }, tokens: { ...preset.tokens } } };
      await host.storage.write("settings.json", JSON.stringify(old), host.userId);
      const loaded = await new SettingsStore(host).get(host.userId);
      expect(loaded.modelUse).toEqual({ preset: id, ...preset });
      expect(loaded.swipeDefault).toBe("renarrate");
    });
  }

  test("custom: a step keeps its own lore setting, takes Standard's where Standard has the step, and the default otherwise", async () => {
    const host = new FakeHost();
    const standard = MODEL_USE_PRESETS.standard;
    const steps = { ...without(standard.steps), brief: { enabled: true, signals: ["always"] }, extract: { enabled: true, signals: ["reply"], lore: { policy: "none", tokens: 0 } } };
    const old = { ...defaultSettings(), modelUse: { preset: "custom", steps, budgets: { pre: { calls: 3, ms: 30_000 }, post: { calls: 2, ms: 45_000, lookup: { calls: 0, ms: 0 } } }, tokens: { sections: 700 } } };
    await host.storage.write("settings.json", JSON.stringify(old), host.userId);
    const loaded = (await new SettingsStore(host).get(host.userId)).modelUse;
    expect(loaded.steps.interpret?.lore).toEqual(standard.steps.interpret?.lore);
    expect(loaded.steps.extract?.lore).toEqual({ policy: "none", tokens: 0 });
    expect(loaded.steps.brief?.lore).toBeUndefined();
    expect(stepLoreOf(loaded.steps.brief)).toEqual(DEFAULT_STEP_LORE);
    expect(loaded.budgets).toEqual({ pre: { calls: 3, lookup: standard.budgets.pre.lookup }, post: { calls: 2, lookup: { calls: 0 } } });
  });
});

describe("settings saved while the classifier gated interpret", () => {
  test("a step on the classifier runs on every typed message; every other signal the user chose stays", async () => {
    const host = new FakeHost();
    const standard = MODEL_USE_PRESETS.standard;
    const steps = {
      ...standard.steps,
      interpret: { ...standard.steps.interpret, signals: ["classifier"] },
      judge: { ...standard.steps.judge, signals: ["classifier", "conflict", "typed_input"] },
      choices: { enabled: true, signals: ["never"] },
    };
    await host.storage.write("settings.json", JSON.stringify({ ...defaultSettings(), modelUse: { ...defaultSettings().modelUse, preset: "custom", steps } }), host.userId);
    const store = new SettingsStore(host);
    const loaded = (await store.get(host.userId)).modelUse.steps;
    expect(loaded.interpret?.signals).toEqual(["typed_input"]);
    expect(loaded.judge?.signals).toEqual(["typed_input", "conflict"]);
    expect(loaded.choices?.signals).toEqual(["never"]);
    expect(loaded.extract?.signals).toEqual(["reply"]);
    // The next save writes the signals as read.
    await store.set(host.userId, { swipeDefault: "renarrate" });
    expect(await host.storage.read("settings.json", host.userId)).not.toContain("classifier");
  });

  test("a file still on Lean's or Standard's old default reads as its preset", async () => {
    for (const id of ["lean", "standard"] as const) {
      const host = new FakeHost();
      const preset = MODEL_USE_PRESETS[id];
      const old = { ...defaultSettings(), modelUse: { preset: id, ...structuredClone(preset), steps: { ...structuredClone(preset.steps), interpret: { ...preset.steps.interpret, signals: ["classifier"] } } } };
      await host.storage.write("settings.json", JSON.stringify(old), host.userId);
      expect((await new SettingsStore(host).get(host.userId)).modelUse).toEqual({ preset: id, ...preset });
    }
  });
});
