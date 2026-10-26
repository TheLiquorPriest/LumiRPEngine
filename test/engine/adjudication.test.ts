import { describe, expect, test } from "bun:test";
import { presetAdjudication } from "../../src/shared/adjudication";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { AdjudicationDef, CheckDef, WorldDoc } from "../../src/shared/world";
import { closeCall, lintAdjudication, policyOf, type Judgement } from "../../src/engine/adjudication";
import { fixedCheck } from "../../src/engine/checks";
import { applyMarker } from "../../src/engine/events";
import { actionOdds, resolveAction, resolveOn, type Resolution } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

const reg = registryOf();

/** Climbing: d20 + skill against DC 12, so Sam's skill 2 succeeds on 10+ (55%). */
function climbWorld(adjudication?: Partial<AdjudicationDef>): WorldDoc {
  const world = baseWorld();
  world.checks.climb = { id: "climb", dice: "d20", modifier: "self.skill", dc: "12" };
  world.actions.climb = {
    id: "climb",
    label: "Climb the wall",
    params: {},
    requires: [],
    check: "climb",
    outcomes: { success: [{ type: "set", args: { entity: "self", field: "activity", value: "up" } }], failure: [{ type: "add", args: { entity: "self", field: "stress", delta: 5 } }] },
    duration: "5",
  };
  world.tracks.heist = {
    id: "heist",
    kind: "quest",
    label: "The heist",
    start: "idea",
    visibility: "public",
    stages: { idea: { label: "An idea", next: [{ to: "on", when: "false" }] }, on: { label: "Underway", next: [{ to: "done", when: "false" }] }, done: { label: "Done", next: [] } },
  };
  if (adjudication) world.ruleset = { adjudication: { ...presetAdjudication("crunchy"), preset: "custom", ...adjudication } };
  return world;
}

function withSkill(world: WorldDoc, skill: number): WorldState {
  const state = startState(world);
  state.entities[POV]!.fields.skill = skill;
  return state;
}

const climb = { action: "climb" } as const;
const adjudged = (r: Resolution): LedgerEvent | undefined => r.events.find((e) => e.type === "engine.adjudged");

describe("a world without a policy plays as before", () => {
  test("every check rolls and settles it, nothing extra is recorded, and the roll is the same one", () => {
    const plain = climbWorld();
    const crunchy = climbWorld();
    crunchy.ruleset = { adjudication: presetAdjudication("crunchy") };
    for (let i = 0; i < 20; i++) {
      const a = resolveOn(reg, plain, startState(plain), climb, createRng(`old:${i}`)).resolution;
      const b = resolveOn(reg, crunchy, startState(crunchy), climb, createRng(`old:${i}`)).resolution;
      expect(a.check).not.toBeNull();
      expect(a.adjudged).toBeNull();
      expect(adjudged(a)).toBeUndefined();
      expect(b).toEqual(a);
    }
    const shown = actionOdds(reg, plain, startState(plain), climb).verdict;
    expect([shown?.roll, shown?.why]).toEqual([true, null]);
    expect(shown?.chance ?? 0).toBeCloseTo(0.55, 12);
  });
});

