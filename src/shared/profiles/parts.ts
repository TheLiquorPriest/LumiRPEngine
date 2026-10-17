// Building blocks the ruleset profiles share (DESIGN §11): the six abilities and their modifiers,
// sheet rows that show a number with its sign, data tables with their computed revision, and the
// attempts, attacks and stances every d20-style profile has. Plain data built once at load: each
// profile is a world fragment the engine already understands, so nothing here runs during play.

import { hashJson } from "../hash";
import type { ColumnDef, DataTable, TableRow } from "../tables";
import type { ActionDef, CheckBand, CheckDef, EffectSpec, FieldDef, ParamDef, SheetRowDef } from "../world";

export interface Ability {
  id: string;
  label: string;
}

export const ABILITIES: readonly Ability[] = [
  { id: "str", label: "Strength" },
  { id: "dex", label: "Dexterity" },
  { id: "con", label: "Constitution" },
  { id: "int", label: "Intelligence" },
  { id: "wis", label: "Wisdom" },
  { id: "cha", label: "Charisma" },
];

/** A skill and the modifier field it adds (`dex_mod`). */
export interface Skill {
  id: string;
  label: string;
  ability: string;
}

/** The six scores (10 is average) and their modifiers, `floor((score − 10) / 2)`, as derived fields. */
export function abilityFields(): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  for (const a of ABILITIES) out[a.id] = { type: "number", label: a.label, default: 10, min: 1, max: 30 };
  for (const a of ABILITIES) out[`${a.id}_mod`] = { type: "number", label: `${a.label} modifier`, derived: `floor((self.${a.id} - 10) / 2)` };
  return out;
}

/** The level the engine sets from XP (locked, so no model proposes it) and the XP an author or an `award` adds. */
export function levelFields(maxLevel: number | null): Record<string, FieldDef> {
  return {
    level: { type: "number", label: "Level", default: 1, min: 1, ...(maxLevel !== null ? { max: maxLevel } : {}), locked: true },
    xp: { type: "number", label: "XP", default: 0, min: 0 },
  };
}

/** A formula that reads as the number with its sign: +2, +0, -1. */
export function signed(expr: string): string {
  return `(${expr} >= 0 ? '+' : '') + (${expr})`;
}

/** Sheet rows for the abilities, each a score with its modifier: "14 (+2)". */
export function abilityRows(): SheetRowDef[] {
  return ABILITIES.map((a) => ({ formula: `self.${a.id} + ' (' + ${signed(`self.${a.id}_mod`)} + ')'`, label: a.label }));
}

/** A data table the profile ships, with the revision the engine computes for any table. */
export function profileTable(id: string, label: string, columns: Record<string, ColumnDef>, rows: Record<string, TableRow>): DataTable {
  const schema = `lre-table/${id}/v1`;
  return { id, pack: "sheets", schema, revision: hashJson({ schema, columns, rows }), label, columns, rows };
}

/** Rows "1" to "20" of a level table, each worked out from its level. */
export function levelRows(row: (level: number) => TableRow): Record<string, TableRow> {
  const out: Record<string, TableRow> = {};
  for (let level = 1; level <= 20; level++) out[String(level)] = row(level);
  return out;
}

/** The XP a level needs on the triangular scale: 0, 1000, 3000, 6000… (1000 × level × (level − 1) / 2). */
export function triangularXp(level: number): number {
  return (1000 * level * (level - 1)) / 2;
}

/** A table of skills (or saves): each row's label, and the modifier field it adds. */
export function skillTable(id: string, label: string, skills: readonly Skill[]): DataTable {
  const rows: Record<string, TableRow> = {};
  for (const s of skills) rows[s.id] = { label: s.label, ability: s.ability };
  return profileTable(id, label, { label: { type: "text" }, ability: { type: "text", doc: "The modifier field the roll adds" } }, rows);
}

/** Skill ranks: how much training a character has put in, added to the skill's ability modifier. */
export function rankFields(skills: readonly Skill[], max: number): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  for (const s of skills) out[s.id] = { type: "number", label: s.label, default: 0, min: 0, max };
  return out;
}

/** What an attempt's DC reads: the difficulty given (a word or a number), else moderate, 10. */
export const DIFFICULTY = "difficulty_of(params.difficulty)";

export const DIFFICULTY_PARAM: ParamDef = { type: "text", optional: true, label: "Difficulty (easy, moderate, hard, very hard or a number)" };

