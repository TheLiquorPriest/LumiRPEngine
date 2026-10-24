// The minds pack's services and queries, as the engine and other packs call them by name (DESIGN
// §24; ARCHITECTURE §5). Other packs never import this pack: they reach it only through these.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import type { Fidelity, FidelityScore, FidelityTexts, MindEditOp, MindPlan } from "../../../shared/minds";
import type { ReadContext, Rejection } from "../../../engine/registry";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** A GM minds control (`lre.edit`'s `mind_*` operations) as the events of its `fix` entry, or why it can't apply. */
    "minds.edit": (ctx: ReadContext, op: MindEditOp) => LedgerEvent[] | Rejection;
  }
  interface QueryMap {
    /** A character's plans in force as kept (the memory step's and the GM's, never a mind's own: `planInForce`), open and settled, soonest first: the castlife planner lays open ones into their day, and settled ones for the times before they were settled. */
    "minds.plans": (ctx: ReadContext, who: EntityId) => MindPlan[];
    /** A character's fidelity as recorded, with no turn texts: the GM's pin, else the level their mind was last due at, called or not (`lastDue`), else Background. */
    "minds.tier": (ctx: ReadContext, who: EntityId) => Fidelity;
    /**
     * The people the Minds section tells of this round: in the POV's scene now (`together`) and visible to it, or
     * whose mind interrupted a skip. Stance leaves them out (DESIGN §6.6, §24.3). The engine run's
     * context gives only those whose line fit the section's budget, so Stance tells of the rest.
     */
    "minds.minded": (ctx: ReadContext) => EntityId[];
    /** Whether minds were on at the chat's latest round: the castlife planner's formula invitations run only while they're off. */
    "minds.on": (ctx: ReadContext) => boolean;
    /** Whether the GM set what a character means to do now, in words (DESIGN §24.9): their routine gives way to it (§8). */
    "minds.intent": (ctx: ReadContext, who: EntityId) => boolean;
    /** Every character's fidelity now, best score first (DESIGN §24.1); texts empty inside `advance` and at a beat. */
    "minds.fidelity": (ctx: ReadContext, texts: FidelityTexts) => FidelityScore[];
  }
}