describe("when checks happen", () => {
  test("every, never and risky: risky rolls only below its threshold", () => {
    const every = climbWorld({ checks: "every" });
    expect(resolveOn(reg, every, withSkill(every, 2), climb, createRng("e")).resolution.check).not.toBeNull();
    const never = climbWorld({ checks: "never" });
    const n = resolveOn(reg, never, withSkill(never, 2), climb, createRng("n")).resolution;
    expect([n.check, n.outcome, n.adjudged?.why]).toEqual([null, "success", "never"]);
    const risky = climbWorld({ checks: "risky", riskyAt: 0.5 });
    expect(actionOdds(reg, risky, withSkill(risky, 2), climb).verdict).toMatchObject({ roll: false, why: "safe", outcome: "success" });
    const low = actionOdds(reg, risky, withSkill(risky, 0), climb).verdict;
    expect(low?.roll).toBe(true);
    expect(low?.chance ?? 0).toBeCloseTo(0.45, 12);
  });

  test("marked: a marked action, a marked place or one around the actor, or a marked track in progress", () => {
    const world = climbWorld({ checks: "marked" });
    const state = withSkill(world, 2);
    const verdict = (w: WorldDoc, s: WorldState = state) => actionOdds(reg, w, s, climb).verdict;
    expect(verdict(world)).toMatchObject({ roll: false, why: "unmarked", outcome: "success" });
    const action = structuredClone(world);
    action.actions.climb!.adjudicate = true;
    expect(verdict(action)?.roll).toBe(true);
    // Sam is at home, inside town: marking the town marks home.
    const place = structuredClone(world);
    place.places.town!.adjudicate = true;
    expect(verdict(place)?.roll).toBe(true);
    const track = structuredClone(world);
    track.tracks.heist!.adjudicate = true;
    expect(verdict(track)?.roll).toBe(false);
    const underway = structuredClone(state);
    underway.tracks.heist = { stage: "on", since: 0 };
    expect(verdict(track, underway)?.roll).toBe(true);
    underway.tracks.heist = { stage: "done", since: 0 };
    expect(verdict(track, underway)?.roll).toBe(false);
  });

  test("marked: a track the POV can't see never makes a check roll, so the dice don't give it away", () => {
    const world = climbWorld({ checks: "marked" });
    world.tracks.heist!.adjudicate = true;
    const underway = withSkill(world, 2);
    underway.tracks.heist = { stage: "on", since: 0 };
    const verdict = (w: WorldDoc) => actionOdds(reg, w, underway, climb).verdict;
    expect(verdict(world)?.roll).toBe(true);
    for (const visibility of ["secret", "known_by"] as const) {
      const hidden = structuredClone(world);
      hidden.tracks.heist!.visibility = visibility;
      expect(verdict(hidden)).toMatchObject({ roll: false, why: "unmarked" });
    }
    // Once the POV sees it (a reached cue), it counts again.
    const cued = structuredClone(world);
    cued.tracks.heist!.visibility = "secret";
    cued.tracks.heist!.stages.on!.cue = "Someone has been casing the bank.";
    expect(verdict(cued)?.roll).toBe(true);
  });

  test("the palette's verdict is what the turn does", () => {
    const world = climbWorld({ checks: "risky", riskyAt: 0.6 });
    for (const skill of [-30, 1, 2, 3, 30]) {
      const state = withSkill(world, skill);
      const shown = actionOdds(reg, world, state, climb).verdict;
      const r = resolveOn(reg, world, state, climb, createRng(`p${skill}`)).resolution;
      expect(r.check !== null).toBe(shown?.roll ?? false);
      if (shown && !shown.roll) expect(r.outcome).toBe(shown.outcome ?? "");
    }
  });
});

