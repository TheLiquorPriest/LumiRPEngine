// A fight's turns (DESIGN §11): the spend a combat action makes, the next turn and the refills it
// brings, who goes down or gets back up, when it's over, and everyone else's turns around the POV's.
// All of it is applied through the plan's working state, so it lands as events in the same turn:
// swipes, Keep and Re-run treat a round like any other turn. Each act, fall and end is one event group
// with the rule events it fires, so a rebased view keeps or drops it whole.
//
// A fight is fought where it started: the POV leaving that place ends it (`left`), and rounds in a
// row in which no one attacks and no one's HP changes end it as a stalemate (the rules' `stalemate`,
// 3 by default; 0 never), so no fight goes on unseen or stalls.
//
// Everyone but the POV fights by deterministic tactics: defend when hurt (the ruleset's `lowHp`) and
// a foe acted against it this round or the last, if a defensive action is offered, else attack the
// most threatening foe it can reach (`threat`), with the action most likely to land. An `npc.choose`
// decision recorded for its turn wins while it is still a legal choice. Every roll forks the plan's
// generator by round and participant.

import type { JsonObject } from "../../../shared/json";
import { hashParts } from "../../../shared/hash";
import { isRecord } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import type { ActionDef, CombatDef, EffectSpec, WorldDoc } from "../../../shared/world";
import { ALIVE, isLifeState, offersAction } from "../../../shared/world";
import { applyEffects } from "../../../engine/effects";
import { lifeOf } from "../../../engine/life";
import { labelOf, own } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { actionOdds, findAction, resolveAction, type Availability, type Resolution } from "../../../engine/resolve";
import type { Rng } from "../../../engine/rng";
import { runRulesOnEvents } from "../../../engine/rules";
import { bandOf, fieldDef, placeOfEntity, truthy } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity, canSeeField } from "../../../engine/visibility";
import type { Working } from "../../../engine/working";
import { budgetCount, canFight, costOf, decisionsOf, DEFAULT_WOUNDS, DOWN_CONDITION, downHolds, encounterOf, endHolds, fighterOf, fits, hpMaxOf, hpOf, offTurnCost, povLeft, readFor, rulesOf, stalemateRounds, stalledHolds, standing, winnerOf, writeEncounter, type Encounter, type Fighter } from "./model";

/** How many actions anyone but the POV takes in one turn, at most. */
const ACTS_PER_TURN = 4;

