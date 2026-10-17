// Effects → events (DESIGN §3). An effect is a proposal `{type, args}`; resolving it yields concrete
// events (assignments carry final values, accumulators carry deltas) or a rejection. The core
// effect types live here because they need the schema (kinds, field bounds); pack effect types
// are registered with `r.effect` and receive their arguments already evaluated.
//
// Core types:
//   set     {entity, field, value}           number fields clamp to min/max (a pool's to its max); enums must match
//   add     {entity, field, delta}           the result clamps the same way (the delta shrinks)
//   recover {entity, field, amount?, full?}  a pool rises by `amount`, else its own `recover`, else to its max
//   award   {entity, progression, amount}    adds to a progression's XP field (the level-up follows)
//   check   {check, actor, target?, outcomes} anyone rolls a check; its outcome's effects see `roll.*`
//   move    {entity, to}                     `place` := to; leaves any container (`in`)
//   link    {rel, from, to, until?, fields?} unlink {rel, from, to}: the other side of a symmetric
//                                            or inverse type with it; kinds and cardinality checked
//   spawn   {id?, kind, name, tier?, fields?, relations?, agent?, place?, class?, tags?}
//                                            tier: a world tier, else the world's spawn tier;
//                                            class and tags stay with the entity in state;
//                                            relations are checked and two-sided as with link
//   stage   {track, to}
//   post    {lines: [{account, amount}], memo}
//   signal  {class, text, entity?, visibility?}   an interrupt-class event (timelapse policy)
//   note    {text, visibility?}                   a Journal line
//   beat    {hint}                                an outline hint
//
// Arguments are evaluated just before the effect resolves; `=` formulas there may call `roll()`,
// drawing from the effect's own generator, so the event records the result (DESIGN §11). After
// each effect, every entity whose XP it changed rises to the level its XP has reached
// (`levelUps`), so an award, a quest reward or a narrated gain levels up the same way.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, InterruptClass } from "../shared/ids";
import { INTERRUPT_CLASSES } from "../shared/ids";
import { hashParts } from "../shared/hash";
import type { LedgerEvent, PostingLine } from "../shared/ledger";
import { agentOf, spawnTierOf, tierOf } from "../shared/tiers";
import type { EffectSpec, EntityDef, FieldDef, ProgressionDef, RelationInstance } from "../shared/world";
import { calendarOf, slotIndexAt } from "./calendar";
import { checkOf, readyCheck, rollCheck, rollVars } from "./checks";
import { ENGINE_EVENTS } from "./engine-pack";
import type { EnvVars, Value } from "./expr";
import type { ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import { linkEvents, spawnLinks, unlinkEvents } from "./relations";
import { progressionApplies, progressOf } from "./ruleset";
import { evalArg, evalArgs, evalExpr, fieldDef, objects, poolMax, scopeEnv } from "./scope";
import { classOf, classProblems } from "./selector";
import type { Working } from "./working";
import { labelOf, own } from "./pack-kit";

export interface EffectScope {
  /** Name → entity id (`self`, `actor`, `target`, ref params). */
  bindings: Record<string, EntityId>;
  vars?: EnvVars;
  /** Evaluated action parameters, passed to pack effects. */
  params?: Record<string, Value>;
  rng: Rng;
  /** How deep checks' outcomes and level-ups' `onLevel` effects have nested; past the cap they stop. */
  depth?: number;
  /**
   * Arguments are taken as given, never as formulas or binding names: a ✎ fix or GM edit stores
   * what was typed ("=1+1" stays text). Effects run for its level-ups (`onLevel`) are authored and evaluate as usual.
   */
  literal?: boolean;
}

export interface EffectOutcome {
  applied: LedgerEvent[];
  rejected: { effect: EffectSpec; rejection: Rejection }[];
}

/** Nesting cap for effects run by effects (a check's outcomes, `onLevel`), as for a rule cascade. */
export const NESTING_CAP = 8;

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

function isRejection(v: LedgerEvent[] | Rejection): v is Rejection {
  return !Array.isArray(v);
}

function text(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function clampNumber(value: number, min: number | undefined, max: number | undefined): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/** The bounds a number field's value is kept in: its min and max, and for a pool its min (default 0) and evaluated max. */
export function fieldBounds(reg: Registry, ctx: ReadContext, entity: EntityId, def: FieldDef | undefined): { min?: number; max?: number } {
  if (!def?.pool) return { ...(def?.min !== undefined ? { min: def.min } : {}), ...(def?.max !== undefined ? { max: def.max } : {}) };
  const top = poolMax(reg, ctx, entity, def.pool);
  const min = Math.max(def.min ?? -Infinity, def.pool.min ?? 0);
  const max = Math.min(def.max ?? Infinity, top ?? Infinity);
  return { ...(Number.isFinite(min) ? { min } : {}), ...(Number.isFinite(max) ? { max } : {}) };
}

/**
 * A change to a number field as events: the result clamped to the field's bounds, as an `add` while
 * the field holds a value, else a `set` (an `add` event starts an absent field from 0, so a field
 * still at its default, or an unset pool, is set instead). None when nothing changes.
 */
function change(reg: Registry, w: Working, entity: EntityId, field: string, delta: number): LedgerEvent[] | Rejection {
  const e = own(w.state.entities, entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
  const def = fieldDef(reg, w.world, e.kind, field);
  if (def?.derived !== undefined) return reject("derived", `${field} is derived`);
  const stored = own(e.fields, field);
  const cur = stored ?? def?.default ?? (def?.pool ? (poolMax(reg, w.ctx, entity, def.pool) ?? 0) : 0);
  if (typeof cur !== "number") return reject("not_numeric", `${e.name}'s ${field.replace(/_/g, " ")} is not a number`);
  const b = fieldBounds(reg, w.ctx, entity, def);
  const next = clampNumber(cur + delta, b.min, b.max);
  if (next === cur) return [];
  return stored === undefined && cur !== 0 ? [{ type: "set", entity, field, value: next }] : [{ type: "add", entity, field, delta: next - cur }];
}

function coreEffect(reg: Registry, w: Working, type: string, args: Record<string, JsonValue>, rng: Rng): LedgerEvent[] | Rejection | null {
  const state = w.state;
  const world = w.world;
  switch (type) {
    case "set": {
      const entity = text(args.entity);
      const field = text(args.field);
      const e = own(state.entities, entity);
      if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
      if (field === "") return reject("bad_args", "set needs a field");
      const def = fieldDef(reg, world, e.kind, field);
      let value: JsonValue = args.value ?? null;
      if (def?.derived !== undefined) return reject("derived", `${field} is derived`);
      if (def && (def.type === "number" || def.type === "money" || def.type === "duration") && typeof value === "number") {
        const b = fieldBounds(reg, w.ctx, entity, def);
        value = clampNumber(value, b.min, b.max);
      }
      if (def?.type === "enum" && def.values && typeof value === "string" && !def.values.includes(value)) return reject("bad_value", `${field} must be one of ${def.values.join(", ")}`);
      return [{ type: "set", entity, field, value }];
    }
    case "add": {
      if (typeof args.delta !== "number" || !Number.isFinite(args.delta)) return reject("bad_args", "add needs a numeric delta");
      return change(reg, w, text(args.entity), text(args.field), args.delta);
    }
    case "recover": {
      const entity = text(args.entity);
      const field = text(args.field);
      const e = own(state.entities, entity);
      if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
      const pool = fieldDef(reg, world, e.kind, field)?.pool;
      if (!pool) return reject("not_pool", `${e.name}'s ${field.replace(/_/g, " ")} isn't a pool`);
      if (args.amount !== undefined && (typeof args.amount !== "number" || !Number.isFinite(args.amount))) return reject("bad_args", "recover needs a numeric amount");
      const top = poolMax(reg, w.ctx, entity, pool);
      if (top === null) return reject("no_max", `${e.name}'s ${field.replace(/_/g, " ")} has no max to recover to`);
      const read = scopeEnv({ reg, ctx: w.ctx, bindings: { self: entity } });
      const now = Number(read.lookup(["self", field])) || 0;
      // By the amount given, else the pool's own recovery, else back to the max. Recovery never lowers a pool.
      const amount = typeof args.amount === "number" ? args.amount : args.full !== true && pool.recover !== undefined ? Number(evalExpr(pool.recover, read, 0)) || 0 : top - now;
      return change(reg, w, entity, field, Math.max(0, amount));
    }
    case "award": {
      const entity = text(args.entity);
      const id = text(args.progression);
      const prog = own(world.ruleset?.progression ?? {}, id);
      if (!prog) return reject("unknown_progression", `no progression ${id}`);
      const e = own(state.entities, entity);
      if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
      if (!progressionApplies(reg, world, prog, e.kind)) return reject("not_applicable", `${e.name} has no ${prog.label}`);
      if (typeof args.amount !== "number" || !Number.isFinite(args.amount)) return reject("bad_args", "award needs a numeric amount");
      return change(reg, w, entity, prog.xpField, args.amount);
    }
    case "move": {
      const entity = text(args.entity);
      const to = text(args.to);
      const e = own(state.entities, entity);
      if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
      if (!own(world.places, to)) return reject("missing_place", `no place ${labelOf(w, to)}`);
      const out: LedgerEvent[] = [];
      for (const r of e.relations) if (r.type === "in") out.push({ type: "unlink", rel: "in", from: entity, to: r.to });
      out.push({ type: "set", entity, field: "place", value: to });
      return out;
    }
    case "link": {
      const rel = text(args.rel);
      if (rel === "") return reject("bad_args", "link needs rel");
      return linkEvents(reg, world, state, { rel, from: text(args.from), to: text(args.to), ...(isRecord(args.fields) ? { fields: args.fields as JsonObject } : {}), ...(typeof args.until === "number" ? { until: Math.round(args.until) } : {}) });
    }
    case "unlink":
      return unlinkEvents(reg, world, state, { rel: text(args.rel), from: text(args.from), to: text(args.to) });
    case "spawn": {
      const kind = text(args.kind);
      if (kind === "" || !(own(world.kinds, kind) ?? reg.kinds.get(kind))) return reject("missing_kind", `no kind ${kind}`);
      const id = text(args.id) || `${kind}:${hashParts(rng.seed, "spawn", kind, text(args.name)).slice(0, 10)}`;
      const tier = tierOf(world, text(args.tier)) ? text(args.tier) : spawnTierOf(world);
      const fields: JsonObject = isRecord(args.fields) ? { ...(args.fields as JsonObject) } : {};
      if (typeof args.place === "string") fields.place = args.place;
      const relations: RelationInstance[] = objects(args.relations).map((r) => ({ type: text(r.type), to: text(r.to) }));
      const entity: EntityDef = { id, kind, name: text(args.name) || id, tier, fields, relations };
      if (args.class !== undefined) {
        const classes = classOf(args.class);
        const problem = classes ? classProblems(world, classes, entity.name)[0] : { code: "bad_args", message: "a spawn's class is facet → values" };
        if (problem) return reject(problem.code, problem.message);
        if (classes && Object.keys(classes).length > 0) entity.class = classes;
      }
      const tags = [...new Set((Array.isArray(args.tags) ? args.tags : []).filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()))];
      if (tags.length > 0) entity.tags = tags;
      // Its relations obey their types like a `link`; the other sides follow the spawn in its unit.
      const links = spawnLinks(reg, world, state, entity);
      if (isRejection(links)) return links;
      const out: LedgerEvent[] = [];
      if (agentOf(world, { id, tier, agent: typeof args.agent === "boolean" ? args.agent : undefined })) {
        entity.agent = true;
        // A new agent starts caught up: it never replays slots from before it existed.
        out.push({ type: "engine.caught", data: { agent: id, slot: slotIndexAt(calendarOf(world), state.clock) } });
      }
      return [{ type: "spawn", entity }, ...links, ...out];
    }
    case "stage":
      return [{ type: "stage", track: text(args.track), to: text(args.to) }];
    case "post": {
      if (!Array.isArray(args.lines)) return reject("bad_args", "post needs lines");
      const lines: PostingLine[] = objects(args.lines).map((l) => ({ account: text(l.account), amount: typeof l.amount === "number" ? Math.round(l.amount) : NaN }));
      return [{ type: "post", lines, memo: text(args.memo) }];
    }
    case "signal": {
      const cls = text(args.class);
      if (!(INTERRUPT_CLASSES as readonly string[]).includes(cls)) return reject("bad_args", `unknown interrupt class ${cls}`);
      const data: JsonObject = { class: cls as InterruptClass, text: text(args.text) };
      if (typeof args.entity === "string") data.entity = args.entity;
      if (typeof args.visibility === "string") data.visibility = args.visibility;
      return [{ type: "engine.signal", data }];
    }
    case "note": {
      const data: JsonObject = { text: text(args.text) };
      if (typeof args.visibility === "string") data.visibility = args.visibility;
      return [{ type: "engine.note", data }];
    }
    case "beat":
      return [{ type: "engine.beat", data: { hint: text(args.hint) } }];
    default:
      return null;
  }
}

/**
 * Resolves one effect into events (not applied). Unknown types are rejected, and so is `check`,
 * which applies its outcome's effects itself (`applyEffects`).
 */
export function resolveEffect(reg: Registry, w: Working, spec: EffectSpec, scope: EffectScope): LedgerEvent[] | Rejection {
  if (spec.type === "check") return reject("bad_effect", "a check applies its outcomes; run it through applyEffects");
  // Arguments get their own generator: rolls there never shift the draws the effect itself makes.
  const args = scope.literal ? { ...spec.args } : evalArgs(spec.args ?? {}, scopeEnv({ reg, ctx: w.ctx, bindings: scope.bindings, vars: scope.vars, rng: scope.rng.fork("args") }), { self: w.world.pov, ...scope.bindings });
  const core = coreEffect(reg, w, spec.type, args, scope.rng);
  if (core) return core;
  const def = reg.effects.get(spec.type);
  if (!def) return reject("unknown_effect", `unknown effect ${spec.type}`);
  return def.resolve(args, { ...w.ctx, rng: scope.rng, params: scope.params ?? {} });
}

/** Effect lists carried in arguments (a check's outcomes), read defensively: they are authored JSON. */
function effectList(v: JsonValue | undefined): EffectSpec[] {
  return objects(v).flatMap((o) => (typeof o.type === "string" ? [{ type: o.type, args: isRecord(o.args) ? (o.args as Record<string, JsonValue>) : {} }] : []));
}

/**
 * The `check` effect (DESIGN §11): anyone rolls a check, from rules, outcomes or quest stages. The
 * actor's roll forks the effect's generator by the actor's id, so nobody's roll moves anyone
 * else's, and the POV's palette rolls never move at all. The roll is recorded (`engine.check`),
 * then the outcome's effects run with the roller as `self` and `actor`, the target as `target`,
 * and the roll as `roll.*`. Only `actor`, `target` and `check` are evaluated up front; the
 * outcomes' arguments are evaluated when they run, against the roll.
 */
function applyCheck(reg: Registry, w: Working, spec: EffectSpec, scope: EffectScope): EffectOutcome | Rejection {
  const depth = scope.depth ?? 0;
  if (depth >= NESTING_CAP) return reject("too_deep", `effects nested past ${NESTING_CAP} levels`);
  const a = spec.args ?? {};
  const bindings = { self: w.world.pov, ...scope.bindings };
  const env = scopeEnv({ reg, ctx: w.ctx, bindings: scope.bindings, vars: scope.vars });
  const actor = text(evalArg(a.actor ?? "self", env, bindings));
  const target = a.target === undefined ? null : text(evalArg(a.target, env, bindings));
  const def = checkOf(w.world, typeof a.check === "string" ? evalArg(a.check, env, bindings) : a.check);
  if (!def) return reject("unknown_check", `no check ${typeof a.check === "string" ? a.check : "given"}`);
  if (!own(w.state.entities, actor)) return reject("missing_entity", `no entity ${labelOf(w, actor)}`);
  if (target !== null && !own(w.state.entities, target)) return reject("missing_entity", `no entity ${labelOf(w, target)}`);
  const rolling: Record<string, EntityId> = { ...scope.bindings, self: actor, actor, ...(target !== null ? { target } : {}) };
  const ready = readyCheck(reg, w.ctx, def, rolling, scope.vars);
  if ("code" in ready) return ready;
  const rolled = rollCheck(ready, scope.rng.fork(`actor:${actor}`));
  const out: EffectOutcome = { applied: [], rejected: [] };
  const record: LedgerEvent = {
    type: ENGINE_EVENTS.check,
    data: {
      check: def.id,
      actor,
      ...(target !== null ? { target } : {}),
      notation: ready.notation,
      natural: rolled.natural,
      total: rolled.total,
      dc: ready.dc,
      outcome: rolled.outcome,
      // Someone else's roll is the author's and the GM's to see; the outcome's effects show what changed.
      ...(actor !== w.world.pov ? { npc: true } : {}),
    },
  };
  const failed = w.apply(record);
  if (failed) return failed;
  out.applied.push(record);
  const outcomes = isRecord(a.outcomes) ? (a.outcomes as JsonObject) : {};
  const result = applyEffects(reg, w, effectList(own(outcomes, rolled.outcome)), { bindings: rolling, vars: { ...scope.vars, roll: rollVars(ready, rolled) }, params: scope.params, rng: scope.rng.fork("outcome"), depth: depth + 1 });
  out.applied.push(...result.applied);
  out.rejected.push(...result.rejected);
  return out;
}

/** One entity's level-up on one progression: the level field set a level at a time, each followed by `onLevel`. */
function levelUp(reg: Registry, w: Working, entity: EntityId, id: string, prog: ProgressionDef, scope: EffectScope): EffectOutcome {
  const out: EffectOutcome = { applied: [], rejected: [] };
  const p = progressOf(reg, w.ctx, entity, prog);
  if (!p || p.reached <= p.level) return out;
  const from = p.level;
  const depth = scope.depth ?? 0;
  for (let level = from + 1; level <= p.reached; level++) {
    const set: LedgerEvent = { type: "set", entity, field: prog.levelField, value: level };
    if (w.apply(set)) return out;
    out.applied.push(set);
    if (!prog.onLevel || prog.onLevel.length === 0 || depth + 1 >= NESTING_CAP) continue;
    const r = applyEffects(reg, w, prog.onLevel, { bindings: { self: entity }, vars: { level, from }, rng: scope.rng.fork(`level:${id}:${entity}:${level}`), depth: depth + 1 });
    out.applied.push(...r.applied);
    out.rejected.push(...r.rejected);
  }
  const who = entity === w.world.pov ? "You" : (own(w.state.entities, entity)?.name ?? entity);
  const note: LedgerEvent = {
    type: ENGINE_EVENTS.note,
    // The POV's level-up is the player's news; anyone else's is the author's and the GM's.
    data: { text: `${who} reached ${prog.label} ${p.reached}${p.reached - from > 1 ? ` (from ${from})` : ""}.`, entity, ...(entity === w.world.pov ? {} : { visibility: "secret" }) },
  };
  if (!w.apply(note)) out.applied.push(note);
  return out;
}

/**
 * Progression after events (DESIGN §11): every entity whose XP field the events changed rises to
 * the level its XP has reached, one level at a time. Each level sets the level field, then runs the
 * progression's `onLevel` effects with `level` and `from` (the level before the gain); the gain
 * ends with a Journal line. Levels only rise: less XP leaves the level where it is.
 */
export function levelUps(reg: Registry, w: Working, events: readonly LedgerEvent[], scope: EffectScope): EffectOutcome {
  const out: EffectOutcome = { applied: [], rejected: [] };
  const progressions = Object.entries(w.world.ruleset?.progression ?? {});
  if (progressions.length === 0) return out;
  const done = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "set" && ev.type !== "add") continue;
    for (const [id, prog] of progressions) {
      const key = `${ev.entity}\u0000${id}`;
      if (prog.xpField !== ev.field || done.has(key)) continue;
      done.add(key);
      const step = levelUp(reg, w, ev.entity, id, prog, scope);
      out.applied.push(...step.applied);
      out.rejected.push(...step.rejected);
    }
  }
  return out;
}

