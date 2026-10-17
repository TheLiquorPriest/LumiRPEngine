// The Fifth profile (DESIGN §11): heroic fantasy on a d20. Six abilities; a training bonus by
// level; training (or expertise) in skills and in two saves; advantage from a well-told approach
// and disadvantage against someone dodging; an armor score; healing dice spent on a short rest and
// regained on a long one. An original implementation of common tabletop mechanics: no rules text.

import { presetAdjudication } from "../adjudication";
import type { FieldDef } from "../world";
import type { ProfileDef } from "./types";
import { ABILITIES, abilityFields, abilityRows, attackAction, ATTACK_BANDS, attemptCheck, DIFFICULTY, holdsStance, INITIATIVE_BANDS, levelFields, levelRows, profileTable, restAction, saveAction, signed, skillAction, skillTable, stanceAction, type Skill } from "./parts";

const SKILLS: readonly Skill[] = [
  { id: "athletics", label: "Athletics", ability: "str_mod" },
  { id: "acrobatics", label: "Acrobatics", ability: "dex_mod" },
  { id: "sleight_of_hand", label: "Deft Hands", ability: "dex_mod" },
  { id: "stealth", label: "Stealth", ability: "dex_mod" },
  { id: "investigation", label: "Investigation", ability: "int_mod" },
  { id: "lore", label: "Lore", ability: "int_mod" },
  { id: "insight", label: "Read People", ability: "wis_mod" },
  { id: "medicine", label: "Medicine", ability: "wis_mod" },
  { id: "perception", label: "Perception", ability: "wis_mod" },
  { id: "survival", label: "Survival", ability: "wis_mod" },
  { id: "deception", label: "Deception", ability: "cha_mod" },
  { id: "intimidation", label: "Intimidation", ability: "cha_mod" },
  { id: "performance", label: "Performance", ability: "cha_mod" },
  { id: "persuasion", label: "Persuasion", ability: "cha_mod" },
];

/** The XP each level needs. */
const XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

/** A save adds the proficiency bonus when it is one of the character's two proficient saves (`save` names the ability). */
const proficientIn = (ability: string): string => `(self.save_prof_1 == ${ability} or self.save_prof_2 == ${ability}) ? self.proficiency : 0`;

/** How proficient a character is in each skill: 0 untrained, 1 proficient, 2 expertise (twice the bonus). */
const proficiencies: Record<string, FieldDef> = {};
for (const s of SKILLS) proficiencies[s.id] = { type: "number", label: s.label, default: 0, min: 0, max: 2 };

const abilityIds = ABILITIES.map((a) => a.id);

