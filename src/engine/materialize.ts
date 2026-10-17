// Lazy materialization (DESIGN §9.2). A materializer samples detail **within** an entity's current
// representation (its band, notable items, aggregates), seeded by `hash(runSeed, entity, domain)`,
// and the result is recorded once as a `materialize` event with the generator version and the
// pinned tables' revision. Previews (GM view, inspector, Dry Run) use the same seed and record
// nothing.

import { hashJson, hashParts } from "../shared/hash";
import type { DomainId, EntityId } from "../shared/ids";
import type { LedgerEvent, MaterializeEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import type { ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { createRng } from "./rng";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import type { Working } from "./working";

export function materializationSeed(runSeed: string, entity: EntityId, domain: DomainId): string {
  return hashParts(runSeed, entity, domain);
}

/** The revision of the pinned tables a materialization reads: changes only through Upgrade. */
export function tablesRevision(world: WorldDoc): string {
  return hashJson(world.pins.tables);
}

export function isMaterialized(state: Readonly<WorldState>, entity: EntityId, domain: DomainId): boolean {
  return Object.prototype.hasOwnProperty.call(state.materialized, `${entity}:${domain}`);
}

/**
 * The generator version a world pins for a domain. A pin the running code does not carry is a
 * rejection: detail is never sampled by a generator other than the pinned one.
 */
export function pinnedVersion(world: WorldDoc, reg: Registry, domain: DomainId): number | Rejection {
  const def = reg.materializers.get(domain);
  if (!def) return { code: "no_materializer", reason: `no materializer for ${domain}` };
  const pin = world.pins.generators[domain];
  if (pin !== undefined && pin !== def.version) return { code: "generator_pin", reason: `${domain} is pinned to generator v${pin}; this build has v${def.version}` };
  return def.version;
}

function sample(reg: Registry, ctx: ReadContext, entity: EntityId, domain: DomainId, runSeed: string): MaterializeEvent | null {
  const def = reg.materializers.get(domain);
  if (!def || !own(ctx.state.entities, entity)) return null;
  const version = pinnedVersion(ctx.world, reg, domain);
  if (typeof version !== "number") return null;
  const events: LedgerEvent[] = def.materialize(entity, ctx, createRng(materializationSeed(runSeed, entity, domain)));
  if (events.length === 0) return null;
  return { type: "materialize", entity, domain, generatorVersion: version, tablesRevision: tablesRevision(ctx.world), events };
}

/**
 * Materializes `entity` in `domain` into the working state when it has not been, and the
 * materializer has detail to add at the entity's current level. Returns the recorded event.
 */
export function materializeIfNeeded(reg: Registry, w: Working, entity: EntityId, domain: DomainId, runSeed: string): MaterializeEvent | null {
  if (isMaterialized(w.state, entity, domain)) return null;
  const event = sample(reg, w.ctx, entity, domain, runSeed);
  if (!event) return null;
  return w.apply(event) ? null : event;
}

/** Materializes an entity in every domain that has a materializer. */
export function materializeAll(reg: Registry, w: Working, entity: EntityId, runSeed: string): MaterializeEvent[] {
  const out: MaterializeEvent[] = [];
  for (const domain of [...reg.materializers.keys()].sort()) {
    const ev = materializeIfNeeded(reg, w, entity, domain, runSeed);
    if (ev) out.push(ev);
  }
  return out;
}

/** A labelled preview from the same seed. Never recorded (L34). */
export function previewMaterialization(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, entity: EntityId, domain: DomainId, runSeed: string): LedgerEvent[] {
  if (isMaterialized(state, entity, domain)) return [];
  return sample(reg, reg.context(world, state), entity, domain, runSeed)?.events ?? [];
}
