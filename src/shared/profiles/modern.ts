// The Modern profile (DESIGN §11): present-day adventure on a d20. Six abilities with their
// modifiers; Defense from Dexterity, a level bonus and equipment; a modern skill list with ranks;
// three saves; Action Points to push a skill; HP; and levels from XP on the triangular scale. An
// original implementation of common tabletop mechanics: no rules text.

import { presetAdjudication } from "../adjudication";
import type { FieldDef } from "../world";
import type { ProfileDef } from "./types";
import { abilityFields, abilityRows, attackAction, ATTACK_BANDS, attemptCheck, DEGREES, DIFFICULTY, DIFFICULTY_PARAM, holdsStance, INITIATIVE_BANDS, levelFields, levelRows, profileTable, rankFields, restAction, saveAction, signed, skillAction, skillTable, stanceAction, triangularXp, type Skill } from "./parts";

const SKILLS: readonly Skill[] = [
  { id: "athletics", label: "Athletics", ability: "str_mod" },
  { id: "drive", label: "Drive", ability: "dex_mod" },
  { id: "stealth", label: "Stealth", ability: "dex_mod" },
  { id: "computers", label: "Computers", ability: "int_mod" },
  { id: "investigate", label: "Investigate", ability: "int_mod" },
  { id: "repair", label: "Repair", ability: "int_mod" },
  { id: "notice", label: "Notice", ability: "wis_mod" },
  { id: "sense_motive", label: "Read People", ability: "wis_mod" },
  { id: "treat_injury", label: "First Aid", ability: "wis_mod" },
  { id: "persuade", label: "Persuade", ability: "cha_mod" },
  { id: "bluff", label: "Deceive", ability: "cha_mod" },
  { id: "intimidate", label: "Intimidate", ability: "cha_mod" },
];

const SAVES: readonly Skill[] = [
  { id: "fortitude", label: "Fortitude", ability: "con_mod" },
  { id: "reflex", label: "Reflex", ability: "dex_mod" },
  { id: "will", label: "Will", ability: "wis_mod" },
];

/** A skill's total: its ranks plus its ability's modifier, read through the skills table. */
const SKILL_MOD = "field(self, skill) + field(self, table('modern.skills', skill, 'ability'))";

const saves: Record<string, FieldDef> = {};
for (const s of SAVES) saves[s.id] = { type: "number", label: s.label, derived: `table('modern.levels', self.level, 'save') + self.${s.ability}` };

export const MODERN: ProfileDef = {
  id: "modern",
  label: "Modern",
  summary: "Present-day adventure on a d20: six abilities, a Defense score, a modern skill list with ranks, points to spend pushing a skill, HP, and levels from XP.",
  fields: {
    ...abilityFields(),
    ...levelFields(20),
    max_hp: { type: "number", label: "Max HP", derived: "max(1, 8 + self.con_mod + (self.level - 1) * max(1, 5 + self.con_mod))" },
    // A night's rest heals a point per level.
    hp: { type: "number", label: "HP", pool: { max: "max_hp", recover: "max(1, self.level)" } },
    ap_max: { type: "number", label: "Action Points max", derived: "5 + floor(self.level / 2)" },
    action_points: { type: "number", label: "Action Points", pool: { max: "ap_max" } },
    attack_bonus: { type: "number", label: "Attack bonus", derived: "table('modern.levels', self.level, 'attack') + max(self.str_mod, self.dex_mod)" },
    armor: { type: "number", label: "Equipment bonus", default: 0, min: 0 },
    // Total defense adds 4 until the defender's next turn.
    defense: { type: "number", label: "Defense", derived: `10 + self.dex_mod + table('modern.levels', self.level, 'defense') + self.armor + (${holdsStance("self", "defend")} ? 4 : 0)` },
    damage: { type: "dice", label: "Damage", default: "1d6" },
    reputation: { type: "number", label: "Reputation", default: 0, min: 0 },
    ...saves,
    ...rankFields(SKILLS, 23),
  },
  checks: {
    skill: attemptCheck("skill", SKILL_MOD),
    save: { id: "save", dice: "d20", modifier: "field(self, save)", dc: DIFFICULTY },
    attack: { id: "attack", dice: "d20", modifier: "self.attack_bonus", dc: "target.defense", bands: ATTACK_BANDS, pass: ["hit", "critical"] },
    initiative: { id: "initiative", dice: "d20", modifier: "self.dex_mod", bands: INITIATIVE_BANDS },
  },
  actions: {
    skill_check: skillAction("modern.skills"),
    // An Action Point adds 1d6 to the roll; the palette shows the better odds beside the plain ones.
    push_skill: {
      id: "push_skill",
      label: "Push a skill (Action Point)",
      params: { skill: { type: "text", label: "Skill", table: "modern.skills" }, difficulty: DIFFICULTY_PARAM },
      requires: ["self.action_points >= 1"],
      check: { id: "push_skill", dice: "d20+1d6", modifier: SKILL_MOD, dc: DIFFICULTY, bands: DEGREES },
      outcomes: Object.fromEntries(["failure", "success", "great"].map((o) => [o, [{ type: "add", args: { entity: "self", field: "action_points", delta: -1 } }]])),
      duration: "10",
      lexicon: ["spend an action point", "push myself", "dig deep"],
      observable: "pushes hard",
    },
    save_check: saveAction("modern.saves"),
    attack: attackAction("roll(self.damage) + self.str_mod", "roll(self.damage) + roll(self.damage) + self.str_mod"),
    total_defense: stanceAction("total_defense", "Total defense", "defend"),
    long_rest: restAction("Rest for the night"),
  },
  tables: {
    "modern.levels": profileTable(
      "modern.levels",
      "Modern levels",
      { xp: { type: "int", doc: "XP the level needs" }, attack: { type: "int", doc: "Base attack bonus" }, defense: { type: "int", doc: "Defense bonus" }, save: { type: "int", doc: "Base save bonus" } },
      levelRows((level) => ({ xp: triangularXp(level), attack: Math.floor((level * 3) / 4), defense: 1 + Math.floor(level / 2), save: 1 + Math.floor(level / 3) })),
    ),
    "modern.skills": skillTable("modern.skills", "Modern skills", SKILLS),
    "modern.saves": skillTable("modern.saves", "Modern saves", SAVES),
  },
  ruleset: {
    progression: {
      level: { label: "Level", xpField: "xp", levelField: "level", thresholds: { table: "modern.levels", column: "xp" }, maxLevel: 20, onLevel: [{ type: "recover", args: { entity: "self", field: "action_points", full: true } }] },
    },
    sheet: {
      sections: [
        {
          id: "vitals",
          label: "Vitals",
          rows: [{ pool: "hp" }, { pool: "action_points" }, { progression: "level" }, { formula: "self.defense", label: "Defense" }, { formula: signed("self.attack_bonus"), label: "Attack" }, { formula: signed("self.dex_mod"), label: "Initiative" }, { field: "reputation" }],
        },
        { id: "abilities", label: "Abilities", rows: abilityRows() },
        { id: "saves", label: "Saves", rows: SAVES.map((s) => ({ formula: signed(`self.${s.id}`), label: s.label })) },
        { id: "skills", label: "Skills", rows: SKILLS.map((s) => ({ formula: signed(`self.${s.id} + self.${s.ability}`), label: s.label })) },
      ],
    },
    minLevels: { sheets: 3 },
    adjudication: presetAdjudication("balanced"),
    combat: { initiative: "initiative", economy: { action: { label: "Action" }, defend: { label: "Total defense" } }, hp: "hp" },
  },
};
