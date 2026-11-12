// Listing a company and trading its stock (ORG-SPEC §10 lane Z, Phase 5; DESIGN §27.10 Listing) on
// Port Alder. Jordan founds Ellis Mobile Repair in 1,000 units, makes it a C corporation and lists
// 500 new units at $2: the market pays $1,000 into its account, its owners list keeps Jordan's 1,000
// and the public holds the float, so his share is two thirds. The public pays no more than its books
// a unit (once listed, its market price), times the config's multiple. Its price is marked each
// trading day around its books a unit, the index history moving it (deterministic: with a correlation
// of 1 no chat's seed touches it). Danny buys on the market within the float and sells; no option is
// written on it, and a call brings no more than the float has left; the cap table shows him and the
// public; a payout pays the float's part by units, adding up whoever holds it; Jordan sells
// registered units into the float; going off the market buys every public unit back. A company of a
// kind made from business lists as any; one hidden from a reader isn't offered them. The whole
// scenario folds back to the same state.

import { describe, expect, test } from "bun:test";
import { listingIn, type OwnershipView } from "../../../src/shared/finance";
import { hashJson } from "../../../src/shared/hash";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { OrgView } from "../../../src/shared/org-view";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { assetOf, dateText, quoteOf } from "../../../src/packs/economy/core/assets";
import { holdingIds, holdingValue, listedFloat } from "../../../src/packs/economy/core/holdings";
import { shareOf } from "../../../src/packs/economy/core/model";
import { listedStep } from "../../../src/packs/economy/core/pricing";
import { gainsIn, incomeIn } from "../../../src/packs/economy/core/records";
import { votesIn } from "../../../src/packs/economy/core/shares";
import { marketValueOf } from "../../../src/packs/economy/core/stakes";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const SHOP = "alder_automotive_co";
const STOCK = `stock:${EMR}`;
const DAY = 1440;
const NOTES = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } as const;

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, MARCUS, SHOP]) materializeAll(reg, w, id, "listing");
  return w;
}

/** The economy config, patched. */
function config(values: JsonObject): (world: WorldDoc) => void {
  return (world) => {
    const economy = world.packs.economy;
    if (economy) economy.config = { ...(economy.config as JsonObject), ...values };
  };
}

function act(w: Working, actor: string, action: string, params: JsonObject, seed = "listing"): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: seed });
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

function owners(w: Working, id: string): JsonValue {
  return w.state.entities[id]?.fields.owners ?? null;
}

function account(w: Working, business: string): string {
  return String(w.state.entities[business]?.fields.operating_account ?? "");
}

function balance(w: Working, id: string): number {
  return w.state.accounts[id] ?? 0;
}

/** Ellis Mobile Repair, founded by Jordan with $2,000 from his savings in 1,000 units, then made a C corporation. */
function corporation(w: Working): void {
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
  expect(why(act(w, JORDAN, "org_restructure", { org: EMR, structure: "c_corp" }))).toBe("");
}

/** Ellis Mobile Repair listed: 500 new units at $2. */
function listed(w: Working): Resolution {
  corporation(w);
  const r = act(w, JORDAN, "shares_list", { business: EMR, units: 500, price: 200 });
  expect(why(r)).toBe("");
  return r;
}

/** The company's Ownership as the player character reads it. */
function ownership(w: Working, org: EntityId = EMR): OwnershipView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  const built = pages[org]?.sections.ownership;
  if (!built) throw new Error(`no ownership on ${org}'s page`);
  return built as unknown as OwnershipView;
}

/** Time passes by `days` days, the world's processes running (the market among them). */
function lapse(w: Working, days: number, seed = "listing"): void {
  const to = w.state.clock + days * DAY;
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: seed, overrides: NOTES });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** The marks the market recorded for the stock, in order. */
function marks(w: Working): number[] {
  return w.events.flatMap((e) => (e.type === "economy.quote" && "data" in e && e.data.asset === STOCK && typeof e.data.price === "number" ? [e.data.price] : []));
}

