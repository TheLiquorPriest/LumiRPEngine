// The engine's dice on the harness engine (HARNESS-SLICE3: "GM ... a roll (dice belong to the
// engine)"). An attempt is read here and rolled here, and the two are kept apart.
//
// - `checks_stakes` reads an attempt before it is played: whether it can be tried, the exact odds
//   and what the world's policy makes of them, what the judged approach does to the roll, and what
//   the action's rules do on each outcome. It stands in for what the classic turn's `judge` step is
//   shown, with the call's `rating`, `reason` and `outcomes` as that step's answer. It rolls
//   nothing, so no agent is shown a roll it could still decline, or move to another attempt.
// - The roll is made once, when the attempt is played (`action_play` in `play.ts`, a fight's round
//   in `fight.ts`), through `playAttempt`: resolved exactly as a classic turn plays it
//   (`resolveAction`; the open attempt no action covers as `resolveTry`, under the chat's
//   inferred-checks policy), and recorded with what it did.
//
// The dice are drawn from the turn's seed, who rolls, and how many rolls the turn has recorded for
// them so far (`rollSeed`). Nothing a call says is part of that: no argument and no wording of an
// attempt moves the dice, and they move on only once a roll is in the turn's record. For the same
// reason an argument the action doesn't declare is refused rather than carried along (`askedOf`).

import { HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TOOL } from "../../../../shared/harness-texts";
import { PLAY_NOTE } from "../../../../shared/harness-texts-play";
import { hashParts } from "../../../../shared/hash";
import type { EntityId } from "../../../../shared/ids";
import { bandsWithin } from "../../../../shared/inferred";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import type { LedgerEvent } from "../../../../shared/ledger";
import type { ActionDef, AdjudicationDef, WorldDoc } from "../../../../shared/world";
import { approachShift, checkView, type Judgement, outcomeChoices, policyFor, ratingOf } from "../../../../engine/adjudication";
import { ENGINE_EVENTS } from "../../../../engine/engine-pack";
import { allowedSkills, inferredOf, inferredRead, resolveTry, skillSources, TRY_ACTION, tryJudged } from "../../../../engine/inferred";
import { hiddenNameCheck } from "../../../../engine/player-events";
import { actionOdds, type ActionRequest, type Availability, type Resolution, resolveAction } from "../../../../engine/resolve";
import { createRng } from "../../../../engine/rng";
import { findLeaks, unrevealedSecrets } from "../../../../engine/visibility";
import type { Working } from "../../../../engine/working";
import { inferredOutcome } from "../../../inferred-words";
import type { ToolOutcome } from "../../runtime";
import type { HarnessTurn } from "../harness-turn";
import { missing } from "../propose";
import { checkCall, percent } from "../read/checks";
import type { Secrecy, ToolReadView, ViewRef } from "../read-view";
import { resolvePerson } from "../resolve";
import { actionEnum, argGiven, intArg, integer, jsonObject, objectArg, objectSchema, text, textArg } from "../schema";
import type { HarnessToolDefinition } from "./kit";

const STAKES = HARNESS_TOOL.checksStakes;

/** A check as it is asked for: the action as the engine resolves it, and who takes it. */
export interface Asked {
  request: ActionRequest & { action: ActionDef };
  actor: EntityId;
  /** The open attempt's read as the engine plays it (`resolveTry`); null for an action of the world's. */
  open: JsonObject | null;
}

/** An attempt read and judged, before any dice fall. */
export interface Attempt {
  asked: Asked;
  /** Its odds on the state the call read: what the policy makes of it before anything is rolled. */
  before: Availability;
  policy: AdjudicationDef;
  /** The `judge` step's answer as the call gave it; null when it judged nothing. */
  judgement: Judgement | null;
}

/** An attempt as it was played. */
export interface Played {
  res: Resolution;
  /** What its dice were drawn from (`rollSeed`): what the world's rules that hear of it draw from too. */
  seed: string;
  /** The events that record the attempt itself, apart from anything it did: how the policy decided it, and the roll. */
  record: LedgerEvent[];
}