/** The combat actions a world offers, by id: its own over the packs', in id order. */
export function combatActions(reg: Registry, world: WorldDoc): ActionDef[] {
  const out = new Map<string, ActionDef>();
  for (const [id, a] of reg.actions) if (a.combat) out.set(id, a);
  for (const [id, a] of Object.entries(world.actions)) if (a.combat) out.set(id, a);
  return [...out.values()].filter((a) => offersAction(world, a)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The one required entity parameter an action fills with a participant, or null; undefined when it needs more than one. */
export function targetParam(action: ActionDef): string | null | undefined {
  const refs = Object.entries(action.params).filter(([, p]) => p.type === "ref" && !p.optional);
  return refs.length === 0 ? null : refs.length === 1 ? (refs[0]?.[0] ?? null) : undefined;
}

function targetOf(action: ActionDef, params: JsonObject): EntityId | null {
  const param = targetParam(action);
  const v = param ? params[param] : undefined;
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * What a combat action costs its actor now, as events, or why it can't be taken (DESIGN §11, the
 * `combat.spend` service). A starting action needs no fight under way, a fight the POV has left
 * counting as none (the turn ends it before its action runs); any other needs one, the actor in it
 * and standing, its turn (unless it spends only off-turn budgets) and enough left. Nothing for
 * other actions.
 */
export function spendFor(ctx: ReadContext, actor: EntityId, action: Pick<ActionDef, "combat">): LedgerEvent[] | Rejection {
  if (!action.combat) return [];
  const rules = rulesOf(ctx.world);
  if (!rules) return { code: "no_combat", reason: "this world has no combat" };
  const enc = encounterOf(ctx.state);
  if (action.combat.start === true) return enc && !povLeft(ctx.state, ctx.world, enc) ? { code: "in_fight", reason: "a fight is already under way" } : [];
  if (!enc) return { code: "no_fight", reason: "no fight is under way" };
  const you = actor === ctx.world.pov;
  const f = fighterOf(enc, actor);
  if (!f) return { code: "not_fighting", reason: you ? "you aren't in this fight" : `${labelOf(ctx, actor)} isn't in this fight` };
  if (!standing(ctx, enc, f)) return { code: "down", reason: you ? "you are out of the fight" : `${labelOf(ctx, actor)} is out of the fight` };
  const cost = costOf(action);
  if (enc.order[enc.turn]?.id !== actor && !offTurnCost(rules, cost)) return { code: "not_your_turn", reason: you ? "it isn't your turn" : `it isn't ${labelOf(ctx, actor)}'s turn` };
  const short = Object.entries(cost).filter(([budget, n]) => (f.left[budget] ?? 0) < n).map(([budget]) => own(rules.economy, budget)?.label ?? budget);
  if (short.length > 0) return { code: "spent", reason: `no ${short.join(" or ")} left` };
  return Object.keys(cost).length > 0 ? [{ type: "combat.spend", data: { encounter: enc.id, who: actor, cost } }] : [];
}

/** A participant's per-turn budgets at their counts: what the start of its turn refills. */
export function turnRefill(ctx: ReadContext, rules: CombatDef, id: EntityId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [budget, def] of Object.entries(rules.economy)) if (isRecord(def) && def.per !== "round") out[budget] = budgetCount(ctx, def, id);
  return out;
}

/**
 * The turn after the current one (`combat.turn`): the next standing participant in initiative
 * order, past the end a new round. A new round refills everyone's per-round budgets; the turn
 * refills its participant's per-turn ones. Null when no one stands.
 */
export function nextTurn(ctx: ReadContext, rules: CombatDef, enc: Encounter): LedgerEvent | null {
  const n = enc.order.length;
  for (let k = 1; k <= n; k++) {
    const index = (enc.turn + k) % n;
    const f = enc.order[index];
    if (!f || !standing(ctx, enc, f)) continue;
    const round = enc.round + Math.floor((enc.turn + k) / n);
    const reset: Record<string, Record<string, number>> = {};
    if (round > enc.round) {
      for (const p of enc.order) {
        for (const [budget, def] of Object.entries(rules.economy)) if (isRecord(def) && def.per === "round") (reset[p.id] ??= {})[budget] = budgetCount(ctx, def, p.id);
      }
    }
    reset[f.id] = { ...reset[f.id], ...turnRefill(ctx, rules, f.id) };
    return { type: "combat.turn", data: { encounter: enc.id, round, turn: index, actor: f.id, reset } };
  }
  return null;
}

// ---------------------------------------------------------------- what the POV sees

/** A participant as the POV refers to them: "you", their name, or "someone" when it can't see them. */
function nameFor(ctx: ReadContext, id: EntityId): string {
  if (id === ctx.world.pov) return "you";
  return canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id) ? labelOf(ctx, id) : "someone";
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The wound band `current` HP of `max` reads as, by the rules' bands or the default ones. */
function woundOf(rules: CombatDef, current: number, max: number | null): string {
  const percent = max !== null && max > 0 ? Math.round((Math.max(0, current) / max) * 100) : current > 0 ? 100 : 0;
  const bands = Array.isArray(rules.wounds) && rules.wounds.length > 0 ? rules.wounds : DEFAULT_WOUNDS;
  return bandOf(bands, percent)?.label ?? "";
}

/**
 * HP as the POV sees it (DESIGN §11): its own exactly; anyone else's exactly when the rules show
 * numbers and the HP field is visible, else as a wound band; nothing for someone it can't see.
 * The GM sees everyone's exactly.
 */
export function hpSeen(ctx: ReadContext, rules: CombatDef, id: EntityId, gm = false): { current: number; max: number | null } | { wound: string } | null {
  const current = hpOf(ctx, rules, id);
  const max = hpMaxOf(ctx, rules, id);
  if (gm || id === ctx.world.pov) return { current, max };
  if (!canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id)) return null;
  if (rules.showHp === "exact" && canSeeField(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id, rules.hp)) return { current, max };
  return { wound: woundOf(rules, current, max) };
}

