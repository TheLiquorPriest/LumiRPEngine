// Calendar (the skill `time`): the calendar's holidays and named days as this chat keeps them (the
// world's own, less those the story took off, with those it changed or added), read, set (added, or
// changed when the holiday is there already) and taken off. A named day is a holiday that is no day
// off. The calendar pack records them (`calendar.holiday`) and its views read them; the world's own
// calendar is never edited.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { calendarOf, dateAt, holidayDay } from "../../engine/calendar";
import { holidaysOf, dateRuleOf } from "../../packs/calendar/core/holidays";
import type { DateRule, HolidayDef } from "../../shared/world";
import { TEXT, YES_NO } from "../kit";
import { notAs, textArg, type OpContext, type Unread } from "../ops";
import { readTool, type WriteDef, writeTool } from "./run";
import { textOf } from "../texts";

const FAMILY = "calendar";

/** A holiday as an answer gives it: its id, label, rule, whether it is a day off, and the day it next falls on. */
function holidayData(h: HolidayDef, next: number | null): JsonObject {
  return { id: h.id, label: h.label, rule: h.rule as unknown as JsonObject, day_off: h.dayOff, ...(next !== null ? { next_day: next } : {}) };
}

/** The holiday a name is: its id or its label, in any case. */
function holidayNamed(holidays: readonly HolidayDef[], said: string): HolidayDef | undefined {
  const want = said.trim().toLowerCase();
  return holidays.find((h) => h.id.toLowerCase() === want) ?? holidays.find((h) => h.label.trim().toLowerCase() === want);
}

/** The line that says no holiday is that name, with the holidays there are. */
function noHoliday(o: OpContext, said: string, holidays: readonly HolidayDef[]): Unread {
  return { line: "unknown_holiday", fields: { n: o.n, op: o.op, holiday: said, holidays: holidays.length === 0 ? "none" : textOf(holidays.map((h) => `${h.label} [${h.id}]`)) }, data: { field: "holiday", choices: holidays.map((h) => h.id) } };
}

/** A fixed day as `MM-DD`: its month and day, or null when it is not a day the year has. */
function fixedDay(text: string): { month: number; day: number } | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  const month = m ? Number(m[1]) : 0;
  const day = m ? Number(m[2]) : 0;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

const calendar = readTool({
  name: "calendar_read",
  family: FAMILY,
  properties: { holiday: TEXT },
  required: [],
  example: { holiday: "Harvest Day" },
  read(r, args, reply) {
    const cal = calendarOf(r.world);
    const today = dateAt(cal, r.ctx.state.clock).dayIndex;
    const all = holidaysOf(r.ctx);
    const said = textArg(args, "holiday");
    const found = said === undefined ? undefined : holidayNamed(all, said);
    if (said !== undefined && found === undefined) return { line: "unknown_holiday", fields: { holiday: said, holidays: all.length === 0 ? "none" : textOf(all.map((h) => `${h.label} [${h.id}]`)) }, data: { field: "holiday", choices: all.map((h) => h.id) } };
    const rows = (found === undefined ? all : [found]).map((h) => {
      const day = holidayDay(cal, h, today);
      const next = day !== null && day >= today ? day : holidayDay(cal, h, today + 366);
      return holidayData(h, next);
    });
    reply.data({ today_day: today, holidays: rows as unknown as JsonValue });
    return undefined;
  },
});

const setHoliday: WriteDef = {
  name: "holiday_set",
  family: FAMILY,
  lane: "engine",
  properties: { holiday: TEXT, label: TEXT, date: TEXT, rule: { type: "object" }, day_off: YES_NO },
  required: ["holiday"],
  example: { holiday: "Harvest Day", date: "09-21", day_off: false, source: { from: "prose", message: "m-0801" } },
  run(o) {
    const w = o.draft.w;
    const all = holidaysOf(w.ctx);
    const said = textArg(o.args, "holiday");
    if (said === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["holiday"] } };
    const held = holidayNamed(all, said);
    let rule: DateRule | undefined;
    if (o.args.date !== undefined && o.args.date !== null) {
      const fixed = typeof o.args.date === "string" ? fixedDay(o.args.date) : null;
      if (fixed === null) return notAs(o, "date", o.args.date, "date_md");
      rule = { type: "fixed", ...fixed };
    }
    if (o.args.rule !== undefined && o.args.rule !== null) {
      const given = dateRuleOf(o.args.rule);
      if (given === null) return notAs(o, "rule", o.args.rule, "date_rule");
      rule = given;
    }
    const label = textArg(o.args, "label") ?? (held === undefined ? said : undefined);
    if (held === undefined && rule === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["date"] } };
    // A holiday new to the chat takes an id from its label, and one the chat has already takes the next.
    const base = (label ?? said).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "holiday";
    let id = held?.id ?? base;
    for (let k = 2; held === undefined && all.some((h) => h.id === id); k++) id = `${base}_${k}`;
    const data: JsonObject = { id, ...(label !== undefined ? { label } : {}), ...(rule !== undefined ? { rule: rule as unknown as JsonObject } : {}), ...(typeof o.args.day_off === "boolean" ? { dayOff: o.args.day_off } : {}) };
    const from = w.events.length;
    const bad = o.draft.applyAll([{ type: "calendar.holiday", data }]);
    if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const removeHoliday: WriteDef = {
  name: "holiday_remove",
  family: FAMILY,
  lane: "engine",
  properties: { holiday: TEXT },
  required: ["holiday"],
  example: { holiday: "Harvest Day", source: { from: "prose", message: "m-0802" } },
  run(o) {
    const w = o.draft.w;
    const all = holidaysOf(w.ctx);
    const said = textArg(o.args, "holiday");
    if (said === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["holiday"] } };
    const held = holidayNamed(all, said);
    if (held === undefined) return noHoliday(o, said, all);
    const from = w.events.length;
    const bad = o.draft.applyAll([{ type: "calendar.holiday", data: { id: held.id, removed: true } }]);
    if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** The family's tools, as RPH's search finds them. */
export const CALENDAR_TOOLS = [calendar, writeTool(setHoliday), writeTool(removeHoliday)];
