// The Modern rule set (RULESET-DESIGN §6): present-day adventure on a d20, with six classes whose levels add up, a defence of
// Dexterity, class, what is worn and size, firearms that fire single shots, two at once, bursts and automatic fire on an area,
// modern armour, explosives, action points a new level gives, Reputation, a damage threshold, hit points down through dying to dead,
// and experience by challenge. A world fragment the profile machinery applies; after that it is plain world data a user grows row by
// row, and the tabletop rules layer (the `d20` pack) works every check, attack and harm out of it. An original implementation of
// common tabletop mechanics: no rules text.
//
// The engine's economy comes first: nothing here is money, buying or wealth. A thing's cost is its price in the gear catalog, and a
// weapon's or an armour's row is keyed by the catalog's id for it, so a gun the world already sells has its numbers at once. The
// rounds a weapon takes are the catalog's own rows (its `ammo`); the rounds in a magazine are the thing's own `loaded`.

import { presetAdjudication } from "../adjudication";
import type { D20Def, ShotDef } from "../d20";
import type { JsonObject } from "../json";
import type { ColumnDef, TableRow } from "../tables";
import type { CombatBudgetDef, Expr, FieldDef } from "../world";
import {
  ABILITY_MOD,
  ARMOR_COLUMNS,
  BASE_ATTACK,
  byLevel,
  CHALLENGE_ROWS,
  CLASSIC_MODERN_FEATS,
  condition,
  CORE_WEAPONS,
  D20_ABILITY_IDS,
  D20_BUDGETS,
  D20_COSTS,
  d20Combat,
  d20Fields,
  d20Sheet,
  d20Table,
  dailyGauge,
  DEX_ZERO,
  difficulty,
  DIFFICULTIES,
  experienceRows,
  familyTotals,
  features,
  HALF_SPEED,
  mod,
  natural,
  NO_DEX,
  SHARED_CONDITIONS,
  SHARED_CREATURE_TRAITS,
  SHARED_FEATS,
  SHARED_FEATURES,
  SIZE_COLUMNS,
  signedTotal,
  sizeRows,
  skillsMod,
  trait,
  WEAPON_COLUMNS,
  wearing,
  type D20SetDef,
} from "./d20-common";

const T = {
  skills: "modern.skills",
  classes: "modern.classes",
  tracks: "modern.tracks",
  traits: "modern.traits",
  conditions: "modern.conditions",
  sizes: "modern.sizes",
  weapons: "modern.weapons",
  armor: "modern.armor",
  creatures: "modern.creatures",
  experience: "modern.experience",
  challenges: "modern.challenges",
  difficulties: "modern.difficulties",
} as const;

/** The rows of `from` with these ids. */
function pick(from: Record<string, TableRow>, ids: readonly string[]): Record<string, TableRow> {
  const out: Record<string, TableRow> = {};
  for (const id of ids) {
    const row = from[id];
    if (row !== undefined) out[id] = row;
  }
  return out;
}

// ---------------------------------------------------------------- skills

/** The fields of knowledge, each its own skill: its id after `knowledge_` and the words in its label. */
const LORE: readonly [string, string][] = [
  ["arcane_lore", "the occult"],
  ["art", "art"],
  ["behavioral_sciences", "behavioural sciences"],
  ["business", "business"],
  ["civics", "civics"],
  ["current_events", "current events"],
  ["earth_life_sciences", "earth and life sciences"],
  ["history", "history"],
  ["physical_sciences", "physical sciences"],
  ["popular_culture", "popular culture"],
  ["streetwise", "the streets"],
  ["tactics", "tactics"],
  ["technology", "technology"],
  ["theology_philosophy", "faith and philosophy"],
];

/** The crafts, each its own skill: its id after `craft_`, the words in its label, and whether only the trained use it. */
const CRAFTS: readonly [string, string, boolean][] = [
  ["chemical", "chemicals", true],
  ["electronic", "electronics", true],
  ["mechanical", "machines", true],
  ["pharmaceutical", "medicines", true],
  ["structural", "building", false],
  ["visual_art", "visual art", false],
  ["writing", "writing", false],
];

/** Each skill: its label, key ability, whether only the trained use it, and whether armour's check penalty falls on it. */
const SKILLS: readonly [string, string, string, boolean, boolean][] = [
  ["balance", "Balance", "dex", false, true],
  ["bluff", "Deceive", "cha", false, false],
  ["climb", "Climb", "str", false, true],
  ["computer_use", "Computers", "int", false, false],
  ["concentration", "Concentration", "con", false, false],
  ...CRAFTS.map(([id, words, trained]): [string, string, string, boolean, boolean] => [`craft_${id}`, `Craft (${words})`, "int", trained, false]),
  ["decipher_script", "Decipher Writing", "int", true, false],
  ["demolitions", "Explosives", "int", true, false],
  ["diplomacy", "Persuade", "cha", false, false],
  ["disable_device", "Disable Devices", "int", true, false],
  ["disguise", "Disguise", "cha", false, false],
  ["drive", "Drive", "dex", false, false],
  ["escape_artist", "Slip Free", "dex", false, true],
  ["forgery", "Forgery", "int", false, false],
  ["gamble", "Gamble", "wis", false, false],
  ["gather_information", "Gather Rumours", "cha", false, false],
  ["handle_animal", "Handle Animals", "cha", true, false],
  ["hide", "Hide", "dex", false, true],
  ["intimidate", "Intimidate", "cha", false, false],
  ["investigate", "Investigate", "int", true, false],
  ["jump", "Jump", "str", false, true],
  ...LORE.map(([id, words]): [string, string, string, boolean, boolean] => [`knowledge_${id}`, `Lore (${words})`, "int", true, false]),
  ["listen", "Listen", "wis", false, false],
  ["move_silently", "Move Quietly", "dex", false, true],
  ["navigate", "Navigate", "int", false, false],
  ["perform", "Perform", "cha", false, false],
  ["pilot", "Pilot", "dex", true, false],
  ["profession", "Profession", "wis", false, false],
  ["read_write_language", "Read and Write Languages", "int", true, false],
  ["repair", "Repair", "int", true, false],
  ["research", "Research", "int", false, false],
  ["ride", "Ride", "dex", false, false],
  ["search", "Search", "int", false, false],
  ["sense_motive", "Read People", "wis", false, false],
  ["sleight_of_hand", "Deft Hands", "dex", true, true],
  ["speak_language", "Languages", "int", true, false],
  ["spot", "Spot", "wis", false, false],
  ["survival", "Survival", "wis", false, false],
  ["swim", "Swim", "str", false, true],
  ["treat_injury", "First Aid", "wis", false, false],
  ["tumble", "Tumble", "dex", true, true],
];

const skillRows: Record<string, TableRow> = {};
for (const [id, label, ability, trained, armor] of SKILLS) skillRows[id] = { label, ability, ...(trained ? { trained } : {}), ...(armor ? { armor } : {}) };

const SKILL_LABEL: Readonly<Record<string, string>> = Object.fromEntries(SKILLS.map(([id, label]) => [id, label]));

const lore = (...ids: string[]): string[] => ids.map((id) => `knowledge_${id}`);
const craft = (...ids: string[]): string[] => ids.map((id) => `craft_${id}`);
const ALL_LORE = LORE.map(([id]) => `knowledge_${id}`);
const ALL_CRAFT = CRAFTS.map(([id]) => `craft_${id}`);
/** What every class reads, writes and speaks. */
const LANGUAGES = ["profession", "read_write_language", "speak_language"];

// ---------------------------------------------------------------- tracks and classes

/** Ten levels of each class: base attack at the full, three-quarter and half rate; a good and a poor save; defence and Reputation by class. */
const GOOD_SAVE = [1, 2, 2, 2, 3, 3, 4, 4, 4, 5];
const DEFENCE = { low: [0, 1, 1, 1, 2, 2, 2, 3, 3, 3], mid: [1, 2, 2, 3, 3, 3, 4, 4, 5, 5], high: [3, 4, 4, 5, 5, 6, 6, 7, 7, 8] };
const REPUTATION = { least: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2], low: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3], mid: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4], high: [2, 2, 2, 3, 3, 3, 4, 4, 4, 5] };

const trackRows = byLevel(10, (l) => ({
  attack_good: l,
  attack_average: Math.floor((l * 3) / 4),
  attack_poor: Math.floor(l / 2),
  save_good: GOOD_SAVE[l - 1] ?? 0,
  save_poor: Math.floor(l / 3),
  defence_low: DEFENCE.low[l - 1] ?? 0,
  defence_mid: DEFENCE.mid[l - 1] ?? 0,
  defence_high: DEFENCE.high[l - 1] ?? 0,
  reputation_least: REPUTATION.least[l - 1] ?? 0,
  reputation_low: REPUTATION.low[l - 1] ?? 0,
  reputation_mid: REPUTATION.mid[l - 1] ?? 0,
  reputation_high: REPUTATION.high[l - 1] ?? 0,
}));

const TRACK_COLUMNS: Record<string, ColumnDef> = Object.fromEntries(Object.keys(trackRows["1"] ?? {}).map((c) => [c, { type: "int" }]));

