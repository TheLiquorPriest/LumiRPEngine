// A few worked sums of the tabletop rules layer on a small ruleset of its own: a defence with its stacking and its touch and
// flat-footed variants, an attack that crits on dice that all come up high, and a creature harmed below 0 and then to its floor.

import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import type { D20Def } from "../../src/shared/d20";
import type { Rng } from "../../src/engine/rng";
import { initialState } from "../../src/engine/world-state";
import type { WorldState } from "../../src/engine/state";
import { explain } from "../../src/packs/d20/core/modifiers";
import { registry, world } from "../iface/rig";

const table = (id: string, rows: Record<string, JsonObject>) => ({ id, pack: "d20", schema: `lre-table/${id}/v1`, revision: id, label: id, columns: {}, rows });

const RULES: D20Def = {
  abilities: ["str", "dex", "con"],
  mod: "floor((x - 10) / 2)",
  kinds: ["character"],
  defaultSize: "medium",
  bonuses: { stack: ["dodge", "circumstance"], penaltiesStack: true },
  tables: { armor: "t.armor", weapons: "t.weapons", traits: "t.traits", conditions: "t.conditions", classes: "t.classes", tracks: "t.tracks" },
  totals: {
    ac: "10 + bonus(self, 'ac') + min(mod(self, 'dex'), limit(self, 'max_dex', 99))",
    "ac.touch": "10 + bonus_without(self, 'ac', 'armor,shield') + min(mod(self, 'dex'), limit(self, 'max_dex', 99))",
    "ac.flat": "10 + bonus_without(self, 'ac', 'dodge') + min(0, mod(self, 'dex'))",
    "attack.base": "class_sum(self, 'attack')",
    "attack.melee": "class_sum(self, 'attack') + mod(self, 'str') + bonus(self, 'attack.melee,attack.weapon.' + weapon)",
    "attack.ranged": "class_sum(self, 'attack') + mod(self, 'dex') + bonus(self, 'attack.ranged')",
    damage: "bonus(self, 'damage')",
    "save.fort": "class_sum(self, 'fort') + mod(self, 'con') + bonus(self, 'save.fort')",
    "hp.max": "hit_dice(self) + levels(self) * mod(self, 'con')",
  },
  check: { take: { "10": { value: 10, times: 1 } }, aid: { dc: 10, bonus: 2 } },
  save: { autoFail: 1, autoSucceed: 20 },
  attack: {
    autoMiss: 1,
    autoHit: 20,
    confirm: true,
    strength: "str",
    strengthShare: { light: 1, one: 1, two: 1.5, off: 0.5, projectile: 0 },
    incrementPenalty: -2,
    increments: { thrown: 5, projectile: 10 },
    unskilled: -4,
    nonlethal: -4,
    secondary: -5,
    iterative: { from: 6, step: 5 },
    totals: { base: "attack.base", melee: "attack.melee", ranged: "attack.ranged", damage: "damage" },
    shots: {},
  },
  hp: {
    field: "hp",
    nonlethal: "nonlethal",
    temporary: "hp_temp",
    states: [
      { id: "dead", when: "self.hp <= -10", life: "dead" },
      { id: "dying", when: "self.hp < 0 and self.hp > -10" },
      { id: "disabled", when: "self.hp == 0" },
    ],
    dying: null,
    massive: null,
    rest: { hours: 8, hp: "levels(self)", nonlethal: "levels(self)", daily: [] },
  },
  levels: { progression: "level", hitPoints: "average", average: "floor(die / 2) + 1", firstMost: true, rankLimit: "levels(self) + 3", skillPoints: { plus: "0", min: 1, first: 4 }, featEvery: 3, abilityEvery: 4, experienceBy: "table" },
};

/** The invented world with the small ruleset on: Wren a fighter in a chain shirt with a heavy shield and Dodge, a longsword in hand; Bram a foe. */
function d20World(): WorldDoc {
  const w = world();
  w.realism.levels.d20 = 1;
  w.ruleset = { ...w.ruleset, d20: RULES };
  const kind = w.kinds.character;
  if (kind === undefined) throw new Error("no character kind");
  Object.assign(kind.fields, {
    str: { type: "number", default: 10 },
    dex: { type: "number", default: 10 },
    con: { type: "number", default: 10 },
    hp_max: { type: "number", derived: "total(self, 'hp.max')" },
    hp: { type: "number", pool: { max: "hp_max", min: "-10" } },
    nonlethal: { type: "number", default: 0 },
    hp_temp: { type: "number", default: 0 },
  });
  w.tables["t.armor"] = table("t.armor", { chain_shirt: { label: "Chain shirt", bonus: 4, type: "armor", max_dex: 4, check: -2 }, heavy_shield: { label: "Heavy shield", bonus: 2, type: "shield", check: -2 } });
  w.tables["t.weapons"] = table("t.weapons", { longsword: { label: "Longsword", damage: { medium: "1d8" }, threat: 19, multiplier: 2, proficiency: "martial", held: "one", types: ["slashing"] } });
  w.tables["t.traits"] = table("t.traits", { dodge: { label: "Dodge", kind: "feat", modifiers: [{ to: "ac", value: 1, type: "dodge" }] }, weapon_focus: { label: "Weapon Focus", kind: "feat", modifiers: [{ to: "attack.weapon.{choice}", value: 1 }] } });
  w.tables["t.conditions"] = table("t.conditions", { shaken: { label: "Shaken", modifiers: [{ to: "attack", value: -2 }, { to: "save", value: -2 }, { to: "ability_check", value: -2 }] }, dying: { label: "Dying" }, dead: { label: "Dead" }, disabled: { label: "Disabled" } });
  w.tables["t.classes"] = table("t.classes", { fighter: { label: "Fighter", hit_die: 10, tracks: { attack: "good", fort: "save_good" }, skill_points: 2, proficiency: ["simple", "martial"] }, rogue: { label: "Rogue", hit_die: 6, tracks: { attack: "average", fort: "save_poor" }, skill_points: 8, proficiency: ["simple"] } });
  w.tables["t.tracks"] = table("t.tracks", { "1": { good: 1, average: 0, save_good: 2, save_poor: 0 }, "2": { good: 2, average: 1, save_good: 3, save_poor: 0 }, "3": { good: 3, average: 2, save_good: 3, save_poor: 1 } });
  const wren = w.entities.wren;
  const bram = w.entities.bram;
  if (wren === undefined || bram === undefined) throw new Error("no wren or bram");
  wren.fields = { ...wren.fields, str: 14, dex: 14, con: 10, classes: { fighter: 2, rogue: 1 }, hit_dice: 20, d20_traits: ["dodge", { id: "weapon_focus", choice: "longsword" }] };
  bram.fields = { ...bram.fields, dex: 12, classes: { fighter: 1 }, hit_dice: 10 };
  const item = (id: string, name: string, catalog: string, rel: string): WorldDoc["entities"][string] => ({ id, kind: "item", name, tier: "background", fields: { catalog }, relations: [{ type: "in", to: "wren" }, { type: rel, to: "wren" }] });
  w.entities.shirt = item("shirt", "Chain shirt", "chain_shirt", "worn_by");
  w.entities.shield = item("shield", "Heavy shield", "heavy_shield", "worn_by");
  w.entities.sword = item("sword", "Longsword", "longsword", "equipped");
  return w;
}