/** Danny's holding of the stock. */
function dannys(w: Working): EntityId {
  const id = holdingIds(w.state).find((h) => w.state.entities[h]?.fields.asset === STOCK && JSON.stringify(w.state.entities[h]?.fields).includes(DANNY));
  if (!id) throw new Error("Danny holds no EMR");
  return id;
}

describe("listing Ellis Mobile Repair", () => {
  test("500 new units at $2 as one unit: the market pays $1,000 in, Jordan keeps his 1,000 rows and holds two thirds", () => {
    const w = portAlder();
    corporation(w);
    const till = balance(w, account(w, EMR));
    const r = act(w, JORDAN, "shares_list", { business: EMR, units: 500, price: 200 });
    expect(why(r)).toBe("");
    expect(owners(w, EMR)).toEqual([{ party: JORDAN, role: "owner", share: 100, units: 1000 }]);
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})).toEqual({ asset: STOCK, symbol: "EMR", float: 500, since: w.state.clock, price: 200 });
    expect(balance(w, account(w, EMR))).toBe(till + 100_000);
    expect(shareOf(w.state, EMR, JORDAN)).toBeCloseTo(66.6667, 3);
    expect(votesIn(w.state, EMR)[JORDAN]).toBeCloseTo(66.6667, 3);
    expect(quoteOf(w.ctx, STOCK)).toBe(200);
    expect(assetOf(w.ctx, STOCK)).toMatchObject({ label: "Ellis Mobile Repair", class: "security", symbol: "EMR", entity: EMR, pays: 0 });
    expect(orgHistory(w.state, EMR)[0]).toMatchObject({ text: "Listed 500 units on the market as EMR at $2.00 a unit ($1,000.00)", by: JORDAN, power: "shares.manage" });
    // One unit: the listing, the market's payment, the day's mark and the History line.
    const group = r.events.find((e) => e.type === "economy.quote")?.group;
    expect(group).toBeDefined();
    expect(r.events.filter((e) => e.group === group).map((e) => e.type)).toEqual(expect.arrayContaining(["set", "post", "economy.quote", "orgs.log"]));
    // Its value is the market's: $2 times all 1,500 units.
    expect(marketValueOf(w.ctx, EMR)).toEqual({ price: 200, units: 1500 });
    // While listed it stays a C corporation.
    expect(why(act(w, JORDAN, "org_restructure", { org: EMR, structure: "llc" }))).toBe("Ellis Mobile Repair is on a market: take it off the market before it stops being a C corporation");
  });

  test("an LLC is refused, and so is a holder with 40 % of the votes", () => {
    const w = portAlder();
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
    expect(why(act(w, JORDAN, "shares_list", { business: EMR, units: 500, price: 200 }))).toBe("Only a C corporation lists on a market: change Ellis Mobile Repair's structure first");
    expect(why(act(w, JORDAN, "org_restructure", { org: EMR, structure: "c_corp" }))).toBe("");
    expect(gm(w, "economy.shares_issue", { business: EMR, to: DANNY, units: 1500, price: 100 })).toBe("");
    expect(why(act(w, JORDAN, "shares_list", { business: EMR, units: 500, price: 200 }))).toBe("Listing Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%");
    expect(w.state.entities[EMR]?.fields.listing).toBeUndefined();
  });
});