describe("sure things and impossible tries", () => {
  test("a chance at or above trivialAt passes and one at or below impossibleAt fails, without a roll", () => {
    const world = climbWorld({ trivialAt: 0.95, impossibleAt: 0.05 });
    const easy = resolveOn(reg, world, withSkill(world, 11), climb, createRng("t")).resolution;
    expect([easy.check, easy.outcome, easy.adjudged?.why]).toEqual([null, "success", "trivial"]);
    const hard = resolveOn(reg, world, withSkill(world, -9), climb, createRng("i")).resolution;
    expect([hard.check, hard.outcome, hard.adjudged?.why]).toEqual([null, "failure", "impossible"]);
    expect(hard.events.some((e) => e.type === "add" && e.field === "stress")).toBe(true);
    // 5% (skill −8: only a natural 20) is at the impossible threshold; 10% is not.
    expect(actionOdds(reg, world, withSkill(world, -8), climb).verdict?.why).toBe("impossible");
    expect(actionOdds(reg, world, withSkill(world, -7), climb).verdict?.roll).toBe(true);
  });

  test("a check that names no success always rolls when its action runs; the story still decides it, else its dice", () => {
    // Most rolls miss, so an unrolled pass by the likeliest band would be a failure.
    const blind: CheckDef = { id: "blind", dice: "d20", modifier: "self.skill", bands: [{ outcome: "miss", max: 15 }, { outcome: "hit", min: 16 }] };
    const blindWorld = (adjudication: Partial<AdjudicationDef>): WorldDoc => {
      const world = climbWorld(adjudication);
      world.actions.climb!.check = blind;
      world.actions.climb!.outcomes = { miss: [], hit: [] };
      return world;
    };
    for (const checks of ["never", "marked", "risky"] as const) {
      const world = blindWorld({ checks });
      expect(actionOdds(reg, world, withSkill(world, 2), climb).verdict?.roll).toBe(true);
      expect(resolveOn(reg, world, withSkill(world, 2), climb, createRng("b")).resolution.check).not.toBeNull();
    }
    const story = blindWorld({ checks: "never", authority: "narrative" });
    const told = resolveOn(reg, story, withSkill(story, 2), climb, createRng("s"), { judgement: { rating: 1, reason: "", outcomes: { hit: 1 } } }).resolution;
    expect([told.check, told.outcome, told.adjudged?.why]).toEqual([null, "hit", "story"]);
    const untold = resolveOn(reg, story, withSkill(story, 2), climb, createRng("s"), { judgement: null }).resolution;
    expect([untold.check === null, untold.adjudged?.rolled, untold.adjudged?.why]).toEqual([false, true, null]);
  });

  test("an unrolled check without `success` passes as its `auto` outcome, else its most likely passing band", () => {
    const world = climbWorld({ checks: "never" });
    const odd: CheckDef = { id: "odd", dice: "d20", modifier: "self.skill", bands: [{ outcome: "miss", max: 9 }, { outcome: "hit", min: 10, max: 17 }, { outcome: "crit", min: 18 }], pass: ["hit", "crit"] };
    world.actions.climb!.check = odd;
    world.actions.climb!.outcomes = { miss: [], hit: [], crit: [] };
    expect(resolveOn(reg, world, withSkill(world, 2), climb, createRng("a")).resolution.outcome).toBe("hit");
    world.actions.climb!.check = { ...odd, auto: "crit" };
    expect(resolveOn(reg, world, withSkill(world, 2), climb, createRng("a")).resolution.outcome).toBe("crit");
  });
});

describe("the player's described approach", () => {
  const judgement: Judgement = { rating: 2, reason: "a rope and a plan" };

  test("bonus, advantage and DC: each shifts the roll as it says", () => {
    const state = (w: WorldDoc) => withSkill(w, 2);
    const bonus = climbWorld({ description: { weight: "bonus", max: 3, advantageAt: 2 } });
    const b = resolveOn(reg, bonus, state(bonus), climb, createRng("b"), { judgement }).resolution;
    expect(b.check?.modifier).toBe(4);
    expect(b.check?.odds.success).toBeCloseTo(0.65, 12);
    const advantage = climbWorld({ description: { weight: "advantage", max: 3, advantageAt: 2 } });
    expect(resolveOn(reg, advantage, state(advantage), climb, createRng("a"), { judgement }).resolution.check?.notation).toBe("2d20kh1");
    expect(resolveOn(reg, advantage, state(advantage), climb, createRng("a"), { judgement: { rating: 1, reason: "" } }).resolution.check?.notation).toBe("d20");
    const dc = climbWorld({ description: { weight: "dc", max: 3, advantageAt: 2 } });
    const d = resolveOn(reg, dc, state(dc), climb, createRng("d"), { judgement: { rating: 9, reason: "" } }).resolution;
    expect([d.check?.dc, d.check?.modifier]).toEqual([9, 2]);
  });

  test("a recorded judgement replays to the same turn, and the record keeps the rating", () => {
    const world = climbWorld({ description: { weight: "bonus", max: 3, advantageAt: 2 } });
    const a = resolveOn(reg, world, withSkill(world, 2), climb, createRng("same"), { judgement });
    const b = resolveOn(reg, world, withSkill(world, 2), climb, createRng("same"), { judgement });
    expect(b).toEqual(a);
    expect(adjudged(a.resolution)).toMatchObject({ data: { rolled: true, rating: 2, max: 3, reason: "a rope and a plan" } });
    // The palette never asks for a judgement: it shows the odds as they stand.
    expect(actionOdds(reg, world, withSkill(world, 2), climb).odds?.success).toBeCloseTo(0.55, 12);
  });
});

