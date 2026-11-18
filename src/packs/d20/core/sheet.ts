// The sheet under the world's tabletop rules (RULESET-DESIGN §5.4, §7): someone's numbers, each total with its parts and where each
// part comes from, as the tool `sheet` answers an agent and as Play → You and a person's sheet show it to the player, from this one
// builder. Abilities, defence and its variants, initiative, each weapon in hand and each attack of its own (its attack, damage, threat,
// range and rounds loaded), saves, skills, hit points with the state they bring, experience toward the next level, conditions and
// effects with what is left of them, daily gauges, classes and traits. It changes nothing.

import type { EntityId } from "../../../shared/ids";
import type { FieldFixTarget } from "../../../shared/state-view";
import { D20_FIELDS } from "../../../shared/d20";
import { say } from "../../../shared/lines";
import type { ReadContext } from "../../../engine/registry";
import { labelOf, own } from "../../../engine/pack-kit";
import { fixOf, progressOf } from "../../../engine/ruleset";
import { fieldDef, isGone, kindIs, placeOfEntity, poolMax, poolMin, scopeEnv } from "../../../engine/scope";
import { canSeeEntity, canSeeField } from "../../../engine/visibility";
import { hpSeen } from "../../combat/core/flow";
import { encounterOf, rulesOf as combatRulesOf } from "../../combat/core/model";
import { isClassSkill, levelsOf, modOf, scoreOf } from "./functions";
import { classesOf, conditionsHeld, effectsHeld, gearOn, isOn, labelOfRow, naturalAttacks, numberIn, ranksOf, rowIdOf, rowsOf, rulesOf, sizeOf, textIn, thingNumber, traitsHeld, wordsIn } from "./model";
import { explain, partsWords, signed, totalOf } from "./modifiers";
import { threatFrom, weaponKey } from "./procedures";

/** A total and where its number comes from, its parts in words. */
export interface SheetLine {
  total: number;
  parts: string;
}

/** A weapon in hand or an attack of one's own: its attack, its damage, its threat and what a critical multiplies, its range, its rounds. */
export interface SheetWeapon {
  with: string;
  attack: SheetLine | null;
  damage: string;
  threat: number;
  multiplier: number;
  range?: number;
  types?: string;
  rounds?: string;
  fire?: string;
}

/** Someone's sheet under the rules. `fix` (a ✎ of a stored value) is only on the sheet of the player's own character, as the page reads it. */
export interface Sheet {
  who: string;
  off?: true;
  classes: string;
  levels: number;
  size: string;
  abilities: { ability: string; score: number; mod: string; fix?: FieldFixTarget }[];
  defence: { ac: SheetLine | null; touch: SheetLine | null; flat_footed: SheetLine | null };
  initiative: SheetLine | null;
  weapons: SheetWeapon[];
  saves: ({ save: string } & Partial<SheetLine>)[];
  skills: ({ skill: string; ranks: number; class_skill?: true } & Partial<SheetLine>)[];
  /** Hit points; for someone the ruleset shows the player only as a wound, the wound alone. */
  hp: { now?: number; most?: number; temporary?: number; nonlethal?: number; state?: string; wound?: string; fix?: { now?: FieldFixTarget; temporary?: FieldFixTarget; nonlethal?: FieldFixTarget } };
  experience?: { level: number; xp: number; next: number | null; fix?: FieldFixTarget };
  conditions: { condition: string; left: string; does?: string }[];
  effects: { effect: string; mods: string; left: string }[];
  daily?: { gauge: string; now: number; most: number | null; fix?: FieldFixTarget }[];
  traits: { trait: string; kind?: string; does?: string }[];
}

/** A total and its parts, in words. */
function line(ctx: ReadContext, who: EntityId, name: string, vars: Record<string, string> = {}): SheetLine | null {
  const rules = rulesOf(ctx.world);
  const e = rules ? explain(ctx, rules, who, name, vars) : null;
  return e ? { total: e.total, parts: partsWords(e) } : null;
}