/**
 * A player's line (a chip, the Journal) for a change to someone else's HP that the POV sees as a
 * wound band: the band a `set` leaves them in, or which way an `add` went, never a number (an
 * `add` carries no HP to band, and the state the line is read against may be later than it). A cap
 * (`SetEvent.atMost`, a fallen level's) has no line: it bounds their HP without saying where it is.
 * Null for someone the POV can't see; undefined for any other event, which reads as usual.
 */
export function hpLine(ctx: ReadContext, e: LedgerEvent): string | null | undefined {
  const rules = rulesOf(ctx.world);
  if (!rules || (e.type !== "set" && e.type !== "add") || e.field !== rules.hp || e.entity === ctx.world.pov) return undefined;
  const seen = hpSeen(ctx, rules, e.entity);
  if (seen === null) return null;
  if (!("wound" in seen)) return undefined;
  const who = labelOf(ctx, e.entity);
  if (e.type === "add") return `${who} ${e.delta < 0 ? "takes damage" : "recovers"}`;
  if (e.atMost) return null;
  const band = typeof e.value === "number" ? woundOf(rules, e.value, hpMaxOf(ctx, rules, e.entity)) : "";
  return band !== "" ? `${who} is now ${band}` : null;
}

/** The HP field's name for lines: its label on the POV's kind, else the field id in words. */
function hpName(ctx: ReadContext, rules: CombatDef): string {
  const kind = own(ctx.state.entities, ctx.world.pov)?.kind ?? "";
  return fieldDef(ctx.registry, ctx.world, kind, rules.hp)?.label ?? rules.hp.replace(/_/g, " ");
}

/** HP of everyone who could be hurt: the fight's participants, and anyone who can fight where the POV is. */
function hpAround(ctx: ReadContext, rules: CombatDef): Map<EntityId, number> {
  const here = placeOfEntity(ctx.state, ctx.world.pov);
  const ids = new Set(encounterOf(ctx.state)?.order.map((f) => f.id) ?? []);
  for (const id of Object.keys(ctx.state.entities)) if (here !== null && placeOfEntity(ctx.state, id) === here && canFight(ctx, rules, id)) ids.add(id);
  return new Map([...ids].sort().map((id) => [id, hpOf(ctx, rules, id)]));
}

/** The narration of a fight for the Outcome slot, in the order it happened. */
class FightLines {
  readonly lines: string[] = [];
  /** Whether anything happened (an act, a turn, a fall): only then is the narrator told to narrate it. */
  happened = false;

  constructor(private readonly rules: CombatDef) {}

  push(line: string, happened = true): void {
    this.lines.push(line);
    if (happened) this.happened = true;
  }

  /**
   * The HP changes since `before`, as the POV sees them: its own and exact HP by the numbers ("Goblin
   * loses 7 HP (5 of 12 left)."), a wound band without them ("Goblin takes damage (badly hurt).").
   */
  changes(ctx: ReadContext, before: ReadonlyMap<EntityId, number>): void {
    for (const [id, was] of before) {
      const now = hpOf(ctx, this.rules, id);
      const who = nameFor(ctx, id);
      if (now === was || who === "someone") continue;
      const seen = hpSeen(ctx, this.rules, id);
      if (seen && "wound" in seen) {
        this.push(`${capital(who)} ${now < was ? "takes damage" : "recovers"}${seen.wound ? ` (${seen.wound})` : ""}.`);
        continue;
      }
      const verb = (now < was ? "lose" : "gain") + (id === ctx.world.pov ? "" : "s");
      const left = seen ? ` (${seen.current}${seen.max !== null ? ` of ${seen.max}` : ""} left)` : "";
      this.push(`${capital(who)} ${verb} ${Math.abs(now - was)} ${hpName(ctx, this.rules)}${left}.`);
    }
  }
}

// ---------------------------------------------------------------- settling, acts and turns