describe("narrative authority", () => {
  const world = climbWorld({ authority: "narrative" });

  test("the judge's odds pick the outcome, sampled with the turn's seed", () => {
    const failing = resolveOn(reg, world, withSkill(world, 2), climb, createRng("s"), { judgement: { rating: 0, reason: "", outcomes: { failure: 1 } } }).resolution;
    expect([failing.check, failing.outcome, failing.adjudged?.why, failing.adjudged?.rolled]).toEqual([null, "failure", "story", false]);
    const split: Judgement = { rating: 1, reason: "", outcomes: { success: 0.5, failure: 0.5 } };
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const r = resolveOn(reg, world, withSkill(world, 2), climb, createRng(`n${i}`), { judgement: split }).resolution;
      expect(resolveOn(reg, world, withSkill(world, 2), climb, createRng(`n${i}`), { judgement: split }).resolution.outcome).toBe(r.outcome ?? "");
      seen.add(r.outcome ?? "");
    }
    expect([...seen].sort()).toEqual(["failure", "success"]);
    const story = actionOdds(reg, world, withSkill(world, 2), climb).verdict;
    expect([story?.roll, story?.why]).toEqual([false, "story"]);
    expect(story?.chance ?? 0).toBeCloseTo(0.55, 12);
  });

  test("without a judgement (the judge off, out of calls or failed) the dice decide, plainly and as the palette showed", () => {
    // A risky check nothing judged rolls, so it fails as often as the odds say.
    const outcomes = new Set<string>();
    for (const judgement of [null, { rating: 2, reason: "no odds given" }]) {
      for (let i = 0; i < 24; i++) {
        const r = resolveOn(reg, world, withSkill(world, 2), climb, createRng(`f${i}`), { judgement }).resolution;
        expect(r.check?.odds.success).toBeCloseTo(0.55, 12);
        expect([r.adjudged?.rolled, r.adjudged?.why, r.adjudged?.approach]).toEqual([true, null, null]);
        expect(r.events.find((e) => e.type === "engine.adjudged")).toMatchObject({ data: { rolled: true, outcome: r.outcome ?? "" } });
        outcomes.add(r.outcome ?? "");
      }
    }
    expect([...outcomes].sort()).toEqual(["failure", "success"]);
  });

  test("an NPC's check, which no judge reads, rolls", () => {
    const npc = withSkill(world, 2);
    npc.entities.dev = { ...structuredClone(npc.entities[POV]!), name: "Dev" };
    const r = resolveOn(reg, world, npc, { action: "climb", actor: "dev" }, createRng("npc")).resolution;
    expect([r.actor, r.check === null, r.adjudged?.rolled]).toEqual(["dev", false, true]);
  });
});

describe("hybrid authority", () => {
  test("a roll a point or two from another band is a close call; the roll still settles it", () => {
    const ready = fixedCheck({ id: "c", dice: "d20", dc: "12" }, { modifier: 2, dc: 12 });
    expect(closeCall(ready, { natural: 10, total: 12, margin: 0 }, "success", 2)).toEqual({ outcome: "failure", points: -1 });
    expect(closeCall(ready, { natural: 8, total: 10, margin: -2 }, "failure", 2)).toEqual({ outcome: "success", points: 2 });
    expect(closeCall(ready, { natural: 16, total: 18, margin: 6 }, "success", 2)).toBeNull();
    const world = climbWorld({ authority: "hybrid", closeBy: 2 });
    for (let i = 0; i < 40; i++) {
      const r = resolveOn(reg, world, withSkill(world, 2), climb, createRng(`h${i}`)).resolution;
      const margin = r.check?.margin ?? 0;
      expect(r.outcome).toBe(margin >= 0 ? "success" : "failure");
      expect(r.adjudged?.close !== null).toBe(margin >= -2 && margin <= 1);
    }
  });
});