describe("what the public pays for new units", () => {
  test("no more than its books a unit, then its market price; the config's multiple lifts both", () => {
    const w = portAlder();
    corporation(w);
    // Two turns to unlimited money no more: a unit at $1,000,000 is refused, and nothing is listed.
    expect(why(act(w, JORDAN, "shares_list", { business: EMR, units: 1, price: 100_000_000 }))).toBe("the public pays no more than its books a unit for new units of Ellis Mobile Repair, $2.00 a unit");
    expect(w.state.entities[EMR]?.fields.listing).toBeUndefined();
    // With no price it lists at its books a unit; more units go at no more than the market price.
    expect(why(act(w, JORDAN, "shares_list", { business: EMR, units: 500 }))).toBe("");
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})).toMatchObject({ float: 500, price: 200 });
    expect(gm(w, "economy.set_price", { asset: STOCK, price: 300 })).toBe("");
    expect(why(act(w, JORDAN, "shares_list", { business: EMR, units: 100, price: 301 }))).toBe("the public pays no more than its market price for new units of Ellis Mobile Repair, $3.00 a unit");
    const till = balance(w, account(w, EMR));
    expect(why(act(w, JORDAN, "shares_list", { business: EMR, units: 100 }))).toBe("");
    expect(balance(w, account(w, EMR))).toBe(till + 30_000);
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})?.float).toBe(600);
    // Where Build lets the public pay up to twice what the units are worth.
    const twice = portAlder(config({ listingOfferCap: 2 }));
    corporation(twice);
    expect(why(act(twice, JORDAN, "shares_list", { business: EMR, units: 500, price: 401 }))).toBe("the public pays no more than 2 times its books a unit for new units of Ellis Mobile Repair, $4.00 a unit");
    expect(why(act(twice, JORDAN, "shares_list", { business: EMR, units: 500, price: 400 }))).toBe("");
  });

  test("a company of a kind made from business lists and trades as any; one hidden from a reader isn't offered them", () => {
    const w = portAlder((world) => {
      world.kinds.garage = { id: "garage", label: "Garage", extends: "business", fields: {} };
      const shop = world.entities[SHOP];
      if (!shop) throw new Error("no shop");
      // Its books $20 a unit over the 1,000 units it counts its owner in.
      world.entities[SHOP] = { ...shop, kind: "garage", fields: { ...shop.fields, structure: "c_corp", value: 2_000_000 } };
    });
    expect(gm(w, "economy.list", { business: SHOP, units: 500, price: 2000 })).toBe("");
    const stock = `stock:${SHOP}`;
    expect(assetOf(w.ctx, stock)).toMatchObject({ class: "security", entity: SHOP, symbol: "AA" });
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: stock, qty: 10 }))).toBe("");
    expect(listedFloat(w.ctx, stock)).toEqual({ business: SHOP, float: 500, held: 10, left: 490 });
    const offered = (v: Working, who: EntityId): string[] => (v.ctx.query("economy.finance")(v.ctx, who, true).investments?.market ?? []).map((m) => m.asset);
    expect(offered(w, JORDAN)).toContain(stock);
    // Hidden from everyone, its name and ticker are offered to no one.
    const hidden = portAlder((world) => {
      const shop = world.entities[SHOP];
      if (!shop) throw new Error("no shop");
      world.entities[SHOP] = { ...shop, visibility: "secret", fields: { ...shop.fields, structure: "c_corp", value: 2_000_000 } };
    });
    expect(gm(hidden, "economy.list", { business: SHOP, units: 500, price: 2000 })).toBe("");
    listed(hidden);
    expect(offered(hidden, DANNY)).toContain(STOCK);
    expect(offered(hidden, DANNY)).not.toContain(stock);
  });
});

