// The combat pack's model (DESIGN §11): the fight under way as `state.packs.combat` holds it, the
// world's combat rules with their defaults, and the reads every part of the pack shares (HP, who is
// standing, whose turn it is, what is left of a budget, what an action costs).

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { ActionDef, BandDef, CombatBudgetDef, CombatDef, WorldDoc } from "../../../shared/world";
import type { Value } from "../../../engine/expr";
import { mutableSlice, numOf, objOf, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { evalExpr, fieldDef, isGone, placeOfEntity, poolMax, scopeEnv, truthy } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";

export const PACK = "combat";

/** The POV's side and the other one. */
export type Side = "party" | "foes";

export interface Fighter {
  id: EntityId;
  side: Side;
  /** The initiative total it rolled. */
  init: number;
  down: boolean;
  /** What is left of each budget. */
  left: Record<string, number>;
}

/** One act of a fight, as the Encounter card lists it. */
export interface LogEntry {
  round: number;
  actor: EntityId;
  /** The action's label when it was taken. */
  action: string;
  target: EntityId | null;
  outcome: string | null;
}

/**
 * A run of calm rounds: whole rounds in which no one attacked (hit or miss) and no one's HP changed.
 * HP as it stood when the run began, how many whole rounds it has lasted, and whether someone has
 * attacked in the round under way, which ends the run when that round does.
 */
export interface Calm {
  hp: Record<EntityId, number>;
  rounds: number;
  struck: boolean;
}

export interface Encounter {
  id: string;
  /** Where it is fought: anyone who isn't there any more is out of it, and the POV leaving ends it. */
  place: string | null;
  round: number;
  /** Index into `order` of whose turn it is. */
  turn: number;
  /** Initiative order. */
  order: Fighter[];
  /** This round's and the last round's acts, oldest first. */
  log: LogEntry[];
  /** Kept by the fold at each new round, so a stalemate is read from the state, never from a plan. */
  calm: Calm;
}

/** How many calm rounds in a row end a fight as a stalemate when the rules don't say. */
export const STALEMATE_ROUNDS = 3;

/** How many acts the log keeps. */
export const LOG_CAP = 24;

/** The bands a wound reads as by default, over the HP left in percent. */
export const DEFAULT_WOUNDS: readonly BandDef[] = [
  { label: "unhurt", min: 100 },
  { label: "hurt", min: 50, max: 100 },
  { label: "badly hurt", max: 50 },
];

/** The condition a participant who is down has, unless the rules name another. */
export const DOWN_CONDITION = "down";

/** The world's combat rules, or null when it has none (or they're too broken to run a fight). */
export function rulesOf(world: Pick<WorldDoc, "ruleset">): CombatDef | null {
  const c: unknown = world.ruleset?.combat;
  if (!isRecord(c) || !isRecord(c.economy) || typeof c.hp !== "string" || c.hp === "" || (typeof c.initiative !== "string" && !isRecord(c.initiative))) return null;
  // The parts a fight can't run without are checked above; the rest is read defensively where it is used.
  return c as unknown as CombatDef;
}

function numbers(v: JsonValue | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(objOf(v))) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
}

/** The fight under way, or null. */
export function encounterOf(state: Readonly<WorldState>): Encounter | null {
  const raw = sliceOf(state, PACK).encounter;
  if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.order)) return null;
  const order: Fighter[] = [];
  for (const f of raw.order) {
    if (!isRecord(f) || typeof f.id !== "string" || (f.side !== "party" && f.side !== "foes")) continue;
    order.push({ id: f.id, side: f.side, init: numOf(f.init), down: f.down === true, left: numbers(f.left) });
  }
  const log: LogEntry[] = [];
  for (const e of Array.isArray(raw.log) ? raw.log : []) {
    if (!isRecord(e) || typeof e.actor !== "string") continue;
    log.push({ round: numOf(e.round), actor: e.actor, action: strOf(e.action), target: typeof e.target === "string" ? e.target : null, outcome: typeof e.outcome === "string" ? e.outcome : null });
  }
  const calm = objOf(raw.calm);
  return { id: raw.id, place: typeof raw.place === "string" ? raw.place : null, round: Math.max(1, numOf(raw.round, 1)), turn: Math.max(0, numOf(raw.turn)), order, log, calm: { hp: numbers(calm.hp), rounds: Math.max(0, numOf(calm.rounds)), struck: calm.struck === true } };
}

