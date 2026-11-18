// What the d20 rule sets share (RULESET-DESIGN §6): the set's shape, the six abilities, the fields every kind of the set's
// `ruleset.d20.kinds` carries (§4.6), the fight's budgets and initiative, the sheet's sections, the totals the family writes alike,
// and helpers that build the tables' rows. Each set (Classic, Classic Revised, Modern) is a world fragment written with these, and
// every number and formula of its game is in its own file: nothing here is a rule of one game, and nothing here runs during play.

import { D20_COLUMNS, D20_FIELDS, d20Schema, type D20Def, type D20TableRole } from "../d20";
import { hashJson } from "../hash";
import type { JsonObject } from "../json";
import type { ColumnDef, DataTable, TableRow } from "../tables";
import type { CombatBudgetDef, CombatDef, Expr, FieldDef, SheetLayoutDef, SheetRowDef, SheetSectionDef } from "../world";
import { ABILITIES, signed } from "./parts";
import type { ProfileDef } from "./types";

/** A d20 rule set: a profile whose ruleset carries the layer's part. */
export type D20SetDef = ProfileDef & { ruleset: ProfileDef["ruleset"] & { d20: D20Def } };

/** The six abilities' field ids, as `ruleset.d20.abilities` names them. */
export const D20_ABILITY_IDS: readonly string[] = ABILITIES.map((a) => a.id);

/** An ability's modifier from its score `x`. */
export const ABILITY_MOD: Expr = "floor((x - 10) / 2)";

// ---------------------------------------------------------------- rows

/** A modifier as a table's cell holds it. */
export function mod(to: string, value: number | Expr, more: { type?: string; when?: Expr; note?: string; limit?: true; bypass?: string[] } = {}): JsonObject {
  return { to, value, ...more };
}

/** A d20 table of a role: the role's columns and any more the set gives, its rows, and the revision the engine computes for any table. */
export function d20Table(role: D20TableRole, id: string, label: string, rows: Record<string, TableRow>, more: Record<string, ColumnDef> = {}): DataTable {
  const schema = d20Schema(role);
  const columns = { ...D20_COLUMNS[role], ...more };
  return { id, pack: "d20", schema, revision: hashJson({ schema, columns, rows }), label, columns, rows };
}

/** Rows "1" to `top`, each worked out from its level. */
export function byLevel(top: number, row: (level: number) => TableRow): Record<string, TableRow> {
  const out: Record<string, TableRow> = {};
  for (let level = 1; level <= top; level++) out[String(level)] = row(level);
  return out;
}

/** Each level's feature rows in a classes row's `features`: the levels that give any. */
export function features(at: Record<number, string[]>): JsonObject {
  const out: JsonObject = {};
  for (const [level, ids] of Object.entries(at)) out[level] = ids;
  return out;
}

/** A trait's row: what kind of thing it is, what it does in words, its modifiers, and what it grants and requires. */
export function trait(label: string, kind: string, text: string, more: { modifiers?: JsonObject[]; grants?: JsonObject; requires?: Expr } = {}): TableRow {
  return { label, kind, text, ...(more.modifiers !== undefined ? { modifiers: more.modifiers } : {}), ...(more.grants !== undefined ? { grants: more.grants } : {}), ...(more.requires !== undefined ? { requires: more.requires } : {}) };
}

/** A condition's row: what it does in words, its modifiers, and what holds under it. */
export function condition(label: string, text: string, modifiers: JsonObject[] = [], flags: string[] = []): TableRow {
  return { label, text, ...(modifiers.length > 0 ? { modifiers } : {}), ...(flags.length > 0 ? { flags } : {}) };
}

/** The family's sizes, smallest first, with the modifier each gives to attack and defence and its space and natural reach in feet. */
export const SIZES: readonly { id: string; label: string; ac: number; space: number; reach: number }[] = [
  { id: "fine", label: "Fine", ac: 8, space: 0.5, reach: 0 },
  { id: "diminutive", label: "Diminutive", ac: 4, space: 1, reach: 0 },
  { id: "tiny", label: "Tiny", ac: 2, space: 2.5, reach: 0 },
  { id: "small", label: "Small", ac: 1, space: 5, reach: 5 },
  { id: "medium", label: "Medium", ac: 0, space: 5, reach: 5 },
  { id: "large", label: "Large", ac: -1, space: 10, reach: 10 },
  { id: "huge", label: "Huge", ac: -2, space: 15, reach: 15 },
  { id: "gargantuan", label: "Gargantuan", ac: -4, space: 20, reach: 20 },
  { id: "colossal", label: "Colossal", ac: -8, space: 30, reach: 30 },
];

