// What time brings due (plan §6.4, §6.1): for a span and a part of the tree, the slots today's
// engine's schedules start in it, a person's routine and the world's own weather alike. A list only:
// listing it changes nothing, and a slot left to chance is named by its schedule, never drawn. The
// list stops at the bound asked for, soonest first, and the rest is counted from each schedule's
// recurrence, never made: a span of a thousand years costs what its first page does.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { JsonValue } from "../../src/shared/json";
import type { CalendarDef, HolidayDef, ScheduleDef, WorldDoc } from "../../src/shared/world";
import { chatSchedulesIn, scheduleInstants } from "../../src/engine/schedules";
import { timeDue } from "../../src/store/due";
import type { Store } from "../../src/store/store";
import { worldState } from "../../src/store/world-state";
import { inventedWorld, play, SHIPPED_LAYOUT, testStore } from "./fixtures";

const DAY = 24 * 60;
const ALL = Number.POSITIVE_INFINITY;

/** Tam keeps the market from nine to five and the common room after; the vale's weather turns at six and at noon. */
function scheduled() {
  const world = inventedWorld();
  world.schedules = {
    tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }, { start: "17:00", end: "22:00", value: "common_room" }] },
    vale_weather: {
      id: "vale_weather",
      target: "weather",
      recurrence: { every: "day" },
      slots: [
        { start: "06:00", end: "12:00", weighted: [{ value: "rain", weight: 1 }, { value: "sun", weight: 1 }] },
        { start: "12:00", end: "18:00", weighted: [{ value: "rain", weight: 1 }, { value: "sun", weight: 1 }] },
      ],
    },
  };
  return played(world);
}

function played(world: WorldDoc) {
  const ts = testStore({ world });
  ts.s.createChat({ id: "c", revision: ts.revision });
  play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
  return ts;
}

/** A slot of the world's own, at a fixed time, named by what it sets so each slot's starts can be told apart. */
function own(id: string, recurrence: ScheduleDef["recurrence"], ...slots: [start: string, end: string, value: string][]): ScheduleDef {
  return { id, target: "activity", recurrence, slots: slots.map(([start, end, value]) => ({ start, end, value })) };
}

const HOLIDAYS: HolidayDef[] = [
  { id: "midwinter", label: "Midwinter feast", rule: { type: "fixed", month: 12, day: 25 }, dayOff: true },
  { id: "new_year", label: "New year", rule: { type: "fixed", month: 1, day: 1 }, dayOff: true },
  { id: "harvest", label: "Harvest day", rule: { type: "nth_weekday", month: 11, weekday: 4, n: 4 }, dayOff: true },
  { id: "harvest_eve", label: "Harvest eve", rule: { type: "relative", to: "harvest", days: -1 }, dayOff: false },
  { id: "spring_feast", label: "Spring feast", rule: { type: "easter", days: 1 }, dayOff: true },
];

/** Schedules of every kind of recurrence today's engine keeps: daily, weekdays, days of the month (one past a short month's end, counted from the end), a date in the year (a leap day among them), with their dates and holidays. */
const SCHEDULES: ScheduleDef[] = [
  own("daily", { every: "day", except: ["midwinter"] }, ["09:00", "17:00", "d-work"], ["22:00", "06:00", "d-night"]),
  own("weekdays", { every: "week", weekdays: [1, 3, 5], except: ["harvest", "harvest_eve"] }, ["07:30", "08:00", "w-run"]),
  own("monthly", { every: "month", days: [1, 15, 31, -1], except: ["new_year"] }, ["12:00", "13:00", "m-pay"]),
  own("long_months", { every: "month", days: [-31] }, ["00:00", "01:00", "m-long"]),
  own("leap_day", { every: "year", from: "2032-02-29" }, ["10:00", "11:00", "y-leap"]),
  own("fair", { every: "year", from: "2031-06-15", until: "2290-06-15" }, ["24:00", "01:00", "y-fair"]),
  own("fortnight", { every: "week", from: "2031-03-03", until: "2031-03-20" }, ["08:00", "08:30", "w-all"]),
];

