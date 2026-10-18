// A fight's place in the turn (DESIGN §11): leaving it ends it for the POV, its rounds take no clock
// time and hold everyone in it, no fight stalls, every act is recorded and lands whole, the Combat
// tab reads the policy's verdicts, and fights stay out of worlds without combat.

import { describe, expect, test } from "bun:test";
import { Runtime } from "../../../src/backend/runtime";
import { TIME_ADVANCE_CAP } from "../../../src/backend/turn-model";
import { applyTimeAdvance } from "../../../src/engine/time";
import { presetAdjudication, readAdjudication } from "../../../src/shared/adjudication";
import { hashJson } from "../../../src/shared/hash";
import type { Level } from "../../../src/shared/ids";
import type { JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { applyProfile, PROFILE_IDS, PROFILES } from "../../../src/shared/profiles/index";
import type { WorldDoc } from "../../../src/shared/world";
import { lintWorld } from "../../../src/engine/authoring";
import { applyValidUnits } from "../../../src/engine/events";
import { optionalQuery } from "../../../src/engine/pack-kit";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { placeOfEntity } from "../../../src/engine/scope";
import { advance } from "../../../src/engine/simulate";
import type { WorldState } from "../../../src/engine/state";
import { planTurn, postTurn, timelapseIntent } from "../../../src/engine/turn";
import { typedIntent } from "../../../src/engine/typed-intent";
import { lintStructure } from "../../../src/engine/world-lint";
import { initialState } from "../../../src/engine/world-state";
import { Working } from "../../../src/engine/working";
import { combatEntries, fightOffers, paletteEncounter } from "../../../src/packs/combat/core/index";
import { encounterOf } from "../../../src/packs/combat/core/model";
import { buildEncounterView } from "../../../src/packs/combat/core/view";
import calendarPack from "../../../src/packs/calendar/core/index";
import combatPack from "../../../src/packs/combat/core/index";
import sheetsPack from "../../../src/packs/sheets/core/index";
import spacePack from "../../../src/packs/space/core/index";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { withoutAmbient } from "../../engine/support";
import { fold, POV, registryOf, startState } from "../support";
import { fightWorld, plan, povFirst, reg, started } from "./support";

function dataOf(e: LedgerEvent | undefined): Record<string, unknown> {
  return e && "data" in e ? e.data : {};
}

/** Dev fights beside Sam, so the sides would fight on without the POV; Walk out takes Sam to the cafe in ten minutes. */
function allyWorld(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  return fightWorld((w) => {
    povFirst(w);
    w.entities.dev!.fields = { ...w.entities.dev!.fields, place: "home", max_hp: 40 };
    w.entities.dev!.relations.push({ type: "friend", to: POV });
    w.ruleset!.combat!.sides = { ally: "has_rel(self, 'friend', other)" };
    w.actions.walk_out = { id: "walk_out", label: "Walk out", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "place", value: "cafe" } }] }, duration: "10" };
    patch(w);
  });
}

/** The Modern profile on the modern starter with Danny as the only foe at the POV's home; the rest of his household is out. `seed` starts the fight. */
function starterFight(seed = "start"): { registry: Registry; world: WorldDoc; state: WorldState } {
  const registry = createRegistry(ALL_PACKS);
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no starter");
  const world = applyProfile(make("s", "s"), PROFILES.modern, Object.fromEntries(registry.kinds));
  for (const other of ["maddie_kowalczyk", "helen_kowalczyk", "jess_kowalczyk"]) world.entities[other]!.fields = { ...world.entities[other]!.fields, place: "port_alder" };
  const w = new Working(registry, world, initialState(world, hashJson(world), registry));
  w.applyAll(planTurn({ registry, world, state: w.state, runSeed: "run", seed, kind: "normal", userTexts: ["fight"], intent: { action: "fight", params: { target: "danny_okafor" }, probabilities: { fight: 1 } } }).events);
  if (!encounterOf(w.state)) throw new Error("no fight");
  return { registry, world, state: w.state };
}