/** Each weapon in hand and each attack of its own: its attack and its parts, its damage, its threat, its range, its rounds. */
function weapons(ctx: ReadContext, who: EntityId, name: (id: EntityId) => string): SheetWeapon[] {
  const rules = rulesOf(ctx.world);
  if (!rules) return [];
  const a = rules.attack;
  const size = sizeOf(ctx, rules, who);
  const rows = rowsOf(ctx, rules, "weapons");
  const out: SheetWeapon[] = [];
  const strength = (held: string): number => Math.floor((own(a.strengthShare, held) ?? 0) * modOf(ctx, rules, who, a.strength));
  for (const id of gearOn(ctx, who).readied) {
    const rid = rowIdOf(ctx, id);
    const row = own(rows, rid);
    if (!row) continue;
    const held = textIn(row.held);
    const ranged = held === "projectile" || held === "thrown" || held === "ranged";
    const enh = thingNumber(ctx, id, D20_FIELDS.enhancement);
    const roll = line(ctx, who, ranged ? a.totals.ranged : a.totals.melee, { weapon: rid, key: rid });
    const dmg = row.damage;
    const dice = typeof dmg === "string" ? dmg : dmg !== null && typeof dmg === "object" && !Array.isArray(dmg) ? (typeof dmg[size] === "string" ? dmg[size] : (Object.values(dmg).find((x) => typeof x === "string") ?? "")) : "";
    const bonus = strength(held) + totalOf(ctx, rules, who, a.totals.damage, { weapon: rid, key: rid }) + enh;
    const magazine = numberIn(row.magazine ?? null);
    const range = numberIn(row.range ?? null);
    out.push({
      with: name(id),
      attack: roll === null ? null : { total: roll.total + enh, parts: [roll.parts, enh !== 0 ? say("d20_part_enhancement", { value: signed(enh), from: name(id) }) : ""].filter((x) => x !== "").join(", ") },
      damage: `${String(dice)}${bonus !== 0 ? signed(bonus) : ""}`,
      threat: threatFrom(ctx, rules, who, { rowId: rid, row, natural: null }),
      multiplier: numberIn(row.multiplier ?? null) ?? 1,
      ...(range !== null ? { range } : {}),
      ...(wordsIn(row.types).length > 0 ? { types: wordsIn(row.types).join(", ") } : {}),
      ...(magazine !== null ? { rounds: say("d20_sheet_rounds", { loaded: thingNumber(ctx, id, D20_FIELDS.loaded), magazine }) } : {}),
      ...(wordsIn(row.fire).length > 0 ? { fire: wordsIn(row.fire).join(", ") } : {}),
    });
  }
  for (const nat of naturalAttacks(ctx, who)) {
    // Its own attack is known by its label in lower case, as the attack binds it (`attack.weapon.bite` reaches it).
    const key = weaponKey(nat);
    const roll = line(ctx, who, nat.total ?? a.totals.melee, { weapon: key, key });
    const bonus = strength(nat.held ?? "one") + totalOf(ctx, rules, who, a.totals.damage, { weapon: key, key });
    out.push({
      with: nat.label,
      attack: roll === null ? null : { total: roll.total + (nat.bonus ?? 0) + (nat.secondary === true ? a.secondary : 0), parts: roll.parts },
      damage: `${nat.damage}${bonus !== 0 ? signed(bonus) : ""}`,
      threat: threatFrom(ctx, rules, who, { rowId: key, row: null, natural: nat }),
      multiplier: nat.multiplier ?? 1,
      ...(nat.types !== undefined ? { types: nat.types.join(", ") } : {}),
    });
  }
  return out;
}

/** What is left of a condition or an effect: turns, minutes, a save that ends it, in the lines' words. */
function left(ctx: ReadContext, held: { until?: number; rounds?: number; save?: { save: string; dc: number } }): string {
  return say("d20_length", { ...(held.rounds !== undefined ? { rounds: held.rounds } : {}), ...(held.until !== undefined ? { minutes: Math.max(0, held.until - ctx.state.clock) } : {}), ...(held.save !== undefined ? { save: held.save.save, dc: held.save.dc } : {}) });
}

/**
 * Someone's whole sheet under the rules, each name said by `name`; null in a world without them. With `fixes`, each stored value the
 * player may correct carries its ✎ (an ability's score, the hit points, temporary hit points and nonlethal harm, experience, a daily
 * gauge), as the designed sheet's rows carry theirs.
 */