function tracks(attack: "good" | "average" | "poor", fort: "good" | "poor", ref: "good" | "poor", will: "good" | "poor", defence: keyof typeof DEFENCE, reputation: keyof typeof REPUTATION): JsonObject {
  return { attack: `attack_${attack}`, fort: `save_${fort}`, ref: `save_${ref}`, will: `save_${will}`, defence: `defence_${defence}`, reputation: `reputation_${reputation}` };
}

/** Every class's levels: a talent at each odd level, a feat of the class's own at each even one. */
const TALENTS_AND_FEATS = features(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, [(i + 1) % 2 === 1 ? "talent" : "class_bonus_feat"]])));

function classRow(label: string, die: number, track: JsonObject, points: number, skills: string[]): TableRow {
  return { label, hit_die: die, tracks: track, skill_points: points, class_skills: [...skills, ...LANGUAGES], proficiency: ["simple"], features: TALENTS_AND_FEATS };
}

const classRows: Record<string, TableRow> = {
  strong: classRow("Strong", 8, tracks("good", "good", "poor", "poor", "mid", "least"), 3, ["climb", ...craft("structural"), "handle_animal", "jump", ...lore("current_events", "popular_culture", "streetwise", "tactics"), "repair", "swim"]),
  fast: classRow("Fast", 8, tracks("average", "poor", "good", "poor", "high", "low"), 5, ["balance", ...craft("mechanical"), "drive", "escape_artist", "hide", ...lore("current_events", "popular_culture", "streetwise"), "move_silently", "pilot", "ride", "sleight_of_hand", "tumble"]),
  tough: classRow("Tough", 10, tracks("average", "good", "poor", "poor", "mid", "low"), 3, ["climb", "concentration", ...craft("mechanical", "structural"), "drive", "intimidate", ...lore("current_events", "popular_culture", "streetwise"), "ride", "spot", "survival"]),
  smart: classRow("Smart", 6, tracks("poor", "poor", "poor", "good", "low", "mid"), 9, ["computer_use", ...ALL_CRAFT, "decipher_script", "demolitions", "disable_device", "forgery", "investigate", ...ALL_LORE, "navigate", "repair", "research", "search"]),
  dedicated: classRow("Dedicated", 6, tracks("average", "good", "poor", "good", "mid", "mid"), 5, [...craft("pharmaceutical", "visual_art", "writing"), "gamble", "investigate", ...ALL_LORE, "listen", "sense_motive", "spot", "survival", "treat_injury"]),
  charismatic: classRow("Charismatic", 6, tracks("poor", "good", "good", "poor", "low", "high"), 7, [
    "bluff",
    ...craft("visual_art", "writing"),
    "diplomacy",
    "disguise",
    "gather_information",
    "handle_animal",
    "intimidate",
    ...lore("arcane_lore", "art", "behavioral_sciences", "business", "civics", "current_events", "popular_culture", "streetwise", "theology_philosophy"),
    "perform",
  ]),
};

// ---------------------------------------------------------------- traits: feats, talents, occupations, creature types

/** Whether helplessness has taken its class and armour defence (a helpless condition's `defended` limit of 0). */
const HELPLESS: Expr = "limit(self, 'defended', 99) == 0";
const DEFENDED: Expr = "limit(self, 'defended', 99) > 0";

const has = (id: string): string => `has_trait(self, '${id}')`;
const all = (...ids: string[]): string => ids.map(has).join(" and ");

/** An occupation: some of these skills become class skills, each taken as the trait's choice, one already a class skill +1; and the feats one more may be. */
function occupation(label: string, count: number, skills: string[], feats: string[] = [], more: JsonObject[] = []): TableRow {
  const names = skills.map((s) => SKILL_LABEL[s] ?? s).join(", ");
  const feat = feats.length > 0 ? ` One more feat: ${feats.join(" or ")}.` : "";
  return trait(label, "occupation", `${count === 1 ? "One" : count === 2 ? "Two" : "Three"} of ${names} become class skills: take it once with each as its choice; one already a class skill has +1 instead.${feat}`, {
    modifiers: [mod("skill.{choice}", 1, { type: "competence", when: "class_skill(self, '{choice}')", note: "already a class skill" }), ...more],
  });
}