describe("its price", () => {
  test("a step returns toward the books a unit and takes the shock", () => {
    // No shock: the gap to the books shrinks by e^(-κ·dt).
    expect(listedStep(200, 800, 2, 28, 1 / 252, 0)).toBeCloseTo(800 * Math.exp(Math.log(200 / 800) * Math.exp(-2 / 252)), 9);
    // At the books with no shock it stays; a good day lifts it.
    expect(listedStep(800, 800, 2, 28, 1 / 252, 0)).toBeCloseTo(800, 9);
    expect(listedStep(800, 800, 2, 28, 1 / 252, 1)).toBeGreaterThan(800);
    // Never below a minor unit's anchor, never at nothing.
    expect(listedStep(5, 0, 2, 28, 1 / 252, -3)).toBeGreaterThan(0);
  });

  test("the market marks it each trading day: the same marks again on the same seed, and with a correlation of 1 under any seed", () => {
    const run = (seed: string, patch?: (world: WorldDoc) => void): number[] => {
      const w = portAlder(patch);
      listed(w);
      lapse(w, 14, seed);
      return marks(w);
    };
    const first = run("one");
    expect(first.length).toBeGreaterThan(8);
    expect(run("one")).toEqual(first);
    // The stock's own draw follows the chat's seed; at a correlation of 1 only the books and the index move it.
    const market = config({ listingCorrelation: 1 });
    expect(run("one", market)).toEqual(run("two", market));
    // Four Port Alders, each marked through 14 trading days, take a while.
  }, 30_000);

  test("it follows the books: valued at four times as much, its price climbs toward the new books a unit", () => {
    const w = portAlder(config({ listingReversion: 50 }));
    listed(w);
    // The GM values it at $12,000: $8 a unit over its 1,500 units.
    expect(w.apply({ type: "set", entity: EMR, field: "value", value: 1_200_000 })).toBeNull();
    expect(w.ctx.query("economy.fair_unit")(w.ctx, EMR)).toBe(800);
    lapse(w, 21);
    const price = quoteOf(w.ctx, STOCK) ?? 0;
    expect(price).toBeGreaterThan(500);
    expect(price).toBeLessThan(1300);
  });
});

describe("trading it", () => {
  test("Danny buys within the float and sells; the company can't buy its own, and Jordan's cap-table units sell as a stake", () => {
    const w = portAlder();
    listed(w);
    const danny = balance(w, "acct_danny_checking");
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 100 }))).toBe("");
    expect(balance(w, "acct_danny_checking")).toBe(danny - 20_000);
    expect(listedFloat(w.ctx, STOCK)).toEqual({ business: EMR, float: 500, held: 100, left: 400 });
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 500 }))).toBe("Only 400 units of EMR are for sale on the market");
    expect(gm(w, "economy.trade", { side: "buy", party: EMR, asset: STOCK, qty: 10 })).toBe("Ellis Mobile Repair takes its own units back by buying back shares or going off the market");
    expect(gm(w, "economy.trade", { side: "sell", party: JORDAN, asset: STOCK, qty: 10 })).toBe("Jordan Ellis holds Ellis Mobile Repair's units on its cap table, not on the market: sell them as a stake");
    // At $3 Danny sells 40, realising $40 of gain.
    expect(gm(w, "economy.set_price", { asset: STOCK, price: 300 })).toBe("");
    expect(why(act(w, DANNY, "trade", { side: "sell", asset: STOCK, qty: 40 }))).toBe("");
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect(gainsIn(w.state, DANNY, year).short).toBe(4_000);
    expect(holdingValue(w.ctx, dannys(w))).toBe(18_000);
  });
});

describe("options on its stock", () => {
  test("no contract is written on it, and an authored call brings no more units than the float has left", () => {
    const w = portAlder(config({ features: { options: true } }));
    listed(w);
    const expiry = dateText(w.world, w.state.clock + 90 * DAY);
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 1, right: "call", strike: 200, expiry }))).toBe("no options are written on Ellis Mobile Repair's stock: its units sell only from its float");
    // A call the world itself lists on the stock: Danny holds 450 of the 500 public units, then buys one contract (100 units).
    const economy = w.world.packs.economy;
    if (!economy) throw new Error("no economy");
    economy.config = { ...(economy.config as JsonObject), assets: { ...((economy.config as JsonObject).assets as JsonObject), emr_call: { label: "EMR call", class: "option", underlying: STOCK, strike: 100, expiry, right: "call", multiplier: 100, settlement: "physical" } } };
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 450 }))).toBe("");
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: "emr_call", qty: 1 }))).toBe("");
    const contract = holdingIds(w.state).find((h) => w.state.entities[h]?.fields.asset === "emr_call");
    if (!contract) throw new Error("no contract held");
    expect(why(act(w, DANNY, "exercise_option", { holding: contract }))).toBe("Only 50 units of EMR are for sale on the market");
    expect(listedFloat(w.ctx, STOCK)).toEqual({ business: EMR, float: 500, held: 450, left: 50 });
  });
});

