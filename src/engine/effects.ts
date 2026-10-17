// Effects → events (DESIGN §3). An effect is a proposal `{type, args}`; resolving it yields concrete
// events (assignments carry final values, accumulators carry deltas) or a rejection. The core
// effect types live here because they need the schema (kinds, field bounds); pack effect types
// are registered with `r.effect` and receive their arguments already evaluated.
//
// Core types:
//   set    {entity, field, value}           number fields clamp to min/max; enums must match
//   add    {entity, field, delta}           the result clamps to min/max (the delta shrinks)
//   move   {entity, to}                     `place` := to; leaves any container (`in`)
//   link   {rel, from, to, until?, fields?} unlink {rel, from, to}
//   spawn  {id?, kind, name, tier?, fields?, relations?, agent?, place?}
//   stage  {track, to}
//   post   {lines: [{account, amount}], memo}
//   signal {class, text, entity?, visibility?}   an interrupt-class event (timelapse policy)
//   note   {text, visibility?}                   a Journal line
//   beat   {hint}                                an outline hint

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, InterruptClass } from "../shared/ids";
import { INTERRUPT_CLASSES, TIERS } from "../shared/ids";
import { hashParts } from "../shared/hash";
import type { LedgerEvent, PostingLine } from "../shared/ledger";
import type { EffectSpec, EntityDef, RelationInstance } from "../shared/world";
import { calendarOf, slotIndexAt } from "./calendar";
import type { EnvVars, Value } from "./expr";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import { evalArgs, fieldDef, objects, scopeEnv } from "./scope";
import type { Working } from "./working";
import { labelOf, own } from "./pack-kit";

export interface EffectScope {
  /** Name → entity id (`self`, `actor`, `target`, ref params). */
  bindings: Record<string, EntityId>;
  vars?: EnvVars;
  /** Evaluated action parameters, passed to pack effects. */
  params?: Record<string, Value>;
  rng: Rng;
}

export interface EffectOutcome {
  applied: LedgerEvent[];
  rejected: { effect: EffectSpec; rejection: Rejection }[];
}

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
      if (def && (def.type === "number" || def.type === "money" || def.type === "duration") && typeof value === "number") value = clampNumber(value, def.min, def.max);
      if (def?.type === "enum" && def.values && typeof value === "string" && !def.values.includes(value)) return reject("bad_value", `${field} must be one of ${def.values.join(", ")}`);
      return [{ type: "set", entity, field, value }];
    }
    case "add": {
      const entity = text(args.entity);
      const field = text(args.field);
      const e = own(state.entities, entity);
      if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
      if (typeof args.delta !== "number" || !Number.isFinite(args.delta)) return reject("bad_args", "add needs a numeric delta");
      const def = fieldDef(reg, world, e.kind, field);
      if (def?.derived !== undefined) return reject("derived", `${field} is derived`);
      const stored = own(e.fields, field);
      const cur = stored ?? def?.default ?? 0;
      if (typeof cur !== "number") return reject("not_numeric", `${e.name}'s ${field.replace(/_/g, " ")} is not a number`);
      const delta = clampNumber(cur + args.delta, def?.min, def?.max) - cur;
      if (delta === 0) return [];
      // An `add` event starts an absent field from 0, so a field still at its default is set instead.
      return stored === undefined && cur !== 0 ? [{ type: "set", entity, field, value: cur + delta }] : [{ type: "add", entity, field, delta }];
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
      const from = text(args.from);
      const to = text(args.to);
      if (rel === "") return reject("bad_args", "link needs rel");
      const ev: LedgerEvent = { type: "link", rel, from, to };
      if (isRecord(args.fields)) ev.fields = args.fields as JsonObject;
      if (typeof args.until === "number") ev.until = Math.round(args.until);
      return [ev];
    }
    case "unlink":
      return [{ type: "unlink", rel: text(args.rel), from: text(args.from), to: text(args.to) }];
    case "spawn": {
      const kind = text(args.kind);
      if (kind === "" || !(own(world.kinds, kind) ?? reg.kinds.get(kind))) return reject("missing_kind", `no kind ${kind}`);
      const id = text(args.id) || `${kind}:${hashParts(rng.seed, "spawn", kind, text(args.name)).slice(0, 10)}`;
      const tier = (TIERS as readonly string[]).includes(text(args.tier)) ? (text(args.tier) as EntityDef["tier"]) : "background";
      const fields: JsonObject = isRecord(args.fields) ? { ...(args.fields as JsonObject) } : {};
      if (typeof args.place === "string") fields.place = args.place;
      const relations: RelationInstance[] = objects(args.relations).map((r) => ({ type: text(r.type), to: text(r.to) }));
      const entity: EntityDef = { id, kind, name: text(args.name) || id, tier, fields, relations };
      const out: LedgerEvent[] = [];
      if (args.agent === true) {
        entity.agent = true;
        // A new agent starts caught up: it never replays slots from before it existed.
        out.push({ type: "engine.caught", data: { agent: id, slot: slotIndexAt(calendarOf(world), state.clock) } });
      }
      return [{ type: "spawn", entity }, ...out];
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

/** Resolves one effect into events (not applied). Unknown types are rejected. */
export function resolveEffect(reg: Registry, w: Working, spec: EffectSpec, scope: EffectScope): LedgerEvent[] | Rejection {
  const env = scopeEnv({ reg, ctx: w.ctx, bindings: scope.bindings, vars: scope.vars });
  const args = evalArgs(spec.args ?? {}, env, { self: w.world.pov, ...scope.bindings });
  const core = coreEffect(reg, w, spec.type, args, scope.rng);
  if (core) return core;
  const def = reg.effects.get(spec.type);
  if (!def) return reject("unknown_effect", `unknown effect ${spec.type}`);
  return def.resolve(args, { ...w.ctx, rng: scope.rng, params: scope.params ?? {} });
}

/**
 * Resolves and applies effects in order; each sees the state after the ones before it. One
 * effect's events are one atomic unit: they share a group (so a rebased view drops or keeps them
 * together) and apply all or none here.
 */
export function applyEffects(reg: Registry, w: Working, specs: readonly EffectSpec[], scope: EffectScope): EffectOutcome {
  const out: EffectOutcome = { applied: [], rejected: [] };
  specs.forEach((spec, i) => {
    const rng = scope.rng.fork(`effect:${i}`);
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
  });
  return out;
}
