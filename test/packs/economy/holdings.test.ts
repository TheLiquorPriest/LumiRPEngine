// Holdings and property in the fold (DESIGN §27): prices that move on each asset's own model and
// repeat on a replay, sales that realise first-in-first-out gains and land where they're told,
// payouts routed or reinvested, options priced from their underlying, exercised and expiring,
// leases whose rent reaches the landlord, mortgages tied to their property, and net worth that
// counts it all. Riverton at Simulation, with the LOD1 agents off so the timelapses stay small.
import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { LedgerEvent, PackEvent, PostEvent } from "../../../src/shared/ledger";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import type { JsonObject } from "../../../src/shared/json";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { assetOf, priceOf, quoteOf } from "../../../src/packs/economy/core/assets";
import { lotsOf, qtyOf } from "../../../src/packs/economy/core/holdings";
import { gainsIn, incomeIn } from "../../../src/packs/economy/core/records";
import { investmentTax } from "../../../src/packs/economy/core/gains";
import { blackScholes } from "../../../src/packs/economy/core/pricing";
import { modernUsWorld } from "../riverton";
import { fold, startState, trialBalance } from "../support";
import { openingEvent } from "../../../src/packs/economy/core/process";

const reg = createRegistry(ALL_PACKS);
const ALL_NOTE = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } as const;

function account(id: string, name: string, owner: string, product: string, opening: number, extra: JsonObject = {}): EntityDef {
  return { id, kind: "account", name, tier: "background", fields: { owners: [{ party: owner, role: "owner" }], product, opening, ...extra }, relations: [] };
}

function holding(id: string, accountId: string | null, asset: string, lots: { qty: number; cost: number; at: string }[], extra: JsonObject = {}): EntityDef {
  return { id, kind: "holding", name: id, tier: "background", fields: { asset, lots: lots as unknown as JsonObject[], ...(accountId ? { account: accountId } : { owners: [{ party: "you", role: "owner" }] }), ...extra }, relations: [] };
}

/** Riverton with a brokerage account, a few assets and no LOD1 agents. */
function riverton(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  const world = modernUsWorld("w", "Riverton");
  for (const id of ["maya", "jordan", "rosa"]) {
    const e = world.entities[id];
    if (e) e.agent = false;
  }
  const economy = world.packs.economy;
  if (economy) {
    economy.config = {
      ...economy.config,
      assets: {
        steady: { label: "Steady Growth Fund", symbol: "STDY", class: "fund", price: 10000, annual_return_pct: 10, annual_volatility_pct: 0, yield_pct: 0 },
        still: { label: "Still Fund", symbol: "STIL", class: "fund", price: 5000, annual_return_pct: 0, annual_volatility_pct: 0, yield_pct: 0 },
        index: { label: "Index Fund", symbol: "IDX", class: "fund", price: 10000 },
        stock: { label: "Lakeshore Freight", symbol: "LKFR", class: "security", price: 4250 },
        coin: { label: "Coin", symbol: "CN", class: "crypto", price: 9500000 },
        payer: { label: "Monthly Income Fund", symbol: "MINC", class: "fund", price: 2000, annual_return_pct: 6, annual_volatility_pct: 0, yield_pct: 6, pays_per_year: 12 },
      },
    };
  }
  world.entities.brokerage = account("brokerage", "Brokerage", "you", "brokerage", 2_000_000);
  patch(world);
  return world;
}

function setup(patch?: (w: WorldDoc) => void): Working {
  const world = riverton(patch);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function run(w: Working, type: string, args: JsonObject): LedgerEvent[] {
  const out = applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) });
  const first = out.rejected[0];
  if (first) throw new Error(`${type}: ${first.rejection.reason}`);
  return out.applied;
}

function refuse(w: Working, type: string, args: JsonObject): string {
  const out = applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng("refused") });
  return out.rejected[0]?.rejection.code ?? "applied";
}

/** A timelapse to a local time, segment after segment as Continue would run them (each stops at the unit cap). */
function lapseTo(w: Working, at: string, seed = "run"): void {
  const to = clockOfLocal(calendarOf(w.world), at);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: seed, overrides: ALL_NOTE });
    if ("code" in out) throw new Error(out.reason);
  }
  expect(w.state.clock).toBe(to);
}

function quotes(events: readonly LedgerEvent[], asset: string): { price?: number; yield?: number }[] {
  return events.filter((e): e is PackEvent => e.type === "economy.quote" && "data" in e && e.data.asset === asset).map((e) => ({ ...(typeof e.data.price === "number" ? { price: e.data.price } : {}), ...(typeof e.data.yield === "number" ? { yield: e.data.yield } : {}) }));
}

function balance(w: Working, id: string): number {
  return w.state.accounts[id] ?? 0;
}

describe("holdings: prices move on each asset's own model", () => {
  test("each asset steps at the close on its own model; crypto trades at weekends; a replay repeats every mark", () => {
    const make = (): Working =>
      setup((world) => {
        world.entities.h_steady = holding("h_steady", "brokerage", "steady", [{ qty: 10, cost: 100000, at: "2026-10-01" }]);
        world.entities.h_index = holding("h_index", "brokerage", "index", [{ qty: 10, cost: 100000, at: "2026-10-01" }]);
        world.entities.h_stock = holding("h_stock", "brokerage", "stock", [{ qty: 10, cost: 42500, at: "2026-10-01" }]);
        world.entities.h_coin = holding("h_coin", "brokerage", "coin", [{ qty: 0.01, cost: 95000, at: "2026-10-01" }]);
      });
    const a = make();
    const start = a.events.length;
    // Friday 16 October 07:30 to Friday 30 October 18:00: eleven trading days, fifteen calendar closes.
    lapseTo(a, "2026-10-30T18:00");
    const events = a.events.slice(start);
    // A fixed drift and no swings: exactly e^(10 % × a trading day) a day.
    const steady = quotes(events, "steady").map((q) => q.price);
    expect(steady).toHaveLength(11);
    steady.forEach((p, i) => expect(p).toBeCloseTo(10000 * Math.exp((0.1 * (i + 1)) / 252), 3));
    // No drift and no swings: never marked.
    expect(quotes(events, "still")).toEqual([]);
    expect(quoteOf(a.ctx, "still")).toBe(5000);
    // The index fund and the single stock trade on business days; the coin every day.
    expect(quotes(events, "index")).toHaveLength(11);
    expect(quotes(events, "stock")).toHaveLength(11);
    expect(quotes(events, "coin")).toHaveLength(15);
    // Their own models: their paths differ.
    expect(quotes(events, "index").map((q) => q.price)).not.toEqual(quotes(events, "stock").map((q) => (q.price ?? 0) * (10000 / 4250)));
    // The same seed repeats every mark; another seed doesn't.
    const b = make();
    lapseTo(b, "2026-10-30T18:00");
    expect(quotes(b.events, "stock")).toEqual(quotes(a.events, "stock"));
    const c = make();
    lapseTo(c, "2026-10-30T18:00", "other");
    expect(quotes(c.events, "stock")).not.toEqual(quotes(a.events, "stock"));
    // The holdings are worth their units at the last marks, and a re-fold gives the same state.
    expect(trialBalance(a.state)).toBe(0);
    expect(hashJson(fold(reg, a.world, startState(a.world), a.events).packs)).toBe(hashJson(a.state.packs));
  });

  test("an asset's own drift, swings and yield override its class's model, and a GM can set its price", () => {
    const w = setup();
    const index = assetOf(w.ctx, "index");
    const stock = assetOf(w.ctx, "stock");
    // From the finance table: the index fund follows the stock index (11 % total return less its 1.3 % yield).
    expect(index?.drift).toBeCloseTo(11 - 1.3, 10);
    expect(index?.vol).toBe(16);
    // A single stock swings more than the index, by its class row.
    expect(stock?.vol).toBe(28);
    expect(assetOf(w.ctx, "steady")?.drift).toBe(10);
    run(w, "economy.set_price", { asset: "index", price: 12345 });
    expect(quoteOf(w.ctx, "index")).toBe(12345);
  });
});

