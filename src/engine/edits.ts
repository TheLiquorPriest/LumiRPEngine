// Typed edits (DESIGN §12 ✎ fixes): what a ✎ fix writes, as events. Each operation is checked
// against what it touches (a field's type, enum values, min and max, a pool's evaluated max,
// derived and locked fields) and then resolved through the core effects, so the event validators
// and pack guards apply, a cash correction posts against the outside correction account and a
// change to XP levels up, as anywhere else. Values are literals: a typed "=1+1" is text, never a
// formula. A submit applies all or none and is one `fix` post entry on the head (§4.3), so undo,
// Keep, swipes, Re-narrate and Re-run treat it like any fix.

import { hashParts } from "../shared/hash";
import type { EntityId, FieldId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { safeKey } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { EditOp } from "../shared/protocol";
import type { EffectSpec, FieldDef, FieldType, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { parseDice } from "./dice";
import { applyEffects, fieldBounds } from "./effects";
import { labelOf, optionalService, own } from "./pack-kit";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { materializeIfNeeded } from "./materialize";
import { createRng, type Rng } from "./rng";
import { fieldDef, kindDef, kindIs } from "./scope";
import type { WorldState } from "./state";
import { Working } from "./working";

export interface EditOptions {
  /** The GM editor writes locked fields too; a player's ✎ fix can't. */
  gm: boolean;
  /** The chat run's seed: the edit's generator (level-up effects) forks from it and the operations. */
  runSeed: string;
}

export type EditOutcome = { events: LedgerEvent[] } | { rejection: Rejection };

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A value's shape for a field type; a list's items are checked against its `of`. Null when it fits. */
function shapeProblem(reg: Registry, w: Working, type: FieldType, def: FieldDef, value: JsonValue): string | null {
  switch (type) {
    case "number":
    case "duration":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
    case "money":
      return Number.isSafeInteger(value) ? null : "must be a whole amount";
    case "date":
      return (typeof value === "number" && Number.isFinite(value)) || typeof value === "string" ? null : "must be a date";
    case "bool":
      return typeof value === "boolean" ? null : "must be yes or no";
    case "text":
      return typeof value === "string" ? null : "must be text";
    case "enum":
      return typeof value === "string" && (!def.values || def.values.includes(value)) ? null : `must be one of ${(def.values ?? []).join(", ")}`;
    case "dice":
      if (typeof value !== "string") return "must be dice, like 2d6+1";
      try {
        parseDice(value);
        return null;
      } catch {
        return "must be dice, like 2d6+1";
      }
    case "ref": {
      // Null clears a reference (no owner, no employer).
      if (value === null) return null;
      const target = typeof value === "string" ? own(w.state.entities, value) : undefined;
      if (def.ref) return target && kindIs(reg, w.world, target.kind, def.ref) ? null : `must name a ${(kindDef(reg, w.world, def.ref)?.label ?? def.ref).toLowerCase()}`;
      return target || (typeof value === "string" && own(w.world.places, value)) ? null : "must name a place or something in the world";
    }
    case "list": {
      if (!Array.isArray(value)) return "must be a list";
      if (!def.of) return null;
      for (const item of value) {
        const problem = shapeProblem(reg, w, def.of, { ...def, type: def.of }, item);
        if (problem) return `has an item that ${problem.replace(/^must be /, "isn't ")}`;
      }
      return null;
    }
  }
}

/**
 * Why `value` can't be stored in an entity's field of this definition, as words after its label
 * ("must be between 3 and 18"), or null. Numbers are held to the bounds the `set` effect clamps to
 * (a pool's evaluated max included), but refused rather than clamped: a fix stores what was typed.
 */
export function valueProblem(reg: Registry, w: Working, entity: EntityId, def: FieldDef, value: JsonValue): string | null {
  const shape = shapeProblem(reg, w, def.type, def, value);
  if (shape || typeof value !== "number" || (def.type !== "number" && def.type !== "money" && def.type !== "duration")) return shape;
  const { min, max } = fieldBounds(reg, w, entity, def);
  const show = (n: number): string => (def.type === "money" ? formatMoney(n, w.world.currency) : String(n));
  if ((min === undefined || value >= min) && (max === undefined || value <= max)) return null;
  if (min !== undefined && max !== undefined) return `must be between ${show(min)} and ${show(max)}`;
  return min !== undefined ? `must be at least ${show(min)}` : `must be at most ${show(max ?? value)}`;
}

/** Runs effects with literal arguments; the first rejection (a level-up's included) refuses the edit. */
function run(reg: Registry, w: Working, specs: EffectSpec[], rng: Rng): Rejection | null {
  const out = applyEffects(reg, w, specs, { bindings: {}, rng, literal: true });
  return out.rejected[0]?.rejection ?? null;
}

function setField(reg: Registry, w: Working, entity: EntityId, field: FieldId, value: JsonValue, opts: EditOptions, rng: Rng): Rejection | null {
  const e = own(w.state.entities, entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
  if (!safeKey(field)) return reject("bad_field", "not a field name");
  const def = fieldDef(reg, w.world, e.kind, field);
  if (def) {
    const label = def.label ?? field.replace(/_/g, " ");
    if (def.derived !== undefined) return reject("derived", `${label} is worked out from other values`);
    if (def.locked && !opts.gm) return reject("locked", `${label} is locked`);
    const problem = valueProblem(reg, w, entity, def, value);
    if (problem) return reject("bad_value", `${label} ${problem}`);
  }
  // Cash held in cash accounts is corrected by a balanced posting against the outside correction
  // account (DESIGN §9.2), so the cash shown becomes the amount and the books still balance; cash
  // without a cash account stays a field. The cash shown before the holder's money is materialized
  // is the authored opening amount, so the accounts open first and the correction is measured from
  // them (the fix records both).
  if (field === "cash" && typeof value === "number") {
    materializeIfNeeded(reg, w, entity, "money", opts.runSeed);
    const corrected = optionalService(w.ctx, "economy.set_cash")?.(w.ctx, entity, value) ?? null;
    if (corrected !== null && !Array.isArray(corrected)) return corrected;
    if (corrected !== null) {
      for (const ev of corrected) {
        const rejection = w.apply(ev);
        if (rejection) return rejection;
      }
      return null;
    }
  }
  return run(reg, w, [{ type: "set", args: { entity, field, value } }], rng);
}

function applyOp(reg: Registry, w: Working, op: EditOp, opts: EditOptions, rng: Rng): Rejection | null {
  switch (op.op) {
    case "set":
      return setField(reg, w, op.entity, op.field, op.value, opts, rng);
  }
}

/**
 * Resolves operations in order against `state` (each sees the ones before it) into the events of
 * one `fix` entry, or the first operation's rejection; nothing applies unless all do.
 */
export function resolveEdit(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, ops: readonly EditOp[], opts: EditOptions): EditOutcome {
  const w = new Working(reg, world, state);
  const rng = createRng(hashParts("lre.edit", opts.runSeed, JSON.stringify(ops)));
  for (const [i, op] of ops.entries()) {
    const rejection = applyOp(reg, w, op, opts, rng.fork(`op:${i}`));
    if (rejection) return { rejection };
  }
  // One submit is one unit: a rebased view keeps or drops it whole, as it does a purchase.
  const group = w.events.length > 1 ? `edit:${hashParts(JSON.stringify(w.events)).slice(0, 10)}` : undefined;
  return { events: group ? w.events.map((e) => ({ ...e, group })) : [...w.events] };
}