/**
 * A line of the engine's own as the view gives it (an event in plain words, a pack's telling of a
 * fight). The engine words those for the game master, every name and secret as it is: where the
 * view marks, a line that carries an unrevealed secret's words, or names someone, something or
 * somewhere the player character can't see, is marked as kept from them, as the read tools mark a
 * mind's text (`read/minds.ts`). Made once for a call's lines, inside its read pass.
 */
export function marker(view: ToolReadView): (line: string) => string {
  if (!view.marked) return (line) => line;
  const secrets = unrevealedSecrets(view.registry, view.world, view.state);
  const hidden = hiddenNameCheck(view.registry, view.world, view.state, view.pov);
  const kept: Secrecy = { known: [], kept: [view.name(view.pov)] };
  return (line) => view.mark(line, findLeaks(line, secrets).length > 0 || hidden(line) ? kept : null);
}

/** Everything the turn has recorded so far, in order: what landed, then what is staged and not yet landed. */
export function recorded(turn: HarnessTurn): readonly LedgerEvent[] {
  return [...turn.landed(), ...(turn.staged?.() ?? [])];
}

/** What records a roll made for someone, or how the policy decided an attempt of theirs. */
const ROLLS: readonly string[] = [ENGINE_EVENTS.check, ENGINE_EVENTS.adjudged];

/**
 * What `actor`'s next roll in this turn is drawn from: the turn's seed, who rolls, and how many of
 * their rolls the turn has recorded so far. Nothing an agent says is part of it, so no argument and
 * no wording of an attempt chooses the dice; and since the read shows no roll, the dice an agent has
 * seen are in the record already, and the next roll is another.
 */
export function rollSeed(turn: HarnessTurn, actor: EntityId): string {
  const rolled = recorded(turn).filter((e) => ROLLS.includes(e.type) && "data" in e && e.data.actor === actor).length;
  return hashParts("lre.harness.roll", turn.seed, actor, String(rolled));
}

/**
 * The answer that says `given` holds arguments the action doesn't take (`takes`); null when it takes
 * them all. The engine reads only what an action declares, so a name beside those could only tell
 * one call of an attempt from another call of the same attempt: it is refused, never carried along.
 */
function undeclared(view: ToolReadView, action: string, given: JsonObject, takes: readonly string[]): ToolOutcome | null {
  const extra = Object.keys(given).filter((name) => !takes.includes(name));
  if (extra.length === 0) return null;
  return takes.length > 0 ? view.refuse(PLAY_NOTE.undeclared, { action, given: extra.join(", "), takes: takes.join(", ") }) : view.refuse(PLAY_NOTE.takesNone, { action, given: extra.join(", ") });
}

/** What the open attempt takes: what the engine reads of one (`tryRead`), but whether it is tried, which the call itself says. */
const TRY_PARAMS: readonly string[] = ["skill", "difficulty", "against", "with", "attempt"];

/** The names a list argument of the open attempt gives, each as written: a list, or one text of names between commas. */
function listed(v: JsonValue | undefined): JsonValue[] {
  return Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
}

/**
 * The open attempt a call names (`action: "try"`), as the engine reads one (`tryRead`): its skill and
 * how hard it looks as given, each person it names resolved among those the view may name. The
 * author calling for it is what says the player character tries it, so the read says so.
 */
function openAttempt(view: ToolReadView, tool: string, args: JsonObject): { params: JsonObject } | { refused: ToolOutcome } {
  const given = objectArg(args, "params");
  if (given === null) return { refused: missing(view, tool, "params") };
  const extra = undeclared(view, TRY_ACTION, given, TRY_PARAMS);
  if (extra) return { refused: extra };
  const people: Record<"with" | "against", JsonValue[]> = { with: [], against: [] };
  for (const key of ["with", "against"] as const) {
    for (const item of listed(given[key])) {
      const said = typeof item === "string" ? item.trim() : isRecord(item) && typeof item.who === "string" ? item.who.trim() : "";
      if (said === "") continue;
      const named = resolvePerson(view, said);
      if ("refused" in named) return named;
      // An opponent may resist with a skill of their own: kept beside them, as the read takes it.
      people[key].push(key === "against" && isRecord(item) && typeof item.skill === "string" ? { who: named.id, skill: item.skill } : named.id);
    }
  }
  return { params: { attempt: typeof given.attempt === "string" ? given.attempt : "", skill: typeof given.skill === "string" ? given.skill : "", difficulty: typeof given.difficulty === "string" || typeof given.difficulty === "number" ? given.difficulty : "", with: people.with, against: people.against, tried: true } };
}