export function sheetOf(ctx: ReadContext, who: EntityId, name: (id: EntityId) => string, opts: { fixes?: boolean } = {}): Sheet | null {
  const rules = rulesOf(ctx.world);
  if (!rules) return null;
  const reg = ctx.registry;
  const e = own(ctx.state.entities, who);
  const kind = e?.kind ?? "";
  const def = (field: string) => (e ? fieldDef(reg, ctx.world, kind, field) : undefined);
  const fix = (field: string, value: number, bounds: { min?: number; max?: number } = {}): FieldFixTarget | undefined => {
    const d = opts.fixes === true ? def(field) : undefined;
    return d ? fixOf(who, field, d, own(e?.fields ?? {}, field) ?? value, { ...(d.min !== undefined ? { min: d.min } : {}), ...(d.max !== undefined ? { max: d.max } : {}), ...bounds }) : undefined;
  };
  const abilities = rules.abilities.map((ab) => {
    const f = fix(ab, numberIn(own(e?.fields ?? {}, ab) ?? null) ?? scoreOf(ctx, rules, who, ab));
    return { ability: def(ab)?.label ?? ab, score: scoreOf(ctx, rules, who, ab), mod: signed(modOf(ctx, rules, who, ab)), ...(f ? { fix: f } : {}) };
  });
  const saves = Object.keys(rules.totals)
    .filter((k) => k.startsWith("save."))
    .map((k) => ({ save: k.slice(5), ...line(ctx, who, k) }));
  const ranks = ranksOf(ctx, who);
  const skills = Object.entries(rowsOf(ctx, rules, "skills"))
    .filter(([id, row]) => row.trained !== true || (own(ranks, id) ?? 0) > 0)
    .map(([id, row]) => ({ skill: labelOfRow(row, id), ranks: own(ranks, id) ?? 0, ...(isClassSkill(ctx, rules, who, id) ? { class_skill: true as const } : {}), ...line(ctx, who, "skill", { skill: id, key: id, weapon: id }) }));
  // The gauge as the sheet reads it: what it holds, an unset one full.
  const hpDef = def(rules.hp.field);
  const hpNow = numberIn(scopeEnv({ reg, ctx, bindings: { self: who } }).lookup(["self", rules.hp.field]) ?? null) ?? 0;
  const hpMax = hpDef?.pool ? poolMax(reg, ctx, who, hpDef.pool) : null;
  const temporary = numberIn(own(e?.fields ?? {}, rules.hp.temporary) ?? null) ?? 0;
  const nonlethal = numberIn(own(e?.fields ?? {}, rules.hp.nonlethal) ?? null) ?? 0;
  const conditionsTable = rowsOf(ctx, rules, "conditions");
  const traitsTable = rowsOf(ctx, rules, "traits");
  const classesTable = rowsOf(ctx, rules, "classes");
  const held = conditionsHeld(ctx, who);
  // The state hit points put it in: each state of the ruleset whose condition it is under, in the ruleset's order.
  const state = rules.hp.states
    .map((s) => s.condition ?? s.id)
    .filter((c) => held.some((h) => h.id === c))
    .map((c) => labelOfRow(own(conditionsTable, c), c))
    .join(", ");
  const nowFix = hpDef?.pool ? fix(rules.hp.field, hpNow, { min: poolMin(reg, ctx, who, hpDef.pool), ...(hpMax !== null ? { max: hpMax } : {}) }) : undefined;
  const temporaryFix = fix(rules.hp.temporary, temporary);
  const nonlethalFix = fix(rules.hp.nonlethal, nonlethal);
  const hpFix = { ...(nowFix ? { now: nowFix } : {}), ...(temporaryFix ? { temporary: temporaryFix } : {}), ...(nonlethalFix ? { nonlethal: nonlethalFix } : {}) };
  const progression = own(ctx.world.ruleset?.progression ?? {}, rules.levels.progression);
  const progress = progression ? progressOf(reg, ctx, who, progression) : null;
  const xpFix = progression && progress ? fix(progression.xpField, progress.xp) : undefined;
  const daily = rules.hp.rest.daily.flatMap((field) => {
    const d = def(field);
    if (!d?.pool) return [];
    const most = poolMax(reg, ctx, who, d.pool);
    const now = numberIn(own(e?.fields ?? {}, field) ?? null) ?? most ?? 0;
    const f = fix(field, now, { min: poolMin(reg, ctx, who, d.pool), ...(most !== null ? { max: most } : {}) });
    return [{ gauge: d.label ?? field, now, most, ...(f ? { fix: f } : {}) }];
  });
  return {
    who: name(who),
    ...(isOn(ctx) ? {} : { off: true as const }),
    classes: Object.entries(classesOf(ctx, who))
      .map(([c, l]) => `${labelOfRow(own(classesTable, c), c)} ${l}`)
      .join(", "),
    levels: levelsOf(ctx, who),
    size: labelOfRow(own(rowsOf(ctx, rules, "sizes"), sizeOf(ctx, rules, who)), sizeOf(ctx, rules, who)),
    abilities,
    defence: { ac: line(ctx, who, "ac"), touch: line(ctx, who, "ac.touch"), flat_footed: line(ctx, who, "ac.flat") },
    initiative: line(ctx, who, "initiative"),
    weapons: weapons(ctx, who, name),
    saves,
    skills,
    hp: {
      now: hpNow,
      ...(hpMax !== null ? { most: hpMax } : {}),
      ...(temporary !== 0 ? { temporary } : {}),
      ...(nonlethal !== 0 ? { nonlethal } : {}),
      ...(state !== "" ? { state } : {}),
      ...(Object.keys(hpFix).length > 0 ? { fix: hpFix } : {}),
    },
    ...(progress ? { experience: { level: progress.level, xp: progress.xp, next: progress.next, ...(xpFix ? { fix: xpFix } : {}) } } : {}),
    conditions: held.map((c) => ({ condition: labelOfRow(own(conditionsTable, c.id), c.id), left: left(ctx, c), ...(textIn(own(conditionsTable, c.id)?.text) !== "" ? { does: textIn(own(conditionsTable, c.id)?.text) } : {}) })),
    effects: effectsHeld(ctx, who).map((x) => ({ effect: x.label, mods: x.modifiers.map((m) => say("d20_mod_to", { value: typeof m.value === "number" ? signed(m.value) : m.value, type: m.type ?? "", to: m.to })).join(", "), left: left(ctx, x) })),
    ...(daily.length > 0 ? { daily } : {}),
    traits: traitsHeld(ctx, rules, who).map((t) => {
      const row = own(traitsTable, t.id);
      const label = labelOfRow(row, t.id);
      return { trait: t.choice !== undefined ? `${label} (${t.choice})` : label, ...(textIn(row?.kind) !== "" ? { kind: textIn(row?.kind) } : {}), ...(textIn(row?.text) !== "" ? { does: textIn(row?.text) } : {}) };
    }),
  };
}