/** A world with `schedules` and its calendar's holidays. */
function worldOf(schedules: readonly ScheduleDef[], calendar: Partial<CalendarDef> = {}): WorldDoc {
  const world = inventedWorld();
  world.calendar = { ...world.calendar, holidays: HOLIDAYS, ...calendar };
  world.schedules = Object.fromEntries(schedules.map((s) => [s.id, s]));
  return world;
}

/** What the span brings due as today's engine walks it, day by day and every slot made: the starts of `scheduleInstants`, by what each slot sets. */
function walked(world: WorldDoc, store: Store, from: number, to: number): [number, JsonValue][] {
  const state = store.user("user-a").headState("c").state;
  const ctx = store.env.registry.context(world, state.world);
  return scheduleInstants(world, chatSchedulesIn(ctx), from, to)
    .filter((i) => i.edge === "start")
    .map((i): [number, JsonValue] => [i.at, i.schedule.slots[i.slot]?.value ?? null]);
}

describe("what time brings due", () => {
  test("passing six hours lists the slots that start in it, for the part of the tree asked about, and changes nothing", () => {
    const { s, store } = scheduled();
    const due = timeDue(store);
    const folded = s.headState("c");
    const before = hashJson(folded.state);
    const from = folded.state.world.clock;
    const span = { from, to: from + 360 };
    expect(due.due(folded.state, span, null, ALL)).toEqual({
      items: [
        { at: from + 60, kind: "place", where: "place:market_square", who: ["tam"], what: "tam_day" },
        { at: from + 240, kind: "weather", what: "vale_weather" },
      ],
      more: 0,
    });
    // In the common room, Tam's day at the market is no business of the scene's; the weather is everyone's.
    expect(due.due(folded.state, span, "common_room", ALL).items.map((d) => d.what)).toEqual(["vale_weather"]);
    expect(due.due(folded.state, span, "thornbury", ALL).items.map((d) => d.what)).toEqual(["tam_day", "vale_weather"]);
    // Nothing was applied: the state, the turn's changes and the head are as they were.
    expect(hashJson(s.headState("c").state)).toBe(before);
    expect(hashJson(folded.state)).toBe(before);
  });

  test("the world state's due section lists them, worded by the layout", () => {
    const { s, store } = scheduled();
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const lines = worldState(s, { chat: "c", turn: t.id, layout: SHIPPED_LAYOUT, due: timeDue(store) }).text.split("\n");
    expect(lines).toContain("Sat 1 Mar 2031, 9:00 AM: place at Market Square, Tam (tam_day)");
    expect(lines).toContain("Sat 1 Mar 2031, 12:00 PM: weather (vale_weather)");
  });
});