describe("holdings: trading and gains", () => {
  test("a sale takes the oldest lots first, realises the gain on them and lands in the account it names", () => {
    const w = setup();
    run(w, "economy.trade", { party: "you", side: "buy", asset: "still", account: "brokerage", qty: 10 });
    run(w, "economy.set_price", { asset: "still", price: 6000 });
    run(w, "economy.trade", { party: "you", side: "buy", asset: "still", account: "brokerage", qty: 5 });
    run(w, "economy.set_price", { asset: "still", price: 7500 });
    const holding = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "holding" && w.state.entities[id]?.fields.asset === "still") ?? "";
    expect(qtyOf(lotsOf(w.ctx, holding))).toBe(15);
    // Paid for from the brokerage account's own cash.
    expect(balance(w, "brokerage")).toBe(2_000_000 - 10 * 5000 - 5 * 6000);
    const savings = balance(w, "savings");
    const checking = balance(w, "checking");
    run(w, "economy.trade", { party: "you", side: "sell", holding, qty: 12, to: "savings" });
    // Ten at 50 and two of the five at 60 are sold for 75 each.
    const year = 2026;
    expect(gainsIn(w.state, "you", year)).toMatchObject({ short: 12 * 7500 - (10 * 5000 + 2 * 6000), long: 0, proceeds: 12 * 7500 });
    expect(lotsOf(w.ctx, holding).map((l) => [l.qty, l.cost])).toEqual([[3, 18000]]);
    expect(balance(w, "savings") - savings).toBe(12 * 7500);
    expect(balance(w, "checking")).toBe(checking);
    // Without a destination, the rest lands in the holding's own account, never in checking.
    const brokerage = balance(w, "brokerage");
    run(w, "economy.trade", { party: "you", side: "sell", holding });
    expect(balance(w, "brokerage") - brokerage).toBe(3 * 7500);
    expect(balance(w, "checking")).toBe(checking);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("lots held over a year realise long-term gains; brokerage cash buys again; selling more than is held is refused", () => {
    const w = setup((world) => {
      world.entities.h_old = holding("h_old", "brokerage", "still", [
        { qty: 4, cost: 8000, at: "2024-03-01" },
        { qty: 4, cost: 16000, at: "2026-09-01" },
      ]);
    });
    expect(refuse(w, "economy.trade", { party: "you", side: "sell", holding: "h_old", qty: 9 })).toBe("declined");
    run(w, "economy.trade", { party: "you", side: "sell", holding: "h_old", qty: 6 });
    // Four old units (2,000 each) and two of the newer (4,000 each), sold at 5,000.
    expect(gainsIn(w.state, "you", 2026)).toMatchObject({ long: 4 * 5000 - 8000, short: 2 * 5000 - 8000 });
    const cash = balance(w, "brokerage");
    run(w, "economy.trade", { party: "you", side: "buy", asset: "index", account: "brokerage", amount: 30000 });
    expect(balance(w, "brokerage")).toBe(cash - 30000);
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("holdings: payouts", () => {
  test("a fund's monthly payout lands where its route says, or buys more units at the day's price", () => {
    const w = setup((world) => {
      world.entities.h_paid = holding("h_paid", "brokerage", "payer", [{ qty: 100, cost: 200000, at: "2026-06-01" }], { route: "savings" });
      world.entities.h_more = holding("h_more", "brokerage", "payer", [{ qty: 50, cost: 100000, at: "2026-06-01" }], { route: "reinvest" });
    });
    const start = w.events.length;
    lapseTo(w, "2026-11-16T12:00");
    const events = w.events.slice(start);
    const price = quoteOf(w.ctx, "payer") ?? 0;
    const paid = events.filter((e): e is PostEvent => e.type === "post" && e.memo === "MINC dividend");
    expect(paid).toHaveLength(1);
    // Routed: 100 units at the day's price (it holds still: its 6 % return is all paid out), 6 % a year
    // over twelve payments, from the fund's issuer into savings and nowhere else.
    expect(price).toBe(2000);
    const routed = Math.round((100 * 2000 * 6) / 100 / 12);
    expect(paid[0]?.lines).toEqual([
      { account: "economy.external:issuer:payer", amount: -routed },
      { account: "savings", amount: routed },
    ]);
    // Reinvested: half as much buys units, a new lot whose cost is the payout.
    const lots = lotsOf(w.ctx, "h_more");
    expect(lots).toHaveLength(2);
    expect(lots[1]?.cost).toBe(Math.round(routed / 2));
    expect(qtyOf(lots)).toBeCloseTo(50 + Math.round(routed / 2) / 2000, 6);
    expect(incomeIn(w.state, "you", 2026).dividend).toBe(routed + Math.round(routed / 2));
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("holdings: options", () => {
  test("a call is priced from its underlying, exercised into units at the strike plus its cost, and settles in cash at expiry", () => {
    const w = setup();
    const before = balance(w, "brokerage");
    run(w, "economy.trade", { party: "you", side: "buy", asset: "index", account: "brokerage", right: "call", strike: 10000, expiry: "2026-12-18", qty: 2 });
    const option = Object.keys(w.state.entities).find((id) => String(w.state.entities[id]?.fields.asset ?? "").startsWith("opt:index:call")) ?? "";
    const contract = assetOf(w.ctx, String(w.state.entities[option]?.fields.asset));
    const under = assetOf(w.ctx, "index");
    if (!contract?.option || !under) throw new Error("no contract");
    // Priced by Black-Scholes from the index fund: its price, swings and yield, the bill rate, the time left.
    const years = (contract.option.expiry - w.state.clock) / (365 * 1440);
    const each = blackScholes({ right: "call", spot: 10000, strike: 10000, years, ratePct: 3.8, volPct: under.vol, yieldPct: under.yieldPct }) * 100;
    expect(priceOf(w.ctx, contract)).toBeCloseTo(each, 2);
    const premium = Math.round(2 * priceOf(w.ctx, contract));
    expect(before - balance(w, "brokerage")).toBe(premium);
    // Exercising one: 100 units for the strike, their basis the strike and one contract's cost.
    run(w, "economy.exercise", { party: "you", holding: option, qty: 1 });
    const units = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "holding" && w.state.entities[id]?.fields.asset === "index") ?? "";
    expect(qtyOf(lotsOf(w.ctx, units))).toBe(100);
    expect(lotsOf(w.ctx, units)[0]?.cost).toBe(100 * 10000 + Math.round(premium / 2));
    expect(qtyOf(lotsOf(w.ctx, option))).toBe(1);
    expect(before - balance(w, "brokerage")).toBe(premium + 100 * 10000);
    // The last contract expires at the close on 18 December, settled at what it's worth over the strike
    // (a slot is stepped once it ends, so the lapse runs past the afternoon).
    lapseTo(w, "2026-12-18T19:00");
    const close = quoteOf(w.ctx, "index") ?? 0;
    const settled = w.events.filter((e): e is PostEvent => e.type === "post" && e.memo.includes("exercised at expiry"));
    const worth = Math.round(100 * Math.max(0, close - 10000));
    expect(settled.reduce((a, p) => a + (p.lines.find((l) => l.account === "brokerage")?.amount ?? 0), 0)).toBe(worth);
    expect(qtyOf(lotsOf(w.ctx, option))).toBe(0);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a put out of the money expires worthless and its cost is a realised loss", () => {
    const w = setup((world) => {
      const assets = world.packs.economy?.config.assets;
      if (assets && typeof assets === "object" && !Array.isArray(assets)) assets.calm = { label: "Calm Fund", symbol: "CALM", class: "fund", price: 10000, annual_return_pct: 30, annual_volatility_pct: 1, yield_pct: 0 };
    });
    run(w, "economy.trade", { party: "you", side: "buy", asset: "calm", account: "brokerage", right: "put", strike: 10000, expiry: "2026-11-20", qty: 1 });
    const option = Object.keys(w.state.entities).find((id) => String(w.state.entities[id]?.fields.asset ?? "").startsWith("opt:calm:put")) ?? "";
    const cost = lotsOf(w.ctx, option)[0]?.cost ?? 0;
    expect(cost).toBeGreaterThan(0);
    lapseTo(w, "2026-11-20T19:00");
    expect(quoteOf(w.ctx, "calm")).toBeGreaterThan(10000);
    expect(qtyOf(lotsOf(w.ctx, option))).toBe(0);
    expect(gainsIn(w.state, "you", 2026).short).toBe(-cost);
    expect(w.events.some((e) => e.type === "engine.signal" && "data" in e && String(e.data.text).includes("expired worthless"))).toBe(true);
  });

  test("a put delivers the units it's written on for the strike, and what it cost comes off the gain", () => {
    const w = setup((world) => {
      world.entities.h_still = holding("h_still", "brokerage", "still", [{ qty: 100, cost: 400_000, at: "2026-06-01" }]);
    });
    run(w, "economy.trade", { party: "you", side: "buy", asset: "still", account: "brokerage", right: "put", strike: 6000, expiry: "2026-11-20", qty: 1 });
    const option = Object.keys(w.state.entities).find((id) => String(w.state.entities[id]?.fields.asset ?? "").startsWith("opt:still:put")) ?? "";
    const premium = lotsOf(w.ctx, option)[0]?.cost ?? 0;
    // Deep in the money, a European put is worth about the strike's present value less the price.
    expect(premium).toBeGreaterThan(90_000);
    const before = balance(w, "brokerage");
    run(w, "economy.exercise", { party: "you", holding: option, qty: 1 });
    // A hundred units at $50 delivered for the $60 strike.
    expect(balance(w, "brokerage") - before).toBe(600_000);
    expect([qtyOf(lotsOf(w.ctx, option)), qtyOf(lotsOf(w.ctx, "h_still"))]).toEqual([0, 0]);
    expect(gainsIn(w.state, "you", 2026).short).toBe(600_000 - premium - 400_000);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a cash-settled call pays what it is worth over the strike instead of units", () => {
    const w = setup((world) => {
      const assets = world.packs.economy?.config.assets;
      if (assets && typeof assets === "object" && !Array.isArray(assets)) assets.still_call = { label: "STIL Nov $40 call (cash)", class: "option", underlying: "still", strike: 4000, expiry: "2026-11-20", right: "call", multiplier: 100, settlement: "cash" };
      world.entities.h_call = holding("h_call", "brokerage", "still_call", [{ qty: 2, cost: 30_000, at: "2026-10-01" }]);
    });
    const before = balance(w, "brokerage");
    run(w, "economy.exercise", { party: "you", holding: "h_call", qty: 2 });
    // Two contracts of a hundred units, $10 each in the money.
    expect(balance(w, "brokerage") - before).toBe(200_000);
    expect(qtyOf(lotsOf(w.ctx, "h_call"))).toBe(0);
    expect(Object.values(w.state.entities).some((e) => e.kind === "holding" && e.fields.asset === "still" && e.fields.account === "brokerage")).toBe(false);
    expect(gainsIn(w.state, "you", 2026).short).toBe(200_000 - 30_000);
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("holdings: bonds", () => {
  test("a bond maturing on a Saturday, or on a Friday, pays its face and its last coupon once, and the coupon is the year's interest", () => {
    const w = setup((world) => {
      const assets = world.packs.economy?.config.assets;
      if (assets && typeof assets === "object" && !Array.isArray(assets)) {
        assets.sat = { label: "Note due Sat 31 Oct", symbol: "SAT", class: "bond", face: 100000, coupon_pct: 6, pays_per_year: 2, maturity: "2026-10-31", price: 100000 };
        assets.fri = { label: "Note due Fri 30 Oct", symbol: "FRI", class: "bond", face: 100000, coupon_pct: 6, pays_per_year: 2, maturity: "2026-10-30", price: 100000 };
      }
      world.entities.h_sat = holding("h_sat", "brokerage", "sat", [{ qty: 10, cost: 1_000_000, at: "2026-01-02" }]);
      world.entities.h_fri = holding("h_fri", "brokerage", "fri", [{ qty: 10, cost: 1_000_000, at: "2026-01-02" }]);
    });
    const before = balance(w, "brokerage");
    lapseTo(w, "2026-11-03T12:00");
    // Ten notes of $1,000 at 6 %, twice a year: $300 of interest each, and $10,000 of face.
    expect(balance(w, "brokerage") - before).toBe(2 * (1_000_000 + 30_000));
    expect(incomeIn(w.state, "you", 2026).interest).toBe(60_000);
    expect(qtyOf(lotsOf(w.ctx, "h_sat")) + qtyOf(lotsOf(w.ctx, "h_fri"))).toBe(0);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("in a world whose day part spans the morning and the close, a bond maturing on a business day still pays its last coupon once", () => {
    const w = setup((world) => {
      // One day part from 06:00 to 18:00: the coupon's hour and the market's close share a slot.
      world.calendar.dayParts = world.calendar.dayParts.filter((p) => p.id !== "afternoon");
      const assets = world.packs.economy?.config.assets;
      if (assets && typeof assets === "object" && !Array.isArray(assets)) assets.fri = { label: "Note due Fri 30 Oct", symbol: "FRI", class: "bond", face: 100000, coupon_pct: 6, pays_per_year: 2, maturity: "2026-10-30", price: 100000 };
      world.entities.h_fri = holding("h_fri", "brokerage", "fri", [{ qty: 10, cost: 1_000_000, at: "2026-01-02" }]);
    });
    const before = balance(w, "brokerage");
    lapseTo(w, "2026-11-03T12:00");
    expect(balance(w, "brokerage") - before).toBe(1_000_000 + 30_000);
    expect(incomeIn(w.state, "you", 2026).interest).toBe(30_000);
  });

  test("before it matures, a bond pays its coupon on its schedule, from its issuer into its account", () => {
    const w = setup((world) => {
      const assets = world.packs.economy?.config.assets;
      if (assets && typeof assets === "object" && !Array.isArray(assets)) assets.apr = { label: "Note due 30 Apr 2027", symbol: "APR", class: "bond", face: 100000, coupon_pct: 5, pays_per_year: 2, maturity: "2027-04-30", price: 100000 };
      world.entities.h_apr = holding("h_apr", "brokerage", "apr", [{ qty: 4, cost: 400_000, at: "2026-05-01" }]);
    });
    const start = w.events.length;
    lapseTo(w, "2026-11-03T12:00");
    // Four notes of $1,000 at 5 %, twice a year (April and October, on the 30th): $100 on Friday 30 October.
    const coupons = w.events.slice(start).filter((e): e is PostEvent => e.type === "post" && e.memo === "APR interest");
    expect(coupons.map((p) => p.lines)).toEqual([
      [
        { account: "economy.external:issuer:apr", amount: -10_000 },
        { account: "brokerage", amount: 10_000 },
      ],
    ]);
    expect(incomeIn(w.state, "you", 2026).interest).toBe(10_000);
    expect(qtyOf(lotsOf(w.ctx, "h_apr"))).toBe(4);
  });
});

describe("holdings: a retirement account", () => {
  test("its sales' gains and its dividends aren't the year's to tax; a brokerage's are", () => {
    const w = setup((world) => {
      world.entities.ira = account("ira", "IRA", "you", "retirement", 0);
      world.entities.h_ira_pay = holding("h_ira_pay", "ira", "payer", [{ qty: 100, cost: 200_000, at: "2026-06-01" }]);
      world.entities.h_ira_idx = holding("h_ira_idx", "ira", "index", [{ qty: 10, cost: 50_000, at: "2026-06-01" }]);
      world.entities.h_brk_idx = holding("h_brk_idx", "brokerage", "index", [{ qty: 10, cost: 50_000, at: "2026-06-01" }]);
    });
    run(w, "economy.trade", { party: "you", side: "sell", holding: "h_ira_idx", qty: 10 });
    run(w, "economy.trade", { party: "you", side: "sell", holding: "h_brk_idx", qty: 10 });
    // Ten units bought for $500 and sold for $1,000: only the brokerage's $500 is a gain.
    expect(gainsIn(w.state, "you", 2026).short).toBe(50_000);
    const ira = balance(w, "ira");
    lapseTo(w, "2026-11-17T12:00");
    // The fund's monthly payout stays in the IRA, and isn't the year's income.
    expect(balance(w, "ira") - ira).toBe(1_000);
    expect(incomeIn(w.state, "you", 2026).dividend).toBe(0);
  });
});

describe("holdings: property", () => {
  const duplex = (world: WorldDoc, extra: JsonObject = {}): void => {
    world.entities.duplex = { id: "duplex", kind: "property", name: "The duplex", tier: "background", fields: { place: "apartment", owners: [{ party: "you", role: "owner", share: 100 }], value: 30_000_000, units: 2, ...extra }, relations: [] };
    world.entities.jordan_checking = account("jordan_checking", "Jordan's checking", "jordan", "checking", 900_000);
  };

  test("a lease's rent reaches the landlord's account on its day, and a managed unit lets to an outside tenant", () => {
    const w = setup((world) => duplex(world, { managed: true, market_rent: 110000, vacancy_months: 0 }));
    run(w, "economy.lease_start", { party: "you", property: "duplex", tenant: "jordan", rent: 125000, months: 12, day: 1, from: "jordan_checking" });
    const lease = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "flow" && w.state.entities[id]?.fields.link === "duplex") ?? "";
    expect(lease).not.toBe("");
    const start = w.events.length;
    lapseTo(w, "2026-11-01T12:00");
    const posts = w.events.slice(start).filter((e): e is PostEvent => e.type === "post");
    // Jordan's rent, from his checking to the landlord's.
    expect(posts.some((p) => p.lines.some((l) => l.account === "jordan_checking" && l.amount === -125000) && p.lines.some((l) => l.account === "checking" && l.amount === 125000))).toBe(true);
    // The other unit is let to an outside tenant at the market rent, also into the landlord's checking.
    const outside = posts.find((p) => p.lines.some((l) => l.account.startsWith("economy.external:tenant")));
    expect(outside?.lines.find((l) => l.account === "checking")?.amount).toBe(110000);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("routing a property's rent moves the lease already paying it as well as the outside tenants', and an empty route moves it back", () => {
    const w = setup((world) => duplex(world, { managed: true, market_rent: 110000, vacancy_months: 0 }));
    run(w, "economy.lease_start", { party: "you", property: "duplex", tenant: "jordan", rent: 125000, months: 12, day: 1, from: "jordan_checking" });
    const lease = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "flow" && w.state.entities[id]?.fields.link === "duplex") ?? "";
    expect(w.state.entities[lease]?.fields.to).toBe("checking");
    run(w, "economy.route", { party: "you", property: "duplex", to: "savings" });
    expect(w.state.entities[lease]?.fields.to).toBe("savings");
    const start = w.events.length;
    lapseTo(w, "2026-11-01T12:00");
    const posts = w.events.slice(start).filter((e): e is PostEvent => e.type === "post");
    expect(posts.some((p) => p.lines.some((l) => l.account === "jordan_checking" && l.amount === -125000) && p.lines.some((l) => l.account === "savings" && l.amount === 125000))).toBe(true);
    expect(posts.find((p) => p.lines.some((l) => l.account.startsWith("economy.external:tenant")))?.lines.find((l) => l.account === "savings")?.amount).toBe(110000);
    expect(posts.some((p) => p.lines.some((l) => l.account === "checking" && l.amount > 0) && p.lines.some((l) => l.account === "jordan_checking" || l.account.startsWith("economy.external:tenant")))).toBe(false);
    run(w, "economy.route", { party: "you", property: "duplex", to: "" });
    expect(w.state.entities.duplex?.fields.rent_to ?? null).toBeNull();
    expect(w.state.entities[lease]?.fields.to).toBe("checking");
    expect(trialBalance(w.state)).toBe(0);
  });

  test("on a property owned with someone, the owners' route splits a lease's rent by share again, and a route to one account takes the split off", () => {
    const w = setup((world) => {
      duplex(world);
      world.entities.duplex!.fields.owners = [{ party: "you", role: "owner", share: 60 }, { party: "jordan", role: "owner", share: 40 }];
      world.entities.duplex!.fields.rent_to = "savings";
    });
    run(w, "economy.lease_start", { party: "you", property: "duplex", tenant: "rosa", rent: 100000, months: 12, day: 1 });
    const lease = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "flow" && w.state.entities[id]?.fields.link === "duplex") ?? "";
    expect(w.state.entities[lease]?.fields.to).toBe("savings");
    expect(w.state.entities[lease]?.fields.splits).toBeUndefined();
    run(w, "economy.route", { party: "you", property: "duplex", to: "" });
    expect(w.state.entities[lease]?.fields.to).toBe("checking");
    expect(w.state.entities[lease]?.fields.splits).toEqual([{ to: "jordan_checking", pct: 40 }]);
    run(w, "economy.route", { party: "you", property: "duplex", to: "savings" });
    expect(w.state.entities[lease]?.fields.to).toBe("savings");
    expect(w.state.entities[lease]?.fields.splits ?? null).toBeNull();
  });

  test("buying with a down payment opens a mortgage the property secures; selling pays it off and realises the gain", () => {
    const w = setup((world) => {
      world.entities.cabin = { id: "cabin", kind: "property", name: "The cabin", tier: "background", fields: { place: "apartment", owners: [], value: 20_000_000, asking_price: 20_000_000 }, relations: [] };
      world.entities.savings!.fields.opening = 6_500_000;
    });
    run(w, "economy.property_buy", { party: "you", property: "cabin", from: "savings", down: 4_000_000, term_months: 360 });
    const mortgage = String(w.state.entities.cabin?.fields.mortgage ?? "");
    expect(w.state.entities[mortgage]?.fields.secured_by).toBe("cabin");
    expect(balance(w, mortgage)).toBe(-16_000_000);
    expect(w.state.entities.cabin?.fields.owners).toEqual([{ party: "you", role: "owner", share: 100 }]);
    // Net worth counts the cabin, and the mortgage against it.
    const worth = w.ctx.query("economy.net_worth")(w.ctx, "you") ?? 0;
    // Its value rises to $220,000, which is what an outside buyer pays.
    w.apply({ type: "set", entity: "cabin", field: "value", value: 22_000_000 });
    run(w, "economy.property_sell", { party: "you", property: "cabin", price: 22_000_000, to: "checking" });
    expect(balance(w, mortgage)).toBe(0);
    expect(w.state.entities.cabin?.fields.mortgage).toBeNull();
    expect(gainsIn(w.state, "you", 2026).long + gainsIn(w.state, "you", 2026).short).toBe(2_000_000);
    expect((w.ctx.query("economy.net_worth")(w.ctx, "you") ?? 0) - worth).toBe(2_000_000);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("on the buyer's money, the mortgage's money goes to the closing, and no line names a key", () => {
    const w = setup((world) => {
      world.entities.cabin = { id: "cabin", kind: "property", name: "The cabin", tier: "background", fields: { place: "apartment", owners: [], value: 20_000_000, asking_price: 20_000_000 }, relations: [] };
      world.entities.savings!.fields.opening = 6_500_000;
    });
    run(w, "economy.property_buy", { party: "you", property: "cabin", from: "savings", down: 4_000_000, term_months: 360 });
    const mortgage = String(w.state.entities.cabin?.fields.mortgage ?? "");
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true);
    expect(view.accounts.find((a) => a.id === mortgage)?.transactions.map((t) => t.counterparty)).toContain("Closing");
    expect(view.accounts.flatMap((a) => a.transactions).flatMap((t) => (t.counterparty?.includes(":") ? [t.counterparty] : []))).toEqual([]);
  });

  test("net worth counts each owner's share of a property's value, which moves on the 1st", () => {
    const w = setup((world) => duplex(world, { owners: [{ party: "you", role: "owner", share: 60 }, { party: "jordan", role: "owner", share: 40 }] }));
    const without = setup();
    const worth = (x: Working): number => x.ctx.query("economy.net_worth")(x.ctx, "you") ?? 0;
    expect(worth(w) - worth(without)).toBe(18_000_000);
    lapseTo(w, "2026-11-01T06:00");
    const value = Number(w.state.entities.duplex?.fields.value);
    expect(value).not.toBe(30_000_000);
    expect(worth(w) - worth(without)).toBeGreaterThan(0);
  });

  test("a property nobody owns sells for what it's worth at least", () => {
    const w = setup((world) => {
      world.entities.lot = { id: "lot", kind: "property", name: "The lot", tier: "background", fields: { place: "apartment", owners: [], value: 20_000_000 }, relations: [] };
      world.entities.savings!.fields.opening = 25_000_000;
    });
    expect(refuse(w, "economy.property_buy", { party: "you", property: "lot", price: 1, from: "savings" })).toBe("declined");
    expect(refuse(w, "economy.property_buy", { party: "you", property: "lot", price: 19_999_999, from: "savings" })).toBe("declined");
    expect(w.state.entities.lot?.fields.owners).toEqual([]);
    run(w, "economy.property_buy", { party: "you", property: "lot", from: "savings" });
    expect(w.state.entities.lot?.fields.owners).toEqual([{ party: "you", role: "owner", share: 100 }]);
    expect(balance(w, "savings")).toBe(5_000_000);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a mortgage is the lender's: its rate at the buyer's score, its terms, at least 3 % down and no more than the property is worth", () => {
    const cabin = (world: WorldDoc): void => {
      world.realism.levels.money = 4;
      world.entities.cabin = { id: "cabin", kind: "property", name: "The cabin", tier: "background", fields: { place: "apartment", owners: [], value: 20_000_000, asking_price: 20_000_000 }, relations: [] };
      world.entities.savings!.fields.opening = 6_500_000;
    };
    const w = setup(cabin);
    const buy = (args: JsonObject): JsonObject => ({ party: "you", property: "cabin", from: "savings", ...args });
    const savings = balance(w, "savings");
    // All of it on a mortgage, a term no lender offers, or $260,000 lent against a $200,000 cabin: each refused, nothing changes hands.
    expect(refuse(w, "economy.property_buy", buy({ down: 0 }))).toBe("declined");
    expect(refuse(w, "economy.property_buy", buy({ down: 4_000_000, term_months: 7 }))).toBe("bad_term");
    w.apply({ type: "set", entity: "cabin", field: "asking_price", value: 30_000_000 });
    expect(refuse(w, "economy.property_buy", buy({ down: 4_000_000 }))).toBe("declined");
    w.apply({ type: "set", entity: "cabin", field: "asking_price", value: 20_000_000 });
    expect(w.state.entities.cabin?.fields.owners).toEqual([]);
    expect(balance(w, "savings")).toBe(savings);
    // The rate is what applying for the same mortgage gets, whatever the buyer names.
    const twin = setup(cabin);
    const applied = run(twin, "economy.apply_credit", { product: "mortgage", cents: 16_000_000, term: 180, secured_by: "cabin", who: "you" });
    const offered = applied.flatMap((e) => (e.type === "spawn" && e.entity.kind === "account" ? [e.entity.fields.apr_pct] : []));
    expect(offered).toHaveLength(1);
    expect(offered[0]).toBeGreaterThan(0);
    const events = run(w, "economy.property_buy", buy({ down: 4_000_000, term_months: 180, apr_pct: 0 }));
    const mortgage = String(w.state.entities.cabin?.fields.mortgage ?? "");
    expect(w.state.entities[mortgage]?.fields).toMatchObject({ apr_pct: offered[0], term_months: 180, secured_by: "cabin" });
    expect(balance(w, mortgage)).toBe(-16_000_000);
    // The application goes on the buyer's credit report, as any does.
    expect(events.filter((e) => e.type === "economy.credit" && JSON.stringify(e).includes("inquiry"))).toHaveLength(1);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a share of a property owned with someone sells only to a buyer in the world: the other owner's share stays theirs", () => {
    const w = setup((world) => duplex(world, { owners: [{ party: "you", role: "owner", share: 60 }, { party: "jordan", role: "owner", share: 40 }] }));
    const jordan = w.ctx.query("economy.net_worth")(w.ctx, "jordan") ?? 0;
    expect(refuse(w, "economy.property_sell", { party: "you", property: "duplex", price: 18_000_000 })).toBe("needs_buyer");
    expect(w.state.entities.duplex?.fields.owners).toEqual([{ party: "you", role: "owner", share: 60 }, { party: "jordan", role: "owner", share: 40 }]);
    expect(w.ctx.query("economy.net_worth")(w.ctx, "jordan")).toBe(jordan);
  });

  test("a co-owner who buys another's share holds both: 50 % and 30 % make 80 %, and the third owner's part stays as it was", () => {
    const w = setup((world) => duplex(world, { owners: [{ party: "you", role: "owner", share: 30 }, { party: "jordan", role: "owner", share: 50 }, { party: "maya", role: "owner", share: 20 }] }));
    const maya = w.ctx.query("economy.net_worth")(w.ctx, "maya");
    // Jordan's checking opens before he pays from it.
    const opening = openingEvent(w.ctx, "jordan");
    if (opening) w.apply(opening);
    run(w, "economy.property_sell", { party: "you", property: "duplex", price: 500_000, buyer: "jordan" });
    expect(w.state.entities.duplex?.fields.owners).toEqual([{ party: "jordan", role: "owner", share: 80 }, { party: "maya", role: "owner", share: 20 }]);
    expect(w.ctx.query("economy.net_worth")(w.ctx, "maya")).toBe(maya);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("its property tax, insurance and upkeep post from its owner's checking on their days, worked out from its value", () => {
    const w = setup((world) => {
      duplex(world, { value: 12_000_000, appreciation_pct: 0, volatility_pct: 0, tax_pct: 1.2, insurance: 15_000, upkeep_pct: 1 });
      world.entities.checking!.fields.opening = 1_000_000;
    });
    const start = w.events.length;
    lapseTo(w, "2026-12-02T12:00");
    const paid = (memo: string): number[] => w.events.slice(start).flatMap((e) => (e.type === "post" && e.memo === memo ? e.lines.filter((l) => l.account === "checking").map((l) => l.amount) : []));
    // Insurance on the 1st (Sunday 1 November rolls to the Monday) and 1 December.
    expect(paid("Insurance, The duplex")).toEqual([-15_000, -15_000]);
    // Upkeep, 1 % of $120,000 a year, on the 15th (a Sunday, so Monday 16 November).
    expect(paid("Upkeep, The duplex")).toEqual([-10_000]);
    // Property tax, 1.2 % a year in two installments, the second on 1 December.
    expect(paid("Property tax, The duplex")).toEqual([-72_000]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("property tax its owner can't pay waits, and is paid with the next installment", () => {
    const w = setup((world) => {
      // $500 of property tax a month, on the 1st, with $10 in checking, nothing saved and the card at its limit.
      duplex(world, { value: 12_000_000, appreciation_pct: 0, volatility_pct: 0, tax_pct: 5, tax_installments: 12, insurance: 0, upkeep_pct: 0 });
      world.entities.checking!.fields.opening = 1_000;
      world.entities.savings!.fields.opening = 0;
      world.entities.card!.fields.limit = 38_000;
    });
    const tax = (from: number): number[] => w.events.slice(from).flatMap((e) => (e.type === "post" && e.memo === "Property tax, The duplex" ? e.lines.filter((l) => l.account === "checking").map((l) => l.amount) : []));
    lapseTo(w, "2026-11-20T12:00");
    expect(tax(0)).toEqual([]);
    // Money comes in before the next installment.
    w.apply({ type: "post", lines: [{ account: "economy.external:family", amount: -2_000_000 }, { account: "checking", amount: 2_000_000 }], memo: "A gift" });
    const start = w.events.length;
    lapseTo(w, "2026-12-02T12:00");
    // November's $500, deferred, with December's.
    expect(tax(start)).toEqual([-100_000]);
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("holdings: rent on a property owned with someone", () => {
  const shared = (world: WorldDoc, extra: JsonObject = {}): void => {
    world.entities.duplex = { id: "duplex", kind: "property", name: "The duplex", tier: "background", fields: { place: "apartment", owners: [{ party: "you", role: "owner", share: 60 }, { party: "jordan", role: "owner", share: 40 }], value: 30_000_000, units: 2, ...extra }, relations: [] };
    world.entities.jordan_checking = account("jordan_checking", "Jordan's checking", "jordan", "checking", 900_000);
    world.entities.rosa_checking = account("rosa_checking", "Rosa's checking", "rosa", "checking", 500_000);
  };
  // Rosa's rent: what leaves her checking for the owners' accounts (her living costs go elsewhere).
  const rentPosts = (w: Working, start: number): PostEvent["lines"][] =>
    w.events
      .slice(start)
      .filter((e): e is PostEvent => e.type === "post" && e.lines.some((l) => l.account === "rosa_checking" && l.amount < 0) && e.lines.some((l) => ["checking", "savings", "jordan_checking"].includes(l.account)))
      .map((p) => [...p.lines].sort((a, b) => a.account.localeCompare(b.account)));
  const split = [
    { account: "checking", amount: 60000 },
    { account: "jordan_checking", amount: 40000 },
    { account: "rosa_checking", amount: -100000 },
  ];

  test("a lease started on it pays each owner their share", () => {
    const w = setup((world) => shared(world));
    run(w, "economy.lease_start", { party: "you", property: "duplex", tenant: "rosa", rent: 100000, months: 12, day: 1 });
    const start = w.events.length;
    lapseTo(w, "2026-11-01T12:00");
    expect(rentPosts(w, start)).toEqual([split]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("routing its rent back to the owners keeps a lease paid as a person paying, now split by share", () => {
    const w = setup((world) => {
      shared(world, { rent_to: "savings" });
      world.entities.lease_rosa = { id: "lease_rosa", kind: "flow", name: "Lease: Rosa, the duplex", tier: "background", fields: { flow_kind: "rent", from: "rosa", to: "savings", amount_cents: 100000, every: "month", days: [1], shortfall: "retry", retry_days: 5, retries: 2, category: "rent", link: "duplex", status: "active" }, relations: [] };
    });
    run(w, "economy.route", { party: "you", property: "duplex", to: "" });
    const start = w.events.length;
    lapseTo(w, "2026-11-01T12:00");
    expect(rentPosts(w, start)).toEqual([split]);
  });

  const lease = (to: string, splits: { to: string; pct: number }[]): EntityDef => ({
    id: "lease_rosa",
    kind: "flow",
    name: "Lease: Rosa, the duplex",
    tier: "background",
    fields: { flow_kind: "rent", from: "rosa_checking", to, ...(splits.length > 0 ? { splits: splits as unknown as JsonObject[] } : {}), amount_cents: 100000, every: "month", days: [1], shortfall: "retry", retry_days: 5, retries: 2, category: "rent", link: "duplex", status: "active" },
    relations: [],
  });

  test("bought whole, its lease pays the buyer all the rent: the sellers' split goes with them", () => {
    const w = setup((world) => {
      shared(world, { owners: [{ party: "jordan", role: "owner", share: 50 }, { party: "maya", role: "owner", share: 50 }], asking_price: 30_000_000 });
      world.entities.maya_checking = account("maya_checking", "Maya's checking", "maya", "checking", 300_000);
      world.entities.lease_rosa = lease("jordan_checking", [{ to: "maya_checking", pct: 50 }]);
      world.entities.savings!.fields.opening = 35_000_000;
    });
    run(w, "economy.property_buy", { party: "you", property: "duplex", from: "savings" });
    const start = w.events.length;
    lapseTo(w, "2026-11-01T12:00");
    expect(rentPosts(w, start)).toEqual([
      [
        { account: "checking", amount: 100000 },
        { account: "rosa_checking", amount: -100000 },
      ],
    ]);
  });

  test("a co-owner's share sold to someone in the world takes their part of the rent with it", () => {
    const w = setup((world) => {
      shared(world, { owners: [{ party: "jordan", role: "owner", share: 60 }, { party: "you", role: "owner", share: 40 }] });
      world.entities.maya_checking = account("maya_checking", "Maya's checking", "maya", "checking", 2_000_000);
      world.entities.lease_rosa = lease("jordan_checking", [{ to: "checking", pct: 40 }]);
    });
    // Maya's checking opens before she pays from it.
    const opening = openingEvent(w.ctx, "maya");
    if (opening) w.apply(opening);
    run(w, "economy.property_sell", { party: "you", property: "duplex", price: 1_000_000, buyer: "maya" });
    const start = w.events.length;
    lapseTo(w, "2026-11-01T12:00");
    expect(rentPosts(w, start)).toEqual([
      [
        { account: "jordan_checking", amount: 60000 },
        { account: "maya_checking", amount: 40000 },
        { account: "rosa_checking", amount: -100000 },
      ],
    ]);
  });
});

describe("holdings: what an outside buyer pays", () => {
  test("no more than a property is worth, nor than a business is", () => {
    const w = setup((world) => {
      world.entities.cabin = { id: "cabin", kind: "property", name: "The cabin", tier: "background", fields: { place: "apartment", owners: [{ party: "you", role: "owner", share: 100 }], value: 20_000_000 }, relations: [] };
      world.entities.stall = { id: "stall", kind: "business", name: "The stall", tier: "background", fields: { owners: [{ party: "you", role: "owner", share: 100 }], value: 1_000_000 }, relations: [] };
    });
    expect(refuse(w, "economy.property_sell", { party: "you", property: "cabin", price: 20_000_001, to: "checking" })).toBe("declined");
    expect(refuse(w, "economy.stake_sell", { party: "you", business: "stall", share: 100, price: 1_000_001, to: "checking" })).toBe("declined");
    const checking = balance(w, "checking");
    run(w, "economy.property_sell", { party: "you", property: "cabin", price: 20_000_000, to: "checking" });
    run(w, "economy.stake_sell", { party: "you", business: "stall", share: 100, price: 1_000_000, to: "checking" });
    expect(balance(w, "checking") - checking).toBe(21_000_000);
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("holdings: the yearly investment tax", () => {
  test("at the top level, a year's gains are taxed on 15 April from the owner's checking", () => {
    const w = setup((world) => {
      world.realism.levels.money = 4;
      world.start = { ...world.start, at: "2026-12-30T07:30" };
      world.entities.checking!.fields.opening = 2_000_000;
      world.entities.h_gain = holding("h_gain", "brokerage", "still", [{ qty: 10, cost: 30_000, at: "2026-06-01" }]);
    });
    // Ten units bought for $300 and sold for $500: a $200 short-term gain in 2026.
    run(w, "economy.trade", { party: "you", side: "sell", holding: "h_gain", qty: 10 });
    expect(gainsIn(w.state, "you", 2026).short).toBe(20_000);
    const taxed = (): PostEvent[] => w.events.filter((e): e is PostEvent => e.type === "post" && e.memo === "Tax on 2026 investment income");
    lapseTo(w, "2027-04-14T23:00");
    expect(taxed()).toEqual([]);
    const owed = investmentTax(w.ctx, "you", 2026).cents;
    expect(owed).toBeGreaterThan(0);
    lapseTo(w, "2027-04-15T23:00");
    expect(taxed().map((p) => [...p.lines].sort((a, b) => a.account.localeCompare(b.account)))).toEqual([
      [
        { account: "checking", amount: -owed },
        { account: "economy.external:tax:federal", amount: owed },
      ],
    ]);
  });
});

describe("holdings: the accounts a payment uses", () => {
  const accounts = (world: WorldDoc): void => {
    world.entities.cd = account("cd", "Certificate of deposit", "you", "cd", 2_000_000);
    world.entities.ira = account("ira", "IRA", "you", "retirement", 0);
    world.entities.jordan_checking = account("jordan_checking", "Jordan's checking", "jordan", "checking", 900_000);
    world.entities.h_still = holding("h_still", "brokerage", "still", [{ qty: 100, cost: 400_000, at: "2026-06-01" }]);
    world.entities.h_ira_still = holding("h_ira_still", "ira", "still", [{ qty: 100, cost: 400_000, at: "2026-06-01" }]);
    const assets = world.packs.economy?.config.assets;
    if (assets && typeof assets === "object" && !Array.isArray(assets)) {
      assets.still_put = { label: "STIL Nov $60 put", class: "option", underlying: "still", strike: 6000, expiry: "2026-11-20", right: "put", multiplier: 100 };
      assets.still_cash = { label: "STIL Nov $40 call (cash)", class: "option", underlying: "still", strike: 4000, expiry: "2026-11-20", right: "call", multiplier: 100, settlement: "cash" };
    }
    world.entities.h_put = holding("h_put", "brokerage", "still_put", [{ qty: 1, cost: 90_000, at: "2026-10-01" }]);
    world.entities.h_cash = holding("h_cash", "brokerage", "still_cash", [{ qty: 1, cost: 20_000, at: "2026-10-01" }]);
    world.entities.h_ira_put = holding("h_ira_put", "ira", "still_put", [{ qty: 1, cost: 90_000, at: "2026-10-01" }]);
    world.entities.stall = { id: "stall", kind: "business", name: "The stall", tier: "background", fields: { owners: [{ party: "you", role: "owner", share: 100 }], value: 1_000_000 }, relations: [] };
    world.entities.lot = { id: "lot", kind: "property", name: "The lot", tier: "background", fields: { place: "apartment", owners: [], value: 1_000_000 }, relations: [] };
  };

  test("nothing is paid from a CD or a retirement account, nor into someone else's account", () => {
    const w = setup(accounts);
    const before = structuredClone(w.state.accounts);
    const refused = [
      refuse(w, "economy.trade", { party: "you", side: "buy", asset: "index", account: "brokerage", qty: 1, from: "cd" }),
      refuse(w, "economy.property_buy", { party: "you", property: "lot", from: "ira" }),
      refuse(w, "economy.exercise", { party: "you", holding: "h_put", qty: 1, to: "jordan_checking" }),
      refuse(w, "economy.exercise", { party: "you", holding: "h_cash", qty: 1, to: "jordan_checking" }),
      refuse(w, "economy.stake_sell", { party: "you", business: "stall", share: 100, price: 1_000_000, to: "jordan_checking" }),
    ];
    expect(refused).toEqual(["locked", "locked", "not_owner", "not_owner", "not_owner"]);
    expect(w.state.accounts).toEqual(before);
  });

  test("a put held in a retirement account pays its strike into that account, never out of it", () => {
    const w = setup(accounts);
    expect(refuse(w, "economy.exercise", { party: "you", holding: "h_ira_put", qty: 1, to: "checking" })).toBe("locked");
    const ira = balance(w, "ira");
    run(w, "economy.exercise", { party: "you", holding: "h_ira_put", qty: 1 });
    expect(balance(w, "ira") - ira).toBe(600_000);
    expect(qtyOf(lotsOf(w.ctx, "h_ira_still"))).toBe(0);
    expect(trialBalance(w.state)).toBe(0);
  });
});
