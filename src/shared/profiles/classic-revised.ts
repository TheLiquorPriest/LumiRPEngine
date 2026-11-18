// The Classic Revised rule set (RULESET-DESIGN §6): the later revision of the Classic rules. A shorter skill list with a flat bonus
// for a trained class skill and ranks held to one's hit dice; one bonus and one defence for every combat manoeuvre in place of the
// opposed grapple; hit points that run down to minus the Constitution score, with a check to steady the dying; its own classes,
// races and feats; a feat at every odd level; and three experience tracks. A world fragment the profile machinery applies, written
// with `d20-common.ts`, whose shared rows it spreads under its own. An original implementation of common tabletop mechanics: no
// rules text.

import { presetAdjudication } from "../adjudication";
import type { JsonObject } from "../json";
import type { TableRow } from "../tables";
import type { D20Def } from "../d20";
import {
  ABILITY_MOD,
  ARMOR_COLUMNS,
  armor,
  armorMods,
  BASE_ATTACK,
  byLevel,
  condition,
  CORE_WEAPONS,
  creatureType,
  D20_ABILITY_IDS,
  D20_COSTS,
  d20Combat,
  d20Fields,
  d20Sheet,
  d20Table,
  dailyGauge,
  DIFFICULTIES,
  familyTotals,
  features,
  HALF_SPEED,
  improvedCritical,
  mod,
  natural,
  NO_DEX,
  SHARED_CONDITIONS,
  SHARED_CREATURE_TRAITS,
  SHARED_FEATS,
  SHARED_FEATURES,
  shieldMods,
  SIZE_COLUMNS,
  signedTotal,
  sizeRows,
  skillsMod,
  TRACK_COLUMNS,
  TRACK_ROWS,
  trait,
  UNARMOURED,
  WEAPON_COLUMNS,
  weapon,
  wearing,
  type D20SetDef,
} from "./d20-common";

const T = {
  skills: "classic_revised.skills",
  classes: "classic_revised.classes",
  tracks: "classic_revised.tracks",
  traits: "classic_revised.traits",
  conditions: "classic_revised.conditions",
  sizes: "classic_revised.sizes",
  weapons: "classic_revised.weapons",
  armor: "classic_revised.armor",
  creatures: "classic_revised.creatures",
  experience: "classic_revised.experience",
  challenges: "classic_revised.challenges",
  difficulties: "classic_revised.difficulties",
} as const;

// ---------------------------------------------------------------- skills

/** Each skill: its label, key ability, whether only the trained use it, and whether armour's check penalty falls on it. */
const SKILLS: readonly [string, string, string, boolean, boolean][] = [
  ["acrobatics", "Acrobatics", "dex", false, true],
  ["appraise", "Appraise", "int", false, false],
  ["bluff", "Deceive", "cha", false, false],
  ["climb", "Climb", "str", false, true],
  ["craft", "Craft", "int", false, false],
  ["diplomacy", "Persuade", "cha", false, false],
  ["disable_device", "Disable Devices", "dex", true, true],
  ["disguise", "Disguise", "cha", false, false],
  ["escape_artist", "Slip Free", "dex", false, true],
  ["fly", "Fly", "dex", false, true],
  ["handle_animal", "Handle Animals", "cha", true, false],
  ["heal", "First Aid", "wis", false, false],
  ["intimidate", "Intimidate", "cha", false, false],
  ["knowledge_arcana", "Lore (arcane)", "int", true, false],
  ["knowledge_dungeoneering", "Lore (underground)", "int", true, false],
  ["knowledge_engineering", "Lore (building)", "int", true, false],
  ["knowledge_geography", "Lore (lands)", "int", true, false],
  ["knowledge_history", "Lore (history)", "int", true, false],
  ["knowledge_local", "Lore (local)", "int", true, false],
  ["knowledge_nature", "Lore (nature)", "int", true, false],
  ["knowledge_nobility", "Lore (nobility)", "int", true, false],
  ["knowledge_planes", "Lore (other planes)", "int", true, false],
  ["knowledge_religion", "Lore (religion)", "int", true, false],
  ["linguistics", "Languages", "int", true, false],
  ["perception", "Perception", "wis", false, false],
  ["perform", "Perform", "cha", false, false],
  ["profession", "Profession", "wis", true, false],
  ["ride", "Ride", "dex", false, true],
  ["sense_motive", "Read People", "wis", false, false],
  ["sleight_of_hand", "Deft Hands", "dex", true, true],
  ["spellcraft", "Spell Lore", "int", true, false],
  ["stealth", "Stealth", "dex", false, true],
  ["survival", "Survival", "wis", false, false],
  ["swim", "Swim", "str", false, true],
  ["use_magic_device", "Use Magic Items", "cha", true, false],
];

const skillRows: Record<string, TableRow> = {};
for (const [id, label, ability, trained, acp] of SKILLS) skillRows[id] = { label, ability, ...(trained ? { trained } : {}), ...(acp ? { armor: true } : {}) };

const LORE = SKILLS.map(([id]) => id).filter((id) => id.startsWith("knowledge_"));

// ---------------------------------------------------------------- classes

function tracks(attack: "good" | "average" | "poor", fort: "good" | "poor", ref: "good" | "poor", will: "good" | "poor"): JsonObject {
  return { attack: `attack_${attack}`, fort: `save_${fort}`, ref: `save_${ref}`, will: `save_${will}` };
}

