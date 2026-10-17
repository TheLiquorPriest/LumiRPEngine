// The formula environment (DESIGN §3 Rules, §10, §11): what a predicate, requirement, modifier,
// derived field or effect argument can read. Pure: it reads the world document, the state and the
// registry's formula functions, never the wall clock or ambient randomness.
//
// Names, in lookup order (a dotted path is one lookup):
//   vars        caller-supplied values: action params, `event.*` for event triggers, `track.*`, …
//   bindings    `self`, `actor`, `target`, ref params …: the bare name is the entity id;
//               `self.cash` its field (derived fields computed, defaults applied); `self.name`,
//               `self.kind`, `self.tier`, `self.id`
//   pov         the POV entity, like a binding
//   here        the place of `self` (or the POV); `here.security` reads the place's fields
//   stage.<id>  a track's current stage
//   level.<d>   the effective level of `self` in domain d
//   clock names clock, minute (of day), hour, day (index since the epoch's date), weekday, date,
//               month, year, daypart
//   <entityId>  any entity in the state, as for a binding; `<placeId>.<field>` a place's field
//
// Functions: math built-ins (expr), then the engine's (`BUILTIN_FUNCTIONS`, below), then the
// registry's formulas. Among the engine's:
//   table(id, key, column)         a cell of one of the world's pinned data tables, or null
//   table_step(id, value, column)  the cell of the row whose numeric key is the largest ≤ value
//   roll(notation)                 a dice total, only where the environment has a generator: effect
//                                  arguments (DESIGN §11); anywhere else null, and a lint error
//
// Effect arguments: a string starting with `=` is a formula; a string naming a binding is that
// entity's id; any other value is taken literally (objects and arrays element-wise).

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { DomainId, EntityId, KindId } from "../shared/ids";
import { DOMAINS } from "../shared/ids";
import type { BandDef, FieldDef, KindDef, PoolDef, WorldDoc } from "../shared/world";
import { EFFECT_ONLY_FUNCTIONS } from "../shared/world";
import { calendarOf, clockAt, dateAt, dayPartAt, holidaysOn, nextTimeOfDay, parseHHMM } from "./calendar";
import { DiceError, rollDice } from "./dice";
import type { EnvVars, ExprEnv, Value } from "./expr";
import { compile, ExprError, MATH_FUNCTIONS, runProgram } from "./expr";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import type { EntityState } from "./state";
import { own } from "./pack-kit";

export interface ScopeInput {
  reg: Registry;
  ctx: ReadContext;
  /** Name → entity id. `self` defaults to the POV. */
  bindings?: Record<string, EntityId>;
  vars?: EnvVars;
  /** The effect's own generator: only effect arguments get one, and with it `roll()` (DESIGN §11). */
  rng?: Rng;
}

/** The engine's own formula functions, as `call` below handles them. */
export const BUILTIN_FUNCTIONS = [
  "field",
  "rel",
  "has_rel",
  "rel_count",
  "rel_field",
  "stage",
  "since",
  "place",
  "at",
  "level",
  "knows",
  "fired",
  "attempts",
  "revealed",
  "band",
  "next_time",
  "today_at",
  "hours",
  "days",
  "holiday",
  "count_at",
  "table",
  "table_step",
  "roll",
] as const;

/**
 * Every function a formula outside an effect argument may call: the math built-ins, the engine's
 * and the registry's formulas, sorted (Build's expression editor offers them).
 */
export function formulaFunctions(reg: Registry): string[] {
  const names = new Set<string>([...MATH_FUNCTIONS, ...BUILTIN_FUNCTIONS, ...reg.formulas.keys()]);
  for (const name of EFFECT_ONLY_FUNCTIONS) names.delete(name);
  return [...names].sort();
}

export interface ScopeInput {
  reg: Registry;
  ctx: ReadContext;
  /** Name → entity id. `self` defaults to the POV. */
  bindings?: Record<string, EntityId>;
  vars?: EnvVars;
}

const ENGINE_SLICE = "engine";

/** A kind with its inheritance chain resolved: the world's kinds first, then the registry's. */
export function kindDef(reg: Registry, world: WorldDoc, kind: KindId): KindDef | undefined {
  return own(world.kinds, kind) ?? reg.kinds.get(kind);
}

/** True when `kind` is `ancestor` or inherits from it. */
export function kindIs(reg: Registry, world: WorldDoc, kind: KindId, ancestor: KindId): boolean {
  let id: KindId | undefined = kind;
  for (let guard = 0; id && guard < 32; guard++) {
    if (id === ancestor) return true;
    id = kindDef(reg, world, id)?.extends;
  }
  return false;
}

