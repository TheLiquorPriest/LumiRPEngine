import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { checkOdds, fixedCheck } from "../../../src/engine/checks";
import { actionOdds, resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { stepTracks } from "../../../src/engine/tracks";
import { findLeaks, unrevealedTruths } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildSheetView, STAT_CHECK } from "../../../src/packs/sheets/core/index";
import { buildQuestLog, leakyLabels } from "../../../src/packs/story/core/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  patch(world);
  return new Working(reg, world, startState(world));
}

function storyWorld(wd: WorldDoc): void {
  wd.tracks.lock = {
    id: "lock",
    kind: "puzzle",
    label: "The cellar lock",
    start: "riddle",
    visibility: "public",
    stages: {
      riddle: { label: "Answer the riddle", next: [{ to: "open", when: "true" }], answer: { expect: ["An echo"], normalize: true, decision: { threshold: 0.7 } }, hints: [] },
      open: { label: "The cellar is open", next: [] },
    },
  };
  wd.tracks.thief = {
    id: "thief",
    kind: "secret",
    label: "Missing tips",
    start: "rumor",
    visibility: "public",
    stages: {
      rumor: { label: "Someone is taking the tip jar", cue: "The tip jar keeps coming up short.", truth: "Jordan Price takes the tips", next: [{ to: "caught", when: "flag('caught')" }] },
      caught: { label: "Caught", truth: "Jordan Price confessed", next: [] },
    },
  };
}

describe("sheets", () => {
  test("stats show as words at level 1, numbers at 2, modifiers and derived values from 3", () => {
    const w = setup();
    w.state.realism.levels.sheets = 1;
    const stat = (label: string) => buildSheetView(w.ctx).sections.find((s) => s.title === "Stats")?.rows.find((r) => r.label === label);
    expect(stat("Wits")).toEqual({ label: "Wits", value: "good" });
    w.state.realism.levels.sheets = 2;
    expect(stat("Wits")?.value).toBe("13");
    expect(stat("Wits")?.fix).toMatchObject({ entity: "you", field: "wits", type: "number", value: 13 });
    w.state.realism.levels.sheets = 3;
    const v = buildSheetView(w.ctx);
    expect(stat("Wits")?.value).toBe("13 (+1)");
    expect(v.sections.find((s) => s.title === "Derived")?.rows.find((r) => r.label === "Health")?.value).toBe("21");
  });

  test("an attempt names a stat by id, label or common name, with a worded or unstated difficulty", () => {
    const w = setup();
    w.state.realism.levels.sheets = 3;
    const odds = (params: Record<string, string | number>) => actionOdds(reg, w.world, w.state, { action: "attempt", params }).modifier;
    expect(odds({ stat: "strength" })).toBe(odds({ stat: "might", difficulty: 10 }));
    expect(odds({ stat: "Wits", difficulty: "hard" })).toBe(odds({ stat: "wits", difficulty: 15 }));
    expect(odds({ stat: "wits", difficulty: "15" })).toBe(odds({ stat: "wits", difficulty: 15 }));
    expect(odds({ stat: "wits" }) - odds({ stat: "wits", difficulty: 15 })).toBe(5);
    expect(resolveAction(reg, w, { action: "attempt", params: { stat: "strength", difficulty: "hard" } }, createRng("a")).rejected).toEqual([]);
  });

  test("a stat check's shown odds are the real odds; conditions at level 4 lower them until they expire", () => {
    const w = setup();
    w.state.realism.levels.sheets = 4;
    const req = { action: "attempt", params: { stat: "wits", difficulty: 12 } };
    const a = actionOdds(reg, w.world, w.state, req);
    expect(a.modifier).toBe(-1);
    expect(a.odds).toEqual(checkOdds(fixedCheck(STAT_CHECK, { modifier: -1 })));
    expect(a.odds?.success).toBeCloseTo(0.5, 10);
    applyEffects(reg, w, [{ type: "sheets.condition", args: { who: "you", condition: "Injured", minutes: 60 } }], { bindings: {}, rng: createRng("c") });
    expect(actionOdds(reg, w.world, w.state, req).modifier).toBe(-3);
    expect(buildSheetView(w.ctx).conditions).toEqual(["Injured"]);
    w.apply({ type: "clock", minutes: 61, cause: "advance" });
    expect(actionOdds(reg, w.world, w.state, req).modifier).toBe(-1);
    const r = resolveAction(reg, w, req, createRng("roll"));
    expect(r.ok).toBe(true);
    expect(["failure", "success"]).toContain(r.check?.outcome ?? "");
  });

  test("the condition channel only accepts known people", () => {
    const w = setup();
    const ch = reg.proposals.get("condition");
    expect(ch?.validate({ who: "nobody", condition: "tired" }, w.ctx)?.code).toBe("missing_entity");
    expect(ch?.validate({ who: "maya", condition: "tired" }, w.ctx)).toBeNull();
  });
});

