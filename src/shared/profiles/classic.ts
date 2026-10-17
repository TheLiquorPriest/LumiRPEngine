// The Classic profile (DESIGN §11): classic fantasy on a d20. Six abilities; an attack bonus on a
// good, average or poor progression and saves on good or poor ones, read from a level table;
// skills with ranks; an armor score; HP from a die per level; levels from XP on the triangular
// scale. An original implementation of common tabletop mechanics: no rules text.

import { presetAdjudication } from "../adjudication";
import type { FieldDef } from "../world";
import type { ProfileDef } from "./types";
import { abilityFields, abilityRows, attackAction, ATTACK_BANDS, attemptCheck, DIFFICULTY, holdsStance, INITIATIVE_BANDS, levelFields, levelRows, profileTable, rankFields, restAction, saveAction, signed, skillAction, skillTable, stanceAction, triangularXp, type Skill } from "./parts";

const SKILLS: readonly Skill[] = [
  { id: "athletics", label: "Athletics", ability: "str_mod" },
  { id: "acrobatics", label: "Acrobatics", ability: "dex_mod" },
  { id: "stealth", label: "Stealth", ability: "dex_mod" },
  { id: "sleight_of_hand", label: "Deft Hands", ability: "dex_mod" },
  { id: "search", label: "Search", ability: "int_mod" },
  { id: "lore", label: "Lore", ability: "int_mod" },
  { id: "heal", label: "First Aid", ability: "wis_mod" },
  { id: "perception", label: "Perception", ability: "wis_mod" },
  { id: "sense_motive", label: "Read People", ability: "wis_mod" },
  { id: "survival", label: "Survival", ability: "wis_mod" },
  { id: "diplomacy", label: "Persuade", ability: "cha_mod" },
  { id: "bluff", label: "Deceive", ability: "cha_mod" },
  { id: "intimidate", label: "Intimidate", ability: "cha_mod" },
];

/** Each save, its ability, and the progression a new character starts on. */
const SAVES: readonly (Skill & { track: string })[] = [
  { id: "fortitude", label: "Fortitude", ability: "con_mod", track: "good" },
  { id: "reflex", label: "Reflex", ability: "dex_mod", track: "poor" },
  { id: "will", label: "Will", ability: "wis_mod", track: "poor" },
];

const SKILL_MOD = "field(self, skill) + field(self, table('classic.skills', skill, 'ability'))";

const saves: Record<string, FieldDef> = {};
for (const s of SAVES) {
  saves[`${s.id}_track`] = { type: "enum", label: `${s.label} progression`, values: ["good", "poor"], default: s.track };
  saves[s.id] = { type: "number", label: s.label, derived: `table('classic.levels', self.level, 'save_' + self.${s.id}_track) + self.${s.ability}` };
}

export const CLASSIC: ProfileDef = {
  id: "classic",
  label: "Classic",
  summary: "Classic fantasy on a d20: an attack bonus on a good, average or poor track and saves on good or poor ones, skills with ranks, an armor score, HP that grows by a die each level, and levels from XP.",
  fields: {
    ...abilityFields(),
    ...levelFields(20),
    attack_track: { type: "enum", label: "Base attack progression", values: ["good", "average", "poor"], default: "average" },
    bab: { type: "number", label: "Base attack", derived: "table('classic.levels', self.level, 'attack_' + self.attack_track)" },
    ...saves,
    hit_die: { type: "number", label: "Hit die", default: 8, min: 4, max: 12 },
    // The hit die's top at first level, then its average rounded up each level, Constitution added every time.
    max_hp: { type: "number", label: "Max HP", derived: "max(1, self.hit_die + self.con_mod + (self.level - 1) * max(1, floor(self.hit_die / 2) + 1 + self.con_mod))" },
    hp: { type: "number", label: "HP", pool: { max: "max_hp", recover: "max(1, self.level)" } },
    armor: { type: "number", label: "Armor bonus", default: 0, min: 0 },
    // Total defense adds 4 until the defender's next turn.
    ac: { type: "number", label: "Armor Class", derived: `10 + self.armor + self.dex_mod + (${holdsStance("self", "defend")} ? 4 : 0)` },
    damage: { type: "dice", label: "Damage", default: "1d8" },
    ...rankFields(SKILLS, 23),
  },
  checks: {
    skill: attemptCheck("skill", SKILL_MOD),
    save: { id: "save", dice: "d20", modifier: "field(self, save)", dc: DIFFICULTY },
    attack: { id: "attack", dice: "d20", modifier: "self.bab + self.str_mod", dc: "target.ac", bands: ATTACK_BANDS, pass: ["hit", "critical"] },
    initiative: { id: "initiative", dice: "d20", modifier: "self.dex_mod", bands: INITIATIVE_BANDS },
  },
  actions: {
    skill_check: skillAction("classic.skills"),
    save_check: saveAction("classic.saves"),
    attack: attackAction("roll(self.damage) + self.str_mod", "roll(self.damage) + roll(self.damage) + self.str_mod"),
    total_defense: stanceAction("total_defense", "Total defense", "defend"),
    long_rest: restAction("Rest for the night"),
  },
  tables: {
    "classic.levels": profileTable(
      "classic.levels",
      "Classic levels",
      {
        xp: { type: "int", doc: "XP the level needs" },
        attack_good: { type: "int" },
        attack_average: { type: "int" },
        attack_poor: { type: "int" },
        save_good: { type: "int" },
        save_poor: { type: "int" },
      },
      levelRows((level) => ({
        xp: triangularXp(level),
        attack_good: level,
        attack_average: Math.floor((level * 3) / 4),
        attack_poor: Math.floor(level / 2),
        save_good: 2 + Math.floor(level / 2),
        save_poor: Math.floor(level / 3),
      })),
    ),
    "classic.skills": skillTable("classic.skills", "Classic skills", SKILLS),
    "classic.saves": skillTable("classic.saves", "Classic saves", SAVES),
  },
  ruleset: {
    progression: { level: { label: "Level", xpField: "xp", levelField: "level", thresholds: { table: "classic.levels", column: "xp" }, maxLevel: 20 } },
    sheet: {
      sections: [
        { id: "vitals", label: "Vitals", rows: [{ pool: "hp" }, { progression: "level" }, { formula: "self.ac", label: "Armor Class" }, { formula: signed("self.bab"), label: "Base attack" }, { formula: signed("self.dex_mod"), label: "Initiative" }] },
        { id: "abilities", label: "Abilities", rows: abilityRows() },
        { id: "saves", label: "Saves", rows: SAVES.map((s) => ({ formula: signed(`self.${s.id}`), label: s.label })) },
        { id: "skills", label: "Skills", rows: SKILLS.map((s) => ({ formula: signed(`self.${s.id} + self.${s.ability}`), label: s.label })) },
      ],
    },
    minLevels: { sheets: 3 },
    adjudication: presetAdjudication("balanced"),
    combat: { initiative: "initiative", economy: { action: { label: "Standard action" }, defend: { label: "Total defense" } }, hp: "hp" },
  },
};