describe("leaving a fight", () => {
  test("walking out ends the fight for the POV: no one fights on unseen, and the walk takes its time", () => {
    const world = allyWorld();
    const w = started(world);
    expect(encounterOf(w.state)?.order.find((f) => f.id === "dev")?.side).toBe("party");
    const p = plan(world, w.state, "walk_out");
    expect(dataOf(p.events.find((e) => e.type === "combat.end"))).toMatchObject({ reason: "left", winner: null });
    expect(p.events.filter((e) => e.type === "combat.act" || e.type === "combat.turn" || e.type === "combat.spend")).toEqual([]);
    expect(p.combat.join("\n")).not.toMatch(/Goblin|Bandit|Dev|Strike|won|lost/);
    expect(p.elapsedMinutes).toBe(10);
    const after = fold(reg, world, w.state, p.events);
    expect(encounterOf(after)).toBeNull();
    expect(buildEncounterView(reg.context(world, after))).toBeNull();
  });

  test("a POV moved off between turns sees no card and none of the fight's actions, and the next turn ends the fight before anyone acts", () => {
    const world = allyWorld();
    const w = started(world);
    // As a GM edit or a narrated move would put it.
    w.apply({ type: "set", entity: POV, field: "place", value: "cafe" });
    const ctx = reg.context(world, w.state);
    expect(buildEncounterView(ctx)).toBeNull();
    expect(paletteEncounter(ctx)).toBeNull();
    // Only a new fight is offered: this one is over for the POV.
    expect(combatEntries(ctx).filter((e) => e.action !== "fight")).toEqual([]);
    expect(buildEncounterView(ctx, { gm: true })?.order.map((r) => r.id)).toContain("goblin");
    const p = plan(world, w.state, null);
    expect(p.events.some((e) => e.type === "combat.act")).toBe(false);
    const end = p.events.find((e) => e.type === "combat.end");
    expect(dataOf(end)).toMatchObject({ reason: "left", winner: null });
    // Where the POV stayed, the same fight goes on: the end is read against the state when it folds.
    expect(reg.get("combat.end")?.validate(end as never, reg.context(world, started(world).state))?.code).toBe("not_left");
  });
});