const classRows: Record<string, TableRow> = {
  barbarian: {
    label: "Barbarian",
    hit_die: 12,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 4,
    class_skills: ["acrobatics", "climb", "craft", "handle_animal", "intimidate", "knowledge_nature", "perception", "ride", "survival", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "shield_proficiency", "fast_movement", "rage"], 2: ["rage_power", "uncanny_dodge"], 3: ["trap_sense"], 5: ["improved_uncanny_dodge"], 7: ["barbarian_reduction"], 11: ["greater_rage"], 14: ["indomitable_will"], 17: ["tireless_rage"], 20: ["mighty_rage"] }),
  },
  bard: {
    label: "Bard",
    hit_die: 8,
    tracks: tracks("average", "poor", "good", "good"),
    skill_points: 6,
    class_skills: ["acrobatics", "appraise", "bluff", "climb", "craft", "diplomacy", "disguise", "escape_artist", "intimidate", ...LORE, "linguistics", "perception", "perform", "profession", "sense_motive", "sleight_of_hand", "spellcraft", "stealth", "use_magic_device"],
    proficiency: ["simple", "longsword", "rapier", "sap", "short_sword", "shortbow", "whip"],
    features: features({ 1: ["armor_light", "shield_proficiency", "bardic_knowledge", "bardic_performance"], 2: ["versatile_performance", "well_versed"], 5: ["lore_master"], 10: ["jack_of_all_trades"] }),
  },
  cleric: {
    label: "Cleric",
    hit_die: 8,
    tracks: tracks("average", "good", "poor", "good"),
    skill_points: 2,
    class_skills: ["appraise", "craft", "diplomacy", "heal", "knowledge_arcana", "knowledge_history", "knowledge_nobility", "knowledge_planes", "knowledge_religion", "linguistics", "profession", "sense_motive", "spellcraft"],
    proficiency: ["simple"],
    features: features({ 1: ["armor_light", "armor_medium", "shield_proficiency", "cleric_aura", "channel_energy", "domains"] }),
  },
  druid: {
    label: "Druid",
    hit_die: 8,
    tracks: tracks("average", "good", "poor", "good"),
    skill_points: 4,
    class_skills: ["climb", "craft", "fly", "handle_animal", "heal", "knowledge_geography", "knowledge_nature", "perception", "profession", "ride", "spellcraft", "survival", "swim"],
    proficiency: ["club", "dagger", "dart", "quarterstaff", "scimitar", "scythe", "sickle", "shortspear", "sling", "spear", "unarmed_strike"],
    features: features({ 1: ["armor_light", "armor_medium", "shield_proficiency", "nature_bond", "nature_sense", "wild_empathy"], 2: ["woodland_stride"], 3: ["trackless_step"], 4: ["resist_natures_lure", "wild_shape"], 9: ["venom_immunity"], 13: ["a_thousand_faces"], 15: ["timeless_body"] }),
  },
  fighter: {
    label: "Fighter",
    hit_die: 10,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 2,
    class_skills: ["climb", "craft", "handle_animal", "intimidate", "knowledge_dungeoneering", "knowledge_engineering", "profession", "ride", "survival", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency", "tower_shield_proficiency", "fighter_bonus_feat"], 2: ["bravery"], 3: ["armor_training"], 5: ["weapon_training"], 19: ["armor_mastery"], 20: ["weapon_mastery"] }),
  },
  monk: {
    label: "Monk",
    hit_die: 8,
    tracks: tracks("average", "good", "good", "good"),
    skill_points: 4,
    class_skills: ["acrobatics", "climb", "craft", "escape_artist", "intimidate", "knowledge_history", "knowledge_religion", "perception", "perform", "profession", "ride", "sense_motive", "stealth", "swim"],
    proficiency: ["club", "light_crossbow", "heavy_crossbow", "dagger", "handaxe", "javelin", "kama", "nunchaku", "quarterstaff", "sai", "shortspear", "short_sword", "shuriken", "siangham", "sling", "unarmed_strike"],
    features: features({ 1: ["improved_unarmed_strike", "flurry_of_blows", "stunning_fist", "monk_unarmed", "monk_ac", "monk_bonus_feat"], 2: ["evasion"], 3: ["monk_speed", "maneuver_training", "still_mind"], 4: ["ki_pool", "slow_fall"], 5: ["high_jump", "purity_of_body"], 7: ["wholeness_of_body"], 9: ["improved_evasion"], 11: ["diamond_body"], 12: ["abundant_step"], 13: ["diamond_soul"], 15: ["quivering_palm"], 17: ["timeless_body", "tongue_of_sun_and_moon"], 19: ["empty_body"], 20: ["perfect_self"] }),
  },
  paladin: {
    label: "Paladin",
    hit_die: 10,
    tracks: tracks("good", "good", "poor", "good"),
    skill_points: 2,
    class_skills: ["craft", "diplomacy", "handle_animal", "heal", "knowledge_nobility", "knowledge_religion", "profession", "ride", "sense_motive", "spellcraft"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency", "aura_of_good", "detect_evil", "smite_evil"], 2: ["divine_grace", "lay_on_hands"], 3: ["aura_of_courage", "divine_health", "mercy"], 4: ["channel_positive"], 5: ["divine_bond"], 8: ["aura_of_resolve"], 11: ["aura_of_justice"], 14: ["aura_of_faith"], 17: ["aura_of_righteousness"], 20: ["holy_champion"] }),
  },
  ranger: {
    label: "Ranger",
    hit_die: 10,
    tracks: tracks("good", "good", "good", "poor"),
    skill_points: 6,
    class_skills: ["climb", "craft", "handle_animal", "heal", "intimidate", "knowledge_dungeoneering", "knowledge_geography", "knowledge_nature", "perception", "profession", "ride", "spellcraft", "stealth", "survival", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "shield_proficiency", "favored_enemy", "track", "wild_empathy"], 2: ["combat_style"], 3: ["endurance", "favored_terrain"], 4: ["hunters_bond"], 7: ["woodland_stride"], 8: ["swift_tracker"], 9: ["evasion"], 11: ["quarry"], 12: ["camouflage"], 16: ["improved_evasion"], 17: ["hide_in_plain_sight"], 19: ["improved_quarry"], 20: ["master_hunter"] }),
  },
  rogue: {
    label: "Rogue",
    hit_die: 8,
    tracks: tracks("average", "poor", "good", "poor"),
    skill_points: 8,
    class_skills: ["acrobatics", "appraise", "bluff", "climb", "craft", "diplomacy", "disable_device", "disguise", "escape_artist", "intimidate", "knowledge_dungeoneering", "knowledge_local", "linguistics", "perception", "perform", "profession", "sense_motive", "sleight_of_hand", "stealth", "swim", "use_magic_device"],
    proficiency: ["simple", "hand_crossbow", "rapier", "sap", "shortbow", "short_sword"],
    features: features({ 1: ["armor_light", "sneak_attack", "trapfinding"], 2: ["evasion", "rogue_talent"], 3: ["trap_sense"], 4: ["uncanny_dodge"], 8: ["improved_uncanny_dodge"], 10: ["advanced_talents"], 20: ["master_strike"] }),
  },
  sorcerer: {
    label: "Sorcerer",
    hit_die: 6,
    tracks: tracks("poor", "poor", "poor", "good"),
    skill_points: 2,
    class_skills: ["appraise", "bluff", "craft", "fly", "intimidate", "knowledge_arcana", "profession", "spellcraft", "use_magic_device"],
    proficiency: ["simple"],
    features: features({ 1: ["bloodline", "eschew_materials"] }),
  },
  wizard: {
    label: "Wizard",
    hit_die: 6,
    tracks: tracks("poor", "poor", "poor", "good"),
    skill_points: 2,
    class_skills: ["appraise", "craft", "fly", ...LORE, "linguistics", "profession", "spellcraft"],
    proficiency: ["club", "dagger", "heavy_crossbow", "light_crossbow", "quarterstaff", "unarmed_strike"],
    features: features({ 1: ["arcane_bond", "arcane_school", "scribe_scroll"], 5: ["wizard_bonus_feat"] }),
  },
  warrior: {
    label: "Warrior",
    hit_die: 10,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 2,
    class_skills: ["climb", "craft", "handle_animal", "intimidate", "profession", "ride", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency"] }),
  },
};

// ---------------------------------------------------------------- traits: feats, races, creature types, class features

/** +2 on each skill, +4 once it holds 10 ranks. */
function honed(skills: string[]): JsonObject[] {
  return skills.map((s) => mod(`skill.${s}`, `ranks(self, '${s}') >= 10 ? 4 : 2`));
}

const MANOEUVRE = "+2 to that manoeuvre and to its defence against it, and it gives no attack of opportunity: name it with the manoeuvre.";

