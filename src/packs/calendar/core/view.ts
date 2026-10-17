// The Calendar panel's view model (`calendar.calendar`). Time controls themselves come from the
// StateView's `controls` (backend); this panel shows the date, the day part, today's holidays and
// what is coming up for the POV.

import type { ReadContext } from "../../../engine/registry";
import { calendarOf, dateAt, dayPartAt, formatClock, holidayDay, MINUTES_PER_DAY, monthName, placeOffset, weekdayName } from "../../../engine/calendar";
import { allSchedules, nextStart, scheduleOwners } from "../../../engine/schedules";
import { placeOfEntity } from "../../../engine/scope";

export interface CalendarView {
  level: number;
  /** `16 Oct 2026` (empty at level 1, where only day parts show). */
  date: string;
  weekday: string;
  dayPart: string;
  holidays: string[];
  upcoming: { at: string; label: string; kind: "holiday" | "commitment" }[];
}

/** Holidays within the next 30 days and the POV's commitments within the next 2 days. */
export function buildCalendarView(ctx: ReadContext): CalendarView {
  const reg = ctx.registry;
  const cal = calendarOf(ctx.world);
  const level = ctx.levelOf(ctx.world.pov, "calendar");
  const offset = level >= 3 ? placeOffset(ctx.world, ctx.state.clock, placeOfEntity(ctx.state, ctx.world.pov)) : 0;
  const now = ctx.state.clock + offset;
  const d = dateAt(cal, now);
  const upcoming: CalendarView["upcoming"] = [];
  const holidays: string[] = [];
  if (level >= 4) {
    for (const h of ctx.world.calendar.holidays) {
      const day = holidayDay(cal, h, d.dayIndex);
      const next = day !== null && day >= d.dayIndex ? day : holidayDay(cal, h, d.dayIndex + 366);
      if (next === null) continue;
      if (next === d.dayIndex) holidays.push(h.label);
      else if (next > d.dayIndex && next - d.dayIndex <= 30) upcoming.push({ at: formatClock(cal, next * MINUTES_PER_DAY - cal.epochMinute).split(",")[0] ?? "", label: h.label, kind: "holiday" });
    }
  }
  if (level >= 2) {
    for (const s of allSchedules(reg, ctx.world)) {
      if (s.target !== "activity" || !scheduleOwners(reg, ctx.world, ctx.state, s).includes(ctx.world.pov)) continue;
      const n = nextStart(ctx.world, s, ctx.state.clock, 2);
      const v = n?.slot.value;
      if (n && typeof v === "string") upcoming.push({ at: formatClock(cal, n.at, offset), label: v.replace(/_/g, " "), kind: "commitment" });
    }
  }
  return {
    level,
    date: level >= 2 ? `${d.day} ${monthName(cal, d.month)} ${d.year}` : "",
    weekday: level >= 2 ? weekdayName(cal, d.weekday) : "",
    dayPart: dayPartAt(cal, now).label,
    holidays,
    upcoming,
  };
}