describe("the clock in a fight", () => {
  test("a fight's turns take no clock time, whatever the POV does, and nothing skips ahead in one", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.actions.persuade = { id: "persuade", label: "Persuade", params: {}, requires: [], outcomes: { default: [] }, duration: "10" };
    });
    const calm = startState(world, reg);
    expect(plan(world, calm, null).elapsedMinutes).toBeGreaterThan(0);
    expect(plan(world, calm, "persuade").elapsedMinutes).toBe(10);
    const fight = started(world).state;
    for (const action of [null, "persuade"]) {
      const p = plan(world, fight, action);
      expect(p.elapsedMinutes).toBe(0);
      expect(p.events.some((e) => e.type === "clock")).toBe(false);
    }
    const skip = withoutAmbient(() => planTurn({ registry: reg, world, state: fight, runSeed: "run", seed: "skip", kind: "normal", userTexts: ["wait an hour"], intent: timelapseIntent({ type: "duration", minutes: 60 }) }));
    expect(skip.elapsedMinutes).toBe(0);
    expect(skip.timelapse).toBeNull();
  });

  test("the action that starts a fight keeps its time; the turns inside it take none", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      // Stalk the goblin for twenty minutes, then jump it; the same stalk without a fight, to compare.
      w.actions.ambush = { id: "ambush", label: "Stalk and ambush", params: { target: { type: "ref", ref: "person" } }, requires: [], combat: { cost: {}, start: true }, outcomes: { default: [{ type: "combat.start", args: { foes: "target" } }] }, duration: "20" };
      w.actions.stalk = { id: "stalk", label: "Stalk", params: { target: { type: "ref", ref: "person" } }, requires: [], outcomes: { default: [] }, duration: "20" };
    });
    const calm = startState(world, reg);
    expect(plan(world, calm, "stalk", { target: "goblin" }).elapsedMinutes).toBe(20);
    const ambush = plan(world, calm, "ambush", { target: "goblin" });
    expect(ambush.elapsedMinutes).toBe(20);
    const fight = fold(reg, world, calm, ambush.events);
    expect(encounterOf(fight)).not.toBeNull();
    expect(fight.clock - calm.clock).toBe(20);
    expect(plan(world, fight, "stalk", { target: "goblin" }).elapsedMinutes).toBe(0);
  });

  test("no schedule moves anyone out of a fight under way", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.schedules.shift = { id: "shift", owner: "goblin", target: "place", recurrence: { every: "day" }, slots: [{ start: "08:30", end: "17:00", value: "cafe" }] };
    });
    const goblinAfterAnHour = (state: Readonly<WorldState>): string | null => {
      const w = new Working(reg, world, state);
      advance(reg, w, w.state.clock + 60, { runSeed: "run", mode: "turn" });
      return placeOfEntity(w.state, "goblin");
    };
    expect(goblinAfterAnHour(startState(world, reg))).toBe("cafe");
    expect(goblinAfterAnHour(started(world).state)).toBe("home");
  });

  test("on a starter, talking or using a skill through a fight moves no clock, and no day plan takes the foe away", () => {
    const { registry, world, state: start } = starterFight();
    const place = placeOfEntity(start, world.pov);
    let state = start;
    for (const [turn, intent] of [null, { action: "skill_check", params: { skill: "persuade" }, probabilities: { skill_check: 1 } }, null].entries()) {
      const p = withoutAmbient(() => planTurn({ registry, world, state, runSeed: "run", seed: `talk${turn}`, kind: "normal", userTexts: ["I tell him to calm down"], intent }));
      state = fold(registry, world, state, p.events);
      state = fold(registry, world, state, postTurn({ registry, world, state, runSeed: "run", seed: `talk${turn}`, appliedMinutes: 0, extracted: [] }));
    }
    expect(state.clock).toBe(start.clock);
    expect(encounterOf(state)).not.toBeNull();
    expect(placeOfEntity(state, "danny_okafor")).toBe(place);
    // Hours owed to Danny's day plan, caught up while he fights: he stays; once the fight is over he goes.
    const late = fold(registry, world, state, [{ type: "clock", minutes: 6 * 60, cause: "tick" }]);
    const caught = (s: WorldState) => placeOfEntity(fold(registry, world, s, postTurn({ registry, world, state: s, runSeed: "run", seed: "late", appliedMinutes: 0, extracted: [] })), "danny_okafor");
    expect(caught(late)).toBe(place);
    const over = fold(registry, world, late, [{ type: "combat.end", data: { encounter: encounterOf(late)?.id ?? "", reason: "effect", winner: null, rounds: 1 } }]);
    expect(caught(over)).not.toBe(place);
  });

  test("a time skip the narration tells applies nothing during a fight and offers no Timelapse, so no one moves; after it, it applies", () => {
    const { registry, world, state } = starterFight();
    const places = (s: Readonly<WorldState>) => Object.keys(s.entities).map((id) => placeOfEntity(s, id));
    for (const minutes of [20, 600]) {
      const w = new Working(registry, world, state);
      expect(applyTimeAdvance(registry, w, minutes, { runSeed: "run", capMinutes: TIME_ADVANCE_CAP, unitCap: w.state.time.unitCap })).toEqual({ applied: false, reason: "in_fight", chip: null });
      expect(w.events).toEqual([]);
      expect(places(w.state)).toEqual(places(state));
    }
    const over = fold(registry, world, state, [{ type: "combat.end", data: { encounter: encounterOf(state)?.id ?? "", reason: "effect", winner: null, rounds: 1 } }]);
    const w = new Working(registry, world, over);
    expect(applyTimeAdvance(registry, w, 20, { runSeed: "run", capMinutes: TIME_ADVANCE_CAP, unitCap: w.state.time.unitCap }).applied).toBe(true);
    expect(w.state.clock - over.clock).toBe(20);
  });
});

