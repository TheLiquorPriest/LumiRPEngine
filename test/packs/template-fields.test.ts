// Template-field support (data-src/templates → lre-world-v1): the fields the converter passes through.
import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { materializeAll } from "../../src/engine/materialize";
import { createRng } from "../../src/engine/rng";
import { ALL_NOTE } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { kitStatus } from "../../src/packs/gear/core/model";
import { priceOf } from "../../src/packs/economy/core/model";
import { routeAt } from "../../src/packs/space/core/travel";
import { modernUsWorld } from "./riverton";
import { startState, trialBalance } from "./support";
import { migrateMoney } from "../../src/engine/money-migrate";

const reg = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void): Working {
  const authored = modernUsWorld("w", "R");
  authored.realism.levels.money = 4;
  patch(authored);
  // The fields as a template writes them, read as the converter's world reads them (migrated).
  const world = migrateMoney(authored);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function lapse(w: Working, days: number): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes: days * 1440 }, { runSeed: "t", overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

function posts(w: Working, memo: RegExp): Extract<LedgerEvent, { type: "post" }>[] {
  return w.events.flatMap((e) => (e.type === "post" && memo.test(e.memo ?? "") ? [e] : []));
}

describe("template fields: money", () => {

  test("a loan pays its amortized payment on dueDay (once, even when a bill to the lender repeats it); a card's `minimum from <account>` autopay pays from that account on dueDay", () => {
    const w = setup((wd) => {
      wd.entities.loan = { id: "loan", kind: "account", name: "Auto loan", tier: "background", fields: { owner: "you", type: "loan", institution: "Lakeshore CU", payment: 43631, apr_pct: 9.4, remaining_months: 48, due_day: 10, autopay: "from checking", opening: -1740000 }, relations: [] };
      wd.entities.card!.fields.autopay = "minimum from savings";
      const you = wd.entities.you!.fields;
      you.bills = [...(Array.isArray(you.bills) ? you.bills : []), { label: "Auto loan payment", payee: "Lakeshore CU", amountCents: 43631, every: "month", day: 10, from: "checking" }];
    });
    lapse(w, 45);
    const loan = posts(w, /^Auto loan autopay/);
    expect(loan).toHaveLength(1);
    expect(Math.abs((loan[0]?.lines.find((l) => l.account === "loan")?.amount ?? 0) - 43631)).toBeLessThanOrEqual(2);
    const autopay = posts(w, /^Visa card autopay/);
    expect(autopay.length).toBeGreaterThan(0);
    expect(autopay[0]?.lines.find((l) => l.account === "savings")?.amount).toBeLessThan(0);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a vehicle's class premium isn't charged when an authored auto-insurance bill covers it; recurring payments never come from wallet cash", () => {
    const covered = setup((wd) => {
      wd.realism.levels.vehicles = 4;
      wd.entities.you!.fields.bills = [{ label: "Auto insurance, full coverage", payee: "Midlake Mutual", amountCents: 22500, every: "month", day: 5 }];
    });
    lapse(covered, 35);
    expect(posts(covered, /^Insurance: /)).toEqual([]);
    expect(posts(covered, /^Auto insurance/).every((p) => !p.lines.some((l) => l.account === "cash"))).toBe(true);
    const uncovered = setup((wd) => {
      wd.realism.levels.vehicles = 4;
    });
    lapse(uncovered, 35);
    const premiums = posts(uncovered, /^Insurance: /);
    expect(premiums.length).toBeGreaterThan(0);
    expect(premiums.every((p) => !p.lines.some((l) => l.account === "cash"))).toBe(true);
  });
});

describe("template fields: gear, weather, routes, flags", () => {
  test("an inline kit (pieces + taken) derives its completeness", () => {
    const w = setup((wd) => {
      wd.entities.first_aid = { id: "first_aid", kind: "kit", name: "First-aid kit", tier: "background", fields: { owner: "you", place: "garage", pieces: [{ name: "bandage", qty: 4 }, { name: "gauze pad", qty: 2 }], piece_count: 6, taken: { bandage: 1 } }, relations: [] };
    });
    expect(kitStatus(w.ctx, "first_aid")).toMatchObject({ present: 5, total: 6, complete: false, missing: ["bandage ×1"] });
  });

  test("a template climate: scripted gale closes water travel and slows roads; it holds, then the climate steps again", () => {
    const w = setup((wd) => {
      wd.realism.levels.space = 4;
      wd.realism.levels.weather = 4;
      wd.packs.weather!.config.climates = [
        {
          region: "lakeshore",
          label: "Lake shore",
          states: [
            { id: "clear", label: "Clear", effects: {} },
            { id: "gale", label: "Gale", effects: { travelTimeMultiplier: { road: 1.2, water: 2 }, closes: ["water"] } },
          ],
          seasons: [{ label: "All year", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weights: { clear: 1 }, tempC: [5, 15] }],
        },
      ];
      wd.entities.region_riverton!.fields.climate = "lakeshore";
    });
    const before = routeAt(w.ctx, "riverton", "lake", "road")?.minutes ?? 0;
    expect(routeAt(w.ctx, "lake", "trailhead", "water")).not.toBeNull();
    const r = applyEffects(reg, w, [{ type: "weather.set", args: { region: "lake", state: "gale", minutes: 300 } }], { bindings: {}, rng: createRng("g") });
    expect(r.rejected).toEqual([]);
    expect(routeAt(w.ctx, "lake", "trailhead", "water")).toBeNull();
    expect(routeAt(w.ctx, "riverton", "lake", "road")?.minutes).toBeCloseTo(before * 1.2, 5);
    lapse(w, 1);
    expect(w.state.entities.region_riverton?.fields.weather).toBe("clear");
  });

  test("closed routes: closedRoutes config, then space.set_route opens or closes them", () => {
    const w = setup((wd) => {
      wd.packs.space!.config.closedRoutes = ["town_trail"];
    });
    expect(routeAt(w.ctx, "riverton", "trailhead", "offroad")).toBeNull();
    applyEffects(reg, w, [{ type: "space.set_route", args: { route: "town_trail", open: true } }, { type: "space.set_route", args: { route: "lake_crossing", open: false } }], { bindings: {}, rng: createRng("r") });
    expect(routeAt(w.ctx, "riverton", "trailhead", "offroad")).not.toBeNull();
    expect(routeAt(w.ctx, "lake", "trailhead", "water")).toBeNull();
  });

  test("story flags fall back to the author's defaults", () => {
    const w = setup((wd) => {
      wd.packs.story!.config.flags = { ferry_running: true };
    });
    expect(w.ctx.query("story.flag")(w.ctx, "ferry_running")).toBe(true);
    applyEffects(reg, w, [{ type: "story.flag", args: { name: "ferry_running", value: false } }], { bindings: {}, rng: createRng("f") });
    expect(w.ctx.query("story.flag")(w.ctx, "ferry_running")).toBe(false);
  });
});

describe("template effects: price modifiers and scripted weather", () => {
  test("economy.price_modifier scales a category at a place after regional scaling, for its minutes or until cleared", () => {
    const w = setup(() => undefined);
    const base = priceOf(w.ctx, { category: "electronics", place: "cafe" })?.unitCents ?? 0;
    const r = applyEffects(reg, w, [{ type: "economy.price_modifier", args: { place: "riverton", scope: "electronics", percent: 50, minutes: 120 } }], { bindings: {}, rng: createRng("m") });
    expect(r.rejected).toEqual([]);
    expect(priceOf(w.ctx, { category: "electronics", place: "cafe" })?.unitCents).toBe(Math.round(base * 1.5));
    expect(priceOf(w.ctx, { category: "electronics", place: "lake" })?.unitCents).toBe(priceOf(w.ctx, { category: "electronics", place: "lake" })?.band.typical);
    expect(priceOf(w.ctx, { category: "groceries_staples", place: "cafe" })?.unitCents).toBe(priceOf(w.ctx, { category: "groceries_staples", place: null })?.unitCents);
    w.apply({ type: "clock", minutes: 121, cause: "advance" });
    expect(priceOf(w.ctx, { category: "electronics", place: "cafe" })?.unitCents).toBe(base);
    applyEffects(reg, w, [{ type: "economy.price_modifier", args: { scope: "all", percent: -20 } }, { type: "economy.price_modifier", args: { scope: "all", percent: 0 } }], { bindings: {}, rng: createRng("c") });
    expect(priceOf(w.ctx, { category: "electronics", place: "cafe" })?.unitCents).toBe(base);
  });

  test("weather.set holds a scripted storm until its condition comes true; weather.clear ends one at once", () => {
    const w = setup((wd) => {
      wd.realism.levels.weather = 4;
    });
    applyEffects(reg, w, [{ type: "weather.set", args: { region: "lake", state: "storm", until: "flag('storm_over')" } }], { bindings: {}, rng: createRng("s") });
    lapse(w, 2);
    expect(w.state.entities.region_riverton?.fields.weather).toBe("storm");
    applyEffects(reg, w, [{ type: "story.flag", args: { name: "storm_over" } }], { bindings: {}, rng: createRng("f") });
    lapse(w, 1);
    expect(w.state.entities.region_riverton?.fields.weather_hold_until).toBe("");
    applyEffects(reg, w, [{ type: "weather.set", args: { region: "region_riverton", state: "storm", minutes: 10000 } }, { type: "weather.clear", args: { region: "lake" } }], { bindings: {}, rng: createRng("x") });
    expect(w.state.entities.region_riverton?.fields.weather).not.toBe("storm");
    expect(w.state.entities.region_riverton?.fields.weather_hold).toBe(0);
  });
});
