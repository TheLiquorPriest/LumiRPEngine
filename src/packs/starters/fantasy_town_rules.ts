// Brindlemere under the Classic rule set, switched on for a chat made from it (RULESET-DESIGN §7); Classic Revised can be put on in
// its place from the World page or Build. The town's people are common folk of the plain classes: experts in their trades, a ferry
// hand of the commoners, the reeve, the smith and the chapel's keeper a few levels up for their years at it. The traveller is a
// first-level fighter. Hit points are each class's die at the first level and about half of it after, with Constitution on each.
// Ranks spend what each class and Intelligence give, and none passes its level plus three. Only weapons from the starter's
// own catalog are carried: the belt knife.

import type { EntityDef } from "../../shared/world";
import { CLASSIC } from "../../shared/profiles/classic";
import type { StarterRules } from "./rules";

/** A working knife worn at a townsperson's waist: the starter's catalog belt knife. */
function knife(owner: string): EntityDef {
  return {
    id: `${owner}_knife`,
    kind: "item",
    name: "Belt knife",
    tier: "background",
    fields: { description: "A plain working knife in a worn leather sheath.", owner, weight_g: 180, slot: "waist", catalog: "belt_knife" },
    relations: [
      { type: "in", to: owner },
      { type: "worn_by", to: owner, fields: { slot: "waist" } },
    ],
  };
}

const MEDIUM = { size: "medium", base_speed: 30 };

export const FANTASY_TOWN_RULES: StarterRules = {
  set: CLASSIC,
  on: true,
  sheets: {
    pov: {
      str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 12, ...MEDIUM,
      classes: { fighter: 1 }, hit_dice: 10, hp: 11, xp: 0,
      d20_traits: ["human", "alertness", "endurance", "improved_initiative"],
      ranks: { ride: 4, handle_animal: 4, climb: 2, swim: 2 },
    },
    hollis_garrow: {
      str: 8, dex: 9, con: 10, int: 14, wis: 12, cha: 11, ...MEDIUM,
      classes: { expert: 3 }, hit_dice: 13, hp: 13, xp: 3000, level: 3,
      d20_traits: ["human", "negotiator", "diligent", "investigator"],
      ranks: { appraise: 6, diplomacy: 6, sense_motive: 6, gather_information: 6, knowledge_local: 6, decipher_script: 6, profession: 6, bluff: 4, intimidate: 4, listen: 2, spot: 2 },
    },
    tamsin_reed: {
      str: 15, dex: 11, con: 14, int: 10, wis: 11, cha: 10, ...MEDIUM,
      classes: { expert: 2 }, hit_dice: 10, hp: 14, xp: 1000, level: 2,
      d20_traits: ["human", "athletic", "endurance"],
      ranks: { profession: 5, swim: 5, use_rope: 5, climb: 4, spot: 4, handle_animal: 4, intimidate: 3, listen: 3, knowledge_geography: 2 },
    },
    joss_tamber: {
      str: 13, dex: 8, con: 13, int: 10, wis: 11, cha: 11, ...MEDIUM,
      classes: { expert: 2 }, hit_dice: 10, hp: 15, xp: 1000, level: 2,
      d20_traits: ["human", { id: "skill_focus", choice: "profession" }, "toughness"],
      ranks: { profession: 5, craft: 5, appraise: 5, climb: 4, use_rope: 4, diplomacy: 4, sense_motive: 3, knowledge_local: 3, listen: 2 },
    },
    marta_dunmore: {
      str: 15, dex: 10, con: 14, int: 11, wis: 11, cha: 10, ...MEDIUM,
      classes: { expert: 3 }, hit_dice: 13, hp: 19, xp: 3000, level: 3,
      d20_traits: ["human", { id: "skill_focus", choice: "craft" }, "endurance", "great_fortitude"],
      ranks: { craft: 6, appraise: 6, profession: 6, intimidate: 4, diplomacy: 4, sense_motive: 4, spot: 4, knowledge_local: 4, handle_animal: 4 },
    },
    ilsabet_vane: {
      str: 7, dex: 10, con: 9, int: 13, wis: 16, cha: 13, ...MEDIUM,
      classes: { expert: 3 }, hit_dice: 13, hp: 10, xp: 3000, level: 3,
      d20_traits: ["human", "alertness", "iron_will", "self_sufficient"],
      ranks: { knowledge_religion: 6, knowledge_history: 6, heal: 6, sense_motive: 6, diplomacy: 6, spot: 6, listen: 6, decipher_script: 6 },
    },
    wren_aldous: {
      str: 8, dex: 12, con: 10, int: 13, wis: 14, cha: 12, ...MEDIUM,
      classes: { expert: 2 }, hit_dice: 10, hp: 10, xp: 1000, level: 2,
      d20_traits: ["human", "self_sufficient", { id: "skill_focus", choice: "heal" }],
      ranks: { heal: 5, profession: 5, knowledge_nature: 5, survival: 5, craft: 5, diplomacy: 4, gather_information: 4, sense_motive: 4, spot: 3 },
    },
    odo_kettleby: {
      str: 10, dex: 8, con: 12, int: 10, wis: 10, cha: 12, ...MEDIUM,
      classes: { expert: 2 }, hit_dice: 10, hp: 12, xp: 1000, level: 2,
      d20_traits: ["human", "negotiator", "investigator"],
      ranks: { profession: 5, gather_information: 5, diplomacy: 5, sense_motive: 5, appraise: 5, bluff: 4, listen: 3, spot: 3 },
    },
    pip_marlow: {
      str: 10, dex: 13, con: 11, int: 10, wis: 10, cha: 9, ...MEDIUM,
      classes: { commoner: 1 }, hit_dice: 4, hp: 4, xp: 0,
      d20_traits: ["human", "athletic", "run", { id: "one_simple_weapon", choice: "belt_knife" }],
      ranks: { swim: 4, use_rope: 4, profession: 4 },
    },
    bram_hesketh: {
      str: 11, dex: 10, con: 12, int: 10, wis: 12, cha: 10, ...MEDIUM,
      classes: { expert: 1 }, hit_dice: 6, hp: 7, xp: 0,
      d20_traits: ["human", "alertness", "self_sufficient"],
      ranks: { profession: 4, handle_animal: 4, listen: 4, spot: 4, survival: 4, knowledge_geography: 4, heal: 4 },
    },
  },
  things: ["tamsin_reed", "joss_tamber", "marta_dunmore", "wren_aldous", "odo_kettleby", "pip_marlow", "bram_hesketh"].map(knife),
};
