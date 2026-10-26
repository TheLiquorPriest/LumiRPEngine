// Combat (DESIGN §11): a fight defined by the world's ruleset data: initiative and its ties, the
// action economy, attacks against an HP pool, falling down and the fight ending, everyone else's
// turns, replays and swipes, and what the POV may see of foes it can't see.

import { describe, expect, test } from "bun:test";
import { presetAdjudication, readAdjudication } from "../../../src/shared/adjudication";
import { hashJson } from "../../../src/shared/hash";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { offersAction } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { actionOdds, resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { authorLines, playerLines } from "../../../src/engine/player-events";
import { planTurn } from "../../../src/engine/turn";
import { lintStructure } from "../../../src/engine/world-lint";
import { Working } from "../../../src/engine/working";
import combatPack, { combatEntries, paletteEncounter } from "../../../src/packs/combat/core/index";
import { fightChoices } from "../../../src/packs/combat/core/flow";
import { buildEncounterView } from "../../../src/packs/combat/core/view";
import { encounterOf, PACK } from "../../../src/packs/combat/core/model";
import calendarPack from "../../../src/packs/calendar/core/index";
import sheetsPack from "../../../src/packs/sheets/core/index";
import spacePack from "../../../src/packs/space/core/index";
import { withoutAmbient } from "../../engine/support";
import { baseWorld, fold, POV, registryOf, startState } from "../support";
import { fightWorld, initiative, plan, povFirst, reg, started } from "./support";

function orderOf(state: Readonly<WorldState>): string[] {
  return encounterOf(state)?.order.map((f) => f.id) ?? [];
}

/** The first start (by seed) whose initiative totals tie among `who`, with the order it made. */
function tiedStart(world: WorldDoc, who: readonly string[]): string[] {
  for (let i = 0; i < 64; i++) {
    const enc = encounterOf(started(world, ["goblin", "bandit"], `tie${i}`).state);
    const totals = new Set(enc?.order.filter((f) => who.includes(f.id)).map((f) => f.init));
    if (totals.size === 1) return enc?.order.map((f) => f.id) ?? [];
  }
  throw new Error("no seed tied them");
}

describe("initiative", () => {
  test("everyone rolls the ruleset's check, highest first, with the initiative recorded", () => {
    const world = fightWorld((w) => initiative(w, "self.dex * 10"));
    const enc = encounterOf(started(world).state);
    expect(enc?.order.map((f) => f.id)).toEqual(["goblin", POV, "bandit"]);
    expect(enc?.order.map((f) => Math.floor(f.init / 10))).toEqual([3, 2, 1]);
    expect(enc?.order.map((f) => f.side)).toEqual(["foes", "party", "foes"]);
  });

  test("ties break by the initiative modifier (or the tie-break formula), then the POV, its side and id order", () => {
    expect(tiedStart(fightWorld((w) => initiative(w, "5")), [POV, "goblin", "bandit"])).toEqual([POV, "bandit", "goblin"]);
    expect(tiedStart(fightWorld((w) => {
      initiative(w, "5");
      w.ruleset!.combat!.tieBreak = "self.dex";
    }), [POV, "goblin", "bandit"])).toEqual(["goblin", POV, "bandit"]);
    // 1d2 + dex: the goblin (3) rolling 1 ties Sam (2) rolling 2, and its higher modifier goes first.
    const order = tiedStart(fightWorld((w) => initiative(w, "self.dex")), [POV, "goblin"]);
    expect(order.indexOf("goblin")).toBeLessThan(order.indexOf(POV));
  });

  test("the same seed rolls the same order; foes named by a selector or found hostile", () => {
    const world = fightWorld();
    expect(orderOf(started(world, ["goblin", "bandit"], "s1").state)).toEqual(orderOf(started(world, ["goblin", "bandit"], "s1").state));
    expect(orderOf(started(world, { ids: ["goblin"] }).state).sort()).toEqual(["goblin", POV]);
    const hostile = fightWorld((w) => w.entities.bandit!.relations.push({ type: "hostile", to: POV }));
    expect(orderOf(started(hostile, null).state).sort()).toEqual(["bandit", POV]);
    const w = new Working(reg, world, startState(world));
    expect(applyEffects(reg, w, [{ type: "combat.start", args: {} }], { bindings: { self: POV }, rng: createRng("x") }).rejected[0]?.rejection.code).toBe("no_foes");
  });

  test("an ally joins the POV's side, and the ally of a foe joins the foes", () => {
    const world = fightWorld((w) => {
      w.entities.dev!.fields = { ...w.entities.dev!.fields, place: "home" };
      w.ruleset!.combat!.sides = { ally: "has_rel(self, 'friend', other)" };
      w.entities.dev!.relations.push({ type: "friend", to: POV });
    });
    const enc = encounterOf(started(world, ["goblin"]).state);
    expect(enc?.order.find((f) => f.id === "dev")?.side).toBe("party");
    expect(enc?.order.some((f) => f.id === "bandit")).toBe(false);
  });
});

describe("the action economy", () => {
  test("a combat action spends its cost, and is refused once it's spent", () => {
    const world = fightWorld(povFirst);
    const w = started(world);
    expect(actionOdds(reg, world, w.state, { action: "strike", params: { target: "goblin" } }).available).toBe(true);
    const res = resolveAction(reg, w, { action: "strike", params: { target: "goblin" } }, createRng("a"));
    expect(res.ok).toBe(true);
    expect(res.events[0]).toEqual({ type: "combat.spend", data: { encounter: encounterOf(w.state)?.id ?? "", who: POV, cost: { action: 1 } } });
    expect(encounterOf(w.state)?.order.find((f) => f.id === POV)?.left).toEqual({ action: 0, move: 1 });
    const again = actionOdds(reg, world, w.state, { action: "strike", params: { target: "bandit" } });
    expect(again.available).toBe(false);
    expect(again.failed).toEqual({ code: "spent", reason: "no Action left" });
    const refused = resolveAction(reg, w, { action: "strike", params: { target: "bandit" } }, createRng("b"));
    expect(refused.ok).toBe(false);
    expect(refused.failed?.code).toBe("spent");
    // The move is still there.
    expect(actionOdds(reg, world, w.state, { action: "step" }).available).toBe(true);
  });

  test("outside a fight a combat action is refused, Fight isn't, and a world without combat offers neither", () => {
    const world = fightWorld();
    const state = startState(world);
    expect(actionOdds(reg, world, state, { action: "strike", params: { target: "goblin" } }).failed?.code).toBe("requirement");
    expect(actionOdds(reg, world, state, { action: "step" }).failed).toEqual({ code: "no_fight", reason: "no fight is under way" });
    expect(actionOdds(reg, world, state, { action: "fight", params: { target: "goblin" } }).available).toBe(true);
    expect(combatEntries(reg.context(world, state)).map((e) => e.action)).toEqual(["fight"]);
    const plain = baseWorld();
    expect(offersAction(plain, reg.actions.get("fight") ?? { combat: undefined })).toBe(false);
    expect(combatEntries(reg.context(plain, startState(plain)))).toEqual([]);
    expect(actionOdds(reg, plain, startState(plain), { action: "end_turn" }).failed?.code).toBe("no_combat");
  });

  test("it isn't anyone's to take out of turn, and a turn refills its budgets", () => {
    const world = fightWorld((w) => initiative(w, "self.dex * 10"));
    const w = started(world);
    expect(actionOdds(reg, world, w.state, { action: "strike", params: { target: "goblin" } }).failed?.reason).toBe("it isn't your turn");
    const p = plan(world, w.state, null);
    const enc = encounterOf(fold(reg, world, w.state, p.events));
    expect(enc?.order[enc.turn]?.id).toBe(POV);
    expect(enc?.order.find((f) => f.id === POV)?.left).toEqual({ action: 1, move: 1 });
  });
});

describe("attacks, HP and the end of a fight", () => {
  test("a hit takes 1d6+1 off the pool and a miss nothing; the pool stops at 0", () => {
    const world = fightWorld(povFirst);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const w = started(world);
      const res = resolveAction(reg, w, { action: "strike", params: { target: "bandit" } }, createRng(`hit${i}`));
      const hp = Number(w.state.entities.bandit?.fields.hp ?? 9);
      seen.add(res.outcome ?? "");
      if (res.outcome === "hit") {
        expect(9 - hp).toBeGreaterThanOrEqual(2);
        expect(9 - hp).toBeLessThanOrEqual(7);
      } else expect(hp).toBe(9);
    }
    expect([...seen].sort()).toEqual(["hit", "miss"]);
    const low = fightWorld((w) => {
      povFirst(w);
      w.entities.goblin!.fields.hp = 1;
      w.entities.goblin!.fields.ac = 0;
    });
    const w = started(low);
    resolveAction(reg, w, { action: "strike", params: { target: "goblin" } }, createRng("x"));
    expect(w.state.entities.goblin?.fields.hp).toBe(0);
    applyEffects(reg, w, [{ type: "add", args: { entity: "goblin", field: "hp", delta: 50 } }], { bindings: { self: POV }, rng: createRng("heal") });
    expect(w.state.entities.goblin?.fields.hp).toBe(7);
  });

  test("a foe at 0 HP is down, and when no foe stands the fight is over, won", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.goblin!.fields.hp = 1;
      w.entities.goblin!.fields.ac = 0;
    });
    const w = started(world, ["goblin"]);
    const p = plan(world, w.state, "strike", { target: "goblin" });
    const types = p.events.map((e) => e.type);
    expect(types).toContain("combat.down");
    expect(types.at(-1) === "combat.end" || types.includes("combat.end")).toBe(true);
    const after = fold(reg, world, w.state, p.events);
    expect(encounterOf(after)).toBeNull();
    expect(after.packs[PACK]).toBeUndefined();
    expect(p.events.find((e) => e.type === "combat.end")).toMatchObject({ data: { winner: "party", reason: "over" } });
    expect(p.combat).toEqual(expect.arrayContaining(["Goblin is down.", "The fight is over: your side won."]));
  });

  test("the down condition goes on through the Sheets pack, and a fall that never happened is dropped", () => {
    const registry = registryOf([calendarPack, spacePack, sheetsPack, combatPack]);
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.goblin!.fields.hp = 1;
      w.entities.goblin!.fields.ac = 0;
      w.entities.bandit!.fields.place = "cafe";
      w.ruleset!.combat!.down = { condition: "Unconscious" };
    });
    const w = started(world, ["goblin"], "start", registry);
    const p = plan(world, w.state, "strike", { target: "goblin" }, "turn", registry);
    const conditions = fold(registry, world, w.state, p.events).entities.goblin?.fields.conditions;
    expect(conditions).toEqual([{ id: "unconscious", label: "Unconscious", mod: 0 }]);
    // On a branch where the goblin still has its HP, the recorded fall doesn't validate.
    const down = p.events.find((e) => e.type === "combat.down");
    const healthy = structuredClone(w.state) as WorldState;
    expect(registry.get("combat.down")?.validate(down as never, registry.context(world, healthy))?.code).toBe("not_down");
  });
});

