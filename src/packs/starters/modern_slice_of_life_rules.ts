// Port Alder under the Modern rule set, switched on for a chat made from it (RULESET-DESIGN §7). The town's people are ordinary folk
// of the plain classes, first or second level, with the occupation of their work, and no action points of a hero's; the player's
// mechanic is a first-level Smart hero. Each sheet's best skills are the ones the starter's own stats put first (Repair for
// mechanics, Drive for driving, Drive, Navigate and Survival for boating, the talking skills for charm). Hit points are each class's
// die at the first level and about half of it after, with Constitution on each. Ranks spend what each class and Intelligence give;
// none passes its level plus three, half that for a skill of another class. Nobody carries a weapon the starter does not give: Sam
// Reyes has a police officer's training and no gun.

import { MODERN } from "../../shared/profiles/modern";
import type { StarterRules } from "./rules";

const MEDIUM = { size: "medium", base_speed: 30 };
/** An ordinary townsperson: none of a hero's action points. */
const ORDINARY = { ...MEDIUM, action_points: 0 };

export const MODERN_SLICE_OF_LIFE_RULES: StarterRules = {
  set: MODERN,
  on: true,
  sheets: {
    pov: {
      str: 12, dex: 13, con: 12, int: 14, wis: 11, cha: 10, ...MEDIUM,
      classes: { smart: 1 }, hit_dice: 6, hp: 7, xp: 0, level: 1,
      d20_traits: ["gearhead", "vehicle_expert", { id: "savant", choice: "repair" }, { id: "occupation_blue_collar", choice: "craft_mechanical" }, { id: "occupation_blue_collar", choice: "drive" }, { id: "occupation_blue_collar", choice: "repair" }],
      ranks: { repair: 4, craft_mechanical: 4, craft_electronic: 4, disable_device: 4, knowledge_technology: 4, search: 4, profession: 4, computer_use: 2, research: 2, navigate: 2, knowledge_current_events: 2, investigate: 2, drive: 2, spot: 2, swim: 2 },
    },
    marcus_delgado: {
      str: 10, dex: 11, con: 11, int: 15, wis: 13, cha: 13, ...ORDINARY,
      classes: { smart: 2 }, hit_dice: 10, hp: 10, xp: 1000, level: 2,
      d20_traits: ["gearhead", "trustworthy", "vehicle_expert", { id: "savant", choice: "repair" }, { id: "occupation_blue_collar", choice: "repair" }, { id: "occupation_blue_collar", choice: "craft_mechanical" }, { id: "occupation_blue_collar", choice: "drive" }],
      ranks: { repair: 5, craft_mechanical: 5, craft_electronic: 5, disable_device: 5, knowledge_business: 5, knowledge_technology: 5, search: 5, profession: 5, computer_use: 3, research: 3, diplomacy: 2, drive: 2, sense_motive: 2, bluff: 2 },
    },
    danny_okafor: {
      str: 11, dex: 14, con: 11, int: 14, wis: 10, cha: 11, ...ORDINARY,
      classes: { fast: 1, smart: 1 }, hit_dice: 12, hp: 12, xp: 1000, level: 2,
      d20_traits: ["gearhead", "vehicle_expert", "increased_speed", { id: "savant", choice: "repair" }, { id: "occupation_blue_collar", choice: "craft_mechanical" }, { id: "occupation_blue_collar", choice: "drive" }, { id: "occupation_blue_collar", choice: "repair" }],
      ranks: { repair: 5, craft_mechanical: 5, drive: 5, disable_device: 4, profession: 4, navigate: 3, knowledge_popular_culture: 3, knowledge_technology: 3, sleight_of_hand: 3, balance: 2, computer_use: 2 },
    },
    priya_nair: {
      str: 10, dex: 11, con: 12, int: 14, wis: 12, cha: 13, ...ORDINARY,
      classes: { smart: 1, charismatic: 1 }, hit_dice: 10, hp: 12, xp: 1000, level: 2,
      d20_traits: ["trustworthy", "studious", { id: "savant", choice: "knowledge_business" }, "coordinate", { id: "occupation_white_collar", choice: "computer_use" }, { id: "occupation_white_collar", choice: "knowledge_business" }],
      ranks: { knowledge_business: 5, research: 5, computer_use: 5, knowledge_civics: 5, diplomacy: 5, gather_information: 5, profession: 5, craft_writing: 3, knowledge_current_events: 3, investigate: 3, bluff: 2, sense_motive: 2, drive: 2, perform: 2, spot: 1 },
    },
    jess_kowalczyk: {
      str: 10, dex: 12, con: 11, int: 12, wis: 13, cha: 15, ...ORDINARY,
      classes: { charismatic: 1 }, hit_dice: 6, hp: 6, xp: 0, level: 1,
      d20_traits: ["trustworthy", "guide", "fast_talk", { id: "occupation_blue_collar", choice: "drive" }, { id: "occupation_blue_collar", choice: "intimidate" }, { id: "occupation_blue_collar", choice: "handle_animal" }],
      ranks: { bluff: 4, diplomacy: 4, gather_information: 4, knowledge_current_events: 4, knowledge_streetwise: 4, profession: 4, intimidate: 2, sense_motive: 2, navigate: 2, drive: 2 },
    },
    maddie_kowalczyk: {
      str: 10, dex: 13, con: 12, int: 12, wis: 13, cha: 13, ...ORDINARY,
      classes: { fast: 1 }, hit_dice: 8, hp: 9, xp: 0, level: 1,
      d20_traits: ["alertness", "athletic", "increased_speed", { id: "occupation_student", choice: "knowledge_popular_culture" }, { id: "occupation_student", choice: "research" }, { id: "occupation_student", choice: "computer_use" }],
      ranks: { hide: 4, move_silently: 4, knowledge_popular_culture: 4, tumble: 2, balance: 2, sleight_of_hand: 2, spot: 2, navigate: 2, swim: 2 },
    },
    dale_whitcomb: {
      str: 12, dex: 10, con: 13, int: 11, wis: 14, cha: 10, ...ORDINARY,
      classes: { tough: 2 }, hit_dice: 16, hp: 18, xp: 1000, level: 2,
      d20_traits: ["vehicle_expert", "guide", "endurance", "remain_conscious", { id: "occupation_rural", choice: "drive" }, { id: "occupation_rural", choice: "survival" }],
      ranks: { drive: 5, survival: 5, spot: 5 },
    },
    helen_kowalczyk: {
      str: 8, dex: 9, con: 10, int: 12, wis: 14, cha: 13, ...ORDINARY,
      classes: { dedicated: 1 }, hit_dice: 6, hp: 6, xp: 0, level: 1,
      d20_traits: ["alertness", "attentive", "empathy", { id: "occupation_entrepreneur", choice: "diplomacy" }, { id: "occupation_entrepreneur", choice: "knowledge_business" }],
      ranks: { sense_motive: 4, listen: 4, spot: 4, knowledge_current_events: 4, profession: 4, knowledge_popular_culture: 2, diplomacy: 2 },
    },
    nora_whitfield: {
      str: 10, dex: 11, con: 12, int: 13, wis: 14, cha: 11, ...ORDINARY,
      classes: { dedicated: 2 }, hit_dice: 10, hp: 12, xp: 1000, level: 2,
      d20_traits: ["medical_expert", "attentive", "endurance", "healing_knack", { id: "occupation_doctor", choice: "treat_injury" }, { id: "occupation_doctor", choice: "craft_pharmaceutical" }],
      ranks: { treat_injury: 5, craft_pharmaceutical: 5, knowledge_earth_life_sciences: 5, sense_motive: 5, spot: 5, listen: 3, profession: 2 },
    },
    sam_reyes: {
      str: 12, dex: 14, con: 13, int: 10, wis: 12, cha: 10, ...ORDINARY,
      classes: { tough: 2 }, hit_dice: 16, hp: 18, xp: 1000, level: 2,
      d20_traits: ["personal_firearms_proficiency", "armor_light", "point_blank_shot", "remain_conscious", { id: "occupation_law_enforcement", choice: "drive" }, { id: "occupation_law_enforcement", choice: "intimidate" }],
      ranks: { drive: 5, intimidate: 5, spot: 5 },
    },
  },
};