/** The check a call of `tool` asks for (`action`, `actor`, `params`): who takes what, before anything says whether it can be tried. Or the answer that says what the call got wrong. */
export function askedOf(view: ToolReadView, tool: string, args: JsonObject): Asked | ToolOutcome {
  const { registry: reg, world, state } = view;
  if (textArg(args, "action") !== TRY_ACTION) {
    const call = checkCall(view, tool, args);
    if (!("action" in call)) return call;
    return undeclared(view, call.action.id, call.params, Object.keys(call.action.params)) ?? { request: { action: call.action, actor: call.actor, params: call.params }, actor: call.actor, open: null };
  }
  const read = openAttempt(view, tool, args);
  if ("refused" in read) return read.refused;
  const { params } = read;
  const policy = inferredOf(world, state);
  const skills = allowedSkills(policy, skillSources(reg, world, state));
  const said = String(params.skill).trim().toLowerCase();
  // A skill the chat doesn't roll is answered with the ones it does, so the next call names one.
  const noSkill = (): ToolOutcome => view.refuse(HARNESS_NOTE.rollSkill, { skill: String(params.skill), skills: skills.map((s) => s.id).join(", "), bands: bandsWithin(policy).map((b) => b.id).join(", ") });
  if (policy.mode !== "off" && !skills.some((s) => s.id.toLowerCase() === said || s.label.toLowerCase() === said)) return noSkill();
  const verdict = inferredRead(reg, world, state, params);
  if (!verdict.ok) return view.refuse(HARNESS_NOTE.rollNoCheck, { why: verdict.why });
  // The read found the skill, so the request has one; should the two ever disagree, it is a skill the chat doesn't roll.
  const request = tryJudged(reg, world, state, verdict.params);
  return request ? { request, actor: world.pov, open: verdict.params } : noSkill();
}

/**
 * The `judge` step's answer as the call gives it: how well the described approach suits the attempt,
 * on the policy's scale, and, where the story decides, each outcome's odds. Null when the call judges
 * nothing, and the dice decide alone.
 */
function judgementOf(view: ToolReadView, args: JsonObject, policy: AdjudicationDef, choices: readonly string[]): { judgement: Judgement | null } | { refused: ToolOutcome } {
  const rated = argGiven(args, "rating");
  const rating = intArg(args, "rating");
  const max = policy.description.max;
  if (rated && (rating === null || rating < 0 || rating > max)) return { refused: view.refuse(HARNESS_NOTE.rollRating, { max: String(max) }) };
  const weighed = argGiven(args, "outcomes");
  const odds = objectArg(args, "outcomes");
  if (weighed) {
    const weights = Object.values(odds ?? {});
    const readable = odds !== null && weights.every((p) => typeof p === "number" && p >= 0 && p <= 1) && choices.some((o) => Number(odds[o]) > 0);
    if (!readable) return { refused: view.refuse(HARNESS_NOTE.rollOutcomes, { outcomes: choices.join(", ") }) };
  }
  if (!rated && !weighed) return { judgement: null };
  return { judgement: { rating: rating ?? 0, reason: textArg(args, "reason") ?? "", ...(odds ? { outcomes: odds as Record<string, number> } : {}) } };
}

/**
 * The attempt `asked` makes with the call's `rating`, `reason` and `outcomes` as its judgement, read
 * on the state the call read; or the answer that says why there is nothing to read or roll: an
 * action that can't be tried as things stand, or a judgement it can't read.
 */
export function attemptOf(view: ToolReadView, asked: Asked, args: JsonObject): Attempt | ToolOutcome {
  const { registry: reg, world, state } = view;
  const { request, actor } = asked;
  const policy = policyFor(world, state, request.action, actor);
  const before = actionOdds(reg, world, state, request);
  if (!before.available) return view.refuse(HARNESS_NOTE.rollUnavailable, { why: before.failed?.reason ?? "" });
  const judged = judgementOf(view, args, policy, outcomeChoices(request.action, Object.keys(before.odds ?? {})));
  return "refused" in judged ? judged.refused : { asked, before, policy, judgement: judged.judgement };
}

