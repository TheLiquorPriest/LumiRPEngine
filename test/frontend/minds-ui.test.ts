// The minds screens' requests (DESIGN §24.6, §24.2, §24.9): Settings → Minds patches, Build → World →
// Minds values, and the GM view's controls, each sent to a real backend and read back.

import { describe, expect, test } from "bun:test";
import { commitmentDraft, commitmentOp, deleteOp, narratorGets, noteOp, pinOp, planDraft, planLasts, planOp, refreshOp, startPlanIn, type MindPart } from "../../src/packs/minds/ui/ops";
import { MEMORY_FIELDS, memoryOverride, memoryOverridePatch, mindsPolicyPatch, mindsPromptPatch, withMemoryLevel } from "../../src/frontend/settings/minds-patch";
import { mindsPartValue } from "../../src/frontend/build/minds-editor";
import { decodeContextView } from "../../src/frontend/play/context";
import { mindTracesOf } from "../../src/backend/inspector-log";
import { parseEditOps } from "../../src/engine/edits";
import { editRequest } from "../../src/frontend/requests";
import type { JsonObject } from "../../src/shared/json";
import type { MindCallTrace, MindsSettings, WorldMindsConfig } from "../../src/shared/minds";
import { DEFAULT_WORLD_MINDS, MIND_PROMPT_DEFAULTS, MIND_PROMPT_MAX, MINDS_PRESETS, worldMindsOf } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { stepUpdatePatch } from "../../src/frontend/settings/steps";
import { mindsOn, mindsStepConfig } from "../../src/backend/minds";
import { HELPER_MAX_TOKENS, stepConfigOf, type ModelUseSettings } from "../../src/shared/settings";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { mindLines } from "../../src/packs/minds/core/section";
import { readCharacter } from "../../src/packs/minds/core/state";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";

const field = (part: string, key: string) => {
  const f = MEMORY_FIELDS.find((x) => x.part === part && x.key === key);
  if (!f) throw new Error(`no field ${part}.${key}`);
  return f;
};

async function settingsAfter(rig: Rig, patch: JsonObject | null): Promise<{ minds: MindsSettings; preset: string }> {
  if (!patch) throw new Error("no patch");
  const body = rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const settings = body.settings as { minds: MindsSettings; modelUse: { preset: string } };
  return { minds: settings.minds, preset: settings.modelUse.preset };
}

