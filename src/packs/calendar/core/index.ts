// Calendar & time pack (DESIGN §9.3): gregorian and custom calendars, weekdays, holidays,
// recurrence, per-place time zones and the per-turn tick. The time controls, Timelapse, Speed
// through and the Montage are engine features (engine/time.ts); this pack contributes the data
// tables, holiday import, calendar formulas, the Scene line, the Calendar panel and lint.
//
// Level contract (domain `calendar`):
//   0  off: no clock lines, no timelapse
//   1  day parts only (timelapse targets round to day parts)
//   2  clock and dates
//   3  recurrence and time zones (local time per place)
//   4  holidays, terms and exceptions

import type { JsonValue } from "../../../shared/json";
import type { DataTable } from "../../../shared/tables";
import type { DateRule, HolidayDef } from "../../../shared/world";
import { calendarOf, clockOfLocal, dateAt, dayIndexOf, dayPartAt, formatClock, holidaysOn, MINUTES_PER_DAY, nextTimeOfDay, parseHHMM, placeOffset, shortestSlot, weekdayName } from "../../../engine/calendar";
import type { PackDef } from "../../../engine/registry";
import { placeOfEntity } from "../../../engine/scope";
import { clockPaused } from "../../../engine/time";
import { numOf, strOf } from "../../../engine/pack-kit";
import { buildCalendarView } from "./view";
import dst from "./tables/modern-us/dst.json";
import holidays from "./tables/modern-us/holidays.json";
import observances from "./tables/modern-us/observances.json";
import school from "./tables/modern-us/school.json";
import shifts from "./tables/modern-us/shifts.json";
import work from "./tables/modern-us/work.json";

const TABLES: DataTable[] = [dst, holidays, observances, school, shifts, work] as unknown as DataTable[];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function weekdayIndex(v: JsonValue | undefined): number {
  if (typeof v === "number") return v;
  const i = WEEKDAYS.indexOf(strOf(v).toLowerCase());
  return i < 0 ? 0 : i;
}

/** A table row's date rule, or null when the rule type has no `DateRule` form (e.g. a window). */
function ruleOf(row: Record<string, JsonValue>): DateRule | null {
  switch (row.rule_type) {
    case "fixed":
      return { type: "fixed", month: numOf(row.month, 1), day: numOf(row.day, 1) };
    case "nth_weekday":
      return { type: "nth_weekday", month: numOf(row.month, 1), weekday: weekdayIndex(row.weekday), n: numOf(row.n, 1) };
    case "relative_to_easter":
      return { type: "easter", days: numOf(row.offset_days) };
    case "relative":
      return typeof row.base === "string" ? { type: "relative", to: row.base, days: numOf(row.offset_days) } : null;
    default:
      return null;
  }
}

/**
 * The world calendar's holidays from the pinned `calendar.holidays` (days off) and, optionally,
 * `calendar.observances` (no day off). Rows whose rule has no `DateRule` form are skipped.
 */
export function holidaysFromTables(holidayTable: DataTable | undefined, observanceTable?: DataTable): HolidayDef[] {
  const out: HolidayDef[] = [];
  for (const [table, dayOff] of [[holidayTable, true], [observanceTable, false]] as const) {
    if (!table) continue;
    for (const [id, row] of Object.entries(table.rows)) {
      const rule = ruleOf(row);
      if (rule) out.push({ id, label: strOf(row.name, id), rule, dayOff });
    }
  }
  return out;
}

