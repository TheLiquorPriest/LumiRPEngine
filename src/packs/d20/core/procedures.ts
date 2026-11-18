// Each action's procedure (RULESET-DESIGN §5.1) as an effect of the pack's, `d20.<action>`: it reads the sheet and the ruleset,
// rolls what it rolls with the effect's own seeded dice, and gives the changes (core `set`s, a life state) with the action's record,
// all in one unit, so one Undo takes the action back. `who` is the act's doer; `ruled` the outcome the GM ruled, taken as it is and
// rolled for no further. A procedure works on a scratch copy of what it changes, so a later step reads what an earlier one did (the
// hit points an attack left decide the state the creature is in).
//
// Nothing here refuses a story event: a requirement that does not hold (a skill used untrained, a shot a weapon cannot fire, a
// target beyond range) is said in the record and the procedure goes on. What it refuses is only what it cannot work out: a world
// without the rules, or a value it was given that names nothing (a skill the ruleset lacks), and then it says which in words.

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { jsonEqual } from "../../../shared/json-patch";
import type { EntityId } from "../../../shared/ids";
import { say } from "../../../shared/lines";
import type { LedgerEvent } from "../../../shared/ledger";
import type { TableRow } from "../../../shared/tables";
import { ALIVE } from "../../../shared/world";
import type { ConditionHeld, D20Def, EffectHeld, Modifier, NaturalAttack, ShotDef, TraitHeld } from "../../../shared/d20";
import { D20_ACTIONS, D20_EVENTS, D20_FIELDS, saveLabel } from "../../../shared/d20";
import { parseDice, rollDice, DiceError } from "../../../engine/dice";
import { readyCheck, rollCheck } from "../../../engine/checks";
import { passOutcomes } from "../../../engine/adjudication";
import type { EnvVars } from "../../../engine/expr";
import { fieldBounds } from "../../../engine/effects";
import { lifeOf } from "../../../engine/life";
import type { EffectContext, EffectDef, ReadContext, Rejection } from "../../../engine/registry";
import { createRng, type Rng } from "../../../engine/rng";
import { labelOf, optionalQuery, own } from "../../../engine/pack-kit";
import { evalExpr, fieldDef, placeOfEntity, poolMax, scopeEnv, truthy } from "../../../engine/scope";
import type { EntityState, WorldState } from "../../../engine/state";
import { contentsOf } from "../../../engine/things";
import { classSum, isClassSkill, levelsOf, modOf } from "./functions";
import { classesOf, conditionsHeld, gearOn, isOn, labelOfRow, modifiersIn, naturalAttacks, numberIn, ranksOf, rowIdOf, rowOf, rowsOf, rulesOf, sizeOf, textIn, thingNumber, traitsTaken, wordsIn } from "./model";
import { explain, inSituation, modWords, partsWords, signed, stacked, sumOf, totalOf, type Explained, type Situation } from "./modifiers";

/** The family's die: a check, a save and an attack are rolled on it. */
export const DIE = "1d20";
/** A chance in percent is rolled on this. */
export const PERCENT = "1d100";

// ---------------------------------------------------------------- the scratch copy

/** What a procedure has changed so far, over the state it started from: the changes, and a read of the state as they leave it. */
export class Scratch {
  readonly events: LedgerEvent[] = [];
  readonly ctx: ReadContext;
  private readonly entities: Record<EntityId, EntityState>;

  constructor(readonly base: EffectContext, readonly rules: D20Def) {
    this.entities = { ...base.state.entities };
    const state = { ...base.state, entities: this.entities } as WorldState;
    this.ctx = base.registry.context(base.world, state);
  }

  private touch(id: EntityId): EntityState | null {
    const e = own(this.entities, id);
    if (!e) return null;
    const copy = { ...e, fields: { ...e.fields } };
    this.entities[id] = copy;
    return copy;
  }

  /** A field set, as the change records it; nothing where it already holds the value. */
  set(entity: EntityId, field: string, value: JsonValue): void {
    const e = own(this.entities, entity);
    if (!e || jsonEqual(own(e.fields, field), value)) return;
    this.events.push({ type: "set", entity, field, value });
    const t = this.touch(entity);
    if (t) t.fields[field] = value;
  }

  /** A life state moved, as the engine's own `life` effect records it. */
  life(entity: EntityId, to: string): void {
    if (lifeOf(this.ctx.state, entity) === to) return;
    const def = this.base.registry.effects.get("life");
    const out = def?.resolve({ entity, to }, { ...this.ctx, rng: this.base.rng.fork(`life:${entity}`), params: {} });
    if (!Array.isArray(out)) return;
    this.events.push(...out);
    const t = this.touch(entity);
    if (t) {
      if (to === ALIVE) delete t.life;
      else t.life = to;
    }
  }

  record(type: string, data: JsonObject): void {
    this.events.push({ type: type as `${string}.${string}`, data });
  }

  /** A number field as the creature reads it now (a pool unset reads full, a field unset its default). */
  number(who: EntityId, field: string): number {
    const v = scopeEnv({ reg: this.ctx.registry, ctx: this.ctx, bindings: { self: who } }).lookup(["self", field]);
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  /** A formula with `who` as `self`. */
  eval(src: string | number, who: EntityId, vars: EnvVars = {}): number {
    const v = Number(evalExpr(src, scopeEnv({ reg: this.ctx.registry, ctx: this.ctx, bindings: { self: who }, vars }), 0));
    return Number.isFinite(v) ? v : 0;
  }

  holds(src: string, who: EntityId, vars: EnvVars = {}): boolean {
    return truthy(evalExpr(src, scopeEnv({ reg: this.ctx.registry, ctx: this.ctx, bindings: { self: who }, vars }), false));
  }

  name(id: EntityId): string {
    return labelOf(this.ctx, id);
  }

  /**
   * Someone's hit points from `from` to `to` in the words of `line`, and as the chat's point of view is shown them: the numbers for
   * itself and where the fight shows them exactly, else the combat pack's wound band of where they now stand (`combat.hp_line`), and
   * nothing for someone it cannot see.
   */
  hpWords(who: EntityId, line: string, from: number, to: number): { words: string; shown: string } {
    const words = say(line, { from, to });
    const banded = optionalQuery(this.ctx, "combat.hp_line")?.(this.ctx, { type: "set", entity: who, field: this.rules.hp.field, value: to });
    return { words, shown: banded === undefined ? words : (banded ?? "") };
  }
}

// ---------------------------------------------------------------- what a call gives

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

const text = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const yes = (v: JsonValue | undefined): boolean => v === true || v === "true";
const ids = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : typeof v === "string" && v !== "" ? v.split(",").map((s) => s.trim()).filter((s) => s !== "") : []);

/** The action's parameters as the effect has them. */
function paramsOf(ctx: EffectContext): Readonly<Record<string, JsonValue>> {
  return ctx.params as unknown as Readonly<Record<string, JsonValue>>;
}

/**
 * The modifiers the GM names: each a number with its type, what it changes and why, as words ("+2 circumstance: high ground",
 * "+4 cover to ac: behind the wall") or as an object; `to` absent, the roll they are named for.
 */
function givenMods(v: JsonValue | undefined, to: string): Modifier[] {
  let list: JsonValue[] = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(v) as JsonValue;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  } else if (typeof v === "string" && v.trim() !== "") list = v.split(";");
  const out: Modifier[] = [];
  for (const item of list) {
    if (isRecord(item)) {
      const value = numberIn(item.value);
      if (value !== null) out.push({ to: text(item.to) || to, value, ...(text(item.type) !== "" ? { type: text(item.type) } : {}), ...(text(item.why) !== "" ? { note: text(item.why) } : {}) });
      continue;
    }
    const m = /^\s*([+-]?\d+)\s*([a-z_]+)?(?:\s+to\s+([a-z_.]+))?\s*(?::\s*(.*))?$/i.exec(text(item));
    if (!m) continue;
    const type = m[2] !== undefined && m[2].toLowerCase() !== "to" ? m[2].toLowerCase() : undefined;
    out.push({ to: m[3] ?? to, value: Number(m[1]), ...(type !== undefined ? { type } : {}), ...(m[4] !== undefined && m[4].trim() !== "" ? { note: m[4].trim() } : {}) });
  }
  return out;
}

/** A difficulty as given: a number, or one of the ruleset's difficulties by its id or label. Null where none is given or it names none. */
function difficultyOf(ctx: ReadContext, rules: D20Def, said: JsonValue | undefined): number | null {
  const n = numberIn(said ?? null);
  if (n !== null) return n;
  const word = text(said);
  if (word === "") return null;
  const hit = rowOf(ctx, rules, "difficulties", word);
  return hit ? numberIn(hit.row.dc) : null;
}

/** What one roll of the family's die came to. */
function d20(rng: Rng): number {
  return rollDice(DIE, rng).total;
}

/** The dice a point spent on a roll adds at the spender's level (`boost.dice`, a formula that reads as a notation), or "" in a ruleset without them. */
export function boostDice(ctx: ReadContext, rules: D20Def, who: EntityId): string {
  if (!rules.boost) return "";
  const v = evalExpr(rules.boost.dice, scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who } }), "");
  return typeof v === "string" ? v.trim() : "";
}

/** Whether `who` could spend a point on `action`'s roll now: the ruleset lets that roll take one and the gauge holds one. */
export function canBoost(s: Scratch, who: EntityId, action: string): boolean {
  const b = s.rules.boost;
  return b !== undefined && b.rolls.includes(action) && s.number(who, b.gauge) > 0 && boostDice(s.ctx, s.rules, who) !== "";
}

/**
 * A point spent on a roll (`boost`), where the call asks for one: one taken from the gauge (said where it held none, and spent all the
 * same) and the dice it gives rolled, to be added to that roll; nothing, and said, where the ruleset lets this roll take none.
 */
function boostOf(s: Scratch, who: EntityId, action: string, p: Readonly<Record<string, JsonValue>>, rng: Rng, notes: string[]): { total: number; words: string } | null {
  if (!yes(p.boost)) return null;
  const b = s.rules.boost;
  if (!b || !b.rolls.includes(action)) {
    notes.push(say("d20_no_boost", { action }));
    return null;
  }
  const kind = own(s.ctx.state.entities, who)?.kind ?? "";
  const def = fieldDef(s.ctx.registry, s.ctx.world, kind, b.gauge);
  const gauge = def?.label ?? b.gauge;
  const left = s.number(who, b.gauge);
  if (left <= 0) notes.push(say("d20_boost_empty", { who: s.name(who), gauge }));
  const floor = fieldBounds(s.ctx.registry, s.ctx, who, def).min;
  s.set(who, b.gauge, floor !== undefined ? Math.max(floor, left - 1) : left - 1);
  const dice = boostDice(s.ctx, s.rules, who);
  try {
    const rolled = rollDice(dice, rng).total;
    return { total: rolled, words: say("d20_boost", { gauge, dice, rolled }) };
  } catch (e) {
    if (!(e instanceof DiceError)) throw e;
    notes.push(say("d20_boost_unread", { dice }));
    return null;
  }
}

