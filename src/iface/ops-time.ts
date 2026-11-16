// Time (the time skill): `pass_time` moves the clock and answers with what the span brings due, from
// the store's list (`src/store/due.ts`); it applies none of it, and runs nothing of today's
// simulation across the span (plan §6.1: code lists what is due when time passes, and never decides
// what it did). A time is read as today's engine reads one: a date and time of day in the world's
// calendar, words for a span ("two hours", "until dawn"), or the words of a day's clock ("midnight",
// "22:00", "dusk") as the next time the clock shows them. A move to a time named as a date and time
// sets the clock as well (`settingClock`); until something has, a chat with no world keeps a date
// nobody chose, so an answer gives a time as how long it is from now, never as that date.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { type Calendar, calendarOf, clockOfPhrase, clockOfStamp, formatClock, nextTimeOfDay, parseHHMM, placeOffset } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { placeOfEntity } from "../engine/scope";
import { resolveTarget, typedSpan } from "../engine/time";
import { minutesBetween } from "../engine/world-state";
import type { WorldState } from "../engine/state";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { clockRecorded, settingClock } from "../store/blank";
import type { StoreState } from "../store/types";
import type { DueListing } from "./kit";
import type { Reading } from "./reading";
import { findOptional, isUnread, notAs, type OpContext, type OpDef, type Unread } from "./ops";
import type { Lines } from "./texts";

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

/** The clock a date and time of the calendar (`YYYY-MM-DD HH:MM`) names at `place`; null when `said` is not one. */
function stampAt(world: WorldDoc, place: string | null, said: string): number | null {
  const stamp = clockOfStamp(calendarOf(world), said.trim());
  return stamp === null ? null : stamp - placeOffset(world, stamp, place);
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
  const stamp = stampAt(world, place, said);
  if (stamp !== null) return stamp;
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

/** Whether an argument of the operation names `to` as a date and time of the calendar, not as a span, a count or a time of day. */
function namesDate(o: OpContext, to: number): boolean {
  const state = o.draft.w.state;
  const world = o.reading.registry.context(o.reading.doc, state).world;
  const place = placeOfEntity(state, world.pov);
  return Object.values(o.args).some((said) => typeof said === "string" && stampAt(world, place, said) === to);
}

/** A time on a clock nobody has set, as how long it is from now (`minutes`, below 0 before now), in the answers' line `time_from_now`; no words where the file has none. */
export function fromNow(lines: Lines, minutes: number): string {
  const n = Math.abs(minutes);
  return lines.line("time_from_now", minutes > 0 ? { ahead: n, one: n === 1 } : minutes < 0 ? { ago: n, one: n === 1 } : { now: true }) ?? "";
}

/**
 * A clock reading as an answer shows it, of `state` (the state the answer tells of: the operation's
 * own, unless given): the date and time of day at the scene's place, where its clock is a recorded
 * value (`clockRecorded`); else how long it is from that state's clock (`fromNow`), since its date is
 * one nobody chose.
 */
export function clockText(o: Pick<OpContext, "reading">, clock: number, state: StoreState = o.reading.state): string {
  if (!clockRecorded(state)) return fromNow(o.reading.lines, clock - state.world.clock);
  const world = o.reading.world;
  return formatClock(calendarOf(world), clock, placeOffset(world, clock, placeOfEntity(state.world, world.pov)));
}

/**
 * What a span brings due as an answer lists it: the host's list, soonest first, cut at the `dueItems`
 * setting, each at its time on the clock of `state` (`clockText`). How many more fall in the span is
 * said by a line, so a span of years answers with the count of the rest, not with all of it; where
 * the host could not count them, the line says only that there are more.
 */
export function listDue(o: Pick<OpContext, "reading" | "reply" | "call">, listing: DueListing, op: { n?: number; op?: string } = {}, state: StoreState = o.reading.state): JsonValue[] {
  if (listing.more === null) o.reply.line("due_more_uncounted", { ...op, listed: listing.items.length });
  else if (listing.more > 0) o.reply.line("due_more", { ...op, listed: listing.items.length, more: listing.more });
  return listing.items.map((i) => ({ when: clockText(o, i.at, state), kind: i.kind, ...(i.where !== undefined ? { where: i.where } : {}), ...(i.who !== undefined ? { who: i.who } : {}), what: i.what }));
}

/**
 * The clock set to `to`: forward by a `clock` event, back by today's own set-back (`engine.rewind`).
 * Never before the story starts, the one point today's engine holds the clock to: a set-back that
 * asks for earlier goes to the start, and the answer says so. A clock set back is reported. Where an
 * argument of the operation names `to` as a date and time and the clock reaches it, the move sets the
 * clock as well (`settingClock`).
 */
export function setClock(o: OpContext, to: number): Unread | undefined {
  const w = o.draft.w;
  const now = w.state.clock;
  if (to === now) {
    o.reply.line("already_so", { n: o.n, op: o.op, what: clockText(o, now) });
    return undefined;
  }
  const sets = namesDate(o, to);
  if (to > now) {
    const move: LedgerEvent = { type: "clock", minutes: to - now, cause: "advance" };
    const bad = o.draft.applyAll([sets ? settingClock(move) : move]);
    return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
  }
  const world = w.ctx.world;
  const start = minutesBetween(world.calendar.epoch, world.start.at);
  const back = Math.max(to, start);
  o.reply.report("time_back", { n: o.n, op: o.op, from: clockText(o, now), to: clockText(o, back) });
  if (back !== to) o.reply.report("before_start", { n: o.n, op: o.op, start: clockText(o, start) });
  if (back === now) return undefined;
  const rewind: LedgerEvent = { type: ENGINE_EVENTS.rewind, data: { minutes: now - back } };
  const bad = o.draft.applyAll([sets && back === to ? settingClock(rewind) : rewind]);
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
    // Told of the state as recorded: once this has set the clock, its times are dates.
    o.after((state): JsonObject => {
      const span: JsonObject = { from: clockText(o, Math.min(now, to), state), to: clockText(o, Math.max(now, to), state) };
      const listing = due.due(state, { from: Math.min(now, to), to: Math.max(now, to) }, at?.ref ?? null, o.call.settings.dueItems);
      return { span, due: listDue(o, listing, { n: o.n, op: o.op }, state) };
    });
    return undefined;
  },
};

/** The operations on time. */
export const TIME_OPS: readonly OpDef[] = [passTime];