/**
 * Makes the events applied since `from` one event group (DESIGN §4.3): an act's spend, outcome, rule
 * events and record, or a fall with its condition, land whole or not at all. A rebased view where
 * the fight is another one drops the damage with the turn and the spend, not the record alone.
 */
function asUnit(w: Working, from: number, seed: string): void {
  if (w.events.length - from < 2) return;
  const group = `combat:${hashParts(seed, JSON.stringify(w.events.slice(from))).slice(0, 10)}`;
  for (let i = from; i < w.events.length; i++) {
    const e = w.events[i];
    if (e) w.events[i] = { ...e, group };
  }
}

/** Applies events and fires the rules they trigger (a rule may award XP when a fight ends), as one unit. */
function record(w: Working, events: readonly LedgerEvent[], seed: string): LedgerEvent[] {
  const from = w.events.length;
  const applied = w.applyAll(events);
  if (applied.length > 0) runRulesOnEvents(w.reg, w, applied, { seed });
  asUnit(w, from, seed);
  return applied;
}

/** Ends the fight once the POV isn't where it is (DESIGN §11): over for the POV, with no winner, so no one fights on unseen. True when it did. */
function leave(w: Working, rng: Rng, lines: FightLines): boolean {
  const enc = encounterOf(w.state);
  if (!enc || !povLeft(w.state, w.world, enc) || record(w, [{ type: "combat.end", data: { encounter: enc.id, reason: "left", winner: null, rounds: enc.round } }], rng.seed).length === 0) return false;
  lines.push("You leave the fight.");
  return true;
}

/** Ends a fight that has petered out (`stalledHolds`, over the calm the fold keeps). True when it did. */
function stalled(w: Working, rules: CombatDef, rng: Rng, lines: FightLines): boolean {
  const enc = encounterOf(w.state);
  if (!enc || !stalledHolds(w.ctx, rules, enc) || record(w, [{ type: "combat.end", data: { encounter: enc.id, reason: "stalemate", winner: null, rounds: enc.round } }], rng.seed).length === 0) return false;
  lines.push(`No one has attacked or been hurt in ${stalemateRounds(rules)} rounds: the fight peters out.`);
  return true;
}

/**
 * Ends the fight under way because the player moved the story past it with a time skip (DESIGN
 * §11): its rounds take no clock time, so no skip runs inside one. Its winner is the side left
 * standing, if only one is, as the `combat.end` effect reads it. The narrator's line for it; none
 * when no fight ended.
 */
export function breakOff(w: Working, seed: string): string[] {
  const enc = encounterOf(w.state);
  if (!enc || record(w, [{ type: "combat.end", data: { encounter: enc.id, reason: "skip", winner: winnerOf(w, enc), rounds: enc.round } }], seed).length === 0) return [];
  return ["The fight breaks off as time moves on."];
}

/**
 * After anything happened in a fight: whether the POV has left it, who went down or got back up
 * (with the rules' condition, through the Sheets pack's `sheets.condition` where it's loaded, and
 * the rules' life state: falling into it, and alive again once back up from it), then whether it's
 * over or has stalled. True when no fight is under way any more.
 */
function settle(w: Working, rules: CombatDef, rng: Rng, lines: FightLines): boolean {
  const enc = encounterOf(w.state);
  if (!enc || leave(w, rng.fork("left"), lines)) return true;
  const condition = typeof rules.down?.condition === "string" && rules.down.condition.trim() !== "" ? rules.down.condition : DOWN_CONDITION;
  const life = typeof rules.down?.life === "string" && isLifeState(w.world, rules.down.life) && rules.down.life !== ALIVE ? rules.down.life : null;
  for (const f of enc.order) {
    if (!own(w.state.entities, f.id)) continue;
    const down = downHolds(w.ctx, rules, f.id);
    const from = w.events.length;
    if (down === f.down || record(w, [{ type: "combat.down", data: { encounter: enc.id, entity: f.id, down } }], rng.seed).length === 0) continue;
    const fall = rng.fork(`down:${f.id}`);
    const effects: EffectSpec[] = [{ type: "sheets.condition", args: { who: f.id, condition, ...(down ? { mod: 0 } : { clear: true }) } }];
    if (life !== null && (down || lifeOf(w.state, f.id) === life)) effects.push({ type: "life", args: { entity: f.id, to: down ? life : ALIVE } });
    applyEffects(w.reg, w, effects, { bindings: { self: f.id }, rng: fall });
    asUnit(w, from, fall.seed);
    const who = nameFor(w.ctx, f.id);
    if (who !== "someone") lines.push(`${capital(who)} ${f.id === w.world.pov ? "are" : "is"} ${down ? "down" : "back up"}.`);
  }
  const now = encounterOf(w.state);
  if (!now) return true;
  if (!endHolds(w.ctx, rules, now)) return stalled(w, rules, rng.fork("calm"), lines);
  const winner = winnerOf(w, now);
  record(w, [{ type: "combat.end", data: { encounter: now.id, reason: "over", winner, rounds: now.round } }], rng.seed);
  lines.push(`The fight is over${winner === "party" ? ": your side won" : winner === "foes" ? ": your side lost" : ""}.`);
  return encounterOf(w.state) === null;
}