/** A field's definition, searched up the kind's inheritance chain. */
export function fieldDef(reg: Registry, world: WorldDoc, kind: KindId, field: string): FieldDef | undefined {
  let id: KindId | undefined = kind;
  for (let guard = 0; id && guard < 32; guard++) {
    const def = kindDef(reg, world, id);
    if (!def) return undefined;
    const f = own(def.fields, field);
    if (f) return f;
    id = def.extends;
  }
  return undefined;
}

/** Every field of a kind, ancestors first, overridden by descendants. */
export function kindFields(reg: Registry, world: WorldDoc, kind: KindId): Record<string, FieldDef> {
  const chain: KindDef[] = [];
  let id: KindId | undefined = kind;
  for (let guard = 0; id && guard < 32; guard++) {
    const def = kindDef(reg, world, id);
    if (!def) break;
    chain.unshift(def);
    id = def.extends;
  }
  const out: Record<string, FieldDef> = {};
  for (const def of chain) Object.assign(out, def.fields);
  return out;
}

/** The band a value falls in (`min` inclusive, `max` exclusive), or null. */
export function bandOf(bands: readonly BandDef[] | undefined, value: number): BandDef | null {
  if (!bands) return null;
  for (const b of bands) if ((b.min === undefined || value >= b.min) && (b.max === undefined || value < b.max)) return b;
  return null;
}

export function toValue(v: JsonValue | undefined): Value | undefined {
  if (v === undefined) return undefined;
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return undefined;
}

/** The value as an object, or an empty one. */
export function asObject(v: JsonValue | undefined): JsonObject {
  return isRecord(v) ? (v as JsonObject) : {};
}

/** The object elements of a JSON array (anything else: none). */
export function objects(v: JsonValue | undefined): JsonObject[] {
  const out: JsonObject[] = [];
  if (Array.isArray(v)) for (const x of v) if (isRecord(x)) out.push(x as JsonObject);
  return out;
}