describe("Settings → Minds patches", () => {
  test("a cadence change makes the Model use preset Custom and only touches what it names", () => {
    expect(mindsPolicyPatch({ liveLimit: "none" })).toEqual({ modelUse: { preset: "custom" }, minds: { liveLimit: "none" } });
    expect(mindsPolicyPatch({ nearRefresh: { turns: 2 } })).toEqual({ modelUse: { preset: "custom" }, minds: { nearRefresh: { turns: 2 } } });
    // Levels go in ladder order, and Background never writes notes.
    expect(mindsPolicyPatch({ memoryLevels: ["far", "background", "live"] }).minds).toEqual({ memoryLevels: ["live", "far"] });
    expect(withMemoryLevel(["live"], "near", true)).toEqual(["live", "near"]);
    expect(withMemoryLevel(["live", "near"], "live", false)).toEqual(["near"]);
  });

  test("a prompt equal to the built-in, or empty, saves no override; one too long saves nothing", () => {
    expect(mindsPromptPatch("mind", `  ${MIND_PROMPT_DEFAULTS.mind}\n`)).toEqual({ minds: { prompts: { mind: null } } });
    expect(mindsPromptPatch("skip", "   ")).toEqual({ minds: { prompts: { skip: null } } });
    expect(mindsPromptPatch("memory", "Remember as them.")).toEqual({ minds: { prompts: { memory: "Remember as them." } } });
    expect(mindsPromptPatch("memory", "x".repeat(MIND_PROMPT_MAX + 1))).toBeNull();
  });

  test("a memory override must fit its range and kind", () => {
    expect(memoryOverridePatch(field("notes", "show"), 5)).toEqual({ minds: { memory: { notes: { show: 5 } } } });
    expect(memoryOverridePatch(field("notes", "show"), 2.5)).toBeNull();
    expect(memoryOverridePatch(field("notes", "keep"), 0)).toBeNull();
    expect(memoryOverridePatch(field("salience", "floor"), 0.7)).toEqual({ minds: { memory: { salience: { floor: 0.7 } } } });
    expect(memoryOverridePatch(field("consolidate", "enabled"), false)).toEqual({ minds: { memory: { consolidate: { enabled: false } } } });
    expect(memoryOverridePatch(field("consolidate", "enabled"), 3)).toBeNull();
    expect(memoryOverridePatch(field("consolidate", "periodDays"), 0)).toBeNull();
    expect(memoryOverridePatch(field("consolidate", "periodDays"), 0.5)).toEqual({ minds: { memory: { consolidate: { periodDays: 0.5 } } } });
    expect(memoryOverridePatch(field("notes", "show"), null)).toEqual({ minds: { memory: { notes: { show: null } } } });
  });

  test("every control reaches the settings store and reads back", async () => {
    const rig = new Rig();
    let s = await settingsAfter(rig, mindsPolicyPatch({ liveLimit: "none" }));
    expect(s.minds.liveLimit).toBe("none");
    expect(s.preset).toBe("custom");
    s = await settingsAfter(rig, mindsPolicyPatch({ liveLimit: 5, farRefreshMinutes: "none", refreshLimit: "none", tokens: 900, skip: { maxBeats: 2 } }));
    expect([s.minds.liveLimit, s.minds.farRefreshMinutes, s.minds.refreshLimit, s.minds.tokens, s.minds.skip]).toEqual([5, "none", "none", 900, { maxBeats: 2, maxMindsPerBeat: MINDS_PRESETS.standard.skip.maxMindsPerBeat }]);
    s = await settingsAfter(rig, mindsPolicyPatch({ refreshLimit: 4 }));
    expect(s.minds.refreshLimit).toBe(4);
    s = await settingsAfter(rig, mindsPolicyPatch({ nearRefresh: { mention: false, minutes: "none" } }));
    expect(s.minds.nearRefresh).toEqual({ ...MINDS_PRESETS.standard.nearRefresh, mention: false, minutes: "none" });
    s = await settingsAfter(rig, mindsPolicyPatch({ memoryLevels: withMemoryLevel(s.minds.memoryLevels, "far", true) }));
    expect(s.minds.memoryLevels).toEqual(["live", "far"]);
    s = await settingsAfter(rig, mindsPolicyPatch({ enabled: false }));
    expect(s.minds.enabled).toBe(false);

    s = await settingsAfter(rig, mindsPromptPatch("consolidate", "Fold them gently."));
    expect(s.minds.prompts).toEqual({ consolidate: "Fold them gently." });
    s = await settingsAfter(rig, memoryOverridePatch(field("recall", "tokens"), 2000));
    s = await settingsAfter(rig, memoryOverridePatch(field("consolidate", "enabled"), false));
    s = await settingsAfter(rig, memoryOverridePatch(field("consolidate", "periodDays"), 2.5));
    expect(memoryOverride(s.minds.memory, field("recall", "tokens"))).toBe(2000);
    expect(memoryOverride(s.minds.memory, field("consolidate", "enabled"))).toBe(false);
    expect(memoryOverride(s.minds.memory, field("consolidate", "periodDays"))).toBe(2.5);

    // A named preset is a whole cadence policy again; the user's prompts and memory stay theirs.
    s = await settingsAfter(rig, { modelUse: { preset: "full" } });
    expect(s.minds.liveLimit).toBe("none");
    expect(s.minds.enabled).toBe(true);
    expect(s.minds.prompts).toEqual({ consolidate: "Fold them gently." });
    expect(memoryOverride(s.minds.memory, field("recall", "tokens"))).toBe(2000);

    // Reset goes back to the built-in prompt and the world's memory setting.
    s = await settingsAfter(rig, mindsPromptPatch("consolidate", null));
    s = await settingsAfter(rig, memoryOverridePatch(field("recall", "tokens"), null));
    expect(s.minds.prompts).toEqual({});
    expect(memoryOverride(s.minds.memory, field("recall", "tokens"))).toBeUndefined();
    expect(memoryOverride(s.minds.memory, field("consolidate", "enabled"))).toBe(false);
    expect(s.preset).toBe("full");
  });
});