const traitRows: Record<string, TableRow> = {
  ...pick(SHARED_FEATS, ["simple_weapon_proficiency", "endurance", "great_fortitude", "improved_initiative", "iron_will", "lightning_reflexes", "mobility", "point_blank_shot", "precise_shot", "quick_draw", "run", "weapon_focus"]),
  ...CLASSIC_MODERN_FEATS,
  ...pick(SHARED_FEATURES, ["evasion", "uncanny_dodge"]),
  ...pick(SHARED_CREATURE_TRAITS, ["animal", "natural_armor", "low_light_vision", "scent", "trip_bite"]),

  // Training with weapons and armour.
  personal_firearms_proficiency: trait("Personal Firearms", "feat", "No -4 to attack with a handgun or a longarm.", { grants: { proficiency: ["personal_firearms"] } }),
  advanced_firearms_proficiency: trait("Automatic Fire", "feat", "No -4 on a weapon's automatic fire.", { requires: has("personal_firearms_proficiency") }),
  exotic_firearms_proficiency: trait("Heavy Weapon", "feat", "No -4 to attack with the heavy weapons taken as its choice: heavy_machine_guns, rocket_launchers or grenade_launchers.", { requires: all("personal_firearms_proficiency", "advanced_firearms_proficiency") }),
  archaic_weapons_proficiency: trait("Old Weapons", "feat", "No -4 to attack with a sword, a bow or another weapon of before guns.", { grants: { proficiency: ["archaic"] } }),
  exotic_melee_weapon_proficiency: trait("Exotic Melee Weapon", "feat", "No -4 to attack with the exotic melee weapon taken as its choice.", { requires: `${BASE_ATTACK} >= 1` }),
  armor_light: trait("Light Armour Training", "feat", "Light armour's whole bonus counts to defence; without the training only its lesser bonus does."),
  armor_medium: trait("Medium Armour Training", "feat", "Medium armour's whole bonus counts to defence; without the training only its lesser bonus does.", { requires: has("armor_light") }),
  armor_heavy: trait("Heavy Armour Training", "feat", "Heavy armour's whole bonus counts to defence; without the training only its lesser bonus does.", { requires: has("armor_medium") }),

  // Firearms.
  double_tap: trait("Double Tap", "feat", "With a semi-automatic weapon, two rounds at one foe: -2 to attack, one more die of damage (the shot `double`).", { requires: `score(self, 'dex') >= 13 and ${has("point_blank_shot")}` }),
  burst_fire: trait("Burst Fire", "feat", "With an automatic weapon, five rounds at one foe: -4 to attack, two more dice of damage (the shot `burst`); without it the rounds add nothing.", { requires: `score(self, 'wis') >= 13 and ${all("personal_firearms_proficiency", "advanced_firearms_proficiency")}` }),
  strafe: trait("Strafe", "feat", "Automatic fire on a line of four squares in place of a square of two by two: name who stands in the line and give them the harm with a Reflex save against 15.", { requires: all("personal_firearms_proficiency", "advanced_firearms_proficiency") }),
  quick_reload: trait("Quick Reload", "feat", "Puts in a box magazine or a speed loader as a free action, and loads a cylinder or an internal magazine as a move action.", { requires: `${BASE_ATTACK} >= 1` }),
  dead_aim: trait("Dead Aim", "feat", "A full round of aiming, not moving or struck, gives +2 to the next ranged attack: name it as the attack's modifier.", { requires: `score(self, 'wis') >= 13 and ${has("far_shot")}` }),
  shot_on_the_run: trait("Shot on the Run", "feat", "Moves before and after a ranged attack, no farther in all than its speed.", { requires: `score(self, 'dex') >= 13 and ${all("point_blank_shot", "dodge", "mobility")}` }),
  skip_shot: trait("Skip Shot", "feat", "Bounces a shot off a smooth surface within 10 feet of the foe: -2 to attack, one die less of damage, and the foe's cover counts for nothing.", { requires: all("point_blank_shot", "precise_shot") }),
  drive_by_attack: trait("Drive-By", "feat", "Takes no penalty for a vehicle's speed on its attacks, and a driver attacks at any point of the move."),

  // Fighting and toughness.
  power_attack: trait("Heavy Blows", "feat", "Before attacking, it may take up to its base attack off its melee attacks and add as much to damage: name both as the attack's modifiers.", { requires: "score(self, 'str') >= 13" }),
  two_weapon_fighting: trait("Two Weapons", "feat", "Fighting with a weapon in each hand costs -4 on each (-2 if the off-hand weapon is light), not -6 and -10 (-4 and -8): name them as the attacks' modifiers.", { requires: "score(self, 'dex') >= 13" }),
  weapon_finesse: trait("Finesse", "feat", "With the light melee weapon taken as its choice, Dexterity stands for Strength on the attack roll.", {
    modifiers: [mod("attack.weapon.{choice}", "max(0, mod(self, 'dex') - mod(self, 'str'))", { note: "Dexterity for Strength" })],
    requires: `${BASE_ATTACK} >= 1`,
  }),
  brawl: trait("Brawler", "feat", "+1 to attack unarmed, and its fists deal 1d6 nonlethal: name the dice with the harm.", { modifiers: [mod("attack.weapon.unarmed_strike", 1)] }),
  improved_brawl: trait("Brawler, Improved", "feat", "+2 to attack unarmed, and its fists deal 1d8 nonlethal: name the dice with the harm.", { modifiers: [mod("attack.weapon.unarmed_strike", 1)], requires: `${BASE_ATTACK} >= 3 and ${has("brawl")}` }),
  combat_martial_arts: trait("Fighting Art", "feat", "Its fists count as armed and deal 1d4 lethal or nonlethal, its choice: name the dice with the harm.", { requires: `${BASE_ATTACK} >= 1` }),
  defensive_martial_arts: trait("Guarded Stance", "feat", "+1 dodge to defence against melee attacks.", { modifiers: [mod("ac.melee", 1, { type: "dodge" })] }),
  improved_damage_threshold: trait("Hard to Fell", "feat", "+3 to its damage threshold; taken again, 3 more.", { modifiers: [mod("damage_threshold", 3)] }),
  renown: trait("Known Name", "feat", "+3 Reputation.", { modifiers: [mod("reputation", 3)] }),
  low_profile: trait("Low Profile", "feat", "-3 Reputation: fewer know its face.", { modifiers: [mod("reputation", -3)] }),

  // Skills in pairs.
  attentive: trait("Attentive", "feat", "+2 Investigate and Read People.", { modifiers: skillsMod(2, ["investigate", "sense_motive"]) }),
  cautious: trait("Careful Hands", "feat", "+2 Explosives and Disable Devices.", { modifiers: skillsMod(2, ["demolitions", "disable_device"]) }),
  deceptive: trait("Deceptive", "feat", "+2 Deceive and Disguise.", { modifiers: skillsMod(2, ["bluff", "disguise"]) }),
  focused: trait("Focused", "feat", "+2 Balance and Concentration.", { modifiers: skillsMod(2, ["balance", "concentration"]) }),
  gearhead: trait("Gearhead", "feat", "+2 Computers and Repair.", { modifiers: skillsMod(2, ["computer_use", "repair"]) }),
  guide: trait("Guide", "feat", "+2 Navigate and Survival.", { modifiers: skillsMod(2, ["navigate", "survival"]) }),
  medical_expert: trait("Medic", "feat", "+2 Craft (medicines) and First Aid.", { modifiers: skillsMod(2, ["craft_pharmaceutical", "treat_injury"]) }),
  meticulous: trait("Meticulous", "feat", "+2 Forgery and Search.", { modifiers: skillsMod(2, ["forgery", "search"]) }),
  nimble: trait("Nimble", "feat", "+2 Slip Free and Deft Hands.", { modifiers: skillsMod(2, ["escape_artist", "sleight_of_hand"]) }),
  studious: trait("Studious", "feat", "+2 Decipher Writing and Research.", { modifiers: skillsMod(2, ["decipher_script", "research"]) }),
  trustworthy: trait("Trustworthy", "feat", "+2 Persuade and Gather Rumours.", { modifiers: skillsMod(2, ["diplomacy", "gather_information"]) }),
  vehicle_expert: trait("Driver", "feat", "+2 Drive and Pilot.", { modifiers: skillsMod(2, ["drive", "pilot"]) }),

  // What each level of a class gives.
  talent: trait("Talent", "class feature", "One talent of the class that gave this level: take it as a trait."),
  class_bonus_feat: trait("Class Feat", "class feature", "One more feat of those the class that gave this level offers."),

  // Strong.
  extreme_effort: trait("Extreme Effort", "talent", "+2 on a Strength check that takes a full round: name it.", { requires: "class_level(self, 'strong') >= 1" }),
  improved_extreme_effort: trait("Extreme Effort, Improved", "talent", "+2 more on that check (+4).", { requires: has("extreme_effort") }),
  advanced_extreme_effort: trait("Extreme Effort, Advanced", "talent", "+2 more on that check (+6).", { requires: has("improved_extreme_effort") }),
  ignore_hardness: trait("Break Through", "talent", "Ignores 2 of an object's hardness when it strikes it.", { requires: "class_level(self, 'strong') >= 1" }),
  improved_ignore_hardness: trait("Break Through, Improved", "talent", "Ignores 2 more (4).", { requires: has("ignore_hardness") }),
  advanced_ignore_hardness: trait("Break Through, Advanced", "talent", "Ignores 2 more (6).", { requires: has("improved_ignore_hardness") }),
  melee_smash: trait("Melee Smash", "talent", "+1 melee damage.", { modifiers: [mod("damage.melee", 1)], requires: "class_level(self, 'strong') >= 1" }),
  improved_melee_smash: trait("Melee Smash, Improved", "talent", "+1 more melee damage (+2).", { modifiers: [mod("damage.melee", 1)], requires: has("melee_smash") }),
  advanced_melee_smash: trait("Melee Smash, Advanced", "talent", "+1 more melee damage (+3).", { modifiers: [mod("damage.melee", 1)], requires: has("improved_melee_smash") }),

  // Fast.
  uncanny_dodge_2: trait("Cannot Be Flanked", "talent", "No one gains for flanking it.", { requires: has("uncanny_dodge") }),
  defensive_roll: trait("Defensive Roll", "talent", "Once a day, a blow that would leave it at 0 hit points or less asks for a Reflex save against the harm; made, it takes half (the Defensive Roll gauge).", { requires: has("evasion") }),
  opportunist: trait("Opportunist", "talent", "Spends an action point to strike at a foe another has just hit, as an attack of opportunity.", { requires: has("evasion") }),
  increased_speed: trait("Quick Feet", "talent", "+5 speed.", { modifiers: [mod("speed", 5)], requires: "class_level(self, 'fast') >= 1" }),
  improved_increased_speed: trait("Quick Feet, Improved", "talent", "+5 more speed (+10).", { modifiers: [mod("speed", 5)], requires: has("increased_speed") }),
  advanced_increased_speed: trait("Quick Feet, Advanced", "talent", "+5 more speed (+15).", { modifiers: [mod("speed", 5)], requires: has("improved_increased_speed") }),

  // Tough.
  damage_reduction_1: trait("Hard Skin", "talent", "Harm of every kind from a weapon loses 1.", { modifiers: [mod("reduction", 1, { bypass: [] })], requires: `${has("remain_conscious")} or ${has("energy_resistance")}` }),
  damage_reduction_2: trait("Hard Skin, Improved", "talent", "Harm from a weapon loses 2.", { modifiers: [mod("reduction", 2, { bypass: [] })], requires: has("damage_reduction_1") }),
  damage_reduction_3: trait("Hard Skin, Advanced", "talent", "Harm from a weapon loses 3.", { modifiers: [mod("reduction", 3, { bypass: [] })], requires: has("damage_reduction_2") }),
  energy_resistance: trait("Resistant", "talent", "Harm of the kind taken as its choice (acid, cold, electricity, fire or sonic) loses as much as its Constitution modifier; taken once for each kind.", {
    modifiers: [mod("resist.{choice}", "max(0, mod(self, 'con'))", { note: "Constitution" })],
    requires: "class_level(self, 'tough') >= 1",
  }),
  remain_conscious: trait("Stays Up", "talent", "Below 0 hit points but above -10 it may keep acting, as one disabled, for a round; then it falls.", { requires: "class_level(self, 'tough') >= 1" }),
  robust: trait("Robust", "talent", "As many more hit points as its Tough levels.", { modifiers: [mod("hp", "class_level(self, 'tough')")], requires: has("remain_conscious") }),
  second_wind: trait("Second Wind", "talent", "Spends an action point for as many hit points back as its Constitution modifier.", { requires: has("remain_conscious") }),
  stamina: trait("Stamina", "talent", "Heals twice as fast with rest.", { requires: has("robust") }),

  // Smart.
  savant: trait("Savant", "talent", "+ its Smart levels on the skill taken as its choice.", { modifiers: [mod("skill.{choice}", "class_level(self, 'smart')")], requires: "class_level(self, 'smart') >= 1" }),
  linguist: trait("Linguist", "talent", "+ its Smart levels on reading or understanding a language it does not know.", { requires: has("savant") }),
  exploit_weakness: trait("Exploit Weakness", "talent", "After a round of watching a foe, it uses Intelligence for Strength or Dexterity on its attacks against it: name the difference as the attack's modifier.", { requires: "class_level(self, 'smart') >= 1" }),
  plan: trait("Plan", "talent", "Before a fight, a check against 10 gives allies who follow the plan +1 to +3 on their checks for it: put it on as an effect.", { requires: "class_level(self, 'smart') >= 1" }),
  trick: trait("Trick", "talent", "A ruse against one foe: a contest of Intelligence against its Intelligence or Wisdom, won, leaves it unable to act for a round.", { requires: "class_level(self, 'smart') >= 1" }),

  // Dedicated.
  empathy: trait("Empathy", "talent", "After a minute of watching someone, + its Dedicated levels on Deceive, Persuade, Handle Animals, Intimidate, Perform and Read People with them: name it.", { requires: "class_level(self, 'dedicated') >= 1" }),
  improved_aid_another: trait("Better Help", "talent", "Its help gives one more than others' does: name it.", { requires: has("empathy") }),
  intuition: trait("Intuition", "talent", "A Will save against 15 tells it whether a thing it is about to do is a good or a bad idea.", { requires: has("empathy") }),
  healing_knack: trait("Healing Knack", "talent", "+2 First Aid.", { modifiers: skillsMod(2, ["treat_injury"]), requires: "class_level(self, 'dedicated') >= 1" }),
  healing_touch_1: trait("Healing Touch", "talent", "2 more hit points back from its first aid kit or its surgery.", { requires: has("healing_knack") }),
  healing_touch_2: trait("Healing Touch, Improved", "talent", "2 more again (4).", { requires: has("healing_touch_1") }),
  skill_emphasis: trait("Skill Emphasis", "talent", "+3 on the skill taken as its choice.", { modifiers: [mod("skill.{choice}", 3)], requires: "class_level(self, 'dedicated') >= 1" }),
  aware: trait("Aware", "talent", "Adds its base Will to Listen and Spot against being surprised: name it.", { requires: has("skill_emphasis") }),
  faith: trait("Faith", "talent", "Adds its Wisdom modifier to a roll it spends an action point on: name it.", { requires: has("skill_emphasis") }),
  cool_under_pressure: trait("Cool Under Pressure", "talent", "Takes 10 under pressure on as many skills as 3 + its Wisdom modifier, chosen when it takes this.", { requires: has("faith") }),

  // Charismatic.
  charm: trait("Charm", "talent", "+ its Charismatic levels on its Charisma skills with those of one sex: name it.", { requires: "class_level(self, 'charismatic') >= 1" }),
  favor: trait("Favour", "talent", "A check of d20 + its Charismatic levels asks a favour of someone it knows; the GM sets how hard.", { requires: has("charm") }),
  captivate: trait("Captivate", "talent", "Holds one listener's whole attention for a few rounds: a Will save against 10 + its Charismatic levels + its Charisma modifier resists it.", { requires: has("favor") }),
  fast_talk: trait("Fast Talk", "talent", "+ its Charismatic levels on Deceive, Persuade and Gather Rumours.", {
    modifiers: ["bluff", "diplomacy", "gather_information"].map((s) => mod(`skill.${s}`, "class_level(self, 'charismatic')", { type: "competence" })),
    requires: "class_level(self, 'charismatic') >= 1",
  }),
  dazzle: trait("Dazzle", "talent", "A Charisma check against a foe's Will save leaves it -1 to attack, checks and saves for a few rounds: put it on as an effect.", { requires: has("fast_talk") }),
  coordinate: trait("Coordinate", "talent", "A Charisma check against 10 gives allies who can hear it + its Charismatic levels (+1 to +3) on one task: put it on as an effect.", { requires: "class_level(self, 'charismatic') >= 1" }),
  inspiration: trait("Inspire", "talent", "A full round of words gives allies +2 morale on saves, attacks and damage for a few rounds: put it on as an effect.", { requires: has("coordinate") }),
  greater_inspiration: trait("Inspire, Greater", "talent", "As Inspire, +3 in place of +2.", { requires: has("inspiration") }),

  // Occupations: what someone did before the story; the skills chosen become class skills.
  occupation_academic: occupation("Scholar", 3, ["computer_use", "craft_writing", "decipher_script", "gather_information", "investigate", ...ALL_LORE, "research", "search"]),
  occupation_adventurer: occupation("Adventurer", 2, ["climb", "demolitions", "disable_device", "drive", "escape_artist", "intimidate", "jump", ...lore("streetwise", "tactics"), "move_silently", "navigate", "pilot", "survival", "swim", "treat_injury"], ["Old Weapons", "Brawler", "Personal Firearms"]),
  occupation_athlete: occupation("Athlete", 2, ["climb", "jump", "ride", "swim", "tumble"], ["Old Weapons", "Athletic", "Brawler"]),
  occupation_blue_collar: occupation("Trades", 3, [...craft("electronic", "mechanical", "structural"), "drive", "handle_animal", "intimidate", "repair"]),
  occupation_celebrity: occupation("Celebrity", 1, ["bluff", ...craft("visual_art", "writing"), "diplomacy", "disguise", "perform"], [], [mod("reputation", 1, { note: "well known" })]),
  occupation_creative: occupation("Artist", 3, ["bluff", "computer_use", ...craft("visual_art", "writing"), "disguise", "forgery", ...lore("art"), "perform", "spot"]),
  occupation_criminal: occupation("Criminal", 2, ["disable_device", "gather_information", "hide", ...lore("streetwise"), "move_silently", "sleight_of_hand"], ["Brawler", "Personal Firearms"]),
  occupation_dilettante: occupation("Idle Rich", 1, ["gamble", "intimidate", ...lore("current_events", "popular_culture"), "ride", "spot"]),
  occupation_doctor: occupation("Doctor", 2, [...craft("pharmaceutical"), "computer_use", ...lore("behavioral_sciences", "earth_life_sciences", "technology"), "search", "treat_injury"]),
  occupation_emergency_services: occupation("Rescue Worker", 2, ["balance", "climb", "computer_use", "drive", "jump", ...lore("behavioral_sciences", "earth_life_sciences"), "search", "swim", "treat_injury"]),
  occupation_entrepreneur: occupation("Businessperson", 2, ["bluff", "diplomacy", "gamble", ...lore("business", "current_events", "streetwise", "technology")]),
  occupation_investigative: occupation("Investigator", 2, ["computer_use", ...craft("visual_art", "writing"), "decipher_script", "forgery", "gather_information", "investigate", ...lore("behavioral_sciences", "civics", "earth_life_sciences", "streetwise"), "research", "search", "sense_motive"], ["Brawler", "Personal Firearms"]),
  occupation_law_enforcement: occupation("Police", 2, ["diplomacy", "drive", "gather_information", "intimidate", ...lore("behavioral_sciences", "civics", "earth_life_sciences", "streetwise", "tactics"), "listen"], ["Fighting Art", "Light Armour Training", "Personal Firearms"]),
  occupation_military: occupation("Soldier", 2, ["climb", "demolitions", "drive", "hide", ...lore("tactics"), "move_silently", "navigate", "pilot", "survival", "swim"], ["Brawler", "Fighting Art", "Light Armour Training", "Personal Firearms"]),
  occupation_religious: occupation("Clergy", 2, ["decipher_script", ...lore("arcane_lore", "art", "behavioral_sciences", "history", "streetwise", "theology_philosophy"), "listen", "sense_motive"]),
  occupation_rural: occupation("Country", 2, ["balance", "climb", "drive", "handle_animal", "repair", "ride", "survival", "swim"], ["Brawler", "Personal Firearms"]),
  occupation_student: occupation("Student", 3, ["computer_use", ...ALL_CRAFT, ...ALL_LORE, "perform", "research"]),
  occupation_technician: occupation("Technician", 3, ["computer_use", ...craft("chemical", "electronic", "mechanical", "structural"), ...lore("business", "earth_life_sciences", "physical_sciences", "technology"), "repair", "research"]),
  occupation_white_collar: occupation("Office", 2, ["computer_use", "diplomacy", ...lore("behavioral_sciences", "business", "civics", "theology_philosophy"), "research"]),
};

