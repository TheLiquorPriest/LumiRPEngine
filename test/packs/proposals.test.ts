// Narration proposals the extractor makes from real replies: uncatalogued purchases at their
// narrated price, NPCs handing over untracked items, and "Pay another way" retries.
import { describe, expect, test } from "bun:test";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { materializeAll } from "../../src/engine/materialize";
import { ALL_PACKS } from "../../src/packs/index";
import { buildMoneyView } from "../../src/packs/economy/core/view";
import { buildGearView } from "../../src/packs/gear/core/view";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

const reg = createRegistry(ALL_PACKS);

function setup(): Working {
  const world = modernUsWorld("p", "R");
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function propose(w: Working, type: string, p: Record<string, string | number>): ReturnType<typeof applyEffects> | string {
  const ch = reg.proposals.get(type);
  const bad = ch?.validate(p, w.ctx);
  if (bad) return bad.code;
  return applyEffects(reg, w, ch?.toEffects(p, w.ctx) ?? [], { bindings: {}, rng: createRng("p") });
}

describe("narration proposals", () => {
  test("an uncatalogued purchase is charged at its narrated price (capped); without a price it is refused", () => {
    const w = setup();
    expect(propose(w, "purchase", { item: "gum", name: "a pack of gum" })).toBe("unpriced");
    const r = propose(w, "purchase", { item: "gum", name: "a pack of gum", price: 200 });
    expect(typeof r === "string" ? r : r.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Bought a pack of gum")?.cents).toBe(-200);
    propose(w, "purchase", { item: "antique clock", price: 9_000_000 });
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Bought antique clock")?.cents).toBe(-50000);
  });

  test("an NPC can hand the POV an item the world didn't track; the POV can't give what it doesn't have", () => {
    const w = setup();
    const r = propose(w, "give", { item: "thermos", from: "maya", to: "you" });
    expect(typeof r === "string" ? r : r.rejected).toEqual([]);
    expect(Object.values(w.state.entities).some((e) => e.name === "thermos" && e.fields.owner === "you")).toBe(true);
    expect(propose(w, "give", { item: "sandwich", from: "you", to: "maya" })).toBe("missing_entity");
  });

  test("Pay another way: a purchase retried with a method or a specific account pays from it", () => {
    const w = setup();
    const r = propose(w, "purchase", { category: "electronics", name: "a speaker", method: "savings" });
    expect(typeof r === "string" ? r : r.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Bought a speaker")?.account).toBe("Savings");
    const s = propose(w, "purchase", { category: "electronics", name: "a cable", from: "card" });
    expect(typeof s === "string" ? s : s.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Bought a cable")?.account).toBe("Visa card");
  });

  test("the Buy action takes an optional stated price: an uncatalogued item at that price, a catalog item without one", () => {
    const w = setup();
    const gum = resolveAction(reg, w, { action: "buy", params: { item: "gum", price: 200 } }, createRng("g"));
    expect(gum.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Bought gum")?.cents).toBe(-200);
    const milk = resolveAction(reg, w, { action: "buy", params: { item: "milk_whole" } }, createRng("m"));
    expect(milk.ok).toBe(true);
    expect(milk.rejected).toEqual([]);
    // The player's own stated price isn't capped like a narrated one: above what they can pay, it declines.
    const outboard = resolveAction(reg, w, { action: "buy", params: { item: "spare outboard engine", price: 900_000 } }, createRng("o"));
    expect(outboard.rejected[0]?.rejection.code).toBe("declined");
    expect(buildMoneyView(w.ctx).recent.some((t) => t.memo === "Bought spare outboard engine")).toBe(false);
    const kayak = resolveAction(reg, w, { action: "buy", params: { item: "used kayak", price: 90_000 } }, createRng("k"));
    expect(kayak.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Bought used kayak")?.cents).toBe(-90_000);
  });

  test("free-text buys match a catalog row, preferring what the place sells: beers at a bar are pints", () => {
    const w = setup();
    w.world.places.cafe!.fields.tags = ["bar"];
    w.state.entities.you!.fields.place = "cafe";
    const beer = resolveAction(reg, w, { action: "buy", params: { item: "a round of beers" } }, createRng("b"));
    expect(beer.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.some((t) => t.memo.startsWith("Bought Beer at a bar"))).toBe(true);
    expect(propose(w, "purchase", { item: "beers" })).not.toBe("unpriced");
    expect(resolveAction(reg, w, { action: "buy", params: { item: "a unicorn" } }, createRng("u")).rejected[0]?.rejection.code).toBe("unpriced");
    const pizza = resolveAction(reg, w, { action: "buy", params: { item: "a large pepperoni pizza for delivery" } }, createRng("p"));
    expect(pizza.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).recent.some((t) => t.memo.startsWith("Bought Pizza, large"))).toBe(true);
  });

  test("losing the wallet loses the cash in it, posted out of the books; the wallet shows as lost", () => {
    const w = setup();
    const cashBefore = buildMoneyView(w.ctx).accounts.find((a) => a.id === "cash")?.cents ?? 0;
    expect(cashBefore).toBeGreaterThan(0);
    const lost = resolveAction(reg, w, { action: "lose", params: { item: "wallet" } }, createRng("l"));
    expect(lost.rejected).toEqual([]);
    expect(buildMoneyView(w.ctx).accounts.find((a) => a.id === "cash")?.cents).toBe(0);
    expect(buildMoneyView(w.ctx).recent.find((t) => t.memo === "Lost with Wallet")?.cents).toBe(-cashBefore);
    expect(w.state.entities.wallet?.relations.some((r) => r.type === "in")).toBe(false);
    expect(buildGearView(w.ctx).owned.some((i) => i.name === "Wallet (lost)")).toBe(true);
    // Already lost: the palette no longer offers it (the effect would refuse it too).
    expect(resolveAction(reg, w, { action: "lose", params: { item: "wallet" } }, createRng("l2")).failed?.requirement).toBe("item.lost != true");
  });

  test("economy.offers lists what the place sells, quoted there, in a stable order", () => {
    const w = setup();
    w.world.places.cafe!.fields.tags = ["cafe"];
    w.state.entities.you!.fields.place = "cafe";
    const offers = w.ctx.query("economy.offers")(w.ctx, "you");
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(24);
    expect(new Set(offers.map((o) => o.category))).toEqual(new Set(["coffee", "meals_out"].filter((c) => offers.some((o) => o.category === c))));
    expect(offers.every((o) => o.cents > 0 && o.name !== "")).toBe(true);
    expect(w.ctx.query("economy.offers")(w.ctx, "you")).toEqual(offers);
    w.state.entities.you!.fields.place = "park";
    expect(w.ctx.query("economy.offers")(w.ctx, "you")).toEqual([]);
  });
});
