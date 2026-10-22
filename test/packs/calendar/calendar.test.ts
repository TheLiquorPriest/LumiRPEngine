import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { createRegistry } from "../../../src/engine/registry-impl";
import { evalExpr, scopeEnv } from "../../../src/engine/scope";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildCalendarView } from "../../../src/packs/calendar/core/view";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(level: 1 | 2 | 3 | 4, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.calendar = level;
  patch(world);
  return new Working(reg, world, startState(world));
}

function formula(w: Working, src: string): unknown {
  return evalExpr(src, scopeEnv({ reg, ctx: w.ctx, bindings: {} }));
}

function scene(w: Working): string[] {
  return reg.renderers.filter((r) => r.slot === "scene").flatMap((r) => r.render(w.ctx)).filter((l) => l.startsWith("Time:") || l.startsWith("Today"));
}

describe("calendar pack", () => {
  test("the panel shows day parts only at level 1, the date and commitments from level 2", () => {
    const w1 = setup(1);
    expect(buildCalendarView(w1.ctx)).toMatchObject({ level: 1, date: "", weekday: "", dayPart: "Morning", upcoming: [] });
    expect(scene(w1)).toEqual(["Time: Morning."]);
    const w2 = setup(2);
    const v = buildCalendarView(w2.ctx);
    expect([v.date, v.weekday]).toEqual(["16 Oct 2026", "Fri"]);
    expect(v.upcoming.find((u) => u.kind === "commitment")?.label).toBe("work shift");
    expect(scene(w2)[0]).toMatch(/^Time: .*7:30 AM.*\(morning\)\.$/);
  });

  test("formulas: weekday, minutes and days until, weekends; holidays are days off at level 4 only", () => {
    const w = setup(4);
    expect(formula(w, "weekday_name()")).toBe("Fri");
    expect(formula(w, "minutes_until('09:00')")).toBe(90);
    expect(formula(w, "days_until('2026-10-20')")).toBe(4);
    expect(formula(w, "is_weekend()")).toBe(false);
    const cal = calendarOf(w.world);
    w.apply({ type: "clock", minutes: clockOfLocal(cal, "2026-11-26T10:00") - w.state.clock, cause: "advance" });
    expect(formula(w, "is_day_off()")).toBe(true);
    expect(buildCalendarView(w.ctx).holidays.some((h) => /thanksgiving/i.test(h))).toBe(true);
    expect(scene(w).some((l) => /^Today is .*Thanksgiving/i.test(l))).toBe(true);
    w.state.realism.levels.calendar = 3;
    expect(formula(w, "is_day_off()")).toBe(false);
  });

  test("lints: bad schedule times and weekdays, a unit cap below one slot", () => {
    const world = modernUsWorld("w", "R");
    world.schedules.bad = { id: "bad", owner: "you", target: "activity", recurrence: { every: "week", weekdays: [7] }, slots: [{ start: "9am", end: "17:00", value: "x" }] };
    world.time.unitCap.agentDays = 0.1;
    const codes = reg.lints.flatMap((l) => l.check(world)).map((i) => i.code);
    expect(codes.filter((c) => c === "calendar.schedule_times")).toHaveLength(2);
    expect(codes).toContain("calendar.unit_cap");
  });

  test("the time_advance channel only accepts positive minutes", () => {
    const w = setup(2);
    const ch = reg.proposals.get("time_advance");
    expect(ch?.validate({ minutes: 30 }, w.ctx)).toBeNull();
    expect(ch?.validate({ minutes: 0 }, w.ctx)?.code).toBe("bad_proposal");
  });
});