describe("what falls due, listed up to a bound and the rest counted", () => {
  test("over three years every kind of recurrence lists what today's engine walks, soonest first, and a page of it says how many more", () => {
    const world = worldOf(SCHEDULES);
    const { s, store } = played(world);
    const state = s.headState("c").state;
    const from = state.world.clock;
    const to = from + 3 * 366 * DAY;
    const whole = walked(world, store, from, to);
    expect(whole.length).toBeGreaterThan(2000);
    const due = timeDue(store);
    const all = due.due(state, { from, to }, null, ALL);
    expect(all.items.map((i) => [i.at, i.what])).toEqual(whole);
    expect(all.more).toBe(0);
    for (const most of [0, 1, 7, 100, whole.length - 1]) {
      const page = due.due(state, { from, to }, null, most);
      expect(page.items).toEqual(all.items.slice(0, most));
      expect(page.more).toBe(whole.length - most);
    }
  });

  test("over more years than the calendar's cycle the count of the rest is what walking every day gives", () => {
    // Every recurrence but the daily one, which walking four and a half centuries would take too long over.
    const world = worldOf(SCHEDULES.filter((s) => s.id !== "daily"));
    const { s, store } = played(world);
    const state = s.headState("c").state;
    const from = state.world.clock;
    const to = from + 450 * 365 * DAY + 17 * DAY + 333;
    const whole = walked(world, store, from, to);
    const page = timeDue(store).due(state, { from, to }, null, 10);
    expect(page.items.map((i) => [i.at, i.what])).toEqual(whole.slice(0, 10));
    expect(page.more).toBe(whole.length - 10);
  });

  test("a custom calendar's own cycle counts the same as walking every day", () => {
    const calendar: Partial<CalendarDef> = {
      system: "custom",
      epoch: "0100-01-01T00:00",
      custom: { monthLengths: [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 5], monthNames: [], weekdayNames: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"] },
      holidays: [
        { id: "lamp_night", label: "Lamp night", rule: { type: "nth_weekday", month: 4, weekday: 2, n: 3 }, dayOff: true },
        { id: "thaw", label: "Thaw", rule: { type: "fixed", month: 3, day: 1 }, dayOff: true },
      ],
    };
    const world = worldOf(
      [
        own("tens", { every: "week", weekdays: [2, 7], except: ["lamp_night"] }, ["06:00", "07:00", "c-week"]),
        own("month_ends", { every: "month", days: [-1, 30], except: ["thaw"] }, ["18:00", "19:00", "c-month"]),
        own("founding", { every: "year" }, ["12:00", "13:00", "c-year"]),
      ],
      calendar,
    );
    world.start = { ...world.start, at: "0100-02-10T08:00" };
    const { s, store } = played(world);
    const state = s.headState("c").state;
    const from = state.world.clock;
    const to = from + 40 * 365 * DAY + 5 * DAY;
    const whole = walked(world, store, from, to);
    const page = timeDue(store).due(state, { from, to }, null, 5);
    expect(page.items.map((i) => [i.at, i.what])).toEqual(whole.slice(0, 5));
    expect(page.more).toBe(whole.length - 5);
  });

  test("a holiday that does not come round with the calendar is counted within a cycle, and past one the answer has more without a number", () => {
    const world = worldOf([own("feasting", { every: "day", except: ["spring_feast", "midwinter"] }, ["19:00", "20:00", "e-feast"])]);
    const { s, store } = played(world);
    const state = s.headState("c").state;
    const from = state.world.clock;
    const due = timeDue(store);
    const near = { from, to: from + 120 * 365 * DAY };
    const page = due.due(state, near, null, 3);
    expect(page.more).toBe(walked(world, store, near.from, near.to).length - 3);
    const far = due.due(state, { from, to: from + 1000 * 365 * DAY }, null, 3);
    expect(far.items).toEqual(page.items);
    expect(far.more).toBeNull();
    // A recurrence that runs on no day without that holiday runs on none with it: nothing falls due, and nothing is said to.
    const never = worldOf([own("never", { every: "year", from: "2031-12-25", except: ["spring_feast", "midwinter"] }, ["10:00", "11:00", "never"])]);
    const n = played(never);
    expect(timeDue(n.store).due(n.s.headState("c").state, { from, to: from + 1000 * 365 * DAY }, null, 3)).toEqual({ items: [], more: 0 });
  });

  test("a thousand years of a busy town's routines and weather comes back in well under a second, without building the span", () => {
    const people = Array.from({ length: 20 }, (_, i) => own(`routine_${i}`, { every: "day" }, ["08:00", "17:00", `work_${i}`], ["17:00", "23:00", `home_${i}`]));
    const weekly = own("market", { every: "week", weekdays: [6] }, ["07:00", "15:00", "market"]);
    const weather = own("weather", { every: "day" }, ["00:00", "06:00", "night"], ["06:00", "12:00", "morning"], ["12:00", "18:00", "noon"], ["18:00", "24:00", "evening"]);
    const world = worldOf([...people, weekly, weather]);
    const { s, store } = played(world);
    const state = s.headState("c").state;
    const from = state.world.clock;
    const days = 365_243;
    const due = timeDue(store);
    Bun.gc(true);
    const heap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const page = due.due(state, { from, to: from + days * DAY }, null, 50);
    const took = performance.now() - started;
    const grew = process.memoryUsage().heapUsed - heap;
    expect(page.items).toHaveLength(50);
    // Each daily slot starts once a day; the market on each Saturday after the first day, a Saturday whose market opened before the clock.
    expect(page.more).toBe(days * (2 * people.length + 4) + Math.floor(days / 7) - 50);
    expect(took).toBeLessThan(1000);
    expect(grew).toBeLessThan(64 * 1024 * 1024);
  });
});
