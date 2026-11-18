// What the d20 rule sets share (RULESET-DESIGN §6): the set's shape, the six abilities, the fields every kind of the set's
// `ruleset.d20.kinds` carries (§4.6), the fight's budgets and initiative, the sheet's sections, the totals the family writes alike,
// helpers that build the tables' rows, and the rows two or more sets hold alike (conditions, weapons, feats, class features,
// creature traits, progressions, difficulties). Each set (Classic, Classic Revised, Modern) is a world fragment written with these and
// spreads the shared rows under its own; what differs between the games is in each set's own file, and nothing here runs during play.

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
  // A stored world reads -0 back as 0, so a step of none (`steps * -4` at medium) is written as 0.
  return { to, value: typeof value === "number" ? value + 0 : value, ...more };
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

// ---------------------------------------------------------------- rows two or more sets hold alike

/** Skill bonuses of one size to several skills. */
export function skillsMod(value: number, skills: string[], type?: string): JsonObject[] {
  return skills.map((s) => mod(`skill.${s}`, value, type !== undefined ? { type } : {}));
}

/** A creature's base attack, as a requirement reads it. */
export const BASE_ATTACK: Expr = "total(self, 'attack.base')";

/** With no armour and no shield on: the limits a worn armour or shield sets (`armorMods`, `shieldMods`). */
export const UNARMOURED: Expr = "limit(self, 'armor_weight', 0) + limit(self, 'shield_worn', 0) == 0";

/**
 * A creature type: what its own hit dice give in base attack (at a rate of them) and in each save (good: 2 + half of them; poor:
 * a third of them), with what else the type gives.
 */
export function creatureType(label: string, text: string, attackRate: "1" | "3 / 4" | "1 / 2", good: string[], more: { grants?: JsonObject; modifiers?: JsonObject[] } = {}): TableRow {
  const own = "self.racial_hd > 0";
  const modifiers = [mod("base_attack", `floor(self.racial_hd * ${attackRate})`, { note: "from its own hit dice" })];
  for (const save of ["fort", "ref", "will"]) modifiers.push(mod(`save.${save}`, good.includes(save) ? "2 + floor(self.racial_hd / 2)" : "floor(self.racial_hd / 3)", { when: own, note: "base, from its own hit dice" }));
  return trait(label, "creature type", text, { modifiers: [...modifiers, ...(more.modifiers ?? [])], ...(more.grants !== undefined ? { grants: more.grants } : {}) });
}

/** What armour does beyond its bonus: its weight class as a limit (the lightest worn counts), its speed, and its penalty to the untrained. */
export function armorMods(weight: "light" | "medium" | "heavy", check: number): JsonObject[] {
  const level = { light: 1, medium: 2, heavy: 3 }[weight];
  return [
    mod("armor_weight", level, { limit: true, note: `${weight} armour` }),
    ...(weight !== "light" ? [mod("speed", "self.base_speed >= 30 ? -10 : -5", { when: "not has_trait(self, 'dwarf')", note: `${weight} armour` })] : []),
    ...(check < 0 ? [mod("attack", check, { when: `not has_trait(self, 'armor_${weight}')`, note: "armour it is not trained in" })] : []),
  ];
}

/** What a shield does beyond its bonus: that one is borne, and its penalty to the untrained. */
export function shieldMods(check: number, training: string, more: JsonObject[] = []): JsonObject[] {
  return [mod("shield_worn", 1, { limit: true }), mod("attack", check, { when: `not has_trait(self, '${training}')`, note: "a shield it is not trained with" }), ...more];
}

/** A creature's worn armour as an effect of its stat block: the bonus of each type counts once, if it puts on the things as well. */
export function wearing(label: string, modifiers: JsonObject[]): JsonObject {
  return { label, modifiers };
}

/** The progressions tables' columns: base attack at the full, three-quarter and half rate; a good and a poor save. */
export const TRACK_COLUMNS: Record<string, ColumnDef> = { attack_good: { type: "int" }, attack_average: { type: "int" }, attack_poor: { type: "int" }, save_good: { type: "int" }, save_poor: { type: "int" } };