/** A die that always comes up at its most: every d20 a 20, every d8 an 8. The procedures draw only `int` and `fork`. */
function high(): Rng {
  const draws = { seed: "high", next: () => 0.999, int: (_min: number, max: number) => max, fork: () => r };
  // Only what the procedures draw is given: a test stand-in for the seeded generator.
  const r = draws as unknown as Rng;
  return r;
}

function run(doc: WorldDoc, state: WorldState, type: string, who: string, params: Record<string, JsonValue>): LedgerEvent[] {
  const reg = registry();
  const def = reg.effects.get(type);
  if (!def) throw new Error(`no effect ${type}`);
  const out = def.resolve({ who }, { ...reg.context(doc, state), rng: high(), params: params as never });
  if (!Array.isArray(out)) throw new Error(`${out.code}: ${out.reason}`);
  return out;
}

describe("the d20 layer's sums", () => {
  test("a defence of 10 + 4 armour + 2 shield + 1 dodge + 2 Dexterity is 19; touch 13; flat-footed 16; a second armour bonus does not stack", () => {
    const doc = d20World();
    const reg = registry();
    const ctx = reg.context(doc, initialState(doc, "t", reg));
    expect(explain(ctx, RULES, "wren", "ac")?.total).toBe(19);
    expect(explain(ctx, RULES, "wren", "ac.touch")?.total).toBe(13);
    expect(explain(ctx, RULES, "wren", "ac.flat")?.total).toBe(16);
    // A +2 armour bonus besides the shirt's +4: the better one counts.
    doc.entities.wren!.fields.d20_effects = [{ label: "Bracers", modifiers: [{ to: "ac", value: 2, type: "armor" }] }];
    const again = reg.context(doc, initialState(doc, "t", reg));
    const e = explain(again, RULES, "wren", "ac");
    expect(e?.total).toBe(19);
    expect(e?.parts.some((p) => (p.mods ?? []).some((m) => m.from === "Bracers" && !m.counted))).toBe(true);
    // Multiclassing: fighter 2 (good) and rogue 1 (average) give a base attack of 2 + 0.
    expect(explain(ctx, RULES, "wren", "attack.base")?.total).toBe(2);
  });

  test("an attack with every die at its most: a threat confirmed, the d8 twice and Strength's +2 twice, 20 harm", () => {
    const doc = d20World();
    const reg = registry();
    const state = initialState(doc, "t", reg);
    const events = run(doc, state, "d20.attack", "wren", { target: "bram" });
    const hp = events.find((e) => e.type === "set" && "entity" in e && e.entity === "bram" && e.field === "hp");
    // Bram: 10 hit points from his die, Constitution 10 adds none; 20 harm leaves him at -10, his floor.
    expect(hp && "value" in hp ? hp.value : null).toBe(-10);
    const record = events.find((e) => e.type === "d20.attack");
    expect(JSON.stringify(record)).toContain("a critical");
  });

  test("harm below 0 makes a creature dying; to its floor, dead", () => {
    const doc = d20World();
    const reg = registry();
    const state = initialState(doc, "t", reg);
    const events = run(doc, state, "d20.harm", "bram", { amount: 12 });
    const conditions = events.find((e) => e.type === "set" && "entity" in e && e.entity === "bram" && e.field === "conditions");
    expect(JSON.stringify(conditions)).toContain("dying");
    const more = run(doc, state, "d20.harm", "bram", { amount: 30 });
    expect(more.some((e) => e.type === "engine.life")).toBe(true);
  });

  test("a Strength check while shaken: 20 on the die, +2 Strength, -2 shaken, 20", () => {
    const doc = d20World();
    doc.entities.wren!.fields.conditions = [{ id: "shaken" }];
    const reg = registry();
    const events = run(doc, initialState(doc, "t", reg), "d20.check", "wren", { skill: "str" });
    const record = events.find((e) => e.type === "d20.check");
    expect(JSON.stringify(record)).toContain('"total":20');
  });
});