/** Dice or a number as given; null where it is neither. */
function amountRolled(said: JsonValue | undefined, rng: Rng): { dice: string | null; total: number } | null {
  const n = numberIn(said ?? null);
  if (n !== null) return { dice: null, total: n };
  const s = text(said);
  if (s === "") return null;
  try {
    return { dice: s, total: rollDice(s, rng).total };
  } catch (e) {
    if (e instanceof DiceError) return null;
    throw e;
  }
}

/** The save a word names: `fort`, `save.fort`, or a word one of the ruleset's saves begins (`fortitude`). */
function saveNamed(rules: D20Def, said: string): string | null {
  const lower = said.trim().toLowerCase().replace(/^save\./, "");
  const saves = Object.keys(rules.totals).filter((k) => k.startsWith("save.")).map((k) => k.slice(5));
  return saves.find((s) => s === lower) ?? saves.find((s) => lower.startsWith(s) || s.startsWith(lower)) ?? null;
}

/** The ability a word names: its id, or its label on the creature's kind. */
function abilityNamed(ctx: ReadContext, rules: D20Def, who: EntityId, said: string): string | null {
  const lower = said.trim().toLowerCase();
  const kind = own(ctx.state.entities, who)?.kind;
  return rules.abilities.find((a) => a.toLowerCase() === lower || (kind !== undefined && (fieldDef(ctx.registry, ctx.world, kind, a)?.label ?? "").toLowerCase() === lower)) ?? null;
}

/** The ids of everyone named, with the doer first. */
function andAlso(who: EntityId, also: JsonValue | undefined, ctx: ReadContext): EntityId[] {
  return [who, ...ids(also).filter((id) => id !== who && own(ctx.state.entities, id) !== undefined)];
}

// ---------------------------------------------------------------- hit points and the states below them

/** A creature's hit points now, the most it has, and its floor. */
function hpOf(s: Scratch, who: EntityId): { now: number; min?: number; max?: number } {
  const e = own(s.ctx.state.entities, who);
  const def = e ? fieldDef(s.ctx.registry, s.ctx.world, e.kind, s.rules.hp.field) : undefined;
  return { now: s.number(who, s.rules.hp.field), ...fieldBounds(s.ctx.registry, s.ctx, who, def) };
}

/**
 * Sets what hit points leave a creature in (§4.5): each of the ruleset's states that holds is put on as its condition, each that
 * no longer holds is taken off (and the dying's stable mark with the dying), and its life state is the first holding state's that
 * names one, or alive again once none does. Recorded as one record of what moved; nothing where nothing did.
 */
function settle(s: Scratch, who: EntityId): void {
  const rules = s.rules;
  const raw = own(s.ctx.state.entities, who)?.fields[D20_FIELDS.conditions];
  const list = Array.isArray(raw) ? (raw.filter((c): c is JsonObject => isRecord(c)) as unknown as ConditionHeld[]) : [];
  const holding = rules.hp.states.filter((st) => s.holds(st.when, who));
  const named = new Set(rules.hp.states.map((st) => st.condition ?? st.id));
  const dying = rules.hp.dying;
  if (dying) named.add(dying.stable);
  const want = new Set(holding.map((st) => st.condition ?? st.id));
  if (dying && want.has(dying.state) && list.some((c) => c.id === dying.stable)) want.add(dying.stable);
  const kept = list.filter((c) => !named.has(c.id) || want.has(c.id));
  const on = [...want].filter((id) => !list.some((c) => c.id === id));
  const off = list.filter((c) => named.has(c.id) && !want.has(c.id)).map((c) => c.id);
  if (on.length > 0 || off.length > 0) s.set(who, D20_FIELDS.conditions, [...kept, ...on.map((id) => ({ id }))] as unknown as JsonValue);
  const lives = new Set(rules.hp.states.flatMap((st) => (st.life !== undefined ? [st.life] : [])));
  const life = holding.find((st) => st.life !== undefined)?.life;
  const now = lifeOf(s.ctx.state, who);
  let moved: string | null = null;
  if (life !== undefined && now !== life) moved = life;
  else if (life === undefined && now !== ALIVE && lives.has(now)) moved = ALIVE;
  if (moved !== null) s.life(who, moved);
  if (on.length === 0 && off.length === 0 && moved === null) return;
  const label = (id: string): string => labelOfRow(own(rowsOf(s.ctx, rules, "conditions"), id), id);
  s.record(D20_EVENTS.state, {
    who,
    told: say("d20_state", { ...(on.length > 0 ? { on: on.map(label).join(", ") } : {}), ...(off.length > 0 ? { off: off.map(label).join(", ") } : {}), ...(moved !== null ? { life: moved } : {}) }),
  });
}

/** What harm did to one creature: its hit points before and after, and the words for it. */
interface Harmed {
  from: number;
  to: number;
  words: string;
  /** The words as the chat's point of view is shown them: another's hit points as the fight shows them. */
  shown: string;
}

/** Words that say the same to everyone, as a part of both the record's words and the player's. */
const plain = (words: string): { words: string; shown: string } => ({ words, shown: words });

/** Parts joined, the record's words and the player's each. */
function joined(parts: readonly { words: string; shown: string }[], by: string): { words: string; shown: string } {
  return { words: parts.map((p) => p.words).filter((x) => x !== "").join(by), shown: parts.map((p) => p.shown).filter((x) => x !== "").join(by) };
}

/** A record's words: `told` as the GM and the agents read them, and `shown` beside them where the player is shown less (another's hit points). */
function toldOf(said: { words: string; shown: string }): { told: string; shown?: string } {
  return { told: said.words, ...(said.shown !== said.words ? { shown: said.shown } : {}) };
}

/**
 * Harm to one creature (§4.5): nonlethal harm adds to its nonlethal field; lethal harm comes off its temporary hit points first and
 * then off its gauge, held to the gauge's bounds (its floor a formula of the ruleset's); massive harm asks for the ruleset's save,
 * whose failure sets the hit points as the ruleset says. Then the states are settled.
 */
function harmOne(s: Scratch, who: EntityId, amount: number, nonlethal: boolean, rng: Rng): Harmed {
  const rules = s.rules;
  const hp = hpOf(s, who);
  const parts: { words: string; shown: string }[] = [];
  if (nonlethal) {
    const before = s.number(who, rules.hp.nonlethal);
    s.set(who, rules.hp.nonlethal, before + amount);
    parts.push(plain(say("d20_harm_nonlethal", { from: before, to: before + amount })));
  } else {
    const temp = s.number(who, rules.hp.temporary);
    const absorbed = Math.min(Math.max(0, temp), amount);
    if (absorbed > 0) {
      s.set(who, rules.hp.temporary, temp - absorbed);
      parts.push(plain(say("d20_harm_temporary", { absorbed, left: temp - absorbed })));
    }
    let to = hp.now - (amount - absorbed);
    if (hp.min !== undefined) to = Math.max(hp.min, to);
    s.set(who, rules.hp.field, to);
    parts.push(s.hpWords(who, "d20_harm_hp", hp.now, to));
    const massive = rules.hp.massive;
    if (massive && s.holds(massive.when, who, { amount })) {
      const dc = typeof massive.dc === "number" ? massive.dc : s.eval(massive.dc, who, { amount });
      const save = rollSave(s, who, massive.save, dc, [], rng.fork("massive"));
      parts.push(plain(say("d20_harm_massive", { save: save.words })));
      if (save.outcome === "failure") {
        let set = s.eval(massive.hp, who, { amount });
        if (hp.min !== undefined) set = Math.max(hp.min, set);
        s.set(who, rules.hp.field, set);
        parts.push(s.hpWords(who, "d20_harm_hp", to, set));
      }
    }
  }
  settle(s, who);
  return { from: hp.now, to: s.number(who, rules.hp.field), ...joined(parts, ", ") };
}

/** The best reduction a creature has against harm of `types` (one that any of them passes does not count), and its best resistance to them. */
function stoppedBy(s: Scratch, who: EntityId, types: readonly string[], physical: boolean): { amount: number; words: string } {
  const mods = stacked(s.ctx, s.rules, who, ["reduction", ...types.map((t) => `resist.${t}`)].join(","));
  let reduction = 0;
  let from = "";
  if (physical) {
    for (const m of mods) if (m.to === "reduction" && m.value > reduction && !(m.bypass ?? []).some((b) => types.includes(b))) [reduction, from] = [m.value, m.from];
  }
  let resist = 0;
  let rfrom = "";
  for (const m of mods) if (m.to.startsWith("resist.") && m.value > resist) [resist, rfrom] = [m.value, m.from];
  const words = [reduction > 0 ? say("d20_reduction", { amount: reduction, from }) : "", resist > 0 ? say("d20_resistance", { amount: resist, from: rfrom }) : ""].filter((w) => w !== "").join(", ");
  return { amount: reduction + resist, words };
}

// ---------------------------------------------------------------- rolls

/** A d20 roll against a total, with the natural die's own rule where the ruleset has one. */
interface Rolled {
  natural: number | null;
  total: number;
  outcome: "success" | "failure" | "rolled";
  words: string;
}

/** A save as it stands before its die: the sheet's total (`save.<id>`) with the GM's own modifiers, and its parts. The roll and the odds both read it. */
export function savePlan(s: Scratch, who: EntityId, said: string, given: readonly Modifier[]): { id: string; bonus: number; parts: string } {
  const rules = s.rules;
  const id = saveNamed(rules, said) ?? said;
  const e = explain(s.ctx, rules, who, `save.${id}`);
  const extra = given.length > 0 ? sumOf(stacked(s.ctx, rules, who, `save.${id}`, undefined, given)) - sumOf(stacked(s.ctx, rules, who, `save.${id}`)) : 0;
  const parts = [e ? partsWords(e) : "", ...given.map((g) => modWords({ to: g.to, value: Number(g.value), type: g.type ?? null, source: "given", from: say("d20_given"), ...(g.note !== undefined ? { note: g.note } : {}), counted: true }))].filter((p) => p !== "").join(", ");
  return { id, bonus: (e?.total ?? 0) + extra, parts };
}

/** A save worked out from the sheet, against a difficulty, with the ruleset's rule for the natural die. */
function rollSave(s: Scratch, who: EntityId, said: string, dc: number, given: readonly Modifier[], rng: Rng, ruled?: string, spent: { total: number; words: string } | null = null): Rolled & { save: string; parts: string } {
  const rules = s.rules;
  const { id, bonus, parts } = savePlan(s, who, said, given);
  if (ruled === "success" || ruled === "failure") return { save: id, natural: null, total: bonus, outcome: ruled, parts, words: say("d20_save_ruled", { save: saveLabel(rules, id), outcome: say(`d20_outcome_${ruled}`) }) };
  const natural = d20(rng);
  const total = natural + bonus + (spent?.total ?? 0);
  let outcome: "success" | "failure" = total >= dc ? "success" : "failure";
  if (rules.save.autoFail !== undefined && natural <= rules.save.autoFail) outcome = "failure";
  if (rules.save.autoSucceed !== undefined && natural >= rules.save.autoSucceed) outcome = "success";
  return { save: id, natural, total, outcome, parts, words: say("d20_roll", { natural, bonus: signed(bonus), ...(spent ? { boost: spent.words } : {}), total, dc, outcome: say(`d20_outcome_${outcome}`) }) };
}

