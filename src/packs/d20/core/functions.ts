// The formula functions the layer adds (RULESET-DESIGN §4.4). Values stay numbers and words: no list enters the formula language.
// A ruleset's totals are written with them, and so are its tables' formulas. In a world without the rules each reads as nothing
// (0, or false), so a formula that names one is never thrown by it.
//
// `to` in `bonus`, `bonus_without` and `bonus_only` is one name or several set apart by commas, stacked together (a modifier to a
// wider name bears on a narrower one: one to `attack` on `attack.melee`); `types` is a list of types set apart by commas, the
// untyped being `untyped`.

import type { Value } from "../../../engine/expr";
import type { ReadContext } from "../../../engine/registry";
import { own } from "../../../engine/pack-kit";
import { evalExpr, scopeEnv } from "../../../engine/scope";
import type { D20Def } from "../../../shared/d20";
import { D20_FIELDS } from "../../../shared/d20";
import { classesOf, conditionsHeld, numberIn, ranksOf, rowsOf, rulesOf, traitsHeld, wordsIn } from "./model";
import { limitOf, modifiersOf, namesOf, stacked, sumOf, totalOf } from "./modifiers";

type Fn = (ctx: ReadContext, ...args: Value[]) => Value;

const str = (v: Value | undefined): string => (v === null || v === undefined ? "" : String(v));

/** A function that reads the rules, or gives `none` in a world without them. */
function withRules(none: Value, fn: (ctx: ReadContext, rules: D20Def, args: Value[]) => Value): Fn {
  return (ctx, ...args) => {
    const rules = rulesOf(ctx.world);
    return rules === null ? none : fn(ctx, rules, args);
  };
}

/** An ability's score: its field as the creature reads it (its kind's default where none is stored), plus what modifies `ability.<id>` (an enhancement, harm to the ability). */
export function scoreOf(ctx: ReadContext, rules: D20Def, who: string, ability: string): number {
  const base = numberIn(scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who } }).lookup(["self", ability]) ?? null) ?? 0;
  return base + sumOf(stacked(ctx, rules, who, `ability.${ability}`));
}

/** An ability's modifier: the ruleset's `mod` of its score. */
export function modOf(ctx: ReadContext, rules: D20Def, who: string, ability: string): number {
  const v = Number(evalExpr(rules.mod, scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who }, vars: { x: scoreOf(ctx, rules, who, ability) } }), 0));
  return Number.isFinite(v) ? v : 0;
}

/** A creature's total level: its levels in every class. */
export function levelsOf(ctx: ReadContext, who: string): number {
  return Object.values(classesOf(ctx, who)).reduce((n, l) => n + l, 0);
}

/** A track summed over a creature's classes, each read from the tracks table at its own level in it (multiclassing). */
export function classSum(ctx: ReadContext, rules: D20Def, who: string, track: string): number {
  const classes = rowsOf(ctx, rules, "classes");
  const tracks = rowsOf(ctx, rules, "tracks");
  let sum = 0;
  for (const [cls, level] of Object.entries(classesOf(ctx, who))) {
    const ids = own(classes, cls)?.tracks;
    const column = ids !== null && typeof ids === "object" && !Array.isArray(ids) ? ids[track] : undefined;
    if (typeof column !== "string") continue;
    sum += numberIn(own(tracks, String(level))?.[column]) ?? 0;
  }
  return sum;
}

/** Whether a skill is one of a creature's class skills: of one of its classes, or granted by a trait it has. */
export function isClassSkill(ctx: ReadContext, rules: D20Def, who: string, skill: string): boolean {
  const classes = rowsOf(ctx, rules, "classes");
  for (const cls of Object.keys(classesOf(ctx, who))) if (wordsIn(own(classes, cls)?.class_skills).includes(skill)) return true;
  const traits = rowsOf(ctx, rules, "traits");
  for (const t of traitsHeld(ctx, rules, who)) {
    const grants = own(traits, t.id)?.grants;
    if (grants !== null && typeof grants === "object" && !Array.isArray(grants) && wordsIn(grants.class_skills).includes(skill)) return true;
  }
  return false;
}

export const D20_FORMULAS: Readonly<Record<string, Fn>> = {
  score: withRules(0, (ctx, rules, [who, ability]) => scoreOf(ctx, rules, str(who), str(ability))),
  mod: withRules(0, (ctx, rules, [who, ability]) => modOf(ctx, rules, str(who), str(ability))),
  bonus: withRules(0, (ctx, rules, [who, to]) => sumOf(stacked(ctx, rules, str(who), str(to)))),
  bonus_without: withRules(0, (ctx, rules, [who, to, types]) => sumOf(stacked(ctx, rules, str(who), str(to), { types: namesOf(str(types)), keep: false }))),
  bonus_only: withRules(0, (ctx, rules, [who, to, types]) => sumOf(stacked(ctx, rules, str(who), str(to), { types: namesOf(str(types)), keep: true }))),
  limit: withRules(null, (ctx, rules, [who, name, otherwise]) => limitOf(ctx, rules, str(who), str(name)) ?? otherwise ?? null),
  levels: withRules(0, (ctx, _rules, [who]) => levelsOf(ctx, str(who))),
  class_level: withRules(0, (ctx, _rules, [who, cls]) => own(classesOf(ctx, str(who)), str(cls)) ?? 0),
  class_sum: withRules(0, (ctx, rules, [who, track]) => classSum(ctx, rules, str(who), str(track))),
  hit_dice: withRules(0, (ctx, _rules, [who]) => numberIn(own(ctx.state.entities, str(who))?.fields[D20_FIELDS.hitDice]) ?? 0),
  ranks: withRules(0, (ctx, _rules, [who, skill]) => own(ranksOf(ctx, str(who)), str(skill)) ?? 0),
  class_skill: withRules(false, (ctx, rules, [who, skill]) => isClassSkill(ctx, rules, str(who), str(skill))),
  total: withRules(0, (ctx, rules, [who, name, key]) => totalOf(ctx, rules, str(who), str(name), key === undefined || key === null ? {} : { key, skill: key, weapon: key })),
  has_trait: withRules(false, (ctx, rules, [who, id]) => traitsHeld(ctx, rules, str(who)).some((t) => t.id === str(id))),
  under: withRules(false, (ctx, _rules, [who, id]) => conditionsHeld(ctx, str(who)).some((c) => c.id === str(id))),
  size_mod: withRules(0, (ctx, rules, [who, to]) => modifiersOf(ctx, rules, str(who), [], (t) => t === str(to)).reduce((n, m) => n + (m.source === "size" ? m.value : 0), 0)),
  rest_minutes: withRules(0, (_ctx, rules, [hours]) => 60 * (numberIn(hours ?? null) ?? rules.hp.rest.hours)),
};