/**
 * The record of one act (`combat.act`): who did what to whom, and the check's outcome when it rolled
 * one. None for an action that starts a fight (its start says it) or only ends a turn; a stance
 * (Total defense, Dodge) changes nothing but what it spends, so spending something is an act too.
 */
function actEvents(enc: Encounter, actor: EntityId, action: ActionDef, params: JsonObject, res: Resolution): LedgerEvent[] {
  const acts = action.combat?.start !== true && (Object.keys(costOf(action)).length > 0 || Object.values(action.outcomes).some((list) => list.some((fx) => fx.type !== "combat.end_turn")));
  if (!acts) return [];
  const target = targetOf(action, params);
  return [{ type: "combat.act", data: { encounter: enc.id, actor, action: action.id, label: action.label, ...(target ? { target } : {}), ...(res.check && res.outcome ? { outcome: res.outcome } : {}) } }];
}

/** Moves the fight to its next turn, saying so when a round begins (the closing line says it when that turn is the POV's); a new round may find it stalled. */
function advance(w: Working, rules: CombatDef, rng: Rng, lines: FightLines): void {
  const enc = encounterOf(w.state);
  const next = enc ? nextTurn(w.ctx, rules, enc) : null;
  if (!enc || !next || record(w, [next], rng.seed).length === 0) return;
  lines.happened = true;
  const now = encounterOf(w.state);
  if (now && now.round > enc.round && !stalled(w, rules, rng.fork("calm"), lines) && now.order[now.turn]?.id !== w.world.pov) lines.push(`Round ${now.round}.`);
}

/** One option of a participant's turn: an action and the participant it targets, with its odds. */
export interface FightOption {
  action: ActionDef;
  target: EntityId | null;
  params: JsonObject;
  odds: Availability;
}

/** The option's key in an `npc.choose` question and its recorded decision: action id, then the target's id. */
export function optionKey(o: Pick<FightOption, "action" | "target">): string {
  return `${o.action.id}@${o.target ?? ""}`;
}

/** A participant's turn in a round, as `combat.decision` keys it. */
export function turnKey(enc: Pick<Encounter, "id">, round: number, id: EntityId): string {
  return `combat:${enc.id}:${round}:${id}`;
}

/**
 * What a participant could do now (its turn and economy as the state has them): every offered
 * combat action but a starting one, against each other standing participant it may target (or
 * none), that the engine would accept, with the exact odds the palette shows.
 */
export function fightOptions(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, actor: EntityId): FightOption[] {
  const enc = encounterOf(state);
  if (!enc) return [];
  const out: FightOption[] = [];
  for (const action of combatActions(reg, world)) {
    const param = targetParam(action);
    if (action.combat?.start === true || param === undefined) continue;
    const targets = param === null ? [null] : enc.order.filter((f) => f.id !== actor && standing({ world, state }, enc, f)).map((f) => f.id);
    for (const target of targets) {
      const params: JsonObject = param !== null && target !== null ? { [param]: target } : {};
      const odds = actionOdds(reg, world, state, { action, actor, params });
      if (odds.available) out.push({ action, target, params, odds });
    }
  }
  return out;
}