describe("everyone else's turns", () => {
  test("End turn runs the others in initiative order until the POV's turn, the same for the same seed", () => {
    const world = fightWorld(povFirst);
    const w = started(world);
    const a = plan(world, w.state, "end_turn", {}, "seed-1");
    const b = plan(world, w.state, "end_turn", {}, "seed-1");
    expect(a.events).toEqual(b.events);
    expect(a.combat).toEqual(b.combat);
    const acts = a.events.filter((e): e is Extract<LedgerEvent, { data: unknown }> => e.type === "combat.act").map((e) => e.data.actor);
    expect(acts).toEqual(["goblin", "bandit"]);
    const after = fold(reg, world, w.state, a.events);
    const enc = encounterOf(after);
    expect(enc?.order[enc.turn]?.id).toBe(POV);
    expect(enc?.round).toBe(2);
    expect(a.combat.at(-2)).toBe("Round 2, your turn: 1 Action, 1 Move left.");
    // Another seed may roll otherwise, but folds just as well.
    const c = plan(world, w.state, "end_turn", {}, "seed-2");
    expect(() => fold(reg, world, w.state, c.events)).not.toThrow();
  });

  test("the POV's turn ends on its own once nothing it could do fits", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      delete w.actions.step;
    });
    const p = plan(world, started(world).state, "strike", { target: "goblin" });
    const acts = p.events.filter((e) => e.type === "combat.act").map((e) => ("data" in e ? e.data.actor : ""));
    expect(acts).toEqual([POV, "goblin", "bandit"]);
    const manual = fightWorld((w) => {
      povFirst(w);
      delete w.actions.step;
      w.ruleset!.combat!.endTurn = "manual";
    });
    expect(plan(manual, started(manual).state, "strike", { target: "goblin" }).events.filter((e) => e.type === "combat.act")).toHaveLength(1);
  });

  test("tactics: attack the most threatening foe; a hurt fighter a foe is after guards instead", () => {
    const world = fightWorld((w) => {
      initiative(w, "self.dex * 10");
      w.entities.dev!.fields = { ...w.entities.dev!.fields, place: "home" };
      w.ruleset!.combat!.sides = { ally: "has_rel(self, 'friend', other)" };
      w.entities.dev!.relations.push({ type: "friend", to: POV });
      w.entities.dev!.fields.max_hp = 30;
    });
    const w = started(world, ["goblin"]);
    // The goblin goes first and picks Dev, who has the most HP.
    const p = plan(world, w.state, null);
    const first = p.events.find((e) => e.type === "combat.act");
    expect(first).toMatchObject({ data: { actor: "goblin", action: "strike", target: "dev" } });
    const hurt = fightWorld((w2) => {
      initiative(w2, "self.dex * 10");
      w2.entities.goblin!.fields.hp = 1;
    });
    const fresh = started(hurt, ["goblin"]);
    // Hurt but with no foe after it, it fights on; once a foe went for it this round or the last, it guards.
    expect(plan(hurt, fresh.state, null).events.find((e) => e.type === "combat.act")).toMatchObject({ data: { actor: "goblin", action: "strike" } });
    fresh.apply({ type: "combat.act", data: { encounter: encounterOf(fresh.state)?.id ?? "", actor: POV, action: "strike", label: "Strike", target: "goblin", outcome: "miss" } });
    expect(plan(hurt, fresh.state, null).events.find((e) => e.type === "combat.act")).toMatchObject({ data: { actor: "goblin", action: "guard" } });
  });

  test("a recorded npc.choose pick wins while it's legal", () => {
    const world = fightWorld(povFirst);
    const w = started(world, ["goblin"]);
    const choices = fightChoices(reg.context(world, w.state));
    expect(choices.map((c) => c.agent)).toEqual(["goblin"]);
    expect(choices[0]?.options).toEqual(["end_turn@", "guard@", "step@", `strike@${POV}`]);
    expect(choices[0]?.labels[`strike@${POV}`]).toBe("Strike Sam");
    w.apply({ type: "combat.decision", data: { key: choices[0]?.key ?? "", choice: "guard@" } });
    const p = plan(world, w.state, "end_turn");
    expect(p.events.find((e) => e.type === "combat.act")).toMatchObject({ data: { actor: "goblin", action: "guard" } });
    expect(fightChoices(reg.context(world, w.state))).toEqual([]);
  });
});

