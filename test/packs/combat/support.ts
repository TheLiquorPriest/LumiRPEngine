// The combat tests' world: Sam against a goblin and a bandit at home, and the helpers that start a
// fight and plan a turn of it.

import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { planTurn } from "../../../src/engine/turn";
import { Working } from "../../../src/engine/working";
import combatPack from "../../../src/packs/combat/core/index";
import { withoutAmbient } from "../../engine/support";
import { baseWorld, POV, registryOf, startState } from "../support";

export const reg = registryOf([combatPack]);

/** Sam against a goblin and a bandit at home: a d20 strike against armor, 1d6+1 damage, an action and a move each turn. */
export function fightWorld(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  const world = baseWorld();
  const person = world.kinds.person;
  if (!person) throw new Error("no person kind");
  Object.assign(person.fields, {
    max_hp: { type: "number", default: 12 },
    hp: { type: "number", label: "HP", pool: { max: "max_hp" } },
    ac: { type: "number", default: 12 },
    atk: { type: "number", default: 3 },
    dex: { type: "number", default: 0 },
    guarding: { type: "bool", default: false },
  });
  world.entities[POV]!.fields.dex = 2;
  world.entities.goblin = { id: "goblin", kind: "person", name: "Goblin", tier: "background", fields: { place: "home", max_hp: 7, dex: 3 }, relations: [] };
  world.entities.bandit = { id: "bandit", kind: "person", name: "Bandit", tier: "background", fields: { place: "home", max_hp: 9, dex: 1 }, relations: [] };
  world.checks.initiative = { id: "initiative", dice: "d20", modifier: "self.dex" };
  world.actions.strike = {
    id: "strike",
    label: "Strike",
    params: { target: { type: "ref", ref: "person" } },
    requires: ["is_foe(self, target)", "not is_down(target)"],
    check: { id: "strike", dice: "d20", modifier: "self.atk", dc: "target.ac", bands: [{ outcome: "miss", margin: { max: -1 } }, { outcome: "hit", margin: { min: 0 } }] },
    outcomes: { hit: [{ type: "add", args: { entity: "target", field: "hp", delta: "=-roll('1d6+1')" } }], miss: [] },
    duration: "0",
    combat: { cost: { action: 1 }, role: "attack" },
  };
  world.actions.guard = { id: "guard", label: "Guard", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "guarding", value: true } }] }, duration: "0", combat: { cost: { action: 1 }, role: "defend" } };
  world.actions.step = { id: "step", label: "Step", params: {}, requires: [], outcomes: { default: [] }, duration: "0", combat: { cost: { move: 1 } } };
  world.ruleset = { combat: { initiative: "initiative", economy: { action: { label: "Action" }, move: { label: "Move" } }, hp: "hp" } };
  patch(world);
  return world;
}

/** The fight started with `foes` (ids or a selector) on a working copy of the world's start. */
export function started(world: WorldDoc, foes: unknown = ["goblin", "bandit"], seed = "start", registry = reg): Working {
  const w = new Working(registry, world, startState(world, registry));
  const out = applyEffects(registry, w, [{ type: "combat.start", args: { foes: foes as never } }], { bindings: { self: POV }, rng: createRng(seed) });
  if (out.rejected.length > 0) throw new Error(out.rejected[0]?.rejection.reason);
  return w;
}

/** An initiative of 1d2 plus the modifier: a modifier ten apart settles the order, an equal one ties half the time. */
export function initiative(w: WorldDoc, modifier: string): void {
  w.checks.initiative = { id: "initiative", dice: "1d2", modifier };
}

/** It's the POV's turn first, then the goblin's, then the bandit's. */
export function povFirst(w: WorldDoc): void {
  initiative(w, "self.dex * 10");
  w.entities[POV]!.fields.dex = 9;
}

export function plan(world: WorldDoc, state: Readonly<WorldState>, action: string | null, params: Record<string, string> = {}, seed = "turn", registry = reg) {
  return withoutAmbient(() => planTurn({ registry, world, state, runSeed: "run", seed, kind: "normal", userTexts: ["go"], intent: action ? { action, params, probabilities: { [action]: 1 } } : null }));
}
