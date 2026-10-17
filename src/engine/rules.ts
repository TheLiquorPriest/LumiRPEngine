// Rules (DESIGN §3, §10): `on <event | tick | place entry | time> when <predicate> do <effects>`,
// with `once`, `cooldown`, a cascade cap of 8 and storylet beats. Data only: the predicate and
// the effect arguments are formulas. A rule's firing is recorded (`engine.fired`) before its
// effects, so `once` and cooldowns hold on re-fold and inside its own cascade.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { hashParts } from "../shared/hash";
import type { EntityId, RuleId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { EffectSpec, RuleDef, WorldDoc } from "../shared/world";
import { applyEffects } from "./effects";
import { ENGINE_EVENTS, readEngineSlice } from "./engine-pack";
import type { EnvVars, Value } from "./expr";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { createRng } from "./rng";
import { evalExpr, placeWithin, scopeEnv, toValue, truthy } from "./scope";
import { own } from "./pack-kit";
import type { Working } from "./working";

export const CASCADE_CAP = 8;
/** Firings per pass, whatever the depth: a runaway set of rules stops here with a note. */
export const FIRING_CAP = 256;

export type RuleTick = "turn" | "slot" | "day";

export interface RuleFiring {
  rule: RuleId;
  depth: number;
  beat: { hint: string; weight: number } | null;
  interrupt: boolean;
  events: LedgerEvent[];
  rejected: { effect: EffectSpec; rejection: Rejection }[];
}

export interface RuleOptions {
  /** Base seed for effect randomness (the turn's action seed or a process seed). */
  seed: string;
  cascadeCap?: number;
}

/** World rules (by id) then pack rules (registration order); a world rule overrides a pack rule with its id. */
export function allRules(reg: Registry, world: WorldDoc): RuleDef[] {
  const out = Object.keys(world.rules)
    .sort()
    .map((id) => world.rules[id])
    .filter((r): r is RuleDef => r !== undefined);
  for (const r of reg.rules) if (!world.rules[r.id]) out.push(r);
  return out;
}

/** The entity an event is about, bound as `self` for its rules. */
export function eventSubject(e: LedgerEvent): EntityId | null {
  switch (e.type) {
    case "set":
    case "add":
      return e.entity;
    case "link":
    case "unlink":
      return e.from;
    case "spawn":
      return e.entity.id;
    case "materialize":
      return e.entity;
    default: {
      if ("data" in e && isRecord(e.data)) {
        const d = e.data as JsonObject;
        for (const key of ["entity", "agent", "actor", "from"]) if (typeof d[key] === "string") return d[key] as string;
      }
      return null;
    }
  }
}

/** The event as formula variables: `event.type`, `event.field`, `event.value`, `event.data.x`, … */
export function eventVars(e: LedgerEvent): EnvVars {
  const out: Record<string, Value | EnvVars> = { type: e.type };
  for (const [k, v] of Object.entries(e)) {
    if (k === "type") continue;
    const scalar = toValue(v as JsonValue);
    if (scalar !== undefined) out[k] = scalar;
    else if (isRecord(v)) {
      const nested: Record<string, Value> = {};
      for (const [nk, nv] of Object.entries(v as JsonObject)) {
        const s = toValue(nv);
        if (s !== undefined) nested[nk] = s;
      }
      out[k] = nested;
    }
  }
  return out;
}

function eligible(w: Working, rule: RuleDef): boolean {
  const fired = own(readEngineSlice(w.state).fired, rule.id);
  if (!fired) return true;
  if (rule.once) return false;
  if (rule.cooldownMinutes !== undefined && w.state.clock - fired.last < rule.cooldownMinutes) return false;
  return true;
}

interface Pending {
  rule: RuleDef;
  depth: number;
  self: EntityId | null;
  vars: EnvVars;
}

function fire(reg: Registry, w: Working, p: Pending, opts: RuleOptions): RuleFiring | null {
  const bindings: Record<string, EntityId> = p.self ? { self: p.self } : {};
  const env = scopeEnv({ reg, ctx: w.ctx, bindings, vars: p.vars });
  if (!eligible(w, p.rule)) return null;
  if (p.rule.when !== undefined && !truthy(evalExpr(p.rule.when, env, false))) return null;
  const count = own(readEngineSlice(w.state).fired, p.rule.id)?.n ?? 0;
  const start = w.events.length;
  if (w.apply({ type: ENGINE_EVENTS.fired, data: { rule: p.rule.id } })) return null;
  const rng = createRng(hashParts(opts.seed, "rule", p.rule.id, w.state.clock, count));
  const result = applyEffects(reg, w, p.rule.do, { bindings, vars: p.vars, rng });
  if (p.rule.interrupt) w.apply({ type: ENGINE_EVENTS.signal, data: { class: "rule", text: p.rule.beat?.hint ?? p.rule.id } });
  if (p.rule.beat) w.apply({ type: ENGINE_EVENTS.beat, data: { hint: p.rule.beat.hint, rule: p.rule.id, weight: p.rule.beat.weight ?? 1 } });
  return {
    rule: p.rule.id,
    depth: p.depth,
    beat: p.rule.beat ? { hint: p.rule.beat.hint, weight: p.rule.beat.weight ?? 1 } : null,
    interrupt: p.rule.interrupt === true,
    events: w.events.slice(start),
    rejected: result.rejected,
  };
}

function matchesEvent(world: WorldDoc, rule: RuleDef, e: LedgerEvent): boolean {
  const on = rule.on;
  if ("event" in on) return on.event === e.type;
  if ("enter" in on) return e.type === "set" && e.field === "place" && typeof e.value === "string" && placeWithin(world, e.value, on.enter);
  return false;
}

/** Runs a breadth-first cascade: events at depth d trigger rules at depth d; their events feed depth d + 1. */
function cascade(reg: Registry, w: Working, roots: Pending[], opts: RuleOptions): RuleFiring[] {
  const cap = opts.cascadeCap ?? CASCADE_CAP;
  const rules = allRules(reg, w.world);
  const firings: RuleFiring[] = [];
  let queue = roots;
  let capped = false;
  while (queue.length > 0) {
    const next: Pending[] = [];
    for (const p of queue) {
      if (firings.length >= FIRING_CAP) {
        capped = true;
        break;
      }
      const f = fire(reg, w, p, opts);
      if (!f) continue;
      firings.push(f);
      if (p.depth + 1 >= cap) {
        if (f.events.some((e) => rules.some((r) => matchesEvent(w.world, r, e)))) capped = true;
        continue;
      }
      for (const e of f.events) {
        for (const r of rules) if (matchesEvent(w.world, r, e)) next.push({ rule: r, depth: p.depth + 1, self: eventSubject(e), vars: { event: eventVars(e) } });
      }
    }
    if (capped) break;
    queue = next;
  }
  if (capped) w.apply({ type: ENGINE_EVENTS.note, data: { text: `Rule cascade stopped at its cap of ${cap}.`, visibility: "secret" } });
  return firings;
}

/** Fires the rules triggered by events that were just applied (they are not re-applied). */
export function runRulesOnEvents(reg: Registry, w: Working, events: readonly LedgerEvent[], opts: RuleOptions): RuleFiring[] {
  const rules = allRules(reg, w.world);
  const roots: Pending[] = [];
  for (const e of events) for (const r of rules) if (matchesEvent(w.world, r, e)) roots.push({ rule: r, depth: 0, self: eventSubject(e), vars: { event: eventVars(e) } });
  return cascade(reg, w, roots, opts);
}

/** Fires tick rules and time rules (`at`) for a turn, slot or day tick. */
export function runRulesOnTick(reg: Registry, w: Working, tick: RuleTick, opts: RuleOptions): RuleFiring[] {
  const roots: Pending[] = [];
  for (const r of allRules(reg, w.world)) {
    const on = r.on;
    if ("tick" in on && on.tick === tick) roots.push({ rule: r, depth: 0, self: null, vars: {} });
    else if ("at" in on && tick !== "day") {
      const env = scopeEnv({ reg, ctx: w.ctx });
      if (truthy(evalExpr(on.at, env, false))) roots.push({ rule: r, depth: 0, self: null, vars: {} });
    }
  }
  return cascade(reg, w, roots, opts);
}
