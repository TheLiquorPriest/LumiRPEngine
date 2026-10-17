// Small pure utilities pack cores share: reading typed values out of JSON fields and table rows,
// optional cross-pack services, and entity iteration. Packs never import each other's internals;
// these are engine-level helpers over the registry contract.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { EntityId, TableId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { Band, DataTable, TableRow } from "../shared/tables";
import type { QueryMap, ReadContext, ServiceMap } from "./registry";
import type { EntityState, WorldState } from "./state";

export function numOf(v: JsonValue | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function strOf(v: JsonValue | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function objOf(v: JsonValue | undefined): JsonObject {
  return isRecord(v) ? (v as JsonObject) : {};
}

/**
 * A numeric change as an event: `add` while the field holds a number, else `set` from `base` (the
 * value the pack assumed for the absent field). An `add` event starts an absent field from 0, not
 * from the field's default.
 */
export function bump(state: Readonly<WorldState>, entity: EntityId, field: string, delta: number, base: number): LedgerEvent {
  return typeof own(own(state.entities, entity)?.fields ?? {}, field) === "number" ? { type: "add", entity, field, delta } : { type: "set", entity, field, value: base + delta };
}

export function bandOfJson(v: JsonValue | undefined): Band | null {
  if (!isRecord(v)) return null;
  const o = v as JsonObject;
  return typeof o.min === "number" && typeof o.typical === "number" && typeof o.max === "number" ? { min: o.min, typical: o.typical, max: o.max } : null;
}

/** The table in force: the world's pinned copy. */
export function tableOf(ctx: Pick<ReadContext, "tables">, id: TableId): DataTable | undefined {
  return ctx.tables.get(id);
}

export function rowOf(ctx: Pick<ReadContext, "tables">, id: TableId, row: string): TableRow | undefined {
  const rows = ctx.tables.get(id)?.rows;
  return rows ? own(rows, row) : undefined;
}

/**
 * `map[key]` only when `key` is the map's own: an id from an event, effect, proposal or param never
 * resolves through `Object.prototype` ("constructor", "toString", "__proto__").
 */
export function own<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return hasOwn(map, key) ? map[key] : undefined;
}

/** A readable name for an id in a reason: the entity's or place's name, a track's label, else the id in words. */
export function labelOf(ctx: Pick<ReadContext, "world" | "state">, id: string): string {
  return own(ctx.state.entities, id)?.name ?? own(ctx.world.places, id)?.name ?? own(ctx.world.tracks, id)?.label ?? (id.replace(/_/g, " ").trim() || "nothing");
}

/** A registered service, or null when its pack isn't loaded. */
export function optionalService<K extends keyof ServiceMap>(ctx: ReadContext, name: K): ServiceMap[K] | null {
  try {
    return ctx.service(name);
  } catch {
    return null;
  }
}

/** A registered query, or null when its pack isn't loaded. */
export function optionalQuery<K extends keyof QueryMap>(ctx: ReadContext, name: K): QueryMap[K] | null {
  try {
    return ctx.query(name);
  } catch {
    return null;
  }
}

/** Entities by id order, optionally filtered. */
export function entitiesWhere(state: Readonly<WorldState>, pred: (e: EntityState, id: EntityId) => boolean): EntityId[] {
  return Object.keys(state.entities)
    .sort()
    .filter((id) => {
      const e = own(state.entities, id);
      return !!e && pred(e, id);
    });
}

/** A pack's slice of the state (read-only view; empty when absent). */
export function sliceOf(state: Readonly<WorldState>, pack: string): JsonObject {
  return state.packs[pack] ?? {};
}

/** A pack's slice for mutation inside an event reducer. */
export function mutableSlice(state: WorldState, pack: string): JsonObject {
  const s = state.packs[pack] ?? {};
  state.packs[pack] = s;
  return s;
}

/** A nested object inside a mutable slice, created on first use. */
export function sliceRecord(state: WorldState, pack: string, key: string): JsonObject {
  const s = mutableSlice(state, pack);
  const v = s[key];
  if (isRecord(v)) return v as JsonObject;
  const fresh: JsonObject = {};
  s[key] = fresh;
  return fresh;
}

/** Integer cents, rounded half away from zero. */
export function cents(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}
