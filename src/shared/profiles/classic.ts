// The Classic rule set (RULESET-DESIGN §6): classic fantasy on a d20, with eleven classes, typed bonuses, defence read whole,
// touch or flat-footed, weapons and armour with their own numbers, hit points down through dying to dead, and experience by
// challenge. A world fragment the profile machinery applies; after that it is plain world data a user grows row by row, and the
// tabletop rules layer (the `d20` pack) works every check, attack and harm out of it. An original implementation of common
// tabletop mechanics: no rules text.

import { presetAdjudication } from "../adjudication";
import type { JsonObject } from "../json";
import type { TableRow } from "../tables";
import type { D20Def } from "../d20";
import { ABILITY_MOD, ARMOR_COLUMNS, armor, byLevel, condition, D20_ABILITY_IDS, D20_COSTS, d20Combat, d20Fields, d20Sheet, d20Table, dailyGauge, difficulty, familyTotals, features, mod, natural, SIZE_COLUMNS, SKILL_COLUMNS, signedTotal, sizeRows, trait, WEAPON_COLUMNS, weapon, type D20SetDef } from "./d20-common";

const T = {
  skills: "classic.skills",
  classes: "classic.classes",
  tracks: "classic.tracks",
  traits: "classic.traits",
  conditions: "classic.conditions",
  sizes: "classic.sizes",
  weapons: "classic.weapons",
  armor: "classic.armor",
  creatures: "classic.creatures",
  experience: "classic.experience",
  challenges: "classic.challenges",
  difficulties: "classic.difficulties",
} as const;

// ---------------------------------------------------------------- skills

/** Each skill: its label, key ability, whether only the trained use it, and how many times armour's check penalty falls on it. */
const SKILLS: readonly [string, string, string, boolean, number][] = [
  ["appraise", "Appraise", "int", false, 0],
  ["balance", "Balance", "dex", false, 1],
  ["bluff", "Deceive", "cha", false, 0],
  ["climb", "Climb", "str", false, 1],
  ["concentration", "Concentration", "con", false, 0],
  ["craft", "Craft", "int", false, 0],
  ["decipher_script", "Decipher Writing", "int", true, 0],
  ["diplomacy", "Persuade", "cha", false, 0],
  ["disable_device", "Disable Devices", "int", true, 0],
  ["disguise", "Disguise", "cha", false, 0],
  ["escape_artist", "Slip Free", "dex", false, 1],
  ["forgery", "Forgery", "int", false, 0],
  ["gather_information", "Gather Rumours", "cha", false, 0],
  ["handle_animal", "Handle Animals", "cha", true, 0],
  ["heal", "First Aid", "wis", false, 0],
  ["hide", "Hide", "dex", false, 1],
  ["intimidate", "Intimidate", "cha", false, 0],
  ["jump", "Jump", "str", false, 1],
  ["knowledge_arcana", "Lore (arcane)", "int", true, 0],
  ["knowledge_architecture", "Lore (building)", "int", true, 0],
  ["knowledge_dungeoneering", "Lore (underground)", "int", true, 0],
  ["knowledge_geography", "Lore (lands)", "int", true, 0],
  ["knowledge_history", "Lore (history)", "int", true, 0],
  ["knowledge_local", "Lore (local)", "int", true, 0],
  ["knowledge_nature", "Lore (nature)", "int", true, 0],
  ["knowledge_nobility", "Lore (nobility)", "int", true, 0],
  ["knowledge_religion", "Lore (religion)", "int", true, 0],
  ["knowledge_planes", "Lore (other planes)", "int", true, 0],
  ["listen", "Listen", "wis", false, 0],
  ["move_silently", "Move Quietly", "dex", false, 1],
  ["open_lock", "Pick Locks", "dex", true, 0],
  ["perform", "Perform", "cha", false, 0],
  ["profession", "Profession", "wis", true, 0],
  ["ride", "Ride", "dex", false, 0],
  ["search", "Search", "int", false, 0],
  ["sense_motive", "Read People", "wis", false, 0],
  ["sleight_of_hand", "Deft Hands", "dex", true, 1],
  ["speak_language", "Languages", "int", true, 0],
  ["spellcraft", "Spell Lore", "int", true, 0],
  ["spot", "Spot", "wis", false, 0],
  ["survival", "Survival", "wis", false, 0],
  ["swim", "Swim", "str", false, 2],
  ["tumble", "Tumble", "dex", true, 1],
  ["use_magic_device", "Use Magic Items", "cha", true, 0],
  ["use_rope", "Rope Work", "dex", false, 0],
];

const skillRows: Record<string, TableRow> = {};
for (const [id, label, ability, trained, times] of SKILLS) skillRows[id] = { label, ability, ...(trained ? { trained } : {}), ...(times > 0 ? { armor: true } : {}), ...(times > 1 ? { armor_times: times } : {}) };

const LORE = SKILLS.map(([id]) => id).filter((id) => id.startsWith("knowledge_"));

// ---------------------------------------------------------------- tracks and classes

/** The progressions by level: base attack at the full, three-quarter and half rate; a good and a poor save. */
const trackRows = byLevel(20, (l) => ({ attack_good: l, attack_average: Math.floor((l * 3) / 4), attack_poor: Math.floor(l / 2), save_good: 2 + Math.floor(l / 2), save_poor: Math.floor(l / 3) }));

function tracks(attack: "good" | "average" | "poor", fort: "good" | "poor", ref: "good" | "poor", will: "good" | "poor"): JsonObject {
  return { attack: `attack_${attack}`, fort: `save_${fort}`, ref: `save_${ref}`, will: `save_${will}` };
}

const classRows: Record<string, TableRow> = {
  barbarian: {
    label: "Barbarian",
    hit_die: 12,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 4,
    class_skills: ["climb", "craft", "handle_animal", "intimidate", "jump", "listen", "ride", "survival", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "shield_proficiency", "fast_movement", "illiteracy", "rage"], 2: ["uncanny_dodge"], 3: ["trap_sense"], 5: ["improved_uncanny_dodge"], 7: ["barbarian_reduction"], 11: ["greater_rage"], 14: ["indomitable_will"], 17: ["tireless_rage"], 20: ["mighty_rage"] }),
  },
  bard: {
    label: "Bard",
    hit_die: 6,
    tracks: tracks("average", "poor", "good", "good"),
    skill_points: 6,
    class_skills: ["appraise", "balance", "bluff", "climb", "concentration", "craft", "decipher_script", "diplomacy", "disguise", "escape_artist", "gather_information", "hide", "jump", ...LORE, "listen", "move_silently", "perform", "profession", "sense_motive", "sleight_of_hand", "speak_language", "spellcraft", "swim", "tumble", "use_magic_device"],
    proficiency: ["simple", "longsword", "rapier", "sap", "short_sword", "shortbow", "whip"],
    features: features({ 1: ["armor_light", "shield_proficiency", "bardic_music", "bardic_knowledge"] }),
  },
  cleric: {
    label: "Cleric",
    hit_die: 8,
    tracks: tracks("average", "good", "poor", "good"),
    skill_points: 2,
    class_skills: ["concentration", "craft", "diplomacy", "heal", "knowledge_arcana", "knowledge_history", "knowledge_religion", "knowledge_planes", "profession", "spellcraft"],
    proficiency: ["simple"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency", "turn_undead"] }),
  },
  druid: {
    label: "Druid",
    hit_die: 8,
    tracks: tracks("average", "good", "poor", "good"),
    skill_points: 4,
    class_skills: ["concentration", "craft", "diplomacy", "handle_animal", "heal", "knowledge_nature", "listen", "profession", "ride", "spellcraft", "spot", "survival", "swim"],
    proficiency: ["club", "dagger", "dart", "quarterstaff", "scimitar", "sickle", "shortspear", "sling", "spear", "unarmed_strike"],
    features: features({ 1: ["armor_light", "armor_medium", "shield_proficiency", "animal_companion", "nature_sense", "wild_empathy"], 2: ["woodland_stride"], 3: ["trackless_step"], 4: ["resist_natures_lure"], 5: ["wild_shape"], 9: ["venom_immunity"], 13: ["a_thousand_faces"], 15: ["timeless_body"] }),
  },
  fighter: {
    label: "Fighter",
    hit_die: 10,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 2,
    class_skills: ["climb", "craft", "handle_animal", "intimidate", "jump", "ride", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency", "tower_shield_proficiency", "fighter_bonus_feat"] }),
  },
  monk: {
    label: "Monk",
    hit_die: 8,
    tracks: tracks("average", "good", "good", "good"),
    skill_points: 4,
    class_skills: ["balance", "climb", "concentration", "craft", "diplomacy", "escape_artist", "hide", "jump", "knowledge_arcana", "knowledge_religion", "listen", "move_silently", "perform", "profession", "sense_motive", "spot", "swim", "tumble"],
    proficiency: ["club", "light_crossbow", "heavy_crossbow", "dagger", "handaxe", "javelin", "kama", "nunchaku", "quarterstaff", "sai", "shuriken", "siangham", "sling", "unarmed_strike"],
    features: features({ 1: ["improved_unarmed_strike", "flurry_of_blows", "monk_unarmed", "monk_ac", "monk_bonus_feat"], 2: ["evasion"], 3: ["still_mind", "monk_speed"], 4: ["ki_strike", "slow_fall"], 5: ["purity_of_body"], 7: ["wholeness_of_body"], 9: ["improved_evasion"], 11: ["diamond_body"], 12: ["abundant_step"], 13: ["diamond_soul"], 15: ["quivering_palm"], 17: ["timeless_body"], 19: ["empty_body"], 20: ["perfect_self"] }),
  },
  paladin: {
    label: "Paladin",
    hit_die: 10,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 2,
    class_skills: ["concentration", "craft", "diplomacy", "handle_animal", "heal", "knowledge_nobility", "knowledge_religion", "profession", "ride", "sense_motive"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency", "aura_of_good", "detect_evil", "smite_evil"], 2: ["divine_grace", "lay_on_hands"], 3: ["aura_of_courage", "divine_health"], 4: ["turn_undead"], 5: ["special_mount"], 6: ["remove_disease"] }),
  },
  ranger: {
    label: "Ranger",
    hit_die: 8,
    tracks: tracks("good", "good", "good", "poor"),
    skill_points: 6,
    class_skills: ["climb", "concentration", "craft", "handle_animal", "heal", "hide", "jump", "knowledge_dungeoneering", "knowledge_geography", "knowledge_nature", "listen", "move_silently", "profession", "ride", "search", "spot", "survival", "swim", "use_rope"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "shield_proficiency", "favored_enemy", "track", "wild_empathy"], 2: ["combat_style"], 3: ["endurance"], 4: ["animal_companion"], 6: ["improved_combat_style"], 7: ["woodland_stride"], 8: ["swift_tracker"], 9: ["evasion"], 11: ["combat_style_mastery"], 13: ["camouflage"], 17: ["hide_in_plain_sight"] }),
  },
  rogue: {
    label: "Rogue",
    hit_die: 6,
    tracks: tracks("average", "poor", "good", "poor"),
    skill_points: 8,
    class_skills: ["appraise", "balance", "bluff", "climb", "craft", "decipher_script", "diplomacy", "disable_device", "disguise", "escape_artist", "forgery", "gather_information", "hide", "intimidate", "jump", "knowledge_local", "listen", "move_silently", "open_lock", "perform", "profession", "search", "sense_motive", "sleight_of_hand", "spot", "swim", "tumble", "use_magic_device", "use_rope"],
    proficiency: ["simple", "hand_crossbow", "rapier", "sap", "shortbow", "short_sword"],
    features: features({ 1: ["armor_light", "sneak_attack", "trapfinding"], 2: ["evasion"], 3: ["trap_sense"], 4: ["uncanny_dodge"], 8: ["improved_uncanny_dodge"], 10: ["rogue_special"] }),
  },
  sorcerer: {
    label: "Sorcerer",
    hit_die: 4,
    tracks: tracks("poor", "poor", "poor", "good"),
    skill_points: 2,
    class_skills: ["bluff", "concentration", "craft", "knowledge_arcana", "profession", "spellcraft"],
    proficiency: ["simple"],
    features: features({ 1: ["familiar"] }),
  },
  wizard: {
    label: "Wizard",
    hit_die: 4,
    tracks: tracks("poor", "poor", "poor", "good"),
    skill_points: 2,
    class_skills: ["concentration", "craft", "decipher_script", ...LORE, "profession", "spellcraft"],
    proficiency: ["club", "dagger", "heavy_crossbow", "light_crossbow", "quarterstaff", "unarmed_strike"],
    features: features({ 1: ["familiar", "scribe_scroll"], 5: ["wizard_bonus_feat"] }),
  },
  warrior: {
    label: "Warrior",
    hit_die: 8,
    tracks: tracks("good", "good", "poor", "poor"),
    skill_points: 2,
    class_skills: ["climb", "handle_animal", "intimidate", "jump", "ride", "swim"],
    proficiency: ["simple", "martial"],
    features: features({ 1: ["armor_light", "armor_medium", "armor_heavy", "shield_proficiency"] }),
  },
};