/** The progressions by level 1 to 20. */
export const TRACK_ROWS: Record<string, TableRow> = byLevel(20, (l) => ({ attack_good: l, attack_average: Math.floor((l * 3) / 4), attack_poor: Math.floor(l / 2), save_good: 2 + Math.floor(l / 2), save_poor: Math.floor(l / 3) }));

/** The usual difficulties by name. */
export const DIFFICULTIES: Record<string, TableRow> = {
  very_easy: difficulty("Very easy", 0, "Anyone does it with no effort."),
  easy: difficulty("Easy", 5, "Hardly ever failed."),
  average: difficulty("Average", 10, "The untrained do it as often as not."),
  tough: difficulty("Tough", 15, "Wants training or luck."),
  challenging: difficulty("Challenging", 20, "Beyond most of the untrained."),
  formidable: difficulty("Formidable", 25, "Hard even for a practised hand."),
  heroic: difficulty("Heroic", 30, "Only the best manage it."),
  nearly_impossible: difficulty("Nearly impossible", 40, "A feat of legend."),
};

/** Half speed, as a condition takes it. */
export const HALF_SPEED: JsonObject = mod("speed", "-floor(self.base_speed / 2)", { note: "half speed" });
/** No Dexterity bonus to defence. */
export const NO_DEX: JsonObject = mod("max_dex", 0, { limit: true, note: "loses its Dexterity bonus" });
/** Dexterity counting as 0 to defence. */
export const DEX_ZERO: JsonObject = mod("max_dex", -5, { limit: true, note: "Dexterity as 0" });
/** -2 to attack, saves, skills and ability checks. */
export const FEAR: JsonObject[] = [mod("attack", -2), mod("save", -2), mod("skill", -2), mod("ability_check", -2)];

/** The conditions every set holds alike: none names a skill. A set spreads them and adds its own. */
export const SHARED_CONDITIONS: Record<string, TableRow> = {
  ability_damaged: condition("Ability Damaged", "Points of an ability lost for now, one back a night: put on as an effect with a modifier to ability.<id>."),
  ability_drained: condition("Ability Drained", "Points of an ability lost for good: put on as an effect with a modifier to ability.<id>."),
  charging: condition("Charging", "+2 to its melee attack, -2 defence until its next turn.", [mod("attack.melee", 2), mod("ac", -2)]),
  cowering: condition("Cowering", "Frozen in fear: no actions, -2 defence and no Dexterity bonus to it.", [mod("ac", -2), NO_DEX], ["no_actions", "flat"]),
  dazed: condition("Dazed", "No actions, though its defence stands.", [], ["no_actions"]),
  dead: condition("Dead", "Its life has left it.", [], ["no_actions", "dead"]),
  down: condition("Out of the Fight", "No longer standing in the fight."),
  entangled: condition("Entangled", "-2 to attack, -4 Dexterity, half speed, no running or charging.", [mod("attack", -2), mod("ability.dex", -4), HALF_SPEED], ["half_speed", "no_run"]),
  exhausted: condition("Exhausted", "-6 Strength and Dexterity, half speed, no running or charging; an hour's rest leaves it fatigued.", [mod("ability.str", -6), mod("ability.dex", -6), HALF_SPEED], ["half_speed", "no_run"]),
  fatigued: condition("Fatigued", "-2 Strength and Dexterity, no running or charging; eight hours' rest ends it.", [mod("ability.str", -2), mod("ability.dex", -2)], ["no_run"]),
  fighting_defensively: condition("Fighting Defensively", "-4 to attack, +2 dodge to defence until its next turn.", [mod("attack", -4), mod("ac", 2, { type: "dodge" })]),
  flat_footed: condition("Flat-Footed", "Caught unready: no Dexterity bonus to defence, no dodge bonus, no attacks of opportunity.", [NO_DEX], ["flat", "no_aoo"]),
  frightened: condition("Frightened", "Flees what frightens it, fighting only when cornered; -2 to attack, saves, skills and ability checks.", FEAR, ["flees"]),
  helpless: condition("Helpless", "Bound, asleep or paralysed: its Dexterity counts as 0 to defence, and melee attacks on it have +4; it can be slain with one blow.", [DEX_ZERO, mod("ac.melee", -4)], ["helpless", "flat", "no_actions"]),
  invisible: condition("Invisible", "+2 to attack those who see normally, who lose their Dexterity bonus against it; attacks on it miss half the time.", [mod("attack", 2)], ["unseen"]),
  nauseated: condition("Nauseated", "Only a move action a turn: no attacks, no spells.", [], ["move_only"]),
  panicked: condition("Panicked", "Drops what it holds and flees; cowers when cornered; -2 on saves, skills and ability checks.", [mod("save", -2), mod("skill", -2), mod("ability_check", -2)], ["flees", "drops_held"]),
  paralyzed: condition("Paralysed", "Cannot move or act, only think: its Strength and Dexterity count as 0, and it is helpless.", [DEX_ZERO, mod("ac.melee", -4)], ["helpless", "flat", "no_actions"]),
  petrified: condition("Turned to Stone", "Stone, unconscious, knowing nothing.", [], ["no_actions", "helpless"]),
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
  shaken: condition("Shaken", "-2 to attack, saves, skills and ability checks.", FEAR),
  sickened: condition("Sickened", "-2 to attack, weapon damage, saves, skills and ability checks.", [...FEAR, mod("damage", -2)]),
  stable: condition("Stable", "Below 0 hit points but no longer losing them; still unconscious.", [], ["no_actions"]),
  stunned: condition("Stunned", "Drops what it holds, no actions, -2 defence and no Dexterity bonus to it.", [mod("ac", -2), NO_DEX], ["no_actions", "flat", "drops_held"]),
  total_defense: condition("Total Defence", "Does nothing but defend: +4 dodge to defence until its next turn.", [mod("ac", 4, { type: "dodge" })], ["no_attack"]),
  unconscious: condition("Unconscious", "Knocked out: helpless, its Dexterity counting as 0 to defence.", [DEX_ZERO, mod("ac.melee", -4)], ["helpless", "flat", "no_actions"]),
};