describe("Settings → Steps with the minds steps", () => {
  test("on Lean the unsaved minds cards show what runs, and picking a connection on Character minds leaves minds on when they're turned on", async () => {
    const rig = new Rig();
    type Read = { minds: MindsSettings; modelUse: ModelUseSettings };
    const set = async (patch: JsonObject): Promise<Read> => rig.body(await rig.send({ type: "lre.settings.set", patch })).settings as Read;
    const lean = await set({ modelUse: { preset: "lean" } });
    for (const purpose of ["mind", "memory", "skip", "consolidate"] as const) {
      expect(lean.modelUse.steps[purpose]).toBeUndefined();
      expect(stepConfigOf(lean.modelUse.steps, purpose)).toEqual({ enabled: true, signals: [], maxTokens: HELPER_MAX_TOKENS });
    }
    // The card saves its whole config with the change, as the Connection select does.
    const card = stepConfigOf(lean.modelUse.steps, "mind");
    await set(stepUpdatePatch("mind", { ...card, route: { provider: "helper", connectionId: "conn-2", model: null } }));
    const after = await set(mindsPolicyPatch({ enabled: true }));
    expect(mindsOn(after)).toBe(true);
    expect(mindsStepConfig(after.modelUse, "mind")).toMatchObject({ enabled: true, maxTokens: HELPER_MAX_TOKENS, route: { connectionId: "conn-2" } });
  });
});

describe("Build → World → Minds", () => {
  test("the defaults save as no config; anything else saves whole, an unset selector left out", () => {
    expect(mindsPartValue(structuredClone(DEFAULT_WORLD_MINDS) as WorldMindsConfig)).toEqual({});
    const edited: WorldMindsConfig = { ...structuredClone(DEFAULT_WORLD_MINDS), secrecy: "full", always: { tag: ["lead"] } } as WorldMindsConfig;
    const value = mindsPartValue(edited);
    expect(value.secrecy).toBe("full");
    expect(value.always).toEqual({ tag: ["lead"] });
    expect("never" in value).toBe(false);
  });

  test("secrecy, weights, thresholds, selectors and memory reach the draft and read back; Use the defaults removes them", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const config = structuredClone(DEFAULT_WORLD_MINDS) as WorldMindsConfig;
    config.secrecy = "full";
    config.weights = { ...config.weights, here: 70, roles: { villain: 35 }, band: { ...config.weights.band, supporting: 12 } };
    config.thresholds = { live: 80, near: 40, far: 10 };
    config.always = { tag: ["lead"] };
    config.never = { kind: ["animal"] };
    config.memory = { ...config.memory, notes: { show: 3, keep: 12 }, salience: { halfLifeDays: 2.5, floor: 1 }, consolidate: { enabled: false, periodDays: 3 } };
    const set = rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "set", part: "minds", value: mindsPartValue(config) }));
    expect(worldMindsOf(set.draft as WorldDoc)).toEqual(config);
    const got = rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "get" }));
    expect(worldMindsOf(got.draft as WorldDoc)).toEqual(config);
    const reset = rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "set", part: "minds", value: {} }));
    expect((reset.draft as WorldDoc).minds).toBeUndefined();
  });
});

