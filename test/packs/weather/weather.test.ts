import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildWeatherView, CLIMATES } from "../../../src/packs/weather/core/index";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(level: 1 | 2 | 3 | 4, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.weather = level;
  patch(world);
  return new Working(reg, world, startState(world));
}

function lapse(w: Working, minutes: number, seed = "wx"): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: seed, overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

function history(w: Working): string[] {
  return w.events.flatMap((e) => (e.type === "set" && e.entity === "region_riverton" && (e.field === "weather" || e.field === "temp_c") ? [`${e.field}=${String(e.value)}`] : []));
}

describe("weather pack", () => {
  test("level 1 shows only the season's mood; level 2 the region's state; level 3 temperatures", () => {
    const w1 = setup(1);
    expect(buildWeatherView(w1.ctx)).toMatchObject({ level: 1, label: "a crisp autumn", sky: null, tempC: null });
    const w3 = setup(3);
    lapse(w3, 720);
    const v = buildWeatherView(w3.ctx);
    expect(v.sky).not.toBeNull();
    expect(typeof v.tempC).toBe("number");
    expect(v.label).toMatch(/°C$/);
  });

  test("the climate is reproducible and segmentation-invariant: 3 days at once equal 3 one-day steps", () => {
    const a = setup(3);
    lapse(a, 3 * 1440);
    const b = setup(3);
    for (let i = 0; i < 3; i++) lapse(b, 1440);
    expect(history(b)).toEqual(history(a));
    expect(b.state.entities.region_riverton?.fields).toEqual(a.state.entities.region_riverton?.fields);
    expect(fold(reg, a.world, startState(a.world), a.events)).toEqual(a.state);
  });

  test("draws stay inside the season's weights", () => {
    const w = setup(3, (wd) => {
      wd.entities.region_riverton!.fields.climate = "tropical";
    });
    lapse(w, 10 * 1440);
    const wet = CLIMATES.tropical?.seasons.find((s) => s.months.includes(10))?.weights ?? {};
    const seen = new Set(history(w).filter((h) => h.startsWith("weather=")).map((h) => h.slice("weather=".length)));
    expect(seen.size).toBeGreaterThan(1);
    for (const s of seen) expect(wet[s]).toBeGreaterThan(0);
  });

  test("travel effects apply only at level 4; the lint checks month coverage and state names", () => {
    const w = setup(3);
    w.state.entities.region_riverton!.fields.weather = "storm";
    expect(w.ctx.query("weather.travel_factor")(w.ctx, "riverton", "road")).toBe(1);
    expect(w.ctx.query("weather.closed_modes")(w.ctx, "lake")).toEqual([]);
    w.state.realism.levels.weather = 4;
    expect(w.ctx.query("weather.travel_factor")(w.ctx, "riverton", "road")).toBe(1.6);
    expect(w.ctx.query("weather.closed_modes")(w.ctx, "lake")).toEqual(["water"]);
    const world = modernUsWorld("w", "R");
    world.packs.weather!.config.climates = [{ region: "x", label: "X", states: [{ id: "clear", label: "Clear", effects: {} }], seasons: [{ label: "Most", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], weights: { clear: 1, hail: 2 }, tempC: [0, 10] }] }];
    const issues = reg.lints.flatMap((l) => (l.code === "weather.climates" ? l.check(world) : []));
    expect(issues.map((i) => i.message)).toEqual(["Climate x: month 12 is covered 0 times.", "Climate x, Most: unknown state hail."]);
  });

  test("the ✎ weather fix targets the region over the player with its climate's states, from level 2", () => {
    expect(setup(1).ctx.query("weather.fix")(setup(1).ctx)).toBeNull();
    const w = setup(2);
    const target = w.ctx.query("weather.fix")(w.ctx);
    expect(target).toMatchObject({ entity: "region_riverton", field: "weather", type: "text", value: w.state.entities.region_riverton?.fields.weather });
    expect(target?.options?.map((o) => o.value)).toEqual(CLIMATES.temperate?.states.map((s) => s.id) ?? []);
    expect(w.apply({ type: "set", entity: "region_riverton", field: "weather", value: "fog" })).toBeNull();
    expect(buildWeatherView(w.ctx).label).toBe("Fog");
    expect(w.ctx.query("weather.fix")(w.ctx)?.value).toBe("fog");
  });

  test("a corrected sky holds until the climate next changes it", () => {
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const climate = (id: string, weights: Record<string, number>) => ({ id, label: id, persist: 1, states: [{ id: "clear", label: "Clear" }, { id: "fog", label: "Fog" }], seasons: [{ label: "All", months, weights, tempC: [5, 10] }] });
    const corrected = (id: string) => {
      const w = setup(2, (wd) => {
        wd.packs.weather!.config.climates = [climate("still", { clear: 1, fog: 1 }), climate("never_fog", { clear: 1 })];
        wd.entities.region_riverton!.fields.climate = id;
      });
      expect(w.apply({ type: "set", entity: "region_riverton", field: "weather", value: "fog" })).toBeNull();
      lapse(w, 3 * 1440);
      return w.state.entities.region_riverton?.fields.weather;
    };
    // A climate that keeps every state it can draw keeps the correction; one that can't hold fog replaces it.
    expect(corrected("still")).toBe("fog");
    expect(corrected("never_fog")).toBe("clear");
  });
});
