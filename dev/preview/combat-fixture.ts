// Preview fixture (`?scenario=combat`): a fight at Rosie's Diner, run by the real engine from fixed
// seeds, so the Encounter tab, the palette's Combat tab and the GM view's Fight section show what
// the combat pack builds: a Modern-style ruleset as data, a round already fought, and a foe in the
// dark the player can't see.

import { hashJson } from "../../src/shared/hash";
import type { JsonValue } from "../../src/shared/json";
import type { PaletteEncounter, PaletteEntry } from "../../src/shared/state-view";
import { defaultTiers } from "../../src/shared/tiers";
import type { WorldDoc } from "../../src/shared/world";
import { DEFAULT_CURRENCY, WORLD_FORMAT } from "../../src/shared/world";
import { enginePack } from "../../src/engine/engine-pack";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { planTurn } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { initialState } from "../../src/engine/world-state";
import combatPack, { combatEntries, paletteEncounter } from "../../src/packs/combat/core/index";
import { buildEncounterView } from "../../src/packs/combat/core/view";

const POV = "pov";

function dinerFight(): WorldDoc {
  const person = (id: string, name: string, fields: Record<string, number | string>, visibility?: "secret") => ({ id, kind: "person", name, tier: id === POV ? "principal" : "background", fields: { place: "diner", ...fields }, relations: [], ...(visibility ? { visibility } : {}) });
  return {
    format: WORLD_FORMAT,
    id: "w-maple",
    name: "Maple Street",
    engineVersion: "0.1.0",
    packs: {},
    pins: { generators: {}, tables: {} },
    kinds: {
      person: {
        id: "person",
        label: "Person",
        fields: {
          place: { type: "ref" },
          con: { type: "number", default: 10 },
          dex: { type: "number", default: 0 },
          str: { type: "number", default: 0 },
          bab: { type: "number", default: 0 },
          max_hp: { type: "number", derived: "6 + self.con" },
          hp: { type: "number", label: "HP", pool: { max: "max_hp" } },
          defense: { type: "number", derived: "10 + self.dex + (self.covering ? 2 : 0)" },
          covering: { type: "bool", default: false },
        },
      },
    },
    relations: {},
    entities: {
      [POV]: { ...person(POV, "Sam Rivera", { con: 8, dex: 2, str: 1, bab: 2 }), relations: [{ type: "friend", to: "npc_dev" }] },
      npc_dev: { ...person("npc_dev", "Dev Patel", { con: 6, dex: 1, str: 1, bab: 1 }), relations: [{ type: "friend", to: POV }] },
      trucker: person("trucker", "Drunk trucker", { con: 9, dex: 0, str: 3, bab: 1 }),
      buddy: { ...person("buddy", "Trucker's buddy", { con: 6, dex: 1, str: 1, bab: 1 }), relations: [{ type: "friend", to: "trucker" }] },
      lurker: { ...person("lurker", "The man in the booth", { con: 5, dex: 3, str: 0, bab: 2 }, "secret"), relations: [{ type: "friend", to: "trucker" }] },
    },
    places: { diner: { id: "diner", name: "Rosie's Diner", fields: {} } },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {
      punch: {
        id: "punch",
        label: "Punch",
        params: { target: { type: "ref", ref: "person" } },
        requires: ["is_foe(self, target)", "not is_down(target)"],
        check: { id: "punch", dice: "d20", modifier: "self.bab + self.str", dc: "target.defense", bands: [{ outcome: "critical", natural: { min: 20 } }, { outcome: "miss", margin: { max: -1 } }, { outcome: "hit", margin: { min: 0 } }] },
        outcomes: { critical: [{ type: "add", args: { entity: "target", field: "hp", delta: "=-roll('2d4') - self.str" } }], hit: [{ type: "add", args: { entity: "target", field: "hp", delta: "=-roll('1d4') - self.str" } }], miss: [] },
        duration: "0",
        lexicon: ["punch", "hit", "swing at"],
        combat: { cost: { attack: 1 }, role: "attack" },
      },
      bottle: {
        id: "bottle",
        label: "Swing a bottle",
        params: { target: { type: "ref", ref: "person" } },
        requires: ["is_foe(self, target)", "not is_down(target)"],
        check: { id: "bottle", dice: "d20", modifier: "self.bab + self.str - 2", dc: "target.defense" },
        outcomes: { success: [{ type: "add", args: { entity: "target", field: "hp", delta: "=-roll('1d6') - self.str" } }], failure: [] },
        duration: "0",
        combat: { cost: { attack: 1 }, role: "attack" },
      },
      take_cover: { id: "take_cover", label: "Take cover", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: "self", field: "covering", value: true } }] }, duration: "0", combat: { cost: { move: 1 }, role: "defend" } },
    },
    checks: { initiative: { id: "initiative", dice: "d20", modifier: "self.dex" } },
    calendar: { system: "gregorian", epoch: "2026-10-16T00:00", timeZone: "America/New_York", dayParts: [{ id: "morning", label: "Morning", start: "06:00" }], holidays: [] },
    schedules: {},
    tracks: {},
    tables: {},
    realism: { preset: "story", levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 }, tierCaps: { principal: {}, supporting: {}, background: {} } },
    time: {
      sceneTicks: { conversation: 2, action: 1, exploration: 10, downtime: 30 },
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "ignore", arrival: "stop", overdue: "ignore", needs: "ignore", weather: "ignore" },
      speedThrough: {},
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    sections: {},
    steps: {},
    suppressed: [],
    lore: {},
    loreIndex: { terms: {}, topics: {} },
    classifications: {},
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...DEFAULT_CURRENCY },
    pov: POV,
    tiers: defaultTiers(),
    start: { place: "diner", at: "2026-10-16T07:30" },
    ruleset: {
      combat: {
        initiative: "initiative",
        economy: { attack: { label: "Attack" }, move: { label: "Move" } },
        hp: "hp",
        sides: { ally: "has_rel(self, 'friend', other)" },
        down: { condition: "knocked out" },
      },
    },
  };
}

export interface CombatFixture {
  panel: JsonValue;
  gm: JsonValue;
  entries: PaletteEntry[];
  encounter: PaletteEncounter | null;
}

/** The fight after Sam starts it and trades a round of blows, as the engine folds it. */
export function combatFixture(): CombatFixture {
  const reg = createRegistry([enginePack, combatPack]);
  const world = dinerFight();
  let state: WorldState = initialState(world, hashJson(world), reg);
  const turn = (seed: string, action: string, params: Record<string, string>): void => {
    const plan = planTurn({ registry: reg, world, state, runSeed: "preview", seed, kind: "normal", userTexts: [action], intent: { action, params, probabilities: { [action]: 1 } } });
    const w = new Working(reg, world, state);
    w.applyAll(plan.events);
    state = w.state;
  };
  turn("preview-fight", "fight", { target: "trucker" });
  turn("preview-punch", "punch", { target: "trucker" });
  turn("preview-end", "end_turn", {});
  const ctx = reg.context(world, state);
  // The view models are plain JSON; the casts only restate them as JSON.
  return {
    panel: buildEncounterView(ctx) as unknown as JsonValue,
    gm: buildEncounterView(ctx, { gm: true }) as unknown as JsonValue,
    entries: combatEntries(ctx),
    encounter: paletteEncounter(ctx),
  };
}