export const FIFTH: ProfileDef = {
  id: "fifth",
  label: "Fifth",
  summary: "Heroic fantasy on a d20: one training bonus that grows with level for your trained skills and saves, advantage, an armor score, and short and long rests that spend and regain healing dice.",
  fields: {
    ...abilityFields(),
    ...levelFields(20),
    proficiency: { type: "number", label: "Proficiency bonus", derived: "table('fifth.levels', self.level, 'proficiency')" },
    save_prof_1: { type: "enum", label: "Proficient save", values: abilityIds, default: "con" },
    save_prof_2: { type: "enum", label: "Second proficient save", values: abilityIds, default: "wis" },
    hit_die: { type: "number", label: "Hit die", default: 8, min: 6, max: 12 },
    max_hp: { type: "number", label: "Max HP", derived: "max(1, self.hit_die + self.con_mod + (self.level - 1) * max(1, floor(self.hit_die / 2) + 1 + self.con_mod))" },
    hp: { type: "number", label: "HP", pool: { max: "max_hp" } },
    // A long rest regains half the hit dice (at least one).
    hit_dice: { type: "number", label: "Hit dice", pool: { max: "level", recover: "max(1, floor(self.level / 2))" } },
    armor: { type: "number", label: "Armor (base AC)", default: 10, min: 0 },
    ac: { type: "number", label: "Armor Class", derived: "self.armor + self.dex_mod" },
    attack_bonus: { type: "number", label: "Attack bonus", derived: "self.proficiency + max(self.str_mod, self.dex_mod)" },
    damage: { type: "dice", label: "Damage", default: "1d8" },
    ...proficiencies,
  },
  checks: {
    skill: attemptCheck("skill", "field(self, table('fifth.skills', skill, 'ability')) + field(self, skill) * self.proficiency"),
    save: { id: "save", dice: "d20", modifier: `field(self, save + '_mod') + (${proficientIn("save")})`, dc: DIFFICULTY },
    // Attacks on someone dodging roll with disadvantage until their next turn.
    attack: { id: "attack", dice: "d20", modifier: "self.attack_bonus", advantage: `${holdsStance("target", "dodge")} ? -1 : 0`, dc: "target.ac", bands: ATTACK_BANDS, pass: ["hit", "critical"] },
    initiative: { id: "initiative", dice: "d20", modifier: "self.dex_mod", bands: INITIATIVE_BANDS },
  },
  actions: {
    skill_check: skillAction("fifth.skills"),
    save_check: saveAction("fifth.saves"),
    // A critical rolls the damage dice twice.
    attack: attackAction("roll(self.damage) + max(self.str_mod, self.dex_mod)", "roll(self.damage) + roll(self.damage) + max(self.str_mod, self.dex_mod)"),
    dodge: stanceAction("dodge", "Dodge", "dodge"),
    short_rest: {
      id: "short_rest",
      label: "Short rest (spend a hit die)",
      params: {},
      requires: ["not in_encounter(self)", "self.hit_dice >= 1"],
      outcomes: {
        default: [
          { type: "add", args: { entity: "self", field: "hit_dice", delta: -1 } },
          { type: "recover", args: { entity: "self", field: "hp", amount: "=max(1, roll('1d' + self.hit_die) + self.con_mod)" } },
        ],
      },
      duration: "60",
      lexicon: ["take a short rest", "catch my breath"],
      observable: "takes a breather",
    },
    long_rest: restAction("Long rest", [{ type: "recover", args: { entity: "self", field: "hit_dice" } }]),
  },
  tables: {
    "fifth.levels": profileTable(
      "fifth.levels",
      "Fifth levels",
      { xp: { type: "int", doc: "XP the level needs" }, proficiency: { type: "int", doc: "Proficiency bonus" } },
      levelRows((level) => ({ xp: XP[level - 1] ?? 0, proficiency: 2 + Math.floor((level - 1) / 4) })),
    ),
    "fifth.skills": skillTable("fifth.skills", "Fifth skills", SKILLS),
    "fifth.saves": skillTable("fifth.saves", "Fifth saves", ABILITIES.map((a) => ({ id: a.id, label: a.label, ability: `${a.id}_mod` }))),
  },
  ruleset: {
    // A new level brings a new hit die.
    progression: { level: { label: "Level", xpField: "xp", levelField: "level", thresholds: { table: "fifth.levels", column: "xp" }, maxLevel: 20, onLevel: [{ type: "add", args: { entity: "self", field: "hit_dice", delta: 1 } }] } },
    sheet: {
      sections: [
        { id: "vitals", label: "Vitals", rows: [{ pool: "hp" }, { pool: "hit_dice" }, { progression: "level" }, { formula: "self.ac", label: "Armor Class" }, { formula: signed("self.proficiency"), label: "Proficiency" }, { formula: signed("self.dex_mod"), label: "Initiative" }] },
        { id: "abilities", label: "Abilities", rows: abilityRows() },
        { id: "saves", label: "Saves", rows: ABILITIES.map((a) => ({ formula: signed(`self.${a.id}_mod + (${proficientIn(`'${a.id}'`)})`), label: a.label })) },
        { id: "skills", label: "Skills", rows: SKILLS.map((s) => ({ formula: signed(`self.${s.ability} + self.${s.id} * self.proficiency`), label: s.label })) },
      ],
    },
    minLevels: { sheets: 3 },
    // Balanced, except that a well-told approach earns advantage rather than a bonus.
    adjudication: { ...presetAdjudication("balanced"), preset: "custom", description: { weight: "advantage", max: 2, advantageAt: 2 } },
    combat: { initiative: "initiative", economy: { action: { label: "Action" }, dodge: { label: "Dodge" } }, hp: "hp" },
  },
};