/**
 * Plays an attempt on `w` as a turn's action plays (`resolveAction`, or `resolveTry` for the open
 * attempt), with the engine's dice for it. The people in it are given their detail as a turn's action
 * gives it (the same from the same run seed whenever it is made).
 *
 * A roll is recorded as the engine records any check it rolls (`engine.check`). On the old engines
 * the turn's own record keeps the player character's roll; a harness turn has none, and under a
 * policy that keeps no record of an attempt (plain rolling) nothing else would say the dice fell.
 * The world's rules hear what the attempt did, not this record, as they hear no roll of a classic
 * turn's action.
 */
export function playAttempt(w: Working, turn: HarnessTurn, attempt: Attempt): Played {
  const { asked, judgement } = attempt;
  const seed = rollSeed(turn, asked.actor);
  const opts = { runSeed: turn.runSeed, judgement, heard: turn.said.user };
  const res = asked.open ? resolveTry(w.reg, w, asked.open, createRng(seed), opts) : resolveAction(w.reg, w, asked.request, createRng(seed), opts);
  const record = res.events.filter((e) => e.type === ENGINE_EVENTS.adjudged && "data" in e && e.data.actor === res.actor && e.data.action === asked.request.action.id);
  const c = res.check;
  if (res.ok && c) {
    const rolled: LedgerEvent = { type: ENGINE_EVENTS.check, data: { check: c.check.id, actor: res.actor, notation: c.notation, natural: c.natural, total: c.total, dc: c.dc, outcome: res.outcome ?? "", ...(res.actor !== w.world.pov ? { npc: true } : {}) } };
    if (w.apply(rolled) === null) record.push(rolled);
  }
  return { res, seed, record };
}

/** How a played attempt fell, as every tool that rolls one answers it: who tried what, the roll or why there was none, the outcome, and the minutes it takes. `tell` gives a line as the view may have it (`marker`). */
export function rollAnswer(view: ToolReadView, attempt: Attempt, res: Resolution, tell: (line: string) => string): object {
  const { asked, before, policy } = attempt;
  const c = res.check;
  const a = res.adjudged;
  const outcome = res.outcome ?? "";
  const pass = before.verdict?.pass ?? [];
  const shown = checkView(before, policy.retry);
  const roll: JsonObject | null = c ? { dice: c.notation, natural: c.natural, total: c.total, modifier: c.modifier, dc: c.dc, margin: c.margin, ...(c.advantage !== 0 ? { advantage: c.advantage > 0 ? "advantage" : "disadvantage" } : {}) } : null;
  const info = res.inferred;
  return {
    action: { id: asked.request.action.id, label: asked.request.action.label },
    actor: view.entity(asked.actor),
    outcome,
    ...(pass.length > 0 ? { passed: pass.includes(outcome) } : {}),
    rolled: roll !== null,
    // Why the dice didn't roll, in the policy's word and as the Actions sheet words it; an action with no check has nothing to roll.
    ...(roll && c ? { roll, odds: Object.fromEntries(Object.entries(c.odds).map(([o, p]) => [o, percent(p)])) } : { why: a?.why ?? (before.check ? "policy" : "no_check"), ...(shown.detail !== undefined ? { detail: shown.detail } : {}) }),
    ...(a?.approach ? { approach: a.approach } : {}),
    ...(a?.close ? { close: a.close } : {}),
    ...(info ? { difficulty: info.band.id, dc: info.dc, against: info.against.map((o) => ({ name: view.entity(o.who)?.name ?? o.name, rolled: o.rolled, score: o.score })), companions: info.companions.map((o) => ({ name: view.entity(o.who)?.name ?? o.name, outcome: o.outcome, passed: o.pass, total: o.total })), tell: tell(inferredOutcome(res, info)) } : {}),
    minutes: res.duration,
  };
}

