// Calendar arithmetic over game minutes (DESIGN §9.1 Calendar & time, §9.2 Time).
//
// The clock counts minutes since the world epoch, a local date-time in the calendar's home time
// zone. Local wall time is uniform: a DST change shifts other places' offsets from home, never the
// home clock itself, so the clock never skips or repeats an hour. Gregorian and custom calendars
// share one interface. Everything is integer arithmetic: no Date, no Intl.

import type { CalendarDef, DateRule, DayPart, HolidayDef, Recurrence, WorldDoc } from "../shared/world";
import { own } from "./pack-kit";

export const MINUTES_PER_DAY = 1440;

export interface CalDate {
  year: number;
  /** 1-based. */
  month: number;
  day: number;
  /** 0 = the first weekday name (Sunday on the gregorian calendar). */
  weekday: number;
  /** Days since the epoch's date (negative before it). */
  dayIndex: number;
  minuteOfDay: number;
}

const DEFAULT_DAY_PARTS: readonly DayPart[] = [
  { id: "night", label: "Night", start: "00:00" },
  { id: "morning", label: "Morning", start: "06:00" },
  { id: "afternoon", label: "Afternoon", start: "12:00" },
  { id: "evening", label: "Evening", start: "18:00" },
];

const GREGORIAN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GREGORIAN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HHMM = /^(\d{1,2}):(\d{2})$/;
const ISO_DATE = /^(-?\d{1,6})-(\d{2})-(\d{2})/;
const ISO_LOCAL = /^(-?\d{1,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** `HH:MM` → minutes after midnight. Throws on bad text. */
export function parseHHMM(text: string): number {
  const m = HHMM.exec(text.trim());
  if (!m) throw new RangeError(`expected HH:MM, got ${text}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new RangeError(`bad time ${text}`);
  return h * 60 + min;
}

export function formatHHMM(minuteOfDay: number): string {
  const m = mod(minuteOfDay, MINUTES_PER_DAY);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- gregorian day numbers

/** Days since 1970-01-01 (proleptic gregorian). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = floorDiv(yy, 400);
  const yoe = yy - era * 400;
  const doy = floorDiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z0: number): { year: number; month: number; day: number } {
  const z = z0 + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const d = doy - floorDiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { year: m <= 2 ? y + 1 : y, month: m, day: d };
}

function gregorianMonthLength(year: number, month: number): number {
  return daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - daysFromCivil(year, month, 1);
}

// ---------------------------------------------------------------- calendar systems

/** Absolute day numbers and their dates for one calendar system. */
interface System {
  abs(year: number, month: number, day: number): number;
  date(abs: number): { year: number; month: number; day: number };
  weekday(abs: number): number;
  monthLength(year: number, month: number): number;
  months: number;
  monthNames: readonly string[];
  weekdayNames: readonly string[];
}

const GREGORIAN: System = {
  abs: daysFromCivil,
  date: civilFromDays,
  weekday: (abs) => mod(abs + 4, 7),
  monthLength: gregorianMonthLength,
  months: 12,
  monthNames: GREGORIAN_MONTHS,
  weekdayNames: GREGORIAN_WEEKDAYS,
};

function customSystem(def: NonNullable<CalendarDef["custom"]>): System {
  const lengths = def.monthLengths.length > 0 ? def.monthLengths.map((n) => Math.max(1, Math.floor(n))) : [30];
  const yearLength = lengths.reduce((a, b) => a + b, 0);
  const weekdays = def.weekdayNames.length > 0 ? def.weekdayNames : ["Day"];
  return {
    abs(year, month, day) {
      let doy = day - 1;
      for (let i = 0; i < month - 1 && i < lengths.length; i++) doy += lengths[i] ?? 0;
      return year * yearLength + doy;
    },
    date(abs) {
      const year = floorDiv(abs, yearLength);
      let doy = abs - year * yearLength;
      let month = 1;
      for (const len of lengths) {
        if (doy < len) break;
        doy -= len;
        month++;
      }
      return { year, month, day: doy + 1 };
    },
    weekday: (abs) => mod(abs, weekdays.length),
    monthLength: (_year, month) => lengths[month - 1] ?? 0,
    months: lengths.length,
    monthNames: def.monthNames.length >= lengths.length ? def.monthNames : lengths.map((_, i) => `M${i + 1}`),
    weekdayNames: weekdays,
  };
}

/** A calendar bound to a world: everything else in this module goes through it. */
export interface Calendar {
  readonly def: CalendarDef;
  readonly system: System;
  /** Absolute day number of the epoch's date. */
  readonly epochAbs: number;
  /** Minutes after midnight of the epoch. */
  readonly epochMinute: number;
  readonly dayParts: readonly DayPart[];
  /** Day-part starts in minutes after midnight, ascending. */
  readonly partStarts: readonly number[];
}

const cache = new WeakMap<CalendarDef, Calendar>();

export function calendarOf(world: Pick<WorldDoc, "calendar">): Calendar {
  const def = world.calendar;
  const hit = cache.get(def);
  if (hit) return hit;
  const system = def.system === "custom" && def.custom ? customSystem(def.custom) : GREGORIAN;
  const m = ISO_LOCAL.exec(def.epoch);
  if (!m) throw new RangeError(`calendar epoch must be YYYY-MM-DDTHH:MM, got ${def.epoch}`);
  const parts = [...(def.dayParts.length > 0 ? def.dayParts : DEFAULT_DAY_PARTS)].sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  const cal: Calendar = {
    def,
    system,
    epochAbs: system.abs(Number(m[1]), Number(m[2]), Number(m[3])),
    epochMinute: Number(m[4]) * 60 + Number(m[5]),
    dayParts: parts,
    partStarts: parts.map((p) => parseHHMM(p.start)),
  };
  cache.set(def, cal);
  return cal;
}

/** The local date of a clock reading in the home time zone. */
export function dateAt(cal: Calendar, clock: number): CalDate {
  const local = cal.epochMinute + Math.floor(clock);
  const dayIndex = floorDiv(local, MINUTES_PER_DAY);
  const abs = cal.epochAbs + dayIndex;
  const d = cal.system.date(abs);
  return { ...d, weekday: cal.system.weekday(abs), dayIndex, minuteOfDay: local - dayIndex * MINUTES_PER_DAY };
}

/** Clock reading of a local time on a day (day index relative to the epoch's date). */
export function clockAt(cal: Calendar, dayIndex: number, minuteOfDay: number): number {
  return dayIndex * MINUTES_PER_DAY + minuteOfDay - cal.epochMinute;
}

/** Day index of a calendar date. */
export function dayIndexOf(cal: Calendar, year: number, month: number, day: number): number {
  return cal.system.abs(year, month, day) - cal.epochAbs;
}

/** Clock of a local `YYYY-MM-DDTHH:MM` (or `YYYY-MM-DD`, midnight). */
export function clockOfLocal(cal: Calendar, text: string): number {
  const full = ISO_LOCAL.exec(text);
  const date = full ?? ISO_DATE.exec(text);
  if (!date) throw new RangeError(`expected YYYY-MM-DD[THH:MM], got ${text}`);
  const minute = full ? Number(full[4]) * 60 + Number(full[5]) : 0;
  return clockAt(cal, dayIndexOf(cal, Number(date[1]), Number(date[2]), Number(date[3])), minute);
}

export function dayIndexOfText(cal: Calendar, text: string): number {
  const m = ISO_DATE.exec(text);
  if (!m) throw new RangeError(`expected YYYY-MM-DD, got ${text}`);
  return dayIndexOf(cal, Number(m[1]), Number(m[2]), Number(m[3]));
}

/** The next clock reading after `clock` (strictly) at local time `minuteOfDay`. */
export function nextTimeOfDay(cal: Calendar, clock: number, minuteOfDay: number): number {
  const d = dateAt(cal, clock);
  const today = clockAt(cal, d.dayIndex, minuteOfDay);
  return today > clock ? today : clockAt(cal, d.dayIndex + 1, minuteOfDay);
}

const NUMBER_WORDS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const SPAN_MINUTES: Readonly<Record<string, number>> = { minute: 1, min: 1, hour: 60, hr: 60, day: MINUTES_PER_DAY, week: 7 * MINUTES_PER_DAY };
const SPAN = new RegExp(`\\s(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(minute|min|hour|hr|day|week)s?(?=\\s)`);
const CLOCK_TIME = /\s(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'?clock)?(?=\s)/;

/**
 * The clock a short spoken time names, after `clock` (a loan "until 7 tonight"). It reads:
 * - a span: "for 3 hours", "two days", "half an hour"
 * - a time of day: "19:00", "7pm", "7:30 p.m.", "noon", "midnight", or a day part's name ("this evening", "tonight", "morning")
 * - another day: "tomorrow", "the day after tomorrow", or a weekday's full name
 * An hour without am or pm is the first one after `clock`, unless the phrase says tonight,
 * evening, afternoon or night (pm) or morning (am). A day without a time keeps the time of day
 * now. Null when nothing in the phrase reads as a time, a span or a day.
 */
export function clockOfPhrase(cal: Calendar, clock: number, text: string): number | null {
  const t = ` ${text.toLowerCase().replace(/([ap])\.\s?m\.?/g, "$1m").replace(/[^a-z0-9:']+/g, " ")} `;
  if (/\shalf an hour\s/.test(t)) return clock + 30;
  const span = SPAN.exec(t);
  if (span?.[1] && span[2]) {
    const n = NUMBER_WORDS[span[1]] ?? Number(span[1]);
    const unit = SPAN_MINUTES[span[2]] ?? 0;
    return n > 0 && unit > 0 ? clock + n * unit : null;
  }
  const now = dateAt(cal, clock);
  let offset: number | null = /\sday after tomorrow\s/.test(t) ? 2 : /\stomorrow\s/.test(t) ? 1 : null;
  if (offset === null) {
    const names = cal.system.weekdayNames.map((n) => n.toLowerCase());
    for (const w of t.trim().split(" ")) {
      // Full names only ("friday", or a calendar's own long names): "sun" or "sat" alone is a word.
      const wd = names.findIndex((n) => (n.length > 3 && w === n) || (w.length > n.length && w.startsWith(n) && w.endsWith("day")));
      if (wd < 0) continue;
      const ahead = (((wd - now.weekday) % names.length) + names.length) % names.length;
      offset = ahead === 0 ? names.length : ahead;
      break;
    }
  }
  const pmHint = /\s(tonight|evening|afternoon|night)\s/.test(t);
  const amHint = /\smorning\s/.test(t);
  let minutes: number[] = [];
  if (/\s(noon|midday)\s/.test(t)) minutes = [720];
  else if (/\smidnight\s/.test(t)) minutes = [MINUTES_PER_DAY];
  else {
    const m = CLOCK_TIME.exec(t);
    const hour = m?.[1] !== undefined ? Number(m[1]) : NaN;
    const minute = m?.[2] !== undefined ? Number(m[2]) : 0;
    if (Number.isInteger(hour) && hour <= 23 && minute <= 59) {
      const suffix = m?.[3];
      const pm = suffix === "pm" || (suffix !== "am" && pmHint && !amHint);
      const am = suffix === "am" || (suffix !== "pm" && amHint && !pmHint);
      const half = hour % 12;
      if (hour === 0 || hour > 12) minutes = [hour * 60 + minute];
      else if (pm) minutes = [(half + 12) * 60 + minute];
      else if (am) minutes = [half * 60 + minute];
      else minutes = [half * 60 + minute, (half + 12) * 60 + minute];
    } else {
      const named = cal.dayParts.find((p) => t.includes(` ${p.id.toLowerCase()} `) || t.includes(` ${p.label.toLowerCase()} `));
      const part = named ?? (/\stonight\s/.test(t) ? (cal.dayParts.find((p) => p.id === "evening") ?? cal.dayParts.find((p) => p.id === "night")) : undefined);
      if (part) minutes = [parseHHMM(part.start)];
    }
  }
  if (minutes.length === 0) return offset === null ? null : clockAt(cal, now.dayIndex + offset, now.minuteOfDay);
  if (offset !== null) {
    const day = now.dayIndex + offset;
    return Math.min(...minutes.map((m) => clockAt(cal, day, m)));
  }
  for (const day of [now.dayIndex, now.dayIndex + 1]) {
    const next = minutes.map((m) => clockAt(cal, day, m)).filter((c) => c > clock);
    if (next.length > 0) return Math.min(...next);
  }
  return null;
}

export function monthName(cal: Calendar, month: number): string {
  return cal.system.monthNames[month - 1] ?? `M${month}`;
}

export function weekdayName(cal: Calendar, weekday: number): string {
  return cal.system.weekdayNames[weekday] ?? `D${weekday}`;
}

/** `Fri 16 Oct 2026, 07:00`. */
export function formatClock(cal: Calendar, clock: number, offsetMinutes = 0): string {
  const d = dateAt(cal, clock + offsetMinutes);
  return `${weekdayName(cal, d.weekday)} ${d.day} ${monthName(cal, d.month)} ${d.year}, ${formatHHMM(d.minuteOfDay)}`;
}

// ---------------------------------------------------------------- day parts and the slot grid

export function dayPartAt(cal: Calendar, clock: number): DayPart {
  const m = dateAt(cal, clock).minuteOfDay;
  let idx = cal.partStarts.length - 1;
  for (let i = 0; i < cal.partStarts.length; i++) if ((cal.partStarts[i] ?? 0) <= m) idx = i;
  return cal.dayParts[idx] ?? DEFAULT_DAY_PARTS[0]!;
}

/** Start of global slot `index` (one slot per day part per day). */
export function slotStart(cal: Calendar, index: number): number {
  const p = cal.partStarts.length;
  const day = floorDiv(index, p);
  return clockAt(cal, day, cal.partStarts[index - day * p] ?? 0);
}

/** The slot containing `clock`: the latest slot that starts at or before it. */
export function slotIndexAt(cal: Calendar, clock: number): number {
  const d = dateAt(cal, clock);
  const p = cal.partStarts.length;
  let part = -1;
  for (let i = 0; i < p; i++) if ((cal.partStarts[i] ?? 0) <= d.minuteOfDay) part = i;
  return part < 0 ? d.dayIndex * p - 1 : d.dayIndex * p + part;
}

export interface Slot {
  index: number;
  start: number;
  end: number;
}

export function slotOf(cal: Calendar, index: number): Slot {
  return { index, start: slotStart(cal, index), end: slotStart(cal, index + 1) };
}

/** Every slot that ends inside `(from, to]`, in order: the slots a clock move from `from` to `to` completes. */
export function slotsEnding(cal: Calendar, from: number, to: number): Slot[] {
  const out: Slot[] = [];
  if (to <= from) return out;
  for (let k = slotIndexAt(cal, from); ; k++) {
    const s = slotOf(cal, k);
    if (s.end > to) break;
    if (s.end > from) out.push(s);
  }
  return out;
}

/** Length of the shortest slot in a day: the smallest unit a segment can advance. */
export function shortestSlot(cal: Calendar): number {
  const starts = cal.partStarts;
  let best = MINUTES_PER_DAY;
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? (starts[i + 1] ?? 0) : (starts[0] ?? 0) + MINUTES_PER_DAY;
    best = Math.min(best, next - (starts[i] ?? 0));
  }
  return best;
}

// ---------------------------------------------------------------- holidays and recurrence

function easterSunday(cal: Calendar, year: number): number {
  // Anonymous gregorian algorithm (Meeus/Jones/Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return cal.system.abs(year, month, day);
}

/** Absolute day of a holiday rule in a year, or null when the rule doesn't resolve. */
function ruleDay(cal: Calendar, holidays: readonly HolidayDef[], rule: DateRule, year: number, depth: number): number | null {
  switch (rule.type) {
    case "fixed":
      return rule.day <= cal.system.monthLength(year, rule.month) ? cal.system.abs(year, rule.month, rule.day) : null;
    case "nth_weekday": {
      const len = cal.system.monthLength(year, rule.month);
      if (len <= 0) return null;
      const wdCount = cal.system.weekdayNames.length;
      if (rule.n >= 0) {
        const first = cal.system.abs(year, rule.month, 1);
        const offset = mod(rule.weekday - cal.system.weekday(first), wdCount);
        const day = 1 + offset + (Math.max(1, rule.n) - 1) * wdCount;
        return day <= len ? first + day - 1 : null;
      }
      const last = cal.system.abs(year, rule.month, len);
      const back = mod(cal.system.weekday(last) - rule.weekday, wdCount);
      const day = len - back - (Math.abs(rule.n) - 1) * wdCount;
      return day >= 1 ? cal.system.abs(year, rule.month, day) : null;
    }
    case "relative": {
      if (depth > 8) return null;
      const base = holidays.find((h) => h.id === rule.to);
      const at = base ? ruleDay(cal, holidays, base.rule, year, depth + 1) : null;
      return at === null ? null : at + rule.days;
    }
    case "easter":
      return cal.def.system === "gregorian" ? easterSunday(cal, year) + rule.days : null;
  }
}

/** Holidays that fall on a day. */
export function holidaysOn(cal: Calendar, dayIndex: number, holidays: readonly HolidayDef[] = cal.def.holidays): HolidayDef[] {
  const abs = cal.epochAbs + dayIndex;
  const { year } = cal.system.date(abs);
  return holidays.filter((h) => ruleDay(cal, holidays, h.rule, year, 0) === abs);
}

/** The holiday's day index in the year containing `dayIndex`, or null. */
export function holidayDay(cal: Calendar, holiday: HolidayDef, dayIndex: number): number | null {
  const { year } = cal.system.date(cal.epochAbs + dayIndex);
  const abs = ruleDay(cal, cal.def.holidays, holiday.rule, year, 0);
  return abs === null ? null : abs - cal.epochAbs;
}

/** Does a recurrence run on this day? */
export function recursOn(cal: Calendar, rec: Recurrence, dayIndex: number): boolean {
  if (rec.from && dayIndex < dayIndexOfText(cal, rec.from)) return false;
  if (rec.until && dayIndex > dayIndexOfText(cal, rec.until)) return false;
  const abs = cal.epochAbs + dayIndex;
  const date = cal.system.date(abs);
  switch (rec.every) {
    case "day":
      break;
    case "week":
      if (rec.weekdays && rec.weekdays.length > 0 && !rec.weekdays.includes(cal.system.weekday(abs))) return false;
      break;
    case "month":
      if (rec.days && rec.days.length > 0) {
        const len = cal.system.monthLength(date.year, date.month);
        // Day 31 in a 30-day month falls on the month's last day; negative days count from the end.
        const hit = rec.days.some((d) => (d > 0 ? Math.min(d, len) === date.day : len + d + 1 === date.day));
        if (!hit) return false;
      }
      break;
    case "year": {
      const anchor = rec.from ? cal.system.date(cal.epochAbs + dayIndexOfText(cal, rec.from)) : cal.system.date(cal.epochAbs);
      if (anchor.month !== date.month || anchor.day !== date.day) return false;
      break;
    }
  }
  if (rec.except && rec.except.length > 0) {
    const today = holidaysOn(cal, dayIndex);
    if (today.some((h) => rec.except?.includes(h.id))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- time zones

interface ZoneRule {
  standard: number;
  dst: "us" | "eu" | "south" | null;
}

/** Standard UTC offsets (minutes) and DST rules for the zones the Modern US data uses, plus a few others. */
const ZONES: Record<string, ZoneRule> = {
  UTC: { standard: 0, dst: null },
  "Etc/UTC": { standard: 0, dst: null },
  "America/New_York": { standard: -300, dst: "us" },
  "America/Detroit": { standard: -300, dst: "us" },
  "America/Indiana/Indianapolis": { standard: -300, dst: "us" },
  "America/Kentucky/Louisville": { standard: -300, dst: "us" },
  "America/Chicago": { standard: -360, dst: "us" },
  "America/Menominee": { standard: -360, dst: "us" },
  "America/Denver": { standard: -420, dst: "us" },
  "America/Boise": { standard: -420, dst: "us" },
  "America/Phoenix": { standard: -420, dst: null },
  "America/Los_Angeles": { standard: -480, dst: "us" },
  "America/Anchorage": { standard: -540, dst: "us" },
  "America/Juneau": { standard: -540, dst: "us" },
  "America/Adak": { standard: -600, dst: "us" },
  "Pacific/Honolulu": { standard: -600, dst: null },
  "America/Puerto_Rico": { standard: -240, dst: null },
  "Europe/London": { standard: 0, dst: "eu" },
  "Europe/Dublin": { standard: 0, dst: "eu" },
  "Europe/Paris": { standard: 60, dst: "eu" },
  "Europe/Berlin": { standard: 60, dst: "eu" },
  "Europe/Madrid": { standard: 60, dst: "eu" },
  "Europe/Rome": { standard: 60, dst: "eu" },
  "Europe/Athens": { standard: 120, dst: "eu" },
  "Asia/Tokyo": { standard: 540, dst: null },
  "Asia/Shanghai": { standard: 480, dst: null },
  "Asia/Kolkata": { standard: 330, dst: null },
  "Australia/Sydney": { standard: 600, dst: "south" },
};

export function knownZone(zone: string): boolean {
  return Object.prototype.hasOwnProperty.call(ZONES, zone);
}

/** UTC offset of a zone on a gregorian date at a local minute (unknown zones: 0). */
export function zoneOffset(zone: string, year: number, month: number, day: number, minuteOfDay: number): number {
  const rule = own(ZONES, zone);
  if (!rule) return 0;
  if (!rule.dst) return rule.standard;
  const abs = daysFromCivil(year, month, day);
  const nthSunday = (m: number, n: number): number => {
    const first = daysFromCivil(year, m, 1);
    return first + mod(-mod(first + 4, 7), 7) + (n - 1) * 7;
  };
  const lastSunday = (m: number): number => {
    const last = daysFromCivil(year, m, gregorianMonthLength(year, m));
    return last - mod(last + 4, 7);
  };
  const at = (d: number, minute: number): boolean => abs > d || (abs === d && minuteOfDay >= minute);
  let summer: boolean;
  if (rule.dst === "us") summer = at(nthSunday(3, 2), 120) && !at(nthSunday(11, 1), 120);
  else if (rule.dst === "eu") summer = at(lastSunday(3), 60 + rule.standard) && !at(lastSunday(10), 60 + rule.standard);
  else summer = !(at(nthSunday(4, 1), 180) && !at(nthSunday(10, 1), 120));
  return rule.standard + (summer ? 60 : 0);
}

/** A place's time zone: its own, else its parent's, else the calendar's. */
export function placeZone(world: Pick<WorldDoc, "places" | "calendar">, placeId: string | null | undefined): string {
  let id = placeId ?? undefined;
  for (let guard = 0; id && guard < 32; guard++) {
    const place = own(world.places, id);
    if (!place) break;
    if (place.timeZone) return place.timeZone;
    id = place.parent;
  }
  return world.calendar.timeZone;
}

/** Minutes to add to the home clock to get a place's local time (0 on custom calendars). */
export function placeOffset(world: Pick<WorldDoc, "places" | "calendar">, clock: number, placeId: string | null | undefined): number {
  const cal = calendarOf(world);
  if (world.calendar.system !== "gregorian") return 0;
  const zone = placeZone(world, placeId);
  if (zone === world.calendar.timeZone) return 0;
  const d = dateAt(cal, clock);
  const home = zoneOffset(world.calendar.timeZone, d.year, d.month, d.day, d.minuteOfDay);
  if (!knownZone(zone) || !knownZone(world.calendar.timeZone)) return 0;
  return zoneOffset(zone, d.year, d.month, d.day, d.minuteOfDay) - home;
}