// ---------------------------------------------------------------- traits: feats, races, creature types, class features

const BASE = "total(self, 'attack.base')";
const UNARMOURED = "limit(self, 'armor_weight', 0) + limit(self, 'shield_worn', 0) == 0";
const OWN_HD = "self.racial_hd > 0";

/** Skill bonuses of one size to several skills. */
function skillsMod(value: number, skills: string[], type?: string): JsonObject[] {
  return skills.map((s) => mod(`skill.${s}`, value, type !== undefined ? { type } : {}));
}

/** The base attack and saves a creature's own hit dice give by its type: attack at a rate, each save good or poor. */
function creatureType(label: string, text: string, attackRate: "3 / 4" | "1 / 2", good: string[], grants?: JsonObject): TableRow {
  const modifiers = [mod("base_attack", `floor(self.racial_hd * ${attackRate})`, { note: "from its own hit dice" })];
  for (const save of ["fort", "ref", "will"]) modifiers.push(mod(`save.${save}`, good.includes(save) ? "2 + floor(self.racial_hd / 2)" : "floor(self.racial_hd / 3)", { when: OWN_HD, note: "base, from its own hit dice" }));
  return trait(label, "creature type", text, { modifiers, ...(grants !== undefined ? { grants } : {}) });
}

const traitRows: Record<string, TableRow> = {
  // Training with gear.
  armor_light: trait("Light Armour Training", "feat", "Light armour's check penalty does not fall on the wearer's attacks."),
  armor_medium: trait("Medium Armour Training", "feat", "Medium armour's check penalty does not fall on the wearer's attacks.", { requires: "has_trait(self, 'armor_light')" }),
  armor_heavy: trait("Heavy Armour Training", "feat", "Heavy armour's check penalty does not fall on the wearer's attacks.", { requires: "has_trait(self, 'armor_medium')" }),
  shield_proficiency: trait("Shield Training", "feat", "A shield's check penalty does not fall on its bearer's attacks."),
  tower_shield_proficiency: trait("Tower Shield Training", "feat", "A tower shield's check penalty does not fall on its bearer's attacks.", { requires: "has_trait(self, 'shield_proficiency')" }),
  simple_weapon_proficiency: trait("Simple Weapons", "feat", "No -4 to attack with a simple weapon.", { grants: { proficiency: ["simple"] } }),
  martial_weapon_proficiency: trait("Martial Weapon", "feat", "No -4 to attack with the martial weapon taken as its choice."),
  exotic_weapon_proficiency: trait("Exotic Weapon", "feat", "No -4 to attack with the exotic weapon taken as its choice.", { requires: `${BASE} >= 1` }),

  // Feats.
  acrobatic: trait("Acrobatic", "feat", "+2 Jump and Tumble.", { modifiers: skillsMod(2, ["jump", "tumble"]) }),
  agile: trait("Agile", "feat", "+2 Balance and Slip Free.", { modifiers: skillsMod(2, ["balance", "escape_artist"]) }),
  alertness: trait("Alert", "feat", "+2 Listen and Spot.", { modifiers: skillsMod(2, ["listen", "spot"]) }),
  animal_affinity: trait("Way with Animals", "feat", "+2 Handle Animals and Ride.", { modifiers: skillsMod(2, ["handle_animal", "ride"]) }),
  athletic: trait("Athletic", "feat", "+2 Climb and Swim.", { modifiers: skillsMod(2, ["climb", "swim"]) }),
  cleave: trait("Follow-Through", "feat", "Once a round, dropping a foe in melee gives one more melee attack, at the same bonus, at another foe within reach.", { requires: "score(self, 'str') >= 13 and has_trait(self, 'power_attack')" }),
  combat_casting: trait("Steady Casting", "feat", "+4 on Concentration to cast on the defensive or while held."),
  combat_expertise: trait("Guarded Fighting", "feat", "Before attacking, it may take up to 5 (no more than its base attack) off its melee attacks and add as much dodge to defence until its next turn: name both as the attack's modifiers.", { requires: "score(self, 'int') >= 13" }),
  combat_reflexes: trait("Quick Reflexes", "feat", "As many more attacks of opportunity a round as its Dexterity modifier, and it makes them while flat-footed."),
  deceitful: trait("Deceitful", "feat", "+2 Disguise and Forgery.", { modifiers: skillsMod(2, ["disguise", "forgery"]) }),
  deft_hands: trait("Nimble Hands", "feat", "+2 Deft Hands and Rope Work.", { modifiers: skillsMod(2, ["sleight_of_hand", "use_rope"]) }),
  diehard: trait("Hard to Kill", "feat", "Below 0 hit points it is stable at once, and it may act as one disabled instead of falling unconscious.", { requires: "has_trait(self, 'endurance')" }),
  diligent: trait("Diligent", "feat", "+2 Appraise and Decipher Writing.", { modifiers: skillsMod(2, ["appraise", "decipher_script"]) }),
  dodge: trait("Dodge", "feat", "+1 dodge to defence against the one foe it names each turn.", { modifiers: [mod("ac", 1, { type: "dodge", note: "against the foe it names" })], requires: "score(self, 'dex') >= 13" }),
  endurance: trait("Endurance", "feat", "+4 on checks and saves against tiring: swimming, running, holding its breath, hunger, thirst, heat and cold."),
  far_shot: trait("Long Shot", "feat", "A projectile weapon's range increment is half again as long, a thrown weapon's twice as long.", { requires: "has_trait(self, 'point_blank_shot')" }),
  great_fortitude: trait("Hardy", "feat", "+2 Fortitude.", { modifiers: [mod("save.fort", 2)] }),
  greater_weapon_focus: trait("Favoured Weapon, Greater", "feat", "+1 more to attack with the weapon taken as its choice.", { modifiers: [mod("attack.weapon.{choice}", 1)], requires: "class_level(self, 'fighter') >= 8" }),
  improved_critical: trait("Keen Strikes", "feat", "The weapon taken as its choice threatens on twice as many numbers of the die (19-20 becomes 17-20): the GM names the wider range.", { requires: `${BASE} >= 8` }),
  improved_grapple: trait("Wrestler", "feat", "+4 to grapple, and taking hold of a foe gives it no attack of opportunity.", { modifiers: [mod("grapple", 4)], requires: "score(self, 'dex') >= 13 and has_trait(self, 'improved_unarmed_strike')" }),
  improved_initiative: trait("Quick Start", "feat", "+4 initiative.", { modifiers: [mod("initiative", 4)] }),
  improved_unarmed_strike: trait("Trained Fists", "feat", "Its bare hands count as armed: striking with them gives no attack of opportunity, and their harm may be lethal with no -4."),
  investigator: trait("Investigator", "feat", "+2 Gather Rumours and Search.", { modifiers: skillsMod(2, ["gather_information", "search"]) }),
  iron_will: trait("Strong-Willed", "feat", "+2 Will.", { modifiers: [mod("save.will", 2)] }),
  lightning_reflexes: trait("Quick to React", "feat", "+2 Reflex.", { modifiers: [mod("save.ref", 2)] }),
  magical_aptitude: trait("Magic Knack", "feat", "+2 Spell Lore and Use Magic Items.", { modifiers: skillsMod(2, ["spellcraft", "use_magic_device"]) }),
  mobility: trait("Mobile", "feat", "+4 dodge to defence against attacks of opportunity for moving.", { requires: "has_trait(self, 'dodge')" }),
  negotiator: trait("Negotiator", "feat", "+2 Persuade and Read People.", { modifiers: skillsMod(2, ["diplomacy", "sense_motive"]) }),
  nimble_fingers: trait("Light Fingers", "feat", "+2 Disable Devices and Pick Locks.", { modifiers: skillsMod(2, ["disable_device", "open_lock"]) }),
  persuasive: trait("Silver Tongue", "feat", "+2 Deceive and Intimidate.", { modifiers: skillsMod(2, ["bluff", "intimidate"]) }),
  point_blank_shot: trait("Close Shot", "feat", "+1 to attack and damage with a ranged weapon at 30 feet or nearer: name both as the attack's modifiers."),
  power_attack: trait("Heavy Blows", "feat", "Before attacking, it may take up to its base attack off its melee attacks and add as much to damage (twice as much with a weapon in both hands, none with a light one): name both as the attack's modifiers.", { requires: "score(self, 'str') >= 13" }),
  precise_shot: trait("Precise Shot", "feat", "No -4 for shooting at a foe in melee with an ally.", { requires: "has_trait(self, 'point_blank_shot')" }),
  quick_draw: trait("Quick Draw", "feat", "Draws a weapon as a free action.", { requires: `${BASE} >= 1` }),
  rapid_shot: trait("Rapid Shot", "feat", "With all its attacks, one more ranged attack at its highest bonus, and -2 on every one of them that round.", { requires: "score(self, 'dex') >= 13 and has_trait(self, 'point_blank_shot')" }),
  run: trait("Runner", "feat", "Runs five times its speed (four times in heavy armour)."),
  self_sufficient: trait("Self-Reliant", "feat", "+2 First Aid and Survival.", { modifiers: skillsMod(2, ["heal", "survival"]) }),
  skill_focus: trait("Specialist", "feat", "+3 on the skill taken as its choice.", { modifiers: [mod("skill.{choice}", 3)] }),
  spell_focus: trait("School Focus", "feat", "+1 to the difficulty of saves against its spells of the kind taken as its choice."),
  stealthy: trait("Stealthy", "feat", "+2 Hide and Move Quietly.", { modifiers: skillsMod(2, ["hide", "move_silently"]) }),
  toughness: trait("Tough", "feat", "+3 hit points.", { modifiers: [mod("hp", 3)] }),
  track: trait("Tracker", "feat", "Follows tracks with Survival."),
  two_weapon_fighting: trait("Two Weapons", "feat", "Fighting with a weapon in each hand costs -4 on each (-2 if the off-hand weapon is light), not -6 and -10 (-4 and -8): name them as the attacks' modifiers.", { requires: "score(self, 'dex') >= 15" }),
  weapon_finesse: trait("Finesse", "feat", "With a light weapon, a rapier, a whip or a spiked chain, Dexterity stands for Strength on the attack roll.", { modifiers: [mod("attack.finesse", "max(0, mod(self, 'dex') - mod(self, 'str'))", { note: "Dexterity for Strength" })], requires: `${BASE} >= 1` }),
  weapon_focus: trait("Favoured Weapon", "feat", "+1 to attack with the weapon taken as its choice.", { modifiers: [mod("attack.weapon.{choice}", 1)], requires: `${BASE} >= 1` }),
  weapon_specialization: trait("Weapon Mastery", "feat", "+2 to damage with the weapon taken as its choice.", { modifiers: [mod("damage.weapon.{choice}", 2)], requires: "class_level(self, 'fighter') >= 4" }),

  // Races.
  human: trait("Human", "race", "Medium, speed 30. One more skill point each level (four more at the first) and one more feat at the first level.", { modifiers: [mod("skill_points", 1, { note: "one more each level" })] }),
  dwarf: trait("Dwarf", "race", "Medium, speed 20, not slowed by armour. +2 Constitution, -2 Charisma; sees 60 feet in the dark; +2 on saves against poison and spells; +4 to stand against being pushed or tripped; +1 to attack orcs and goblins; +4 dodge against giants; +2 to appraise or craft stone and metal.", {
    modifiers: [mod("ability.con", 2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" })],
    grants: { proficiency: ["dwarven_waraxe", "dwarven_urgrosh"] },
  }),
  elf: trait("Elf", "race", "Medium, speed 30. +2 Dexterity, -2 Constitution; +2 Listen, Search and Spot; +2 on saves against charms, and no magic puts it to sleep; sees far in dim light; trained with longsword, rapier and bows.", {
    modifiers: [mod("ability.dex", 2, { type: "racial" }), mod("ability.con", -2, { type: "racial" }), ...skillsMod(2, ["listen", "search", "spot"], "racial")],
    grants: { proficiency: ["longsword", "rapier", "longbow", "composite_longbow", "shortbow", "composite_shortbow"] },
  }),
  gnome: trait("Gnome", "race", "Small, speed 20. +2 Constitution, -2 Strength; +2 Listen; +2 on saves against illusions; +1 to attack goblins and kobolds; +4 dodge against giants; sees far in dim light.", {
    modifiers: [mod("ability.con", 2, { type: "racial" }), mod("ability.str", -2, { type: "racial" }), mod("skill.listen", 2, { type: "racial" })],
    grants: { proficiency: ["gnome_hooked_hammer"] },
  }),
  half_elf: trait("Half-Elf", "race", "Medium, speed 30. +1 Listen, Search and Spot; +2 Persuade and Gather Rumours; +2 on saves against charms, and no magic puts it to sleep; sees far in dim light.", {
    modifiers: [...skillsMod(1, ["listen", "search", "spot"], "racial"), ...skillsMod(2, ["diplomacy", "gather_information"], "racial")],
  }),
  half_orc: trait("Half-Orc", "race", "Medium, speed 30. +2 Strength, -2 Intelligence, -2 Charisma; sees 60 feet in the dark.", {
    modifiers: [mod("ability.str", 2, { type: "racial" }), mod("ability.int", -2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" })],
  }),
  halfling: trait("Halfling", "race", "Small, speed 20. +2 Dexterity, -2 Strength; +2 Climb, Jump, Listen and Move Quietly; +1 on every save, and +2 more against fear; +1 to attack with a thrown weapon or a sling.", {
    modifiers: [mod("ability.dex", 2, { type: "racial" }), mod("ability.str", -2, { type: "racial" }), ...skillsMod(2, ["climb", "jump", "listen", "move_silently"], "racial"), mod("save", 1, { type: "racial" })],
  }),
  goblin: trait("Goblin", "race", "Small, speed 30. +2 Dexterity, -2 Strength, -2 Charisma; +4 Move Quietly and Ride; sees 60 feet in the dark.", {
    modifiers: [mod("ability.dex", 2, { type: "racial" }), mod("ability.str", -2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" }), ...skillsMod(4, ["move_silently", "ride"], "racial")],
  }),
  orc: trait("Orc", "race", "Medium, speed 30. +4 Strength, -2 Intelligence, -2 Wisdom, -2 Charisma; sees 60 feet in the dark; dazzled in bright sunlight.", {
    modifiers: [mod("ability.str", 4, { type: "racial" }), mod("ability.int", -2, { type: "racial" }), mod("ability.wis", -2, { type: "racial" }), mod("ability.cha", -2, { type: "racial" })],
  }),

  // Creature types and qualities: what a creature's own hit dice give, and what its body does.
  animal: creatureType("Animal", "A beast: each of its own hit dice is a d8; they give three quarters of themselves in base attack, a good Fortitude and Reflex and a poor Will.", "3 / 4", ["fort", "ref"]),
  humanoid: creatureType("Humanoid", "A person of some people: its own hit dice (d8s), if any, give three quarters in base attack, a good Reflex; trained with simple weapons.", "3 / 4", ["ref"], { proficiency: ["simple"] }),
  giant: creatureType("Giant", "A giant: each of its own hit dice is a d8; they give three quarters in base attack and a good Fortitude; trained with simple and martial weapons.", "3 / 4", ["fort"], { proficiency: ["simple", "martial"] }),
  undead: creatureType("Undead", "Dead and moving: each of its own hit dice is a d12 and gains nothing from Constitution, which it lacks (its score reads 10); they give half in base attack and a good Will. Critical hits, poison, sleep, paralysis, stunning, disease and anything that works on a mind do it nothing; trained with simple weapons.", "1 / 2", ["will"], { proficiency: ["simple"] }),
  natural_armor: trait("Natural Armour", "quality", "Its hide, scales or bones add its natural armour to defence, though not against a touch.", { modifiers: [mod("ac", "self.natural_armor", { type: "natural" })] }),
  darkvision: trait("Sees in the Dark", "quality", "Sees 60 feet with no light at all, without colour."),
  low_light_vision: trait("Sees in Dim Light", "quality", "Sees twice as far as a human by moonlight, torchlight and the like."),
  light_sensitivity: trait("Light-Shy", "quality", "In bright sunlight it is dazzled: -1 to attack, Search and Spot."),
  scent: trait("Keen Nose", "quality", "Smells foes within 30 feet (farther downwind) and follows tracks by smell."),
  trip_bite: trait("Dragging Bite", "quality", "A bite that hits lets it try to trip the foe at once, with no touch attack and no attack of opportunity; failing, it cannot be tripped back."),
  skeleton_bones: trait("Brittle Bones", "quality", "Harm of any type but bludgeoning loses 5 to its bones; cold does it no harm.", { modifiers: [mod("reduction", 5, { bypass: ["bludgeoning"] }), mod("resist.cold", 1000, { note: "no harm from cold" })] }),
  zombie_flesh: trait("Dead Flesh", "quality", "Harm of any type but slashing loses 5 to it. It takes only a move or a standard action each turn, never both, and never runs.", { modifiers: [mod("reduction", 5, { bypass: ["slashing"] })] }),

  // Class features.
  fast_movement: trait("Fast Movement", "class feature", "+10 speed, except in heavy armour.", { modifiers: [mod("speed", 10, { when: "limit(self, 'armor_weight', 0) < 3" })] }),
  illiteracy: trait("Cannot Read", "class feature", "Cannot read or write until it spends 2 skill points to learn."),
  rage: trait("Rage", "class feature", "Once a fight, for 3 + its Constitution modifier rounds once raging: put on the raging condition, then fatigued when it ends. Uses a day: the Rage gauge (1, and 1 more at the 4th level and every 4th after)."),
  greater_rage: trait("Greater Rage", "class feature", "Raging gives +6 Strength and Constitution and +3 Will (in the raging condition)."),
  indomitable_will: trait("Unbending Will", "class feature", "+4 on Will saves against charms and compulsions while raging."),
  tireless_rage: trait("Tireless Rage", "class feature", "Not fatigued when a rage ends."),
  mighty_rage: trait("Mighty Rage", "class feature", "Raging gives +8 Strength and Constitution and +4 Will (in the raging condition)."),
  uncanny_dodge: trait("Uncanny Dodge", "class feature", "Keeps its Dexterity bonus to defence when flat-footed or struck by a foe it cannot see."),
  improved_uncanny_dodge: trait("Hard to Flank", "class feature", "Cannot be flanked, except by a rogue four levels higher than its own levels in the classes that give it this."),
  trap_sense: trait("Trap Sense", "class feature", "+1 on Reflex saves and +1 dodge to defence against traps for every three levels of the class that gives it: name it against a trap."),
  barbarian_reduction: trait("Thick Skin", "class feature", "Harm of every kind loses 1, and 1 more each three levels after the 7th (5 at the 19th).", { modifiers: [mod("reduction", "floor((class_level(self, 'barbarian') - 4) / 3)", { bypass: [] })] }),
  bardic_music: trait("Bardic Music", "class feature", "As many songs a day as its bard levels (the Bardic Music gauge): countersong; fascinate; inspire courage, +1 morale to allies' attack, weapon damage and saves against fear and charms (+2 at the 8th level, +3 at the 14th, +4 at the 20th); and more songs as it rises: put them on as effects."),
  bardic_knowledge: trait("Bardic Knowledge", "class feature", "Knows things of note: a check of its bard levels + its Intelligence modifier."),
  turn_undead: trait("Turn Undead", "class feature", "Drives off or destroys the undead: tries a day as the Turning gauge, 3 + its Charisma modifier."),
  animal_companion: trait("Animal Companion", "class feature", "A loyal animal goes with it, growing stronger with its levels."),
  nature_sense: trait("Nature Sense", "class feature", "+2 Lore (nature) and Survival.", { modifiers: skillsMod(2, ["knowledge_nature", "survival"]) }),
  wild_empathy: trait("Way with Beasts", "class feature", "Calms animals: a check of d20 + its levels in the class + its Charisma modifier."),
  woodland_stride: trait("Woodland Stride", "class feature", "Moves through undergrowth at full speed and unharmed."),
  trackless_step: trait("Trackless Step", "class feature", "Leaves no trail in natural surroundings."),
  resist_natures_lure: trait("Resist the Wild's Lure", "class feature", "+4 on saves against the magic of fey."),
  wild_shape: trait("Wild Shape", "class feature", "Takes the shape of an animal and back, as often a day as the Wild Shape gauge: once at the 5th level, twice at the 6th, three times at the 7th, then more."),
  venom_immunity: trait("Venom Immunity", "class feature", "No poison harms it."),
  a_thousand_faces: trait("A Thousand Faces", "class feature", "Changes its looks at will."),
  timeless_body: trait("Timeless Body", "class feature", "Age weakens it no more."),
  fighter_bonus_feat: trait("Fighting Feats", "class feature", "One more feat at the 1st level and each even level, of those for fighting."),
  flurry_of_blows: trait("Flurry of Blows", "class feature", "With all its attacks, unarmed or with a monk's weapon, one more attack at its highest bonus and -2 on each (-1 at the 2nd level, none from the 5th; two more from the 11th): name them as the attack's modifiers."),
  monk_unarmed: trait("Hard Hands", "class feature", "Its unarmed strike deals 1d6 (1d8 from the 4th level, 1d10 from the 8th, 2d6 from the 12th, 2d8 from the 16th, 2d10 at the 20th): kept as its own attack."),
  monk_ac: trait("Unarmoured Defence", "class feature", "With no armour and no shield, its Wisdom bonus and 1 for every five monk levels add to defence, even flat-footed or against a touch.", {
    modifiers: [mod("ac", "max(0, mod(self, 'wis')) + floor(class_level(self, 'monk') / 5)", { when: UNARMOURED, note: "Wisdom and training" })],
  }),
  monk_bonus_feat: trait("Monk Feats", "class feature", "One more feat at the 1st, 2nd and 6th levels, from a short list."),
  evasion: trait("Evasion", "class feature", "A Reflex save that would halve harm takes none of it."),
  still_mind: trait("Still Mind", "class feature", "+2 on saves against charms and compulsions."),
  monk_speed: trait("Swift Feet", "class feature", "+10 speed for every three monk levels, with no armour and no shield.", { modifiers: [mod("speed", "floor(class_level(self, 'monk') / 3) * 10", { when: UNARMOURED })] }),
  ki_strike: trait("Ki Strike", "class feature", "Its unarmed strikes pass through reduction that magic weapons pass (lawful from the 10th level, adamantine from the 16th)."),
  slow_fall: trait("Slow Fall", "class feature", "Within reach of a wall, falls as if 20 feet shorter, and 10 more every two levels."),
  purity_of_body: trait("Pure Body", "class feature", "No natural disease takes hold of it."),
  wholeness_of_body: trait("Wholeness of Body", "class feature", "Heals itself up to twice its monk levels in hit points a day: the Wholeness gauge."),
  improved_evasion: trait("Improved Evasion", "class feature", "A failed Reflex save that would halve harm takes only half."),
  diamond_body: trait("Diamond Body", "class feature", "No poison harms it."),
  abundant_step: trait("Abundant Step", "class feature", "Once a day, steps from one place to another as by magic."),
  diamond_soul: trait("Diamond Soul", "class feature", "Spells must overcome 10 + its monk levels to touch it."),
  quivering_palm: trait("Quivering Palm", "class feature", "Once a week, a touch that can kill later at its word: Fortitude against 10 + half its monk levels + its Wisdom modifier."),
  empty_body: trait("Empty Body", "class feature", "Turns to a ghost's substance for some rounds a day."),
  perfect_self: trait("Perfect Self", "class feature", "Harm loses 10 to it, but not from magic weapons.", { modifiers: [mod("reduction", 10, { bypass: ["magic"] })] }),
  aura_of_good: trait("Aura of Good", "class feature", "Shines with good to those who sense it."),
  detect_evil: trait("Sense Evil", "class feature", "Senses evil at will."),
  smite_evil: trait("Smite Evil", "class feature", "On one melee attack against an evil foe, + its Charisma modifier to attack and + its paladin levels to damage: name both as the attack's modifiers. Uses a day: the Smite gauge (1, and 1 more each five levels)."),
  divine_grace: trait("Divine Grace", "class feature", "Its Charisma bonus adds to every save.", { modifiers: [mod("save", "max(0, mod(self, 'cha'))", { note: "Charisma" })] }),
  lay_on_hands: trait("Lay on Hands", "class feature", "Heals by touch up to its paladin levels times its Charisma bonus in hit points a day: the Lay on Hands gauge."),
  aura_of_courage: trait("Aura of Courage", "class feature", "Fear does not touch it, and allies within 10 feet have +4 morale against fear."),
  divine_health: trait("Divine Health", "class feature", "No disease takes hold of it."),
  special_mount: trait("Called Mount", "class feature", "Calls a mount to its side, growing stronger with its levels."),
  remove_disease: trait("Cure Disease", "class feature", "Cures a disease once a week, and once more each three levels."),
  favored_enemy: trait("Favoured Enemy", "class feature", "Against a kind of foe it has chosen, +2 on Deceive, Listen, Read People, Spot and Survival and on weapon damage (more kinds and more bonus every five levels): name it against that foe."),
  combat_style: trait("Fighting Style", "class feature", "Archery (as Rapid Shot) or two weapons (as Two Weapons), only in light armour or none."),
  improved_combat_style: trait("Fighting Style, Improved", "class feature", "Its style's next feat, in light armour or none."),
  combat_style_mastery: trait("Fighting Style, Mastery", "class feature", "Its style's last feat, in light armour or none."),
  swift_tracker: trait("Swift Tracker", "class feature", "Follows tracks at its full speed with no penalty."),
  camouflage: trait("Camouflage", "class feature", "Hides in any natural surroundings."),
  hide_in_plain_sight: trait("Hide in Plain Sight", "class feature", "Hides in natural surroundings even while watched."),
  sneak_attack: trait("Sneak Attack", "class feature", "Against a foe that loses its Dexterity bonus to defence or is flanked, +1d6 damage at the 1st level and 1d6 more each two levels, not multiplied by a critical; ranged only within 30 feet: name the dice with the harm."),
  trapfinding: trait("Trapfinding", "class feature", "Finds and disarms traps of any difficulty, magic ones too."),
  rogue_special: trait("Rogue's Trick", "class feature", "At the 10th, 13th, 16th and 19th levels a trick or a feat: crippling strike, defensive roll, improved evasion, opportunist, skill mastery or a slippery mind."),
  familiar: trait("Familiar", "class feature", "A small animal bound to it, which shares its senses and grows with its levels."),
  scribe_scroll: trait("Scroll Writing", "class feature", "Writes its spells down as scrolls."),
  wizard_bonus_feat: trait("Wizard Feats", "class feature", "One more feat at the 5th level and every fifth after, for spells or making magic items."),
};

// ---------------------------------------------------------------- conditions

const halfSpeed = mod("speed", "-floor(self.base_speed / 2)", { note: "half speed" });
const noDex = mod("max_dex", 0, { limit: true, note: "loses its Dexterity bonus" });
const dexZero = mod("max_dex", -5, { limit: true, note: "Dexterity as 0" });
const fear = [mod("attack", -2), mod("save", -2), mod("skill", -2), mod("ability_check", -2)];
const BLIND_SKILLS = ["balance", "climb", "escape_artist", "hide", "jump", "move_silently", "open_lock", "ride", "search", "sleight_of_hand", "swim", "tumble", "use_rope"];

const conditionRows: Record<string, TableRow> = {
  ability_damaged: condition("Ability Damaged", "Points of an ability lost for now, one back a night: put on as an effect with a modifier to ability.<id>."),
  ability_drained: condition("Ability Drained", "Points of an ability lost for good: put on as an effect with a modifier to ability.<id>."),
  blinded: condition("Blinded", "-2 defence and no Dexterity bonus to it; half speed; -4 on Search and most Strength and Dexterity skills; every foe has total concealment from it (half its attacks miss).", [mod("ac", -2), noDex, halfSpeed, ...skillsMod(-4, BLIND_SKILLS)], ["flat", "blind", "half_speed"]),
  charging: condition("Charging", "+2 to its melee attack, -2 defence until its next turn.", [mod("attack.melee", 2), mod("ac", -2)]),
  confused: condition("Confused", "Each turn a roll of d% says what it does: 01-10 attacks whoever confused it, 11-20 acts as it would, 21-50 babbles, 51-70 flees, 71-100 attacks the nearest.", [], ["confused"]),
  cowering: condition("Cowering", "Frozen in fear: no actions, -2 defence and no Dexterity bonus to it.", [mod("ac", -2), noDex], ["no_actions", "flat"]),
  dazed: condition("Dazed", "No actions, though its defence stands.", [], ["no_actions"]),
  dazzled: condition("Dazzled", "-1 to attack, Search and Spot.", [mod("attack", -1), ...skillsMod(-1, ["search", "spot"])]),
  dead: condition("Dead", "Its life has left it.", [], ["no_actions", "dead"]),
  deafened: condition("Deafened", "-4 initiative; fails every Listen check; one spell in five with spoken words fails.", [mod("initiative", -4)], ["deaf"]),
  disabled: condition("Disabled", "At 0 hit points: a move or a standard action a turn, not both, at half speed; a standard action or anything strenuous then costs 1 hit point.", [halfSpeed], ["one_action", "half_speed"]),
  down: condition("Out of the Fight", "No longer standing in the fight."),
  dying: condition("Dying", "Below 0 hit points: unconscious, and loses 1 hit point at each of its turns unless a roll of 10 or less on d% steadies it.", [], ["no_actions", "helpless"]),
  energy_drained: condition("Drained of Life", "One level drained: -1 to attack, saves, skills and ability checks and -5 hit points; put on once for each level.", [mod("attack", -1), mod("save", -1), mod("skill", -1), mod("ability_check", -1), mod("hp", -5)]),
  entangled: condition("Entangled", "-2 to attack, -4 Dexterity, half speed, no running or charging.", [mod("attack", -2), mod("ability.dex", -4), halfSpeed], ["half_speed", "no_run"]),
  exhausted: condition("Exhausted", "-6 Strength and Dexterity, half speed, no running or charging; an hour's rest leaves it fatigued.", [mod("ability.str", -6), mod("ability.dex", -6), halfSpeed], ["half_speed", "no_run"]),
  fascinated: condition("Fascinated", "Does nothing but watch; -4 on Listen and Spot; any threat ends it.", skillsMod(-4, ["listen", "spot"]), ["no_actions"]),
  fatigued: condition("Fatigued", "-2 Strength and Dexterity, no running or charging; eight hours' rest ends it.", [mod("ability.str", -2), mod("ability.dex", -2)], ["no_run"]),
  fighting_defensively: condition("Fighting Defensively", "-4 to attack, +2 dodge to defence until its next turn.", [mod("attack", -4), mod("ac", 2, { type: "dodge" })]),
  flat_footed: condition("Flat-Footed", "Caught unready: no Dexterity bonus to defence, no dodge bonus, no attacks of opportunity.", [noDex], ["flat", "no_aoo"]),
  frightened: condition("Frightened", "Flees what frightens it, fighting only when cornered; -2 to attack, saves, skills and ability checks.", fear, ["flees"]),
  grappling: condition("Grappling", "Held with a foe: no Dexterity bonus to defence against others; -4 to attack with anything but a light weapon or bare hands; no two-weapon fighting; threatens no one.", [noDex], ["flat", "held"]),
  helpless: condition("Helpless", "Bound, asleep or paralysed: its Dexterity counts as 0 to defence, and melee attacks on it have +4; it can be slain with one blow.", [dexZero, mod("ac.melee", -4)], ["helpless", "flat", "no_actions"]),
  incorporeal: condition("Incorporeal", "Without a body: only magic weapons, spells and the like touch it, and even they miss half the time."),
  invisible: condition("Invisible", "+2 to attack those who see normally, who lose their Dexterity bonus against it; attacks on it miss half the time.", [mod("attack", 2)], ["unseen"]),
  nauseated: condition("Nauseated", "Only a move action a turn: no attacks, no spells.", [], ["move_only"]),
  panicked: condition("Panicked", "Drops what it holds and flees; cowers when cornered; -2 on saves, skills and ability checks.", [mod("save", -2), mod("skill", -2), mod("ability_check", -2)], ["flees", "drops_held"]),
  paralyzed: condition("Paralysed", "Cannot move or act, only think: its Strength and Dexterity count as 0, and it is helpless.", [dexZero, mod("ac.melee", -4)], ["helpless", "flat", "no_actions"]),
  petrified: condition("Turned to Stone", "Stone, unconscious, knowing nothing.", [], ["no_actions", "helpless"]),
  pinned: condition("Pinned", "Held down in a grapple: -4 defence and no Dexterity bonus to it against others; cannot move.", [mod("ac", -4), noDex], ["flat", "held"]),
  prone: condition("Prone", "On the ground: -4 to its melee attacks and no ranged ones but a crossbow's; -4 defence against melee, +4 against ranged attacks; standing is a move action.", [mod("attack.melee", -4), mod("ac.melee", -4), mod("ac.ranged", 4)], ["no_ranged"]),
  raging: condition(
    "Raging",
    "+4 Strength and Constitution, +2 morale on Will, -2 defence (+6, +6, +3 from the 11th barbarian level; +8, +8, +4 at the 20th); no skill that needs patience or calm.",
    [
      mod("ability.str", "class_level(self, 'barbarian') >= 20 ? 8 : class_level(self, 'barbarian') >= 11 ? 6 : 4", { type: "morale" }),
      mod("ability.con", "class_level(self, 'barbarian') >= 20 ? 8 : class_level(self, 'barbarian') >= 11 ? 6 : 4", { type: "morale" }),
      mod("save.will", "class_level(self, 'barbarian') >= 20 ? 4 : class_level(self, 'barbarian') >= 11 ? 3 : 2", { type: "morale" }),
      mod("ac", -2),
    ],
  ),
  shaken: condition("Shaken", "-2 to attack, saves, skills and ability checks.", fear),
  sickened: condition("Sickened", "-2 to attack, weapon damage, saves, skills and ability checks.", [...fear, mod("damage", -2)]),
  stable: condition("Stable", "Below 0 hit points but no longer losing them; still unconscious.", [], ["no_actions"]),
  staggered: condition("Staggered", "Nonlethal harm equal to its hit points: a move or a standard action a turn, not both.", [], ["one_action"]),
  stunned: condition("Stunned", "Drops what it holds, no actions, -2 defence and no Dexterity bonus to it.", [mod("ac", -2), noDex], ["no_actions", "flat", "drops_held"]),
  total_defense: condition("Total Defence", "Does nothing but defend: +4 dodge to defence until its next turn.", [mod("ac", 4, { type: "dodge" })], ["no_attack"]),
  turned: condition("Turned", "Flees whoever turned it, cowering if it cannot.", [], ["flees"]),
  unconscious: condition("Unconscious", "Knocked out: helpless, its Dexterity counting as 0 to defence.", [dexZero, mod("ac.melee", -4)], ["helpless", "flat", "no_actions"]),
};

// ---------------------------------------------------------------- weapons and armour

const S = ["slashing"];
const P = ["piercing"];
const B = ["bludgeoning"];
const PS = ["piercing", "slashing"];
const BP = ["bludgeoning", "piercing"];

const weaponRows: Record<string, TableRow> = {
  // Simple.
  unarmed_strike: weapon("Unarmed strike", "1d2", "1d3", 20, 2, null, "simple", "light", B, { nonlethal: true, finesse: true }),
  gauntlet: weapon("Gauntlet", "1d2", "1d3", 20, 2, null, "simple", "light", B, { finesse: true }),
  dagger: weapon("Dagger", "1d3", "1d4", 19, 2, 10, "simple", "light", PS, { finesse: true }),
  punching_dagger: weapon("Punching dagger", "1d3", "1d4", 20, 3, null, "simple", "light", P, { finesse: true }),
  spiked_gauntlet: weapon("Spiked gauntlet", "1d3", "1d4", 20, 2, null, "simple", "light", P, { finesse: true }),
  light_mace: weapon("Light mace", "1d4", "1d6", 20, 2, null, "simple", "light", B, { finesse: true }),
  sickle: weapon("Sickle", "1d4", "1d6", 20, 2, null, "simple", "light", S, { finesse: true }),
  club: weapon("Club", "1d4", "1d6", 20, 2, 10, "simple", "one", B),
  heavy_mace: weapon("Heavy mace", "1d6", "1d8", 20, 2, null, "simple", "one", B),
  morningstar: weapon("Morningstar", "1d6", "1d8", 20, 2, null, "simple", "one", BP),
  shortspear: weapon("Shortspear", "1d4", "1d6", 20, 2, 20, "simple", "one", P),
  longspear: weapon("Longspear", "1d6", "1d8", 20, 3, null, "simple", "two", P, { reach: 10 }),
  quarterstaff: weapon("Quarterstaff", "1d4", "1d6", 20, 2, null, "simple", "two", B, { double: true }),
  spear: weapon("Spear", "1d6", "1d8", 20, 3, 20, "simple", "two", P),
  heavy_crossbow: weapon("Heavy crossbow", "1d8", "1d10", 19, 2, 120, "simple", "projectile", P),
  light_crossbow: weapon("Light crossbow", "1d6", "1d8", 19, 2, 80, "simple", "projectile", P),
  dart: weapon("Dart", "1d3", "1d4", 20, 2, 20, "simple", "thrown", P),
  javelin: weapon("Javelin", "1d4", "1d6", 20, 2, 30, "simple", "thrown", P),
  sling: weapon("Sling", "1d3", "1d4", 20, 2, 50, "simple", "projectile", B),
  // Martial.
  throwing_axe: weapon("Throwing axe", "1d4", "1d6", 20, 2, 10, "martial", "light", S, { finesse: true }),
  light_hammer: weapon("Light hammer", "1d3", "1d4", 20, 2, 20, "martial", "light", B, { finesse: true }),
  handaxe: weapon("Handaxe", "1d4", "1d6", 20, 3, null, "martial", "light", S, { finesse: true }),
  kukri: weapon("Kukri", "1d3", "1d4", 18, 2, null, "martial", "light", S, { finesse: true }),
  light_pick: weapon("Light pick", "1d3", "1d4", 20, 4, null, "martial", "light", P, { finesse: true }),
  sap: weapon("Sap", "1d4", "1d6", 20, 2, null, "martial", "light", B, { nonlethal: true, finesse: true }),
  short_sword: weapon("Short sword", "1d4", "1d6", 19, 2, null, "martial", "light", P, { finesse: true }),
  battleaxe: weapon("Battleaxe", "1d6", "1d8", 20, 3, null, "martial", "one", S),
  flail: weapon("Flail", "1d6", "1d8", 20, 2, null, "martial", "one", B),
  longsword: weapon("Longsword", "1d6", "1d8", 19, 2, null, "martial", "one", S),
  heavy_pick: weapon("Heavy pick", "1d4", "1d6", 20, 4, null, "martial", "one", P),
  rapier: weapon("Rapier", "1d4", "1d6", 18, 2, null, "martial", "one", P, { finesse: true }),
  scimitar: weapon("Scimitar", "1d4", "1d6", 18, 2, null, "martial", "one", S),
  trident: weapon("Trident", "1d6", "1d8", 20, 2, 10, "martial", "one", P),
  warhammer: weapon("Warhammer", "1d6", "1d8", 20, 3, null, "martial", "one", B),
  falchion: weapon("Falchion", "1d6", "2d4", 18, 2, null, "martial", "two", S),
  glaive: weapon("Glaive", "1d8", "1d10", 20, 3, null, "martial", "two", S, { reach: 10 }),
  greataxe: weapon("Greataxe", "1d10", "1d12", 20, 3, null, "martial", "two", S),
  greatclub: weapon("Greatclub", "1d8", "1d10", 20, 2, null, "martial", "two", B),
  heavy_flail: weapon("Heavy flail", "1d8", "1d10", 19, 2, null, "martial", "two", B),
  greatsword: weapon("Greatsword", "1d10", "2d6", 19, 2, null, "martial", "two", S),
  guisarme: weapon("Guisarme", "1d6", "2d4", 20, 3, null, "martial", "two", S, { reach: 10 }),
  halberd: weapon("Halberd", "1d8", "1d10", 20, 3, null, "martial", "two", PS),
  lance: weapon("Lance", "1d6", "1d8", 20, 3, null, "martial", "two", P, { reach: 10 }),
  ranseur: weapon("Ranseur", "1d6", "2d4", 20, 3, null, "martial", "two", P, { reach: 10 }),
  scythe: weapon("Scythe", "1d6", "2d4", 20, 4, null, "martial", "two", PS),
  longbow: weapon("Longbow", "1d6", "1d8", 20, 3, 100, "martial", "projectile", P),
  composite_longbow: weapon("Composite longbow", "1d6", "1d8", 20, 3, 110, "martial", "projectile", P),
  shortbow: weapon("Shortbow", "1d4", "1d6", 20, 3, 60, "martial", "projectile", P),
  composite_shortbow: weapon("Composite shortbow", "1d4", "1d6", 20, 3, 70, "martial", "projectile", P),
  // Exotic.
  kama: weapon("Kama", "1d4", "1d6", 20, 2, null, "exotic", "light", S, { finesse: true }),
  nunchaku: weapon("Nunchaku", "1d4", "1d6", 20, 2, null, "exotic", "light", B, { finesse: true }),
  sai: weapon("Sai", "1d3", "1d4", 20, 2, 10, "exotic", "light", B, { finesse: true }),
  siangham: weapon("Siangham", "1d4", "1d6", 20, 2, null, "exotic", "light", P, { finesse: true }),
  bastard_sword: weapon("Bastard sword", "1d8", "1d10", 19, 2, null, "exotic", "one", S),
  dwarven_waraxe: weapon("Dwarven waraxe", "1d8", "1d10", 20, 3, null, "exotic", "one", S),
  whip: weapon("Whip", "1d2", "1d3", 20, 2, null, "exotic", "one", S, { nonlethal: true, finesse: true, reach: 15 }),
  orc_double_axe: weapon("Orc double axe", "1d6", "1d8", 20, 3, null, "exotic", "two", S, { double: true }),
  spiked_chain: weapon("Spiked chain", "1d6", "2d4", 20, 2, null, "exotic", "two", P, { finesse: true, reach: 10 }),
  dire_flail: weapon("Dire flail", "1d6", "1d8", 20, 2, null, "exotic", "two", B, { double: true }),
  gnome_hooked_hammer: weapon("Gnome hooked hammer", "1d6", "1d8", 20, 3, null, "exotic", "two", BP, { double: true }),
  two_bladed_sword: weapon("Two-bladed sword", "1d6", "1d8", 19, 2, null, "exotic", "two", S, { double: true }),
  dwarven_urgrosh: weapon("Dwarven urgrosh", "1d6", "1d8", 20, 3, null, "exotic", "two", PS, { double: true }),
  bolas: weapon("Bolas", "1d3", "1d4", 20, 2, 10, "exotic", "thrown", B, { nonlethal: true }),
  hand_crossbow: weapon("Hand crossbow", "1d3", "1d4", 19, 2, 30, "exotic", "projectile", P),
  repeating_heavy_crossbow: weapon("Repeating heavy crossbow", "1d8", "1d10", 19, 2, 120, "exotic", "projectile", P, { magazine: 5 }),
  repeating_light_crossbow: weapon("Repeating light crossbow", "1d6", "1d8", 19, 2, 80, "exotic", "projectile", P, { magazine: 5 }),
  shuriken: weapon("Shuriken", "1", "1d2", 20, 2, 10, "exotic", "thrown", P),
};

/** What armour does beyond its bonus: its weight class as a limit (the lightest worn counts), its speed, and its penalty untrained. */
function armorMods(weight: "light" | "medium" | "heavy", check: number): JsonObject[] {
  const level = { light: 1, medium: 2, heavy: 3 }[weight];
  const training = `armor_${weight}`;
  return [
    mod("armor_weight", level, { limit: true, note: `${weight} armour` }),
    ...(weight !== "light" ? [mod("speed", "self.base_speed >= 30 ? -10 : -5", { when: "not has_trait(self, 'dwarf')", note: `${weight} armour` })] : []),
    ...(check < 0 ? [mod("attack", check, { when: `not has_trait(self, '${training}')`, note: "armour it is not trained in" })] : []),
  ];
}

/** What a shield does beyond its bonus: that one is borne, and its penalty untrained. */
function shieldMods(check: number, training: string, more: JsonObject[] = []): JsonObject[] {
  return [mod("shield_worn", 1, { limit: true }), mod("attack", check, { when: `not has_trait(self, '${training}')`, note: "a shield it is not trained with" }), ...more];
}

const armorRows: Record<string, TableRow> = {
  padded: armor("Padded armour", "light", 1, 8, 0, 5, armorMods("light", 0)),
  leather: armor("Leather armour", "light", 2, 6, 0, 10, armorMods("light", 0)),
  studded_leather: armor("Studded leather", "light", 3, 5, -1, 15, armorMods("light", -1)),
  chain_shirt: armor("Chain shirt", "light", 4, 4, -2, 20, armorMods("light", -2)),
  hide: armor("Hide armour", "medium", 3, 4, -3, 20, armorMods("medium", -3)),
  scale_mail: armor("Scale mail", "medium", 4, 3, -4, 25, armorMods("medium", -4)),
  chainmail: armor("Chainmail", "medium", 5, 2, -5, 30, armorMods("medium", -5)),
  breastplate: armor("Breastplate", "medium", 5, 3, -4, 25, armorMods("medium", -4)),
  splint_mail: armor("Splint mail", "heavy", 6, 0, -7, 40, armorMods("heavy", -7)),
  banded_mail: armor("Banded mail", "heavy", 6, 1, -6, 35, armorMods("heavy", -6)),
  half_plate: armor("Half-plate", "heavy", 7, 0, -7, 40, armorMods("heavy", -7)),
  full_plate: armor("Full plate", "heavy", 8, 1, -6, 35, armorMods("heavy", -6)),
  buckler: armor("Buckler", "shield", 1, null, -1, 5, shieldMods(-1, "shield_proficiency")),
  light_wooden_shield: armor("Light wooden shield", "shield", 1, null, -1, 5, shieldMods(-1, "shield_proficiency")),
  light_steel_shield: armor("Light steel shield", "shield", 1, null, -1, 5, shieldMods(-1, "shield_proficiency")),
  heavy_wooden_shield: armor("Heavy wooden shield", "shield", 2, null, -2, 15, shieldMods(-2, "shield_proficiency")),
  heavy_steel_shield: armor("Heavy steel shield", "shield", 2, null, -2, 15, shieldMods(-2, "shield_proficiency")),
  tower_shield: armor("Tower shield", "shield", 4, 2, -10, 50, shieldMods(-10, "tower_shield_proficiency", [mod("attack", -2, { note: "the tower shield's bulk" })])),
};

// ---------------------------------------------------------------- creatures

/** A creature's worn armour as an effect of its stat block: the bonus of each type counts once, if it puts on the things as well. */
function wearing(label: string, modifiers: JsonObject[]): JsonObject {
  return { label, modifiers };
}

const creatureRows: Record<string, TableRow> = {
  wolf: {
    name: "Wolf",
    kind: "person",
    fields: {
      str: 13, dex: 15, con: 15, int: 2, wis: 12, cha: 6,
      racial_hd: 2, hit_dice: 9, hp: 13, natural_armor: 2, base_speed: 50, size: "medium",
      d20_traits: ["animal", "natural_armor", "low_light_vision", "scent", "trip_bite", "track"],
      ranks: { listen: 2, spot: 2, move_silently: 1 },
    },
    attacks: [natural("Bite", "1d6", { types: BP, bonus: 1, held: "two" })],
    cr: "1",
    description: "A grey hunter of the woods that runs in packs and drags its prey down by the leg.",
  },
  goblin: {
    name: "Goblin",
    kind: "person",
    fields: {
      str: 13, dex: 11, con: 12, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 4, hp: 5, base_speed: 30, size: "small",
      d20_traits: ["goblin", "humanoid", "darkvision", "alertness"],
      d20_effects: [wearing("Leather armour and a light wooden shield", [mod("ac", 2, { type: "armor" }), mod("max_dex", 6, { limit: true }), mod("ac", 1, { type: "shield" }), mod("armor_check", -1)])],
      ranks: { hide: 1, listen: 1, spot: 1, move_silently: 1 },
    },
    carries: ["morningstar", "javelin"],
    cr: "1/3",
    description: "A small, sharp-eared raider who fights from ambush and runs when the fight turns.",
  },
  orc: {
    name: "Orc",
    kind: "person",
    fields: {
      str: 13, dex: 11, con: 12, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 4, hp: 5, base_speed: 30, size: "medium",
      d20_traits: ["orc", "humanoid", "darkvision", "light_sensitivity", "alertness"],
      d20_effects: [wearing("Studded leather", [mod("ac", 3, { type: "armor" }), mod("max_dex", 5, { limit: true }), mod("armor_check", -1)])],
      ranks: { listen: 1, spot: 1 },
    },
    carries: ["falchion", "javelin"],
    cr: "1/2",
    description: "A tusked, heavy-shouldered brute who swings a great curved blade in both hands.",
  },
  skeleton: {
    name: "Skeleton",
    kind: "person",
    fields: {
      str: 13, dex: 13, con: 10, int: 10, wis: 10, cha: 1,
      racial_hd: 2, hit_dice: 13, hp: 13, natural_armor: 2, base_speed: 30, size: "medium",
      d20_traits: ["undead", "natural_armor", "skeleton_bones", "darkvision", "improved_initiative", { id: "martial_weapon_proficiency", choice: "scimitar" }],
      d20_effects: [wearing("A heavy steel shield", [mod("ac", 2, { type: "shield" }), mod("armor_check", -2)])],
    },
    attacks: [natural("Claw", "1d4", { types: S })],
    carries: ["scimitar"],
    cr: "1/3",
    description: "Bones of a dead soldier, bound together by magic, doing as it was last told; it does not think.",
  },
  zombie: {
    name: "Zombie",
    kind: "person",
    fields: {
      str: 12, dex: 8, con: 10, int: 10, wis: 10, cha: 1,
      racial_hd: 2, hit_dice: 13, hp: 16, natural_armor: 2, base_speed: 30, size: "medium",
      d20_traits: ["undead", "natural_armor", "zombie_flesh", "darkvision", "toughness"],
    },
    attacks: [natural("Slam", "1d6", { types: B, held: "two" })],
    carries: ["club"],
    cr: "1/2",
    description: "A dead body made to shamble and strike, slow and mindless, that keeps coming until it is cut apart.",
  },
  ogre: {
    name: "Ogre",
    kind: "person",
    fields: {
      str: 21, dex: 8, con: 15, int: 6, wis: 10, cha: 7,
      racial_hd: 4, hit_dice: 18, hp: 29, natural_armor: 5, base_speed: 40, size: "large",
      d20_traits: ["giant", "natural_armor", "darkvision", "low_light_vision", "toughness", { id: "weapon_focus", choice: "greatclub" }],
      d20_effects: [wearing("Hide armour", [mod("ac", 3, { type: "armor" }), mod("max_dex", 4, { limit: true }), mod("armor_check", -3), mod("speed", -10)])],
      ranks: { climb: 3, listen: 2, spot: 2 },
    },
    carries: ["greatclub", "javelin"],
    cr: "3",
    description: "A huge, dull and hungry giant, twice a man's height, who clubs what it wants to eat.",
  },
  bandit: {
    name: "Bandit",
    kind: "person",
    fields: {
      str: 12, dex: 13, con: 11, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 4, hp: 4, base_speed: 30, size: "medium",
      d20_traits: ["human", "humanoid", "point_blank_shot", "stealthy"],
      d20_effects: [wearing("Leather armour", [mod("ac", 2, { type: "armor" }), mod("max_dex", 6, { limit: true })])],
      ranks: { intimidate: 4, climb: 2, ride: 2, hide: 1, move_silently: 1 },
    },
    carries: ["short_sword", "shortbow"],
    cr: "1/2",
    description: "A roadside robber with a short blade and a bow, bold in a band and quick to run alone.",
  },
  guard: {
    name: "Guard",
    kind: "person",
    fields: {
      str: 13, dex: 11, con: 12, int: 10, wis: 9, cha: 8,
      classes: { warrior: 1 }, hit_dice: 4, hp: 5, base_speed: 30, size: "medium",
      d20_traits: ["human", "humanoid", "alertness", { id: "weapon_focus", choice: "longsword" }],
      d20_effects: [wearing("A chain shirt and a heavy wooden shield", [mod("ac", 4, { type: "armor" }), mod("max_dex", 4, { limit: true }), mod("ac", 2, { type: "shield" }), mod("armor_check", -4)])],
      ranks: { intimidate: 4, ride: 4, listen: 1, spot: 1 },
    },
    carries: ["longsword", "light_crossbow"],
    cr: "1/2",
    description: "A town's or a lord's watchman in mail, with sword, shield and crossbow.",
  },
};

// ---------------------------------------------------------------- experience, challenges, difficulties

/** The experience a level needs: 1000 x level x (level - 1) / 2. */
const experienceRows = byLevel(20, (l) => ({ xp: (1000 * l * (l - 1)) / 2 }));

/**
 * What overcoming a challenge is worth to a party, by a member's level, shared among those who overcame it: 300 x the level for a
 * challenge equal to it, twice as much each two steps above, half as much each two below, nothing seven or more below; a fraction
 * of 1 is that fraction of a challenge of 1.
 */
function worth(level: number, cr: number): number {
  if (cr < level - 7) return 0;
  return Math.round((300 * level * 2 ** ((cr - level) / 2)) / 25) * 25;
}

const challengeRows: Record<string, TableRow> = {};
for (const [id, part] of [["1/10", 0.1], ["1/8", 0.125], ["1/6", 1 / 6], ["1/4", 0.25], ["1/3", 1 / 3], ["1/2", 0.5]] as const) {
  challengeRows[id] = { by_level: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), Math.round(worth(i + 1, 1) * part)])) };
}
for (let cr = 1; cr <= 20; cr++) challengeRows[String(cr)] = { by_level: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), worth(i + 1, cr)])) };

