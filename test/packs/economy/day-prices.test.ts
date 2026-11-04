// A catalog row's price where it is sold is one price a day (DESIGN §9.5): the Buy options and the
// narrator's prices list it, and a purchase of it there charges it, so the narrator can state the
// price the engine charges. Another day may draw another price.

import { describe, expect, test } from "bun:test";
import type { PostEvent } from "../../../src/shared/ledger";
import { PRICES_SOURCE } from "../../../src/shared/finance";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** Riverton at Money 4 with the player character at the Daybreak Café, which sells coffee and meals. */
function atCafe(): Working {
  const world = modernUsWorld("g", "R");
  world.places.cafe!.fields.tags = ["cafe"];
  world.entities.you!.fields.place = "cafe";
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

describe("a catalog row's price where it is sold", () => {
  test("a Buy of what the café lists charges the listed price, whatever the action's own draw", () => {
    for (const seed of ["a", "b", "c"]) {
      const w = atCafe();
      const [offer] = w.ctx.query("economy.offers")(w.ctx, "you");
      if (!offer) throw new Error("the café sells nothing");
      const bought = applyEffects(reg, w, [{ type: "economy.buy", args: { payer: "you", item: offer.item } }], { bindings: {}, rng: createRng(seed) });
      expect(bought.rejected).toEqual([]);
      const post = bought.applied.find((e): e is PostEvent => e.type === "post" && e.memo.startsWith("Bought"));
      // What reaches the café's side, before any sales tax: the listed price.
      expect(post?.lines.some((l) => l.amount === offer.cents)).toBe(true);
    }
  });

  test("the narrator's prices line names each offer at its listed price", () => {
    const w = atCafe();
    const offers = w.ctx.query("economy.offers")(w.ctx, "you");
    const line = reg.renderers.find((r) => r.source === PRICES_SOURCE)?.render(w.ctx)[0] ?? "";
    expect(line.startsWith("Prices at Daybreak Café, before sales tax: ")).toBe(true);
    for (const o of offers) expect(line).toContain(`${o.name} $${(o.cents / 100).toFixed(2)}`);
  });

  test("the price holds all day and is drawn again the next", () => {
    const w = atCafe();
    const today = w.ctx.query("economy.offers")(w.ctx, "you").map((o) => o.cents);
    w.state.clock += 60;
    expect(w.ctx.query("economy.offers")(w.ctx, "you").map((o) => o.cents)).toEqual(today);
    w.state.clock += 1440;
    expect(w.ctx.query("economy.offers")(w.ctx, "you").map((o) => o.cents)).not.toEqual(today);
  });
});
