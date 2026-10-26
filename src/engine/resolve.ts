// Action resolution (DESIGN §3 Actions, §11): parameters, requirements, then the check, then the
// outcome's effects, then the duration and any activity the action starts. The check is the one
// check mechanism (engine/checks): the palette's odds (`actionOdds`) and the roll read the same
// ready check, so shown odds are the real odds. Outcome effects see the roll as `roll.*`. The
// adjudication policy (engine/adjudication) decides whether the check rolls at all, what the
// player's judged approach adds, and who settles it; the palette shows the same verdict.

import type { JsonObject, JsonValue } from "../shared/json";
import type { ActionId, EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import { heldBy } from "../shared/finance";
import { spanRecords, type ActionDef, type CheckDef, type EffectSpec, type Expr, type WorldDoc } from "../shared/world";
import { tableRowKey } from "../shared/tables";
import { plainRolling } from "../shared/adjudication";
import { approachShift, closeCall, fightRound, judgedOutcome, oddsSignature, outcomeChoices, passOutcome, policyFor, ratingOf, tryKey, verdictOf, type Adjudged, type Judgement, type Verdict } from "./adjudication";
import { checkCounts, checkOdds, checkOf, oddsOf, readyCheck, rollCheck, rollVars, type CheckRoll } from "./checks";
import { ENGINE_EVENTS } from "./engine-pack";
import { applyEffects } from "./effects";
import type { EnvVars, ExprEnv, Value } from "./expr";
import { materializeAll } from "./materialize";
import type { ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import { evalExpr, isGone, kindIs, placeOfEntity, scopeEnv, toValue, truthy } from "./scope";
import { selectorMatches } from "./selector";
import type { WorldState } from "./state";
import { Working } from "./working";
import { canSeeEntity, canSeePlace } from "./visibility";
import { povMayKnow } from "./player-events";
import { acts } from "./life";
import { together } from "./presence";
import { labelOf, optionalService, own } from "./pack-kit";
import type { InferredResult } from "./inferred";
import type { ToldAction } from "./action-words";

export interface ActionRequest {
  action: ActionId | ActionDef;
  /** Defaults to the POV. */
  actor?: EntityId;
  params?: JsonObject;
  /** What the check and outcomes read beside the params, and outside the key a retry rule knows the attempt by: an inferred check's difficulty, which an opponent's new roll sets (DESIGN §11). */
  vars?: EnvVars;
}

export interface CheckResult extends CheckRoll {
  check: CheckDef;
  /** The notation rolled: advantage applied, an opponent's roll subtracted. */
  notation: string;
  modifier: number;
  advantage: -1 | 0 | 1;
  dc: number | null;
  /** Exact probability of each outcome, as shown. */
  odds: Record<string, number>;
}

export interface Resolution {
  action: ActionId;
  actor: EntityId;
  ok: boolean;
  /** Why the action could not run: a bad parameter or the first unmet requirement. */
  failed: { code: string; reason: string; requirement?: Expr } | null;
  check: CheckResult | null;
  outcome: string | null;
  /** Everything this resolution applied: materialization first, then effects, then the activity. */
  events: LedgerEvent[];
  rejected: { effect: EffectSpec; rejection: Rejection }[];
  /** Minutes the action takes. */
  duration: number;
  activity: { type: string; until: number } | null;
  observable: string | null;
  /** How the adjudication policy decided the check; null without a check or under a plain-rolling policy. */
  adjudged: Adjudged | null;
  /**
   * The thing the player said they had, made real for this action as one of a turn's (DESIGN §9.4
   * player claims; set by the plan): its entity and name, and what its Undo takes back: its making,
   * the action's own events and the rules they fired.
   */
  claimed?: { entity: EntityId; name: string; events: LedgerEvent[] };
  /** An inferred check's people and wording (DESIGN §11), when the action was Try something: the plan's, never recorded. */
  inferred?: InferredResult;
  /** The action as the narrator is told it (`toldAction`): set by the turn's plan once the turn has played, never recorded. */
  told?: ToldAction;
}

export function findAction(reg: Registry, world: WorldDoc, id: ActionId): ActionDef | undefined {
  return own(world.actions, id) ?? reg.actions.get(id);
}

interface Prepared {
  action: ActionDef;
  actor: EntityId;
  bindings: Record<string, EntityId>;
  vars: EnvVars;
  params: Record<string, Value>;
}

function prepare(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, req: ActionRequest): Prepared | Rejection {
  const action = typeof req.action === "string" ? findAction(reg, world, req.action) : req.action;
  if (!action) return { code: "unknown_action", reason: `no action ${String(req.action)}` };
  const actor = req.actor ?? world.pov;
  if (!own(state.entities, actor)) return { code: "missing_actor", reason: `no entity ${labelOf({ world, state }, actor)}` };
  const bindings: Record<string, EntityId> = { self: actor, actor };
  const params: Record<string, Value> = {};
  const given = req.params ?? {};
  for (const [name, def] of Object.entries(action.params)) {
    const raw: JsonValue | undefined = own(given, name);
    if (raw === undefined || raw === null || raw === "") {
      if (!def.optional) return { code: "missing_param", reason: `${action.label} needs ${def.label ?? name}` };
      continue;
    }
    if (def.type === "ref") {
      const id = String(raw);
      const target = own(state.entities, id);
      if (!target) {
        if (own(world.places, id)) {
          params[name] = id;
          continue;
        }
        return { code: "bad_param", reason: `no entity ${labelOf({ world, state }, id)}` };
      }
      if (def.ref && !kindIs(reg, world, target.kind, def.ref)) return { code: "bad_param", reason: `${target.name} is not ${/^[aeiou]/i.test(def.ref) ? "an" : "a"} ${(reg.kinds.get(def.ref)?.label ?? own(world.kinds, def.ref)?.label ?? def.ref).toLowerCase()}` };
      if (def.of && !selectorMatches(reg, world, state, def.of, id)) return { code: "bad_param", reason: `${target.name} can't be the ${(def.label ?? name).replace(/_/g, " ").toLowerCase()} of ${action.label}` };
      bindings[name] = id;
      params[name] = id;
      continue;
    }
    // A list of refs (Go's `with`): the ones who may come along (`companionCandidates`: in the actor's
    // scene, seen by it, acting), kept as their ids joined by commas, the one scalar form an effect's
    // argument can carry. Anyone else simply doesn't come, and isn't named in a refusal, since the
    // actor may not know of them.
    if (def.type === "list" && def.ref) {
      const may = new Set(companionCandidates(reg, world, state, action, name, actor));
      const ids = (Array.isArray(raw) ? raw : String(raw).split(",")).map((x) => String(x).trim()).filter((x) => may.has(x));
      if (ids.length > 0) params[name] = [...new Set(ids)].join(",");
      continue;
    }
    // A text param naming a table row (a skill, a save) takes the row's id or its label, and keeps the id.
    if (def.type === "text" && def.table !== undefined) {
      const key = typeof raw === "string" ? tableRowKey(own(world.tables, def.table), raw) : null;
      if (key === null) return { code: "bad_param", reason: `${String(raw)} isn't one of the ${(def.label ?? name).toLowerCase()}s here` };
      params[name] = key;
      continue;
    }
    if ((def.type === "number" || def.type === "money" || def.type === "duration") && typeof raw !== "number") return { code: "bad_param", reason: `${name} must be a number` };
    const v = toValue(raw);
    if (v === undefined) return { code: "bad_param", reason: `${name} must be a scalar` };
    params[name] = v;
  }
  // Ref params resolve through their bindings (`target.cash`); only scalars are top-level names. An
  // absent optional param reads 0 by its bare name and null as `params.<name>`, so an outcome can
  // tell "not given" from a given 0.
  const scalars = Object.fromEntries(Object.entries(params).filter(([name]) => !Object.prototype.hasOwnProperty.call(bindings, name)));
  const absent = Object.fromEntries(Object.keys(action.params).filter((name) => !(name in params)).map((name): [string, Value] => [name, null]));
  const extra = req.vars ?? {};
  const more = typeof extra.params === "object" && extra.params !== null ? extra.params : {};
  const vars: Record<string, Value | EnvVars> = { ...scalars, ...extra, params: { ...absent, ...params, ...more } };
  return { action, actor, bindings, vars, params };
}

function firstUnmet(action: ActionDef, env: ExprEnv): Expr | null {
  for (const req of action.requires) if (!truthy(evalExpr(req, env, false))) return req;
  return null;
}

export interface Availability {
  available: boolean;
  failed: { code: string; reason: string; requirement?: Expr } | null;
  odds: Record<string, number> | null;
  modifier: number;
  /** How the check would roll (its notation, advantage, DC and opponent), when the action has one. */
  check: { notation: string; advantage: -1 | 0 | 1; dc: number | null; opponent: EntityId | null } | null;
  duration: number;
  /** What the adjudication policy makes of the check before it is taken (no roll, too hard, the story decides). */
  verdict: Verdict | null;
}

/**
 * What a combat action costs its actor now, as events, or why it can't be taken (the combat pack,
 * DESIGN §11): its fight's state, the actor's turn and economy. Nothing for any other action.
 */
function combatSpend(ctx: ReadContext, actor: EntityId, action: ActionDef): LedgerEvent[] | Rejection {
  return action.combat ? (optionalService(ctx, "combat.spend")?.(ctx, actor, action) ?? { code: "no_combat", reason: "this world has no combat" }) : [];
}

/** What the palette shows: availability, exact odds and duration, against the current state. */
export function actionOdds(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, req: ActionRequest): Availability {
  const p = prepare(reg, world, state, req);
  if ("code" in p) return { available: false, failed: p, odds: null, modifier: 0, check: null, duration: 0, verdict: null };
  const ctx = reg.context(world, state);
  const env = scopeEnv({ reg, ctx, bindings: p.bindings, vars: p.vars });
  const unmet = firstUnmet(p.action, env);
  const def = checkOf(world, p.action.check);
  const ready = def ? readyCheck(reg, ctx, def, p.bindings, p.vars) : null;
  const usable = ready && !("code" in ready) ? ready : null;
  const counts = usable ? checkCounts(usable) : null;
  const odds = counts ? oddsOf(counts) : null;
  const spend = combatSpend(ctx, p.actor, p.action);
  const refused = Array.isArray(spend) ? null : spend;
  return {
    available: unmet === null && refused === null && usable === ready,
    failed: unmet !== null ? { code: "requirement", reason: `requires ${unmet}`, requirement: unmet } : (refused ?? (ready && "code" in ready ? ready : null)),
    odds,
    modifier: usable?.modifier ?? 0,
    check: usable ? { notation: usable.notation, advantage: usable.advantage, dc: usable.dc, opponent: usable.opponent } : null,
    duration: Math.max(0, Math.round(Number(evalExpr(p.action.duration, env, 0)) || 0)),
    verdict: usable && counts ? verdictOf(policyFor(world, state, p.action, p.actor), { registry: reg, world, state, action: p.action, actor: p.actor, params: p.params, ready: usable, counts }) : null,
  };
}

export interface ResolveOptions {
  /** Enables in-turn materialization of the actor and entity parameters (DESIGN §9.2). */
  runSeed?: string;
  /** The turn's recorded `judge` answer (DESIGN §11): the approach's rating, and the story's odds under narrative authority. */
  judgement?: Judgement | null;
}

/**
 * Resolves an action into the working state. Materialization of the participants is recorded ahead
 * of the effects; a failed requirement applies nothing else.
 */
export function resolveAction(reg: Registry, w: Working, req: ActionRequest, rng: Rng, opts: ResolveOptions = {}): Resolution {
  const start = w.events.length;
  const actionId = typeof req.action === "string" ? req.action : req.action.id;
  const p = prepare(reg, w.world, w.state, req);
  const base: Resolution = {
    action: actionId,
    actor: req.actor ?? w.world.pov,
    ok: false,
    failed: null,
    check: null,
    outcome: null,
    events: [],
    rejected: [],
    duration: 0,
    activity: null,
    observable: null,
    adjudged: null,
  };
  if ("code" in p) return { ...base, failed: p };

  if (opts.runSeed !== undefined) {
    const participants = [p.actor, ...Object.values(p.bindings)].filter((id, i, all) => all.indexOf(id) === i);
    for (const id of participants) materializeAll(reg, w, id, opts.runSeed);
  }

  const env = scopeEnv({ reg, ctx: w.ctx, bindings: p.bindings, vars: p.vars });
  const unmet = firstUnmet(p.action, env);
  if (unmet !== null) return { ...base, actor: p.actor, failed: { code: "requirement", reason: `requires ${unmet}`, requirement: unmet }, events: w.events.slice(start) };

  // The plan is read from the state before the action: its duration and activity span.
  const duration = Math.max(0, Math.round(Number(evalExpr(p.action.duration, env, 0)) || 0));
  let activity: Resolution["activity"] = null;
  if (p.action.activity) {
    const until = Number(evalExpr(p.action.activity.until, env, w.state.clock + duration));
    activity = { type: p.action.activity.type, until: Math.max(w.state.clock, Math.round(Number.isFinite(until) ? until : w.state.clock + duration)) };
  }

  const checkDef = checkOf(w.world, p.action.check);
  const ready = checkDef ? readyCheck(reg, w.ctx, checkDef, p.bindings, p.vars) : null;
  if (ready && "code" in ready) return { ...base, actor: p.actor, failed: ready, events: w.events.slice(start) };
  // A combat action spends its cost before it rolls, so a miss uses it up too.
  const spend = combatSpend(w.ctx, p.actor, p.action);
  const refused = Array.isArray(spend) ? (spend.map((ev) => w.apply(ev)).find((r) => r !== null) ?? null) : spend;
  if (refused) return { ...base, actor: p.actor, failed: refused, events: w.events.slice(start) };
  let check: CheckResult | null = null;
  let outcome: string;
  let vars = p.vars;
  let adjudged: Adjudged | null = null;
  if (checkDef && ready) {
    const counts = checkCounts(ready);
    const odds = oddsOf(counts);
    const policy = policyFor(w.world, w.state, p.action, p.actor);
    const verdict = verdictOf(policy, { registry: reg, world: w.world, state: w.state, action: p.action, actor: p.actor, params: p.params, ready, counts });
    const judgement = opts.judgement ?? null;
    const place = placeOfEntity(w.state, p.actor);
    let close: Adjudged["close"] = null;
    // Under narrative authority the story picks the outcome from the judge's odds. Without them (the
    // judge off, out of calls or failed, and always for an NPC, which no judge reads) the dice decide,
    // as the palette's odds showed: an unjudged risky check never just succeeds.
    const story = verdict.why === "story" ? judgedOutcome(judgement, outcomeChoices(p.action, Object.keys(odds)), rng.fork("judge")) : null;
    const rolls = verdict.roll || (verdict.why === "story" && story === null);
    const why = rolls ? null : verdict.why;
    if (rolls) {
      // The judged approach shifts only a roll the policy asked for (the verdict above read the check
      // as the palette showed it); a story check the dice took over rolls plainly.
      const shift = verdict.roll ? approachShift(policy, judgement) : null;
      const shifted = shift ? readyCheck(reg, w.ctx, checkDef, p.bindings, p.vars, shift) : ready;
      const rolling = "code" in shifted ? ready : shifted;
      const rolled = rollCheck(rolling, rng.fork("check"));
      check = { ...rolled, check: checkDef, notation: rolling.notation, modifier: rolling.modifier, advantage: rolling.advantage, dc: rolling.dc, odds: rolling === ready ? odds : checkOdds(rolling) };
      outcome = rolled.outcome;
      vars = { ...p.vars, roll: rollVars(rolling, rolled) };
      if (policy.authority === "hybrid") close = closeCall(rolling, rolled, rolled.outcome, policy.closeBy);
    } else {
      outcome = story ?? verdict.outcome ?? passOutcome(p.action, ready, counts, verdict.pass);
      vars = { ...p.vars, roll: { natural: null, total: null, modifier: ready.modifier, dc: ready.dc, margin: null, outcome } };
    }
    if (!plainRolling(policy)) {
      const approach = judgement && (policy.authority === "narrative" ? why === "story" : verdict.roll && policy.description.weight !== "none") ? { rating: ratingOf(policy, judgement), max: policy.description.max, reason: judgement.reason } : null;
      adjudged = { rolled: rolls, why, chance: verdict.chance, pass: verdict.pass, authority: policy.authority, retry: policy.retry, approach, close };
      // A refused retry is no new attempt: the wait a retry rule counts runs from the failed roll.
      const tracked = policy.retry !== "free" && verdict.pass.length > 0 && verdict.why !== "retry";
      const round = tracked ? fightRound(w.ctx) : null;
      w.apply({
        type: ENGINE_EVENTS.adjudged,
        data: {
          actor: p.actor,
          action: p.action.id,
          check: checkDef.id ?? "",
          outcome,
          rolled: rolls,
          ...(why ? { why } : {}),
          ...(approach ? { rating: approach.rating, max: approach.max, reason: approach.reason.slice(0, 240) } : {}),
          ...(close ? { close: close.outcome } : {}),
          ...(tracked ? { key: tryKey(p.actor, p.action.id, p.params), place, failed: !verdict.pass.includes(outcome), odds: oddsSignature(ready), ...(round !== null ? { round } : {}) } : {}),
        },
      });
    }
  } else {
    outcome = Object.prototype.hasOwnProperty.call(p.action.outcomes, "default") ? "default" : (Object.keys(p.action.outcomes)[0] ?? "default");
  }

  const effects = own(p.action.outcomes, outcome) ?? [];
  const result = applyEffects(reg, w, effects, { bindings: p.bindings, vars, params: p.params, rng: rng.fork("effects") });

  if (activity) {
    w.apply({ type: "set", entity: p.actor, field: "activity", value: activity.type });
    w.apply({ type: "set", entity: p.actor, field: "activity_until", value: activity.until });
    // What it was given for and where it began: another activity, or a move, ends it (`activitySpanEnd`).
    w.applyAll(spanRecords(p.actor, own(w.state.entities, p.actor)?.fields));
  }
  return {
    ...base,
    actor: p.actor,
    ok: true,
    check,
    outcome,
    events: w.events.slice(start),
    rejected: result.rejected,
    duration,
    activity,
    observable: p.action.observable ?? null,
    adjudged,
  };
}

/** Convenience for callers without a working state: resolves against a copy of `state`. */
export function resolveOn(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, req: ActionRequest, rng: Rng, opts: ResolveOptions = {}): { resolution: Resolution; state: WorldState } {
  const w = new Working(reg, world, state);
  const resolution = resolveAction(reg, w, req, rng, opts);
  return { resolution, state: w.state };
}

/**
 * What can fill a ref parameter. A `place` ref offers the places the actor may see (`placeCandidates`);
 * any other ref offers entities of the right kind that the param's selector (`of`) matches and the
 * actor may see, at the actor's place or held by the actor.
 */
export function paramCandidates(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, param: string, actor: EntityId = world.pov): EntityId[] {
  const def = own(action.params, param);
  if (!def || def.type !== "ref") return [];
  const here = placeOfEntity(state, actor);
  if (def.ref === "place") return placeCandidates(reg, world, state, actor);
  const filters = candidateFilters(action, param);
  const ctx = filters.length > 0 ? reg.context(world, state) : null;
  const out: EntityId[] = [];
  for (const id of Object.keys(state.entities).sort()) {
    if (id === actor) continue;
    const e = own(state.entities, id);
    if (!e || isGone(state, id)) continue;
    if (def.ref && !kindIs(reg, world, e.kind, def.ref)) continue;
    if (def.of && !selectorMatches(reg, world, state, def.of, id)) continue;
    if (placeOfEntity(state, id) !== here && !e.relations.some((r) => r.to === actor) && !heldBy(state.entities, id, actor)) continue;
    if (!canSeeEntity(reg, world, state, actor, id)) continue;
    if (ctx && !filters.every((f) => truthy(evalExpr(f, scopeEnv({ reg, ctx, bindings: { self: actor, [param]: id } }), false)))) continue;
    out.push(id);
  }
  return out;
}

/**
 * Who may come along on a list-of-refs param (Go's `with`): people of its kind in the actor's scene
 * (`together`, so a room's people and its building's alike) whom it can see and who act, in id
 * order; for the player character, only those it may be told of (`povMayKnow`), so a stranger in a
 * room inside its place, whom Scene → Present withholds, is never named. The palette's With
 * picker, interpret's catalog and Go itself take the same people.
 */
export function companionCandidates(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, param: string, actor: EntityId = world.pov): EntityId[] {
  const def = own(action.params, param);
  if (!def || def.type !== "list" || def.ref === undefined) return [];
  const ref = def.ref;
  const here = placeOfEntity(state, actor);
  return Object.keys(state.entities)
    .sort()
    .filter((id) => {
      const e = own(state.entities, id);
      return !!e && id !== actor && kindIs(reg, world, e.kind, ref) && (!def.of || selectorMatches(reg, world, state, def.of, id)) && !isGone(state, id) && acts(world, state, id) && together(world, here, placeOfEntity(state, id)) && canSeeEntity(reg, world, state, actor, id) && (actor !== world.pov || povMayKnow(reg, world, state, id));
    });
}

/** The places the actor may see besides its own, nearest first (joined to here by a route, or here's parent or a child), then by name. */
export function placeCandidates(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, actor: EntityId = world.pov): string[] {
  const here = placeOfEntity(state, actor);
  const near = new Set(Object.values(world.routes).flatMap((r) => (r.from === here ? [r.to] : r.to === here && r.bidirectional ? [r.from] : [])));
  const parent = here ? own(world.places, here)?.parent : undefined;
  if (parent) near.add(parent);
  for (const p of Object.values(world.places)) if (here && p.parent === here) near.add(p.id);
  const name = (id: string): string => own(world.places, id)?.name ?? id;
  return Object.keys(world.places)
    .filter((id) => id !== here && canSeePlace(reg, world, state, actor, id))
    .sort((a, b) => Number(near.has(b)) - Number(near.has(a)) || name(a).localeCompare(name(b)));
}

const EXPR_WORDS = new Set(["and", "or", "not", "true", "false", "null", "self"]);

/**
 * The action's requirements about the candidate alone: they read only the candidate (its fields,
 * or calls on it like `invited(host)` or `carries(self, item)`) and `self`. A candidate failing one
 * can never fill the param, so it isn't offered (Accept invitation offers only the hosts who
 * invited you). Requirements that read anything else (`at(to, here)`) stay availability.
 */
function candidateFilters(action: ActionDef, param: string): Expr[] {
  const named = new RegExp(`(?<![\\w.])${param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return action.requires.filter((req) => {
    const bare = req.replace(/'[^']*'|"[^"]*"/g, "''");
    if (!named.test(bare)) return false;
    for (const m of bare.matchAll(/(\.?)\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g)) {
      const [, dot, name, call] = m;
      if (call || dot === ".") continue;
      if (name !== param && !EXPR_WORDS.has(name ?? "")) return false;
    }
    return true;
  });
}