// ---------------------------------------------------------------- the procedures

type Procedure = (s: Scratch, who: EntityId, p: Readonly<Record<string, JsonValue>>, rng: Rng, ruled: string | undefined) => Rejection | null;

/** A check as it stands before a die is rolled: its total and parts, each helper's, the difficulty, a number taken, whom it is against. The roll and the odds both read it. */
export interface CheckPlan {
  what: string;
  mine: Explained;
  /** What the GM's own modifiers add, stacked as the sheet's are. */
  extra: number;
  given: readonly Modifier[];
  notes: string[];
  helpers: { id: EntityId; total: number }[];
  dc: number | null;
  take: { said: string; value: number } | null;
  vs: { who: EntityId; theirs: Explained } | null;
}

/** A check's plan: a skill (`skill` total) or an ability, against a difficulty or another's roll; or why it cannot be worked out. */
export function checkPlan(s: Scratch, who: EntityId, p: Readonly<Record<string, JsonValue>>): CheckPlan | Rejection {
  const rules = s.rules;
  const said = text(p.skill);
  const skill = rowOf(s.ctx, rules, "skills", said);
  const ability = skill ? null : abilityNamed(s.ctx, rules, who, said);
  if (!skill && ability === null) return reject("d20_no_skill", say("why_d20_no_skill", { said, skills: Object.keys(rowsOf(s.ctx, rules, "skills")).join(", "), abilities: rules.abilities.join(", ") }));
  // An ability's check: its modifier, and what modifies `ability_check.<id>` (a condition's penalty to every check, the ability's own).
  const name = skill ? `skill.${skill.id}` : `ability_check.${ability ?? ""}`;
  const given = givenMods(p.mods, name);
  const explainOf = (id: EntityId): Explained => {
    if (skill) return explain(s.ctx, rules, id, "skill", { skill: skill.id, key: skill.id, weapon: skill.id }) ?? { total: 0, parts: [] };
    const m = modOf(s.ctx, rules, id, ability ?? "");
    const mods = stacked(s.ctx, rules, id, name);
    return { total: m + sumOf(mods), parts: [{ value: m, words: say("d20_part_ability", { value: signed(m), ability: ability ?? "" }) }, ...(mods.length > 0 ? [{ value: sumOf(mods), words: mods.map(modWords).join(", "), mods }] : [])] };
  };
  const mine = explainOf(who);
  const extra = given.length > 0 ? sumOf(stacked(s.ctx, rules, who, name, undefined, given)) - sumOf(stacked(s.ctx, rules, who, name)) : 0;
  const notes: string[] = [];
  if (skill && skill.row.trained === true && (own(ranksOf(s.ctx, who), skill.id) ?? 0) <= 0) notes.push(say("d20_untrained", { skill: labelOfRow(skill.row, skill.id) }));
  const helpers = ids(p.aid)
    .filter((helper) => helper !== who && own(s.ctx.state.entities, helper))
    .map((helper) => ({ id: helper, total: explainOf(helper).total }));
  const take = text(p.take) === "" ? undefined : own(rules.check.take, text(p.take));
  if (text(p.take) !== "" && take === undefined) notes.push(say("d20_no_take", { take: text(p.take), takes: Object.keys(rules.check.take).join(", ") }));
  const vs = text(p.vs);
  let against: CheckPlan["vs"] = null;
  if (vs !== "" && own(s.ctx.state.entities, vs)) {
    const theirSkill = text(p.vs_skill) === "" ? skill : rowOf(s.ctx, rules, "skills", text(p.vs_skill));
    against = { who: vs, theirs: theirSkill ? (explain(s.ctx, rules, vs, "skill", { skill: theirSkill.id, key: theirSkill.id }) ?? { total: 0, parts: [] }) : explainOf(vs) };
  }
  return { what: skill ? labelOfRow(skill.row, skill.id) : (ability ?? ""), mine, extra, given, notes, helpers, dc: difficultyOf(s.ctx, rules, p.difficulty), take: take ? { said: text(p.take), value: take.value } : null, vs: against };
}

/** A check rolled: helped by others, taking a number or rolling, against a difficulty or another's roll. */
const check: Procedure = (s, who, p, rng, ruled) => {
  const rules = s.rules;
  const plan = checkPlan(s, who, p);
  if ("code" in plan) return plan;
  const { dc, take, vs } = plan;
  // Helpers: each rolls the same check, and each who reaches the ruleset's mark adds its bonus.
  let aid = 0;
  const aided: string[] = [];
  for (const helper of plan.helpers) {
    const roll = d20(rng.fork(`aid:${helper.id}`));
    const ok = roll + helper.total >= rules.check.aid.dc;
    if (ok) aid += rules.check.aid.bonus;
    aided.push(say("d20_aid", { who: s.name(helper.id), total: roll + helper.total, dc: rules.check.aid.dc, outcome: say(`d20_outcome_${ok ? "success" : "failure"}`) }));
  }
  const bonus = plan.mine.total + plan.extra + aid;
  let natural: number | null = null;
  let total = bonus;
  let outcome: string = "rolled";
  let against: number | null = null;
  let spent: { total: number; words: string } | null = null;
  if (ruled === "success" || ruled === "failure") outcome = ruled;
  else {
    natural = take ? take.value : d20(rng.fork("check"));
    spent = boostOf(s, who, "check", p, rng.fork("boost"), plan.notes);
    total = natural + bonus + (spent?.total ?? 0);
    if (vs) {
      against = d20(rng.fork("vs")) + vs.theirs.total;
      // Equal totals go to the higher bonus; equal bonuses, to the one who acts.
      outcome = total > against || (total === against && bonus >= vs.theirs.total) ? "success" : "failure";
    } else if (dc !== null) outcome = total >= dc ? "success" : "failure";
    if (!take && natural !== null && rules.check.autoFail !== undefined && natural <= rules.check.autoFail) outcome = "failure";
    if (!take && natural !== null && rules.check.autoSucceed !== undefined && natural >= rules.check.autoSucceed) outcome = "success";
  }
  const parts = [partsWords(plan.mine), ...plan.given.map((g) => modWords({ to: g.to, value: Number(g.value), type: g.type ?? null, source: "given", from: say("d20_given"), ...(g.note !== undefined ? { note: g.note } : {}), counted: true })), ...(aid !== 0 ? [say("d20_part_aid", { value: signed(aid) })] : [])].filter((x) => x !== "").join(", ");
  s.record(D20_EVENTS.check, {
    who,
    what: plan.what,
    ...(natural !== null ? { natural } : {}),
    total,
    ...(parts !== "" ? { parts } : {}),
    ...(spent ? { boost: spent.words } : {}),
    ...(dc !== null ? { dc } : {}),
    ...(vs && against !== null ? { vs: vs.who, against } : {}),
    ...(take ? { take: take.said } : {}),
    ...(aided.length > 0 ? { aided: aided.join("; ") } : {}),
    ...(plan.notes.length > 0 ? { notes: plan.notes.join("; ") } : {}),
    outcome,
    ...(ruled !== undefined ? { ruled: true } : {}),
  });
  return null;
};

/** A save the action asks for: which save, the difficulty, everyone who makes it and the GM's own modifiers; or why it cannot be worked out. */
export function saveCall(s: Scratch, who: EntityId, p: Readonly<Record<string, JsonValue>>): { id: string; dc: number; savers: EntityId[]; given: Modifier[] } | Rejection {
  const rules = s.rules;
  const id = saveNamed(rules, text(p.save));
  if (id === null) return reject("d20_no_save", say("why_d20_no_save", { said: text(p.save), saves: Object.keys(rules.totals).filter((k) => k.startsWith("save.")).map((k) => saveLabel(rules, k.slice(5))).join(", ") }));
  const dc = difficultyOf(s.ctx, rules, p.difficulty);
  if (dc === null) return reject("d20_no_difficulty", say("why_d20_no_difficulty", { said: text(p.difficulty) }));
  return { id, dc, savers: andAlso(who, p.also, s.ctx), given: givenMods(p.mods, `save.${id}`) };
}

/** A save for the doer and everyone else named, each against the one difficulty. */
const save: Procedure = (s, who, p, rng, ruled) => {
  const call = saveCall(s, who, p);
  if ("code" in call) return call;
  const { id, dc } = call;
  const notes: string[] = [];
  for (const one of call.savers) {
    const spent = one === who && ruled === undefined ? boostOf(s, who, "save", p, rng.fork("boost"), notes) : null;
    const r = rollSave(s, one, id, dc, call.given, rng.fork(`save:${one}`), ruled, spent);
    s.record(D20_EVENTS.save, { who: one, save: id, ...(r.natural !== null ? { natural: r.natural } : {}), total: r.total, ...(r.parts !== "" ? { parts: r.parts } : {}), ...(spent ? { boost: spent.words } : {}), dc, outcome: r.outcome, ...(ruled !== undefined ? { ruled: true } : {}), ...(one === who && notes.length > 0 ? { notes: notes.join("; ") } : {}) });
  }
  return null;
};

/** What an attack is made with: a weapon's row (and the thing, where it is one), or one of the creature's own attacks. */
export interface Weapon {
  label: string;
  item: EntityId | null;
  rowId: string;
  row: TableRow | null;
  natural: NaturalAttack | null;
}

/** Everything a creature holds or carries, at any depth, readied things first. */
function carriedBy(s: Scratch, who: EntityId): EntityId[] {
  const out: EntityId[] = [...gearOn(s.ctx, who).readied];
  const walk = (holder: EntityId, depth: number): void => {
    if (depth > 6) return;
    for (const id of contentsOf(s.ctx.state, holder)) {
      if (!out.includes(id)) out.push(id);
      walk(id, depth + 1);
    }
  };
  walk(who, 0);
  return out;
}

/** A thing as the weapon of its row (`d20_row`, else its catalog's), or null where it is none of the weapons table's. */
function asWeapon(s: Scratch, id: EntityId): Weapon | null {
  const rid = rowIdOf(s.ctx, id);
  const row = own(rowsOf(s.ctx, s.rules, "weapons"), rid);
  return row ? { label: s.name(id), item: id, rowId: rid, row, natural: null } : null;
}

/**
 * Why a thing in hand is no weapon of the rules, with the one call that makes it one: its `d20_row` set to a weapons row, the rows whose
 * names share a word with its name named (or the first of the table).
 */