/** The sizes table's extra columns: space and natural reach. */
export const SIZE_COLUMNS: Record<string, ColumnDef> = {
  space: { type: "number", doc: "The side of the square it fills, in feet" },
  reach: { type: "int", doc: "How far it reaches with no weapon of reach, in feet" },
};

/** The sizes rows: each size's modifier to attack and defence (type `size`), and what else the set gives by steps above Medium (below: negative). */
export function sizeRows(others: (steps: number) => JsonObject[]): Record<string, TableRow> {
  const medium = SIZES.findIndex((s) => s.id === "medium");
  const out: Record<string, TableRow> = {};
  SIZES.forEach((s, i) => {
    out[s.id] = { label: s.label, order: i, modifiers: [mod("ac", s.ac, { type: "size" }), mod("attack", s.ac, { type: "size" }), ...others(i - medium)], space: s.space, reach: s.reach };
  });
  return out;
}

/** A weapon's damage one size up, as the family steps it (1d8 to 2d6). */
const LARGER: Readonly<Record<string, string>> = { "1": "1d2", "1d2": "1d3", "1d3": "1d4", "1d4": "1d6", "1d6": "1d8", "1d8": "2d6", "1d10": "2d8", "1d12": "3d6", "2d4": "2d6", "2d6": "3d6", "2d8": "3d8", "2d10": "4d8" };

/** The weapons table's extra columns. */
export const WEAPON_COLUMNS: Record<string, ColumnDef> = {
  finesse: { type: "bool", optional: true, doc: "Its wielder's Dexterity may stand for Strength on the attack, with the trait that allows it" },
  reach: { type: "int", optional: true, doc: "It strikes this far, in feet, and not at those beside its wielder" },
  double: { type: "bool", optional: true, doc: "A weapon with two ends, each striking as a weapon of its own" },
};

/** A weapon's row: damage for a Small and a Medium wielder (Large worked out a size up), threat, multiplier and the rest. */
export function weapon(label: string, small: string, medium: string, threat: number, multiplier: number, range: number | null, proficiency: string, held: string, types: string[], more: { nonlethal?: true; finesse?: true; reach?: number; double?: true; magazine?: number; modifiers?: JsonObject[] } = {}): TableRow {
  const large = LARGER[medium] ?? medium;
  return {
    label,
    damage: { small, medium, large },
    threat,
    multiplier,
    ...(range !== null ? { range } : {}),
    proficiency,
    held,
    types,
    ...(more.nonlethal ? { nonlethal: true } : {}),
    ...(more.finesse ? { finesse: true } : {}),
    ...(more.reach !== undefined ? { reach: more.reach } : {}),
    ...(more.double ? { double: true } : {}),
    ...(more.magazine !== undefined ? { magazine: more.magazine } : {}),
    ...(more.modifiers !== undefined ? { modifiers: more.modifiers } : {}),
  };
}

/** The armour table's extra columns. */
export const ARMOR_COLUMNS: Record<string, ColumnDef> = {
  weight: { type: "text", doc: "light, medium, heavy or shield" },
  spell_failure: { type: "int", optional: true, doc: "The chance in a hundred that a spell cast with the hands fails in it" },
};

/** An armour's or a shield's row: its bonus and type, most Dexterity, check penalty, and its own modifiers (speed, training). */
export function armor(label: string, weight: "light" | "medium" | "heavy" | "shield", bonus: number, maxDex: number | null, check: number, spellFailure: number, modifiers: JsonObject[] = []): TableRow {
  return { label, bonus, type: weight === "shield" ? "shield" : "armor", ...(maxDex !== null ? { max_dex: maxDex } : {}), check, weight, spell_failure: spellFailure, ...(modifiers.length > 0 ? { modifiers } : {}) };
}

/** A creature's own attack, as a stat block's `attacks` and a creature's `d20_attacks` hold it. */
export function natural(label: string, damage: string, more: { types?: string[]; bonus?: number; held?: string; secondary?: true; threat?: number; multiplier?: number; total?: string } = {}): JsonObject {
  return { label, damage, ...more };
}

/** A difficulty's row. */
export function difficulty(label: string, dc: number, text: string): TableRow {
  return { label, dc, text };
}

// ---------------------------------------------------------------- the kinds' fields (§4.6)

/** A gauge that fills again with a night's rest: its label and the most it holds, a formula with `self`. */
export function dailyGauge(label: string, max: Expr): FieldDef {
  return { type: "number", label, min: 0, pool: { max } };
}

/**
 * The fields every kind of a set's `ruleset.d20.kinds` carries: the six scores, hit points with their floor and what a night gives
 * back, nonlethal harm and temporary hit points, experience and the level it earns, the layer's lists, its size and hit dice, its own
 * hit dice beside its classes, its natural armour, its speed unarmoured, its challenge, and the set's daily gauges. The conditions
 * list is the person kind's own field (the space pack's), which the sheets pack shares, so a set does not give it again.
 */
