// A reply's proposals through their channels (DESIGN §9.4), as the tests of the move path, a life state, a count
// and a power apply them: the people each names are materialized first, then the channel validates and its
// effects apply in order on `w`; a rejected proposal applies nothing, its materialization included.

import type { JsonObject } from "../../src/shared/json";
import { hasOwn } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { applyEffects } from "../../src/engine/effects";
import { materializeAll } from "../../src/engine/materialize";
import type { Rejection } from "../../src/engine/registry";
import type { Registry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import type { Working } from "../../src/engine/working";

export interface ProposalOutcome {
  proposal: JsonObject;
  events: LedgerEvent[];
  materialized: LedgerEvent[];
  rejection: Rejection | null;
}

/** The proposal fields that name the people a change reads (a payer's accounts, a recipient's pockets). */
const NAMED = ["from", "to", "payer", "who", "entity"] as const;

export function applyProposals(registry: Registry, w: Working, proposals: readonly JsonObject[], seed: string, runSeed: string, first = 0): ProposalOutcome[] {
  const out: ProposalOutcome[] = [];
  proposals.forEach((proposal, at) => {
    const i = first + at;
    const type = typeof proposal.type === "string" ? proposal.type : "";
    const channel = registry.proposals.get(type);
    if (!channel) {
      out.push({ proposal, events: [], materialized: [], rejection: { code: "unknown_channel", reason: `no channel for ${type}` } });
      return;
    }
    const mark = w.mark();
    const named = NAMED.map((k) => proposal[k]).filter((id): id is string => typeof id === "string" && hasOwn(w.state.entities, id));
    const materialized: LedgerEvent[] = [...new Set(named)].flatMap((id) => materializeAll(registry, w, id, runSeed));
    const rejection = channel.validate(proposal, w.ctx);
    if (rejection) {
      w.restore(mark);
      // An unseen refusal reads as a change that changed nothing: no rejection for a chip or a note to word.
      out.push(rejection.unseen ? { proposal, events: [], materialized: [], rejection: null } : { proposal, events: [], materialized: [], rejection });
      return;
    }
    const result = applyEffects(registry, w, channel.toEffects(proposal, w.ctx), { bindings: { self: w.world.pov }, rng: createRng(`${seed}:proposal:${i}`) });
    const failed = result.rejected[0];
    if (failed) {
      w.restore(mark);
      out.push({ proposal, events: [], materialized: [], rejection: failed.rejection });
      return;
    }
    out.push({ proposal, events: result.applied, materialized, rejection: null });
  });
  return out;
}
