// Time (the time skill): `pass_time` moves the clock and answers with what the span brings due, from
// the state lane's list; it applies none of it, and runs nothing of today's simulation across the
// span (plan §6.1: code lists what is due when time passes, and never decides what it did). A time
// is read as today's engine reads one: a date and time of day in the world's calendar, words for a
// span ("two hours", "until dawn"), or the words of a day's clock ("midnight", "22:00", "dusk") as
// the next time the clock shows them.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { type Calendar, calendarOf, clockOfPhrase, clockOfStamp, formatClock, nextTimeOfDay, parseHHMM, placeOffset } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { placeOfEntity } from "../engine/scope";
import { resolveTarget, typedSpan } from "../engine/time";
import { minutesBetween } from "../engine/world-state";
import type { WorldState } from "../engine/state";
import type { Reading } from "./reading";
import { findOptional, isUnread, notAs, type OpContext, type OpDef, type Unread } from "./ops";

/** Words for a turn of the day that the calendar may name no part by, each read as the start of the part it falls in, where the calendar has that part. */
const TURNS_OF_DAY: Readonly<Record<string, string>> = { dawn: "morning", dusk: "evening" };

/**
 * The words of a day's clock as the next time the clock shows them, read as today's engine reads a
 * loan's end (noon, midnight, a part of the world's day, 22:00, 10pm, tomorrow), and dawn and dusk
 * where the calendar names no part so. Null when the words read as none of them.
 */
function clockOfDay(cal: Calendar, now: number, said: string): number | null {
  const read = clockOfPhrase(cal, now, said);
  if (read !== null) return read;
  const words = ` ${said.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  for (const [turn, part] of Object.entries(TURNS_OF_DAY)) {
    const start = words.includes(` ${turn} `) ? cal.dayParts.find((p) => p.id === part)?.start : undefined;
    if (start !== undefined) return nextTimeOfDay(cal, now, parseHHMM(start));
  }
  return null;
}

/**
 * A time as today's engine reads one, in minutes since the world's epoch: a date and time of day at
 * the scene's place (`YYYY-MM-DD HH:MM`), words for a span from now ("two hours", "until dawn"), or
 * the words of a day's clock at the scene's place ("midnight", "22:00") as the next time it shows
 * them. Null when it reads as none of these.
 */
export function timeFrom(reading: Reading, state: Readonly<WorldState>, said: string): number | null {
  const world = reading.registry.context(reading.doc, state).world;
  const cal = calendarOf(world);
  const place = placeOfEntity(state, world.pov);
  const stamp = clockOfStamp(cal, said.trim());
  if (stamp !== null) return stamp - placeOffset(world, stamp, place);
  const target = typedSpan(cal, state.clock, ` ${said.trim()} `);
  if (target === null) {
    const offset = placeOffset(world, state.clock, place);
    const local = clockOfDay(cal, state.clock + offset, said);
    return local === null ? null : local - offset;
  }
  if (target.type === "duration") return state.clock + target.minutes;
  const resolved = resolveTarget(reading.registry, reading.doc, state, target);
  return "code" in resolved ? null : resolved.to;
}

/** A time an argument names (see `timeFrom`), on the draft as it stands. */
export function timeArg(o: OpContext, field: string): number | Unread | undefined {
  const said = o.args[field];
  if (said === undefined || said === null) return undefined;
  const at = typeof said === "string" ? timeFrom(o.reading, o.draft.w.state, said) : null;
  return at ?? notAs(o, field, said, "time");
}

/** A clock reading as an answer shows it: the date and time of day at the scene's place. */
export function clockText(o: Pick<OpContext, "reading">, clock: number): string {
  const world = o.reading.world;
  return formatClock(calendarOf(world), clock, placeOffset(world, clock, placeOfEntity(o.reading.state.world, world.pov)));
}

/**
 * The clock set to `to`: forward by a `clock` event, back by today's own set-back (`engine.rewind`).
 * Never before the story starts, the one point today's engine holds the clock to: a set-back that
 * asks for earlier goes to the start, and the answer says so. A clock set back is reported.
 */
export function setClock(o: OpContext, to: number): Unread | undefined {
  const w = o.draft.w;
  const now = w.state.clock;
  if (to === now) {
    o.reply.line("already_so", { n: o.n, op: o.op, what: clockText(o, now) });
    return undefined;
  }
  if (to > now) {
    const bad = o.draft.applyAll([{ type: "clock", minutes: to - now, cause: "advance" }]);
    return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
  }
  const world = w.ctx.world;
  const start = minutesBetween(world.calendar.epoch, world.start.at);
  const back = Math.max(to, start);
  o.reply.report("time_back", { n: o.n, op: o.op, from: clockText(o, now), to: clockText(o, back) });
  if (back !== to) o.reply.report("before_start", { n: o.n, op: o.op, start: clockText(o, start) });
  if (back === now) return undefined;
  const bad = o.draft.applyAll([{ type: ENGINE_EVENTS.rewind, data: { minutes: now - back } }]);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

const passTime: OpDef = {
  name: "pass_time",
  lane: "engine",
  needs: [],
  takes: ["minutes", "for", "until", "at"],
  example: { op: "pass_time", for: "two hours", at: "thornbury", source: { from: "prose", message: "m-0017" } },
  run(o) {
    const w = o.draft.w;
    const now = w.state.clock;
    // Each way of saying how far the clock goes that the call gives, read; the end it names first, then a count, then words for a span.
    const read: { field: string; to: number }[] = [];
    const unread: Unread[] = [];
    for (const field of ["until", "minutes", "for"]) {
      const said = o.args[field];
      if (said === undefined || said === null || said === "") continue;
      const to = field !== "minutes" ? timeArg(o, field) : typeof said === "number" && Number.isFinite(said) ? now + Math.round(said) : notAs(o, field, said, "minutes");
      if (to === undefined) continue;
      if (isUnread(to)) unread.push(to);
      else read.push({ field, to });
    }
    const [used, ...others] = read;
    if (used === undefined) return unread[0] ?? { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["minutes", "for", "until"] } };
    // What could be read is applied; what could not, or reads as another time, is reported with what was applied.
    for (const u of unread) o.reply.report("time_left_out", { ...u.fields, used: used.field });
    for (const other of others) if (other.to !== used.to) o.reply.report("time_differs", { n: o.n, op: o.op, field: other.field, other: clockText(o, other.to), used: used.field, to: clockText(o, used.to) });
    const to = used.to;
    const at = findOptional(o, "at", "point");
    if (isUnread(at)) return at;
    const from = w.events.length;
    const failed = setClock(o, to);
    if (failed) return failed;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    const due = o.call.deps.due;
    o.after((state): JsonObject => {
      const span: JsonObject = { from: clockText(o, Math.min(now, to)), to: clockText(o, Math.max(now, to)) };
      if (due === undefined) {
        o.reply.line("due_unlisted", { n: o.n, op: o.op });
        return { span };
      }
      const items = due.due(state, { from: Math.min(now, to), to: Math.max(now, to) }, at?.ref ?? null);
      return { span, due: items.map((i) => ({ when: clockText(o, i.at), kind: i.kind, ...(i.where !== undefined ? { where: i.where } : {}), ...(i.who !== undefined ? { who: i.who } : {}), what: i.what }) as JsonValue) };
    });
    return undefined;
  },
};

/** The operations on time. */
export const TIME_OPS: readonly OpDef[] = [passTime];