/** How likely an option is to change anything: the odds of the outcomes that have effects (1 without a check). */
function landing(o: FightOption): number {
  if (!o.odds.odds) return 1;
  let p = 0;
  for (const [outcome, q] of Object.entries(o.odds.odds)) if ((own(o.action.outcomes, outcome) ?? []).length > 0) p += q;
  return p;
}

function greater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/**
 * The engine's own pick for a participant (DESIGN §11): a defensive action when it's hurt (the
 * rules' `lowHp`, else a quarter of its HP or less) and a foe acted against it this round or the
 * last, if one is offered; else an attack on the foe with the highest threat (ties: the POV, then
 * initiative order) with the action most likely to land (ties: action id). Only actions that spend
 * something, so a free one never repeats forever, and two hurt fighters don't guard forever.
 */
export function tacticFor(ctx: ReadContext, rules: CombatDef, enc: Encounter, me: Fighter, options: readonly FightOption[]): FightOption | null {
  const costly = options.filter((o) => Object.keys(costOf(o.action)).length > 0);
  const max = hpMaxOf(ctx, rules, me.id);
  const low = rules.tactics?.lowHp !== undefined ? truthy(readFor(ctx, rules.tactics.lowHp, { self: me.id }, false)) : max !== null && max > 0 && hpOf(ctx, rules, me.id) * 4 <= max;
  const foes = new Set(enc.order.filter((f) => f.side !== me.side).map((f) => f.id));
  const pressed = enc.log.some((l) => l.target === me.id && foes.has(l.actor) && l.round >= enc.round - 1);
  const defend = low && pressed ? costly.find((o) => o.action.combat?.role === "defend" && o.target === null) : undefined;
  if (defend) return defend;
  const rank = new Map(enc.order.map((f, i) => [f.id, i]));
  let best: { o: FightOption; key: number[] } | null = null;
  for (const o of costly) {
    if (o.action.combat?.role !== "attack" || o.target === null || !foes.has(o.target)) continue;
    const threat = Number(readFor(ctx, rules.tactics?.threat ?? `target.${rules.hp}`, { self: me.id, target: o.target }, 0));
    const key = [Number.isFinite(threat) ? threat : 0, o.target === ctx.world.pov ? 1 : 0, -(rank.get(o.target) ?? 0), landing(o)];
    if (!best || greater(key, best.key)) best = { o, key };
  }
  return best?.o ?? null;
}

/**
 * One act of anyone but the POV: its resolution (the spend included), its `combat.act` record, the
 * rules both fire, and the narration of what it changed.
 */
function act(w: Working, rules: CombatDef, actor: EntityId, chosen: FightOption, rng: Rng, lines: FightLines): boolean {
  const enc = encounterOf(w.state);
  if (!enc) return false;
  const before = hpAround(w.ctx, rules);
  const from = w.events.length;
  const res = resolveAction(w.reg, w, { action: chosen.action, actor, params: chosen.params }, rng);
  if (!res.ok) return false;
  if (res.events.length > 0) runRulesOnEvents(w.reg, w, res.events, { seed: rng.seed });
  const recorded = actEvents(enc, actor, chosen.action, chosen.params, res);
  record(w, recorded, rng.seed);
  asUnit(w, from, rng.seed);
  if (recorded.length > 0) lines.push(`${capital(nameFor(w.ctx, actor))}: ${chosen.action.label}${chosen.target ? ` → ${nameFor(w.ctx, chosen.target)}` : ""}${res.check && res.outcome ? ` (${res.outcome.replace(/_/g, " ")})` : ""}.`);
  lines.changes(w.ctx, before);
  return true;
}