const traitRows: Record<string, TableRow> = {
  ...SHARED_FEATS,
  ...SHARED_FEATURES,
  ...SHARED_CREATURE_TRAITS,

  // Feats of this set's own.
  acrobatic: trait("Acrobatic", "feat", "+2 Acrobatics and Fly (+4 on each from 10 ranks).", { modifiers: honed(["acrobatics", "fly"]) }),
  alertness: trait("Alert", "feat", "+2 Perception and Read People (+4 on each from 10 ranks).", { modifiers: honed(["perception", "sense_motive"]) }),
  animal_affinity: trait("Way with Animals", "feat", "+2 Handle Animals and Ride (+4 on each from 10 ranks).", { modifiers: honed(["handle_animal", "ride"]) }),
  athletic: trait("Athletic", "feat", "+2 Climb and Swim (+4 on each from 10 ranks).", { modifiers: honed(["climb", "swim"]) }),
  deceitful: trait("Deceitful", "feat", "+2 Deceive and Disguise (+4 on each from 10 ranks).", { modifiers: honed(["bluff", "disguise"]) }),
  deft_hands: trait("Nimble Hands", "feat", "+2 Disable Devices and Deft Hands (+4 on each from 10 ranks).", { modifiers: honed(["disable_device", "sleight_of_hand"]) }),
  magical_aptitude: trait("Magic Knack", "feat", "+2 Spell Lore and Use Magic Items (+4 on each from 10 ranks).", { modifiers: honed(["spellcraft", "use_magic_device"]) }),
  persuasive: trait("Silver Tongue", "feat", "+2 Persuade and Intimidate (+4 on each from 10 ranks).", { modifiers: honed(["diplomacy", "intimidate"]) }),
  self_sufficient: trait("Self-Reliant", "feat", "+2 First Aid and Survival (+4 on each from 10 ranks).", { modifiers: honed(["heal", "survival"]) }),
  stealthy: trait("Stealthy", "feat", "+2 Slip Free and Stealth (+4 on each from 10 ranks).", { modifiers: honed(["escape_artist", "stealth"]) }),
  skill_focus: trait("Specialist", "feat", "+3 on the skill taken as its choice, +6 from 10 ranks in it.", { modifiers: [mod("skill.{choice}", "ranks(self, '{choice}') >= 10 ? 6 : 3")] }),
  dodge: trait("Dodge", "feat", "+1 dodge to defence.", { modifiers: [mod("ac", 1, { type: "dodge" })], requires: "score(self, 'dex') >= 13" }),
  toughness: trait("Tough", "feat", "+3 hit points, and 1 more for each hit die past the 3rd.", { modifiers: [mod("hp", "max(3, levels(self) + self.racial_hd)")] }),
  fleet: trait("Fleet", "feat", "+5 speed in light armour or none.", { modifiers: [mod("speed", 5, { when: "limit(self, 'armor_weight', 0) <= 1" })] }),
  power_attack: trait("Heavy Blows", "feat", "Before attacking, it may take 1 off its melee attacks for 2 more damage (3 with a weapon in both hands), and 1 and 2 more for every 4 points of base attack: name both as the attack's modifiers.", { requires: `score(self, 'str') >= 13 and ${BASE_ATTACK} >= 1` }),
  deadly_aim: trait("Deadly Aim", "feat", "Before attacking, it may take 1 off its ranged attacks for 2 more damage, and 1 and 2 more for every 4 points of base attack: name both as the attack's modifiers.", { requires: `score(self, 'dex') >= 13 and ${BASE_ATTACK} >= 1` }),
  combat_expertise: trait("Guarded Fighting", "feat", "Before attacking, it may take 1 off its melee attacks for +1 dodge to defence until its next turn, and 1 more each for every 4 points of base attack: name both as the attack's modifiers.", { requires: "score(self, 'int') >= 13" }),
  combat_reflexes: trait("Quick Reflexes", "feat", "As many more attacks of opportunity a round as its Dexterity modifier, and it makes them while flat-footed."),
  cleave: trait("Follow-Through", "feat", "As a standard action, one melee attack; if it hits, one more at the same bonus at another foe within reach; -2 defence until its next turn.", { requires: "score(self, 'str') >= 13 and has_trait(self, 'power_attack')" }),
  vital_strike: trait("Vital Strike", "feat", "One attack as a standard action rolls the weapon's damage dice twice: name the extra dice with the harm.", { requires: `${BASE_ATTACK} >= 6` }),
  far_shot: trait("Long Shot", "feat", "-1 for each range increment past the first, not -2: name the difference as the attack's modifier.", { requires: "has_trait(self, 'point_blank_shot')" }),
  diehard: trait("Hard to Kill", "feat", "Below 0 hit points it is stable at once and stays awake, acting as one disabled.", { requires: "has_trait(self, 'endurance')" }),
  greater_weapon_specialization: trait("Weapon Mastery, Greater", "feat", "+2 more to damage with the weapon taken as its choice.", { modifiers: [mod("damage.weapon.{choice}", 2)], requires: "class_level(self, 'fighter') >= 12" }),
  improved_critical: improvedCritical(T.weapons),
  improved_grapple: trait("Wrestler", "feat", MANOEUVRE, { requires: "score(self, 'dex') >= 13 and has_trait(self, 'improved_unarmed_strike')" }),
  improved_trip: trait("Tripper", "feat", MANOEUVRE, { requires: "score(self, 'int') >= 13 and has_trait(self, 'combat_expertise')" }),
  improved_disarm: trait("Disarmer", "feat", MANOEUVRE, { requires: "score(self, 'int') >= 13 and has_trait(self, 'combat_expertise')" }),
  improved_bull_rush: trait("Shoving", "feat", MANOEUVRE, { requires: "score(self, 'str') >= 13 and has_trait(self, 'power_attack')" }),
  improved_sunder: trait("Breaker", "feat", MANOEUVRE, { requires: "score(self, 'str') >= 13 and has_trait(self, 'power_attack')" }),

  // Races, and the class a creature favours.
  human: trait("Human", "race", "Medium, speed 30. +2 to the ability taken as its choice; one more feat at the first level; one more skill rank each level.", { modifiers: [mod("ability.{choice}", 2, { type: "racial" }), mod("skill_points", 1, { note: "one more each level" })] }),
  dwarf: trait("Dwarf", "race", "Medium, speed 20, never slowed by armour or load. +2 Constitution and Wisdom, -2 Charisma; sees 60 feet in the dark; +2 on saves against poison and spells; +4 dodge against giants; +1 to attack orcs and goblins; +4 to its defence against being pushed or tripped; +2 Perception for stonework.", {
    modifiers: [mod("ability.con", 2, { type: "racial" }), mod("ability.wis", 2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" })],
    grants: { proficiency: ["battleaxe", "heavy_pick", "warhammer", "dwarven_waraxe", "dwarven_urgrosh"] },
  }),
  elf: trait("Elf", "race", "Medium, speed 30. +2 Dexterity and Intelligence, -2 Constitution; +2 Perception; no magic puts it to sleep, +2 on saves against charms; +2 to overcome spell resistance; sees far in dim light; trained with longswords, rapiers and bows.", {
    modifiers: [mod("ability.dex", 2, { type: "racial" }), mod("ability.int", 2, { type: "racial" }), mod("ability.con", -2, { type: "racial" }), mod("skill.perception", 2, { type: "racial" })],
    grants: { proficiency: ["longsword", "rapier", "longbow", "composite_longbow", "shortbow", "composite_shortbow", "elven_curve_blade"] },
  }),
  gnome: trait("Gnome", "race", "Small, speed 20. +2 Constitution and Charisma, -2 Strength; +2 Perception; +2 on saves against illusions; +1 to attack goblins and reptile-folk; +4 dodge against giants; sees far in dim light.", {
    modifiers: [mod("ability.con", 2, { type: "racial" }), mod("ability.cha", 2, { type: "racial" }), mod("ability.str", -2, { type: "racial" }), mod("skill.perception", 2, { type: "racial" })],
    grants: { proficiency: ["gnome_hooked_hammer"] },
  }),
  half_elf: trait("Half-Elf", "race", "Medium, speed 30. +2 to the ability taken as its choice; +2 Perception; no magic puts it to sleep, +2 on saves against charms; Specialist as a feat at the first level; two favoured classes; sees far in dim light.", {
    modifiers: [mod("ability.{choice}", 2, { type: "racial" }), mod("skill.perception", 2, { type: "racial" })],
  }),
  half_orc: trait("Half-Orc", "race", "Medium, speed 30. +2 to the ability taken as its choice; +2 Intimidate; sees 60 feet in the dark; once a day fights on for a round below 0 hit points; trained with greataxes and falchions.", {
    modifiers: [mod("ability.{choice}", 2, { type: "racial" }), mod("skill.intimidate", 2, { type: "racial" })],
    grants: { proficiency: ["greataxe", "falchion"] },
  }),
  halfling: trait("Halfling", "race", "Small, speed 20. +2 Dexterity and Charisma, -2 Strength; +1 on every save, and +2 more against fear; +2 Perception, Acrobatics and Climb; trained with slings.", {
    modifiers: [mod("ability.dex", 2, { type: "racial" }), mod("ability.cha", 2, { type: "racial" }), mod("ability.str", -2, { type: "racial" }), mod("save", 1, { type: "racial" }), ...skillsMod(2, ["perception", "acrobatics", "climb"], "racial")],
    grants: { proficiency: ["sling", "halfling_sling_staff"] },
  }),
  goblin: trait("Goblin", "race", "Small, speed 30. +4 Dexterity, -2 Strength and Charisma; +4 Ride and Stealth; sees 60 feet in the dark.", {
    modifiers: [mod("ability.dex", 4, { type: "racial" }), mod("ability.str", -2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" }), ...skillsMod(4, ["ride", "stealth"], "racial")],
  }),
  orc: trait("Orc", "race", "Medium, speed 30. +4 Strength, -2 Intelligence, Wisdom and Charisma; sees 60 feet in the dark; dazzled in bright light; once a day fights on for a round below 0 hit points; trained with greataxes and falchions.", {
    modifiers: [mod("ability.str", 4, { type: "racial" }), mod("ability.int", -2, { type: "racial" }), mod("ability.wis", -2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" })],
    grants: { proficiency: ["greataxe", "falchion"] },
  }),
  favored_class: trait("Favoured Class", "race", "+1 hit point for each level in the class taken as its choice.", { modifiers: [mod("hp", "class_level(self, '{choice}')", { note: "its favoured class" })] }),
  favored_class_skills: trait("Favoured Class, Skills", "race", "Taken in place of Favoured Class: one more skill rank for each level in the class taken as its choice, given with the ranks it buys."),

  // Creature types and qualities of this set's own.
  animal: creatureType("Animal", "A beast: each of its own hit dice is a d8; they give three quarters of themselves in base attack, a good Fortitude and Reflex and a poor Will; Acrobatics, Climb, Fly, Perception, Stealth and Swim are its class skills.", "3 / 4", ["fort", "ref"], {
    grants: { class_skills: ["acrobatics", "climb", "fly", "perception", "stealth", "swim"] },
  }),
  giant: creatureType("Giant", "A giant: each of its own hit dice is a d8; they give three quarters in base attack and a good Fortitude; trained with simple and martial weapons; Climb, Intimidate and Perception are its class skills.", "3 / 4", ["fort"], {
    grants: { proficiency: ["simple", "martial"], class_skills: ["climb", "intimidate", "perception"] },
  }),
  undead: creatureType("Undead", "Dead and moving: each of its own hit dice is a d8; they give three quarters in base attack and a good Will. It lacks Constitution (its score reads 10) and takes Charisma in its place for hit points and Fortitude; it is destroyed at 0 hit points. Critical hits, poison, sleep, paralysis, stunning, disease and anything that works on a mind do it nothing.", "3 / 4", ["will"], {
    grants: { proficiency: ["simple"] },
    modifiers: [mod("save.fort", "mod(self, 'cha')", { note: "Charisma for Constitution" }), mod("hp", "mod(self, 'cha') * self.racial_hd", { note: "Charisma for Constitution" })],
  }),
  zombie_flesh: trait("Dead Flesh", "quality", "Harm of any type but slashing loses 5 to it; it is staggered always: a move or a standard action a turn, never both.", { modifiers: [mod("reduction", 5, { bypass: ["slashing"] })] }),
  ferocity: trait("Ferocity", "quality", "Below 0 hit points it fights on as one disabled until it is dead."),

  // Class features of this set's own.
  rage: trait("Rage", "class feature", "For as many rounds a day as the Rage gauge holds (4 + its Constitution modifier, and 2 more each level past the 1st): put on the raging condition, then fatigued twice as long when it ends."),
  rage_power: trait("Rage Power", "class feature", "A power at the 2nd level and each even level after, used while raging."),
  bardic_knowledge: trait("Bardic Knowledge", "class feature", "Half its bard levels (at least 1) added to every Lore check, and Lore checks open to it untrained.", {
    modifiers: LORE.map((s) => mod(`skill.${s}`, "max(1, floor(class_level(self, 'bard') / 2))")),
  }),
  bardic_performance: trait("Bardic Performance", "class feature", "As many rounds a day as the Performance gauge holds: countersong, distraction, fascinate, inspire courage (+1 morale to allies' attack, weapon damage and saves against fear and charms; +1 more at the 5th level and every 6th after), and more as it rises: put them on as effects."),
  versatile_performance: trait("Versatile Performance", "class feature", "A kind of performance stands for two other skills it names."),
  well_versed: trait("Well-Versed", "class feature", "+4 on saves against sound and bardic magic."),
  lore_master: trait("Lore Master", "class feature", "Takes 10 on any Lore check, and once a day takes 20."),
  jack_of_all_trades: trait("Jack of All Trades", "class feature", "Uses any skill untrained."),
  cleric_aura: trait("Aura of Faith", "class feature", "Its god's nature shines from it to those who sense it."),
  channel_energy: trait("Channel Energy", "class feature", "Heals or harms all within 30 feet: 1d6 at the 1st level and 1d6 more each two levels, a Will save against 10 + half its cleric levels + its Charisma modifier for half; uses a day: the Channel gauge, 3 + its Charisma modifier."),
  domains: trait("Domains", "class feature", "Two domains of its god, each with powers and spells of its own."),
  nature_bond: trait("Nature Bond", "class feature", "An animal companion, or a cleric's domain of nature."),
  wild_shape: trait("Wild Shape", "class feature", "Takes the shape of an animal and back, as often a day as the Wild Shape gauge: once at the 4th level and once more each two levels after."),
  bravery: trait("Bravery", "class feature", "+1 on Will saves against fear at the 2nd level, and 1 more every four levels after: name it against fear."),
  armor_training: trait("Armour Training", "class feature", "From the 3rd level, armour's check penalty is 1 less and its most Dexterity 1 more, and 1 more of each every four levels; full speed in medium armour from the 3rd, in heavy from the 7th: the GM names the most Dexterity.", {
    modifiers: [mod("armor_check", "floor((class_level(self, 'fighter') + 1) / 4)", { when: "limit(self, 'armor_weight', 0) > 0", note: "armour training" })],
  }),
  weapon_training: trait("Weapon Training", "class feature", "From the 5th level, +1 to attack and damage with the weapon taken as its choice, and 1 more every four levels after.", {
    modifiers: [mod("attack.weapon.{choice}", "floor((class_level(self, 'fighter') - 1) / 4)"), mod("damage.weapon.{choice}", "floor((class_level(self, 'fighter') - 1) / 4)")],
  }),
  armor_mastery: trait("Armour Mastery", "class feature", "In armour or with a shield, harm of every kind loses 5.", { modifiers: [mod("reduction", 5, { bypass: [], when: "limit(self, 'armor_weight', 0) + limit(self, 'shield_worn', 0) > 0" })] }),
  weapon_mastery: trait("Weapon Mastery, Perfect", "class feature", "With one weapon: its threats are criticals without a confirming roll, its multiplier is one more, and it cannot be taken from its hand."),
  flurry_of_blows: trait("Flurry of Blows", "class feature", "With all its attacks, unarmed or with a monk's weapon, one more attack at its highest bonus, all at its monk levels for base attack and -2 each; more attacks at the 8th and 15th levels: name them as the attack's modifiers."),
  stunning_fist: trait("Stunning Fist", "class feature", "An unarmed hit that also stuns the foe a round unless it makes Fortitude against 10 + half its hit dice + its Wisdom modifier; uses a day: the Stunning Fist gauge."),
  monk_ac: trait("Unarmoured Defence", "class feature", "With no armour and no shield, its Wisdom bonus and 1 for every four monk levels add to defence and to its manoeuvre defence, even flat-footed or against a touch.", {
    modifiers: [mod("ac", "max(0, mod(self, 'wis')) + floor(class_level(self, 'monk') / 4)", { when: UNARMOURED, note: "Wisdom and training" })],
  }),
  monk_bonus_feat: trait("Monk Feats", "class feature", "One more feat at the 1st and 2nd levels and every four levels after, from a short list."),
  maneuver_training: trait("Manoeuvre Training", "class feature", "Its monk levels stand for its base attack in its manoeuvre bonus.", { modifiers: [mod("cmb", "class_level(self, 'monk') - floor(class_level(self, 'monk') * 3 / 4)", { note: "monk levels for base attack" })] }),
  ki_pool: trait("Ki Pool", "class feature", "Points a day (the Ki gauge: half its monk levels + its Wisdom modifier) spent for one more attack in a flurry, +20 speed for a round, or +4 dodge for a round; its strikes pass reduction as magic weapons."),
  high_jump: trait("High Jump", "class feature", "Its monk levels added to jumping, which it always does with a run."),
  wholeness_of_body: trait("Wholeness of Body", "class feature", "Heals itself its monk levels in hit points for 2 ki points."),
  tongue_of_sun_and_moon: trait("Every Tongue", "class feature", "Speaks with any living creature."),
  perfect_self: trait("Perfect Self", "class feature", "Harm loses 10 to it, but not from chaotic weapons.", { modifiers: [mod("reduction", 10, { bypass: ["chaotic"] })] }),
  smite_evil: trait("Smite Evil", "class feature", "As a swift action against an evil foe: + its Charisma modifier to attack and to defence against that foe, + its paladin levels to damage, until the foe falls: name them as the attack's modifiers. Uses a day: the Smite gauge (1, and 1 more each three levels)."),
  lay_on_hands: trait("Lay on Hands", "class feature", "Heals by touch 1d6 for every two paladin levels; uses a day: the Lay on Hands gauge, half its paladin levels + its Charisma modifier."),
  mercy: trait("Mercy", "class feature", "Its laying on of hands also ends a condition it chose (one more each three levels)."),
  channel_positive: trait("Channel Light", "class feature", "Spends two uses of laying on hands to heal as a cleric of its level does."),
  divine_bond: trait("Divine Bond", "class feature", "A weapon made holy for a time each day, or a called mount."),
  aura_of_resolve: trait("Aura of Resolve", "class feature", "No charm touches it, and allies within 10 feet have +4 morale against charms."),
  aura_of_justice: trait("Aura of Justice", "class feature", "Lends its smiting to allies within 10 feet."),
  aura_of_faith: trait("Aura of Faith", "class feature", "Its weapons and allies' within 10 feet strike as good."),
  aura_of_righteousness: trait("Aura of Righteousness", "class feature", "Harm loses 5 to it, but not from evil weapons; no compulsion touches it.", { modifiers: [mod("reduction", 5, { bypass: ["evil"] })] }),
  holy_champion: trait("Holy Champion", "class feature", "Harm loses 10 to it, but not from evil weapons; its smiting can banish.", { modifiers: [mod("reduction", 10, { bypass: ["evil"] })] }),
  favored_enemy: trait("Favoured Enemy", "class feature", "Against a kind of foe it has chosen, +2 on Deceive, Lore, Perception, Read People and Survival and on attack and weapon damage (more kinds and more bonus every five levels): name it against that foe."),
  favored_terrain: trait("Favoured Ground", "class feature", "In a kind of land it has chosen, +2 initiative and on Lore, Perception, Stealth and Survival (more lands every five levels): name it there."),
  track: trait("Tracker", "class feature", "Half its ranger levels (at least 1) added to Survival to follow tracks: name it then."),
  combat_style: trait("Fighting Style", "class feature", "Archery or two weapons: a feat of its style at the 2nd level and every four after, in any armour."),
  hunters_bond: trait("Hunter's Bond", "class feature", "An animal companion, or a bond with its allies that lends them half its favoured-enemy bonus."),
  quarry: trait("Quarry", "class feature", "One foe at a time: +2 to attack it, and its threats on that foe are criticals without a confirming roll."),
  improved_quarry: trait("Quarry, Improved", "class feature", "+4 to attack its quarry."),
  master_hunter: trait("Master Hunter", "class feature", "Its favoured enemies may die from a single blow."),
  trapfinding: trait("Trapfinding", "class feature", "Half its rogue levels (at least 1) added to Perception to find traps and to Disable Devices; it disarms magic traps too: name it then."),
  rogue_talent: trait("Rogue Talent", "class feature", "A talent at the 2nd level and every even level after."),
  advanced_talents: trait("Advanced Talents", "class feature", "From the 10th level a talent may be one of the advanced ones."),
  master_strike: trait("Master Strike", "class feature", "A sneak attack may also put the foe to sleep, paralyse it or slay it: Fortitude against 10 + half its rogue levels + its Intelligence modifier."),
  bloodline: trait("Bloodline", "class feature", "The power in its blood: a class skill, spells, feats and powers by level."),
  eschew_materials: trait("Spells Without Means", "class feature", "Casts its spells without their cheap materials."),
  arcane_bond: trait("Arcane Bond", "class feature", "A familiar, or a bonded thing through which it casts one spell more a day."),
  arcane_school: trait("Arcane School", "class feature", "A school of magic: one spell more a day of it at each level, two other schools harder to cast."),
};

// ---------------------------------------------------------------- conditions

const BLIND_SKILLS = ["acrobatics", "climb", "disable_device", "escape_artist", "fly", "ride", "sleight_of_hand", "stealth", "swim", "perception"];

const conditionRows: Record<string, TableRow> = {
  ...SHARED_CONDITIONS,
  bleed: condition("Bleeding", "Loses the named hit points at the start of each of its turns until First Aid of 15 or any healing stops it; bleeds of one kind do not add up.", [], ["bleeding"]),
  blinded: condition("Blinded", "-2 defence and no Dexterity bonus to it; -4 on most Strength and Dexterity skills and on Perception against another; every foe has total concealment from it (half its attacks miss); faster than half speed needs Acrobatics of 10.", [mod("ac", -2), NO_DEX, ...skillsMod(-4, BLIND_SKILLS)], ["flat", "blind"]),
  broken: condition("Broken", "Of a thing: a weapon has -2 to attack and damage and a critical only on 20, x2; armour or a shield gives half its bonus and twice its check penalty."),
  confused: condition("Confused", "Each turn a roll of d% says what it does: 01-25 acts as it would, 26-50 babbles, 51-75 strikes itself for 1d8 + its Strength modifier, 76-100 attacks the nearest; it cannot tell friend from foe.", [], ["confused"]),
  dazzled: condition("Dazzled", "-1 to attack and to Perception by sight.", [mod("attack", -1), mod("skill.perception", -1)]),
  deafened: condition("Deafened", "-4 initiative and on Perception against another; hears nothing; one spell in five with spoken words fails.", [mod("initiative", -4), mod("skill.perception", -4)], ["deaf"]),
  disabled: condition("Disabled", "At 0 hit points: a move or a standard action a turn, not both, at half speed, besides swift, immediate and free actions; a standard action or anything strenuous then costs 1 hit point.", [HALF_SPEED], ["one_action", "half_speed"]),
  dying: condition("Dying", "Below 0 hit points: unconscious, and at each of its turns a check of d20 + its Constitution modifier + its (negative) hit points against 10 steadies it; failing, it loses 1 hit point.", [], ["no_actions", "helpless"]),
  energy_drained: condition("Drained of Life", "One level drained: -1 to attack, manoeuvres and their defence, saves, skills and ability checks, and -5 hit points; put on once for each level.", [mod("attack", -1), mod("cmd", -1), mod("save", -1), mod("skill", -1), mod("ability_check", -1), mod("hp", -5)]),
  fascinated: condition("Fascinated", "Does nothing but watch; -4 on Perception; any threat ends it.", [mod("skill.perception", -4)], ["no_actions"]),
  grappled: condition("Grappled", "Held: cannot move; -4 Dexterity; -2 to attack and to manoeuvres but grappling and escaping; no two-handed actions; no attacks of opportunity.", [mod("ability.dex", -4), mod("attack", -2)], ["held", "no_aoo"]),
  incorporeal: condition("Incorporeal", "Without a body: takes half harm from magic weapons and spells, and full from force and from other bodiless things."),
  pinned: condition("Pinned", "Held down: cannot move, -4 defence and no Dexterity bonus to it; only words and thought.", [mod("ac", -4), NO_DEX], ["flat", "held"]),
  staggered: condition("Staggered", "At 0 hit points or nonlethal harm equal to its hit points: a move or a standard action a turn, not both, besides swift, immediate and free actions.", [], ["one_action"]),
};

// ---------------------------------------------------------------- weapons and armour

const weaponRows: Record<string, TableRow> = {
  ...CORE_WEAPONS,
  blowgun: weapon("Blowgun", "1", "1d2", 20, 2, 20, "simple", "projectile", ["piercing"]),
  starknife: weapon("Starknife", "1d3", "1d4", 20, 3, 20, "martial", "light", ["piercing"], { finesse: true }),
  elven_curve_blade: weapon("Elven curve blade", "1d8", "1d10", 18, 2, null, "exotic", "two", ["slashing"], { finesse: true }),
  halfling_sling_staff: weapon("Halfling sling staff", "1d6", "1d8", 20, 3, 80, "exotic", "projectile", ["bludgeoning"]),
};

const armorRows: Record<string, TableRow> = {
  padded: armor("Padded armour", "light", 1, 8, 0, 5, armorMods("light", 0)),
  leather: armor("Leather armour", "light", 2, 6, 0, 10, armorMods("light", 0)),
  studded_leather: armor("Studded leather", "light", 3, 5, -1, 15, armorMods("light", -1)),
  chain_shirt: armor("Chain shirt", "light", 4, 4, -2, 20, armorMods("light", -2)),
  hide: armor("Hide armour", "medium", 4, 4, -3, 20, armorMods("medium", -3)),
  scale_mail: armor("Scale mail", "medium", 5, 3, -4, 25, armorMods("medium", -4)),
  chainmail: armor("Chainmail", "medium", 6, 2, -5, 30, armorMods("medium", -5)),
  breastplate: armor("Breastplate", "medium", 6, 3, -4, 25, armorMods("medium", -4)),
  splint_mail: armor("Splint mail", "heavy", 7, 0, -7, 40, armorMods("heavy", -7)),
  banded_mail: armor("Banded mail", "heavy", 7, 1, -6, 35, armorMods("heavy", -6)),
  half_plate: armor("Half-plate", "heavy", 8, 0, -7, 40, armorMods("heavy", -7)),
  full_plate: armor("Full plate", "heavy", 9, 1, -6, 35, armorMods("heavy", -6)),
  buckler: armor("Buckler", "shield", 1, null, -1, 5, shieldMods(-1, "shield_proficiency")),
  light_wooden_shield: armor("Light wooden shield", "shield", 1, null, -1, 5, shieldMods(-1, "shield_proficiency")),
  light_steel_shield: armor("Light steel shield", "shield", 1, null, -1, 5, shieldMods(-1, "shield_proficiency")),
  heavy_wooden_shield: armor("Heavy wooden shield", "shield", 2, null, -2, 15, shieldMods(-2, "shield_proficiency")),
  heavy_steel_shield: armor("Heavy steel shield", "shield", 2, null, -2, 15, shieldMods(-2, "shield_proficiency")),
  tower_shield: armor("Tower shield", "shield", 4, 2, -10, 50, shieldMods(-10, "tower_shield_proficiency", [mod("attack", -2, { note: "the tower shield's bulk" })])),
};

/** A size's special modifier to manoeuvres and their defence: 1 a step from Medium, then 2, 4, 8. */
function manoeuvreSize(steps: number): number {
  return steps === 0 ? 0 : Math.sign(steps) * 2 ** (Math.abs(steps) - 1);
}

// ---------------------------------------------------------------- creatures

const creatureRows: Record<string, TableRow> = {
  wolf: {
    name: "Wolf",
    kind: "person",
    fields: {
      str: 13, dex: 15, con: 15, int: 2, wis: 12, cha: 6,
      racial_hd: 2, hit_dice: 9, hp: 13, natural_armor: 2, base_speed: 50, size: "medium",
      d20_traits: ["animal", "natural_armor", "low_light_vision", "scent", "trip_bite", { id: "skill_focus", choice: "perception" }],
      ranks: { perception: 1, stealth: 1 },
    },
    attacks: [natural("Bite", "1d6", { types: ["bludgeoning", "piercing", "slashing"], held: "two" })],
    cr: "1",
    description: "A grey hunter of the woods that runs in packs and drags its prey down by the leg.",
  },
  goblin: {
    name: "Goblin",
    kind: "person",
    fields: {
      str: 13, dex: 11, con: 12, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 5, hp: 6, base_speed: 30, size: "small",
      d20_traits: ["goblin", "humanoid", "darkvision", "improved_initiative"],
      d20_effects: [wearing("Leather armour and a light wooden shield", [mod("ac", 2, { type: "armor" }), mod("max_dex", 6, { limit: true }), mod("ac", 1, { type: "shield" }), mod("armor_check", -1)])],
      ranks: { ride: 1, stealth: 1 },
    },
    carries: ["short_sword", "shortbow"],
    cr: "1/3",
    description: "A small, sharp-eared raider who fights from ambush and runs when the fight turns.",
  },
  orc: {
    name: "Orc",
    kind: "person",
    fields: {
      str: 13, dex: 9, con: 12, int: 9, wis: 10, cha: 8,
      classes: { warrior: 1 }, hit_dice: 5, hp: 6, base_speed: 30, size: "medium",
      d20_traits: ["orc", "humanoid", "darkvision", "light_sensitivity", "ferocity", { id: "weapon_focus", choice: "falchion" }],
      d20_effects: [wearing("Hide armour", [mod("ac", 4, { type: "armor" }), mod("max_dex", 4, { limit: true }), mod("armor_check", -3), mod("speed", -10)])],
      ranks: { intimidate: 1 },
    },
    carries: ["falchion", "javelin"],
    cr: "1/3",
    description: "A tusked, heavy-shouldered brute who swings a great curved blade in both hands.",
  },
  skeleton: {
    name: "Skeleton",
    kind: "person",
    fields: {
      str: 15, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
      racial_hd: 1, hit_dice: 4, hp: 4, natural_armor: 2, base_speed: 30, size: "medium",
      d20_traits: ["undead", "natural_armor", "skeleton_bones", "darkvision", "improved_initiative", { id: "martial_weapon_proficiency", choice: "scimitar" }],
      d20_effects: [wearing("A broken chain shirt", [mod("ac", 2, { type: "armor" }), mod("max_dex", 4, { limit: true }), mod("armor_check", -4)])],
    },
    attacks: [natural("Claw", "1d4", { types: ["slashing"] }), natural("Claw", "1d4", { types: ["slashing"] })],
    carries: ["scimitar"],
    cr: "1/3",
    description: "Bones of a dead soldier, bound together by magic, doing as it was last told; it does not think.",
  },
  zombie: {
    name: "Zombie",
    kind: "person",
    fields: {
      str: 17, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      racial_hd: 2, hit_dice: 9, hp: 12, natural_armor: 2, base_speed: 30, size: "medium",
      d20_traits: ["undead", "natural_armor", "zombie_flesh", "darkvision", "toughness"],
    },
    attacks: [natural("Slam", "1d6", { types: ["bludgeoning"], held: "two" })],
    cr: "1/2",
    description: "A dead body made to shamble and strike, slow and mindless, that keeps coming until it is cut apart.",
  },
  ogre: {
    name: "Ogre",
    kind: "person",
    fields: {
      str: 21, dex: 8, con: 15, int: 6, wis: 10, cha: 7,
      racial_hd: 4, hit_dice: 18, hp: 30, natural_armor: 5, base_speed: 40, size: "large",
      d20_traits: ["giant", "natural_armor", "darkvision", "low_light_vision", "iron_will", "toughness"],
      d20_effects: [wearing("Hide armour", [mod("ac", 4, { type: "armor" }), mod("max_dex", 4, { limit: true }), mod("armor_check", -3), mod("speed", -10)])],
      ranks: { climb: 2, perception: 2 },
    },
    carries: ["greatclub", "javelin"],
    cr: "3",
    description: "A huge, dull and hungry giant, twice a man's height, who clubs what it wants to eat.",
  },
  bandit: {
    name: "Bandit",
    kind: "person",
    fields: {
      str: 11, dex: 13, con: 11, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 5, hp: 5, base_speed: 30, size: "medium",
      d20_traits: [{ id: "human", choice: "str" }, "humanoid", "point_blank_shot", "stealthy"],
      d20_effects: [wearing("Leather armour", [mod("ac", 2, { type: "armor" }), mod("max_dex", 6, { limit: true })])],
      ranks: { intimidate: 1, climb: 1, stealth: 1 },
    },
    carries: ["short_sword", "shortbow"],
    cr: "1/3",
    description: "A roadside robber with a short blade and a bow, bold in a band and quick to run alone.",
  },
  guard: {
    name: "Guard",
    kind: "person",
    fields: {
      str: 11, dex: 11, con: 12, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 5, hp: 6, base_speed: 30, size: "medium",
      d20_traits: [{ id: "human", choice: "str" }, "humanoid", "alertness", { id: "weapon_focus", choice: "longsword" }],
      d20_effects: [wearing("A chain shirt and a heavy wooden shield", [mod("ac", 4, { type: "armor" }), mod("max_dex", 4, { limit: true }), mod("ac", 2, { type: "shield" }), mod("armor_check", -4)])],
      ranks: { intimidate: 1, ride: 1, perception: 1 },
    },
    carries: ["longsword", "light_crossbow"],
    cr: "1/3",
    description: "A town's or a lord's watchman in mail, with sword, shield and crossbow.",
  },
};

// ---------------------------------------------------------------- experience and challenges

/** The experience a level needs on each of the three tracks: the middle one (`xp`, the set's own), the slow and the fast. */
const XP_TRACKS: readonly [number, number, number][] = [
  [0, 0, 0], [3000, 2000, 1300], [7500, 5000, 3300], [14000, 9000, 6000], [23000, 15000, 10000],
  [35000, 23000, 15000], [53000, 35000, 23000], [77000, 51000, 34000], [115000, 75000, 50000], [160000, 105000, 71000],
  [235000, 155000, 105000], [330000, 220000, 145000], [475000, 315000, 210000], [665000, 445000, 295000], [955000, 635000, 425000],
  [1350000, 890000, 600000], [1900000, 1300000, 850000], [2700000, 1800000, 1200000], [3850000, 2550000, 1700000], [5350000, 3600000, 2400000],
];
const experienceRows = byLevel(20, (l) => {
  const [slow, xp, fast] = XP_TRACKS[l - 1] ?? [0, 0, 0];
  return { xp, slow, fast };
});

/** What overcoming a challenge is worth in all, shared among those who overcame it. */
const CHALLENGE_XP: Readonly<Record<string, number>> = {
  "1/8": 50, "1/6": 65, "1/4": 100, "1/3": 135, "1/2": 200,
  "1": 400, "2": 600, "3": 800, "4": 1200, "5": 1600, "6": 2400, "7": 3200, "8": 4800, "9": 6400, "10": 9600,
  "11": 12800, "12": 19200, "13": 25600, "14": 38400, "15": 51200, "16": 76800, "17": 102400, "18": 153600, "19": 204800, "20": 307200,
  "21": 409600, "22": 614400, "23": 819200, "24": 1228800, "25": 1638400,
};
const challengeRows: Record<string, TableRow> = Object.fromEntries(Object.entries(CHALLENGE_XP).map(([cr, xp]) => [cr, { xp }]));

// ---------------------------------------------------------------- the ruleset's part

const DAILY = {
  rage_rounds: dailyGauge("Rage", "class_level(self, 'barbarian') > 0 ? 4 + mod(self, 'con') + 2 * (class_level(self, 'barbarian') - 1) : 0"),
  bardic_performance: dailyGauge("Performance", "class_level(self, 'bard') > 0 ? 4 + mod(self, 'cha') + 2 * (class_level(self, 'bard') - 1) : 0"),
  channel_energy: dailyGauge("Channel", "class_level(self, 'cleric') > 0 ? max(0, 3 + mod(self, 'cha')) : 0"),
  wild_shape: dailyGauge("Wild shape", "class_level(self, 'druid') >= 4 ? floor((class_level(self, 'druid') - 2) / 2) : 0"),
  smite: dailyGauge("Smite", "class_level(self, 'paladin') > 0 ? 1 + floor((class_level(self, 'paladin') - 1) / 3) : 0"),
  lay_on_hands: dailyGauge("Lay on hands", "class_level(self, 'paladin') >= 2 ? max(0, floor(class_level(self, 'paladin') / 2) + mod(self, 'cha')) : 0"),
  ki_pool: dailyGauge("Ki", "class_level(self, 'monk') >= 4 ? max(0, floor(class_level(self, 'monk') / 2) + mod(self, 'wis')) : 0"),
  stunning_fist: dailyGauge("Stunning fist", "has_trait(self, 'stunning_fist') ? max(class_level(self, 'monk'), floor((levels(self) + self.racial_hd) / 4)) : 0"),
};

/** A night's rest, and an hour's for nonlethal harm: one hit point for each hit die. */
const PER_DIE = "max(1, levels(self) + self.racial_hd)";
const UNDEAD = "has_trait(self, 'undead')";
/** Below 0 and above the floor, for the living: the undead are destroyed at 0. */
const NEGATIVE = `self.hp < 0 and self.hp > -score(self, 'con') and not ${UNDEAD}`;
const STEADY = "(under(self, 'stable') or has_trait(self, 'diehard'))";

const family = familyTotals({ skills: T.skills, weapons: T.weapons });

const D20: D20Def = {
  abilities: [...D20_ABILITY_IDS],
  mod: ABILITY_MOD,
  kinds: ["person"],
  defaultSize: "medium",
  bonuses: { stack: ["dodge", "circumstance"], penaltiesStack: true },
  tables: { ...T },
  totals: {
    ...family,
    // A class skill with a rank in it has +3.
    skill: `${family.skill} + (class_skill(self, skill) and ranks(self, skill) >= 1 ? 3 : 0)`,
    // A manoeuvre's bonus: base attack, Strength (Dexterity for the tiny), the size's own, and what modifies a melee attack.
    cmb: "class_sum(self, 'attack') + bonus(self, 'base_attack') + mod(self, size_mod(self, 'cmb') <= -2 ? 'dex' : 'str') + size_mod(self, 'cmb') + bonus_without(self, 'cmb,attack.melee.maneuver', 'size')",
    // A manoeuvre's defence: 10, base attack, Strength and Dexterity, the size's own, and the bonuses to defence that are not armour, shield, natural or size.
    cmd: "10 + class_sum(self, 'attack') + bonus(self, 'base_attack') + mod(self, 'str') + mod(self, 'dex') - max(0, mod(self, 'dex') - limit(self, 'max_dex', 99)) + size_mod(self, 'cmd') + bonus_only(self, 'ac,ac.melee', 'circumstance,deflection,dodge,insight,luck,morale,profane,sacred,untyped') + bonus_without(self, 'cmd', 'size')",
  },
  check: { take: { "10": { value: 10, times: 1 }, "20": { value: 20, times: 20 } }, aid: { dc: 10, bonus: 2 } },
  save: { autoFail: 1, autoSucceed: 20 },
  attack: {
    autoMiss: 1,
    autoHit: 20,
    confirm: true,
    strength: "str",
    strengthShare: { light: 1, one: 1, two: 1.5, off: 0.5, thrown: 1, projectile: 0 },
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
      { id: "dead", when: `self.hp <= -score(self, 'con') or (${UNDEAD} and self.hp <= 0)`, life: "dead" },
      { id: "stable", when: `${NEGATIVE} and ${STEADY}`, life: "alive" },
      { id: "dying", when: `${NEGATIVE} and not ${STEADY}`, life: "dying" },
      { id: "unconscious", when: `(${NEGATIVE} and not has_trait(self, 'diehard')) or (self.hp >= 0 and self.nonlethal > self.hp)` },
      { id: "disabled", when: `self.hp == 0 or (${NEGATIVE} and has_trait(self, 'diehard'))` },
      { id: "staggered", when: `(self.hp == 0 and not ${UNDEAD}) or (self.hp > 0 and self.nonlethal == self.hp)` },
    ],
    dying: {
      state: "dying",
      lose: 1,
      stable: "stable",
      roll: { id: "stabilize", dice: "d20", modifier: "mod(self, 'con') + self.hp", dc: "10", bands: [{ outcome: "stable", natural: { min: 20 } }, { outcome: "stable", margin: { min: 0 } }, { outcome: "worse" }], pass: ["stable"] },
    },
    // Massive harm is an optional rule of this revision, off as shipped.
    massive: null,
    rest: { hours: 8, hp: PER_DIE, nonlethal: PER_DIE, daily: Object.keys(DAILY) },
  },
  costs: D20_COSTS,
  levels: {
    progression: "level",
    hitPoints: "roll",
    average: "floor(die / 2) + 1",
    firstMost: true,
    rankLimit: "levels(self) + self.racial_hd",
    skillPoints: { plus: "mod(self, 'int') + bonus(self, 'skill_points')", min: 1, first: 1 },
    featEvery: 2,
    featAt: "level % 2 == 1",
    abilityEvery: 4,
    experienceBy: "challenge",
  },
};

const SAVES = [
  { id: "fort", label: "Fortitude" },
  { id: "ref", label: "Reflex" },
  { id: "will", label: "Will" },
];

export const CLASSIC_REVISED: D20SetDef = {
  id: "classic_revised",
  label: "Classic Revised",
  summary:
    "The later revision of the Classic rules: a shorter skill list with a bonus for trained class skills, one bonus and one defence for every combat manoeuvre, hit points down to minus the Constitution score with a check to steady the dying, a feat at every odd level, favoured classes, and three experience tracks.",
  fields: d20Fields({ hpFloor: "-score(self, 'con')", rest: PER_DIE, sizes: T.sizes, daily: DAILY }),
  checks: {},
  actions: {},
  tables: {
    [T.skills]: d20Table("skills", T.skills, "Classic Revised skills", skillRows),
    [T.classes]: d20Table("classes", T.classes, "Classic Revised classes", classRows),
    [T.tracks]: d20Table("tracks", T.tracks, "Classic Revised progressions", TRACK_ROWS, TRACK_COLUMNS),
    [T.traits]: d20Table("traits", T.traits, "Classic Revised traits", traitRows),
    [T.conditions]: d20Table("conditions", T.conditions, "Classic Revised conditions", conditionRows),
    [T.sizes]: d20Table(
      "sizes",
      T.sizes,
      "Classic Revised sizes",
      sizeRows((steps) => [mod("cmb", manoeuvreSize(steps), { type: "size" }), mod("cmd", manoeuvreSize(steps), { type: "size" }), mod("skill.stealth", steps * -4, { type: "size" }), mod("skill.fly", steps * -2, { type: "size" })]),
      SIZE_COLUMNS,
    ),
    [T.weapons]: d20Table("weapons", T.weapons, "Classic Revised weapons", weaponRows, WEAPON_COLUMNS),
    [T.armor]: d20Table("armor", T.armor, "Classic Revised armour and shields", armorRows, ARMOR_COLUMNS),
    [T.creatures]: d20Table("creatures", T.creatures, "Classic Revised creatures", creatureRows),
    [T.experience]: d20Table("experience", T.experience, "Classic Revised experience", experienceRows, { slow: { type: "int", doc: "The slow track" }, fast: { type: "int", doc: "The fast track" } }),
    [T.challenges]: d20Table("challenges", T.challenges, "Classic Revised challenges", challengeRows),
    [T.difficulties]: d20Table("difficulties", T.difficulties, "Classic Revised difficulties", DIFFICULTIES),
  },
  ruleset: {
    // The middle track; a world takes the slow or the fast one by naming its column here.
    progression: { level: { label: "Level", xpField: "xp", levelField: "level", thresholds: { table: T.experience, column: "xp" }, maxLevel: 20 } },
    sheet: d20Sheet({
      defence: {
        label: "Defence",
        rows: [
          { formula: "total(self, 'ac')", label: "Armour Class" },
          { formula: "total(self, 'ac.touch')", label: "Against a touch" },
          { formula: "total(self, 'ac.flat')", label: "Flat-footed" },
          { formula: "total(self, 'cmd')", label: "Manoeuvre defence" },
          { formula: signedTotal("initiative"), label: "Initiative" },
          { formula: "total(self, 'speed')", label: "Speed" },
        ],
      },
      attack: [
        { formula: signedTotal("attack.base"), label: "Base attack" },
        { formula: signedTotal("attack.melee"), label: "Melee" },
        { formula: signedTotal("attack.ranged"), label: "Ranged" },
        { formula: signedTotal("cmb"), label: "Manoeuvre bonus" },
      ],
      saves: SAVES,
      skills: SKILLS.map(([id, label]) => ({ id, label })),
      daily: Object.keys(DAILY),
    }),
    minLevels: {},
    adjudication: presetAdjudication("balanced"),
    combat: d20Combat("under(self, 'unconscious') or under(self, 'dead')"),
    d20: D20,
  },
};