describe("retrying a failed check", () => {
  /** A climb that can't succeed by the dice (but isn't refused as impossible), and the Working it fails on. */
  function failedOnce(retry: AdjudicationDef["retry"]): Working {
    const world = climbWorld({ retry, retryAfter: 60 });
    const w = new Working(reg, world, withSkill(world, -30));
    const first = resolveAction(reg, w, climb, createRng("first"));
    expect([first.check !== null, first.outcome]).toEqual([true, "failure"]);
    return w;
  }
  const again = (w: Working, seed = "again") => resolveAction(reg, w, climb, createRng(seed));

  test("free: every try rolls", () => {
    const w = failedOnce("free");
    expect(again(w).check).not.toBeNull();
  });

  test("changed: the same try takes the earlier failure until time passes, the odds change or the actor moves", () => {
    const w = failedOnce("changed");
    const refused = again(w);
    expect([refused.check, refused.outcome, refused.adjudged?.why]).toEqual([null, "failure", "retry"]);
    expect(actionOdds(reg, w.world, w.state, climb).verdict?.why).toBe("retry");
    // A refused try is no new attempt: the wait still counts from the failed roll.
    w.apply({ type: "clock", minutes: 59, cause: "advance" });
    expect(again(w).check).toBeNull();
    w.apply({ type: "clock", minutes: 1, cause: "advance" });
    expect(again(w).check).not.toBeNull();
    const odds = failedOnce("changed");
    odds.apply({ type: "set", entity: POV, field: "skill", value: -29 });
    expect(again(odds).check).not.toBeNull();
    const moved = failedOnce("changed");
    moved.apply({ type: "set", entity: POV, field: "place", value: "cafe" });
    expect(again(moved).check).not.toBeNull();
  });

  test("once: time doesn't lift it, a new scene does (leaving and coming back counts)", () => {
    const w = failedOnce("once");
    w.apply({ type: "clock", minutes: 600, cause: "advance" });
    expect(again(w).adjudged?.why).toBe("retry");
    w.apply({ type: "set", entity: POV, field: "place", value: "cafe" });
    w.apply({ type: "clock", minutes: 10, cause: "advance" });
    w.apply({ type: "set", entity: POV, field: "place", value: "home" });
    expect(again(w).check).not.toBeNull();
  });
});

describe("where the policy comes from", () => {
  test("the chat's marker wins over the world's ruleset, which wins over plain rolling", () => {
    const world = climbWorld({ checks: "never" });
    const state = startState(world);
    expect(policyOf(climbWorld(), state).checks).toBe("every");
    expect(policyOf(world, state).checks).toBe("never");
    applyMarker(state, { kind: "adjudicate", to: presetAdjudication("balanced") });
    expect(policyOf(world, state)).toEqual(presetAdjudication("balanced"));
    expect(resolveOn(reg, world, state, climb, createRng("m")).resolution.check).not.toBeNull();
  });

  test("a marker body is checked: the values it sets are its own, a named preset's that differ make it Custom, and a custom one is clamped", () => {
    const state = startState(climbWorld());
    applyMarker(state, { kind: "adjudicate", to: { ...presetAdjudication("crunchy"), preset: "narrative" } });
    expect(state.adjudication).toEqual({ ...presetAdjudication("crunchy"), preset: "custom" });
    applyMarker(state, { kind: "adjudicate", to: { ...presetAdjudication("crunchy"), preset: "custom", riskyAt: 7, closeBy: -3 } });
    expect([state.adjudication?.riskyAt, state.adjudication?.closeBy]).toEqual([1, 0]);
  });
});

describe("a chance at a policy's line is exactly that percentage", () => {
  test("19 faces of 20 are a sure thing at 95%, 15 of 20 aren't risky below 75%, and 1 of 20 is hopeless at 5%", () => {
    // d20 + skill against DC 12: skill s succeeds on (9 + s) faces of 20.
    const sure = climbWorld({ trivialAt: 0.95 });
    expect(actionOdds(reg, sure, withSkill(sure, 10), climb).verdict).toMatchObject({ roll: false, why: "trivial", outcome: "success", chance: 0.95 });
    expect(actionOdds(reg, sure, withSkill(sure, 9), climb).verdict).toMatchObject({ roll: true, chance: 0.9 });
    const risky = climbWorld({ checks: "risky", riskyAt: 0.75 });
    expect(actionOdds(reg, risky, withSkill(risky, 6), climb).verdict).toMatchObject({ roll: false, why: "safe", outcome: "success", risky: false });
    expect(actionOdds(reg, risky, withSkill(risky, 5), climb).verdict).toMatchObject({ roll: true, risky: true });
    const hopeless = climbWorld({ impossibleAt: 0.05 });
    expect(actionOdds(reg, hopeless, withSkill(hopeless, -8), climb).verdict).toMatchObject({ roll: false, why: "impossible", outcome: "failure" });
    expect(actionOdds(reg, hopeless, withSkill(hopeless, -7), climb).verdict?.roll).toBe(true);
  });

  test("the odds shown are the same fractions: 19 of 20 reads 0.95 and 1 of 20 reads 0.05", () => {
    const world = climbWorld();
    expect(actionOdds(reg, world, withSkill(world, 10), climb).odds).toEqual({ failure: 0.05, success: 0.95 });
    const resolved = resolveOn(reg, world, withSkill(world, 10), climb, createRng("odds")).resolution;
    expect(resolved.check?.odds).toEqual({ failure: 0.05, success: 0.95 });
  });
});

