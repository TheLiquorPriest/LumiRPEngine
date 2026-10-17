// Action resolution (DESIGN §3 Actions, §11): parameters, requirements, then the check, then the
// outcome's effects, then the duration and any activity the action starts. The check is the one
// check mechanism (engine/checks): the palette's odds (`actionOdds`) and the roll read the same
// ready check, so shown odds are the real odds. Outcome effects see the roll as `roll.*`.

import type { JsonObject, JsonValue } from "../shared/json";
import type { ActionId, EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { ActionDef, CheckDef, EffectSpec, Expr, WorldDoc } from "../shared/world";
import { checkOdds, checkOf, readyCheck, rollCheck, rollVars, type CheckRoll } from "./checks";
import { applyEffects } from "./effects";
import type { EnvVars, ExprEnv, Value } from "./expr";
import { materializeAll } from "./materialize";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import { evalExpr, isGone, kindIs, placeOfEntity, scopeEnv, toValue, truthy } from "./scope";
import { selectorMatches } from "./selector";
import type { WorldState } from "./state";
import { Working } from "./working";
import { canSeeEntity, canSeePlace } from "./visibility";
import { labelOf, own } from "./pack-kit";

export interface ActionRequest {
  action: ActionId | ActionDef;
  /** Defaults to the POV. */
  actor?: EntityId;
  params?: JsonObject;
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
  const vars: Record<string, Value | EnvVars> = { ...scalars, params: { ...absent, ...params } };
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
}

/** What the palette shows: availability, exact odds and duration, against the current state. */
export function actionOdds(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, req: ActionRequest): Availability {
  const p = prepare(reg, world, state, req);
  if ("code" in p) return { available: false, failed: p, odds: null, modifier: 0, check: null, duration: 0 };
  const ctx = reg.context(world, state);
  const env = scopeEnv({ reg, ctx, bindings: p.bindings, vars: p.vars });
  const unmet = firstUnmet(p.action, env);
  const def = checkOf(world, p.action.check);
  const ready = def ? readyCheck(reg, ctx, def, p.bindings, p.vars) : null;
  const usable = ready && !("code" in ready) ? ready : null;
  return {
    available: unmet === null && usable === ready,
    failed: unmet !== null ? { code: "requirement", reason: `requires ${unmet}`, requirement: unmet } : ready && "code" in ready ? ready : null,
    odds: usable ? checkOdds(usable) : null,
    modifier: usable?.modifier ?? 0,
    check: usable ? { notation: usable.notation, advantage: usable.advantage, dc: usable.dc, opponent: usable.opponent } : null,
    duration: Math.max(0, Math.round(Number(evalExpr(p.action.duration, env, 0)) || 0)),
  };
}

export interface ResolveOptions {
  /** Enables in-turn materialization of the actor and entity parameters (DESIGN §9.2). */
  runSeed?: string;
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
  let check: CheckResult | null = null;
  let outcome: string;
  let vars = p.vars;
  if (checkDef) {
    const ready = readyCheck(reg, w.ctx, checkDef, p.bindings, p.vars);
    if ("code" in ready) return { ...base, actor: p.actor, failed: ready, events: w.events.slice(start) };
    const rolled = rollCheck(ready, rng.fork("check"));
    check = { ...rolled, check: checkDef, notation: ready.notation, modifier: ready.modifier, advantage: ready.advantage, dc: ready.dc, odds: checkOdds(ready) };
    outcome = rolled.outcome;
    vars = { ...p.vars, roll: rollVars(ready, rolled) };
  } else {
    outcome = Object.prototype.hasOwnProperty.call(p.action.outcomes, "default") ? "default" : (Object.keys(p.action.outcomes)[0] ?? "default");
  }

  const effects = own(p.action.outcomes, outcome) ?? [];
  const result = applyEffects(reg, w, effects, { bindings: p.bindings, vars, params: p.params, rng: rng.fork("effects") });

  if (activity) {
    w.apply({ type: "set", entity: p.actor, field: "activity", value: activity.type });
    w.apply({ type: "set", entity: p.actor, field: "activity_until", value: activity.until });
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
  };
}

/** Convenience for callers without a working state: resolves against a copy of `state`. */
export function resolveOn(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, req: ActionRequest, rng: Rng, opts: ResolveOptions = {}): { resolution: Resolution; state: WorldState } {
  const w = new Working(reg, world, state);
  const resolution = resolveAction(reg, w, req, rng, opts);
  return { resolution, state: w.state };
}

/**
 * What can fill a ref parameter. A `place` ref offers the places the actor may see, nearest first
 * (joined to here by a route, or the place's parent or a child); any other ref offers entities of
 * the right kind that the param's selector (`of`) matches and the actor may see, at the actor's place or held by the actor.
 */
export function paramCandidates(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, param: string, actor: EntityId = world.pov): EntityId[] {
  const def = own(action.params, param);
  if (!def || def.type !== "ref") return [];
  const here = placeOfEntity(state, actor);
  if (def.ref === "place") {
    const near = new Set(Object.values(world.routes).flatMap((r) => (r.from === here ? [r.to] : r.to === here && r.bidirectional ? [r.from] : [])));
    const parent = here ? own(world.places, here)?.parent : undefined;
    if (parent) near.add(parent);
    for (const p of Object.values(world.places)) if (here && p.parent === here) near.add(p.id);
    const name = (id: string): string => own(world.places, id)?.name ?? id;
    return Object.keys(world.places)
      .filter((id) => id !== here && canSeePlace(reg, world, state, actor, id))
      .sort((a, b) => Number(near.has(b)) - Number(near.has(a)) || name(a).localeCompare(name(b)));
  }
  const filters = candidateFilters(action, param);
  const ctx = filters.length > 0 ? reg.context(world, state) : null;
  const out: EntityId[] = [];
  for (const id of Object.keys(state.entities).sort()) {
    if (id === actor) continue;
    const e = own(state.entities, id);
    if (!e || isGone(state, id)) continue;
    if (def.ref && !kindIs(reg, world, e.kind, def.ref)) continue;
    if (def.of && !selectorMatches(reg, world, state, def.of, id)) continue;
    if (placeOfEntity(state, id) !== here && !e.relations.some((r) => r.to === actor) && e.fields.owner !== actor) continue;
    if (!canSeeEntity(reg, world, state, actor, id)) continue;
    if (ctx && !filters.every((f) => truthy(evalExpr(f, scopeEnv({ reg, ctx, bindings: { self: actor, [param]: id } }), false)))) continue;
    out.push(id);
  }
  return out;
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