describe("records and swipes", () => {
  test("an encounter turn's events fold to the plan's state, and a Re-run's fold just as well", () => {
    const world = fightWorld(povFirst);
    const parent = started(world).state;
    const first = plan(world, parent, "strike", { target: "goblin" }, "swipe-a");
    const replay = new Working(reg, world, parent);
    replay.applyAll(first.events);
    expect(replay.dropped).toEqual([]);
    expect(hashJson(fold(reg, world, parent, first.events))).toBe(hashJson(replay.state));
    // A Re-narrate copies the events: the same fold. A Re-run rolls again from the same parent.
    expect(hashJson(fold(reg, world, parent, structuredClone(first.events)))).toBe(hashJson(replay.state));
    const rerun = plan(world, parent, "strike", { target: "goblin" }, "swipe-b");
    expect(() => fold(reg, world, parent, rerun.events)).not.toThrow();
    // A turn of another fight doesn't fold here.
    const elsewhere = plan(world, started(world, ["goblin", "bandit"], "other").state, "strike", { target: "goblin" }, "swipe-a");
    const w = new Working(reg, world, parent);
    w.applyAll(elsewhere.events);
    expect(w.dropped.map((d) => d.rejection.code)).toContain("other_fight");
  });

  test("a world without combat rules plans exactly as before", () => {
    const world = baseWorld();
    const state = startState(world);
    const without = withoutAmbient(() => planTurn({ registry: registryOf(), world, state, runSeed: "run", seed: "s", kind: "normal", userTexts: ["hi"], intent: null }));
    const withPack = withoutAmbient(() => planTurn({ registry: reg, world, state, runSeed: "run", seed: "s", kind: "normal", userTexts: ["hi"], intent: null }));
    expect(withPack.events).toEqual(without.events);
    expect(withPack.combat).toEqual([]);
  });
});