describe("its cap table, payouts and net worth", () => {
  function traded(): Working {
    const w = portAlder();
    listed(w);
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 60 }))).toBe("");
    return w;
  }

  test("Jordan's rows, Danny on the market and the public for the rest, with their votes and the market", () => {
    const w = traded();
    const view = ownership(w);
    expect(view.units).toBe(1500);
    expect(view.owners.map((o) => ({ name: o.name, units: o.units, share: Math.round(o.share * 100) / 100, votes: Math.round((o.votes ?? 0) * 100) / 100, public: o.public === true }))).toEqual([
      { name: "Jordan Ellis", units: 1000, share: 66.67, votes: 66.67, public: false },
      { name: "Danny Okafor", units: 60, share: 4, votes: 4, public: true },
      { name: "The public", units: 440, share: 29.33, votes: 29.33, public: true },
    ]);
    expect(view.listing).toMatchObject({ asset: STOCK, symbol: "EMR", price: 200, float: 500, held: 60, available: 440, marketCap: 300_000 });
    expect(view.market).toMatchObject({ list: null, delist: null, offer: null, units: 999 });
    expect(votesIn(w.state, EMR)).toMatchObject({ [JORDAN]: expect.closeTo(66.6667, 3), [DANNY]: 4 });
  });

  test("a $1,000 payout: Jordan $666.67, Danny $40 as a dividend, the market $293.33", () => {
    const w = traded();
    const paid = act(w, JORDAN, "distribute_profit", { business: EMR, amount: 100_000 });
    expect(why(paid)).toBe("");
    const post = paid.events.find((e): e is Extract<LedgerEvent, { type: "post" }> => e.type === "post");
    const lines = Object.fromEntries((post?.lines ?? []).map((l) => [l.account, l.amount]));
    expect(lines[account(w, EMR)]).toBe(-100_000);
    expect(lines["economy.external:market:" + STOCK]).toBe(29_333);
    expect(Object.values(lines).filter((v) => v > 0).sort((a, b) => a - b)).toEqual([4_000, 29_333, 66_667]);
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect(incomeIn(w.state, DANNY, year).dividend).toBe(4_000);
    expect(incomeIn(w.state, JORDAN, year).dividend).toBe(66_667);
  });

  test("Danny and Marcus hold all 500 public units: a $1,000 payout adds up, $166.67 and $166.66 by their units and nothing to the market", () => {
    const w = portAlder();
    listed(w);
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 250 }))).toBe("");
    expect(why(act(w, MARCUS, "trade", { side: "buy", asset: STOCK, qty: 250 }))).toBe("");
    const paid = act(w, JORDAN, "distribute_profit", { business: EMR, amount: 100_000 });
    expect(why(paid)).toBe("");
    const post = paid.events.find((e): e is Extract<LedgerEvent, { type: "post" }> => e.type === "post");
    expect((post?.lines ?? []).reduce((a, l) => a + l.amount, 0)).toBe(0);
    expect(post?.lines.find((l) => l.account === account(w, EMR))?.amount).toBe(-100_000);
    expect(post?.lines.find((l) => l.account === "economy.external:market:" + STOCK)).toBeUndefined();
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect([incomeIn(w.state, DANNY, year).dividend, incomeIn(w.state, MARCUS, year).dividend].sort((a, b) => a - b)).toEqual([16_666, 16_667]);
    expect(incomeIn(w.state, JORDAN, year).dividend).toBe(66_667);
  });

  test("Jordan sells 200 cap-table units into the float at the market price, but not his last", () => {
    const w = traded();
    expect(gm(w, "economy.set_price", { asset: STOCK, price: 300 })).toBe("");
    const before = balance(w, "acct_pov_checking");
    const sold = act(w, JORDAN, "stake_sell", { business: EMR, units: 200, price: 0 });
    expect(why(sold)).toBe("");
    expect(owners(w, EMR)).toEqual([{ party: JORDAN, role: "owner", share: 100, units: 800 }]);
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})?.float).toBe(700);
    expect(balance(w, "acct_pov_checking")).toBe(before + 60_000);
    // He put $2,000 in for 1,000 units; 200 of them at $3 realise $200.
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect(gainsIn(w.state, JORDAN, year).short).toBe(20_000);
    expect(shareOf(w.state, EMR, JORDAN)).toBeCloseTo(53.3333, 3);
    // His stake is worth his 800 units at the market; Danny's 60 are his holding's.
    expect(Math.round((shareOf(w.state, EMR, JORDAN) * (marketValueOf(w.ctx, EMR)?.price ?? 0) * 1500) / 100)).toBe(240_000);
    expect(holdingValue(w.ctx, dannys(w))).toBe(18_000);
    expect(why(act(w, JORDAN, "stake_sell", { business: EMR, units: 800, price: 0 }))).toBe("Ellis Mobile Repair keeps an owner on its cap table: sell to someone in the world, or take it off the market");
  });
});

