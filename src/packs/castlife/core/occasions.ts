// What makes a day different for someone (DESIGN §24.8): the weekend and days off, the holidays and
// observances the calendar puts on it, their own birthday and those of people they're fond of, the
// season and the weather over their home. The day planner reads it to shape the day's options;
// nothing here is recorded, so a day's occasion is re-derived wherever its plan is.

import type { JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import { calendarOf, clockAt, dateAt, holidaysOn, type CalDate, type Calendar } from "../../../engine/calendar";
import { isGone, kindIs } from "../../../engine/scope";
import { acts as lifeActs } from "../../../engine/life";
import { optionalQuery, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";

/** Regard toward someone at which their birthday is an occasion: the planner's "close friend". */
export const FOND = 30;

export interface Occasion {
  /** The world's weekend days (the calendar's first and seventh weekday, as `is_weekend` reads them). */
  weekend: boolean;
  /** The weekend, or a holiday that is a day off (Calendar 4). */
  dayOff: boolean;
  /** Holidays and observances on the day (Calendar 4); `dayOff` false for an observance. */
  holidays: { id: string; label: string; dayOff: boolean }[];
  /** Their own birthday. */
  birthday: boolean;
  /** People they're fond of whose birthday it is, in id order. */
  friends: EntityId[];
  /** The season (Weather 1 and up), else null. */
  season: string | null;
  /** Whether the sky over their home keeps people in (Weather 2 and up), else null. */
  foul: boolean | null;
}

/**
 * A `birthday` field as a date of the world's calendar: `MM-DD`, or a full `YYYY-MM-DD` whose year
 * counts their age. A year makes it a date of that year (1996-02-29, never 1994-02-29); without one,
 * a day its month has in some year (02-29, which falls on the 28th in a common year). Null for
 * anything else (lint names it), so it is no occasion either.
 */
export function birthdayOf(cal: Calendar, v: JsonValue | undefined): { month: number; day: number; year: number | null } | null {
  const m = typeof v === "string" ? /^\s*(?:(-?\d{1,6})-)?(\d{1,2})-(\d{1,2})\s*$/.exec(v) : null;
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const year = m[1] === undefined ? null : Number(m[1]);
  if (month < 1 || month > cal.system.months || day < 1) return null;
  // The longest the month runs: in the year given, else in any year of a four-year leap cycle.
  const longest = year !== null ? cal.system.monthLength(year, month) : Math.max(...[0, 1, 2, 3].map((y) => cal.system.monthLength(y, month)));
  return day <= longest ? { month, day, year } : null;
}

/**
 * Whether a birthday falls on a date: its month and day, or, past that month's end in this year (the
 * 29th of February in a common year), its last day.
 */
export function birthdayOn(cal: Calendar, v: JsonValue | undefined, date: CalDate): boolean {
  const b = birthdayOf(cal, v);
  if (!b || b.month !== date.month) return false;
  const last = cal.system.monthLength(date.year, date.month);
  return b.day === date.day || (b.day > last && date.day === last);
}

/** The occasion of `who`'s day (`day` a day index), from the state as it stands, with the holidays as Calendar 4 shows them. */
export function occasionOf(ctx: ReadContext, who: EntityId, day: number): Occasion {
  const cal = calendarOf(ctx.world);
  const date = dateAt(cal, clockAt(cal, day, 0));
  const weekend = date.weekday === 0 || date.weekday === 6;
  const holidays = ctx.levelOf(ctx.world.pov, "calendar") >= 4 ? holidaysOn(cal, day).map((h) => ({ id: h.id, label: h.label, dayOff: h.dayOff })) : [];
  const regard = optionalQuery(ctx, "regard");
  const friends = regard
    ? Object.keys(ctx.state.entities)
        .sort()
        .filter((other) => {
          const e = own(ctx.state.entities, other);
          return other !== who && !!e && kindIs(ctx.registry, ctx.world, e.kind, "person") && !isGone(ctx.state, other) && lifeActs(ctx.world, ctx.state, other) && birthdayOn(cal, e.fields.birthday, date) && regard(ctx, who, other) >= FOND;
        })
    : [];
  const home = own(ctx.state.entities, who)?.fields.home;
  const place: PlaceId | null = typeof home === "string" && own(ctx.world.places, home) ? home : null;
  return {
    weekend,
    dayOff: weekend || holidays.some((h) => h.dayOff),
    holidays,
    birthday: birthdayOn(cal, own(ctx.state.entities, who)?.fields.birthday, date),
    friends,
    season: optionalQuery(ctx, "weather.season")?.(ctx, clockAt(cal, day, 12 * 60)) ?? null,
    foul: place ? (optionalQuery(ctx, "weather.foul")?.(ctx, place) ?? null) : null,
  };
}