// ---------------------------------------------------------------- conditions

/** Helplessness: Dexterity as 0, and no class or armour defence (defence 5 + size). */
const DEFENCELESS: JsonObject[] = [DEX_ZERO, mod("defended", 0, { limit: true, note: "no class or armour defence" })];
const BLIND_SKILLS = ["balance", "climb", "escape_artist", "hide", "jump", "move_silently", "search", "sleight_of_hand", "swim", "tumble"];

const conditionRows: Record<string, TableRow> = {
  ...Object.fromEntries(Object.entries(SHARED_CONDITIONS).filter(([id]) => id !== "raging")),
  blinded: condition("Blinded", "Sees nothing: no Dexterity bonus to defence, half speed, -4 on Search and most Strength and Dexterity skills; every foe has total concealment from it (half its attacks miss).", [NO_DEX, HALF_SPEED, ...skillsMod(-4, BLIND_SKILLS)], ["flat", "blind", "half_speed"]),
  blown_away: condition("Blown Away", "Knocked down and rolled 1d4 x 10 feet by the wind, taking 1d4 nonlethal each 10 feet: put prone on too."),
  checked: condition("Held Back", "The wind keeps it from moving against it."),
  deafened: condition("Deafened", "-4 initiative; fails every Listen check.", [mod("initiative", -4)], ["deaf"]),
  disabled: condition("Disabled", "At 0 hit points: a move or an attack action a turn, not both, at half speed; an attack or anything strenuous then costs 1 hit point.", [HALF_SPEED], ["one_action", "half_speed"]),
  dying: condition("Dying", "Below 0 hit points: unconscious, and each of its turns a Fortitude save against 20 steadies it, else it loses 1 hit point.", [], ["no_actions", "helpless"]),
  grappling: condition("Grappled", "Held with a foe: nothing but a bare-handed or light weapon's attack, or breaking free; no Dexterity bonus to defence against others.", [NO_DEX], ["flat", "held"]),
  helpless: condition("Helpless", "Bound, asleep or paralysed: defence is 5 + size, with no Dexterity, class or armour bonus; it can be slain with one blow.", DEFENCELESS, ["helpless", "flat", "no_actions"]),
  paralyzed: condition("Paralysed", "Cannot move or act, only think: its Strength and Dexterity count as 0, and it is helpless.", DEFENCELESS, ["helpless", "flat", "no_actions"]),
  pinned: condition("Pinned", "Held down in a grapple: -4 defence against melee and no Dexterity bonus to it; cannot move.", [mod("ac.melee", -4), NO_DEX], ["flat", "held"]),
  prone: condition("Prone", "On the ground: -4 to its melee attacks, -2 to its ranged ones; -4 defence against melee, +4 against ranged attacks from beyond the next square; standing is a move action.", [mod("attack.melee", -4), mod("attack.ranged", -2), mod("ac.melee", -4), mod("ac.ranged", 4)]),
  unconscious: condition("Unconscious", "Knocked out: helpless, defence 5 + size.", DEFENCELESS, ["helpless", "flat", "no_actions"]),
};

