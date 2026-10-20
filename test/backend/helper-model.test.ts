// The helper model (Settings → Helper model): the connection, model and reasoning effort every
// helper call runs on unless its step picks its own; and the budgets sized for reasoning models,
// with a settings file from before them lifted where it still held an old default.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { createSpindleHost } from "../../src/backend/spindle-host";
import type { QuietRequest } from "../../src/backend/host";
import type { StepLore } from "../../src/backend/lore-steps";
import type { ModelUseSettings, UserSettings } from "../../src/shared/settings";
import { MINDS_PRESETS, type MindsSettings } from "../../src/shared/minds";
import { MODEL_USE_PRESETS } from "../../src/backend/settings-store";
import { Rig } from "../support/rig";

const signal = () => new AbortController().signal;

async function settingsOf(rig: Rig): Promise<UserSettings> {
  return rig.body(await rig.send({ type: "lre.settings.get" })).settings as UserSettings;
}

const HELPER = { connectionId: "conn-helper", model: "flash", effort: "low", maxTokens: 12_000, params: { temperature: 0.4, top_p: 0.9 } } as const;

describe("the helper model", () => {
  test("a new user's helper calls get room to reason, on Lumiverse's default connection with its own model and settings", async () => {
    const rig = new Rig();
    const settings = await settingsOf(rig);
    rig.host.quietReply = () => "{}";
    await rig.rt.steps.helperJson("extract", "Say {}.", "x", settings.modelUse.steps.extract ?? null, rig.host.userId, signal());
    expect(rig.host.quietCalls.at(-1)).toMatchObject({ maxTokens: 8192, connectionId: null, model: null, effort: "inherit", params: {} });
  });

  test("a call with no step override carries the helper model's connection, model, effort, max tokens and parameters", async () => {
    const rig = new Rig();
    await rig.send({ type: "lre.settings.set", patch: { helper: HELPER } });
    const settings = await settingsOf(rig);
    rig.host.quietReply = () => "{}";
    for (const purpose of ["extract", "interpret", "judge", "mind"] as const) {
      await rig.rt.steps.helperJson(purpose, "Say {}.", "x", settings.modelUse.steps[purpose] ?? null, rig.host.userId, signal());
      expect(rig.host.quietCalls.at(-1)).toMatchObject({ connectionId: "conn-helper", model: "flash", effort: "low", maxTokens: 12_000, params: { temperature: 0.4, top_p: 0.9 } });
    }
    // Picking a preset replaces the steps, never the helper model.
    const lean = rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "lean" } } })).settings as UserSettings;
    expect(lean.helper).toEqual(HELPER);
  });

  test("a step's own connection, model, effort, max tokens and parameters win, each on its own", async () => {
    const rig = new Rig();
    await rig.send({ type: "lre.settings.set", patch: { helper: HELPER } });
    const steps = {
      interpret: { maxTokens: 3000, route: { provider: "helper", connectionId: "conn-step", model: "pro", effort: "high", params: { temperature: 1.2 } } },
      judge: { route: { provider: "helper", connectionId: null, model: null, effort: "off" } },
    };
    await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps } } });
    const settings = await settingsOf(rig);
    rig.host.quietReply = () => "{}";
    const ask = async (purpose: "interpret" | "judge"): Promise<QuietRequest | undefined> => {
      await rig.rt.steps.helperJson(purpose, "Say {}.", "x", settings.modelUse.steps[purpose] ?? null, rig.host.userId, signal());
      return rig.host.quietCalls.at(-1);
    };
    expect(await ask("interpret")).toMatchObject({ connectionId: "conn-step", model: "pro", effort: "high", maxTokens: 3000, params: { temperature: 1.2, top_p: 0.9 } });
    expect(await ask("judge")).toMatchObject({ connectionId: "conn-helper", model: "flash", effort: "off", maxTokens: 12_000, params: { temperature: 0.4, top_p: 0.9 } });
  });

  test("a decision's lore lookup runs on the helper model", async () => {
    const rig = new Rig();
    await rig.send({ type: "lre.settings.set", patch: { helper: HELPER } });
    rig.host.quietReply = () => JSON.stringify({ need: [] });
    const lore = { offer: () => "need" as const, spend: () => undefined, block: () => "", instructions: () => "", refuseTools: () => "need" as const, keepRefusal: () => undefined, asked: () => null, answer: () => undefined, lines: () => [], release: () => undefined, tools: [] };
    await rig.rt.steps.decide("npc.choose", {}, { a: { type: "noul", instructions: "x" } }, { enabled: true, signals: [], route: { provider: "decision", connectionId: null, model: null } }, rig.host.userId, signal(), lore as unknown as StepLore);
    expect(rig.host.quietCalls[0]).toMatchObject({ connectionId: "conn-helper", model: "flash", effort: "low", maxTokens: 12_000, params: { temperature: 0.4 } });
  });

  test("the model, parameters and effort reach Lumiverse's generation call; the connection's own reasoning sends no override", async () => {
    const sent: Record<string, unknown>[] = [];
    const connections = [{ id: "c", provider: "deepseek", is_default: false }];
    const spindle = { generate: { quiet: async (request: Record<string, unknown>) => (sent.push(request), { content: "{}", finish_reason: "stop" }) }, connections: { list: async () => connections } };
    Object.assign(globalThis, { spindle });
    try {
      const host = createSpindleHost();
      const base = { messages: [{ role: "user" as const, content: "x" }], maxTokens: 8192, json: true, connectionId: "c", model: "flash", params: { temperature: 0.4, top_k: 20 } };
      await host.models.quiet({ ...base, effort: "high" }, "u", signal());
      await host.models.quiet({ ...base, effort: "off" }, "u", signal());
      await host.models.quiet({ ...base, effort: "inherit" }, "u", signal());
      expect(sent.map((r) => r.reasoning)).toEqual([{ source: "custom", apiReasoning: true, effort: "high" }, { source: "off" }, undefined]);
      expect(sent[0]?.connection_id).toBe("c");
      expect(sent[0]?.parameters).toEqual({ temperature: 0.4, top_k: 20, max_tokens: 8192, response_format: { type: "json_object" }, model: "flash" });
    } finally {
      Object.assign(globalThis, { spindle: undefined });
    }
  });

  test("JSON mode goes only to providers that take it: an Anthropic or Google connection, named or the default, gets none", async () => {
    const sent: Record<string, unknown>[] = [];
    const connections = [
      { id: "claude", provider: "anthropic", is_default: true },
      { id: "gemini", provider: "google", is_default: false },
      { id: "ds", provider: "deepseek", is_default: false },
    ];
    const spindle = { generate: { quiet: async (request: Record<string, unknown>) => (sent.push(request), { content: "{}", finish_reason: "stop" }) }, connections: { list: async () => connections } };
    Object.assign(globalThis, { spindle });
    try {
      const host = createSpindleHost();
      const ask = (connectionId?: string) => host.models.quiet({ messages: [{ role: "user" as const, content: "x" }], maxTokens: 100, json: true, ...(connectionId ? { connectionId } : {}) }, "u", signal());
      await ask("claude");
      await ask("gemini");
      await ask();
      await ask("ds");
      expect(sent.map((r) => (r.parameters as Record<string, unknown>).response_format ?? null)).toEqual([null, null, null, { type: "json_object" }]);
    } finally {
      Object.assign(globalThis, { spindle: undefined });
    }
  });

  test("what a step leaves to the helper model is cleared, and the helper's applies again", async () => {
    const rig = new Rig();
    await rig.send({ type: "lre.settings.set", patch: { helper: HELPER, modelUse: { preset: "custom", steps: { extract: { maxTokens: 3000, route: { provider: "helper", connectionId: null, model: null, effort: "max", params: { temperature: 1.5 } } } } } } });
    await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps: { extract: { maxTokens: null, route: { provider: "helper", connectionId: null, model: null, effort: null, params: { temperature: null } } } } } } });
    const settings = await settingsOf(rig);
    expect(settings.modelUse.steps.extract?.route?.effort).toBeUndefined();
    rig.host.quietReply = () => "{}";
    await rig.rt.steps.helperJson("extract", "Say {}.", "x", settings.modelUse.steps.extract ?? null, rig.host.userId, signal());
    expect(rig.host.quietCalls.at(-1)).toMatchObject({ effort: "low", maxTokens: 12_000, params: { temperature: 0.4, top_p: 0.9 } });
  });

  test("parameters out of range or of the wrong type are left to the connection", async () => {
    const rig = new Rig();
    const s = rig.body(await rig.send({ type: "lre.settings.set", patch: { helper: { params: { temperature: 9, top_p: "high", top_k: 40, presence_penalty: -1 } } } })).settings as UserSettings;
    expect(s.helper.params).toEqual({ top_k: 40, presence_penalty: -1 });
  });
});

