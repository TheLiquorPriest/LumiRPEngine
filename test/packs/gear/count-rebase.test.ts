// A count a reply changed folds right over another parent (DESIGN §4.3 rebase): a stacked hand-over
// and a thing used up record how much the count moved, never the total it came to on the head.

import { describe, expect, test } from "bun:test";
import { applyProposals } from "../../../src/backend/turn-model";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function bandages(): { world: WorldDoc; s0: WorldState } {
  const world = modernUsWorld("w", "R");
  const s0 = startState(world);
  s0.entities.bandages = { kind: "item", name: "Bandage", tier: "background", fields: { owner: "you", qty: 3, notable: true }, relations: [{ type: "in", to: "you" }], levels: {}, agent: false };
  return { world, s0 };
}

/** The bandages' count once `events` fold over a parent holding `qty` of them. */
function over(world: WorldDoc, s0: WorldState, events: readonly LedgerEvent[], qty: number): unknown {
  const parent = structuredClone(s0);
  const b = parent.entities.bandages;
  if (b) b.fields.qty = qty;
  const view = new Working(reg, world, parent);
  view.applyAll(events);
  return view.state.entities.bandages?.fields.qty;
}

describe("counts over another parent", () => {
  test("a bandage handed over and stacked adds one to whatever the parent holds", () => {
    const { world, s0 } = bandages();
    const w = new Working(reg, world, s0);
    const out = applyEffects(reg, w, [{ type: "gear.receive", args: { name: "Bandage", to: "you", from: "maya" } }], { bindings: { self: "you" }, rng: createRng("m") });
    expect(w.state.entities.bandages?.fields.qty).toBe(4);
    expect(over(world, s0, out.applied, 1)).toBe(2);
  });

  test("a bandage used up takes one from whatever the parent holds", () => {
    const { world, s0 } = bandages();
    const [o] = applyProposals(reg, new Working(reg, world, s0), [{ type: "use_up", entity: "you", item: "bandages", qty: 1 }], "seed", "run");
    if (!o || o.rejection) throw new Error("use_up refused");
    expect(over(world, s0, o.events, 5)).toBe(4);
  });
});
