// The Calendar panel's view model (`calendar.calendar`). Time controls themselves come from the
// StateView's `controls` (backend); this panel shows the date, the day part, today's holidays and
// what is coming up for the POV.

import type { ReadContext } from "../../../engine/registry";
import { dateAt, dayPartAt, formatClock, holidaysOn, MINUTES_PER_DAY, monthName, placeOffset, weekdayName } from "../../../engine/calendar";
import { allSchedules, nextStartFor, scheduleOwners } from "../../../engine/schedules";
import { placeOfEntity } from "../../../engine/scope";
import { calendarIn } from "../../../engine/holidays";

export interface CalendarView {
  level: number;
  /** `16 Oct 2026` (empty at level 1, where only day parts show). */
  date: string;
  weekday: string;
  dayPart: string;
  holidays: string[];
  upcoming: { at: string; label: string; kind: "holiday" | "commitment" }[];
}

/** How many days ahead the panel looks for a holiday. */
const UPCOMING_HOLIDAY_DAYS = 30;

/** Holidays within the next 30 days and the POV's commitments within the next 2 days, in the order they come. */
export function buildCalendarView(ctx: ReadContext): CalendarView {
  const reg = ctx.registry;
  const cal = calendarIn(ctx);
  const level = ctx.levelOf(ctx.world.pov, "calendar");
  const offset = level >= 3 ? placeOffset(ctx.world, ctx.state.clock, placeOfEntity(ctx.state, ctx.world.pov)) : 0;
  const now = ctx.state.clock + offset;
  const d = dateAt(cal, now);
  // Each with the minute it comes at (the world's own clock), so the two kinds stand in one order, nearest first.
  const coming: { when: number; entry: CalendarView["upcoming"][number] }[] = [];
  const holidays: string[] = [];
  if (level >= 4) {
    for (const h of holidaysOn(cal, d.dayIndex)) holidays.push(h.label);
    // Day by day, so the year's end is no edge: what falls in the new year follows what falls in the old one.
    for (let day = d.dayIndex + 1; day <= d.dayIndex + UPCOMING_HOLIDAY_DAYS; day++) {
      for (const h of holidaysOn(cal, day)) {
        const local = day * MINUTES_PER_DAY - cal.epochMinute;
        coming.push({ when: local - offset, entry: { at: formatClock(cal, local).split(",")[0] ?? "", label: h.label, kind: "holiday" } });
      }
    }
  }
  if (level >= 2) {
    for (const s of allSchedules(reg, ctx.world)) {
      if (s.target !== "activity" || !scheduleOwners(reg, ctx.world, ctx.state, s).includes(ctx.world.pov)) continue;
      const n = nextStartFor(reg, ctx, s, ctx.world.pov, ctx.state.clock, 2);
      const v = n?.slot.value;
      if (n && typeof v === "string") coming.push({ when: n.at, entry: { at: formatClock(cal, n.at, offset), label: v.replace(/_/g, " "), kind: "commitment" } });
    }
  }
  const upcoming = coming.sort((a, b) => a.when - b.when).map((c) => c.entry);
  return {
    level,
    date: level >= 2 ? `${d.day} ${monthName(cal, d.month)} ${d.year}` : "",
    weekday: level >= 2 ? weekdayName(cal, d.weekday) : "",
    dayPart: dayPartAt(cal, now).label,
    holidays,
    upcoming,
  };
}