describe("budgets for reasoning models", () => {
  test("every preset gives its helper steps 8,192 tokens or more, and more lore, lookups and section room than before", async () => {
    const rig = new Rig();
    for (const preset of ["lean", "standard", "full"] as const) {
      const s = rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset } } })).settings as UserSettings;
      // No preset step sets its own max tokens: each runs with the helper model's, 8,192 by default.
      for (const step of Object.values(s.modelUse.steps)) expect(step.maxTokens).toBeUndefined();
      expect(s.helper.maxTokens).toBeGreaterThanOrEqual(8192);
      const lore = Object.values(s.modelUse.steps).flatMap((step) => (step.lore && step.lore.policy !== "none" ? [step.lore.tokens] : []));
      expect(Math.min(...lore)).toBeGreaterThanOrEqual(800);
      expect(s.modelUse.tokens.sections).toBeGreaterThanOrEqual(1200);
      expect(s.minds.tokens).toBeGreaterThanOrEqual(1200);
    }
    const standard = rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "standard" } } })).settings as UserSettings;
    expect((standard.modelUse.budgets.pre.lookup?.calls ?? 0) + (standard.modelUse.budgets.post.lookup?.calls ?? 0)).toBeGreaterThan(3);
  });

  test("values past the old caps are kept: 100,000 max tokens, 30,000 lore tokens, 40 lookups, 50,000 recall tokens", async () => {
    const rig = new Rig();
    const patch = {
      modelUse: { preset: "custom", steps: { extract: { maxTokens: 100_000, lore: { policy: "prefetch", tokens: 30_000 } } }, budgets: { pre: { lookup: { calls: 40, ms: 60_000 } } } },
      minds: { memory: { recall: { tokens: 50_000 } } },
    };
    const s = rig.body(await rig.send({ type: "lre.settings.set", patch })).settings as UserSettings;
    expect(s.modelUse.steps.extract).toMatchObject({ maxTokens: 100_000, lore: { tokens: 30_000 } });
    expect(s.modelUse.budgets.pre.lookup?.calls).toBe(40);
    expect(s.minds.memory.recall?.tokens).toBe(50_000);
  });
});