describe("story", () => {
  test("flags are set by effects and read by formulas and rules", () => {
    const w = setup(storyWorld);
    applyEffects(reg, w, [{ type: "story.flag", args: { name: "caught" } }], { bindings: {}, rng: createRng("f") });
    expect(w.ctx.query("story.flag")(w.ctx, "caught")).toBe(true);
    stepTracks(reg, w, "s");
    expect(w.state.tracks.thief?.stage).toBe("caught");
  });

  test("puzzle answers: exact and normalized match; the opt-in decision threshold asks first, then counts", () => {
    const w = setup(storyWorld);
    const answer = (text: string, decision?: number) => applyEffects(reg, w, [{ type: "story.answer", args: { track: "lock", answer: text, ...(decision !== undefined ? { decision } : {}) } }], { bindings: {}, rng: createRng("a") });
    expect(answer("a sound that comes back").rejected[0]?.rejection.code).toBe("needs_decision");
    expect(answer("a sound that comes back", 0.5).rejected).toEqual([]);
    expect(w.state.tracks.lock?.stage).toBe("riddle");
    expect(answer("an ECHO").rejected).toEqual([]);
    stepTracks(reg, w, "s");
    expect(w.state.tracks.lock?.stage).toBe("open");
    const typed = resolveAction(reg, setup(storyWorld), { action: "answer", params: { puzzle: "lock", answer: "a sound that comes back" } }, createRng("x"));
    expect(typed.rejected[0]?.rejection.code).toBe("needs_decision");
    const zero = resolveAction(reg, setup(storyWorld), { action: "answer", params: { puzzle: "lock", answer: "a sound that comes back", decision: 0 } }, createRng("x"));
    expect(zero.rejected).toEqual([]);
    const retried = setup(storyWorld);
    const judged = resolveAction(reg, retried, { action: "answer", params: { puzzle: "lock", answer: "a sound that comes back", decision: 0.9 } }, createRng("x"));
    expect(judged.rejected).toEqual([]);
    stepTracks(reg, retried, "s");
    expect(retried.state.tracks.lock?.stage).toBe("open");
  });

  test("a typed answer finds its puzzle by words from the label, or as the only open one", () => {
    const byWords = setup(storyWorld);
    expect(resolveAction(reg, byWords, { action: "answer", params: { puzzle: "the cellar", answer: "an echo" } }, createRng("x")).rejected).toEqual([]);
    stepTracks(reg, byWords, "s");
    expect(byWords.state.tracks.lock?.stage).toBe("open");
    const only = setup(storyWorld);
    expect(resolveAction(reg, only, { action: "answer", params: { answer: "an echo" } }, createRng("x")).rejected).toEqual([]);
    stepTracks(reg, only, "s");
    expect(only.state.tracks.lock?.stage).toBe("open");
    expect(resolveAction(reg, only, { action: "answer", params: { answer: "an echo" } }, createRng("x")).rejected[0]?.rejection.code).toBe("not_a_puzzle");
  });

  test("the quest log holds no secret truth before its reveal, and the lint catches leaky labels", () => {
    const w = setup(storyWorld);
    const log = buildQuestLog(w.ctx);
    expect(log.active.map((t) => t.id)).toEqual(["first_week", "lock", "thief"]);
    expect(findLeaks(log as never, unrevealedTruths(w.world, w.state))).toEqual([]);
    const leaky = modernUsWorld("w", "R");
    storyWorld(leaky);
    leaky.places.park!.name = "Park where Jordan Price takes the tips";
    expect(leakyLabels(leaky).map((l) => l.path)).toEqual(["places.park.name"]);
  });
});
