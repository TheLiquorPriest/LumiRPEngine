// Checks (DESIGN §11): the one check mechanism. A check is a dice expression plus outcome bands.
// What it reads from the world (modifier, advantage, DC, an opponent's side) is evaluated from the
// state before the roll and fixed into a `ReadyCheck`; its exact odds (`checkOdds`) and its roll
// (`rollCheck`) read the same notation and bands, so the odds the palette shows are the real odds.
//
//   natural bands  match the natural die's face (`naturalDie`), before the total bands
//   advantage      −1, 0 or 1: more natural dice (`withAdvantage`), never a modifier
//   dc             margin = total − DC; with a DC and no bands: failure below 0, success from 0
//   vs             an opponent who rolls is folded into one notation (`opposedDice`), modifier
//                  A − B and DC 0 unless the check sets one; a passive score is the DC
//
// The odds count the joint law of the natural die and the total only when a band reads the
// natural die; otherwise the total's distribution alone decides every band.

import type { EntityId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { JsonValue } from "../shared/json";
import type { CheckBand, CheckDef, Span, WorldDoc } from "../shared/world";
import { DiceError, diceDistribution, naturalDie, naturalSplit, opposedDice, parseDice, rollDice, withAdvantage, type DiceRoll } from "./dice";
import type { EnvVars, Value } from "./expr";
import type { ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import { evalExpr, scopeEnv } from "./scope";
import { own } from "./pack-kit";

/** The outcome when no band covers a roll (lint flags gaps). */
export const NO_BAND = "none";

/** A check with a DC (or an opponent) and no bands of its own reads these two. */
export const DC_BANDS: readonly CheckBand[] = [
  { outcome: "failure", margin: { max: -1 } },
  { outcome: "success", margin: { min: 0 } },
];

/** What a roll is read as: the natural die (null without one), the total, and the margin over the DC (null without one). */
export interface CheckReading {
  natural: number | null;
  total: number;
  margin: number | null;
}

/** A check fixed from the state before the roll: exactly what is rolled, and what it is read against. */
export interface ReadyCheck {
  check: CheckDef;
  /** The notation rolled: the check's dice with advantage applied, minus an opponent's roll. */
  notation: string;
  modifier: number;
  /** The advantage the dice carry (0 when the notation has no natural die to give it to). */
  advantage: -1 | 0 | 1;
  dc: number | null;
  bands: readonly CheckBand[];
  /** The opponent of an opposed check. */
  opponent: EntityId | null;
}

export interface CheckRoll extends CheckReading {
  roll: DiceRoll;
  outcome: string;
}

/** The numbers a check was read with, before they are fixed into a notation and bands. */
export interface CheckInputs {
  modifier?: number;
  advantage?: number;
  dc?: number | null;
  /** An opponent who rolls: their dice (advantage applied) and modifier. */
  against?: { dice: string; modifier: number };
  opponent?: EntityId | null;
}

/** The check an action or effect names: a world check by id, or an inline definition. */
export function checkOf(world: WorldDoc, ref: string | CheckDef | JsonValue | undefined): CheckDef | null {
  if (typeof ref === "string") return own(world.checks, ref) ?? null;
  return isRecord(ref) && typeof ref.dice === "string" ? (ref as unknown as CheckDef) : null;
}

/** The bands a check reads: its own, else the DC's two when it has a DC. */
export function checkBands(check: CheckDef, dc: number | null): readonly CheckBand[] {
  const authored = Array.isArray(check.bands) ? check.bands : [];
  return authored.length > 0 ? authored : dc !== null ? DC_BANDS : [];
}

function within(span: Span | undefined, v: number | null): boolean {
  if (!span) return true;
  return v !== null && (span.min === undefined || v >= span.min) && (span.max === undefined || v <= span.max);
}

function matches(b: CheckBand, x: CheckReading): boolean {
  return within(b.natural, x.natural) && within(b, x.total) && within(b.margin, x.margin);
}

/** The outcome of a reading: the first band with a `natural` range that matches, else the first other band that matches, else null. */
export function bandOutcome(bands: readonly CheckBand[], x: CheckReading): string | null {
  for (const b of bands) if (b.natural && matches(b, x)) return b.outcome;
  for (const b of bands) if (!b.natural && matches(b, x)) return b.outcome;
  return null;
}

/**
 * Fixes a check from numbers already read: advantage goes into the dice, an opponent's roll is
 * subtracted in the notation and the modifier, and the bands are chosen. Throws DiceError when the
 * dice can't be read.
 */
export function fixedCheck(check: CheckDef, inputs: CheckInputs): ReadyCheck {
  const wanted = Math.sign(inputs.advantage ?? 0);
  const advantaged = withAdvantage(check.dice, wanted);
  let notation = advantaged ?? check.dice;
  let modifier = inputs.modifier ?? 0;
  let dc = inputs.dc ?? null;
  if (inputs.against) {
    notation = opposedDice(notation, inputs.against.dice);
    modifier -= inputs.against.modifier;
    dc ??= 0;
  }
  // Unreadable dice are refused here, before anything is rolled or counted.
  parseDice(notation);
  // Without a natural die there is nothing to give the advantage to (lint flags the check).
  const advantage = advantaged === null || wanted === 0 ? 0 : wanted > 0 ? 1 : -1;
  return { check, notation, modifier, advantage, dc, bands: checkBands(check, dc), opponent: inputs.opponent ?? null };
}

/** A formula's value as a whole number (anything unreadable is 0), as modifiers have always been read. */
function whole(v: Value): number {
  return Math.round(Number(v)) || 0;
}

/** What the player's described approach does to a check before it is fixed (DESIGN §11 adjudication). */
export interface CheckShift {
  modifier?: number;
  /** Added to the check's own advantage: advantage and disadvantage cancel a die at a time. */
  advantage?: number;
  /** Lowers the DC (an opponent's passive score or roll included); a check without one takes it as modifier. */
  dc?: number;
}

/**
 * Fixes a check against the state (DESIGN §11). The modifier, advantage and DC are read with
 * `bindings` (the roller is `self`); an opponent's side with the opponent as `self` and the rest of
 * the bindings unchanged; then `shift` applies. Rejected when the check is opposed and its binding
 * names no one, or the dice can't be read.
 */
export function readyCheck(reg: Registry, ctx: ReadContext, check: CheckDef, bindings: Record<string, EntityId>, vars?: EnvVars, shift?: CheckShift): ReadyCheck | Rejection {
  const env = scopeEnv({ reg, ctx, bindings, vars });
  const inputs: CheckInputs = {
    modifier: whole(evalExpr(check.modifier ?? 0, env, 0)),
    advantage: whole(evalExpr(check.advantage ?? 0, env, 0)),
    dc: check.dc === undefined ? null : whole(evalExpr(check.dc, env, 0)),
  };
  try {
    const vs = check.vs;
    if (vs) {
      const opponent = own(bindings, vs.who ?? "target");
      if (opponent === undefined || !own(ctx.state.entities, opponent)) return { code: "no_opponent", reason: "there is no one to roll against" };
      inputs.opponent = opponent;
      const theirs = scopeEnv({ reg, ctx, bindings: { ...bindings, self: opponent }, vars });
      if (vs.passive !== undefined) inputs.dc = whole(evalExpr(vs.passive, theirs, 0));
      else {
        // The opponent rolls the named check, else this check's dice with `modifier`, else this very check.
        const other = vs.check !== undefined ? own(ctx.world.checks, vs.check) : vs.modifier === undefined ? check : undefined;
        if (vs.check !== undefined && !other) return { code: "unknown_check", reason: `no check ${vs.check}` };
        const dice = other ? (withAdvantage(other.dice, Math.sign(whole(evalExpr(other.advantage ?? 0, theirs, 0)))) ?? other.dice) : check.dice;
        inputs.against = { dice, modifier: whole(evalExpr((other ? other.modifier : vs.modifier) ?? 0, theirs, 0)) };
      }
    }
    if (shift) {
      inputs.modifier = (inputs.modifier ?? 0) + (shift.modifier ?? 0);
      inputs.advantage = (inputs.advantage ?? 0) + (shift.advantage ?? 0);
      const drop = shift.dc ?? 0;
      // An opponent who rolls is read against DC 0, so lowering it is a DC below 0.
      if (drop !== 0 && inputs.dc !== undefined && inputs.dc !== null) inputs.dc -= drop;
      else if (drop !== 0 && inputs.against) inputs.dc = -drop;
      else inputs.modifier += drop;
    }
    return fixedCheck(check, inputs);
  } catch (e) {
    if (e instanceof DiceError) return { code: "bad_dice", reason: e.message };
    throw e;
  }
}

function readingOf(ready: ReadyCheck, natural: number | null, sum: number): CheckReading {
  const total = sum + ready.modifier;
  return { natural, total, margin: ready.dc === null ? null : total - ready.dc };
}

/** Exact probability of each outcome; `none` collects any mass no band covers. */
export function checkOdds(ready: ReadyCheck): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of ready.bands) out[b.outcome] = 0;
  const add = (x: CheckReading, p: number): void => {
    const outcome = bandOutcome(ready.bands, x) ?? NO_BAND;
    out[outcome] = (out[outcome] ?? 0) + p;
  };
  const split = ready.bands.some((b) => b.natural) ? naturalSplit(ready.notation) : null;
  if (split) {
    split.natural.probs.forEach((pn, i) => {
      if (pn === 0) return;
      const n = split.natural.min + i;
      split.rest.probs.forEach((pr, j) => {
        if (pr > 0) add(readingOf(ready, n, split.sign * n + split.rest.min + j), pn * pr);
      });
    });
    return out;
  }
  const dist = diceDistribution(ready.notation);
  dist.probs.forEach((p, i) => {
    if (p > 0) add(readingOf(ready, null, dist.min + i), p);
  });
  return out;
}

/** Rolls a ready check. Draws only from `rng`, through the dice roller. */
export function rollCheck(ready: ReadyCheck, rng: Rng): CheckRoll {
  const roll = rollDice(ready.notation, rng);
  // The natural die only counts where the notation has one, as the odds count it.
  const natural = naturalDie(parseDice(ready.notation)) ? roll.natural : null;
  const reading = readingOf(ready, natural, roll.total);
  return { roll, ...reading, outcome: bandOutcome(ready.bands, reading) ?? NO_BAND };
}

/** What an outcome's effects see as `roll.*` (DESIGN §11): natural, total, modifier, dc, margin and outcome. */
export function rollVars(ready: ReadyCheck, rolled: CheckRoll): EnvVars {
  return { natural: rolled.natural, total: rolled.total, modifier: ready.modifier, dc: ready.dc, margin: rolled.margin, outcome: rolled.outcome };
}