describe("what the POV may see", () => {
  test("a foe it can't see isn't named, shown, targeted or narrated", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.bandit!.visibility = "secret";
    });
    const w = started(world);
    const ctx = reg.context(world, w.state);
    const view = buildEncounterView(ctx);
    const hidden = view?.order.find((r) => r.id === null);
    expect(hidden).toMatchObject({ name: "someone", hp: null, wound: null, init: null });
    expect(JSON.stringify(view)).not.toContain("Bandit");
    expect(combatEntries(ctx).find((e) => e.action === "strike")?.options.map((o) => o.label)).toEqual(["Goblin"]);
    const p = plan(world, w.state, "end_turn");
    expect(p.combat.join("\n")).not.toContain("Bandit");
    expect(p.combat.join("\n")).toContain("Someone: Strike");
    const gm = buildEncounterView(ctx, { gm: true });
    expect(gm?.order.map((r) => r.name)).toContain("Bandit");
  });

  test("others' HP reads as a wound band unless the rules show numbers", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.goblin!.fields.hp = 2;
    });
    const row = (wld: WorldDoc) => buildEncounterView(reg.context(wld, started(wld).state))?.order.find((r) => r.id === "goblin");
    expect(row(world)).toMatchObject({ hp: null, wound: "badly hurt" });
    world.ruleset!.combat!.showHp = "exact";
    expect(row(world)).toMatchObject({ hp: { current: 2, max: 7 }, wound: null });
    expect(buildEncounterView(reg.context(world, started(world).state))?.order.find((r) => r.you)?.hp).toEqual({ current: 12, max: 12 });
    expect(paletteEncounter(reg.context(world, started(world).state))).toEqual({ round: 1, turn: "you", yours: true, economy: [{ id: "action", label: "Action", left: 1, of: 1 }, { id: "move", label: "Move", left: 1, of: 1 }] });
  });

  test("in wounds mode the change chip, the Journal and the narrator's Outcome give others' HP as a band, never a number; the GM's lines keep it", () => {
    const world = fightWorld((w) => {
      povFirst(w);
      w.entities.goblin!.fields.ac = 0;
    });
    const w = started(world, ["goblin"]);
    const p = plan(world, w.state, "strike", { target: "goblin" });
    const after = fold(reg, world, w.state, p.events);
    const hits = p.events.filter((e) => (e.type === "set" || e.type === "add") && e.entity === "goblin" && e.field === "hp");
    expect(hits.length).toBeGreaterThan(0);
    const player = playerLines(reg, world, after, POV, p.events, 40).filter((l) => l.startsWith("Goblin")).join("\n");
    expect(player).toMatch(/Goblin( is now (hurt|badly hurt)| takes damage)/);
    expect(player).not.toMatch(/\d/);
    expect(p.combat.join("\n")).toMatch(/Goblin takes damage \((hurt|badly hurt)\)\./);
    expect(p.combat.join("\n")).not.toContain("Goblin loses");
    expect(authorLines(reg, world, after, hits, 8).join("\n")).toMatch(/Goblin's HP (is now|went down by) \d/);
    // With numbers shown, the player gets them too.
    world.ruleset!.combat!.showHp = "exact";
    expect(playerLines(reg, world, after, POV, hits, 8).join("\n")).toMatch(/Goblin's HP (is now|went down by) \d/);
  });
});

