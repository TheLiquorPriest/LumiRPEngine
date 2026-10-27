// One bounds mechanism (DESIGN §9.4, §11; D4). Every model-proposed change meets `{maxDelta, mode}`
// bounds: the field's own bound and the proposal type's mode, with the player's own max delta. The
// most restrictive applies: `never` > `confirm` > `auto`, and the smallest `maxDelta`. Locked and
// derived fields are `never`, and a change stays inside the field's range. No pack sets a max delta:
// the story's change goes as far as it tells, unless the player or the world's author bounds it.
//
// The proposal type's mode is resolved by the backend (`settings-store.effectiveMode`: the
// player's pin, then the mode learned on the turn's connection, then the D4 cold-start default)
// and passed in; this module combines it with the field.

import type { JsonValue } from "../shared/json";
import type { BoundMode, EntityId } from "../shared/ids";
import type { FieldBound, FieldDef, WorldDoc } from "../shared/world";
import type { Registry } from "./registry-impl";
import { fieldDef } from "./scope";
import type { WorldState } from "./state";
import { own } from "./pack-kit";

const RANK: Record<BoundMode, number> = { auto: 0, confirm: 1, never: 2 };

export function strictest(...modes: (BoundMode | undefined | null)[]): BoundMode {
  let out: BoundMode = "auto";
  for (const m of modes) if (m && RANK[m] > RANK[out]) out = m;
  return out;
}

/** The most restrictive combination of bounds. */
export function combineBounds(...bounds: (FieldBound | undefined)[]): FieldBound {
  let maxDelta: number | undefined;
  const modes: BoundMode[] = [];
  for (const b of bounds) {
    if (!b) continue;
    modes.push(b.mode);
    if (b.maxDelta !== undefined) maxDelta = maxDelta === undefined ? Math.abs(b.maxDelta) : Math.min(maxDelta, Math.abs(b.maxDelta));
  }
  return maxDelta === undefined ? { mode: strictest(...modes) } : { mode: strictest(...modes), maxDelta };
}

export interface ProposalInput {
  /** The extraction or prompted-effects type (`regard`, `quantity`, `condition`, …). */
  type: string;
  entity?: EntityId;
  field?: string;
  delta?: number;
  value?: JsonValue;
}

export interface BoundPolicy {
  /** The type's resolved mode (pin → learned → D4 default), or null when only the field bound speaks. */
  typeMode: BoundMode | null;
  /** A per-type maxDelta the player set, if any. */
  typeMaxDelta?: number;
}

export interface BoundedProposal {
  mode: BoundMode;
  /** The delta after clamping to `maxDelta` and the field's range. */
  delta?: number;
  value?: JsonValue;
  /** True when the proposal was cut down to fit. */
  capped: boolean;
  bound: FieldBound;
}

function clampToField(def: FieldDef | undefined, current: number, delta: number): number {
  let next = current + delta;
  if (def?.min !== undefined) next = Math.max(def.min, next);
  if (def?.max !== undefined) next = Math.min(def.max, next);
  return next - current;
}

/** Bounds one proposed change: the mode it applies under and the delta or value it may apply. */
export function boundProposal(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, input: ProposalInput, policy: BoundPolicy): BoundedProposal {
  const e = input.entity ? own(state.entities, input.entity) : undefined;
  const def = e && input.field ? fieldDef(reg, world, e.kind, input.field) : undefined;
  const locked = def?.locked === true || def?.derived !== undefined;
  const bound = combineBounds(
    def?.bound,
    policy.typeMode ? { mode: policy.typeMode, ...(policy.typeMaxDelta !== undefined ? { maxDelta: policy.typeMaxDelta } : {}) } : undefined,
    locked ? { mode: "never" } : undefined,
  );
  let capped = false;
  let delta = input.delta;
  if (delta !== undefined) {
    if (bound.maxDelta !== undefined && Math.abs(delta) > bound.maxDelta) {
      delta = Math.sign(delta) * bound.maxDelta;
      capped = true;
    }
    const current = e && input.field ? own(e.fields, input.field) : undefined;
    const clamped = clampToField(def, typeof current === "number" ? current : 0, delta);
    if (clamped !== delta) capped = true;
    delta = clamped;
  }
  let value = input.value;
  if (typeof value === "number" && def) {
    const clamped = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, value));
    if (clamped !== value) capped = true;
    value = clamped;
  }
  return { mode: bound.mode, ...(delta !== undefined ? { delta } : {}), ...(value !== undefined ? { value } : {}), capped, bound };
}