// ---------------------------------------------------------------- weapons

/** The weapons table's extra columns: the magazine's kind, the weapon's size and hands, splash harm, and its rules in words. */
const MODERN_WEAPON_COLUMNS: Record<string, ColumnDef> = {
  ...WEAPON_COLUMNS,
  magazine_kind: { type: "text", optional: true, doc: "box, cylinder, internal or linked: what reloading it takes" },
  size: { type: "text", optional: true, doc: "The weapon's own size: tiny and small are light, large takes two hands, huge two hands and a rest" },
  hands: { type: "text", optional: true, doc: "How it is held: one, two, or two braced on a rest or a mount" },
  splash: { type: "int", optional: true, doc: "Harm to everyone within 5 feet of where it bursts" },
  text: { type: "text", optional: true, doc: "What it does beyond its numbers, in words" },
};

const BALLISTIC = ["ballistic"];
/** Fire modes: a shot each time it is worked by hand; semi-automatic; select-fire; automatic only. */
const FIRE = { single: ["single"], semi: ["single", "semi"], select: ["single", "semi", "auto"], auto: ["auto"] } as const;
/** No critical hit: no natural die reaches it. */
const NO_CRITICAL = 21;

interface GunMore {
  proficiency?: string;
  types?: string[];
  threat?: number;
  multiplier?: number;
  area?: number;
  save?: JsonObject;
  hands?: string;
  text?: string;
  modifiers?: JsonObject[];
}

/** A weapon that fires: its damage, range increment, fire modes, magazine and its kind, size and hands. */
function gun(label: string, damage: string, range: number | null, fire: readonly string[], magazine: number | null, kind: "box" | "cylinder" | "internal" | "linked" | null, size: string, hands: string, more: GunMore = {}): TableRow {
  return {
    label,
    damage,
    threat: more.threat ?? 20,
    multiplier: more.multiplier ?? 2,
    ...(range !== null ? { range } : {}),
    proficiency: more.proficiency ?? "personal_firearms",
    held: "projectile",
    types: more.types ?? BALLISTIC,
    ...(fire.length > 0 ? { fire: [...fire] } : {}),
    ...(magazine !== null ? { magazine } : {}),
    ...(kind !== null ? { magazine_kind: kind } : {}),
    ...(more.area !== undefined ? { area: more.area } : {}),
    ...(more.save !== undefined ? { save: more.save } : {}),
    size,
    hands,
    ...(more.text !== undefined ? { text: more.text } : {}),
    ...(more.modifiers !== undefined ? { modifiers: more.modifiers } : {}),
  };
}

const handgun = (label: string, damage: string, range: number, fire: readonly string[], magazine: number, kind: "box" | "cylinder" | "internal", size: string, more: GunMore = {}): TableRow => gun(label, damage, range, fire, magazine, kind, size, "one", more);
const longarm = (label: string, damage: string, range: number, fire: readonly string[], magazine: number, kind: "box" | "internal" | "linked", size: string, more: GunMore = {}): TableRow => gun(label, damage, range, fire, magazine, kind, size, size === "huge" ? "two, braced" : "two", more);

const SHOTGUN = "Its damage drops by 1 for each range increment past the first: name it with the harm.";
const LONGARM = "-4 to attack a foe in the next square.";

/** A weapon of the hand: damage, threat, training, how it is held, its damage types and size. */
function melee(label: string, damage: string, threat: number, proficiency: string, held: string, types: string[], size: string, more: { range?: number; nonlethal?: true; finesse?: true; text?: string } = {}): TableRow {
  return {
    label,
    damage,
    threat,
    multiplier: 2,
    ...(more.range !== undefined ? { range: more.range } : {}),
    proficiency,
    held,
    types,
    ...(more.nonlethal ? { nonlethal: true } : {}),
    ...(more.finesse ? { finesse: true } : {}),
    size,
    hands: held === "two" ? "two" : "one",
    ...(more.text !== undefined ? { text: more.text } : {}),
  };
}

/** A thing that bursts: its harm and types, the burst's radius, the Reflex save's difficulty (half on a success), its range increment thrown, size and rules. */
function blast(label: string, damage: string, types: string[], radius: number | null, dc: number | null, range: number | null, size: string, text: string, more: { splash?: number; threat?: number } = {}): TableRow {
  return {
    label,
    damage,
    threat: more.threat ?? NO_CRITICAL,
    multiplier: more.threat !== undefined ? 2 : 1,
    ...(range !== null ? { range } : {}),
    proficiency: "",
    held: "thrown",
    types,
    ...(radius !== null ? { area: radius } : {}),
    ...(dc !== null ? { save: { save: "ref", dc, half: true } } : {}),
    ...(more.splash !== undefined ? { splash: more.splash } : {}),
    size,
    hands: "one",
    text,
  };
}

const S = ["slashing"];
const P = ["piercing"];
const B = ["bludgeoning"];