/** Everyone else's turn: up to a few acts, a recorded `npc.choose` pick first while it's legal, then tactics; then the next turn. */
function othersTurn(w: Working, rules: CombatDef, rng: Rng, lines: FightLines): void {
  const start = encounterOf(w.state);
  const me = start?.order[start.turn];
  if (!start || !me) return;
  const decided = own(decisionsOf(w.state), turnKey(start, start.round, me.id));
  for (let n = 0; n < ACTS_PER_TURN; n++) {
    const enc = encounterOf(w.state);
    const f = enc ? fighterOf(enc, me.id) : undefined;
    if (!enc || !f || enc.order[enc.turn]?.id !== me.id || enc.round !== start.round || !standing(w, enc, f)) return;
    const options = fightOptions(w.reg, w.world, w.state, me.id);
    const chosen = (n === 0 && decided !== undefined ? options.find((o) => optionKey(o) === decided) : undefined) ?? tacticFor(w.ctx, rules, enc, f, options);
    if (!chosen || !act(w, rules, me.id, chosen, rng.fork(`act:${n}`), lines)) break;
    if (settle(w, rules, rng.fork(`settle:${n}`), lines)) return;
  }
  const enc = encounterOf(w.state);
  // Its acts may have ended the turn already (End turn, picked by a decision).
  if (enc && enc.order[enc.turn]?.id === me.id && enc.round === start.round) advance(w, rules, rng.fork("advance"), lines);
}

/** Everyone else's turns until the POV's comes round, within the turn's budget of one round across both passes (a POV who is down sees a round per turn). */
function othersUntilPov(w: Working, rules: CombatDef, rng: Rng, lines: FightLines, steps: { left: number | null }): void {
  for (;;) {
    const enc = encounterOf(w.state);
    const current = enc?.order[enc.turn];
    if (!enc || !current) return;
    const live = standing(w, enc, current);
    if (current.id === w.world.pov && live) return;
    steps.left ??= enc.order.length;
    if (steps.left <= 0) return;
    steps.left--;
    const step = rng.fork(`turn:${enc.round}:${enc.turn}`);
    if (live) othersTurn(w, rules, step, lines);
    else advance(w, rules, step, lines);
  }
}

/** "A fight starts. Initiative: Goblin 17, you 12." Someone the POV can't see has no total. */
function startLine(ctx: ReadContext, e: LedgerEvent): string {
  const order = "data" in e && Array.isArray(e.data.order) ? e.data.order : [];
  const names = order.flatMap((f) => {
    if (!isRecord(f) || typeof f.id !== "string") return [];
    const name = nameFor(ctx, f.id);
    return [`${name}${name !== "someone" && typeof f.init === "number" ? ` ${f.init}` : ""}`];
  });
  return `A fight starts. Initiative: ${names.join(", ")}.`;
}

/** The closing lines: whose turn it is and what the POV has left, or that it's out of the fight. */
function closing(ctx: ReadContext, rules: CombatDef, lines: FightLines): string[] {
  const enc = encounterOf(ctx.state);
  const me = enc ? fighterOf(enc, ctx.world.pov) : undefined;
  if (enc && me && !standing(ctx, enc, me)) lines.push(`You are out of the fight; it goes on (round ${enc.round}).`, false);
  else if (enc && me && enc.order[enc.turn]?.id === me.id) {
    const left = Object.entries(rules.economy).flatMap(([budget, def]) => (isRecord(def) ? [`${me.left[budget] ?? 0} ${typeof def.label === "string" && def.label !== "" ? def.label : budget}`] : []));
    lines.push(`Round ${enc.round}, your turn${left.length > 0 ? `: ${left.join(", ")} left` : ""}.`, false);
  }
  if (lines.happened) lines.push("Narrate the fight in this order; add no other attacks, hits or damage.", false);
  return lines.lines;
}

/** A fight's part of one turn (the `combat.round` service): opened before the POV's action, closed after it. */
export interface FightRound {
  /**
   * After the POV's action (or none): its combat action recorded and settled; its turn ended on End
   * turn, or once nothing it could do fits what's left (unless the rules want End turn); then
   * everyone else's turns until the POV's comes round. The lines the Outcome slot tells the narrator.
   */
  after(acted: { resolution: Resolution; params: JsonObject } | null): string[];
}

/**
 * Opens a fight's part of a turn (DESIGN §11): everyone else's turns still due before the POV can
 * act (a fight a rule or a GM edit started), and the HP its action will be measured against. Null
 * in a world without combat rules.
 */