function str(v: Value | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function num(v: Value | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

/** The place an entity is at: its `place` field, else the place of what holds it (`in`). */
export function placeOfEntity(state: { entities: Record<EntityId, EntityState> }, id: EntityId): string | null {
  let cur: EntityId | undefined = id;
  for (let guard = 0; cur && guard < 32; guard++) {
    const e: EntityState | undefined = own(state.entities, cur);
    if (!e) return null;
    const p = e.fields.place;
    if (typeof p === "string" && p !== "") return p;
    cur = e.relations.find((r) => r.type === "in")?.to;
  }
  return null;
}

/** Whether `place` is `ancestor` or lies inside it. */
export function placeWithin(world: WorldDoc, place: string | null, ancestor: string): boolean {
  let id: string | undefined = place ?? undefined;
  for (let guard = 0; id && guard < 32; guard++) {
    if (id === ancestor) return true;
    id = own(world.places, id)?.parent;
  }
  return false;
}

export function engineSlice(state: { packs: Record<string, JsonObject> }): JsonObject {
  return state.packs[ENGINE_SLICE] ?? {};
}

function sliceRecord(state: { packs: Record<string, JsonObject> }, key: string): JsonObject {
  const v = engineSlice(state)[key];
  return isRecord(v) ? (v as JsonObject) : {};
}

/** Builds the environment. One environment per evaluation context; it is cheap. */
export function scopeEnv(input: ScopeInput): ExprEnv {
  const { reg, ctx } = input;
  const world = ctx.world;
  const state = ctx.state;
  const bindings: Record<string, EntityId> = { self: world.pov, ...input.bindings };
  const vars = input.vars ?? {};
  const self = bindings.self ?? world.pov;
  let derivedDepth = 0;

  const entityValue = (id: EntityId, rest: readonly string[]): Value | undefined => {
    const e = own(state.entities, id);
    if (!e) return undefined;
    if (rest.length === 0) return id;
    const [head, ...tail] = rest;
    if (head === undefined) return id;
    if (tail.length === 0) {
      if (head === "id") return id;
      if (head === "name") return e.name;
      if (head === "kind") return e.kind;
      if (head === "tier") return e.tier;
      if (head === "agent") return e.agent;
      if (head === "place") return placeOfEntity(state, id);
    }
    const def = fieldDef(reg, world, e.kind, head);
    let raw: JsonValue | undefined = own(e.fields, head);
    if (def?.derived !== undefined && tail.length === 0) {
      if (derivedDepth > 8) return 0;
      derivedDepth++;
      try {
        return runProgram(compile(def.derived), scopeEnv({ reg, ctx, bindings: { self: id } }));
      } finally {
        derivedDepth--;
      }
    }
    if (raw === undefined) raw = def?.default;
    // An unset pool with no default is full (DESIGN §11): new characters start at their max.
    if (raw === undefined && tail.length === 0 && def?.pool) return poolMax(reg, ctx, id, def.pool) ?? undefined;
    for (const seg of tail) {
      if (!isRecord(raw)) return undefined;
      raw = own(raw as JsonObject, seg);
    }
    return toValue(raw);
  };

  const clockValue = (name: string): Value | undefined => {
    const cal = calendarOf(world);
    const d = dateAt(cal, state.clock);
    switch (name) {
      case "clock":
        return state.clock;
      case "minute":
        return d.minuteOfDay;
      case "hour":
        return Math.floor(d.minuteOfDay / 60);
      case "day":
        return d.dayIndex;
      case "weekday":
        return d.weekday;
      case "date":
        return d.day;
      case "month":
        return d.month;
      case "year":
        return d.year;
      case "daypart":
        return dayPartAt(cal, state.clock).id;
      default:
        return undefined;
    }
  };

  const lookup = (path: readonly string[]): Value | undefined => {
    const [head, ...rest] = path;
    if (head === undefined) return undefined;
    if (Object.prototype.hasOwnProperty.call(vars, head)) {
      let cur: Value | EnvVars | undefined = vars;
      for (const seg of path) {
        if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
        cur = (cur as EnvVars)[seg];
      }
      if (cur !== null && typeof cur === "object") return undefined;
      return cur;
    }
    if (Object.prototype.hasOwnProperty.call(bindings, head)) {
      const id = bindings[head];
      return id === undefined ? undefined : entityValue(id, rest);
    }
    if (head === "pov") return entityValue(world.pov, rest);
    if (head === "here") {
      const place = placeOfEntity(state, self);
      if (rest.length === 0) return place;
      return place ? toValue(own(own(world.places, place)?.fields ?? {}, rest[0] ?? "")) : undefined;
    }
    if (head === "stage" && rest.length === 1) {
      const t = rest[0] ?? "";
      return own(state.tracks, t)?.stage ?? own(world.tracks, t)?.start;
    }
    if (head === "level" && rest.length === 1 && (DOMAINS as readonly string[]).includes(rest[0] ?? "")) {
      return ctx.levelOf(self, rest[0] as DomainId);
    }
    if (rest.length === 0) {
      const c = clockValue(head);
      if (c !== undefined) return c;
    }
    if (own(state.entities, head)) return entityValue(head, rest);
    if (own(world.places, head)) return rest.length === 0 ? head : toValue(own(own(world.places, head)?.fields ?? {}, rest[0] ?? ""));
    return undefined;
  };

  const call = (name: string, args: Value[]): Value | undefined => {
    const a0 = args[0];
    const a1 = args[1];
    const a2 = args[2];
    switch (name) {
      case "field":
        return entityValue(str(a0), [str(a1)]);
      case "rel":
      case "has_rel": {
        const e = own(state.entities, str(a0));
        return !!e && e.relations.some((r) => r.type === str(a1) && (a2 === undefined || r.to === str(a2)));
      }
      case "rel_count": {
        const e = own(state.entities, str(a0));
        return e ? e.relations.filter((r) => r.type === str(a1)).length : 0;
      }
      case "rel_field": {
        // rel_field(from, type, to, field)
        const e = own(state.entities, str(a0));
        const r = e?.relations.find((x) => x.type === str(a1) && x.to === str(a2));
        return toValue(r?.fields?.[str(args[3])]) ?? null;
      }
      case "stage":
        return own(state.tracks, str(a0))?.stage ?? own(world.tracks, str(a0))?.start ?? null;
      case "since": {
        const t = own(state.tracks, str(a0));
        return t ? state.clock - t.since : state.clock;
      }
      case "place":
        return placeOfEntity(state, str(a0));
      case "at":
        return placeWithin(world, placeOfEntity(state, str(a0)), str(a1));
      case "level":
        return (DOMAINS as readonly string[]).includes(str(a1)) && own(state.entities, str(a0)) ? ctx.levelOf(str(a0), str(a1) as DomainId) : 0;
      case "knows": {
        const e = own(state.entities, str(a0));
        return !!e && e.relations.some((r) => r.type === "knows" && r.to === str(a1));
      }
      case "fired": {
        const f = sliceRecord(state, "fired")[str(a0)];
        return isRecord(f) && typeof f.n === "number" ? f.n : 0;
      }
      case "attempts": {
        const n = sliceRecord(state, "attempts")[str(a0)];
        return typeof n === "number" ? n : 0;
      }
      case "revealed": {
        const r = sliceRecord(state, "revealed")[str(a0)];
        return Array.isArray(r) && (a1 === undefined || r.includes(str(a1)));
      }
      case "band": {
        const e = own(state.entities, str(a0));
        if (!e) return "";
        const def = fieldDef(reg, world, e.kind, str(a1));
        const v = entityValue(str(a0), [str(a1)]);
        return bandOf(def?.bands, num(v))?.label ?? "";
      }
      case "next_time": {
        try {
          return nextTimeOfDay(calendarOf(world), state.clock, parseHHMM(str(a0)));
        } catch {
          return state.clock;
        }
      }
      case "today_at": {
        try {
          const cal = calendarOf(world);
          return clockAt(cal, dateAt(cal, state.clock).dayIndex, parseHHMM(str(a0)));
        } catch {
          return state.clock;
        }
      }
      case "hours":
        return num(a0) * 60;
      case "days":
        return num(a0) * 1440;
      case "holiday": {
        const cal = calendarOf(world);
        return holidaysOn(cal, dateAt(cal, state.clock).dayIndex)[0]?.label ?? "";
      }
      case "count_at": {
        // count_at(place, kind?): entities at a place, optionally of a kind (with inheritance)
        let n = 0;
        for (const [id, e] of Object.entries(state.entities)) {
          if (!placeWithin(world, placeOfEntity(state, id), str(a0))) continue;
          if (a1 !== undefined && !kindIs(reg, world, e.kind, str(a1))) continue;
          n++;
        }
        return n;
      }
      case "table":
      case "table_step": {
        // table(id, key, column): a cell of the world's pinned data table; table_step(id, value,
        // column): the cell of the row whose numeric key is the largest at or below value
        // (DESIGN §11). Tables are pinned per revision, so both are deterministic and allowed anywhere.
        const table = own(world.tables, str(a0));
        const rows: JsonObject = table && isRecord(table.rows) ? (table.rows as JsonObject) : {};
        let key: string | null = str(a1);
        if (name === "table_step") {
          key = null;
          for (const k of Object.keys(rows)) {
            const at = k.trim() === "" ? NaN : Number(k);
            if (Number.isFinite(at) && at <= num(a1) && (key === null || at > Number(key))) key = k;
          }
        }
        const row = key === null ? undefined : own(rows, key);
        return isRecord(row) && hasOwn(row, str(a2)) ? (toValue((row as JsonObject)[str(a2)]) ?? null) : null;
      }
      case "roll": {
        // Effect arguments only (DESIGN §11): the effect's own generator, the total recorded in its
        // event. Elsewhere there is no generator and a roll is nothing (lint flags it).
        if (!input.rng) return null;
        try {
          return rollDice(str(a0), input.rng).total;
        } catch (e) {
          if (e instanceof DiceError) return null;
          throw e;
        }
      }
      default: {
        const fn = reg.formulas.get(name);
        return fn ? fn(ctx, ...args) : undefined;
      }
    }
  };

  return { lookup, call };
}

/** Pool reads in progress: a max that reads its own pool stops here instead of recursing. */
let poolReads = 0;

/**
 * A pool's max for an entity (DESIGN §11): `max` names a field of the entity (derived ones
 * computed) or is a formula with the entity as `self`. Null when it doesn't read as a number.
 */
export function poolMax(reg: Registry, ctx: ReadContext, entity: EntityId, pool: PoolDef): number | null {
  const e = own(ctx.state.entities, entity);
  if (!e || typeof pool.max !== "string" || poolReads > 8) return null;
  poolReads++;
  try {
    const src = fieldDef(reg, ctx.world, e.kind, pool.max) ? `self.${pool.max}` : pool.max;
    const v = evalExpr(src, scopeEnv({ reg, ctx, bindings: { self: entity } }), null);
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } finally {
    poolReads--;
  }
}

/** Evaluates a formula; parse errors and unknown names yield `fallback`. */
export function evalExpr(src: string | number | boolean | undefined, env: ExprEnv, fallback: Value = 0): Value {
  if (src === undefined) return fallback;
  if (typeof src !== "string") return src;
  try {
    return runProgram(compile(src), env);
  } catch (e) {
    if (e instanceof ExprError) return fallback;
    throw e;
  }
}

export function truthy(v: Value): boolean {
  return v !== false && v !== null && v !== 0 && v !== "";
}

/** Effect-argument evaluation (see the header). */
export function evalArg(value: JsonValue, env: ExprEnv, bindings: Record<string, EntityId>): JsonValue {
  if (typeof value === "string") {
    if (value.startsWith("=")) return evalExpr(value.slice(1), env, null);
    if (Object.prototype.hasOwnProperty.call(bindings, value)) return bindings[value] ?? value;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => evalArg(v, env, bindings));
  if (isRecord(value)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value as JsonObject)) out[k] = evalArg(v, env, bindings);
    return out;
  }
  return value;
}

export function evalArgs(args: Record<string, JsonValue>, env: ExprEnv, bindings: Record<string, EntityId>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(args)) out[k] = evalArg(v, env, bindings);
  return out;
}