/** A fight in which no strike lands; `quiet` takes Strike's attack role away, so no one but the POV ever attacks. */
function missWorld(quiet: boolean, patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  return fightWorld((w) => {
    povFirst(w);
    w.kinds.person!.fields.ac = { type: "number", default: 100 };
    if (quiet) delete w.actions.strike!.combat!.role;
    patch(w);
  });
}

/** Up to `turns` turns of the POV taking `action` from the fight's start: every event, and the state after. */
function playOut(world: WorldDoc, action: string, turns: number, params: Record<string, string> = {}): { events: LedgerEvent[]; state: WorldState } {
  let state = started(world).state;
  const events: LedgerEvent[] = [];
  for (let turn = 0; turn < turns && encounterOf(state); turn++) {
    const p = plan(world, state, action, params, `calm${turn}`);
    events.push(...p.events);
    state = fold(reg, world, state, p.events);
  }
  return { events, state };
}

const endsOf = (events: readonly LedgerEvent[]) => events.filter((e) => e.type === "combat.end").map(dataOf);

describe("no fight stalls", () => {
  test("rounds in a row in which no one attacks or is hurt end the fight as a stalemate, re-checked when it folds", () => {
    const world = missWorld(true);
    const { events, state } = playOut(world, "end_turn", 8);
    expect(encounterOf(state)).toBeNull();
    expect(endsOf(events)).toMatchObject([{ reason: "stalemate", winner: null, rounds: 4 }]);
    // Where someone attacked or was hurt since, the fight goes on.
    const end = events.find((e) => e.type === "combat.end") as LedgerEvent;
    const unfolded = fold(reg, world, started(world).state, events.slice(0, events.indexOf(end)));
    const id = encounterOf(unfolded)?.id ?? "";
    expect(reg.get("combat.end")?.validate(end as never, reg.context(world, unfolded))).toBeNull();
    const swung = fold(reg, world, unfolded, [{ type: "combat.act", data: { encounter: id, actor: "goblin", action: "strike", label: "Strike", target: POV, outcome: "miss" } }]);
    expect(reg.get("combat.end")?.validate(end as never, reg.context(world, swung))?.code).toBe("not_stalemate");
    const hurt = fold(reg, world, unfolded, [{ type: "set", entity: "goblin", field: "hp", value: 3 }]);
    expect(reg.get("combat.end")?.validate(end as never, reg.context(world, hurt))?.code).toBe("not_stalemate");
  });

  test("missed attacks aren't calm: a foe who keeps swinging never lets a fight peter out, and the author's own end rule ends it", () => {
    const { events, state } = playOut(missWorld(false), "end_turn", 12);
    expect(encounterOf(state)).not.toBeNull();
    expect(endsOf(events)).toEqual([]);
    expect(events.filter((e) => e.type === "combat.act" && dataOf(e).outcome === "miss").length).toBeGreaterThan(8);
    const ruled = playOut(missWorld(false, (w) => (w.ruleset!.combat!.end = "encounter_round() > 8")), "end_turn", 12);
    expect(endsOf(ruled.events)).toMatchObject([{ reason: "over", rounds: 9 }]);
    // The POV's own attack counts too, with no attack role: it is aimed at a foe.
    const swinging = playOut(missWorld(true, (w) => delete w.actions.step), "strike", 8, { target: "goblin" });
    expect(encounterOf(swinging.state)).not.toBeNull();
    expect(endsOf(swinging.events)).toEqual([]);
  });

  test("turtling on a starter never ends a fight as a stalemate while the foe keeps attacking", () => {
    const reasons: string[] = [];
    for (let fight = 0; fight < 8; fight++) {
      const { registry, world, state: start } = starterFight(`f${fight}`);
      let state = start;
      for (let turn = 0; turn < 30 && encounterOf(state); turn++) {
        const enc = encounterOf(state);
        const mine = enc?.order[enc.turn]?.id === world.pov;
        const p = withoutAmbient(() => planTurn({ registry, world, state, runSeed: "run", seed: `f${fight}t${turn}`, kind: "normal", userTexts: ["I keep my guard up"], intent: mine ? { action: "total_defense", params: {}, probabilities: { total_defense: 1 } } : null }));
        for (const e of p.events) if (e.type === "combat.end") reasons.push(String(dataOf(e).reason));
        state = fold(registry, world, state, p.events);
      }
    }
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons).not.toContain("stalemate");
  });

  test("the ruleset sets how many calm rounds end a fight, and 0 never does", () => {
    const two = playOut(missWorld(true, (w) => (w.ruleset!.combat!.stalemate = 2)), "end_turn", 8);
    expect(endsOf(two.events)).toMatchObject([{ reason: "stalemate", rounds: 3 }]);
    const never = missWorld(true, (w) => (w.ruleset!.combat!.stalemate = 0));
    const off = playOut(never, "end_turn", 8);
    expect(encounterOf(off.state)?.round).toBe(9);
    expect(endsOf(off.events)).toEqual([]);
    const id = encounterOf(off.state)?.id ?? "";
    expect(reg.get("combat.end")?.validate({ type: "combat.end", data: { encounter: id, reason: "stalemate", winner: null, rounds: 9 } } as never, reg.context(never, off.state))?.code).toBe("not_stalemate");
    const issues = (stalemate: number) => lintStructure(missWorld(true, (w) => (w.ruleset!.combat!.stalemate = stalemate)), reg).filter((i) => i.path === "ruleset.combat.stalemate");
    for (const bad of [-1, 1.5]) expect(issues(bad).map((i) => i.severity)).toEqual(["error"]);
    for (const good of [0, 4]) expect(issues(good)).toEqual([]);
  });

  test("two hurt fighters don't guard forever while the POV is down", () => {
    const world = allyWorld((w) => {
      w.entities.dev!.fields.hp = 2;
      w.entities.goblin!.fields.hp = 1;
      w.entities.bandit!.fields.place = "cafe";
    });
    const w = started(world, ["goblin"]);
    w.apply({ type: "set", entity: POV, field: "hp", value: 0 });
    let state = w.state;
    const acts: string[] = [];
    for (let turn = 0; turn < 8 && encounterOf(state); turn++) {
      const p = plan(world, state, null, {}, `hurt${turn}`);
      for (const e of p.events) if (e.type === "combat.act") acts.push(String(dataOf(e).action));
      state = fold(reg, world, state, p.events);
    }
    expect(encounterOf(state)).toBeNull();
    expect(acts).toContain("strike");
  });

  test("a POV who is down sees one round a turn", () => {
    const world = allyWorld((w) => {
      for (const id of ["goblin", "bandit"]) w.entities[id]!.fields.max_hp = 40;
    });
    const w = started(world);
    w.apply({ type: "set", entity: POV, field: "hp", value: 0 });
    let state = w.state;
    const rounds: number[] = [encounterOf(state)?.round ?? 0];
    for (let turn = 0; turn < 3; turn++) {
      state = fold(reg, world, state, plan(world, state, null, {}, `down${turn}`).events);
      rounds.push(encounterOf(state)?.round ?? 0);
    }
    expect(rounds).toEqual([1, 2, 3, 4]);
  });
});