export function openRound(w: Working, rng: Rng): FightRound | null {
  const rules = rulesOf(w.world);
  if (!rules) return null;
  const lines = new FightLines(rules);
  // At most one round's worth of turns for the whole turn: the passes before and after the POV's action share it.
  const steps: { left: number | null } = { left: null };
  // A POV moved off since the last turn (a GM edit, a narrated move) has left the fight before anyone acts.
  leave(w, rng.fork("left"), lines);
  othersUntilPov(w, rules, rng.fork("due"), lines, steps);
  const from = w.events.length;
  const before = hpAround(w.ctx, rules);
  return {
    after(acted) {
      for (const e of w.events.slice(from)) {
        if (e.type === "combat.start") lines.push(startLine(w.ctx, e));
        else if (e.type === "combat.end") lines.push("The fight is over.");
      }
      const res = acted?.resolution;
      const action = res?.ok ? findAction(w.reg, w.world, res.action) : undefined;
      const enc = encounterOf(w.state);
      if (!enc) return closing(w.ctx, rules, lines);
      if (res && action) {
        // The POV's act from its first event past the participants' materialization, with its record: one group.
        const start = w.events.findIndex((e, i) => i >= from && e.type !== "materialize");
        if (action.combat && record(w, actEvents(enc, res.actor, action, acted?.params ?? {}, res), rng.seed).length > 0 && start >= 0) asUnit(w, start, rng.fork("act").seed);
        lines.changes(w.ctx, before);
      }
      // Anything may have changed who is down (a potion, a narrated blow before this turn), so the fight settles every turn.
      if (!settle(w, rules, rng.fork("settle"), lines) && action?.combat) {
        const now = encounterOf(w.state);
        const me = now ? fighterOf(now, w.world.pov) : undefined;
        // What it could still do: a combat action that spends only budgets that keep a turn open, and fits.
        const more = me ? combatActions(w.reg, w.world).some((a) => {
          const cost = costOf(a);
          return a.combat?.start !== true && Object.keys(cost).length > 0 && !offTurnCost(rules, cost) && fits(cost, me.left);
        }) : false;
        if (now && me && now.order[now.turn]?.id === me.id && rules.endTurn !== "manual" && !more) advance(w, rules, rng.fork("end"), lines);
      }
      othersUntilPov(w, rules, rng.fork("others"), lines, steps);
      return closing(w.ctx, rules, lines);
    },
  };
}

/** The `npc.choose` questions a fight has before the POV's next turn (DESIGN §5.2): everyone acting before it, with their legal options. */
export function fightChoices(ctx: ReadContext): { key: string; agent: EntityId; options: string[]; labels: Record<string, string> }[] {
  const rules = rulesOf(ctx.world);
  const enc = encounterOf(ctx.state);
  if (!rules || !enc || enc.order[enc.turn]?.id !== ctx.world.pov || povLeft(ctx.state, ctx.world, enc)) return [];
  const decided = decisionsOf(ctx.state);
  const out: { key: string; agent: EntityId; options: string[]; labels: Record<string, string> }[] = [];
  const n = enc.order.length;
  for (let k = 1; k < n; k++) {
    const index = (enc.turn + k) % n;
    const f = enc.order[index];
    if (!f || f.id === ctx.world.pov) break;
    const key = turnKey(enc, enc.round + Math.floor((enc.turn + k) / n), f.id);
    if (!standing(ctx, enc, f) || own(decided, key) !== undefined) continue;
    // Its options as they will be when its turn starts: its turn, its per-turn budgets refilled.
    const state = structuredClone(ctx.state) as WorldState;
    writeEncounter(state, { ...enc, turn: index, order: enc.order.map((p) => (p.id === f.id ? { ...p, left: { ...p.left, ...turnRefill(ctx, rules, p.id) } } : p)) });
    const options = fightOptions(ctx.registry, ctx.world, state, f.id);
    if (options.length < 2) continue;
    const labels: Record<string, string> = {};
    for (const o of options) labels[optionKey(o)] = `${o.action.label}${o.target ? ` ${labelOf(ctx, o.target)}` : ""}`;
    out.push({ key, agent: f.id, options: options.map(optionKey), labels });
  }
  return out;
}