describe("settings saved before the budgets rose", () => {
  const OLD_STEP = (lore: number, maxTokens = 2000) => ({ enabled: true, signals: ["reply"], route: { provider: "helper", connectionId: null, model: null }, maxTokens, lore: { policy: "prefetch+lookup", tokens: lore } });

  test("values still at an old default take the new one; values the user changed stay theirs", async () => {
    const rig = new Rig();
    const fresh = await settingsOf(rig);
    const modelUse = {
      preset: "custom",
      steps: { extract: OLD_STEP(400), interpret: OLD_STEP(450, 3000), judge: OLD_STEP(400, 2000) },
      budgets: { pre: { calls: 2, ms: 30_000, lookup: { calls: 2, ms: 15_000 } }, post: { calls: 3, ms: 50_000, lookup: { calls: 2, ms: 20_000 } } },
      tokens: { sections: 600 },
    };
    const minds: Partial<MindsSettings> = { ...fresh.minds, tokens: 600 };
    const old = { v: 1, modelUse, realism: fresh.realism, time: fresh.time, minds };
    await rig.host.storage.write("settings.json", JSON.stringify(old), rig.host.userId);
    const reloaded = rig.restart();
    const s = await settingsOf(reloaded);
    const steps: ModelUseSettings["steps"] = s.modelUse.steps;
    // The old 2,000 is dropped: the step takes the helper model's max tokens.
    expect(steps.extract).toMatchObject({ lore: { tokens: 1600 } });
    expect(steps.extract?.maxTokens).toBeUndefined();
    // The user's own 3,000 tokens and 450 lore tokens stay.
    expect(steps.interpret).toMatchObject({ maxTokens: 3000, lore: { tokens: 450 } });
    // The old Standard wall clock and lookups rise, with the calls kept; values the user changed stay as set.
    const standard = MODEL_USE_PRESETS.standard;
    expect(s.modelUse.budgets.pre).toEqual({ calls: 2, lookup: standard.budgets.pre.lookup });
    expect(s.modelUse.budgets.post).toEqual({ calls: 3, lookup: { calls: 2 } });
    // The old Standard wall clocks and lookup windows move to Timeouts, risen to the new defaults; the user's own 50 s stays.
    expect(s.timeouts).toMatchObject({ engineRunMs: 300_000, preLookupMs: 120_000, postReplyMs: 50_000, postLookupMs: 120_000 });
    expect(s.modelUse.tokens.sections).toBe(standard.tokens.sections);
    expect(s.minds.tokens).toBe(MINDS_PRESETS.standard.tokens);
    expect(s.helper).toEqual({ connectionId: null, model: null, effort: "inherit", maxTokens: 8192, params: {} });
    // Once saved, the file is read as it is: a later 2,000 the user sets is theirs.
    await reloaded.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps: { extract: { maxTokens: 2000 } } } } });
    const again = await settingsOf(reloaded.restart());
    expect(again.modelUse.steps.extract?.maxTokens).toBe(2000);
  });
});