/** Writes the fight back inside an event reducer; null ends it (and its recorded decisions). */
export function writeEncounter(state: WorldState, enc: Encounter | null): void {
  const slice = mutableSlice(state, PACK);
  // An Encounter is plain JSON data; the cast only restates it as JSON.
  if (enc) slice.encounter = enc as unknown as JsonObject;
  else {
    delete slice.encounter;
    delete slice.decisions;
  }
  if (Object.keys(slice).length === 0) delete state.packs[PACK];
}

/** `npc.choose` picks for the fight, by key (`combat.decision`). */
export function decisionsOf(state: Readonly<WorldState>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(objOf(sliceOf(state, PACK).decisions))) if (typeof v === "string") out[k] = v;
  return out;
}

/** A participant of the fight, by entity id. */
export function fighterOf(enc: Encounter, id: EntityId): Fighter | undefined {
  return enc.order.find((f) => f.id === id);
}

/** Whether a participant still fights: not down, not removed, and still where the fight is. */
export function standing(state: Readonly<WorldState>, enc: Encounter, f: Fighter): boolean {
  return !f.down && !isGone(state, f.id) && own(state.entities, f.id) !== undefined && placeOfEntity(state, f.id) === enc.place;
}

/**
 * Whether someone is in the fight under way and still where it is fought, down or not, while the
 * POV is there too (one it has left is over): day plans and schedules leave them where they are.
 */
export function engaged(state: Readonly<WorldState>, world: Pick<WorldDoc, "pov">, id: EntityId): boolean {
  const enc = encounterOf(state);
  return enc !== null && !povLeft(state, world, enc) && fighterOf(enc, id) !== undefined && !isGone(state, id) && placeOfEntity(state, id) === enc.place;
}

/** Whether the POV has left the fight: it isn't where the fight is, so the fight is over for it. */
export function povLeft(state: Readonly<WorldState>, world: Pick<WorldDoc, "pov">, enc: Pick<Encounter, "place">): boolean {
  return placeOfEntity(state, world.pov) !== enc.place;
}

/** A formula read with these bindings; `fallback` when it is unset or doesn't read. */
export function readFor(ctx: ReadContext, expr: Value | undefined, bindings: Record<string, EntityId>, fallback: Value): Value {
  if (expr === undefined || expr === null) return fallback;
  return evalExpr(typeof expr === "number" || typeof expr === "boolean" ? expr : String(expr), scopeEnv({ reg: ctx.registry, ctx, bindings }), fallback);
}

/** A participant's HP: its pool as stored, an unset pool being full. */
export function hpOf(ctx: ReadContext, rules: CombatDef, id: EntityId): number {
  const v = scopeEnv({ reg: ctx.registry, ctx, bindings: { self: id } }).lookup(["self", rules.hp]);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Every participant's HP, by id: what a calm compares round by round. */
export function hpByFighter(ctx: ReadContext, rules: CombatDef, order: readonly Pick<Fighter, "id">[]): Record<EntityId, number> {
  return Object.fromEntries(order.map((f) => [f.id, hpOf(ctx, rules, f.id)]));
}

export function sameHp(a: Readonly<Record<EntityId, number>>, b: Readonly<Record<EntityId, number>>): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => own(b, id) === a[id]);
}

/** A participant's HP max: the pool's evaluated max, else null. */
export function hpMaxOf(ctx: ReadContext, rules: CombatDef, id: EntityId): number | null {
  const e = own(ctx.state.entities, id);
  const pool = e ? fieldDef(ctx.registry, ctx.world, e.kind, rules.hp)?.pool : undefined;
  return pool ? poolMax(ctx.registry, ctx, id, pool) : null;
}

/** Whether an entity can fight: it is in the world and its kind has the HP field. */
export function canFight(ctx: ReadContext, rules: CombatDef, id: EntityId): boolean {
  const e = own(ctx.state.entities, id);
  return !!e && !isGone(ctx.state, id) && fieldDef(ctx.registry, ctx.world, e.kind, rules.hp) !== undefined;
}