describe("going off the market", () => {
  test("every public unit bought back at the market price: Danny's holding sold, the market paid for the rest, Jordan holds it all", () => {
    const w = portAlder();
    listed(w);
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 60 }))).toBe("");
    expect(gm(w, "economy.set_price", { asset: STOCK, price: 250 })).toBe("");
    const till = balance(w, account(w, EMR));
    const danny = balance(w, "acct_danny_checking");
    const r = act(w, JORDAN, "shares_delist", { business: EMR });
    expect(why(r)).toBe("");
    expect(balance(w, account(w, EMR))).toBe(till - 125_000);
    expect(balance(w, "acct_danny_checking")).toBe(danny + 15_000);
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect(gainsIn(w.state, DANNY, year).short).toBe(3_000);
    expect(w.state.entities[EMR]?.fields.listing).toBeNull();
    expect(shareOf(w.state, EMR, JORDAN)).toBe(100);
    expect(assetOf(w.ctx, STOCK)).toBeNull();
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 1 }))).toBe(`no asset ${STOCK}`);
    expect(orgHistory(w.state, EMR)[0]?.text).toBe("Went off the market: bought back 500 public units at $2.50 a unit ($1,250.00)");
  });

  test("below the market price, or with no money to pay, nothing changes", () => {
    const w = portAlder();
    listed(w);
    expect(why(act(w, JORDAN, "shares_delist", { business: EMR, price: 100 }))).toBe("the public sells at no less than its market price, $2.00 a unit");
    const till = account(w, EMR);
    expect(w.apply({ type: "post", lines: [{ account: till, amount: -balance(w, till) }, { account: "economy.external:elsewhere", amount: balance(w, till) }], memo: "Spent elsewhere" })).toBeNull();
    expect(why(act(w, JORDAN, "shares_delist", { business: EMR }))).not.toBe("");
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})?.float).toBe(500);
  });
});

describe("the fold", () => {
  test("the whole scenario's events fold from the start to the same state", () => {
    const w = portAlder();
    const start = structuredClone(w.state) as WorldState;
    const from = w.events.length;
    listed(w);
    expect(why(act(w, DANNY, "trade", { side: "buy", asset: STOCK, qty: 60 }))).toBe("");
    lapse(w, 7);
    expect(why(act(w, JORDAN, "distribute_profit", { business: EMR, amount: 50_000 }))).toBe("");
    expect(why(act(w, JORDAN, "stake_sell", { business: EMR, units: 100, price: 0 }))).toBe("");
    expect(why(act(w, JORDAN, "shares_delist", { business: EMR }))).toBe("");
    const events = w.events.slice(from);
    const folded = new Working(reg, w.world, start);
    expect(applyValidUnits(reg, events, folded.state, (s) => reg.context(folded.world, s))).toHaveLength(events.length);
    expect(hashJson(folded.state)).toBe(hashJson(w.state));
  });
});
