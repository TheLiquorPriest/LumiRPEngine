// The calendar's holidays as a chat keeps them: the world's own (`calendar.holidays`), less those the
// story has taken off, with those it changed and those it added over them (`calendar.holiday` events,
// kept in the pack's slice by the holiday's id). A day off or a named day is a holiday, `dayOff` or not.

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { DateRule, HolidayDef } from "../../../shared/world";
import { calendarOf } from "../../../engine/calendar";
import { objOf, own, sliceOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";

export const CALENDAR_PACK = "calendar";

/** A date rule as a record carries it, or null when it is not one the calendar reads. */
export function dateRuleOf(v: JsonValue | undefined): DateRule | null {
  if (!isRecord(v)) return null;
  const n = (key: string): number | null => {
    const x = v[key];
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  switch (v.type) {
    case "fixed": {
      const month = n("month");
      const day = n("day");
      return month !== null && day !== null ? { type: "fixed", month, day } : null;
    }
    case "nth_weekday": {
      const month = n("month");
      const weekday = n("weekday");
      const nth = n("n");
      return month !== null && weekday !== null && nth !== null ? { type: "nth_weekday", month, weekday, n: nth } : null;
    }
    case "relative": {
      const days = n("days");
      return typeof v.to === "string" && v.to !== "" && days !== null ? { type: "relative", to: v.to, days } : null;
    }
    case "easter": {
      const days = n("days");
      return days !== null ? { type: "easter", days } : null;
    }
    default:
      return null;
  }
}

/** What the story has recorded of each holiday it touched, by id: taken off (`removed`), or the label, rule and day-off it gave. */
export function keptHolidays(state: ReadContext["state"]): JsonObject {
  return objOf(sliceOf(state, CALENDAR_PACK).holidays);
}

/** The holidays of a chat: the world's, as the story changed and added to them. */
export function holidaysOf(ctx: Pick<ReadContext, "world" | "state">): HolidayDef[] {
  const kept = keptHolidays(ctx.state);
  const out: HolidayDef[] = [];
  const seen = new Set<string>();
  for (const h of calendarOf(ctx.world).def.holidays) {
    seen.add(h.id);
    const k = own(kept, h.id);
    if (isRecord(k) && k.removed === true) continue;
    out.push(isRecord(k) ? { id: h.id, label: typeof k.label === "string" && k.label !== "" ? k.label : h.label, rule: dateRuleOf(k.rule) ?? h.rule, dayOff: typeof k.dayOff === "boolean" ? k.dayOff : h.dayOff } : h);
  }
  for (const [id, k] of Object.entries(kept)) {
    if (seen.has(id) || !isRecord(k) || k.removed === true) continue;
    const rule = dateRuleOf(k.rule);
    if (typeof k.label === "string" && k.label !== "" && rule !== null) out.push({ id, label: k.label, rule, dayOff: k.dayOff === true });
  }
  return out;
}