/** Play's sheets under the rules: the player's character's, and those of the others the player may look at, each by id. */
export interface SheetsView {
  you: Sheet;
  people: (Sheet & { id: EntityId })[];
}

/**
 * The sheets Play shows (`d20.sheet`); null without the rules on in the chat. The player's character's with its ✎; and of each other
 * creature of the rules' kinds the player may look at (one standing where the player's character stands and in its sight, or one in
 * the fight under way, whose hit points the player may see), the same sheet with no ✎, its hit points told as the fight tells them:
 * the numbers where the ruleset shows them, else the wound alone.
 */
export function sheetsView(ctx: ReadContext): SheetsView | null {
  const rules = rulesOf(ctx.world);
  if (!rules || !isOn(ctx)) return null;
  const pov = ctx.world.pov;
  const name = (id: EntityId): string => labelOf(ctx, id);
  const you = sheetOf(ctx, pov, name, { fixes: true });
  if (!you) return null;
  const reg = ctx.registry;
  const here = placeOfEntity(ctx.state, pov);
  const fighting = new Set((encounterOf(ctx.state)?.order ?? []).map((f) => f.id));
  const combat = combatRulesOf(ctx.world);
  const people: SheetsView["people"] = [];
  for (const [id, e] of Object.entries(ctx.state.entities)) {
    if (id === pov || isGone(ctx.state, id) || !rules.kinds.some((k) => kindIs(reg, ctx.world, e.kind, k))) continue;
    if (!fighting.has(id) && (here === null || placeOfEntity(ctx.state, id) !== here)) continue;
    if (!canSeeEntity(reg, ctx.world, ctx.state, pov, id) || !canSeeField(reg, ctx.world, ctx.state, pov, id, rules.hp.field)) continue;
    const sheet = sheetOf(ctx, id, name);
    if (!sheet) continue;
    const seen = combat ? hpSeen(ctx, combat, id) : null;
    people.push({ ...sheet, id, ...(seen !== null && "wound" in seen ? { hp: { wound: seen.wound, ...(sheet.hp.state !== undefined ? { state: sheet.hp.state } : {}) } } : {}) });
  }
  return { you, people };
}