describe("acts", () => {
  test("a stance that only spends is an act: recorded, logged and narrated", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      delete w.actions.guard;
      w.actions.brace = { id: "brace", label: "Brace", params: {}, requires: [], outcomes: { default: [] }, duration: "0", combat: { cost: { action: 1 }, role: "defend" } };
      w.entities.goblin!.fields.hp = 1;
    });
    const w = started(world);
    const mine = plan(world, w.state, "brace");
    expect(dataOf(mine.events.find((e) => e.type === "combat.act"))).toMatchObject({ actor: POV, action: "brace" });
    expect(buildEncounterView(reg.context(world, fold(reg, world, w.state, mine.events)))?.log.some((l) => l.includes("Brace"))).toBe(true);
    // The hurt goblin, gone for this round, braces on its turn: the narrator hears of it too.
    w.apply({ type: "combat.act", data: { encounter: encounterOf(w.state)?.id ?? "", actor: POV, action: "strike", label: "Strike", target: "goblin", outcome: "miss" } });
    const theirs = plan(world, w.state, "end_turn");
    expect(dataOf(theirs.events.find((e) => e.type === "combat.act"))).toMatchObject({ actor: "goblin", action: "brace" });
    expect(theirs.combat.some((l) => l.startsWith("Goblin: Brace"))).toBe(true);
  });

  test("an act lands whole: where the fight is another one, its damage drops with its spend and record", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      // Every strike lands.
      w.actions.strike!.check = { id: "strike", dice: "d20", dc: "-100", bands: [{ outcome: "miss", margin: { max: -1 } }, { outcome: "hit", margin: { min: 0 } }] };
    });
    const parent = started(world, ["goblin", "bandit"], "first").state;
    const p = plan(world, parent, "strike", { target: "goblin" });
    const spend = p.events.findIndex((e) => e.type === "combat.spend");
    const act = p.events.findIndex((e) => e.type === "combat.act");
    const group = p.events[spend]?.group;
    expect(group).toBeDefined();
    expect(p.events.slice(spend, act + 1).every((e) => e.group === group)).toBe(true);
    const onPath = structuredClone(parent) as WorldState;
    expect(applyValidUnits(reg, p.events, onPath, (s) => reg.context(world, s))).toHaveLength(p.events.length);
    expect(onPath.entities.goblin?.fields.hp).toBeLessThan(7);
    // The turn that started the fight, Re-run: another fight, so none of this one's acts land on it.
    const other = started(world, ["goblin", "bandit"], "second").state;
    const view = structuredClone(other) as WorldState;
    applyValidUnits(reg, p.events, view, (s) => reg.context(world, s));
    for (const id of [POV, "goblin", "bandit"]) expect(view.entities[id]?.fields.hp).toEqual(other.entities[id]?.fields.hp);
    expect(encounterOf(view)).toEqual(encounterOf(other));
  });

  test("a typed combat action's Not an action? Undo finds the whole act as recorded, and the turn folds without it", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      // Every strike lands, and no one goes down from one.
      w.actions.strike!.check = { id: "strike", dice: "d20", dc: "-100", bands: [{ outcome: "miss", margin: { max: -1 } }, { outcome: "hit", margin: { min: 0 } }] };
      for (const id of ["goblin", "bandit"]) w.entities[id]!.fields.max_hp = 40;
    });
    const parent = started(world).state;
    const p = plan(world, parent, "strike", { target: "goblin" });
    // The chip stores the resolution's events as JSON, and Undo looks them up in the turn's record.
    const stored = JSON.parse(JSON.stringify(p.resolution?.events ?? [])) as JsonValue[];
    const refs = Runtime.refsOf({ events: p.events, pre: 0 }, stored, 0);
    expect(refs).toHaveLength(stored.length);
    expect(refs.map((r) => p.events[r.index]?.type)).toEqual(["combat.spend", "set", "combat.act"]);
    const undone = new Set(refs.map((r) => r.index));
    const after = fold(reg, world, parent, p.events.filter((_, i) => !undone.has(i)));
    expect(after.entities.goblin?.fields.hp).toEqual(parent.entities.goblin?.fields.hp);
    expect(encounterOf(after)?.log.some((l) => l.actor === POV)).toBe(false);
  });

  test("the start line gives no total for someone the POV can't see", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.bandit!.visibility = "secret";
      w.entities.bandit!.relations.push({ type: "hostile", to: POV });
    });
    const p = plan(world, startState(world, reg), "fight", { target: "goblin" });
    const order = encounterOf(fold(reg, world, startState(world, reg), p.events))?.order ?? [];
    expect(order.map((f) => f.id).sort()).toEqual(["bandit", "goblin", POV]);
    const line = p.combat.find((l) => l.includes(String(order.find((f) => f.id === "goblin")?.init)));
    expect(line).toBeDefined();
    expect(line?.match(/\d+/g)).toHaveLength(2);
  });
});