const difficultyRows: Record<string, TableRow> = {
  very_easy: difficulty("Very easy", 0, "Anyone does it with no effort."),
  easy: difficulty("Easy", 5, "Hardly ever failed."),
  average: difficulty("Average", 10, "The untrained do it as often as not."),
  tough: difficulty("Tough", 15, "Wants training or luck."),
  challenging: difficulty("Challenging", 20, "Beyond most of the untrained."),
  formidable: difficulty("Formidable", 25, "Hard even for a practised hand."),
  heroic: difficulty("Heroic", 30, "Only the best manage it."),
  nearly_impossible: difficulty("Nearly impossible", 40, "A feat of legend."),
};

// ---------------------------------------------------------------- the ruleset's part

const DAILY = {
  rage_uses: dailyGauge("Rage", "class_level(self, 'barbarian') > 0 ? 1 + floor(class_level(self, 'barbarian') / 4) : 0"),
  bardic_music: dailyGauge("Bardic music", "class_level(self, 'bard')"),
  turning: dailyGauge("Turning", "class_level(self, 'cleric') > 0 or class_level(self, 'paladin') >= 4 ? max(0, 3 + mod(self, 'cha')) : 0"),
  wild_shape: dailyGauge("Wild shape", "class_level(self, 'druid') >= 18 ? 6 : class_level(self, 'druid') >= 14 ? 5 : class_level(self, 'druid') >= 10 ? 4 : class_level(self, 'druid') >= 7 ? 3 : class_level(self, 'druid') >= 6 ? 2 : class_level(self, 'druid') >= 5 ? 1 : 0"),
  smite: dailyGauge("Smite", "class_level(self, 'paladin') > 0 ? 1 + floor(class_level(self, 'paladin') / 5) : 0"),
  lay_on_hands: dailyGauge("Lay on hands", "class_level(self, 'paladin') >= 2 ? class_level(self, 'paladin') * max(0, mod(self, 'cha')) : 0"),
  wholeness: dailyGauge("Wholeness of body", "class_level(self, 'monk') >= 7 ? 2 * class_level(self, 'monk') : 0"),
};