describe("lint", () => {
  test("combat rules and combat actions are checked at their paths", () => {
    const world = fightWorld((w) => {
      w.ruleset!.combat!.initiative = "nope";
      w.ruleset!.combat!.end = "standing('foes') ==";
      w.actions.strike!.combat = { cost: { focus: 1 } };
      w.actions.strike!.check = { id: "strike", dice: "d20", modifier: "stat_mod(self, 'might')", dc: "10" };
    });
    const issues = lintStructure(world, reg);
    const at = (path: string): string[] => issues.filter((i) => i.path === path).map((i) => i.code);
    expect(at("ruleset.combat.initiative")).toContain("refs");
    expect(at("ruleset.combat.end")).toContain("types");
    expect(at("actions.strike.combat.cost.focus")).toContain("refs");
    expect(at("ruleset.minLevels.sheets")).toContain("level_floor");
    expect(lintStructure(fightWorld(), reg).filter((i) => i.severity === "error" && i.path.includes("combat"))).toEqual([]);
  });
});

describe("the adjudication policy", () => {
  /** The strike check names its success, so a policy's timing, retry and authority rules all reach it. */
  function policyWorld(patch: (w: WorldDoc) => void): WorldDoc {
    return fightWorld((w) => {
      povFirst(w);
      const strike = w.actions.strike!;
      if (typeof strike.check === "object" && strike.check) strike.check = { ...strike.check, pass: ["hit"] };
      patch(w);
    });
  }

  test("under Balanced, the same attack after a miss rolls again", () => {
    const world = policyWorld((w) => {
      w.ruleset!.adjudication = presetAdjudication("balanced");
      w.ruleset!.combat!.economy.action = { label: "Action", count: 2 };
    });
    let missed: Working | null = null;
    for (let i = 0; i < 64 && !missed; i++) {
      const w = started(world);
      if (resolveAction(reg, w, { action: "strike", params: { target: "bandit" } }, createRng(`miss${i}`)).outcome === "miss") missed = w;
    }
    if (!missed) throw new Error("no seed missed");
    const outcomes = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const w = new Working(reg, world, missed.state);
      const again = resolveAction(reg, w, { action: "strike", params: { target: "bandit" } }, createRng(`again${i}`));
      expect(again.check).not.toBeNull();
      expect(again.adjudged).toBeNull();
      outcomes.add(again.outcome ?? "");
    }
    expect([...outcomes].sort()).toEqual(["hit", "miss"]);
  });

  test("under Narrative-first, everyone else's attacks roll", () => {
    const world = policyWorld((w) => {
      w.ruleset!.adjudication = presetAdjudication("narrative");
      // The goblin's +3 against 20 hits on a natural 17 or better: unrolled, it would always hit.
      w.entities[POV]!.fields.ac = 20;
    });
    const outcomes: string[] = [];
    for (let i = 0; i < 16; i++) {
      const turn = plan(world, started(world).state, "end_turn", {}, `npc${i}`);
      expect(turn.events.some((e) => e.type === "engine.adjudged")).toBe(false);
      for (const e of turn.events) {
        if (e.type !== "combat.act" || !("data" in e) || e.data === null || typeof e.data !== "object" || Array.isArray(e.data)) continue;
        if (e.data.actor === "goblin") outcomes.push(String(e.data.outcome));
      }
    }
    expect(outcomes.length).toBe(16);
    expect(outcomes).toContain("miss");
    expect(outcomes).toContain("hit");
  });

  test("a world that hands fights to the policy gets its verdicts: never rolling takes the unrolled outcome", () => {
    const never = readAdjudication({ preset: "custom", checks: "never" })!;
    const dice = policyWorld((w) => {
      w.ruleset!.adjudication = never;
    });
    const rolled = resolveAction(reg, started(dice), { action: "strike", params: { target: "bandit" } }, createRng("dice"));
    expect(rolled.check).not.toBeNull();
    expect(rolled.adjudged).toBeNull();
    const policy = policyWorld((w) => {
      w.ruleset!.adjudication = never;
      w.ruleset!.combat!.adjudicate = "policy";
    });
    const w = started(policy);
    expect(actionOdds(reg, policy, w.state, { action: policy.actions.strike!, params: { target: "bandit" } }).verdict?.roll).toBe(false);
    const res = resolveAction(reg, w, { action: "strike", params: { target: "bandit" } }, createRng("policy"));
    expect(res.check).toBeNull();
    expect(res.adjudged?.rolled).toBe(false);
    expect(res.adjudged?.why).toBe("never");
    expect(res.outcome).toBe("hit");
    const odd = policyWorld((w) => {
      // A value the type rules out, as a hand-edited file may hold.
      (w.ruleset!.combat as unknown as Record<string, unknown>).adjudicate = "judge";
    });
    expect(lintStructure(odd, reg).some((i) => i.path === "ruleset.combat.adjudicate")).toBe(true);
  });

  test("handed to the policy, everyone else's attacks still roll, under Narrative-first and Balanced alike", () => {
    // The goblin's +3 against 20 is risky (Narrative-first leaves it to the story); against 5 it is a sure thing (Balanced passes it unrolled).
    for (const [preset, ac] of [["narrative", 20], ["balanced", 5]] as const) {
      const world = policyWorld((w) => {
        w.ruleset!.adjudication = presetAdjudication(preset);
        w.ruleset!.combat!.adjudicate = "policy";
        w.entities[POV]!.fields.ac = ac;
      });
      const state = started(world).state;
      expect(actionOdds(reg, world, state, { action: world.actions.strike!, actor: "goblin", params: { target: POV } }).verdict?.roll).toBe(true);
      // The player's own attack still answers to the policy.
      expect(actionOdds(reg, world, state, { action: world.actions.strike!, params: { target: "goblin" } }).verdict?.why).toBe(preset === "narrative" ? "story" : null);
      let acts = 0;
      for (let i = 0; i < 16; i++) {
        const events = plan(world, state, "end_turn", {}, `npc${i}`).events;
        expect(events.some((e) => e.type === "engine.adjudged" && "data" in e && e.data.actor === "goblin")).toBe(false);
        acts += events.filter((e) => e.type === "combat.act" && "data" in e && e.data.actor === "goblin").length;
      }
      expect(acts).toBe(16);
    }
  });

  test("handed to Balanced, the player's missed attack rolls again next round: a new round is a change", () => {
    const world = policyWorld((w) => {
      w.ruleset!.adjudication = presetAdjudication("balanced");
      w.ruleset!.combat!.adjudicate = "policy";
      // Nothing left to do after the strike, so the turn ends and the others take theirs.
      delete w.actions.step;
    });
    const start = started(world).state;
    const strike = { action: world.actions.strike!, params: { target: "bandit" } };
    let next: WorldState | null = null;
    for (let i = 0; i < 64 && !next; i++) {
      const turn = plan(world, start, "strike", { target: "bandit" }, `miss${i}`);
      const mine = turn.events.find((e) => e.type === "engine.adjudged" && "data" in e && e.data.actor === POV);
      if (!mine || !("data" in mine) || mine.data.failed !== true) continue;
      const after = fold(reg, world, start, turn.events);
      const enc = encounterOf(after);
      if (enc?.round === 2 && enc.order[enc.turn]?.id === POV && actionOdds(reg, world, after, strike).available) next = after;
    }
    if (!next) throw new Error("no seed missed and came round again");
    expect(actionOdds(reg, world, next, strike).verdict?.roll).toBe(true);
    const again = plan(world, next, "strike", { target: "bandit" }, "again");
    const mine = again.events.find((e) => e.type === "engine.adjudged" && "data" in e && e.data.actor === POV);
    expect(mine && "data" in mine ? mine.data.rolled : null).toBe(true);
  });
});