describe("what the Combat tab offers", () => {
  test("with the policy settling fights, an attack shows its verdict, not dice odds; lint warns where that misleads", () => {
    const policyWorld = (adjudicate: "dice" | "policy") =>
      fightWorld((w) => {
        povFirst(w);
        const strike = w.actions.strike!;
        if (typeof strike.check === "object" && strike.check) strike.check = { ...strike.check, pass: ["hit"] };
        w.ruleset!.adjudication = readAdjudication({ preset: "custom", checks: "never" })!;
        w.ruleset!.combat!.adjudicate = adjudicate;
      });
    const option = (world: WorldDoc) => combatEntries(reg.context(world, started(world).state)).find((e) => e.action === "strike")?.options[0];
    expect(option(policyWorld("dice"))?.odds?.length).toBeGreaterThan(0);
    const settled = option(policyWorld("policy"));
    expect(settled?.odds).toBeUndefined();
    expect(settled?.detail).not.toContain("DC");
    const warnings = (patch: (w: WorldDoc) => void) => lintStructure(fightWorld(patch), reg).filter((i) => i.path === "ruleset.combat.adjudicate" && i.severity === "warning");
    expect(warnings((w) => {
      w.ruleset!.adjudication = presetAdjudication("narrative");
      w.ruleset!.combat!.adjudicate = "policy";
    }).length).toBeGreaterThan(0);
    expect(warnings((w) => {
      w.ruleset!.adjudication = readAdjudication({ preset: "custom", retry: "changed" })!;
      w.ruleset!.combat!.adjudicate = "policy";
    })).toHaveLength(1);
    expect(warnings((w) => {
      w.ruleset!.adjudication = presetAdjudication("crunchy");
      w.ruleset!.combat!.adjudicate = "policy";
    })).toEqual([]);
    expect(warnings((w) => {
      w.ruleset!.adjudication = presetAdjudication("narrative");
    })).toEqual([]);
  });

  test("a start only outside a fight or one the POV has left, every other combat action only in one the POV is in", () => {
    const world = fightWorld(povFirst);
    const combatIds = (state: Readonly<WorldState>) =>
      [...reg.actions.values(), ...Object.values(world.actions)]
        .filter((a) => a.combat && fightOffers(world, state, a))
        .map((a) => a.id)
        .sort();
    expect(combatIds(startState(world, reg))).toEqual(["fight"]);
    const fight = started(world);
    expect(combatIds(fight.state)).toEqual(["end_turn", "guard", "step", "strike"]);
    // Moved off between turns (a narrated move, a GM edit), with the bandit following: the fight is
    // over for the POV before the next turn writes its end, and the tab offers a new one at once.
    fight.apply({ type: "set", entity: POV, field: "place", value: "cafe" });
    fight.apply({ type: "set", entity: "bandit", field: "place", value: "cafe" });
    expect(combatIds(fight.state)).toEqual(["fight"]);
    const offer = combatEntries(reg.context(world, fight.state)).find((e) => e.action === "fight")?.options.find((o) => o.params.target === "bandit");
    expect(offer).toBeDefined();
    expect(offer?.disabled).toBeUndefined();
    const p = plan(world, fight.state, "fight", { target: "bandit" });
    expect(p.resolution?.ok).toBe(true);
    expect(encounterOf(fold(reg, world, fight.state, p.events))?.order.map((f) => f.id).sort()).toEqual(["bandit", POV]);
  });

  test("a budget that isn't one leaves the plan and the tab working", () => {
    const world = fightWorld(povFirst);
    // As a hand-edited file may hold it; lint says so.
    (world.ruleset!.combat!.economy as Record<string, unknown>).bonus = null;
    const w = started(world);
    expect(paletteEncounter(reg.context(world, w.state))?.economy.map((b) => b.id)).toEqual(["action", "move"]);
    expect(() => plan(world, w.state, null)).not.toThrow();
  });
});