const S = ["slashing"];
const P = ["piercing"];
const B = ["bludgeoning"];
const PS = ["piercing", "slashing"];
const BP = ["bludgeoning", "piercing"];

/** The weapons of the fantasy sets: simple, martial and exotic. A set spreads them and adds its own. */
export const CORE_WEAPONS: Record<string, TableRow> = {
  // Simple.
  unarmed_strike: weapon("Unarmed strike", "1d2", "1d3", 20, 2, null, "simple", "light", B, { nonlethal: true, finesse: true }),
  gauntlet: weapon("Gauntlet", "1d2", "1d3", 20, 2, null, "simple", "light", B, { finesse: true }),
  dagger: weapon("Dagger", "1d3", "1d4", 19, 2, 10, "simple", "light", PS, { finesse: true }),
  belt_knife: weapon("Belt knife", "1d3", "1d4", 19, 2, 10, "simple", "light", PS, { finesse: true }),
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

/** The feats the fantasy sets hold alike: training with gear and the feats whose arithmetic is the same in both. */
export const SHARED_FEATS: Record<string, TableRow> = {
  armor_light: trait("Light Armour Training", "feat", "Light armour's check penalty does not fall on the wearer's attacks."),
  armor_medium: trait("Medium Armour Training", "feat", "Medium armour's check penalty does not fall on the wearer's attacks.", { requires: "has_trait(self, 'armor_light')" }),
  armor_heavy: trait("Heavy Armour Training", "feat", "Heavy armour's check penalty does not fall on the wearer's attacks.", { requires: "has_trait(self, 'armor_medium')" }),
  shield_proficiency: trait("Shield Training", "feat", "A shield's check penalty does not fall on its bearer's attacks."),
  tower_shield_proficiency: trait("Tower Shield Training", "feat", "A tower shield's check penalty does not fall on its bearer's attacks.", { requires: "has_trait(self, 'shield_proficiency')" }),
  simple_weapon_proficiency: trait("Simple Weapons", "feat", "No -4 to attack with a simple weapon.", { grants: { proficiency: ["simple"] } }),
  martial_weapon_proficiency: trait("Martial Weapon", "feat", "No -4 to attack with the martial weapon taken as its choice.", { grants: { proficiency: [] } }),
  exotic_weapon_proficiency: trait("Exotic Weapon", "feat", "No -4 to attack with the exotic weapon taken as its choice.", { grants: { proficiency: [] }, requires: `${BASE_ATTACK} >= 1` }),
  combat_casting: trait("Steady Casting", "feat", "+4 to cast on the defensive or while held without losing the spell."),
  endurance: trait("Endurance", "feat", "+4 on checks and saves against tiring: swimming, running, holding its breath, hunger, thirst, heat and cold."),
  great_fortitude: trait("Hardy", "feat", "+2 Fortitude.", { modifiers: [mod("save.fort", 2)] }),
  greater_weapon_focus: trait("Favoured Weapon, Greater", "feat", "+1 more to attack with the weapon taken as its choice.", { modifiers: [mod("attack.weapon.{choice}", 1)], requires: "class_level(self, 'fighter') >= 8" }),
  improved_initiative: trait("Quick Start", "feat", "+4 initiative.", { modifiers: [mod("initiative", 4)] }),
  improved_unarmed_strike: trait("Trained Fists", "feat", "Its bare hands count as armed: striking with them gives no attack of opportunity, and their harm may be lethal with no -4."),
  iron_will: trait("Strong-Willed", "feat", "+2 Will.", { modifiers: [mod("save.will", 2)] }),
  lightning_reflexes: trait("Quick to React", "feat", "+2 Reflex.", { modifiers: [mod("save.ref", 2)] }),
  mobility: trait("Mobile", "feat", "+4 dodge to defence against attacks of opportunity for moving.", { requires: "has_trait(self, 'dodge')" }),
  point_blank_shot: trait("Close Shot", "feat", "+1 to attack and damage with a ranged weapon at 30 feet or nearer: name both as the attack's modifiers."),
  precise_shot: trait("Precise Shot", "feat", "No -4 for shooting at a foe in melee with an ally.", { requires: "has_trait(self, 'point_blank_shot')" }),
  quick_draw: trait("Quick Draw", "feat", "Draws a weapon as a free action.", { requires: `${BASE_ATTACK} >= 1` }),
  rapid_shot: trait("Rapid Shot", "feat", "With all its attacks, one more ranged attack at its highest bonus, and -2 on every one of them that round.", { requires: "score(self, 'dex') >= 13 and has_trait(self, 'point_blank_shot')" }),
  run: trait("Runner", "feat", "Runs five times its speed (four times in heavy armour)."),
  spell_focus: trait("School Focus", "feat", "+1 to the difficulty of saves against its spells of the kind taken as its choice."),
  two_weapon_fighting: trait("Two Weapons", "feat", "Fighting with a weapon in each hand costs -4 on each (-2 if the off-hand weapon is light), not -6 and -10 (-4 and -8): name them as the attacks' modifiers.", { requires: "score(self, 'dex') >= 15" }),
  weapon_finesse: trait("Finesse", "feat", "With a light weapon, a rapier, a whip or a spiked chain, Dexterity stands for Strength on the attack roll.", { modifiers: [mod("attack.finesse", "max(0, mod(self, 'dex') - mod(self, 'str'))", { note: "Dexterity for Strength" })], requires: `${BASE_ATTACK} >= 1` }),
  weapon_focus: trait("Favoured Weapon", "feat", "+1 to attack with the weapon taken as its choice.", { modifiers: [mod("attack.weapon.{choice}", 1)], requires: `${BASE_ATTACK} >= 1` }),
  weapon_specialization: trait("Weapon Mastery", "feat", "+2 to damage with the weapon taken as its choice.", { modifiers: [mod("damage.weapon.{choice}", 2)], requires: "class_level(self, 'fighter') >= 4" }),
};

/** The class features the fantasy sets hold alike. */
export const SHARED_FEATURES: Record<string, TableRow> = {
  one_simple_weapon: trait("One Weapon", "class feature", "No -4 to attack with the one simple weapon taken as its choice.", { grants: { proficiency: [] } }),
  expert_trade: trait("Own Trade", "class feature", "Ten skills of its own choosing are its class skills; the class lists every skill, and the GM holds each expert to its ten."),
  adept_spells: trait("Hedge Spells", "class feature", "Casts a few divine spells a day, prepared from Wisdom; the GM rules which and how many."),
  fast_movement: trait("Fast Movement", "class feature", "+10 speed, except in heavy armour.", { modifiers: [mod("speed", 10, { when: "limit(self, 'armor_weight', 0) < 3" })] }),
  greater_rage: trait("Greater Rage", "class feature", "Raging gives +6 Strength and Constitution and +3 Will (in the raging condition)."),
  indomitable_will: trait("Unbending Will", "class feature", "+4 on Will saves against charms and compulsions while raging."),
  tireless_rage: trait("Tireless Rage", "class feature", "Not fatigued when a rage ends."),
  mighty_rage: trait("Mighty Rage", "class feature", "Raging gives +8 Strength and Constitution and +4 Will (in the raging condition)."),
  uncanny_dodge: trait("Uncanny Dodge", "class feature", "Keeps its Dexterity bonus to defence when flat-footed or struck by a foe it cannot see."),
  improved_uncanny_dodge: trait("Hard to Flank", "class feature", "Cannot be flanked, except by a rogue four levels higher than its own levels in the classes that give it this."),
  trap_sense: trait("Trap Sense", "class feature", "+1 on Reflex saves and +1 dodge to defence against traps for every three levels of the class that gives it: name it against a trap."),
  barbarian_reduction: trait("Thick Skin", "class feature", "Harm of every kind loses 1, and 1 more each three levels after the 7th (5 at the 19th).", { modifiers: [mod("reduction", "floor((class_level(self, 'barbarian') - 4) / 3)", { bypass: [] })] }),
  animal_companion: trait("Animal Companion", "class feature", "A loyal animal goes with it, growing stronger with its levels."),
  nature_sense: trait("Nature Sense", "class feature", "+2 Lore (nature) and Survival.", { modifiers: skillsMod(2, ["knowledge_nature", "survival"]) }),
  wild_empathy: trait("Way with Beasts", "class feature", "Calms animals: a check of d20 + its levels in the class + its Charisma modifier."),
  woodland_stride: trait("Woodland Stride", "class feature", "Moves through undergrowth at full speed and unharmed."),
  trackless_step: trait("Trackless Step", "class feature", "Leaves no trail in natural surroundings."),
  resist_natures_lure: trait("Resist the Wild's Lure", "class feature", "+4 on saves against the magic of fey."),
  venom_immunity: trait("Venom Immunity", "class feature", "No poison harms it."),
  a_thousand_faces: trait("A Thousand Faces", "class feature", "Changes its looks at will."),
  timeless_body: trait("Timeless Body", "class feature", "Age weakens it no more."),
  fighter_bonus_feat: trait("Fighting Feats", "class feature", "One more feat at the 1st level and each even level, of those for fighting."),
  monk_unarmed: trait("Hard Hands", "class feature", "Its unarmed strike deals 1d6 (1d8 from the 4th level, 1d10 from the 8th, 2d6 from the 12th, 2d8 from the 16th, 2d10 at the 20th): kept as its own attack."),
  evasion: trait("Evasion", "class feature", "A Reflex save that would halve harm takes none of it."),
  improved_evasion: trait("Improved Evasion", "class feature", "A failed Reflex save that would halve harm takes only half."),
  still_mind: trait("Still Mind", "class feature", "+2 on saves against charms and compulsions."),
  monk_speed: trait("Swift Feet", "class feature", "+10 speed for every three monk levels, with no armour and no shield.", { modifiers: [mod("speed", "floor(class_level(self, 'monk') / 3) * 10", { when: UNARMOURED })] }),
  slow_fall: trait("Slow Fall", "class feature", "Within reach of a wall, falls as if 20 feet shorter, and 10 more every two levels."),
  purity_of_body: trait("Pure Body", "class feature", "No natural disease takes hold of it."),
  diamond_body: trait("Diamond Body", "class feature", "No poison harms it."),
  abundant_step: trait("Abundant Step", "class feature", "Steps from one place to another as by magic."),
  diamond_soul: trait("Diamond Soul", "class feature", "Spells must overcome 10 + its monk levels to touch it."),
  quivering_palm: trait("Quivering Palm", "class feature", "Once a week, a touch that can kill later at its word: Fortitude against 10 + half its monk levels + its Wisdom modifier."),
  empty_body: trait("Empty Body", "class feature", "Turns to a ghost's substance for a time each day."),
  aura_of_good: trait("Aura of Good", "class feature", "Shines with good to those who sense it."),
  detect_evil: trait("Sense Evil", "class feature", "Senses evil at will."),
  divine_grace: trait("Divine Grace", "class feature", "Its Charisma bonus adds to every save.", { modifiers: [mod("save", "max(0, mod(self, 'cha'))", { note: "Charisma" })] }),
  aura_of_courage: trait("Aura of Courage", "class feature", "Fear does not touch it, and allies within 10 feet have +4 morale against fear."),
  divine_health: trait("Divine Health", "class feature", "No disease takes hold of it."),
  swift_tracker: trait("Swift Tracker", "class feature", "Follows tracks at its full speed with no penalty."),
  camouflage: trait("Camouflage", "class feature", "Hides in any natural surroundings."),
  hide_in_plain_sight: trait("Hide in Plain Sight", "class feature", "Hides in natural surroundings even while watched."),
  sneak_attack: trait("Sneak Attack", "class feature", "Against a foe that loses its Dexterity bonus to defence or is flanked, +1d6 damage at the 1st level and 1d6 more each two levels, not multiplied by a critical; ranged only within 30 feet: name the dice with the harm."),
  familiar: trait("Familiar", "class feature", "A small animal bound to it, which shares its senses and grows with its levels."),
  scribe_scroll: trait("Scroll Writing", "class feature", "Writes its spells down as scrolls."),
  wizard_bonus_feat: trait("Wizard Feats", "class feature", "One more feat at the 5th level and every fifth after, for spells or making magic items."),
};

/** The creature types and qualities the fantasy sets hold alike. */
export const SHARED_CREATURE_TRAITS: Record<string, TableRow> = {
  animal: creatureType("Animal", "A beast: each of its own hit dice is a d8; they give three quarters of themselves in base attack, a good Fortitude and Reflex and a poor Will.", "3 / 4", ["fort", "ref"]),
  humanoid: creatureType("Humanoid", "A person of some people: its own hit dice (d8s), if any, give three quarters in base attack, a good Reflex; trained with simple weapons.", "3 / 4", ["ref"], { grants: { proficiency: ["simple"] } }),
  giant: creatureType("Giant", "A giant: each of its own hit dice is a d8; they give three quarters in base attack and a good Fortitude; trained with simple and martial weapons.", "3 / 4", ["fort"], { grants: { proficiency: ["simple", "martial"] } }),
  natural_armor: trait("Natural Armour", "quality", "Its hide, scales or bones add its natural armour to defence, though not against a touch.", { modifiers: [mod("ac", "self.natural_armor", { type: "natural" })] }),
  darkvision: trait("Sees in the Dark", "quality", "Sees 60 feet with no light at all, without colour."),
  low_light_vision: trait("Sees in Dim Light", "quality", "Sees twice as far as a human by moonlight, torchlight and the like."),
  light_sensitivity: trait("Light-Shy", "quality", "In bright sunlight it is dazzled: -1 to attack and to what it sees."),
  scent: trait("Keen Nose", "quality", "Smells foes within 30 feet (farther downwind) and follows tracks by smell."),
  trip_bite: trait("Dragging Bite", "quality", "A bite that hits lets it try to trip the foe at once, with no attack of opportunity."),
  skeleton_bones: trait("Brittle Bones", "quality", "Harm of any type but bludgeoning loses 5 to its bones; cold does it no harm.", { modifiers: [mod("reduction", 5, { bypass: ["bludgeoning"] }), mod("resist.cold", 1000, { note: "no harm from cold" })] }),
};

/** The feat that doubles a chosen weapon's threat range, read from the set's weapons table: it widens the threat by as many numbers as the row's range holds. */
export function improvedCritical(weapons: string): TableRow {
  return trait("Keen Strikes", "feat", "The weapon taken as its choice threatens on twice as many numbers of the die (19-20 becomes 17-20).", {
    modifiers: [mod("threat.weapon.{choice}", `21 - table('${weapons}', '{choice}', 'threat')`, { type: "keen", note: "twice the threat range" })],
    requires: `${BASE_ATTACK} >= 8`,
  });
}

/** The experience a level needs, to `top`: 1000 x level x (level - 1) / 2. */
export function experienceRows(top: number): Record<string, TableRow> {
  return byLevel(top, (l) => ({ xp: (1000 * l * (l - 1)) / 2 }));
}

/**
 * What overcoming a challenge is worth to a party, by a member's level, shared among those who overcame it: 300 x the level for a
 * challenge equal to it, twice as much each two steps above, half as much each two below, nothing seven or more below; rounded to 25.
 */
function worth(level: number, cr: number): number {
  if (cr < level - 7) return 0;
  return Math.round((300 * level * 2 ** ((cr - level) / 2)) / 25) * 25;
}

/** Challenges 1/10 to 20, each worth `worth` by level 1 to 20; a fraction of 1 is that fraction of a challenge of 1. */
export const CHALLENGE_ROWS: Record<string, TableRow> = {};
for (const [id, part] of [["1/10", 0.1], ["1/8", 0.125], ["1/6", 1 / 6], ["1/4", 0.25], ["1/3", 1 / 3], ["1/2", 0.5]] as const) {
  CHALLENGE_ROWS[id] = { by_level: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), Math.round(worth(i + 1, 1) * part)])) };
}
for (let cr = 1; cr <= 20; cr++) CHALLENGE_ROWS[String(cr)] = { by_level: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), worth(i + 1, cr)])) };

