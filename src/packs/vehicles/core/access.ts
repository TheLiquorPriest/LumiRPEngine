// The one reader of whose a vehicle is and who may use it (DESIGN §6.11, §9.3; ITEMS-SPEC §3.4):
// every vehicle someone may drive, over the access resolver (`accessFor`, `assignFor`), so the
// Vehicles section, Drive, the Garage, the interpreter's scene and the gear pack agree on one
// answer. A vehicle is someone's to drive when they own it, their household or company does (an
// organization's `assets.use`, a household's implied rule), they are staff where it is, or a grant
// or a standing permission lets them; never only because nobody owns it, or a shop lets customers
// use its fixtures. A company's vehicle is never its owner's own: it is the company's, even to the
// owner who runs it (ORG-SPEC §3.2). Pure.

import type { EntityId } from "../../../shared/ids";
import type { AccessBasis } from "../../../shared/things";
import { accessFor, assignFor, type AccessAnswer } from "../../../engine/access";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { whoseOf } from "../../../engine/things";

/** The bases a vehicle's use may rest on for it to be someone's to drive. */
const DRIVES: Readonly<Partial<Record<AccessBasis, true>>> = { owner: true, member: true, position: true, delegate: true, control: true, household: true, housemate: true, partner: true, family: true, staff: true, grant: true, permit: true };

/** How the Vehicles section's level ladder reads a use: 1 their own (never through an organization that owns it), 2 a group's (their family's, their company's), 3 one assigned, lent or permitted. */
export function useTier(use: Pick<AccessAnswer, "basis" | "via">): 1 | 2 | 3 {
  return use.basis === "owner" && use.via === undefined ? 1 : use.basis === "grant" || use.basis === "permit" || use.basis === "staff" ? 3 : 2;
}

/** One vehicle someone may drive, and what their use rests on. */
export interface VehicleUse {
  id: EntityId;
  /** What their use rests on (`accessFor`). */
  use: AccessAnswer;
  /** Its first owner, stated or presumed; null when nobody owns it. */
  owner: EntityId | null;
  /** They own it themselves. */
  mine: boolean;
  /** They may lend it out or let someone use it (`assignFor`). */
  canLend: boolean;
}

/** Whether `id` is a vehicle still in play. */
export function isVehicle(ctx: Pick<ReadContext, "registry" | "world" | "state">, id: EntityId): boolean {
  const e = own(ctx.state.entities, id);
  return !!e && kindIs(ctx.registry, ctx.world, e.kind, "vehicle") && !isGone(ctx.state, id);
}

/** The vehicles `who` may drive, by id: owned, a household's or a company's, staff's, granted or permitted. */
export function vehiclesFor(ctx: ReadContext, who: EntityId): VehicleUse[] {
  const out: VehicleUse[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    if (!isVehicle(ctx, id)) continue;
    const use = accessFor(ctx, who, id).use;
    if (!use || DRIVES[use.basis] !== true) continue;
    const owner = whoseOf(ctx, id).owners[0] ?? null;
    out.push({ id, use, owner, mine: useTier(use) === 1, canLend: assignFor(ctx, who, id) !== null });
  }
  return out;
}