export const calendarPack: PackDef = {
  id: "calendar",
  label: "Calendar & time",
  version: 1,
  domain: "calendar",
  requires: [],
  register(r) {
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t });

    r.formula("is_weekend", (ctx) => {
      const wd = dateAt(calendarOf(ctx.world), ctx.state.clock).weekday;
      return wd === 0 || wd === 6;
    });
    r.formula("is_day_off", (ctx) => {
      const cal = calendarOf(ctx.world);
      const d = dateAt(cal, ctx.state.clock);
      if (ctx.levelOf(ctx.world.pov, "calendar") >= 4 && holidaysOn(cal, d.dayIndex).some((h) => h.dayOff)) return true;
      return d.weekday === 0 || d.weekday === 6;
    });
    r.formula("minutes_until", (ctx, at) => {
      try {
        return nextTimeOfDay(calendarOf(ctx.world), ctx.state.clock, parseHHMM(String(at ?? ""))) - ctx.state.clock;
      } catch {
        return 0;
      }
    });
    r.formula("days_until", (ctx, date) => {
      try {
        const cal = calendarOf(ctx.world);
        return Math.ceil((clockOfLocal(cal, String(date ?? "")) - ctx.state.clock) / MINUTES_PER_DAY);
      } catch {
        return 0;
      }
    });
    r.formula("weekday_name", (ctx) => weekdayName(calendarOf(ctx.world), dateAt(calendarOf(ctx.world), ctx.state.clock).weekday));

    r.renderer({
      slot: "scene",
      render(ctx) {
        const level = ctx.levelOf(ctx.world.pov, "calendar");
        if (level === 0) return [];
        const cal = calendarOf(ctx.world);
        const place = placeOfEntity(ctx.state, ctx.world.pov);
        const offset = level >= 3 ? placeOffset(ctx.world, ctx.state.clock, place) : 0;
        const part = dayPartAt(cal, ctx.state.clock + offset).label;
        const lines = [level === 1 ? `Time: ${part}.` : `Time: ${formatClock(cal, ctx.state.clock, offset)} (${part.toLowerCase()}).`];
        if (level >= 4) {
          const today = holidaysOn(cal, dateAt(cal, ctx.state.clock + offset).dayIndex);
          if (today.length > 0) lines.push(`Today is ${today.map((h) => h.label).join(" and ")}.`);
        }
        if (clockPaused(ctx.world, ctx.state)) lines.push("The clock is paused for this scene.");
        return lines;
      },
    });

    r.view({ panel: "calendar.calendar", build: (ctx) => buildCalendarView(ctx) as unknown as JsonValue });

    r.proposal({
      type: "time_advance",
      boundField: "duration",
      // Applied by the backend through engine/time.applyTimeAdvance (all or nothing, with its catch-up).
      validate: (p) => (typeof p.minutes === "number" && p.minutes > 0 ? null : { code: "bad_proposal", reason: "time_advance needs minutes > 0" }),
      toEffects: () => [],
    });

    r.lint({
      code: "calendar.epoch",
      check(world) {
        try {
          calendarOf(world);
          dayIndexOf(calendarOf(world), 2000, 1, 1);
          return [];
        } catch (e) {
          return [{ severity: "error", code: "calendar.epoch", message: e instanceof Error ? e.message : "bad calendar", path: "calendar" }];
        }
      },
    });
    r.lint({
      code: "calendar.schedule_times",
      check(world) {
        const issues = [];
        for (const s of Object.values(world.schedules)) {
          for (const slot of s.slots) {
            for (const t of [slot.start, slot.end]) {
              try {
                parseHHMM(t);
              } catch {
                issues.push({ severity: "error" as const, code: "calendar.schedule_times", message: `Schedule ${s.id} has a bad time "${t}" (use HH:MM).`, path: `schedules.${s.id}` });
              }
            }
          }
          for (const wd of s.recurrence.weekdays ?? []) {
            if (wd < 0 || wd > 6) issues.push({ severity: "error" as const, code: "calendar.schedule_times", message: `Schedule ${s.id} names weekday ${wd}; weekdays are 0 (Sunday) to 6.`, path: `schedules.${s.id}` });
          }
        }
        return issues;
      },
    });
    r.lint({
      code: "calendar.unit_cap",
      check(world) {
        const agents = Object.values(world.entities).filter((e) => e.agent && e.id !== world.pov).length;
        const min = ((agents + 1) * shortestSlot(calendarOf(world))) / MINUTES_PER_DAY;
        return world.time.unitCap.agentDays < min
          ? [{ severity: "error", code: "calendar.unit_cap", message: `The timelapse unit cap (${world.time.unitCap.agentDays} agent-days) is smaller than one slot for ${agents} LOD1 agents plus the POV (${min.toFixed(2)}).`, path: "time.unitCap" }]
          : [];
      },
    });
  },
};

export default calendarPack;
