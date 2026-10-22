import { describe, expect, test } from "bun:test";
import {
  calendarOf,
  civilFromDays,
  clockOfLocal,
  clockOfPhrase,
  clockOfStamp,
  dateAt,
  daysFromCivil,
  formatClock,
  formatStamp,
  holidaysOn,
  nextTimeOfDay,
  placeOffset,
  recursOn,
  slotIndexAt,
  slotOf,
  slotsEnding,
  zoneOffset,
} from "../../src/engine/calendar";
import type { HolidayDef } from "../../src/shared/world";
import { baseWorld } from "../packs/support";

describe("calendar arithmetic", () => {
  test("civil day numbers round-trip across eras", () => {
    for (const z of [-800000, -1, 0, 1, 20000, 20742, 100000, 2932896]) {
      const d = civilFromDays(z);
      expect(daysFromCivil(d.year, d.month, d.day)).toBe(z);
    }
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2000, 3, 1)).toBe(11017);
  });

  test("the epoch's date, weekday and clock labels", () => {
    const world = baseWorld();
    const cal = calendarOf(world);
    const d = dateAt(cal, 0);
    expect([d.year, d.month, d.day, d.weekday]).toEqual([2026, 10, 16, 5]); // a Friday
    expect(formatClock(cal, 8 * 60 + 5)).toBe("Fri 16 Oct 2026, 8:05 AM");
    expect(dateAt(cal, 16 * 1440 - 1).day).toBe(31);
    expect(dateAt(cal, 16 * 1440).month).toBe(11);
    expect(clockOfLocal(cal, "2026-10-17T07:00")).toBe(1440 + 420);
    expect(nextTimeOfDay(cal, 420, 420)).toBe(1440 + 420);
    expect(nextTimeOfDay(cal, 419, 420)).toBe(420);
  });

  test("the clock the player reads is on a 12-hour clock: midnight is 12 AM, noon 12 PM", () => {
    const cal = calendarOf(baseWorld());
    expect([formatClock(cal, 5), formatClock(cal, 12 * 60), formatClock(cal, 13 * 60 + 30)]).toEqual(["Fri 16 Oct 2026, 12:05 AM", "Fri 16 Oct 2026, 12:00 PM", "Fri 16 Oct 2026, 1:30 PM"]);
    // A helper reads and writes 24-hour stamps still.
    expect(formatStamp(cal, 13 * 60 + 30)).toBe("2026-10-16 13:30");
  });

  test("spoken times: a time of day, a span or another day, after now", () => {
    const cal = calendarOf(baseWorld());
    const now = 17 * 60 + 37; // Fri 16 Oct 2026, 17:37
    const at = (text: string): string | null => {
      const c = clockOfPhrase(cal, now, text);
      return c === null ? null : formatClock(cal, c);
    };
    expect([at("7 tonight"), at("7"), at("7pm"), at("7:30 p.m."), at("19:00")]).toEqual(["Fri 16 Oct 2026, 7:00 PM", "Fri 16 Oct 2026, 7:00 PM", "Fri 16 Oct 2026, 7:00 PM", "Fri 16 Oct 2026, 7:30 PM", "Fri 16 Oct 2026, 7:00 PM"]);
    expect([at("9 in the morning"), at("noon"), at("midnight"), at("tonight")]).toEqual(["Sat 17 Oct 2026, 9:00 AM", "Sat 17 Oct 2026, 12:00 PM", "Sat 17 Oct 2026, 12:00 AM", "Fri 16 Oct 2026, 6:00 PM"]);
    expect([at("tomorrow"), at("tomorrow morning"), at("tomorrow at 7"), at("Monday"), at("Friday")]).toEqual(["Sat 17 Oct 2026, 5:37 PM", "Sat 17 Oct 2026, 6:00 AM", "Sat 17 Oct 2026, 7:00 AM", "Mon 19 Oct 2026, 5:37 PM", "Fri 23 Oct 2026, 5:37 PM"]);
    expect([at("for 3 hours"), at("two days"), at("half an hour")]).toEqual(["Fri 16 Oct 2026, 8:37 PM", "Sun 18 Oct 2026, 5:37 PM", "Fri 16 Oct 2026, 6:07 PM"]);
    expect([at("until the sun goes down"), at("a while")]).toEqual([null, null]);
  });

  test("holiday rules: nth weekday, last weekday, fixed, relative and easter", () => {
    const holidays: HolidayDef[] = [
      { id: "thanks", label: "Thanksgiving", rule: { type: "nth_weekday", month: 11, weekday: 4, n: 4 }, dayOff: true },
      { id: "memorial", label: "Memorial Day", rule: { type: "nth_weekday", month: 5, weekday: 1, n: -1 }, dayOff: true },
      { id: "xmas", label: "Christmas", rule: { type: "fixed", month: 12, day: 25 }, dayOff: true },
      { id: "black_friday", label: "Black Friday", rule: { type: "relative", to: "thanks", days: 1 }, dayOff: false },
      { id: "easter", label: "Easter", rule: { type: "easter", days: 0 }, dayOff: false },
    ];
    const world = baseWorld();
    world.calendar = { ...world.calendar, holidays };
    const cal = calendarOf(world);
    const on = (y: number, m: number, d: number): string[] => holidaysOn(cal, daysFromCivil(y, m, d) - cal.epochAbs).map((h) => h.id);
    expect(on(2026, 11, 26)).toEqual(["thanks"]);
    expect(on(2026, 11, 27)).toEqual(["black_friday"]);
    expect(on(2027, 5, 31)).toEqual(["memorial"]);
    expect(on(2026, 12, 25)).toEqual(["xmas"]);
    expect(on(2027, 3, 28)).toEqual(["easter"]);
    expect(on(2026, 11, 25)).toEqual([]);
  });

  test("recurrence: weekdays, month days (clamped to the month), year anniversaries and holiday exceptions", () => {
    const world = baseWorld();
    const cal = calendarOf(world);
    const idx = (y: number, m: number, d: number): number => daysFromCivil(y, m, d) - cal.epochAbs;
    expect(recursOn(cal, { every: "week", weekdays: [1, 3, 5] }, idx(2026, 10, 16))).toBe(true);
    expect(recursOn(cal, { every: "week", weekdays: [1, 3, 5] }, idx(2026, 10, 17))).toBe(false);
    expect(recursOn(cal, { every: "month", days: [31] }, idx(2026, 11, 30))).toBe(true);
    expect(recursOn(cal, { every: "month", days: [-1] }, idx(2027, 2, 28))).toBe(true);
    expect(recursOn(cal, { every: "year", from: "2020-02-29" }, idx(2028, 2, 29))).toBe(true);
    expect(recursOn(cal, { every: "day", except: ["thanksgiving"] }, idx(2026, 11, 26))).toBe(false);
    expect(recursOn(cal, { every: "day", from: "2026-10-20", until: "2026-10-22" }, idx(2026, 10, 19))).toBe(false);
  });

  test("the slot grid: every slot that ends inside an interval, exactly once", () => {
    const cal = calendarOf(baseWorld());
    expect(slotIndexAt(cal, 0)).toBe(0);
    expect(slotIndexAt(cal, 6 * 60)).toBe(1);
    expect(slotIndexAt(cal, 5 * 60 + 59)).toBe(0);
    expect(slotOf(cal, 3)).toEqual({ index: 3, start: 18 * 60, end: 24 * 60 });
    const whole = slotsEnding(cal, 100, 100 + 3 * 1440).map((s) => s.index);
    const split = [...slotsEnding(cal, 100, 1000), ...slotsEnding(cal, 1000, 2000), ...slotsEnding(cal, 2000, 100 + 3 * 1440)].map((s) => s.index);
    expect(split).toEqual(whole);
    expect(whole).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(slotsEnding(cal, 10, 20)).toEqual([]);
  });

  test("zone offsets follow DST; places inherit zones from parents", () => {
    expect(zoneOffset("America/New_York", 2026, 7, 1, 600)).toBe(-240);
    expect(zoneOffset("America/New_York", 2026, 12, 1, 600)).toBe(-300);
    expect(zoneOffset("America/Phoenix", 2026, 7, 1, 600)).toBe(-420);
    expect(zoneOffset("America/New_York", 2026, 3, 8, 119)).toBe(-300);
    expect(zoneOffset("America/New_York", 2026, 3, 8, 120)).toBe(-240);
    expect(zoneOffset("Europe/London", 2026, 7, 1, 600)).toBe(60);
    const world = baseWorld();
    world.places.west = { id: "west", name: "West", timeZone: "America/Los_Angeles", fields: {} };
    world.places.westcafe = { id: "westcafe", name: "West Cafe", parent: "west", fields: {} };
    expect(placeOffset(world, 600, "westcafe")).toBe(-180);
    expect(placeOffset(world, 600, "cafe")).toBe(0);
  });

  test("custom calendars: month lengths, names and weekdays", () => {
    const world = baseWorld();
    world.calendar = { ...world.calendar, system: "custom", epoch: "0100-02-01T06:00", custom: { monthLengths: [10, 20], monthNames: ["Frost", "Thaw"], weekdayNames: ["A", "B", "C"] }, holidays: [{ id: "f", label: "Feast", rule: { type: "fixed", month: 1, day: 5 }, dayOff: true }] };
    const cal = calendarOf(world);
    const d = dateAt(cal, 0);
    expect([d.year, d.month, d.day]).toEqual([100, 2, 1]);
    const later = dateAt(cal, 20 * 1440);
    expect([later.year, later.month, later.day]).toEqual([101, 1, 1]);
    expect(formatClock(cal, 0)).toContain("Thaw");
    expect(holidaysOn(cal, 24).map((h) => h.id)).toEqual(["f"]);
  });

  test("a stamp reads back to its clock, and only a day the calendar has at a time of day reads", () => {
    const world = baseWorld();
    const greg = calendarOf(world);
    const at = clockOfLocal(greg, "2024-02-29T18:05");
    expect(formatStamp(greg, at)).toBe("2024-02-29 18:05");
    expect(clockOfStamp(greg, "2024-02-29 18:05")).toBe(at);
    expect(clockOfStamp(greg, " 2024-02-29T18:05 ")).toBe(at);
    expect(formatStamp(greg, at, -180)).toBe("2024-02-29 15:05");
    for (const text of ["2023-02-29 18:05", "2024-13-01 10:00", "2024-00-10 10:00", "2024-04-31 10:00", "2024-02-29 24:00", "2024-02-29 18:60", "2024-02-29", "18:05", "Friday 18:05"]) expect(clockOfStamp(greg, text)).toBeNull();
    world.calendar = { ...world.calendar, system: "custom", epoch: "0100-02-01T06:00", custom: { monthLengths: [10, 20], monthNames: ["Frost", "Thaw"], weekdayNames: ["A", "B", "C"] } };
    const custom = calendarOf(world);
    expect(formatStamp(custom, 20 * 1440)).toBe("0101-01-01 06:00");
    expect(clockOfStamp(custom, "0101-01-01 06:00")).toBe(20 * 1440);
    expect(clockOfStamp(custom, "0100-02-20 06:00")).not.toBeNull();
    expect(clockOfStamp(custom, "0100-01-11 06:00")).toBeNull();
    expect(clockOfStamp(custom, "0100-03-01 06:00")).toBeNull();
    const before = clockOfStamp(custom, "-0002-02-03 07:30");
    expect(before === null ? null : formatStamp(custom, before)).toBe("-0002-02-03 07:30");
  });
});
