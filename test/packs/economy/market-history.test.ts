// The stock market follows history (DESIGN §27.2), folded: where a world keeps the stock index's
// history (`economy.index_history`, the TSP C Fund's month-end closes), the equity market moves
// with it every trading day, so its month-end closes stand to each other as the history's, the
// same in every chat; outside the history's months it walks, calibrated to the history, a world's
// own; a world without the history keeps the seeded market it had. Each month's last close is kept
// for every asset, and the investment view shows the market's and each holding's performance.

import { describe, expect, test } from "bun:test";
import type { InvestmentsView } from "../../../src/shared/finance";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { materializeAll } from "../../../src/engine/materialize";
import { objOf } from "../../../src/engine/pack-kit";
import { createRegistry } from "../../../src/engine/registry-impl";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { assetOf, holdingsSlice, quoteOf } from "../../../src/packs/economy/core/assets";
import { INDEX_HISTORY_TABLE, indexHistory, indexMonthReturn } from "../../../src/packs/economy/core/history";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const ALL_NOTE = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } as const;

/** Riverton at Money 4 from `start`, without its LOD1 agents: an index fund that is the market (`idx`), a single stock (`stock`), and the player holding the fund. */
function riverton(start: string, patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  const world = modernUsWorld("w", "Riverton");
  world.start.at = start;
  for (const id of ["maya", "jordan", "rosa"]) {
    const e = world.entities[id];
    if (e) e.agent = false;
  }
  const economy = world.packs.economy;
  if (economy) economy.config = { ...economy.config, assets: { idx: { label: "Total Market Index Fund", symbol: "TMKT", class: "fund", price: 10000, correlation: 1, yield_pct: 0 }, stock: { label: "Lakeshore Freight", symbol: "LKFR", class: "security", price: 4250 } } };
  const held: EntityDef = { id: "h_idx", kind: "holding", name: "h_idx", tier: "background", fields: { asset: "idx", lots: [{ qty: 10, cost: 100_000, at: start.slice(0, 10) }], owners: [{ party: "you", role: "owner" }] }, relations: [] };
  world.entities.h_idx = held;
  patch(world);
  return world;
}

function setup(start: string, patch?: (w: WorldDoc) => void): Working {
  const world = riverton(start, patch);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

/** A timelapse to a local time, segment after segment as Continue would run them. */
function lapseTo(w: Working, at: string, seed = "run"): void {
  const to = clockOfLocal(calendarOf(w.world), at);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: seed, overrides: ALL_NOTE });
    if ("code" in out) throw new Error(out.reason);
  }
}

function price(w: Working, asset: string): number {
  return quoteOf(w.ctx, asset) ?? NaN;
}

function level(w: Working, month: string): number {
  return Number(objOf(w.world.tables[INDEX_HISTORY_TABLE]?.rows[month]).level);
}

function investments(w: Working): InvestmentsView {
  const inv = w.ctx.query("economy.finance")(w.ctx, "you", true).investments;
  if (!inv) throw new Error("no investments view");
  return inv;
}

/** The fund's closes on each of the given days: the market closes at 16:00, marked as the afternoon that holds it ends (a slot is stepped once it ends), at 18:00. */
function closes(w: Working, days: string[], seed = "run"): number[] {
  return days.map((d) => {
    lapseTo(w, `${d}T18:00`, seed);
    return price(w, "idx");
  });
}

describe("the stock index's history", () => {
  test("its calibration is the history's own: the monthly log returns' mean and spread, and the yearly drift and volatility they make", () => {
    const w = setup("2026-10-16T07:30");
    const rows = w.world.tables[INDEX_HISTORY_TABLE]?.rows ?? {};
    const months = Object.keys(rows);
    const logs = months.slice(1).map((m, i) => Math.log(Number(rows[m]?.level) / Number(rows[months[i] ?? ""]?.level)));
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1));
    const h = indexHistory(w.ctx);
    expect(h).toMatchObject({ first: "2003-05", last: "2026-10" });
    expect(h?.monthlyMean).toBeCloseTo(mean, 12);
    expect(h?.monthlyVol).toBeCloseTo(sd, 12);
    expect(h?.volPct).toBeCloseTo(sd * Math.sqrt(12) * 100, 9);
    expect(h?.driftPct).toBeCloseTo((12 * mean + (12 * sd * sd) / 2) * 100, 9);
    // Inside its months a month's return is the history's.
    expect(indexMonthReturn(w.ctx, "2008-10")).toBeCloseTo(Math.log(11.1223 / 13.3723), 12);
  });

  test("an equity asset's model takes the history's drift and volatility, less what it pays out; a world without the history keeps the table's", () => {
    const w = setup("2026-10-16T07:30");
    const h = indexHistory(w.ctx);
    expect(assetOf(w.ctx, "idx")).toMatchObject({ vol: h?.volPct, drift: h?.driftPct, rho: 1 });
    // A single stock swings as its class says, around the history's drift less its dividends.
    expect(assetOf(w.ctx, "stock")?.drift).toBeCloseTo((h?.driftPct ?? 0) - 1.3, 9);
    const old = setup("2026-10-16T07:30", (world) => {
      delete world.tables[INDEX_HISTORY_TABLE];
      delete world.pins.tables[INDEX_HISTORY_TABLE];
    });
    expect(indexHistory(old.ctx)).toBeNull();
    expect(assetOf(old.ctx, "idx")).toMatchObject({ vol: 16, drift: 11 });
  });
});