/** A night's rest, and an hour's for nonlethal harm: one hit point for each hit die. */
const PER_DIE = "max(1, levels(self) + self.racial_hd)";
const NEGATIVE = "self.hp < 0 and self.hp > -10";

const D20: D20Def = {
  abilities: [...D20_ABILITY_IDS],
  mod: ABILITY_MOD,
  kinds: ["person"],
  defaultSize: "medium",
  bonuses: { stack: ["dodge", "circumstance"], penaltiesStack: true },
  tables: { ...T },
  totals: {
    ...familyTotals({ skills: T.skills, weapons: T.weapons }),
    grapple: "class_sum(self, 'attack') + bonus(self, 'base_attack') + mod(self, 'str') + size_mod(self, 'grapple') + bonus_without(self, 'grapple', 'size')",
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
      { id: "dead", when: "self.hp <= -10", life: "dead" },
      { id: "stable", when: `${NEGATIVE} and under(self, 'stable')`, life: "alive" },
      { id: "dying", when: `${NEGATIVE} and not under(self, 'stable')`, life: "dying" },
      { id: "unconscious", when: `(${NEGATIVE}) or (self.hp >= 0 and self.nonlethal > self.hp)` },
      { id: "disabled", when: "self.hp == 0" },
      { id: "staggered", when: "self.hp > 0 and self.nonlethal == self.hp" },
    ],
    dying: { state: "dying", lose: 1, stable: "stable", roll: { id: "stabilize", dice: "1d100", bands: [{ outcome: "stable", max: 10 }, { outcome: "worse", min: 11 }], pass: ["stable"] } },
    massive: { when: "amount >= 50", save: "fort", dc: 15, hp: "-10" },
    rest: { hours: 8, hp: PER_DIE, nonlethal: PER_DIE, daily: Object.keys(DAILY) },
  },
  costs: D20_COSTS,
  levels: {
    progression: "level",
    hitPoints: "roll",
    average: "floor(die / 2) + 1",
    firstMost: true,
    rankLimit: "(levels(self) + self.racial_hd + 3) / (class_skill(self, skill) ? 1 : 2)",
    skillPoints: { plus: "mod(self, 'int') + bonus(self, 'skill_points')", min: 1, first: 4 },
    featEvery: 3,
    abilityEvery: 4,
    experienceBy: "challenge",
  },
};

