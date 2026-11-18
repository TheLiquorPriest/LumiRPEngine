// Harrowmere under the Modern rule set, applied and switched off for a chat made from it (RULESET-DESIGN §7): a chat switches it on
// from the World page's "For this chat". The household and their guests are ordinary people of the plain classes, first or second
// level, with the occupation of their work, and no action points of a hero's; the valuer is a first-level Smart hero. Each sheet's
// best skills are the ones the starter's own stats put first (Spot, Search and Listen for observation, the talking skills for
// manner, Will and Concentration's abilities for nerve, Lore and Research for knowledge). Hit points are each class's die at the
// first level and about half of it after, with Constitution on each. Ranks spend what each class and Intelligence give; none passes
// its level plus three, half that for a skill of another class. Nobody carries a weapon: the starter gives none.

import { MODERN } from "../../shared/profiles/modern";
import type { StarterRules } from "./rules";

const MEDIUM = { size: "medium", base_speed: 30 };
/** An ordinary person of the house: none of a hero's action points. */
const ORDINARY = { ...MEDIUM, action_points: 0 };

export const MYSTERY_MANOR_RULES: StarterRules = {
  set: MODERN,
  on: false,
  sheets: {
    pov: {
      str: 10, dex: 12, con: 11, int: 15, wis: 13, cha: 11, ...MEDIUM,
      classes: { smart: 1 }, hit_dice: 6, hp: 6, xp: 0, level: 1,
      d20_traits: ["meticulous", "studious", { id: "savant", choice: "knowledge_art" }, { id: "occupation_academic", choice: "knowledge_art" }, { id: "occupation_academic", choice: "knowledge_history" }, { id: "occupation_academic", choice: "research" }],
      ranks: { knowledge_art: 4, knowledge_history: 4, search: 4, investigate: 4, research: 4, decipher_script: 4, forgery: 4, profession: 4, craft_visual_art: 2, knowledge_arcane_lore: 2, knowledge_business: 2, spot: 2, sense_motive: 2, listen: 2 },
    },
    sir_alaric: {
      str: 12, dex: 8, con: 9, int: 15, wis: 11, cha: 15, ...ORDINARY,
      classes: { smart: 1, charismatic: 1 }, hit_dice: 10, hp: 8, xp: 1000, level: 2,
      d20_traits: ["trustworthy", "studious", { id: "savant", choice: "knowledge_history" }, "charm", { id: "occupation_dilettante", choice: "spot" }],
      ranks: { knowledge_history: 5, knowledge_art: 5, research: 5, diplomacy: 5, profession: 5, search: 3, decipher_script: 3, bluff: 3, perform: 3, knowledge_business: 3, intimidate: 3, gather_information: 3, craft_mechanical: 3, navigate: 2, knowledge_earth_life_sciences: 2 },
    },
    lady_honoria: {
      str: 9, dex: 11, con: 11, int: 12, wis: 14, cha: 15, ...ORDINARY,
      classes: { charismatic: 2 }, hit_dice: 10, hp: 10, xp: 1000, level: 2,
      d20_traits: ["trustworthy", "iron_will", "alertness", "coordinate", { id: "occupation_dilettante", choice: "spot" }],
      ranks: { diplomacy: 5, bluff: 5, gather_information: 5, knowledge_current_events: 5, profession: 5, intimidate: 4, knowledge_art: 4, perform: 3, sense_motive: 2, spot: 2 },
    },
    rupert_thorne: {
      str: 13, dex: 14, con: 12, int: 9, wis: 10, cha: 14, ...ORDINARY,
      classes: { fast: 1, charismatic: 1 }, hit_dice: 12, hp: 14, xp: 1000, level: 2,
      d20_traits: ["personal_firearms_proficiency", "deceptive", "evasion", "charm", { id: "occupation_military", choice: "drive" }, { id: "occupation_military", choice: "knowledge_tactics" }],
      ranks: { drive: 5, bluff: 5, ride: 3, diplomacy: 3, gather_information: 2, knowledge_tactics: 2, hide: 2 },
    },
    verity_lorne: {
      str: 9, dex: 13, con: 10, int: 14, wis: 15, cha: 10, ...ORDINARY,
      classes: { smart: 1 }, hit_dice: 6, hp: 6, xp: 0, level: 1,
      d20_traits: ["alertness", "meticulous", { id: "savant", choice: "search" }, { id: "occupation_white_collar", choice: "research" }, { id: "occupation_white_collar", choice: "knowledge_business" }],
      ranks: { research: 4, search: 4, investigate: 4, craft_writing: 4, forgery: 4, decipher_script: 4, knowledge_business: 4, knowledge_civics: 4, profession: 4, spot: 2, listen: 2, sense_motive: 2, hide: 2 },
    },
    julian_ashcombe: {
      str: 10, dex: 10, con: 12, int: 15, wis: 14, cha: 16, ...ORDINARY,
      classes: { smart: 1, charismatic: 1 }, hit_dice: 10, hp: 12, xp: 1000, level: 2,
      d20_traits: ["trustworthy", "deceptive", { id: "savant", choice: "knowledge_civics" }, "fast_talk", { id: "occupation_white_collar", choice: "knowledge_civics" }, { id: "occupation_white_collar", choice: "research" }],
      ranks: { knowledge_civics: 5, knowledge_business: 5, research: 5, diplomacy: 5, bluff: 5, gather_information: 5, profession: 5, decipher_script: 3, forgery: 3, investigate: 3, knowledge_history: 3, intimidate: 2, craft_writing: 2, sense_motive: 2 },
    },
    dr_lionel_farrant: {
      str: 11, dex: 10, con: 11, int: 15, wis: 13, cha: 11, ...ORDINARY,
      classes: { dedicated: 2 }, hit_dice: 10, hp: 10, xp: 1000, level: 2,
      d20_traits: ["medical_expert", "attentive", "studious", "healing_knack", { id: "occupation_doctor", choice: "treat_injury" }, { id: "occupation_doctor", choice: "craft_pharmaceutical" }],
      ranks: { treat_injury: 5, craft_pharmaceutical: 5, knowledge_earth_life_sciences: 5, knowledge_behavioral_sciences: 5, investigate: 5, spot: 3, sense_motive: 3, listen: 2, profession: 2 },
    },
    gideon_pell: {
      str: 11, dex: 12, con: 11, int: 11, wis: 15, cha: 14, ...ORDINARY,
      classes: { dedicated: 2 }, hit_dice: 10, hp: 10, xp: 1000, level: 2,
      d20_traits: ["alertness", "attentive", "stealthy", "empathy", { id: "occupation_blue_collar", choice: "drive" }, { id: "occupation_blue_collar", choice: "intimidate" }, { id: "occupation_blue_collar", choice: "repair" }],
      ranks: { spot: 5, listen: 5, sense_motive: 5, profession: 5, knowledge_current_events: 3, diplomacy: 2 },
    },
    mrs_marsh: {
      str: 12, dex: 10, con: 14, int: 10, wis: 14, cha: 11, ...ORDINARY,
      classes: { dedicated: 1 }, hit_dice: 6, hp: 8, xp: 0, level: 1,
      d20_traits: ["iron_will", "alertness", "empathy", { id: "occupation_blue_collar", choice: "drive" }, { id: "occupation_blue_collar", choice: "handle_animal" }, { id: "occupation_blue_collar", choice: "repair" }],
      ranks: { profession: 4, spot: 4, sense_motive: 4, listen: 4, gather_information: 2, knowledge_current_events: 2 },
    },
    nell_sparrow: {
      str: 9, dex: 14, con: 10, int: 9, wis: 13, cha: 10, ...ORDINARY,
      classes: { fast: 1 }, hit_dice: 8, hp: 8, xp: 0, level: 1,
      d20_traits: ["alertness", "stealthy", "increased_speed", { id: "occupation_blue_collar", choice: "drive" }, { id: "occupation_blue_collar", choice: "handle_animal" }, { id: "occupation_blue_collar", choice: "repair" }],
      ranks: { hide: 4, move_silently: 4, balance: 2, sleight_of_hand: 2, spot: 2, listen: 2 },
    },
    constable_hobbs: {
      str: 13, dex: 10, con: 13, int: 10, wis: 13, cha: 10, ...ORDINARY,
      classes: { tough: 1, dedicated: 1 }, hit_dice: 14, hp: 16, xp: 1000, level: 2,
      d20_traits: ["attentive", "endurance", "remain_conscious", "empathy", { id: "occupation_law_enforcement", choice: "intimidate" }, { id: "occupation_law_enforcement", choice: "knowledge_civics" }],
      ranks: { spot: 5, sense_motive: 4, investigate: 3, intimidate: 3, survival: 2 },
    },
  },
};