/** The feats Classic and Modern hold alike: the same arithmetic on the same skills. */
export const CLASSIC_MODERN_FEATS: Record<string, TableRow> = {
  acrobatic: trait("Acrobatic", "feat", "+2 Jump and Tumble.", { modifiers: skillsMod(2, ["jump", "tumble"]) }),
  alertness: trait("Alert", "feat", "+2 Listen and Spot.", { modifiers: skillsMod(2, ["listen", "spot"]) }),
  athletic: trait("Athletic", "feat", "+2 Climb and Swim.", { modifiers: skillsMod(2, ["climb", "swim"]) }),
  cleave: trait("Follow-Through", "feat", "Once a round, dropping a foe in melee gives one more melee attack, at the same bonus, at another foe within reach.", { requires: "score(self, 'str') >= 13 and has_trait(self, 'power_attack')" }),
  combat_expertise: trait("Guarded Fighting", "feat", "Before attacking, it may take up to 5 (no more than its base attack) off its melee attacks and add as much dodge to defence until its next turn: name both as the attack's modifiers.", { requires: "score(self, 'int') >= 13" }),
  combat_reflexes: trait("Quick Reflexes", "feat", "As many more attacks of opportunity a round as its Dexterity modifier."),
  dodge: trait("Dodge", "feat", "+1 dodge to defence against the one foe it names each turn.", { modifiers: [mod("ac", 1, { type: "dodge", note: "against the foe it names" })], requires: "score(self, 'dex') >= 13" }),
  far_shot: trait("Long Shot", "feat", "A projectile weapon's range increment is half again as long, a thrown weapon's twice as long.", { requires: "has_trait(self, 'point_blank_shot')" }),
  stealthy: trait("Stealthy", "feat", "+2 Hide and Move Quietly.", { modifiers: skillsMod(2, ["hide", "move_silently"]) }),
  toughness: trait("Tough", "feat", "+3 hit points.", { modifiers: [mod("hp", 3)] }),
  track: trait("Tracker", "feat", "Follows tracks with Survival."),
};