describe("GM view → Minds controls", () => {
  test("pin, unpin, refresh and delete are edits the engine reads as sent", () => {
    const ops = [pinOp("dev", "live"), pinOp("dev", null), refreshOp("dev"), deleteOp("dev", "plan", "p1"), deleteOp("dev", "note", "n1"), deleteOp("dev", "commitment", "c1")];
    const request = editRequest("c1", ops);
    expect(request).toEqual({ type: "lre.edit", chatId: "c1", ops });
    expect(parseEditOps(JSON.parse(JSON.stringify(ops)))).toEqual(ops);
    expect(ops[0]).toEqual({ op: "mind_pin", entity: "dev", level: "live" });
    expect(ops[3]).toEqual({ op: "mind_memory", entity: "dev", part: "plan", id: "p1", value: null });
  });

  test("a note needs text and a salience of 1 to 5", () => {
    expect(noteOp("dev", null, { text: "  Sam  lied\nabout the keys ", salience: "4" })).toEqual({ op: "mind_memory", entity: "dev", part: "note", id: null, value: { text: "Sam lied about the keys", salience: 4 } });
    expect(noteOp("dev", "n1", { text: "", salience: "3" })).toBeNull();
    expect(noteOp("dev", "n1", { text: "x", salience: "6" })).toBeNull();
    expect(noteOp("dev", "n1", { text: "x".repeat(400), salience: "3" })).toBeNull();
  });

  test("a commitment needs text and someone else it is with", () => {
    const draft = { ...commitmentDraft(), text: "Pay Sam back", with: ["sam", "dev", "sam"], due: 1500 };
    expect(commitmentOp("dev", null, draft)).toEqual({ op: "mind_memory", entity: "dev", part: "commitment", id: null, value: { kind: "promise", with: ["sam"], text: "Pay Sam back", due: 1500, status: "open" } });
    expect(commitmentOp("dev", null, { ...draft, with: ["dev"] })).toBeNull();
    expect(commitmentOp("dev", null, { ...draft, due: Number.NaN })).toBeNull();
    expect(commitmentOp("dev", "c1", { ...draft, due: null, status: "kept" })?.op).toBe("mind_memory");
  });

  test("a plan's start moves with its length kept; its end must come after its start", () => {
    const now = 10_000;
    const fresh = planDraft(now);
    expect([fresh.from, fresh.to]).toEqual([now + 60, now + 120]);
    const moved = startPlanIn({ ...fresh, what: "Visit the market" }, now, 2.5);
    expect([moved.from, moved.to]).toEqual([now + 150, now + 210]);
    const longer = planLasts(moved, 90);
    expect(planOp("dev", null, longer)).toEqual({ op: "mind_memory", entity: "dev", part: "plan", id: null, value: { what: "Visit the market", kind: "errand", when: { from: now + 150, to: now + 240 }, where: null, with: [], priority: 3, status: "open" } });
    expect(planOp("dev", null, planLasts(moved, 0))).toBeNull();
    expect(planOp("dev", null, { ...longer, what: " " })).toBeNull();
    expect(planOp("dev", null, { ...longer, priority: 6 })).toBeNull();
  });

  test("the to-the-narrator badges mark exactly what the Minds section gives the narrator, under each secrecy", () => {
    const reg = createRegistry(ALL_PACKS);
    const text: Record<MindPart, string> = { mood: "wary", monologue: "I should keep my head down today", depiction: "keeps glancing at the door", intent: "Get through the shift", reactions: "changes the subject", interrupt: "needs a word before she leaves" };
    for (const [secrecy, withheld] of [["full", false], ["brief", false], ["brief", true]] as const) {
      const w = modernUsWorld("w", "R");
      w.minds = { secrecy } as WorldDoc["minds"];
      const s0 = fold(reg, w, startState(w), [{ type: "set", entity: "maya", field: "place", value: "apartment" }]);
      const data = { entity: "maya", at: s0.clock, place: "apartment", level: "live", moment: "beat", reason: "live", monologue: `${text.monologue}.`, depiction: text.depiction, intent: `${text.intent}.`, reactions: [`if asked about money, ${text.reactions}`], plans: [], mood: text.mood, interrupt: { reason: text.interrupt }, withheld };
      const s = fold(reg, w, s0, [{ type: "minds.round", data: { at: s0.clock, on: true } }, { type: "minds.mind", data }]);
      const line = mindLines(reg.context(w, s)).map((l) => l.line).join("\n");
      const record = readCharacter(s, "maya").mind;
      if (!record) throw new Error("no mind recorded");
      const sent = narratorGets(secrecy, record);
      for (const part of Object.keys(text) as MindPart[]) expect([secrecy, withheld, part, sent[part]]).toEqual([secrecy, withheld, part, line.includes(text[part])]);
    }
  });
});

describe("Context inspector → Minds", () => {
  const trace = { purpose: "mind", phase: "pre", who: "Dev", level: "live", outcome: "recorded", ms: 1200, tokens: 640, prompt: "default" };

  test("a stored trace keeps only a trace's fields, so no mind's text reaches the player", () => {
    const stored = [{ ...trace, monologue: "I took the keys.", depiction: "Fidgets." }, { ...trace, outcome: "nonsense" }, "junk", { ...trace, who: 3 }];
    expect(mindTracesOf(stored)).toEqual([trace as MindCallTrace]);
    expect(mindTracesOf(undefined)).toBeUndefined();
  });

  test("the panel reads the traces of a generation", () => {
    const view = decodeContextView({ warnings: [], generations: [{ id: "g1", at: 1, activation: "confirmed", sections: [], budget: { sections: 600, used: 0 }, minds: [trace, { ...trace, purpose: "memory", phase: "post", who: "Someone", outcome: "leak_blocked" }] }] });
    expect(view?.generations[0]?.minds?.map((m) => [m.who, m.purpose, m.outcome])).toEqual([
      ["Dev", "mind", "recorded"],
      ["Someone", "memory", "leak_blocked"],
    ]);
  });
});
