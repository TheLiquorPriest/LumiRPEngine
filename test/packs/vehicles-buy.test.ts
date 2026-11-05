// Buying a vehicle (DESIGN §9.5): financed, the down payment now (the finance table's typical share
// when none is said) with the sales tax on the whole price, and the rest a car loan the vehicle
// secures, over a term lenders offer, the lender lending up to what the vehicle is worth (its price:
// a new one at its new price); the purchase's `method`: an account or card of the payer's named
// by id pays, another's is refused with the payer's choices, an id that names nothing too, and words
// go as before; and what words buy: a vehicle only when a class name ends the item's main noun and
// no other category the world prices is given.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { applyEffects } from "../../src/engine/effects";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "./riverton";
import { startState, trialBalance } from "./support";

const reg = createRegistry(ALL_PACKS);

/** Riverton with Alex's checking at $60,000, a rainy-day fund of his own and Maya's checking, his money opened. */
function riverton(patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.entities.checking!.fields.opening = 6_000_000;
  world.entities.rainy = { id: "rainy", kind: "account", name: "Rainy day fund", tier: "background", fields: { owner: "you", type: "savings", opening: 9_000_000 }, relations: [] };
  world.entities.maya_checking = { id: "maya_checking", kind: "account", name: "Maya's checking", tier: "background", fields: { owners: [{ party: "maya", role: "owner" }], product: "checking", opening: 9_000_000 }, relations: [] };
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

/** A purchase as the reply's read plays it: its channel's refusal code, else the effects' first refusal (code and reason), else null. */
function buy(w: Working, p: JsonObject): { code: string; reason: string } | null {
  const channel = reg.proposals.get("purchase");
  if (!channel) throw new Error("no purchase channel");
  const fact = { type: "purchase", payer: "you", category: "vehicles", ...p };
  const bad = channel.validate(fact, w.ctx);
  if (bad) return { code: bad.code, reason: bad.reason };
  const r = applyEffects(reg, w, channel.toEffects(fact, w.ctx), { bindings: { self: w.world.pov }, rng: createRng("buy") });
  const refused = r.rejected[0]?.rejection;
  return refused ? { code: refused.code, reason: refused.reason } : null;
}

/** The vehicles bought in play (made by the story), by id. */
const bought = (w: Working): string[] => Object.keys(w.state.entities).filter((id) => w.state.entities[id]?.kind === "vehicle" && (w.state.entities[id]?.fields.got as JsonObject | undefined)?.how === "bought");

/** The journal's "Bought …" lines of Alex's accounts, with the account and what each charged. */
function charges(w: Working): { account: string; memo: string; cents: number }[] {
  const out: { account: string; memo: string; cents: number }[] = [];
  for (const e of w.events) if (e.type === "post" && e.memo.startsWith("Bought ")) for (const l of e.lines) if (l.amount < 0 && !l.account.startsWith("economy.external:")) out.push({ account: l.account, memo: e.memo, cents: -l.amount });
  return out;
}

/** The sales tax a purchase paid its region's authority, in all. */
function salesTax(w: Working): number {
  let cents = 0;
  for (const e of w.events) if (e.type === "post") for (const l of e.lines) if (l.account.startsWith("economy.external:tax:sales:")) cents += l.amount;
  return cents;
}

describe("a vehicle bought on a loan", () => {
  test("a new pickup with $5,000 down: the down payment is charged, the rest a car loan the pickup secures over 60 months, and the pickup is worth its new price", () => {
    const w = riverton();
    expect(buy(w, { item: "a new pickup truck", finance: { down: 500_000, term: 60 } })).toBeNull();
    const [truck] = bought(w);
    expect(truck).toBeDefined();
    expect(w.state.entities[truck ?? ""]?.fields).toMatchObject({ class: "pickup_fullsize", owner: "you", value: 5_800_000, condition: 100, odometer_mi: 10 });
    expect(charges(w).map((c) => [c.account, c.memo])).toEqual([["checking", "Bought Pickup truck, $5,000.00 down"]]);
    // The car loan: the rest of the new price, secured by the pickup, over the term asked.
    const loan = w.state.entities[`${truck}:loan`];
    expect(loan?.name).toBe("Car loan, Pickup truck");
    expect(loan?.fields).toMatchObject({ product: "loan", secured_by: truck, term_months: 60 });
    const paidOut = w.events.find((e) => e.type === "post" && e.memo === "Car loan, Pickup truck: loan paid out");
    expect(paidOut?.type === "post" ? paidOut.lines.find((l) => l.account === `${truck}:loan`)?.amount : null).toBe(-5_300_000);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("no down payment said is the finance table's typical share; a term no lender offers is refused, and nothing is bought", () => {
    const w = riverton();
    expect(buy(w, { item: "a used pickup", finance: { term: 48 } })).toBeNull();
    // 12% of the used pickup's $38,000.
    expect(charges(w).map((c) => c.memo)).toEqual(["Bought Pickup, $4,560.00 down"]);
    const [truck] = bought(w);
    expect(w.state.entities[`${truck}:loan`]?.fields).toMatchObject({ product: "loan", secured_by: truck, term_months: 48 });
    const other = riverton();
    expect(buy(other, { item: "a used pickup", finance: { down: 500_000, term: 7 } })).toEqual({ code: "bad_term", reason: "car loans run 36 to 84 months" });
    expect(bought(other)).toEqual([]);
    expect(charges(other)).toEqual([]);
  });

  test("paid whole, there is no loan; the purchase's `down` and `term_months` finance it as `finance` does", () => {
    const w = riverton();
    expect(buy(w, { item: "a used sedan" })).toBeNull();
    const [sedan] = bought(w);
    expect(w.state.entities[`${sedan}:loan`]).toBeUndefined();
    expect(charges(w).map((c) => c.memo)).toEqual(["Bought Sedan"]);
    const loaned = riverton();
    expect(buy(loaned, { item: "a used sedan", down: 300_000, term_months: 36 })).toBeNull();
    const [car] = bought(loaned);
    expect(loaned.state.entities[`${car}:loan`]?.fields).toMatchObject({ secured_by: car, term_months: 36 });
  });

  test("the sales tax is on the whole price: paid with the down payment, or alone with nothing down, as much as paid whole", () => {
    // Riverton names no tax region: the national rate, 7%, of the new pickup's $58,000, not of the $5,000 down.
    const w = riverton();
    expect(buy(w, { item: "a new pickup truck", finance: { down: 500_000, term: 60 } })).toBeNull();
    expect(salesTax(w)).toBe(406_000);
    expect(charges(w)).toEqual([{ account: "checking", memo: "Bought Pickup truck, $5,000.00 down", cents: 500_000 + 406_000 }]);
    expect(trialBalance(w.state)).toBe(0);
    // Nothing down: the tax on the used sedan's $21,000 alone now, the whole price lent.
    const none = riverton();
    expect(buy(none, { item: "a used sedan", finance: { down: 0, term: 60 } })).toBeNull();
    expect(charges(none).map((c) => [c.memo, c.cents])).toEqual([["Bought Sedan, nothing down", 147_000]]);
    const [sedan] = bought(none);
    const paidOut = none.events.find((e) => e.type === "post" && e.memo === "Car loan, Sedan: loan paid out");
    expect(paidOut?.type === "post" ? paidOut.lines.find((l) => l.account === `${sedan}:loan`)?.amount : null).toBe(-2_100_000);
    expect(trialBalance(none.state)).toBe(0);
    // Paid whole, the same sedan pays the same tax.
    const whole = riverton();
    expect(buy(whole, { item: "a used sedan" })).toBeNull();
    expect([salesTax(whole), salesTax(none)]).toEqual([147_000, 147_000]);
  });
});

describe("a purchase's method names what pays", () => {
  test("an account of the payer's named by id pays, though it is no account by words", () => {
    const w = riverton();
    expect(buy(w, { item: "a used sedan", method: "rainy" })).toBeNull();
    expect(charges(w).map((c) => c.account)).toEqual(["rainy"]);
  });

  test("another's account by id is refused, naming what the payer may pay from; an id that names nothing too; nothing is bought", () => {
    const w = riverton();
    const choices = "Cash (cash), Checking (checking), Rainy day fund (rainy), Savings (savings), Visa card (card)";
    expect(buy(w, { item: "a used pickup", method: "maya_checking" })).toEqual({ code: "bad_method", reason: `Alex Rivera can't pay from Maya's checking; they can pay from ${choices}` });
    expect(buy(w, { item: "a used pickup", method: "acct_nobody" })).toEqual({ code: "bad_method", reason: `no account or card acct_nobody; Alex Rivera can pay from ${choices}` });
    expect(bought(w)).toEqual([]);
    expect(charges(w)).toEqual([]);
  });

  test("words that say a way of paying go as before: the debit card pays from checking", () => {
    const w = riverton((world) => {
      world.entities.debit = { id: "debit", kind: "card", name: "Debit card", tier: "background", fields: { account: "checking", holder: "you", network: "debit", state: "active" }, relations: [] };
    });
    expect(buy(w, { item: "a used sedan", method: "debit card" })).toBeNull();
    expect(charges(w).map((c) => c.account)).toEqual(["checking"]);
  });
});

describe("what a purchase's words buy", () => {
  /** A purchase as the reply's read gives it, no category said unless `category`; whether it is unpriced, then what it bought: the vehicles made, by class, and what it charged. */
  function bought(item: string, more: JsonObject = {}): { unpriced: boolean; vehicles: unknown[]; cents: number[] } {
    const w = riverton();
    const fact = { type: "purchase", payer: "you", item, ...more };
    const unpriced = w.ctx.query("economy.unpriced")(w.ctx, fact);
    expect(buy(w, { category: "", item, ...more })).toBeNull();
    const made = Object.values(w.state.entities).filter((e) => e.kind === "vehicle" && (e.fields.got as JsonObject | undefined)?.how === "bought");
    return { unpriced, vehicles: made.map((e) => e.fields.class), cents: charges(w).map((c) => c.cents) };
  }

  test("a class name that ends the item's main noun is a vehicle of that class, the longest name that does: a flatbed truck, a jet ski, a truck for work, a Cessna 172", () => {
    // The used price of each, and the national 7% sales tax on it.
    expect(bought("flatbed truck")).toEqual({ unpriced: false, vehicles: ["pickup_heavy_duty_diesel"], cents: [5_350_000] });
    expect(bought("jet ski")).toEqual({ unpriced: false, vehicles: ["jet_ski_pwc"], cents: [909_500] });
    expect(bought("a truck for work")).toEqual({ unpriced: false, vehicles: ["pickup_fullsize"], cents: [4_066_000] });
    expect(bought("Cessna 172").vehicles).toEqual(["small_plane"]);
  });

  test("a class word that only says what another thing is of or for buys no vehicle: a plane ticket, a bus pass, car insurance, groceries for the boat are priced as themselves", () => {
    for (const item of ["plane ticket", "bus pass", "car insurance", "groceries for the boat"]) {
      // Nothing prices it: the payer's with nothing charged until a price is set, never a vehicle's price.
      expect([item, bought(item)]).toEqual([item, { unpriced: true, vehicles: [], cents: [] }]);
      // At the price the story told ($300, in cents as the read gives it): that price and its tax, nothing more.
      expect([item, bought(item, { price: 30_000 })]).toEqual([item, { unpriced: false, vehicles: [], cents: [32_100] }]);
    }
  });

  test("another category the world prices is never a vehicle by its words: a toy truck bought as a gift is a gift", () => {
    expect(bought("toy truck", { category: "gifts", price: 3_000 })).toEqual({ unpriced: false, vehicles: [], cents: [3_210] });
    // Its words alone would make it a truck: the category given is what keeps it a toy.
    expect(bought("toy truck").vehicles).toEqual(["pickup_fullsize"]);
  });
});