const SAVES = [
  { id: "fort", label: "Fortitude" },
  { id: "ref", label: "Reflex" },
  { id: "will", label: "Will" },
];

export const CLASSIC: D20SetDef = {
  id: "classic",
  label: "Classic",
  summary:
    "Classic fantasy on a d20: six abilities, eleven classes with levels that add up, skills with ranks, feats and peoples as traits, bonuses that stack by type, defence read whole, by touch or flat-footed, weapons and armour with their own numbers, hit points down through dying to dead, and experience by challenge.",
  fields: d20Fields({ hpFloor: -10, rest: PER_DIE, sizes: T.sizes, daily: DAILY }),
  checks: {},
  actions: {},
  tables: {
    [T.skills]: d20Table("skills", T.skills, "Classic skills", skillRows, SKILL_COLUMNS),
    [T.classes]: d20Table("classes", T.classes, "Classic classes", classRows),
    [T.tracks]: d20Table("tracks", T.tracks, "Classic progressions", trackRows, { attack_good: { type: "int" }, attack_average: { type: "int" }, attack_poor: { type: "int" }, save_good: { type: "int" }, save_poor: { type: "int" } }),
    [T.traits]: d20Table("traits", T.traits, "Classic traits", traitRows),
    [T.conditions]: d20Table("conditions", T.conditions, "Classic conditions", conditionRows),
    [T.sizes]: d20Table("sizes", T.sizes, "Classic sizes", sizeRows((steps) => [mod("grapple", steps * 4, { type: "size" }), mod("skill.hide", steps * -4, { type: "size" })]), SIZE_COLUMNS),
    [T.weapons]: d20Table("weapons", T.weapons, "Classic weapons", weaponRows, WEAPON_COLUMNS),
    [T.armor]: d20Table("armor", T.armor, "Classic armour and shields", armorRows, ARMOR_COLUMNS),
    [T.creatures]: d20Table("creatures", T.creatures, "Classic creatures", creatureRows),
    [T.experience]: d20Table("experience", T.experience, "Classic experience", experienceRows),
    [T.challenges]: d20Table("challenges", T.challenges, "Classic challenges", challengeRows),
    [T.difficulties]: d20Table("difficulties", T.difficulties, "Classic difficulties", difficultyRows),
  },
  ruleset: {
    progression: { level: { label: "Level", xpField: "xp", levelField: "level", thresholds: { table: T.experience, column: "xp" }, maxLevel: 20 } },
    sheet: d20Sheet({
      defence: {
        label: "Defence",
        rows: [
          { formula: "total(self, 'ac')", label: "Armour Class" },
          { formula: "total(self, 'ac.touch')", label: "Against a touch" },
          { formula: "total(self, 'ac.flat')", label: "Flat-footed" },
          { formula: signedTotal("initiative"), label: "Initiative" },
          { formula: "total(self, 'speed')", label: "Speed" },
        ],
      },
      attack: [
        { formula: signedTotal("attack.base"), label: "Base attack" },
        { formula: signedTotal("attack.melee"), label: "Melee" },
        { formula: signedTotal("attack.ranged"), label: "Ranged" },
        { formula: signedTotal("grapple"), label: "Grapple" },
      ],
      saves: SAVES,
      skills: SKILLS.map(([id, label]) => ({ id, label })),
      daily: Object.keys(DAILY),
    }),
    minLevels: {},
    adjudication: presetAdjudication("balanced"),
    combat: d20Combat("self.hp < 0 or under(self, 'unconscious')"),
    d20: D20,
  },
};