export function d20Fields(opts: { hpFloor: number | Expr; rest: Expr; sizes: string; daily: Record<string, FieldDef> }): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  for (const a of ABILITIES) out[a.id] = { type: "number", label: a.label, default: 10, min: 0, max: 99 };
  return {
    ...out,
    hp: { type: "number", label: "Hit points", pool: { max: "hp_max", min: opts.hpFloor, recover: opts.rest } },
    hp_max: { type: "number", label: "Most hit points", derived: "total(self, 'hp.max')" },
    nonlethal: { type: "number", label: "Nonlethal harm", default: 0, min: 0 },
    hp_temp: { type: "number", label: "Temporary hit points", default: 0, min: 0 },
    xp: { type: "number", label: "Experience", default: 0, min: 0 },
    level: { type: "number", label: "Level by experience", default: 1, min: 1, locked: true },
    [D20_FIELDS.classes]: { type: "list", label: "Levels by class" },
    [D20_FIELDS.ranks]: { type: "list", label: "Skill ranks" },
    [D20_FIELDS.traits]: { type: "list", label: "Traits" },
    [D20_FIELDS.effects]: { type: "list", label: "Effects" },
    [D20_FIELDS.attacks]: { type: "list", label: "Own attacks" },
    [D20_FIELDS.size]: { type: "text", label: "Size", table: opts.sizes },
    [D20_FIELDS.hitDice]: { type: "number", label: "Hit dice kept", default: 0, min: 0 },
    racial_hd: { type: "number", label: "Own hit dice", default: 0, min: 0 },
    natural_armor: { type: "number", label: "Natural armour", default: 0, min: 0 },
    base_speed: { type: "number", label: "Speed unarmoured", default: 30, min: 0 },
    cr: { type: "text", label: "Challenge" },
    ...opts.daily,
  };
}

// ---------------------------------------------------------------- the totals the family writes alike (§4.4)

/**
 * The totals the three sets write alike, with the parts `explain` tells: a base, an ability, armour, shield, size, and what else
 * modifies the total. `vs` (melee or ranged), `weapon` (a weapons row) and `skill` (a skills row) are bound where they apply.
 * Dexterity counts to defence up to the lowest `max_dex` limit; a creature whose defence is read flat-footed keeps only a
 * Dexterity penalty (or all of it with `uncanny_dodge`) and loses its dodge bonuses. Base attack and saves come from the classes'
 * tracks and what modifies `base_attack` and each save; skills from ranks, the key ability, and what modifies the skill, the
 * armour's check penalty where the skills row says it applies.
 */
export function familyTotals(opts: { skills: string; weapons: string; defence?: string }): Record<string, Expr> {
  const dex = "mod(self, 'dex') - max(0, mod(self, 'dex') - limit(self, 'max_dex', 99))";
  const extra = opts.defence !== undefined ? ` + ${opts.defence}` : "";
  // Defence asks for `ac` and, where an attack is made, `ac.melee` or `ac.ranged` (prone, helpless).
  const vs = "'ac,ac.' + vs";
  const base = "class_sum(self, 'attack') + bonus(self, 'base_attack')";
  const finesse = `(table('${opts.weapons}', weapon, 'finesse') ? ',attack.finesse' : '')`;
  return {
    ac: `10 + bonus_only(self, 'ac', 'armor') + bonus_only(self, 'ac', 'shield') + ${dex}${extra} + size_mod(self, 'ac') + bonus_without(self, ${vs}, 'armor,shield,size')`,
    "ac.touch": `10 + ${dex}${extra} + size_mod(self, 'ac') + bonus_without(self, ${vs}, 'armor,shield,natural,size')`,
    "ac.flat": `10 + bonus_only(self, 'ac', 'armor') + bonus_only(self, 'ac', 'shield') + min(0, mod(self, 'dex'), limit(self, 'max_dex', 0)) + (has_trait(self, 'uncanny_dodge') ? max(0, min(mod(self, 'dex'), limit(self, 'max_dex', 99))) : 0)${extra} + size_mod(self, 'ac') + bonus_without(self, ${vs}, 'armor,shield,size,dodge')`,
    "attack.base": base,
    "attack.melee": `${base} + mod(self, 'str') + size_mod(self, 'attack') + bonus_without(self, 'attack.melee,attack.weapon.' + weapon + ${finesse}, 'size')`,
    "attack.ranged": `${base} + mod(self, 'dex') + size_mod(self, 'attack') + bonus_without(self, 'attack.ranged,attack.weapon.' + weapon, 'size')`,
    damage: "bonus(self, 'damage.weapon.' + weapon)",
    "save.fort": "class_sum(self, 'fort') + mod(self, 'con') + bonus(self, 'save.fort')",
    "save.ref": "class_sum(self, 'ref') + mod(self, 'dex') + bonus(self, 'save.ref')",
    "save.will": "class_sum(self, 'will') + mod(self, 'wis') + bonus(self, 'save.will')",
    initiative: "mod(self, 'dex') + bonus(self, 'initiative')",
    skill: `ranks(self, skill) + mod(self, table('${opts.skills}', skill, 'ability')) + bonus(self, 'skill.' + skill + (table('${opts.skills}', skill, 'armor') ? ',armor_check' : '')) + (table('${opts.skills}', skill, 'armor_times') == 2 ? bonus(self, 'armor_check') : 0)`,
    "hp.max": "hit_dice(self) + mod(self, 'con') * (levels(self) + self.racial_hd) + bonus(self, 'hp')",
    speed: "self.base_speed + bonus(self, 'speed')",
  };
}

