// Time (the time skill): `pass_time` moves the clock and answers with what the span brings due, from
// the state lane's list; it applies none of it, and runs nothing of today's simulation across the
// span (plan §6.1: code lists what is due when time passes, and never decides what it did). A time
// is read as today's engine reads one: a date and time of day in the world's calendar, or words for
// a span ("two hours", "until dawn").

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { calendarOf, clockOfStamp, formatClock, placeOffset } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { placeOfEntity } from "../engine/scope";
import { resolveTarget, typedSpan } from "../engine/time";
import { minutesBetween } from "../engine/world-state";
import type { WorldState } from "../engine/state";
import type { Reading } from "./reading";
import { findOptional, isUnread, notAs, numberArg, type OpContext, type OpDef, textArg, type Unread } from "./ops";

/**
 * A time as today's engine reads one, in minutes since the world's epoch: a date and time of day at
 * the scene's place (`YYYY-MM-DD HH:MM`), or words for a span from now ("two hours", "until dawn").
 * Null when it reads as neither.
 */
export function timeFrom(reading: Reading, state: Readonly<WorldState>, said: string): number | null {
  const world = reading.registry.context(reading.doc, state).world;
  const cal = calendarOf(world);
  const stamp = clockOfStamp(cal, said.trim());
  if (stamp !== null) return stamp - placeOffset(world, stamp, placeOfEntity(state, world.pov));
  const target = typedSpan(cal, state.clock, ` ${said.trim()} `);
  if (target === null) return null;
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
    o.reply.report("already_so", { n: o.n, op: o.op, what: clockText(o, now) });
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
    const minutes = numberArg(o.args, "minutes");
    const span = textArg(o.args, "for");
    const until = timeArg(o, "until");
    if (isUnread(until)) return until;
    const given = [minutes, span, until].filter((x) => x !== undefined).length;
    if (given !== 1) return { line: "needs_one", fields: { n: o.n, op: o.op, fields: ["minutes", "for", "until"] } };
    let to: number;
    if (minutes !== undefined) to = now + Math.round(minutes);
    else if (span !== undefined) {
      const read = timeArg({ ...o, args: { ...o.args, for: span } }, "for");
      if (read === undefined || isUnread(read)) return read ?? { line: "needs", fields: { n: o.n, op: o.op, fields: ["for"] } };
      to = read;
    } else to = until as number;
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