describe("a world's own check rules", () => {
  /** Balanced as a world may write it: only risky checks, below 85%, and the approach worth up to +3. */
  const balancedButRisky = (): WorldDoc => {
    const world = climbWorld();
    world.ruleset = { adjudication: { ...presetAdjudication("balanced"), checks: "risky", riskyAt: 0.85, description: { weight: "bonus", max: 3, advantageAt: 2 } } };
    return world;
  };

  test("values a world sets over a named preset apply, as Custom with the preset's for the rest", () => {
    const world = balancedButRisky();
    expect(policyOf(world, startState(world))).toEqual({ ...presetAdjudication("balanced"), preset: "custom", checks: "risky", riskyAt: 0.85, description: { weight: "bonus", max: 3, advantageAt: 2 } });
    // Skill 6 succeeds 75%: under the 85% line it rolls. Skill 8 (85%) is at it, so it just succeeds.
    expect(actionOdds(reg, world, withSkill(world, 6), climb).verdict?.roll).toBe(true);
    expect(actionOdds(reg, world, withSkill(world, 8), climb).verdict).toMatchObject({ roll: false, why: "safe" });
    // A named preset whose values are its own still reads as that preset.
    const plain = climbWorld();
    plain.ruleset = { adjudication: { ...presetAdjudication("balanced") } };
    expect(policyOf(plain, startState(plain))).toEqual(presetAdjudication("balanced"));
  });

  test("lint says when a named preset plays as Custom, and names a value no policy can hold", () => {
    const named = lintAdjudication(balancedButRisky());
    expect(named.map((i) => `${i.severity} ${i.code}@${i.path}`)).toEqual(["warning adjudication_preset@ruleset.adjudication.preset"]);
    expect(named[0]?.message).toContain("Balanced");
    expect(named[0]?.message).toContain("Custom");
    const broken = climbWorld();
    broken.ruleset = { adjudication: { ...presetAdjudication("balanced"), closeBy: 99 } };
    (broken.ruleset.adjudication as unknown as Record<string, unknown>).checks = "sometimes";
    expect(policyOf(broken, startState(broken))).toEqual({ ...presetAdjudication("balanced"), preset: "custom", closeBy: 20 });
    expect(lintAdjudication(broken).map((i) => `${i.code}@${i.path}`).sort()).toEqual(["adjudication_preset@ruleset.adjudication.preset", "adjudication_value@ruleset.adjudication.checks", "adjudication_value@ruleset.adjudication.closeBy"].sort());
  });
});

describe("lint", () => {
  test("bad values, thresholds with no room to roll, marked with nothing marked, checks without a success", () => {
    const codes = (w: WorldDoc) => lintAdjudication(w).map((i) => `${i.code}@${i.path}`);
    expect(codes(climbWorld())).toEqual([]);
    const bad = climbWorld({ checks: "marked", trivialAt: 0.1, impossibleAt: 0.2 });
    (bad.ruleset!.adjudication as unknown as Record<string, unknown>).closeBy = 99;
    bad.checks.blind = { id: "blind", dice: "d20", bands: [{ outcome: "miss", max: 10 }, { outcome: "hit", min: 11 }] };
    expect(codes(bad).sort()).toEqual(["adjudication@ruleset.adjudication.trivialAt", "adjudication_success@checks.blind", "adjudication_unmarked@ruleset.adjudication.checks", "adjudication_value@ruleset.adjudication.closeBy"].sort());
    bad.places.town!.adjudicate = true;
    expect(codes(bad)).not.toContain("adjudication_unmarked@ruleset.adjudication.checks");
  });
});