const weaponRows: Record<string, TableRow> = {
  // Handguns.
  pistol_9mm: handgun("Pistol, 9mm", "2d6", 40, FIRE.semi, 15, "box", "small"),
  pistol_9mm_compact: handgun("Pistol, 9mm, pocket", "2d6", 30, FIRE.semi, 8, "box", "tiny"),
  pistol_9mm_high_capacity: handgun("Pistol, 9mm, high-capacity", "2d6", 30, FIRE.semi, 17, "box", "small"),
  pistol_10mm: handgun("Pistol, 10mm", "2d6", 40, FIRE.semi, 15, "box", "small"),
  pistol_10mm_slim: handgun("Pistol, 10mm, slim", "2d6", 30, FIRE.semi, 9, "box", "small"),
  pistol_45: handgun("Pistol, .45", "2d6", 30, FIRE.semi, 7, "box", "small"),
  pistol_32: handgun("Pistol, .32", "2d4", 30, FIRE.semi, 7, "box", "small"),
  pistol_50: handgun("Pistol, .50 magnum", "2d8", 40, FIRE.semi, 8, "box", "medium"),
  derringer: handgun("Derringer, two-shot", "2d6", 10, FIRE.single, 2, "internal", "tiny"),
  revolver_22: handgun("Revolver, .22", "2d4", 20, FIRE.semi, 6, "cylinder", "tiny"),
  revolver_38: handgun("Revolver, .38", "2d6", 30, FIRE.semi, 6, "cylinder", "small"),
  revolver_357: handgun("Revolver, .357 magnum", "2d6", 40, FIRE.semi, 6, "cylinder", "medium"),
  revolver_44: handgun("Revolver, .44 magnum", "2d8", 30, FIRE.semi, 6, "cylinder", "medium"),
  machine_pistol_9mm: handgun("Machine pistol, 9mm", "2d6", 40, FIRE.select, 32, "box", "medium"),
  machine_pistol_9mm_compact: handgun("Machine pistol, 9mm, compact", "2d6", 30, FIRE.select, 20, "box", "medium"),
  machine_pistol_45: handgun("Machine pistol, .45", "2d6", 40, FIRE.select, 30, "box", "medium"),
  machine_pistol_32: handgun("Machine pistol, .32", "2d4", 40, FIRE.select, 20, "box", "medium"),
  // Longarms.
  assault_rifle_556: longarm("Assault rifle, 5.56mm", "2d8", 80, FIRE.select, 30, "box", "large", { text: LONGARM }),
  carbine_556: longarm("Carbine, 5.56mm", "2d8", 60, FIRE.select, 30, "box", "large", { text: LONGARM }),
  rifle_ar15: longarm("Rifle, semi-automatic 5.56mm", "2d8", 80, FIRE.semi, 30, "box", "large", { text: LONGARM }),
  assault_rifle_762r: longarm("Assault rifle, 7.62mm short", "2d8", 70, FIRE.select, 30, "box", "large", { text: LONGARM }),
  battle_rifle_762: longarm("Battle rifle, 7.62mm", "2d10", 90, FIRE.select, 20, "box", "large", { text: LONGARM }),
  smg_9mm: longarm("Submachine gun, 9mm", "2d6", 50, FIRE.select, 30, "box", "large", { text: LONGARM }),
  smg_9mm_short: longarm("Submachine gun, 9mm, short", "2d6", 40, FIRE.select, 15, "box", "medium", { text: LONGARM }),
  smg_9mm_20: longarm("Submachine gun, 9mm, 20 rounds", "2d6", 40, FIRE.select, 20, "box", "large", { text: LONGARM }),
  sniper_rifle_762: longarm("Sniper rifle, 7.62mm", "2d10", 90, FIRE.semi, 5, "box", "large", { text: LONGARM }),
  sniper_rifle_50: longarm("Sniper rifle, .50", "2d12", 120, FIRE.semi, 11, "box", "huge", { text: LONGARM }),
  rifle_hunting_308: longarm("Hunting rifle, bolt-action", "2d10", 80, FIRE.single, 5, "internal", "large", { text: LONGARM }),
  rifle_lever_action: longarm("Rifle, lever-action", "2d10", 90, FIRE.semi, 6, "internal", "large", { text: LONGARM }),
  rifle_22: longarm("Rifle, .22", "2d4", 50, FIRE.semi, 10, "box", "large", { text: LONGARM }),
  shotgun_12ga: longarm("Shotgun, pump-action 12 gauge", "2d8", 30, FIRE.single, 6, "internal", "large", { text: `${SHOTGUN} ${LONGARM}` }),
  shotgun_12ga_semi: longarm("Shotgun, semi-automatic 12 gauge", "2d8", 40, FIRE.semi, 7, "internal", "large", { text: `${SHOTGUN} ${LONGARM}` }),
  shotgun_12ga_box: longarm("Shotgun, 12 gauge, box-fed", "2d8", 30, FIRE.semi, 5, "box", "large", { text: `${SHOTGUN} ${LONGARM}` }),
  shotgun_10ga: longarm("Shotgun, pump-action 10 gauge", "2d10", 30, FIRE.single, 5, "internal", "large", { text: `${SHOTGUN} ${LONGARM}` }),
  shotgun_sawed_off: longarm("Shotgun, sawed-off", "2d8", 10, FIRE.semi, 2, "internal", "medium", { text: `${SHOTGUN} Loaded full, both barrels at once: -2 to attack and one more die, both shells (the shot \`double\`, which needs no feat with it).` }),
  machine_gun_medium: longarm("Machine gun, medium", "2d10", 100, FIRE.auto, 100, "linked", "huge", { text: `Fires only automatic. A belt of linked rounds feeds it. ${LONGARM}` }),
  // Heavy weapons, each its own training.
  machine_gun_heavy: gun("Machine gun, heavy", "2d12", 110, FIRE.auto, 100, "linked", "huge", "two, mounted", { proficiency: "heavy_machine_guns", text: "Fires only automatic, from a mount. A belt of linked rounds feeds it." }),
  rocket_launcher: gun("Rocket launcher, light", "10d6", 150, FIRE.single, 1, "internal", "large", "two", {
    proficiency: "rocket_launchers",
    types: [],
    threat: NO_CRITICAL,
    multiplier: 1,
    area: 10,
    save: { save: "ref", dc: 18, half: true },
    text: "Readying the tube is a move action; it arms only 30 feet or more away, and is thrown away once fired. Its rocket bursts as an explosive does: name the square and give its harm to all within 10 feet. It ignores 10 of an object's hardness.",
  }),
  grenade_launcher: gun("Grenade launcher", "3d6", 70, FIRE.single, 1, "internal", "large", "two", {
    proficiency: "grenade_launchers",
    types: S,
    threat: NO_CRITICAL,
    multiplier: 1,
    area: 10,
    save: { save: "ref", dc: 15, half: true },
    text: "Fires a 40mm grenade at a square, as an explosive thrown farther: its harm is the round's (a fragmentation round's here).",
  }),
  // Other ranged weapons.
  compound_bow: gun("Compound bow", "1d8", 40, [], null, null, "large", "two", { proficiency: "archaic", types: P, modifiers: [mod("damage.weapon.compound_bow", "mod(self, 'str')", { note: "Strength" })], text: "Adds its archer's Strength to damage." }),
  crossbow: gun("Crossbow", "1d10", 40, FIRE.single, 1, "internal", "medium", "two", { proficiency: "simple", types: P, threat: 19, text: "Loading a bolt is a move action." }),
  flamethrower: gun("Flamethrower", "3d6", null, FIRE.single, 10, "internal", "large", "two", {
    proficiency: "",
    types: ["fire"],
    threat: NO_CRITICAL,
    multiplier: 1,
    save: { save: "ref", dc: 15, half: true },
    text: "No attack roll: a line 5 feet wide and 30 long, everyone in it harmed, a Reflex save against 15 for half (cover adds to the save). Name who stands in the line. What it harms burns for 1d6 a round until put out.",
  }),
  javelin: melee("Javelin", "1d6", 20, "simple", "thrown", P, "medium", { range: 30, text: "In the hand, it is always used untrained." }),
  pepper_spray: gun("Pepper spray", "0", 5, FIRE.single, 1, "internal", "tiny", "one", { proficiency: "simple", types: [], threat: NO_CRITICAL, multiplier: 1, text: "A touch attack (say touch), no farther than 5 increments: a hit asks for a Fortitude save against 15, or blinded for 1d4 rounds." }),
  shuriken: melee("Throwing star", "1", 20, "archaic", "thrown", P, "tiny", { range: 10 }),
  taser: gun("Taser", "1d4", 5, FIRE.single, 1, "internal", "small", "one", { proficiency: "simple", types: ["electricity"], threat: NO_CRITICAL, multiplier: 1, text: "A hit asks for a Fortitude save against 15, or paralysed for 1d6 rounds. Reloading it takes a full round." }),
  whip: gun("Whip", "1d2", 15, [], null, null, "small", "one", { proficiency: "simple", types: S, text: "Reaches 15 feet and no farther, with no penalty for range; trips with a touch attack, and adds +2 to disarm." }),
  // Melee weapons.
  unarmed_strike: CORE_WEAPONS.unarmed_strike ?? {},
  club: CORE_WEAPONS.club ?? {},
  brass_knuckles: melee("Brass knuckles", "1d4", 20, "simple", "light", B, "tiny"),
  cleaver: melee("Cleaver", "1d6", 19, "simple", "light", S, "small"),
  knife: melee("Knife", "1d4", 19, "simple", "light", P, "tiny", { range: 10, finesse: true }),
  hunting_knife: melee("Hunting knife", "1d4", 19, "simple", "light", P, "tiny", { range: 10, finesse: true }),
  metal_baton: melee("Baton", "1d6", 19, "simple", "one", B, "medium"),
  baton_expandable: melee("Expandable baton", "1d6", 19, "simple", "one", B, "medium"),
  tonfa: melee("Side-handle baton", "1d6", 20, "simple", "one", B, "medium"),
  sap: melee("Sap", "1d6", 20, "simple", "light", B, "small", { nonlethal: true }),
  stun_gun: melee("Stun gun", "1d3", 20, "simple", "light", ["electricity"], "tiny", { text: "A touch (say touch): a hit asks for a Fortitude save against 15, or paralysed for 1d4 rounds." }),
  pistol_whip: melee("Pistol, as a club", "1d4", 20, "simple", "light", B, "small"),
  rifle_butt: melee("Rifle butt", "1d6", 20, "simple", "two", B, "large"),
  hatchet: melee("Hatchet", "1d6", 20, "archaic", "light", S, "small", { range: 10 }),
  machete: melee("Machete", "1d6", 19, "archaic", "light", S, "small"),
  straight_razor: melee("Straight razor", "1d4", 19, "archaic", "light", S, "tiny", { finesse: true }),
  sword_cane: melee("Sword cane", "1d6", 18, "archaic", "one", P, "medium"),
  longsword: melee("Longsword", "1d8", 19, "archaic", "one", S, "medium"),
  rapier: melee("Rapier", "1d6", 18, "archaic", "one", P, "medium", { finesse: true }),
  spear: melee("Spear", "1d8", 20, "archaic", "two", P, "large", { range: 20 }),
  quarterstaff: { ...melee("Quarterstaff", "1d6", 20, "archaic", "two", B, "large"), double: true },
  kukri: melee("Kukri", "1d4", 18, "exotic_melee", "light", S, "small"),
  nunchaku: melee("Nunchaku", "1d6", 20, "exotic_melee", "light", B, "small"),
  chainsaw: melee("Chainsaw", "3d6", 20, "exotic_melee", "two", S, "large", { text: "Starting it is a move action." }),
  // Explosives and splash weapons: no attack roll within one range increment, a roll against defence 10 beyond it; who stands in the burst saves (`harm` with a centre and radius).
  grenade_fragmentation: blast("Fragmentation grenade", "4d6", S, 20, 15, 10, "tiny", "Pulling the pin is a free action."),
  grenade_40mm: blast("40mm fragmentation round", "3d6", S, 10, 15, null, "tiny", "Fired only from a grenade launcher, and arms only 40 feet or more away."),
  plastic_explosive: blast("Plastic explosive, one block", "4d6", ["concussion"], 10, 18, null, "small", "Each block more adds 2d6 and 2 feet; joining them is an Explosives check against 15. It needs a detonator."),
  detonating_cord: blast("Detonating cord, 50 feet", "2d6", ["fire"], null, 12, null, "medium", "Laid through up to ten squares, it harms everyone in each; doubled back in one square, +1d6 for each 5 feet more, 4d6 more at most. It needs a detonator."),
  dynamite: blast("Dynamite, one stick", "2d6", ["concussion"], 5, 15, 10, "tiny", "Each stick more within the first's burst adds 1d6 (10d6 at most) and 5 feet (20 at most). Lighting the fuse is a move action."),
  grenade_smoke: blast("Smoke grenade", "0", [], null, null, 10, "small", "Smoke fills the four squares about it, then 10 feet, then 15: total concealment inside (half of attacks through it miss), gone after ten rounds, sooner in wind."),
  grenade_tear_gas: blast("Tear gas grenade", "0", [], null, null, 10, "small", "Gas spreads 5, 10, then 15 feet over three rounds: a Fortitude save against 15 each round inside, or nauseated while inside and 1d6 rounds after; a gas mask keeps it out, a wet cloth gives +2. Gone after ten rounds, four in a moderate wind, one in a strong one."),
  grenade_thermite: blast("Thermite grenade", "6d6", ["fire"], 5, 12, 10, "small", "Burns through what it lies on."),
  grenade_white_phosphorus: blast("White phosphorus grenade", "2d6", ["fire"], 20, 12, 10, "small", "Those it harms take 1d6 fire more the next round and may catch fire; it smokes within 5 feet."),
  acid_flask: blast("Acid, a flask", "1d6", ["acid"], null, null, 10, "tiny", "A touch attack (say touch) at one foe: the harm to it, 1 to all within 5 feet; thrown at a square, only the splash.", { splash: 1, threat: 20 }),
  fire_bottle: blast("Fire bottle", "1d6", ["fire"], null, null, 10, "small", "Lighting the rag is a move action; it bursts in two rounds or when it strikes. A touch attack (say touch) at one foe: the harm to it, 1 to all within 5 feet, and 1d6 fire more the next round to the one struck.", { splash: 1, threat: 20 }),
};