/** Degrees of an attempt against a DC: short of it, made, or beaten by 10 or more. */
export const DEGREES: CheckBand[] = [
  { outcome: "failure", margin: { max: -1 } },
  { outcome: "success", margin: { min: 0, max: 9 } },
  { outcome: "great", margin: { min: 10 } },
];

/** An attack against a defense: a natural 1 always misses, a natural 20 is a critical, else the total against the defense. */
export const ATTACK_BANDS: CheckBand[] = [
  { outcome: "miss", natural: { max: 1 } },
  { outcome: "critical", natural: { min: 20 } },
  { outcome: "miss", margin: { max: -1 } },
  { outcome: "hit", margin: { min: 0 } },
];

/** Damage to the target's HP pool: the formula's total, at least 1. */
export function damage(expr: string): EffectSpec[] {
  return [{ type: "add", args: { entity: "target", field: "hp", delta: `=-max(1, ${expr})` } }];
}

/** A d20 check against an attempt's difficulty, with degrees. */
export function attemptCheck(id: string, modifier: string): CheckDef {
  return { id, dice: "d20", modifier, dc: DIFFICULTY, bands: DEGREES };
}

/** Initiative is read for its total only: one band that takes every roll, so no roll reads as none. */
export const INITIATIVE_BANDS: CheckBand[] = [{ outcome: "rolled" }];

/** Use a skill: one palette option per row of the skills table, each with its exact odds. */
export function skillAction(table: string): ActionDef {
  return {
    id: "skill_check",
    label: "Use a skill",
    params: { skill: { type: "text", label: "Skill", table }, difficulty: DIFFICULTY_PARAM },
    requires: [],
    check: "skill",
    outcomes: { failure: [], success: [], great: [] },
    duration: "10",
    lexicon: ["roll for", "skill check", "use my skill"],
    observable: "puts a skill to use",
  };
}

/** Make a save the story calls for: one option per row of the saves table. */
export function saveAction(table: string): ActionDef {
  return {
    id: "save_check",
    label: "Make a save",
    params: { save: { type: "text", label: "Save", table }, difficulty: DIFFICULTY_PARAM },
    requires: [],
    check: "save",
    outcomes: { failure: [], success: [] },
    duration: "1",
    lexicon: ["make a save", "saving throw", "try to resist"],
    observable: "braces against it",
  };
}

/** The attack every d20-style profile has: the `attack` check against a foe, damage from the attacker's damage dice. */
export function attackAction(hit: string, critical: string): ActionDef {
  return {
    id: "attack",
    label: "Attack",
    params: { target: { type: "ref", label: "Target" } },
    requires: ["is_foe(self, target)", "not is_down(target)"],
    check: "attack",
    outcomes: { critical: damage(critical), hit: damage(hit), miss: [] },
    duration: "0",
    lexicon: ["attack", "strike at", "shoot at", "swing at"],
    observable: "attacks",
    combat: { cost: { action: 1 }, role: "attack" },
  };
}

/**
 * A defensive stance for the turn: it spends the action and the stance's own budget, and the
 * defense formulas read that budget, spent, as "defending" until the defender's next turn refills it.
 * A budget belongs to the fight, so nothing is left over when the next one starts.
 */
export function stanceAction(id: string, label: string, budget: string): ActionDef {
  return {
    id,
    label,
    params: {},
    requires: [],
    outcomes: { default: [] },
    duration: "0",
    lexicon: [label.toLowerCase(), "defend myself", "take cover"],
    observable: "goes on the defensive",
    combat: { cost: { action: 1, [budget]: 1 }, role: "defend" },
  };
}

/** Whether `who` holds a stance this turn: in the fight, with the stance's budget spent. */
export function holdsStance(who: string, budget: string): string {
  return `in_encounter(${who}) and budget_left(${who}, '${budget}') == 0`;
}

/** A night's rest outside a fight: the HP pool recovers by its own `recover` (the max without one). */
export function restAction(label: string, more: EffectSpec[] = []): ActionDef {
  return {
    id: "long_rest",
    label,
    params: {},
    requires: ["not in_encounter(self)"],
    outcomes: { default: [{ type: "recover", args: { entity: "self", field: "hp" } }, ...more] },
    duration: "480",
    lexicon: ["rest for the night", "take a long rest"],
    observable: "settles down to rest",
  };
}