export function notAWeapon(s: Scratch, who: EntityId, thing: EntityId): Rejection {
  const rows = rowsOf(s.ctx, s.rules, "weapons");
  const words = new Set(s.name(thing).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 1));
  const near = Object.entries(rows).filter(([id, row]) => `${id} ${labelOfRow(row, id)}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((x) => words.has(x)));
  const named = (near.length > 0 ? near : Object.entries(rows)).slice(0, 8).map(([id, row]) => `${labelOfRow(row, id)} [${id}]`);
  const call = JSON.stringify({ op: "set", at: s.name(thing), key: D20_FIELDS.row, value: near[0]?.[0] ?? Object.keys(rows)[0] ?? "" });
  return reject("d20_not_a_weapon", say("why_d20_not_a_weapon", { thing: s.name(thing), who: s.name(who), call, rows: named.join(", ") }));
}

/**
 * The weapon `with` names: a thing the attacker holds or carries by name, its own attack by label, or a weapons row. Else what it has
 * readied, else a weapon it carries, else its own first attack. A thing named or in hand that is no weapon of the rules is answered with
 * the call that makes it one; nothing at all, with what it could name.
 */
function weaponOf(s: Scratch, who: EntityId, said: string): Weapon | Rejection {
  const rules = s.rules;
  const naturals = naturalAttacks(s.ctx, who);
  const nothing = reject("d20_no_weapon", say("why_d20_no_weapon", { who: s.name(who), said }));
  if (said !== "") {
    const lower = said.toLowerCase();
    const thing = carriedBy(s, who).find((id) => s.name(id).toLowerCase() === lower || id === said);
    if (thing !== undefined) return asWeapon(s, thing) ?? notAWeapon(s, who, thing);
    const nat = naturals.find((a) => a.label.toLowerCase() === lower);
    if (nat) return { label: nat.label, item: null, rowId: weaponKey(nat), row: null, natural: nat };
    const row = rowOf(s.ctx, rules, "weapons", said);
    return row ? { label: labelOfRow(row.row, row.id), item: null, rowId: row.id, row: row.row, natural: null } : nothing;
  }
  const readied = gearOn(s.ctx, who).readied;
  for (const id of carriedBy(s, who)) {
    const w = asWeapon(s, id);
    if (w) return w;
  }
  const first = naturals[0];
  if (first) return { label: first.label, item: null, rowId: weaponKey(first), row: null, natural: first };
  const inHand = readied[0];
  return inHand !== undefined ? notAWeapon(s, who, inHand) : nothing;
}

/** What a creature could attack with, as its sheet lists it: each weapon it holds or carries, then its own attacks; and each thing in hand that is no weapon of the rules. */
export function armedWith(s: Scratch, who: EntityId): { weapons: Weapon[]; unarmed: EntityId[] } {
  const weapons: Weapon[] = [];
  const unarmed: EntityId[] = [];
  const readied = gearOn(s.ctx, who).readied;
  for (const id of carriedBy(s, who)) {
    const w = asWeapon(s, id);
    if (w) weapons.push(w);
    else if (readied.includes(id)) unarmed.push(id);
  }
  for (const nat of naturalAttacks(s.ctx, who)) weapons.push({ label: nat.label, item: null, rowId: weaponKey(nat), row: null, natural: nat });
  return { weapons, unarmed };
}

/** A weapon's damage dice for a wielder of `size`: its row's notation for that size (or its one notation), or its own attack's. */
function damageDice(w: Weapon, size: string): string {
  if (w.natural) return w.natural.damage;
  const d = w.row?.damage;
  if (typeof d === "string") return d;
  if (isRecord(d)) {
    const exact = d[size];
    if (typeof exact === "string") return exact;
    const first = Object.values(d).find((x): x is string => typeof x === "string");
    if (first !== undefined) return first;
  }
  return "";
}

/** What a creature's own attack is known by in the totals' `weapon` and in a modifier's choice (`attack.weapon.bite`): its label in lower case. */
export function weaponKey(natural: NaturalAttack): string {
  return natural.label.toLowerCase();
}

/**
 * The lowest natural die an attack with a weapon threatens on: its own attack's threat or its row's (the sure hit's die without one),
 * widened by what modifies `threat.weapon.<id>` (a feat that doubles a weapon's range adds its width), stacked as any total's are.
 */
export function threatFrom(ctx: ReadContext, rules: D20Def, who: EntityId, w: Pick<Weapon, "rowId" | "row" | "natural">): number {
  const own = w.natural?.threat ?? numberIn(w.row?.threat ?? null) ?? rules.attack.autoHit;
  return w.rowId === "" ? own : own - sumOf(stacked(ctx, rules, who, `threat.weapon.${w.rowId}`));
}

/** Whether a creature is proficient with a weapons row: none is needed where the row names no proficiency; else its classes' or traits' proficiency names the row's or the row itself. */
function proficient(s: Scratch, who: EntityId, w: Weapon): boolean {
  if (!w.row || textIn(w.row.proficiency) === "") return true;
  const want = [textIn(w.row.proficiency), w.rowId];
  const classes = rowsOf(s.ctx, s.rules, "classes");
  for (const cls of Object.keys(classesOf(s.ctx, who))) if (wordsIn(own(classes, cls)?.proficiency).some((x) => want.includes(x))) return true;
  const traits = rowsOf(s.ctx, s.rules, "traits");
  for (const t of traitsTaken(s.ctx, who)) {
    const g = own(traits, t.id)?.grants;
    if (isRecord(g) && (wordsIn(g.proficiency).some((x) => want.includes(x)) || (t.choice !== undefined && want.includes(t.choice)))) return true;
  }
  return false;
}

/** Whether a creature is flat-footed now: under a condition flagged so, or in a fight it has not acted in yet. */
function flatFooted(s: Scratch, who: EntityId): boolean {
  const conditions = rowsOf(s.ctx, s.rules, "conditions");
  if (conditionsHeld(s.ctx, who).some((c) => wordsIn(own(conditions, c.id)?.flags).includes("flat"))) return true;
  const fn = s.ctx.registry.formulas.get("has_acted");
  return fn !== undefined && fn(s.ctx, who) === false;
}

/** Everyone within `radius` (the world's units) of a creature on its grid, itself among them. */
function around(s: Scratch, centre: EntityId, radius: number): EntityId[] {
  const distance = s.ctx.registry.formulas.get("distance");
  const place = placeOfEntity(s.ctx.state, centre);
  if (!distance || place === null) return [centre];
  return Object.keys(s.ctx.state.entities)
    .filter((id) => id === centre || (placeOfEntity(s.ctx.state, id) === place && own(s.ctx.state.entities, id)?.kind !== "item" && (() => {
      const d = distance(s.ctx, centre, id);
      return typeof d === "number" && d <= radius;
    })()))
    .sort();
}

/** An attack as it stands before a die is rolled: the weapon and how it is held, the attack's total and what it adds, the damage it would do, each attack's offset. The roll and the odds both read it. */
export interface AttackPlan {
  /** Whom it is made against; "" for the sheet's line, made against no one. */
  target: EntityId;
  w: Weapon;
  ranged: boolean;
  /** Who attacks whom and how far apart they stand, as both sides' modifiers read them; null against no one. */
  situation: Situation | null;
  toAc: Modifier[];
  roll: Explained;
  /** What the attack adds beyond its total, each with its words: the weapon's enhancement, an unskilled weapon, range, a shot. */
  extras: { value: number; words: string }[];
  extra: number;
  rollParts: string;
  nonlethal: boolean;
  notes: string[];
  shot: ShotDef | undefined;
  /** The weapon's damage dice a shot adds: none where it was fired without the trait its `without` names. */
  shotDice: number;
  magazine: number | null;
  spend: number;
  dice: string;
  types: readonly string[];
  threatFrom: number;
  multiplier: number;
  strength: number;
  damageBonus: number;
  /** Each attack's step below the first: one, or every one a high base attack gives with `full`. */
  offsets: number[];
  touch: boolean;
  concealment: number;
}

/**
 * An attack's plan (§5.1): the weapon's numbers from its row, the attack's total from the sheet, the range and its penalty from the
 * grid (or from the call's `distance` where there is none), the shot and what holds of it without its trait; every modifier read with
 * the target and the distance bound. Or why it cannot be worked out.
 */
export function attackPlan(s: Scratch, who: EntityId, p: Readonly<Record<string, JsonValue>>): AttackPlan | Rejection {
  const target = text(p.target);
  if (!own(s.ctx.state.entities, target)) return reject("d20_no_target", say("why_d20_no_target", { said: target }));
  const w = weaponOf(s, who, text(p.with));
  if ("code" in w) return w;
  return planWith(s, who, w, p, target);
}

/** A distance as a person would say it in the world's unit: whole above ten, to a tenth below, the grid's unit where it was measured on one. */
function farWords(s: Scratch, who: EntityId, amount: number, measured: boolean): string {
  const spoken = Math.abs(amount) >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10;
  const unit = measured ? s.ctx.registry.formulas.get("grid_unit")?.(s.ctx, who) : null;
  return unit === "feet" || unit === "metres" ? say(`d20_far_${unit}`, { amount: spoken }) : String(spoken);
}

/**
 * The plan of an attack with a weapon, against `target` or (for the sheet's line) against no one: everything the attack's roll and
 * damage read, from the one source the attack, its odds and the sheet all use.
 */
export function planWith(s: Scratch, who: EntityId, w: Weapon, p: Readonly<Record<string, JsonValue>>, target: EntityId | null): AttackPlan {
  const rules = s.rules;
  const a = rules.attack;
  const notes: string[] = [];
  const distanceFn = s.ctx.registry.formulas.get("distance");
  const grid = target !== null && distanceFn ? distanceFn(s.ctx, who, target) : null;
  const apart = typeof grid === "number" ? grid : numberIn(p.distance ?? null);
  const situation: Situation | null = target !== null ? { who, target, distance: apart } : null;
  let unknown = false;
  const situated = <T>(fn: () => T): T => {
    if (situation === null) return fn();
    const r = inSituation(s.ctx, situation, fn);
    if (r.unknownDistance) unknown = true;
    return r.value;
  };
  const held = text(p.held) !== "" ? text(p.held) : w.natural ? (w.natural.held ?? "one") : textIn(w.row?.held);
  const ranged = held === "projectile" || held === "thrown" || held === "ranged";
  const totalName = w.natural?.total ?? (ranged ? a.totals.ranged : a.totals.melee);
  const vars: EnvVars = { weapon: w.rowId, key: w.rowId, ...(apart !== null ? { distance: apart } : {}) };
  const bindings: Record<string, EntityId> = target !== null ? { target } : {};
  const given = givenMods(p.mods, "attack");
  const toAc = given.filter((m) => m.to === "ac" || m.to.startsWith("ac."));
  const toRoll = given.filter((m) => !toAc.includes(m) && !m.to.startsWith("damage"));
  const toDamage = given.filter((m) => m.to.startsWith("damage"));
  const roll = situated(() => explain(s.ctx, rules, who, totalName, vars, bindings)) ?? { total: 0, parts: [] };
  const extras: { value: number; words: string }[] = [];
  const enh = w.item ? thingNumber(s.ctx, w.item, D20_FIELDS.enhancement) : 0;
  if (enh !== 0) extras.push({ value: enh, words: say("d20_part_enhancement", { value: signed(enh), from: w.label }) });
  if (!proficient(s, who, w)) extras.push({ value: a.unskilled, words: say("d20_part_unskilled", { value: signed(a.unskilled), weapon: w.label }) });
  const weaponNonlethal = w.row?.nonlethal === true;
  const nonlethal = yes(p.nonlethal) || weaponNonlethal;
  if (yes(p.nonlethal) !== weaponNonlethal && yes(p.nonlethal)) extras.push({ value: a.nonlethal, words: say("d20_part_nonlethal", { value: signed(a.nonlethal) }) });
  if (w.natural?.bonus !== undefined) extras.push({ value: w.natural.bonus, words: say("d20_part_base", { value: signed(w.natural.bonus) }) });
  if (w.natural?.secondary === true) extras.push({ value: a.secondary, words: say("d20_part_secondary", { value: signed(a.secondary) }) });
  for (const g of toRoll) extras.push({ value: Number(g.value), words: modWords({ to: g.to, value: Number(g.value), type: g.type ?? null, source: "given", from: say("d20_given"), ...(g.note !== undefined ? { note: g.note } : {}), counted: true }) });
  // Range: each increment past the first takes the ruleset's penalty.
  const increment = numberIn(w.row?.range ?? null);
  if (ranged && increment !== null && increment > 0 && apart !== null) {
    const steps = Math.max(0, Math.ceil(apart / increment) - 1);
    const most = held === "thrown" ? a.increments.thrown : a.increments.projectile;
    if (steps + 1 > most) notes.push(say("d20_out_of_range", { distance: farWords(s, who, apart, typeof grid === "number"), most: farWords(s, who, most * increment, typeof grid === "number") }));
    if (steps > 0) extras.push({ value: steps * a.incrementPenalty, words: say("d20_part_range", { value: signed(steps * a.incrementPenalty), distance: farWords(s, who, apart, typeof grid === "number"), increments: steps }) });
  }
  // A shot of a weapon that fires: what it needs of the weapon, what it adds, the rounds it spends, and what holds without its trait.
  const shotName = text(p.shots);
  const shot: ShotDef | undefined = shotName === "" ? undefined : own(a.shots, shotName);
  if (shotName !== "" && shot === undefined) notes.push(say("d20_no_shot", { said: shotName, shots: Object.keys(a.shots).join(", ") }));
  const lacks = shot?.trait !== undefined && !traitsTaken(s.ctx, who).some((t) => t.id === shot.trait);
  const untrained = lacks && shot?.without !== undefined;
  if (shot) {
    if (!wordsIn(w.row?.fire).includes(shot.needs)) notes.push(say("d20_shot_not_fired", { weapon: w.label, shot: shotName }));
    const trait = shot.trait === undefined ? "" : labelOfRow(own(rowsOf(s.ctx, rules, "traits"), shot.trait), shot.trait);
    if (lacks) notes.push(untrained ? say("d20_shot_without_trait", { shot: shotName, trait }) : say("d20_shot_needs_trait", { shot: shotName, trait }));
    const added = untrained ? shot.without?.attack : shot.attack;
    if (added !== undefined && added !== 0) extras.push({ value: added, words: say("d20_part_shot", { value: signed(added), shot: shotName }) });
  }
  const magazine = numberIn(w.row?.magazine ?? null);
  // The attacks: one, or every one a high base attack gives, each lower by the ruleset's step.
  const base = situated(() => totalOf(s.ctx, rules, who, a.totals.base, vars, bindings));
  const further = yes(p.full) && !w.natural && base >= a.iterative.from ? Math.floor((base - a.iterative.from) / a.iterative.step) + 1 : 0;
  const threat = situated(() => threatFrom(s.ctx, rules, who, w));
  const damageBonus = situated(() => totalOf(s.ctx, rules, who, a.totals.damage, vars, bindings)) + enh + toDamage.reduce((n, g) => n + Number(g.value), 0);
  if (unknown) notes.push(say("d20_no_distance"));
  return {
    target: target ?? "",
    w,
    ranged,
    situation,
    toAc,
    roll,
    extras,
    extra: extras.reduce((n, x) => n + x.value, 0),
    rollParts: [partsWords(roll), ...extras.map((x) => x.words)].filter((x) => x !== "").join(", "),
    nonlethal,
    notes,
    shot,
    shotDice: shot && !untrained ? (shot.dice ?? 0) : 0,
    magazine,
    spend: shot?.rounds ?? (magazine !== null ? 1 : 0),
    dice: damageDice(w, sizeOf(s.ctx, rules, who)),
    types: w.natural?.types ?? wordsIn(w.row?.types),
    threatFrom: threat,
    multiplier: w.natural?.multiplier ?? numberIn(w.row?.multiplier ?? null) ?? 1,
    strength: Math.floor((own(a.strengthShare, held) ?? 0) * modOf(s.ctx, rules, who, a.strength)),
    damageBonus,
    offsets: [0, ...Array.from({ length: further }, (_, i) => -(i + 1) * a.iterative.step)],
    touch: yes(p.touch),
    concealment: numberIn(p.concealment ?? null) ?? 0,
  };
}

/**
 * The defence an attack is read against as the target stands now: touch or not, flat-footed or not, with the GM's own modifiers to
 * it, the target's modifiers read with the attacker bound as their `target` and the distance between them.
 */
export function defenceOf(s: Scratch, plan: AttackPlan): { flat: boolean; ac: Explained; defence: number; unknownDistance: boolean } {
  const flat = flatFooted(s, plan.target);
  const sit = plan.situation;
  const vars: EnvVars = { vs: plan.ranged ? "ranged" : "melee", ...(sit !== null && sit.distance !== null ? { distance: sit.distance } : {}) };
  const read = (): Explained | null => explain(s.ctx, s.rules, plan.target, plan.touch ? "ac.touch" : flat ? "ac.flat" : "ac", vars, sit !== null ? { target: sit.who } : {});
  const r = sit !== null ? inSituation(s.ctx, sit, read) : { value: read(), unknownDistance: false };
  const ac = r.value ?? { total: 0, parts: [] };
  return { flat, ac, defence: ac.total + plan.toAc.reduce((m, g) => m + Number(g.value), 0), unknownDistance: r.unknownDistance };
}

/**
 * An attack (§5.1): its plan, the natural die's rule, a threat and its confirming roll, the damage with the multiplier on the dice and
 * on Strength's share and what modifies damage, the target's reduction and resistances, the rounds a shot spends, and then what the
 * hit points leave the target in. All the attacks a high base attack gives with `full`; an area shot makes everyone in it save.
 */
const attack: Procedure = (s, who, p, rng, ruled) => {
  const rules = s.rules;
  const a = rules.attack;
  const plan = attackPlan(s, who, p);
  if ("code" in plan) return plan;
  const { target, w, shot, notes, dice, types, nonlethal, strength, damageBonus, touch, concealment } = plan;
  const told: { words: string; shown: string }[] = [];
  if (w.item && plan.magazine !== null && plan.spend > 0) {
    const loaded = thingNumber(s.ctx, w.item, D20_FIELDS.loaded);
    if (loaded < plan.spend) notes.push(say("d20_magazine_short", { weapon: w.label, loaded, spend: plan.spend }));
    s.set(w.item, D20_FIELDS.loaded, Math.max(0, loaded - plan.spend));
    told.push(plain(say("d20_rounds_spent", { spent: Math.min(loaded, plan.spend), left: Math.max(0, loaded - plan.spend) })));
  }
  const rollDamage = (mult: number, r: Rng): { total: number; words: string } => {
    let rolled = 0;
    let notation = dice;
    try {
      for (let i = 0; i < mult; i++) rolled += rollDice(dice, r.fork(`dice:${i}`)).total;
      if (plan.shotDice > 0) {
        const g = parseDice(dice).groups[0];
        if (g) {
          const more = `${plan.shotDice * g.count}d${g.sides}`;
          rolled += rollDice(more, r.fork("shot")).total;
          notation = `${dice}+${more}`;
        }
      }
    } catch (e) {
      if (!(e instanceof DiceError)) throw e;
    }
    const total = Math.max(1, rolled + (strength + damageBonus) * mult);
    return { total, words: say("d20_damage", { dice: notation, rolled, ...(mult > 1 ? { times: mult } : {}), ...(strength !== 0 ? { strength: signed(strength * mult) } : {}), ...(damageBonus !== 0 ? { bonus: signed(damageBonus * mult) } : {}), total }) };
  };
  // An area shot: everyone in its square saves, and takes the damage on a failure; one that rolls first does so only if its roll hits.
  if (shot?.area !== undefined && shot.save !== undefined && shot.dc !== undefined) {
    if (shot.defence !== undefined) {
      let hits: boolean;
      if (ruled === "hit" || ruled === "miss" || ruled === "critical") {
        hits = ruled !== "miss";
        told.push(plain(say("d20_area_ruled", { outcome: say(`d20_outcome_${ruled}`) })));
      } else {
        const natural = d20(rng.fork("area-roll"));
        const spent = boostOf(s, who, "attack", p, rng.fork("boost"), notes);
        const bonus = plan.roll.total + plan.extra;
        const total = natural + bonus + (spent?.total ?? 0);
        hits = natural <= a.autoMiss ? false : natural >= a.autoHit ? true : total >= shot.defence;
        told.push(plain(say("d20_area_roll", { natural, bonus: signed(bonus), ...(plan.rollParts !== "" ? { parts: plan.rollParts } : {}), ...(spent ? { boost: spent.words } : {}), total, defence: shot.defence, outcome: say(`d20_outcome_${hits ? "hit" : "miss"}`) })));
      }
      if (!hits) {
        s.record(D20_EVENTS.attack, { who, target, with: w.label, ...toldOf(joined(told, "; ")), ...(notes.length > 0 ? { notes: notes.join("; ") } : {}) });
        return null;
      }
    }
    for (const one of around(s, target, shot.area / 2)) {
      if (one === who) continue;
      const sv = rollSave(s, one, shot.save, shot.dc, [], rng.fork(`area:${one}`));
      if (sv.outcome === "success") {
        told.push(plain(say("d20_area_saved", { who: s.name(one), save: sv.words })));
        continue;
      }
      const dmg = rollDamage(1, rng.fork(`area-damage:${one}`));
      const stop = stoppedBy(s, one, types, true);
      const amount = Math.max(0, dmg.total - stop.amount);
      const h = harmOne(s, one, amount, nonlethal, rng.fork(`area-harm:${one}`));
      const hit = (harm: string): string => say("d20_area_hit", { who: s.name(one), save: sv.words, damage: dmg.words, ...(stop.words !== "" ? { stopped: stop.words } : {}), harm });
      told.push({ words: hit(h.words), shown: hit(h.shown) });
    }
    s.record(D20_EVENTS.attack, { who, target, with: w.label, ...toldOf(joined(told, "; ")), ...(notes.length > 0 ? { notes: notes.join("; ") } : {}) });
    return null;
  }
  plan.offsets.forEach((offset, n) => {
    if (n > 0 && s.number(target, rules.hp.field) <= (hpOf(s, target).min ?? -Infinity)) return;
    const r = rng.fork(`attack:${n}`);
    const { flat, ac, defence, unknownDistance } = defenceOf(s, plan);
    if (unknownDistance && !notes.includes(say("d20_no_distance"))) notes.push(say("d20_no_distance"));
    const bonus = plan.roll.total + plan.extra + offset;
    let outcome: "hit" | "miss" | "critical";
    let natural: number | null = null;
    let words: string;
    if (ruled === "hit" || ruled === "miss" || ruled === "critical") {
      outcome = ruled;
      words = say("d20_attack_ruled", { outcome: say(`d20_outcome_${ruled}`) });
    } else {
      natural = d20(r.fork("roll"));
      // A point spent goes on the first attack's roll; the confirming roll is a roll of its own.
      const spent = n === 0 ? boostOf(s, who, "attack", p, rng.fork("boost"), notes) : null;
      const total = natural + bonus + (spent?.total ?? 0);
      const hits = natural <= a.autoMiss ? false : natural >= a.autoHit ? true : total >= defence;
      outcome = hits ? "hit" : "miss";
      let confirm = "";
      if (hits && natural >= plan.threatFrom) {
        if (!a.confirm) outcome = "critical";
        else {
          const second = d20(r.fork("confirm"));
          const confirmed = second <= a.autoMiss ? false : second >= a.autoHit ? true : second + bonus >= defence;
          if (confirmed) outcome = "critical";
          confirm = say("d20_confirm", { natural: second, total: second + bonus, outcome: say(`d20_outcome_${confirmed ? "critical" : "hit"}`) });
        }
      }
      if (outcome !== "miss" && concealment > 0) {
        const chance = rollDice(PERCENT, r.fork("concealment")).total;
        if (chance <= concealment) {
          outcome = "miss";
          confirm = [confirm, say("d20_concealed", { rolled: chance, chance: concealment })].filter((x) => x !== "").join(", ");
        }
      }
      words = say("d20_attack_roll", { natural, bonus: signed(bonus), ...(n === 0 && plan.rollParts !== "" ? { parts: plan.rollParts } : {}), ...(spent ? { boost: spent.words } : {}), ...(offset !== 0 ? { offset: signed(offset) } : {}), total, defence, ...(n === 0 ? { defence_parts: [partsWords(ac), ...plan.toAc.map((g) => modWords({ to: g.to, value: Number(g.value), type: g.type ?? null, source: "given", from: say("d20_given"), ...(g.note !== undefined ? { note: g.note } : {}), counted: true }))].filter((x) => x !== "").join(", ") } : {}), ...(flat ? { flat: true } : {}), ...(touch ? { touch: true } : {}), outcome: say(`d20_outcome_${outcome}`), ...(confirm !== "" ? { confirm } : {}) });
    }
    let line = plain(words);
    if (outcome !== "miss") {
      const dmg = rollDamage(outcome === "critical" ? plan.multiplier : 1, r.fork("damage"));
      const stop = stoppedBy(s, target, types, true);
      const amount = Math.max(0, dmg.total - stop.amount);
      const h = harmOne(s, target, amount, nonlethal, r.fork("harm"));
      line = joined([plain(words), plain(dmg.words), plain(stop.words), { words: h.words, shown: h.shown }], "; ");
    }
    told.push({ words: say("d20_attack_one", { n: n + 1, words: line.words }), shown: say("d20_attack_one", { n: n + 1, words: line.shown }) });
  });
  s.record(D20_EVENTS.attack, { who, target, with: w.label, ...toldOf(joined(told, " ")), ...(notes.length > 0 ? { notes: notes.join("; ") } : {}) });
  return null;
};

/** Harm to one, several, or everyone in an area, each with a save for half or none where one is given. */
const harm: Procedure = (s, who, p, rng) => {
  const rules = s.rules;
  let targets = ids(p.targets).filter((id) => own(s.ctx.state.entities, id) !== undefined);
  const centre = text(p.centre);
  const radius = numberIn(p.radius ?? null);
  if (centre !== "" && radius !== null) targets = [...new Set([...targets, ...around(s, centre, radius)])];
  if (targets.length === 0) targets = [who];
  const id = text(p.save) === "" ? null : saveNamed(rules, text(p.save));
  if (text(p.save) !== "" && id === null) return reject("d20_no_save", say("why_d20_no_save", { said: text(p.save), saves: Object.keys(rules.totals).filter((k) => k.startsWith("save.")).map((k) => saveLabel(rules, k.slice(5))).join(", ") }));
  const dc = difficultyOf(s.ctx, rules, p.difficulty);
  const rolled = amountRolled(p.amount, rng.fork("amount"));
  if (rolled === null) return reject("d20_no_amount", say("why_d20_no_amount", { said: text(p.amount) }));
  const type = text(p.type);
  for (const one of targets) {
    let amount = rolled.total;
    const parts: { words: string; shown: string }[] = [];
    if (id !== null && dc !== null) {
      const sv = rollSave(s, one, id, dc, [], rng.fork(`save:${one}`));
      parts.push(plain(sv.words));
      if (sv.outcome === "success") amount = yes(p.half) ? Math.floor(amount / 2) : 0;
    }
    const stop = type === "" ? { amount: 0, words: "" } : stoppedBy(s, one, [type], false);
    if (stop.words !== "") parts.push(plain(stop.words));
    amount = Math.max(0, amount - stop.amount);
    const h = harmOne(s, one, amount, yes(p.nonlethal), rng.fork(`harm:${one}`));
    parts.push({ words: h.words, shown: h.shown });
    s.record(D20_EVENTS.harm, { who: one, amount, ...(rolled.dice !== null ? { dice: rolled.dice, rolled: rolled.total } : {}), ...(type !== "" ? { type } : {}), ...(yes(p.nonlethal) ? { nonlethal: true } : {}), ...(one !== who ? { by: who } : {}), ...(text(p.why) !== "" ? { why: text(p.why) } : {}), ...toldOf(joined(parts, ", ")) });
  }
  return null;
};

/** Healing: hit points back up to the most, nonlethal harm off, temporary hit points, or the dying made stable. */
const heal: Procedure = (s, who, p, rng) => {
  const rules = s.rules;
  const rolled = text(p.amount) === "" ? { dice: null, total: 0 } : amountRolled(p.amount, rng.fork("amount"));
  if (rolled === null) return reject("d20_no_amount", say("why_d20_no_amount", { said: text(p.amount) }));
  const parts: { words: string; shown: string }[] = [];
  if (yes(p.temporary)) {
    const before = s.number(who, rules.hp.temporary);
    const to = Math.max(before, rolled.total);
    s.set(who, rules.hp.temporary, to);
    parts.push(plain(say("d20_heal_temporary", { from: before, to })));
  } else if (yes(p.nonlethal)) {
    const before = s.number(who, rules.hp.nonlethal);
    const to = Math.max(0, before - rolled.total);
    s.set(who, rules.hp.nonlethal, to);
    parts.push(plain(say("d20_heal_nonlethal", { from: before, to })));
  } else if (rolled.total > 0) {
    const hp = hpOf(s, who);
    const to = Math.min(hp.max ?? Infinity, hp.now + rolled.total);
    s.set(who, rules.hp.field, to);
    parts.push(s.hpWords(who, "d20_heal_hp", hp.now, to));
  }
  if (yes(p.stabilize) && rules.hp.dying) {
    const list = conditionsHeld(s.ctx, who);
    if (!list.some((c) => c.id === rules.hp.dying?.stable)) {
      const raw = own(s.ctx.state.entities, who)?.fields[D20_FIELDS.conditions];
      s.set(who, D20_FIELDS.conditions, [...(Array.isArray(raw) ? raw : []), { id: rules.hp.dying.stable }] as JsonValue);
      parts.push(plain(say("d20_stabilized")));
    }
  }
  settle(s, who);
  const said = joined(parts, ", ");
  s.record(D20_EVENTS.heal, { who, ...(rolled.dice !== null ? { dice: rolled.dice, rolled: rolled.total } : {}), ...toldOf(said.words !== "" ? said : plain(say("d20_nothing_changed"))), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
  return null;
};

/** How long something lasts, as given: a clock minute it ends at, a number of turns, and a save that ends it. */
function lengthOf(s: Scratch, p: Readonly<Record<string, JsonValue>>): { until?: number; rounds?: number; save?: { save: string; dc: number } } {
  const minutes = (numberIn(p.minutes ?? null) ?? 0) + 60 * (numberIn(p.hours ?? null) ?? 0);
  const rounds = numberIn(p.rounds ?? null);
  const id = text(p.save) === "" ? null : saveNamed(s.rules, text(p.save));
  const dc = difficultyOf(s.ctx, s.rules, p.difficulty);
  return { ...(minutes > 0 ? { until: s.ctx.state.clock + Math.round(minutes) } : {}), ...(rounds !== null && rounds > 0 ? { rounds: Math.round(rounds) } : {}), ...(id !== null && dc !== null ? { save: { save: id, dc } } : {}) };
}

/** A length in words, its save as the rules label it. */
function lengthWords(s: Scratch, l: { until?: number; rounds?: number; save?: { save: string; dc: number } }): string {
  return say("d20_length", { ...(l.rounds !== undefined ? { rounds: l.rounds } : {}), ...(l.until !== undefined ? { minutes: l.until - s.ctx.state.clock } : {}), ...(l.save !== undefined ? { save: saveLabel(s.rules, l.save.save), dc: l.save.dc } : {}) });
}

/** A condition of the ruleset put on, for how long, or taken off. */
const condition: Procedure = (s, who, p) => {
  const rules = s.rules;
  const hit = rowOf(s.ctx, rules, "conditions", text(p.condition));
  if (!hit) return reject("d20_no_condition", say("why_d20_no_condition", { said: text(p.condition), conditions: Object.keys(rowsOf(s.ctx, rules, "conditions")).join(", ") }));
  const raw = own(s.ctx.state.entities, who)?.fields[D20_FIELDS.conditions];
  const list = Array.isArray(raw) ? raw.filter((c): c is JsonObject => isRecord(c)) : [];
  const label = labelOfRow(hit.row, hit.id);
  const rest = list.filter((c) => c.id !== hit.id);
  if (yes(p.off)) {
    s.set(who, D20_FIELDS.conditions, rest as JsonValue);
    s.record(D20_EVENTS.condition, { who, told: say("d20_condition_off", { condition: label }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
    return null;
  }
  const l = lengthOf(s, p);
  s.set(who, D20_FIELDS.conditions, [...rest, { id: hit.id, ...l, ...(text(p.why) !== "" ? { why: text(p.why) } : {}) }] as unknown as JsonValue);
  const mods = modifiersIn(hit.row.modifiers).map((m) => say("d20_mod_to", { value: typeof m.value === "number" ? signed(m.value) : m.value, type: m.type ?? "", to: m.to }));
  s.record(D20_EVENTS.condition, { who, told: say("d20_condition_on", { condition: label, ...(mods.length > 0 ? { mods: mods.join(", ") } : {}), ...(textIn(hit.row.text) !== "" ? { text: textIn(hit.row.text) } : {}), length: lengthWords(s, l) }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
  return null;
};

/** A passing effect with its own modifiers put on, or taken off by its label. */
const effect: Procedure = (s, who, p) => {
  const label = text(p.label);
  if (label === "") return reject("d20_no_label", say("why_d20_no_label"));
  const raw = own(s.ctx.state.entities, who)?.fields[D20_FIELDS.effects];
  const list = Array.isArray(raw) ? raw.filter((e): e is JsonObject => isRecord(e)) : [];
  const rest = list.filter((e) => text(e.label).toLowerCase() !== label.toLowerCase());
  if (yes(p.off)) {
    s.set(who, D20_FIELDS.effects, rest as JsonValue);
    s.record(D20_EVENTS.effect, { who, told: say("d20_effect_off", { label }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
    return null;
  }
  const mods = givenMods(p.mods, "");
  const bad = mods.filter((m) => m.to === "");
  if (mods.length === 0 || bad.length > 0) return reject("d20_effect_mods", say("why_d20_effect_mods"));
  const l = lengthOf(s, p);
  const held: EffectHeld = { label, modifiers: mods, ...l, ...(text(p.why) !== "" ? { why: text(p.why) } : {}) };
  s.set(who, D20_FIELDS.effects, [...rest, held] as unknown as JsonValue);
  s.record(D20_EVENTS.effect, { who, told: say("d20_effect_on", { label, mods: mods.map((m) => say("d20_mod_to", { value: signed(Number(m.value)), type: m.type ?? "", to: m.to })).join(", "), length: lengthWords(s, l) }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
  return null;
};

/** A night's rest: hit points back by the ruleset's formula, nonlethal harm off by the hour, and each daily gauge full again. */
const rest: Procedure = (s, who, p) => {
  const rules = s.rules;
  const hours = numberIn(p.hours ?? null) ?? rules.hp.rest.hours;
  for (const one of andAlso(who, p.also, s.ctx)) {
    const parts: string[] = [];
    const hp = hpOf(s, one);
    const back = hours >= rules.hp.rest.hours ? s.eval(rules.hp.rest.hp, one) : 0;
    if (back > 0 && hp.now < (hp.max ?? Infinity)) {
      const to = Math.min(hp.max ?? Infinity, hp.now + back);
      s.set(one, rules.hp.field, to);
      parts.push(say("d20_heal_hp", { from: hp.now, to }));
    }
    const nl = s.number(one, rules.hp.nonlethal);
    if (nl > 0) {
      const to = Math.max(0, nl - Math.floor(hours) * s.eval(rules.hp.rest.nonlethal, one));
      s.set(one, rules.hp.nonlethal, to);
      parts.push(say("d20_heal_nonlethal", { from: nl, to }));
    }
    if (hours >= rules.hp.rest.hours) {
      for (const field of rules.hp.rest.daily) {
        const e = own(s.ctx.state.entities, one);
        const def = e ? fieldDef(s.ctx.registry, s.ctx.world, e.kind, field) : undefined;
        const top = def?.pool ? poolMax(s.ctx.registry, s.ctx, one, def.pool) : null;
        if (top === null) continue;
        const now = s.number(one, field);
        if (now < top) {
          s.set(one, field, top);
          parts.push(say("d20_gauge_full", { gauge: def?.label ?? field, from: now, to: top }));
        }
      }
    }
    settle(s, one);
    s.record(D20_EVENTS.rest, { who: one, hours, told: parts.join(", ") || say("d20_nothing_changed") });
  }
  return null;
};

/** The round a weapon takes, as the gear catalog names it (its row's `ammo`): its id and its name; null where its row names none. */
function ammoOf(s: Scratch, item: EntityId): { id: string; name: string } | null {
  const rows = own(s.ctx.world.tables, "gear.items")?.rows ?? {};
  const ammo = own(rows, rowIdOf(s.ctx, item))?.ammo;
  return typeof ammo === "string" && ammo !== "" ? { id: ammo, name: labelOfRow(own(rows, ammo), ammo) } : null;
}

/** The weapon a reload fills: the one named, else the first carried that has a magazine; null where there is none. */
function reloaded(s: Scratch, who: EntityId, said: string): Weapon | null {
  if (said === "") return armedWith(s, who).weapons.find((x) => x.item !== null && numberIn(x.row?.magazine ?? null) !== null) ?? null;
  const w = weaponOf(s, who, said);
  return "code" in w ? null : w;
}

/** Which of the layer's rolls a name is for `who` where the rules are on: a skill's or an ability's check, or a save; null for neither. */
export function rollOfName(ctx: ReadContext, who: EntityId, said: string): "check" | "save" | null {
  const rules = rulesOf(ctx.world);
  if (rules === null || !isOn(ctx) || said.trim() === "") return null;
  if (rowOf(ctx, rules, "skills", said) || abilityNamed(ctx, rules, who, said) !== null) return "check";
  return saveNamed(rules, said) !== null ? "save" : null;
}

/**
 * A weapon's magazine filled from the rounds carried, as many as it holds and as there are: the weapon named, else the first it carries
 * that has a magazine. The rounds are the things of the catalog's round for it (by their type, or the row they are said to be); what
 * was looked for is said by name where none or too few were carried.
 */
const reload: Procedure = (s, who, p) => {
  const said = text(p.item);
  const w = reloaded(s, who, said);
  const magazine = w ? numberIn(w.row?.magazine ?? null) : null;
  if (!w || !w.item || magazine === null) return reject("d20_no_magazine", say("why_d20_no_magazine", { who: s.name(who), said }));
  const loaded = thingNumber(s.ctx, w.item, D20_FIELDS.loaded);
  const want = Math.max(0, magazine - loaded);
  const ammo = ammoOf(s, w.item);
  let moved = 0;
  if (ammo !== null) {
    const stacks = carriedBy(s, who).filter((id) => id !== w.item && rowIdOf(s.ctx, id) === ammo.id);
    for (const id of stacks) {
      if (moved >= want) break;
      const qty = numberIn(own(s.ctx.state.entities, id)?.fields.qty ?? null) ?? 1;
      const take = Math.min(qty, want - moved);
      if (take <= 0) continue;
      s.set(id, "qty", qty - take);
      moved += take;
    }
  }
  s.set(w.item, D20_FIELDS.loaded, loaded + moved);
  s.record(D20_EVENTS.reload, { who, item: w.item, told: say("d20_reloaded", { from: loaded, to: loaded + moved, magazine, ...(moved < want ? { short: want - moved, ...(ammo !== null ? { ammo: `${ammo.name} [${ammo.id}]` } : { no_ammo: true }) } : {}) }) });
  return null;
};

/**
 * The keys an action's cost in a fight's budgets is read by (`ruleset.d20.costs`), the first a ruleset gives counting: all the attacks
 * a high base attack gives (`attack.full`); a reload by its weapon's magazine kind (`reload.<kind>`), then the plain one; else the id.
 */
export function costKeys(ctx: ReadContext, action: string, who: EntityId, params: Readonly<Record<string, JsonValue>>): string[] {
  if (action === "attack" && yes(params.full)) return ["attack.full"];
  const rules = rulesOf(ctx.world);
  if (action === "reload" && rules !== null && own(ctx.state.entities, who)) {
    const kind = textIn(reloaded(new Scratch({ ...ctx, rng: createRng("d20.cost"), params: {} }, rules), who, text(params.item))?.row?.magazine_kind);
    if (kind !== "") return [`reload.${kind}`, action];
  }
  return [action];
}

/** The level an amount of experience reaches by the experience table, read in the column its progression's thresholds name (`xp` without one). */
function levelForXp(s: Scratch, xp: number): number {
  const thresholds = own(s.ctx.world.ruleset?.progression ?? {}, s.rules.levels.progression)?.thresholds;
  const column = thresholds !== undefined && !Array.isArray(thresholds) ? thresholds.column : "xp";
  let level = 0;
  for (const [key, row] of Object.entries(rowsOf(s.ctx, s.rules, "experience"))) {
    const need = numberIn(row[column] ?? null);
    const at = Number(key);
    if (need !== null && Number.isFinite(at) && xp >= need && at > level) level = at;
  }
  return level;
}

/** Experience given, or worked out from who was overcome, to the doer and everyone else named; who has reached a level is said. */
const award: Procedure = (s, who, p) => {
  const rules = s.rules;
  const prog = own(s.ctx.world.ruleset?.progression ?? {}, rules.levels.progression);
  const field = prog?.xpField ?? "xp";
  const all = andAlso(who, p.also, s.ctx);
  const given = numberIn(p.xp ?? null);
  const each = new Map<EntityId, number>();
  if (given !== null) for (const one of all) each.set(one, given);
  else {
    const overcome = ids(p.overcame);
    if (overcome.length === 0) return reject("d20_no_xp", say("why_d20_no_xp"));
    const challenges = rowsOf(s.ctx, rules, "challenges");
    for (const foe of overcome) {
      const cr = text(own(s.ctx.state.entities, foe)?.fields.cr ?? null);
      const row = cr === "" ? undefined : own(challenges, cr);
      if (!row) continue;
      for (const one of all) {
        const byLevel = isRecord(row.by_level) ? numberIn(row.by_level[String(levelsOf(s.ctx, one))] ?? null) : null;
        // A challenge's worth by a level is the whole of those who overcame it, shared among them, as its worth without one is.
        const share = Math.floor((byLevel ?? numberIn(row.xp) ?? 0) / all.length);
        each.set(one, (each.get(one) ?? 0) + share);
      }
    }
  }
  for (const one of all) {
    const xp = each.get(one) ?? 0;
    const before = s.number(one, field);
    s.set(one, field, before + xp);
    const reached = levelForXp(s, before + xp);
    const has = levelsOf(s.ctx, one);
    s.record(D20_EVENTS.award, { who: one, xp, told: say("d20_awarded", { from: before, to: before + xp, ...(reached > has ? { open: reached - has, level: reached } : {}) }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
  }
  return null;
};

/** A level taken in a class: its hit points by the ruleset's way, and what the level gives by the tables, told as open. */
const advance: Procedure = (s, who, p, rng) => {
  const rules = s.rules;
  const hit = rowOf(s.ctx, rules, "classes", text(p.class));
  if (!hit) return reject("d20_no_class", say("why_d20_no_class", { said: text(p.class), classes: Object.keys(rowsOf(s.ctx, rules, "classes")).join(", ") }));
  const classes = classesOf(s.ctx, who);
  const level = (own(classes, hit.id) ?? 0) + 1;
  const total = levelsOf(s.ctx, who) + 1;
  const die = numberIn(hit.row.hit_die) ?? 0;
  const said = text(p.hp);
  // The first hit die is the one taken while none is kept: a creature with hit dice of its own took its first before any class.
  const before = numberIn(own(s.ctx.state.entities, who)?.fields[D20_FIELDS.hitDice] ?? null) ?? 0;
  const first = before === 0;
  // The feats the level gives: the levels `featAt` lists (one each time it names this one), how many its formula gives, or the first and each `featEvery`.
  const featAt = rules.levels.featAt;
  const counted = Array.isArray(featAt) ? featAt.filter((l) => l === total).length : featAt !== undefined ? evalExpr(featAt, scopeEnv({ reg: s.ctx.registry, ctx: s.ctx, bindings: { self: who }, vars: { level: total } }), 0) : null;
  const feats = counted === null ? (first || (rules.levels.featEvery > 0 && total % rules.levels.featEvery === 0) ? 1 : 0) : counted === true ? 1 : typeof counted === "number" ? Math.max(0, Math.floor(counted)) : 0;
  const way = said === "" ? (first && rules.levels.firstMost ? "most" : rules.levels.hitPoints) : said;
  let kept: number;
  if (numberIn(said) !== null) kept = numberIn(said) ?? 0;
  else if (way === "most") kept = die;
  else if (way === "average") kept = s.eval(rules.levels.average, who, { die });
  else kept = die > 0 ? rollDice(`1d${die}`, rng.fork("hp")).total : 0;
  // The gauge's most grows with the level, and what it holds by as much: a level taken leaves no one more hurt than before it.
  const was = hpOf(s, who);
  const stored = own(own(s.ctx.state.entities, who)?.fields ?? {}, rules.hp.field) !== undefined;
  s.set(who, D20_FIELDS.classes, { ...classes, [hit.id]: level });
  s.set(who, D20_FIELDS.hitDice, before + kept);
  const now = hpOf(s, who);
  if (stored && now.max !== undefined && was.max !== undefined && now.max > was.max) s.set(who, rules.hp.field, was.now + (now.max - was.max));
  const points = Math.max(rules.levels.skillPoints.min, (numberIn(hit.row.skill_points) ?? 0) + s.eval(rules.levels.skillPoints.plus, who)) * (first ? rules.levels.skillPoints.first : 1);
  const features = isRecord(hit.row.features) ? wordsIn(hit.row.features[String(level)]) : [];
  const traits = rowsOf(s.ctx, rules, "traits");
  s.record(D20_EVENTS.advance, {
    who,
    class: labelOfRow(hit.row, hit.id),
    told: say("d20_advanced", {
      level,
      total,
      kept,
      die,
      way,
      points,
      ...(feats > 0 ? { feats } : {}),
      ...(rules.levels.abilityEvery > 0 && total % rules.levels.abilityEvery === 0 ? { ability: true } : {}),
      ...(features.length > 0 ? { features: features.map((f) => labelOfRow(own(traits, f), f)).join(", ") } : {}),
    }),
  });
  return null;
};

/** A trait given or taken away; what it requires is said where it does not hold. */
const trait: Procedure = (s, who, p) => {
  const rules = s.rules;
  const hit = rowOf(s.ctx, rules, "traits", text(p.trait));
  if (!hit) return reject("d20_no_trait", say("why_d20_no_trait", { said: text(p.trait) }));
  const raw = own(s.ctx.state.entities, who)?.fields[D20_FIELDS.traits];
  const list: TraitHeld[] = Array.isArray(raw) ? (raw.filter((t) => typeof t === "string" || isRecord(t)) as unknown as TraitHeld[]) : [];
  const choice = text(p.choice);
  const same = (t: TraitHeld): boolean => (typeof t === "string" ? t === hit.id && choice === "" : t.id === hit.id && (t.choice ?? "") === choice);
  const label = choice !== "" ? `${labelOfRow(hit.row, hit.id)} (${choice})` : labelOfRow(hit.row, hit.id);
  if (yes(p.off)) {
    s.set(who, D20_FIELDS.traits, list.filter((t) => !same(t)) as unknown as JsonValue);
    s.record(D20_EVENTS.trait, { who, told: say("d20_trait_off", { trait: label }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
    return null;
  }
  const requires = textIn(hit.row.requires);
  const unmet = requires !== "" && !s.holds(requires, who, { choice });
  const entry: TraitHeld = choice === "" && text(p.why) === "" ? hit.id : { id: hit.id, ...(choice !== "" ? { choice } : {}), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) };
  if (!list.some(same)) s.set(who, D20_FIELDS.traits, [...list, entry] as unknown as JsonValue);
  s.record(D20_EVENTS.trait, { who, told: say("d20_trait_on", { trait: label, ...(textIn(hit.row.text) !== "" ? { text: textIn(hit.row.text) } : {}), ...(unmet ? { unmet: requires } : {}) }), ...(text(p.why) !== "" ? { why: text(p.why) } : {}) });
  return null;
};

/** Ranks set in a skill; the most it takes and the points left are said. */
const ranks: Procedure = (s, who, p) => {
  const rules = s.rules;
  const hit = rowOf(s.ctx, rules, "skills", text(p.skill));
  if (!hit) return reject("d20_no_skill", say("why_d20_no_skill", { said: text(p.skill), skills: Object.keys(rowsOf(s.ctx, rules, "skills")).join(", "), abilities: "" }));
  const n = numberIn(p.ranks ?? null) ?? 0;
  const all = ranksOf(s.ctx, who);
  const from = own(all, hit.id) ?? 0;
  const next = { ...all, [hit.id]: n };
  if (n === 0) delete next[hit.id];
  s.set(who, D20_FIELDS.ranks, next);
  const most = s.eval(rules.levels.rankLimit, who, { skill: hit.id, key: hit.id });
  // Points: each level's by its class (the first level's times the ruleset's), less every rank held.
  const classes = rowsOf(s.ctx, rules, "classes");
  let points = 0;
  let first = true;
  for (const [cls, level] of Object.entries(classesOf(s.ctx, who))) {
    const per = Math.max(rules.levels.skillPoints.min, (numberIn(own(classes, cls)?.skill_points ?? null) ?? 0) + s.eval(rules.levels.skillPoints.plus, who));
    points += per * level + (first ? per * (rules.levels.skillPoints.first - 1) : 0);
    first = false;
  }
  const spent = Object.values(next).reduce((m, r) => m + r, 0);
  s.record(D20_EVENTS.ranks, { who, told: say("d20_ranks", { skill: labelOfRow(hit.row, hit.id), from, to: n, most, ...(n > most ? { over: true } : {}), left: points - spent, ...(isClassSkill(s.ctx, rules, who, hit.id) ? { class_skill: true } : {}) }) });
  return null;
};

/** The sheet and attacks of one of the ruleset's creatures, given to someone. */
const statAs: Procedure = (s, who, p) => {
  const rules = s.rules;
  const hit = rowOf(s.ctx, rules, "creatures", text(p.creature));
  if (!hit) return reject("d20_no_creature", say("why_d20_no_creature", { said: text(p.creature) }));
  const fields = isRecord(hit.row.fields) ? hit.row.fields : {};
  for (const [k, v] of Object.entries(fields)) s.set(who, k, v);
  if (Array.isArray(hit.row.attacks)) s.set(who, D20_FIELDS.attacks, hit.row.attacks);
  if (typeof hit.row.cr === "string" || typeof hit.row.cr === "number") s.set(who, "cr", String(hit.row.cr));
  settle(s, who);
  s.record(D20_EVENTS.statAs, { who, creature: labelOfRow(hit.row, hit.id), told: say("d20_stat_as", { fields: Object.keys(fields).length, attacks: Array.isArray(hit.row.attacks) ? hit.row.attacks.length : 0 }) });
  return null;
};

const PROCEDURES: Readonly<Record<string, Procedure>> = { check, save, attack, harm, heal, condition, effect, d20_rest: rest, reload, award, advance, trait, ranks, stat_as: statAs };

/** Runs a procedure: the rules read, the chat's switch held to, its changes and record given back, or why it could not be worked out. */
function run(id: string, args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const rules = rulesOf(ctx.world);
  if (rules === null) return reject("d20_no_rules", say("why_d20_no_rules"));
  if (!isOn(ctx)) return reject("d20_off", say("why_d20_off"));
  const who = text(args.who);
  if (!own(ctx.state.entities, who)) return reject("missing_entity", say("why_no_entity_who", { who }));
  const proc = own(PROCEDURES, id);
  if (!proc) return reject("d20_no_rules", say("why_d20_no_rules"));
  const s = new Scratch(ctx, rules);
  const ruled = text(args.ruled) === "" ? undefined : text(args.ruled);
  const refused = proc(s, who, paramsOf(ctx), ctx.rng, ruled);
  return refused ?? s.events;
}

/** The effect of each action, by its id. */
export const D20_PROCEDURES: readonly EffectDef[] = D20_ACTIONS.map((id) => ({
  type: `d20.${id === "d20_rest" ? "rest" : id}`,
  args: ["who", "ruled?"],
  resolve: (args, ctx) => run(id, args, ctx),
}));

/**
 * What a creature's turn in a fight brings of itself, as the ruleset says (§4.5): a dying creature that is not stable makes the
 * ruleset's stabilising roll, and passing it is stable, else loses the ruleset's points; each condition and effect counted in turns
 * loses one and ends at none; each that lasts until a save has the save tried. Arithmetic the turn triggers, never a decision; said
 * as one record. None in a world without the rules on, or for one who has nothing of it.
 */
export function upkeep(base: ReadContext, who: EntityId, rng: Rng): LedgerEvent[] {
  const rules = rulesOf(base.world);
  if (rules === null || !isOn(base) || !own(base.state.entities, who)) return [];
  const s = new Scratch({ ...base, rng, params: {} }, rules);
  const told: { words: string; shown: string }[] = [];
  const dying = rules.hp.dying;
  const held = conditionsHeld(s.ctx, who);
  if (dying && held.some((c) => c.id === dying.state) && !held.some((c) => c.id === dying.stable)) {
    const ready = readyCheck(s.ctx.registry, s.ctx, dying.roll, { self: who, actor: who });
    if (!("code" in ready)) {
      const rolled = rollCheck(ready, rng.fork("stabilize"));
      if (passOutcomes(dying.roll, ready.bands).includes(rolled.outcome)) {
        const raw = own(s.ctx.state.entities, who)?.fields[D20_FIELDS.conditions];
        s.set(who, D20_FIELDS.conditions, [...(Array.isArray(raw) ? raw : []), { id: dying.stable }] as JsonValue);
        told.push(plain(say("d20_upkeep_stable", { total: rolled.total })));
      } else {
        const hp = hpOf(s, who);
        const to = hp.min !== undefined ? Math.max(hp.min, hp.now - dying.lose) : hp.now - dying.lose;
        s.set(who, rules.hp.field, to);
        const left = s.hpWords(who, "d20_harm_hp", hp.now, to);
        const lost = (hpWords: string): string => say("d20_upkeep_lost", { total: rolled.total, lost: hp.now - to, hp: hpWords });
        told.push({ words: lost(left.words), shown: lost(left.shown) });
      }
    }
  }
  for (const field of [D20_FIELDS.conditions, D20_FIELDS.effects]) {
    const raw = own(s.ctx.state.entities, who)?.fields[field];
    if (!Array.isArray(raw)) continue;
    let changed = false;
    const next: JsonValue[] = [];
    for (const item of raw) {
      if (!isRecord(item)) {
        next.push(item);
        continue;
      }
      const name = typeof item.label === "string" && field === D20_FIELDS.effects ? item.label : labelOfRow(own(rowsOf(s.ctx, rules, "conditions"), text(item.id)), text(item.id));
      const save = isRecord(item.save) && typeof item.save.save === "string" && typeof item.save.dc === "number" ? { save: item.save.save, dc: item.save.dc } : null;
      if (save !== null) {
        const r = rollSave(s, who, save.save, save.dc, [], rng.fork(`ends:${name}`));
        if (r.outcome === "success") {
          changed = true;
          told.push(plain(say("d20_upkeep_saved", { name, save: r.words })));
          continue;
        }
      }
      if (typeof item.rounds === "number") {
        changed = true;
        if (item.rounds <= 1) {
          told.push(plain(say("d20_upkeep_ended", { name })));
          continue;
        }
        next.push({ ...item, rounds: item.rounds - 1 });
        continue;
      }
      next.push(item);
    }
    if (changed) s.set(who, field, next);
  }
  settle(s, who);
  if (told.length > 0) s.record(D20_EVENTS.upkeep, { who, ...toldOf(joined(told, "; ")) });
  return s.events;
}