/** The skills table's extra column: how many times the armour's check penalty counts where it applies (2 for swimming). */
export const SKILL_COLUMNS: Record<string, ColumnDef> = {
  armor_times: { type: "int", optional: true, doc: "How many times the armour's check penalty counts; absent, once" },
};

// ---------------------------------------------------------------- the fight (§5.3)

/** The fight's budgets: a standard, a move, a swift and an immediate action, the full round that takes the first two, and free actions. */
export const D20_BUDGETS: Record<string, CombatBudgetDef> = {
  standard: { label: "Standard action" },
  move: { label: "Move action" },
  full: { label: "Full-round action" },
  swift: { label: "Swift action" },
  immediate: { label: "Immediate action", per: "round", offTurn: true },
  free: { label: "Free action", count: 10 },
};

/** What the layer's actions spend in a fight: an attack a standard action, all of a high base attack's attacks the full round, a reload a move. */
export const D20_COSTS: Record<string, Record<string, number>> = {
  attack: { standard: 1 },
  "attack.full": { standard: 1, move: 1, full: 1 },
  reload: { move: 1 },
};

/** The fight's rules: initiative from the sheet's total, the budgets, hit points, and who is out of it. */
export function d20Combat(down: Expr): CombatDef {
  return {
    initiative: { id: "initiative", dice: "d20", modifier: "total(self, 'initiative')", bands: [{ outcome: "rolled" }] },
    tieBreak: "total(self, 'initiative')",
    economy: D20_BUDGETS,
    hp: "hp",
    down: { when: down },
    showHp: "wounds",
  };
}

// ---------------------------------------------------------------- the sheet

/** A total on the sheet with its sign. */
export function signedTotal(name: string, key?: string): string {
  return signed(key === undefined ? `total(self, '${name}')` : `total(self, '${name}', '${key}')`);
}

/** The abilities' rows: each score as modifiers leave it, with its modifier. */
export function abilityRows(): SheetRowDef[] {
  return ABILITIES.map((a) => ({ formula: `score(self, '${a.id}') + ' (' + ${signed(`mod(self, '${a.id}')`)} + ')'`, label: a.label }));
}

/** The sheet: who it is, defence, attack, saves, abilities, skills, the daily gauges, and what it has and is under. */
export function d20Sheet(opts: { defence: { label: string; rows: SheetRowDef[] }; attack: SheetRowDef[]; saves: { id: string; label: string }[]; skills: { id: string; label: string }[]; daily: string[]; vitals?: SheetRowDef[] }): SheetLayoutDef {
  const sections: SheetSectionDef[] = [
    { id: "vitals", label: "Vitals", rows: [{ pool: "hp" }, { field: "hp_temp" }, { field: "nonlethal" }, { progression: "level" }, { field: D20_FIELDS.classes }, { formula: "levels(self) + self.racial_hd", label: "Hit dice" }, ...(opts.vitals ?? [])] },
    { id: "defence", label: opts.defence.label, rows: opts.defence.rows },
    { id: "attack", label: "Attack", rows: opts.attack },
    { id: "saves", label: "Saves", rows: opts.saves.map((s) => ({ formula: signedTotal(`save.${s.id}`), label: s.label })) },
    { id: "abilities", label: "Abilities", rows: abilityRows() },
    { id: "skills", label: "Skills", rows: opts.skills.map((s) => ({ formula: signedTotal("skill", s.id), label: s.label })) },
  ];
  if (opts.daily.length > 0) sections.push({ id: "daily", label: "Daily", rows: opts.daily.map((pool) => ({ pool })) });
  sections.push({ id: "has", label: "Has and is under", rows: [{ field: D20_FIELDS.traits }, { field: D20_FIELDS.conditions }, { field: D20_FIELDS.effects }, { field: D20_FIELDS.attacks }] });
  return { sections };
}