describe("rules and sides", () => {
  test("the profiles' initiative check gets no adjudication lint: it never goes through the policy", () => {
    const registry = createRegistry(ALL_PACKS);
    const make = STARTER_WORLDS.fantasy_town;
    if (!make) throw new Error("no starter");
    for (const id of PROFILE_IDS) {
      const world = applyProfile(make("f", "f"), PROFILES[id], Object.fromEntries(registry.kinds));
      expect(lintWorld(world, registry).filter((i) => i.path === "checks.initiative" && i.code.startsWith("adjudication"))).toEqual([]);
    }
  });

  test("Playtest reads fight words as fight actions only where the ruleset has combat", () => {
    const registry = createRegistry(ALL_PACKS);
    const make = STARTER_WORLDS.fantasy_town;
    if (!make) throw new Error("no starter");
    const read = (world: WorldDoc, text: string) => typedIntent(registry, world, initialState(world, hashJson(world), registry), text)?.action ?? null;
    const plain = make("f", "f");
    for (const text of ["I draw my weapon on Wren", "I end my turn", "I pick a fight with Marta"]) expect(read(plain, text)).toBeNull();
    expect(read(applyProfile(make("f", "f"), PROFILES.modern, Object.fromEntries(registry.kinds)), "I pick a fight with Marta")).toBe("fight");
  });

  test("Playtest reads fight words only as the fight's state allows, as interpret does", () => {
    const { registry, world, state } = starterFight();
    const read = (s: Readonly<WorldState>, text: string) => typedIntent(registry, world, s, text)?.action ?? null;
    const calm = initialState(world, hashJson(world), registry);
    expect(read(calm, "I attack Danny")).toBeNull();
    expect(read(calm, "I end my turn")).toBeNull();
    expect(read(calm, "I pick a fight with Danny")).toBe("fight");
    expect(read(state, "I attack Danny")).toBe("attack");
    expect(read(state, "I end my turn")).toBe("end_turn");
    expect(read(state, "I pick a fight with Danny")).toBeNull();
  });

  test("hostile is a relation type both sides hold, and the default sides rule reads it", () => {
    expect(reg.relations.get("hostile")).toMatchObject({ symmetric: true, pack: "combat" });
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.bandit!.relations.push({ type: "hostile", to: POV });
    });
    expect(startState(world, reg).entities[POV]?.relations).toContainEqual({ type: "hostile", to: "bandit" });
    expect(encounterOf(started(world, null).state)?.order.map((f) => f.id).sort()).toEqual(["bandit", POV]);
  });

  test("the card shows who is down from the fight itself, at any Sheets level, and the down condition once", () => {
    const registry = registryOf([calendarPack, spacePack, sheetsPack, combatPack]);
    const downRow = (sheets: Level) => {
      const world = fightWorld((w) => {
        povFirst(w);
        w.entities.goblin!.fields.hp = 1;
        w.entities.goblin!.fields.ac = 0;
        w.realism.levels.sheets = sheets;
      });
      const w = started(world, ["goblin", "bandit"], "start", registry);
      const p = plan(world, w.state, "strike", { target: "goblin" }, "turn", registry);
      expect(p.combat.some((l) => l.startsWith("Goblin is down"))).toBe(true);
      const after = fold(registry, world, w.state, p.events);
      const ctx = registry.context(world, after);
      return { row: buildEncounterView(ctx)?.order.find((r) => r.id === "goblin"), sheet: optionalQuery(ctx, "sheets.conditions")?.(ctx, "goblin") ?? [] };
    };
    // Below Sheets 4 no condition shows anywhere, yet the card says down; from Sheets 4 the sheet has it, and the card says it once.
    expect(downRow(1)).toMatchObject({ row: { down: true, conditions: [] }, sheet: [] });
    expect(downRow(4)).toMatchObject({ row: { down: true, conditions: [] }, sheet: ["down"] });
  });
});