// ---------------------------------------------------------------- armour

/** The armour table's extra columns: its weight class, its kind, its bonus untrained, and the speed it leaves of 30 feet. */
const MODERN_ARMOR_COLUMNS: Record<string, ColumnDef> = {
  weight: ARMOR_COLUMNS.weight ?? { type: "text" },
  kind: { type: "text", optional: true, doc: "impromptu, concealable, tactical or archaic" },
  unskilled_bonus: { type: "int", doc: "What it adds to defence for a wearer without its training" },
  speed: { type: "int", doc: "The speed it leaves a wearer whose speed is 30 feet" },
};

/**
 * Modern armour: an armour bonus to defence, its lesser bonus for a wearer without its training, the most Dexterity it lets count,
 * its check penalty and the speed it leaves of 30 feet. The training's lack and helplessness each take their share off its bonus.
 */
function vest(label: string, weight: "light" | "medium" | "heavy", kind: string, bonus: number, unskilled: number, maxDex: number, check: number, speed: number): TableRow {
  const level = { light: 1, medium: 2, heavy: 3 }[weight];
  return {
    label,
    bonus,
    type: "armor",
    max_dex: maxDex,
    check,
    weight,
    kind,
    unskilled_bonus: unskilled,
    speed,
    modifiers: [
      mod("armor_weight", level, { limit: true, note: `${weight} armour` }),
      ...(unskilled < bonus ? [mod("ac", unskilled - bonus, { type: "armor", when: `not has_trait(self, 'armor_${weight}') and ${DEFENDED}`, note: "worn without its training" })] : []),
      mod("ac", -bonus, { type: "armor", when: HELPLESS, note: "helpless" }),
      ...(speed < 30 ? [mod("speed", speed === 25 ? -5 : "self.base_speed >= 30 ? -10 : -5", { note: label })] : []),
    ],
  };
}

const armorRows: Record<string, TableRow> = {
  leather_jacket: vest("Leather jacket", "light", "impromptu", 1, 1, 8, 0, 30),
  leather_armor: vest("Leather armour", "light", "archaic", 2, 1, 6, 0, 30),
  undercover_shirt: vest("Undercover shirt", "light", "concealable", 2, 1, 7, 0, 30),
  pouch_vest: vest("Pull-up pouch vest", "light", "concealable", 2, 1, 6, -1, 30),
  undercover_vest: vest("Undercover vest", "light", "concealable", 3, 1, 5, -2, 30),
  concealable_vest: vest("Concealable vest", "medium", "concealable", 4, 2, 4, -3, 25),
  chainmail_shirt: vest("Chainmail shirt", "medium", "archaic", 5, 2, 2, -5, 20),
  light_duty_vest: vest("Light-duty vest", "medium", "tactical", 5, 2, 3, -4, 25),
  tactical_vest: vest("Tactical vest", "medium", "tactical", 6, 2, 2, -5, 25),
  special_response_vest: vest("Special response vest", "heavy", "tactical", 7, 3, 1, -6, 20),
  plate_mail: vest("Plate armour", "heavy", "archaic", 8, 3, 1, -6, 20),
  forced_entry_suit: vest("Forced-entry suit", "heavy", "tactical", 9, 3, 0, -8, 20),
  // The gear catalog's armour, by its own ids.
  body_armor_soft: vest("Soft body armour vest", "light", "concealable", 3, 1, 5, -2, 30),
  plate_carrier: vest("Plate carrier", "heavy", "tactical", 7, 3, 1, -6, 20),
  helmet_ballistic: { ...vest("Ballistic helmet", "light", "tactical", 1, 1, 8, 0, 30), modifiers: [mod("armor_weight", 1, { limit: true, note: "light armour" })] },
};

// ---------------------------------------------------------------- people by trade

/** A stat block's worn armour, as `wearing` keeps it: its bonus, the most Dexterity it lets count, its penalty and its speed. */
function wears(label: string, bonus: number, maxDex: number, check: number, speed = 0): JsonObject {
  return wearing(label, [mod("ac", bonus, { type: "armor" }), mod("max_dex", maxDex, { limit: true }), ...(check < 0 ? [mod("armor_check", check)] : []), ...(speed < 0 ? [mod("speed", speed)] : [])]);
}

/** An ordinary person: no action points of a hero's. */
const ORDINARY = { action_points: 0, base_speed: 30, size: "medium" };

const creatureRows: Record<string, TableRow> = {
  police_officer: {
    name: "Police officer",
    kind: "person",
    fields: {
      ...ORDINARY,
      str: 12, dex: 14, con: 13, int: 10, wis: 12, cha: 10,
      classes: { tough: 2 }, hit_dice: 16, hp: 18,
      d20_traits: ["personal_firearms_proficiency", "armor_light", "point_blank_shot", "remain_conscious", { id: "occupation_law_enforcement", choice: "drive" }, { id: "occupation_law_enforcement", choice: "intimidate" }],
      d20_effects: [wears("Soft body armour vest", 3, 5, -2)],
      ranks: { drive: 5, intimidate: 5, spot: 5 },
    },
    carries: ["pistol_9mm", "baton_expandable", "pepper_spray"],
    cr: "1",
    description: "A patrol officer in a vest under the uniform shirt, with a pistol, a baton and pepper spray, and a radio to call for more.",
  },
  thug: {
    name: "Thug",
    kind: "person",
    fields: {
      ...ORDINARY,
      str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 10,
      classes: { strong: 1 }, hit_dice: 8, hp: 9,
      d20_traits: ["brawl", "personal_firearms_proficiency", "melee_smash", { id: "occupation_criminal", choice: "hide" }, { id: "occupation_criminal", choice: "knowledge_streetwise" }],
      d20_effects: [wears("Leather jacket", 1, 8, 0)],
      ranks: { climb: 4, jump: 2, knowledge_streetwise: 2 },
    },
    carries: ["revolver_38", "brass_knuckles"],
    cr: "1/2",
    description: "Hired muscle in a leather jacket, quick with his fists and slower to draw the cheap revolver in his waistband.",
  },
  security_guard: {
    name: "Security guard",
    kind: "person",
    fields: {
      ...ORDINARY,
      str: 13, dex: 11, con: 14, int: 10, wis: 12, cha: 9,
      classes: { tough: 1 }, hit_dice: 10, hp: 12,
      d20_traits: ["personal_firearms_proficiency", "armor_light", "remain_conscious"],
      d20_effects: [wears("Soft body armour vest", 3, 5, -2)],
      ranks: { spot: 4, intimidate: 4, drive: 4 },
    },
    carries: ["pistol_9mm", "baton_expandable"],
    cr: "1/2",
    description: "A guard on a night round of a warehouse or an office block, with a holstered pistol he hopes never to draw.",
  },
  soldier: {
    name: "Soldier",
    kind: "person",
    fields: {
      ...ORDINARY,
      str: 14, dex: 13, con: 13, int: 10, wis: 12, cha: 8,
      classes: { strong: 3 }, hit_dice: 18, hp: 21,
      d20_traits: ["personal_firearms_proficiency", "advanced_firearms_proficiency", "armor_light", "armor_medium", "melee_smash", "improved_melee_smash", { id: "occupation_military", choice: "hide" }, { id: "occupation_military", choice: "navigate" }],
      d20_effects: [wears("Tactical vest", 6, 2, -5, -5)],
      ranks: { climb: 6, jump: 6, knowledge_tactics: 6 },
    },
    carries: ["assault_rifle_556", "pistol_9mm", "grenade_fragmentation"],
    cr: "2",
    description: "An infantry soldier in a tactical vest, with an assault rifle, a sidearm and a grenade, trained to fire in bursts.",
  },
  bystander: {
    name: "Bystander",
    kind: "person",
    fields: {
      ...ORDINARY,
      str: 10, dex: 10, con: 10, int: 11, wis: 10, cha: 12,
      classes: { charismatic: 1 }, hit_dice: 6, hp: 6,
      d20_traits: ["alertness", "trustworthy", "fast_talk"],
      ranks: { diplomacy: 4, bluff: 4, gather_information: 4, knowledge_current_events: 4, knowledge_popular_culture: 4, perform: 4, profession: 4 },
    },
    cr: "1/4",
    description: "Someone going about the day, who talks easily and wants no part of a fight.",
  },
  guard_dog: {
    name: "Guard dog",
    kind: "person",
    fields: {
      str: 15, dex: 15, con: 15, int: 2, wis: 12, cha: 6,
      racial_hd: 2, hit_dice: 9, hp: 13, natural_armor: 4, base_speed: 40, size: "medium", action_points: 0,
      d20_traits: ["animal", "natural_armor", "low_light_vision", "scent", "trip_bite", "alertness"],
      ranks: { listen: 2, spot: 2, jump: 2, survival: 1 },
    },
    attacks: [natural("Bite", "1d6", { types: P, held: "two" })],
    cr: "1",
    description: "A big trained dog kept to guard a yard, that bites and drags an intruder down by the leg.",
  },
};