/** The people a list of the open attempt's read names (an id, or an opponent with their skill), each as the view names them. */
function peopleOf(view: ToolReadView, v: JsonValue | undefined): ViewRef[] {
  return (Array.isArray(v) ? v : []).flatMap((item) => {
    const ref = typeof item === "string" ? view.entity(item) : isRecord(item) && typeof item.who === "string" ? view.entity(item.who) : null;
    return ref ? [ref] : [];
  });
}

/**
 * An attempt before any dice fall, as `checks_stakes` answers it: who would try what, whether the
 * dice decide it or why not, the exact odds and the check they are of, what the judged approach does
 * to a roll (the policy's shift, in its own terms), the outcomes the story picks from where it
 * decides, and what the action's rules do on each outcome, as the world defines them. Everything in
 * it is read from the state: the same call answers the same, and none of it is a roll.
 */
function stakesAnswer(view: ToolReadView, attempt: Attempt): object {
  const { asked, before, policy, judgement } = attempt;
  const { action } = asked.request;
  const c = before.check;
  const v = before.verdict;
  const shown = checkView(before, policy.retry);
  // The approach shifts only a roll the policy asked for, as the engine applies it (`resolveAction`).
  const shift = v?.roll ? approachShift(policy, judgement) : null;
  const opponent = c?.opponent ? view.entity(c.opponent) : null;
  return {
    action: { id: action.id, label: action.label },
    actor: view.entity(asked.actor),
    rolls: v?.roll === true,
    ...(v ? (v.roll ? {} : { why: v.why, ...(v.outcome !== null ? { outcome: v.outcome } : {}) }) : { why: "no_check" }),
    ...(shown.detail !== undefined ? { detail: shown.detail } : {}),
    ...(before.odds ? { odds: Object.fromEntries(Object.entries(before.odds).map(([o, p]) => [o, percent(p)])) } : {}),
    ...(v && v.pass.length > 0 ? { passes: v.pass } : {}),
    ...(c ? { check: { dice: c.notation, modifier: before.modifier, dc: c.dc, ...(c.advantage !== 0 ? { advantage: c.advantage > 0 ? "advantage" : "disadvantage" } : {}), ...(opponent ? { opponent } : {}) } } : {}),
    ...(judgement ? { approach: { rating: ratingOf(policy, judgement), max: policy.description.max, reason: judgement.reason, ...(shift?.modifier !== undefined ? { bonus: shift.modifier } : {}), ...(shift?.advantage !== undefined ? { advantage: true } : {}), ...(shift?.dc !== undefined ? { easier: shift.dc } : {}) } } : {}),
    ...(v?.why === "story" ? { choices: outcomeChoices(action, Object.keys(before.odds ?? {})) } : {}),
    ...(asked.open ? { difficulty: String(asked.open.difficulty), against: peopleOf(view, asked.open.against), with: peopleOf(view, asked.open.with) } : {}),
    stakes: action.outcomes,
    minutes: before.duration,
  };
}

/** The action ids a call may name: the world's, as its other tools list them, and the open attempt; none where the world has too many to list. */
function actionIds(world: WorldDoc): string[] {
  const ids = actionEnum(world);
  return ids.length > 0 && !ids.includes(TRY_ACTION) ? [...ids, TRY_ACTION] : ids;
}

/** The arguments an attempt is named by, as `checks_stakes` takes them, each node its own; the world's action ids filled in. */
export function attemptProperties(world: WorldDoc): Record<"action" | "actor" | "params" | "rating" | "reason" | "outcomes", JsonObject> {
  return { action: text(actionIds(world)), actor: text(), params: jsonObject(), rating: integer({ minimum: 0 }), reason: text(), outcomes: jsonObject() };
}

export const CHECK_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: STAKES,
    family: HARNESS_FAMILY.checks,
    tier: "read",
    parameters: (world) => objectSchema(attemptProperties(world), ["action"]),
    async run(args, env) {
      const view = await env.reader.view();
      return view.read(() => {
        const asked = askedOf(view, STAKES, args);
        if (!("request" in asked)) return asked;
        const attempt = attemptOf(view, asked, args);
        return "asked" in attempt ? view.answer({ ...stakesAnswer(view, attempt), note: view.text(HARNESS_NOTE.stakesNote) }) : attempt;
      });
    },
  },
];