/** Whether the down rule holds for a participant: the rules' formula, else no HP left. */
export function downHolds(ctx: ReadContext, rules: CombatDef, id: EntityId): boolean {
  if (rules.down?.when !== undefined) return truthy(readFor(ctx, rules.down.when, { self: id }, false));
  return hpOf(ctx, rules, id) <= 0;
}

/** How many of a budget a participant gets: its count as a whole number from 0 (default 1). */
export function budgetCount(ctx: ReadContext, budget: CombatBudgetDef, id: EntityId): number {
  const n = Number(readFor(ctx, budget.count ?? 1, { self: id }, 1));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Every budget at its count, for a participant (a fight's start). */
export function fullEconomy(ctx: ReadContext, rules: CombatDef, id: EntityId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [budget, def] of Object.entries(rules.economy)) if (isRecord(def)) out[budget] = budgetCount(ctx, def, id);
  return out;
}

/** What an action costs, budget by budget: whole positive amounts only. */
export function costOf(action: Pick<ActionDef, "combat">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [budget, n] of Object.entries(isRecord(action.combat?.cost) ? action.combat.cost : {})) if (typeof n === "number" && Number.isFinite(n) && n > 0) out[budget] = Math.round(n);
  return out;
}

/** Whether a cost fits what a participant has left. */
export function fits(cost: Readonly<Record<string, number>>, left: Readonly<Record<string, number>>): boolean {
  return Object.entries(cost).every(([budget, n]) => (left[budget] ?? 0) >= n);
}

/** Whether a cost may be spent off its payer's turn: every budget it draws on is an off-turn one (a reaction). */
export function offTurnCost(rules: CombatDef, cost: Readonly<Record<string, number>>): boolean {
  const budgets = Object.keys(cost);
  return budgets.length > 0 && budgets.every((b) => own(rules.economy, b)?.offTurn === true);
}

/** Standing participants of a side. */
export function standingOn(state: Readonly<WorldState>, enc: Encounter, side: Side): Fighter[] {
  return enc.order.filter((f) => f.side === side && standing(state, enc, f));
}

/** Whether the fight is over: the rules' end formula, else one side has no one standing. */
export function endHolds(ctx: ReadContext, rules: CombatDef, enc: Encounter): boolean {
  if (rules.end !== undefined) return truthy(readFor(ctx, rules.end, {}, false));
  return standingOn(ctx.state, enc, "party").length === 0 || standingOn(ctx.state, enc, "foes").length === 0;
}

/** How many calm rounds in a row end a fight as a stalemate: the rules' `stalemate` as a whole number from 0 (none ever does), else 3. */
export function stalemateRounds(rules: Pick<CombatDef, "stalemate">): number {
  const n = rules.stalemate;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : STALEMATE_ROUNDS;
}

/**
 * Whether an act is an attack, hit or miss: its action has the attack role, or it is aimed at
 * someone on the other side. A round with one in it isn't calm, so turtling against a foe who keeps
 * swinging never ends a fight as a stalemate.
 */
export function attacks(ctx: ReadContext, enc: Encounter, actor: EntityId, action: string, target: EntityId | null): boolean {
  if ((own(ctx.world.actions, action) ?? ctx.registry.actions.get(action))?.combat?.role === "attack") return true;
  const by = fighterOf(enc, actor);
  const at = target !== null ? fighterOf(enc, target) : undefined;
  return by !== undefined && at !== undefined && by.side !== at.side;
}

/** Whether a fight has petered out: its rules end one at all, its calm has lasted that many whole rounds, and no one has attacked or been hurt since. */
export function stalledHolds(ctx: ReadContext, rules: CombatDef, enc: Encounter): boolean {
  const rounds = stalemateRounds(rules);
  return rounds > 0 && enc.calm.rounds >= rounds && !enc.calm.struck && sameHp(hpByFighter(ctx, rules, enc.order), enc.calm.hp);
}

/** Which side won: the only one with anyone standing, else none. */
export function winnerOf(state: Readonly<WorldState>, enc: Encounter): Side | null {
  const party = standingOn(state, enc, "party").length;
  const foes = standingOn(state, enc, "foes").length;
  return party > 0 && foes === 0 ? "party" : foes > 0 && party === 0 ? "foes" : null;
}