// ---------------------------------------------------------------- experience, challenges, difficulties

const difficultyRows: Record<string, TableRow> = {
  ...DIFFICULTIES,
  superheroic: difficulty("Superheroic", 35, "Beyond nearly everyone."),
};

// ---------------------------------------------------------------- the ruleset's part

const DAILY: Record<string, FieldDef> = {
  defensive_roll: dailyGauge("Defensive roll", "has_trait(self, 'defensive_roll') ? 1 : 0"),
};

/** The level action points and their dice go by: the level experience has reached, or the class levels if more. */
const LEVEL: Expr = "max(self.level, levels(self))";
/** A night's rest, and an hour's for nonlethal harm: one hit point for each level or hit die. */
const PER_LEVEL: Expr = "max(1, levels(self) + self.racial_hd)";
const NEGATIVE: Expr = "self.hp < 0 and self.hp > -10";
/** Class defence, lost while helpless. */
const CLASS_DEFENCE: Expr = "min(class_sum(self, 'defence'), limit(self, 'defended', 99))";

/** The shots a firearm can make: what each needs of the weapon, the rounds it spends, what it adds, and the trait it wants. */
const SHOTS: Record<string, ShotDef> = {
  single: { needs: "single", rounds: 1 },
  double: { needs: "semi", rounds: 2, attack: -2, dice: 1, trait: "double_tap" },
  burst: { needs: "auto", rounds: 5, attack: -4, dice: 2, trait: "burst_fire" },
  auto: { needs: "auto", rounds: 10, area: 10, save: "ref", dc: 15, trait: "advanced_firearms_proficiency" },
};

/** The full round, as the budgets spend it. */
const FULL_ROUND = { standard: 1, move: 1, full: 1 };

/** The weapon's way of being held, as damage asks whether it is melee or ranged. */
const HELD: Expr = `table('${T.weapons}', weapon, 'held')`;

const D20: D20Def = {
  abilities: [...D20_ABILITY_IDS],
  mod: ABILITY_MOD,
  kinds: ["person"],
  defaultSize: "medium",
  bonuses: { stack: ["dodge", "circumstance"], penaltiesStack: true },
  tables: { ...T },
  totals: {
    // Modern's defence: Dexterity, the class's bonus, what is worn and size; damage asks for melee or ranged damage too.
    ...familyTotals({ skills: T.skills, weapons: T.weapons, defence: CLASS_DEFENCE }),
    damage: `bonus(self, 'damage.weapon.' + weapon + (${HELD} == 'projectile' or ${HELD} == 'thrown' ? ',damage.ranged' : ',damage.melee'))`,
    grapple: "class_sum(self, 'attack') + bonus(self, 'base_attack') + mod(self, 'str') + size_mod(self, 'grapple') + bonus_without(self, 'grapple', 'size')",
    reputation: "class_sum(self, 'reputation') + bonus(self, 'reputation')",
    damage_threshold: "score(self, 'con') + bonus(self, 'damage_threshold')",
    action_dice: `${LEVEL} >= 15 ? 3 : ${LEVEL} >= 8 ? 2 : 1`,
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
    shots: SHOTS,
  },
  hp: {
    field: "hp",
    nonlethal: "nonlethal",
    temporary: "hp_temp",
    states: [
      { id: "dead", when: "self.hp <= -10", life: "dead" },
      { id: "stable", when: `${NEGATIVE} and under(self, 'stable')` },
      { id: "dying", when: `${NEGATIVE} and not under(self, 'stable')`, life: "dying" },
      { id: "unconscious", when: NEGATIVE },
      { id: "disabled", when: "self.hp == 0" },
    ],
    dying: {
      state: "dying",
      lose: 1,
      stable: "stable",
      roll: {
        id: "stabilize",
        dice: "1d20",
        modifier: "total(self, 'save.fort')",
        dc: "20",
        bands: [{ outcome: "worse", natural: { max: 1 } }, { outcome: "stable", natural: { min: 20 } }, { outcome: "stable", margin: { min: 0 } }, { outcome: "worse" }],
        pass: ["stable"],
      },
    },
    massive: { when: "amount >= total(self, 'damage_threshold') and self.hp >= 0", save: "fort", dc: 15, hp: "-1" },
    rest: { hours: 8, hp: PER_LEVEL, nonlethal: PER_LEVEL, daily: Object.keys(DAILY) },
  },
  costs: {
    ...D20_COSTS,
    "reload.box": { move: 1 },
    "reload.cylinder": FULL_ROUND,
    "reload.internal": FULL_ROUND,
    "reload.linked": FULL_ROUND,
  },
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

/** The fight's budgets: an attack action (the standard), a move, the full round and free actions; no swift or immediate one. */
const BUDGETS: Record<string, CombatBudgetDef> = Object.fromEntries(
  Object.entries(D20_BUDGETS)
    .filter(([id]) => id !== "swift" && id !== "immediate")
    .map(([id, b]) => [id, id === "standard" ? { ...b, label: "Attack action" } : b]),
);

export const MODERN: D20SetDef = {
  id: "modern",
  label: "Modern",
  summary:
    "Present-day adventure on a d20: six abilities, six classes with levels that add up, a defence of Dexterity, class, armour and size, skills with ranks, feats, talents and occupations as traits, firearms with single shots, double taps, bursts and automatic fire, modern armour and explosives, action points each level gives, Reputation, a damage threshold, hit points down through dying to dead, and experience by challenge.",
  fields: {
    ...d20Fields({ hpFloor: -10, rest: PER_LEVEL, sizes: T.sizes, daily: DAILY }),
    action_points: { type: "number", label: "Action points", min: 0, pool: { max: `5 * ${LEVEL} + floor(${LEVEL} * ${LEVEL} / 4)` } },
  },
  checks: {},
  actions: {},
  tables: {
    [T.skills]: d20Table("skills", T.skills, "Modern skills", skillRows),
    [T.classes]: d20Table("classes", T.classes, "Modern classes", classRows),
    [T.tracks]: d20Table("tracks", T.tracks, "Modern progressions", trackRows, TRACK_COLUMNS),
    [T.traits]: d20Table("traits", T.traits, "Modern traits", traitRows),
    [T.conditions]: d20Table("conditions", T.conditions, "Modern conditions", conditionRows),
    [T.sizes]: d20Table("sizes", T.sizes, "Modern sizes", sizeRows((steps) => [mod("grapple", steps * 4, { type: "size" }), mod("skill.hide", steps * -4, { type: "size" })]), SIZE_COLUMNS),
    [T.weapons]: d20Table("weapons", T.weapons, "Modern weapons", weaponRows, MODERN_WEAPON_COLUMNS),
    [T.armor]: d20Table("armor", T.armor, "Modern armour", armorRows, MODERN_ARMOR_COLUMNS),
    [T.creatures]: d20Table("creatures", T.creatures, "Modern people and animals", creatureRows),
    [T.experience]: d20Table("experience", T.experience, "Modern experience", experienceRows(20)),
    [T.challenges]: d20Table("challenges", T.challenges, "Modern challenges", CHALLENGE_ROWS),
    [T.difficulties]: d20Table("difficulties", T.difficulties, "Modern difficulties", difficultyRows),
  },
  ruleset: {
    progression: {
      level: {
        label: "Level",
        xpField: "xp",
        levelField: "level",
        thresholds: { table: T.experience, column: "xp" },
        maxLevel: 20,
        // A new level gives 5 + half the level in action points; a rest gives none back.
        onLevel: [{ type: "add", args: { entity: "self", field: "action_points", delta: "=5 + floor(level / 2)" } }],
      },
    },
    sheet: d20Sheet({
      defence: {
        label: "Defence",
        rows: [
          { formula: "total(self, 'ac')", label: "Defence" },
          { formula: "total(self, 'ac.touch')", label: "Against a touch" },
          { formula: "total(self, 'ac.flat')", label: "Flat-footed" },
          { formula: signedTotal("initiative"), label: "Initiative" },
          { formula: "total(self, 'speed')", label: "Speed" },
          { formula: "total(self, 'damage_threshold')", label: "Damage threshold" },
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
      vitals: [{ pool: "action_points" }, { formula: "total(self, 'action_dice') + 'd6'", label: "Action point dice" }, { formula: signedTotal("reputation"), label: "Reputation" }],
    }),
    minLevels: {},
    adjudication: presetAdjudication("balanced"),
    combat: { ...d20Combat("self.hp < 0 or under(self, 'unconscious')"), economy: BUDGETS },
    d20: D20,
  },
};