describe("the market follows the history", () => {
  test("through October 2008 the index fund falls as the market did: its month-end closes stand to each other as the history's", () => {
    const w = setup("2008-09-29T08:00");
    const [september = NaN, october = NaN] = closes(w, ["2008-09-30", "2008-10-31"]);
    expect(october / september).toBeCloseTo(level(w, "2008-10") / level(w, "2008-09"), 6);
    expect(october / september).toBeCloseTo(11.1223 / 13.3723, 6);
  });

  test("it moves every trading day, and the market's days are the same in every chat, whatever its seed", () => {
    const days = ["2008-10-01", "2008-10-02", "2008-10-03", "2008-10-06", "2008-10-07", "2008-10-08"];
    const a = closes(setup("2008-09-29T08:00"), days, "alpha");
    const b = closes(setup("2008-09-29T08:00"), days, "beta");
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
    // A weekend is no trading day.
    const w = setup("2008-10-03T08:00");
    const [friday, sunday] = closes(w, ["2008-10-03", "2008-10-05"]);
    expect(sunday).toBe(friday);
  });

  test("a single stock moves with the market by its own beta and its own swings, so it differs from chat to chat", () => {
    const days = ["2008-10-31"];
    const a = closes(setup("2008-09-29T08:00"), days, "alpha");
    const one = setup("2008-09-29T08:00");
    lapseTo(one, "2008-10-31T18:00", "alpha");
    const two = setup("2008-09-29T08:00");
    lapseTo(two, "2008-10-31T18:00", "beta");
    expect(price(one, "stock")).not.toBe(price(two, "stock"));
    expect(a).toHaveLength(1);
  });
});

describe("outside the history's months, a calibrated random walk", () => {
  test("its monthly returns have the history's mean and spread", () => {
    const w = setup("2026-10-16T07:30");
    const h = indexHistory(w.ctx);
    if (!h) throw new Error("no history");
    const months: string[] = [];
    for (let y = 2027; y < 2077; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
    const draws = months.map((m) => indexMonthReturn(w.ctx, m) ?? NaN);
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / (draws.length - 1));
    expect(Math.abs(mean - h.monthlyMean)).toBeLessThan((4 * h.monthlyVol) / Math.sqrt(draws.length));
    expect(sd / h.monthlyVol).toBeGreaterThan(0.85);
    expect(sd / h.monthlyVol).toBeLessThan(1.15);
    // Before the history too.
    expect(indexMonthReturn(w.ctx, "1995-06")).not.toBeNull();
  });

  test("it is the world's own walk: every chat of the world follows it, another world walks its own", () => {
    const days = ["2030-03-04", "2030-03-05", "2030-03-29"];
    const a = closes(setup("2030-03-01T08:00"), days, "alpha");
    const b = closes(setup("2030-03-01T08:00"), days, "beta");
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    const other = setup("2030-03-01T08:00", (world) => {
      world.id = "w2";
    });
    expect(closes(other, days, "alpha")).not.toEqual(a);
  });

  test("a world without the history keeps the seeded market it had: the index fund's path follows the chat's seed", () => {
    const old = (world: WorldDoc): void => {
      delete world.tables[INDEX_HISTORY_TABLE];
      delete world.pins.tables[INDEX_HISTORY_TABLE];
    };
    const a = closes(setup("2008-09-29T08:00", old), ["2008-10-31"], "alpha");
    const b = closes(setup("2008-09-29T08:00", old), ["2008-10-31"], "beta");
    expect(a).not.toEqual(b);
  });
});

describe("performance", () => {
  test("each month's last close is kept for every asset that moves, the last thirteen", () => {
    const w = setup("2008-09-29T08:00");
    const [september = NaN, october = NaN] = closes(w, ["2008-09-30", "2008-10-31"]);
    expect(objOf(holdingsSlice(w.state).closes).idx).toEqual([
      ["2008-09", september],
      ["2008-10", october],
    ]);
  });

  test("the investment view shows the market's month, year and twelve months from the history, and each holding's from its kept closes", () => {
    const w = setup("2008-09-29T08:00");
    const [september = NaN, october = NaN] = closes(w, ["2008-09-30", "2008-10-31"]);
    lapseTo(w, "2008-11-14T18:00");
    const now = price(w, "idx");
    const inv = investments(w);
    expect(inv.index).toMatchObject({ history: true, from: "2003-05", to: "2026-10" });
    expect(inv.index?.year).toBeCloseTo((inv.index?.points.at(-1)?.level ?? NaN) / ((level(w, "2007-12") / level(w, "2008-10")) * (inv.index?.points.at(-2)?.level ?? NaN)) * 100 - 100, 6);
    expect(inv.index?.twelve).toBeCloseTo((level(w, "2008-10") / level(w, "2007-10") - 1) * 100, 6);
    expect(inv.index?.points.map((p) => p.at).slice(0, 2)).toEqual(["2007-10", "2007-11"]);
    expect(inv.index?.points).toHaveLength(14);
    const h = inv.holdings.find((x) => x.id === "h_idx");
    expect(h?.performance?.points.map((p) => p.price)).toEqual([september, october, now]);
    expect(h?.performance?.month).toBeCloseTo((now / october - 1) * 100, 6);
    expect(h?.performance?.year).toBeNull();
    expect(h?.performance?.twelve).toBeNull();
  });

  test("past the history's months the view says the market walks", () => {
    const w = setup("2026-11-02T08:00");
    lapseTo(w, "2026-11-04T18:00");
    expect(investments(w).index).toMatchObject({ history: false, to: "2026-10" });
  });
});