/**
 * Resolves and applies effects in order; each sees the state after the ones before it. One
 * effect's events are one atomic unit: they share a group (so a rebased view drops or keeps them
 * together) and apply all or none here. A level-up the effect causes follows it.
 */
export function applyEffects(reg: Registry, w: Working, specs: readonly EffectSpec[], scope: EffectScope): EffectOutcome {
  const out: EffectOutcome = { applied: [], rejected: [] };
  specs.forEach((spec, i) => {
    const rng = scope.rng.fork(`effect:${i}`);
    if (spec.type === "check") {
      const checked = applyCheck(reg, w, spec, { ...scope, rng });
      if ("code" in checked) out.rejected.push({ effect: spec, rejection: checked });
      else {
        out.applied.push(...checked.applied);
        out.rejected.push(...checked.rejected);
      }
      return;
    }
    const result = resolveEffect(reg, w, spec, { ...scope, rng });
    if (isRejection(result)) {
      out.rejected.push({ effect: spec, rejection: result });
      return;
    }
    const group = result.length > 1 ? `fx:${hashParts(rng.seed).slice(0, 10)}` : undefined;
    const events = group ? result.map((ev) => ({ ...ev, group })) : result;
    // A single event needs no rollback; a unit is applied all-or-nothing.
    const mark = group ? w.mark() : null;
    for (const ev of events) {
      const failure = w.apply(ev);
      if (failure) {
        if (mark) w.restore(mark);
        out.rejected.push({ effect: spec, rejection: failure });
        return;
      }
    }
    out.applied.push(...events);
    const ups = levelUps(reg, w, events, { ...scope, rng });
    out.applied.push(...ups.applied);
    out.rejected.push(...ups.rejected);
  });
  return out;
}
