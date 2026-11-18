// Time (the time skill): `pass_time` moves the clock and answers with what the span brings due, from
// the store's list (`src/store/due.ts`), and with what the world's own records did over it (`ran`): pay,
// bills, standing payments and the rest of what a record arranges happen in their order as the clock passes
// them (`standingRun`, `src/engine/standing.ts`). The list itself is applied by no one (plan §6.1, §6.4: what
// it holds is for the Author to decide). A time is read as it is written (`writtenTime`, `src/engine/time.ts`): a date and time of the
// world's calendar, a clock time or a part of the world's own day by its name ("22:00", "midnight", "evening") as the next
// time the clock shows it, or a counted span ("two hours"). Nothing else is a time: a vague span or a turn of the day the
// calendar does not name is refused, naming what a time takes. A move to a time named as a date and time
// sets the clock as well (`settingClock`); until something has, a chat with no world keeps a date
// nobody chose, so an answer gives a time as how long it is from now, never as that date.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { calendarOf, clockOfSeconds, clockOfStamp, clockPlus, clockSeconds, formatClock, placeOffset } from "../engine/calendar";
import { authorLines } from "../engine/player-events";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { placeOfEntity } from "../engine/scope";
import { clockPaused, writtenTime } from "../engine/time";
import { minutesBetween } from "../engine/world-state";
import type { WorldState } from "../engine/state";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { clockRecorded, settingClock } from "../store/blank";
import type { StoreState } from "../store/types";
import type { DueListing } from "./kit";
import type { Reading } from "./reading";
import { findOptional, isUnread, named, notAs, type OpContext, type OpDef, type Unread } from "./ops";
import { roundsClock } from "./map/time";
import type { Lines } from "./texts";

/** The clock a date and time of the calendar (`YYYY-MM-DD HH:MM`) names at `place`; null when `said` is not one. */
function stampAt(world: WorldDoc, place: string | null, said: string): number | null {
  const stamp = clockOfStamp(calendarOf(world), said.trim());
  return stamp === null ? null : stamp - placeOffset(world, stamp, place);
}

/**
 * A time as it is written, in minutes since the world's epoch (`writtenTime`): a date and time of day at the scene's place
 * (`YYYY-MM-DD HH:MM`), a clock time or a part of the world's day at the scene's place as the next time it shows it, or a counted
 * span from now. Null when it reads as none of these.
 */
export function timeFrom(reading: Reading, state: Readonly<WorldState>, said: string): number | null {
  const world = reading.registry.context(reading.doc, state).world;
  const place = placeOfEntity(state, world.pov);
  return writtenTime(calendarOf(world), state.clock, said, (at) => placeOffset(world, at, place));
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

/** A time on a clock nobody has set, as how long it is from now (`minutes`, below 0 before now, a part of a minute to the second), in the answers' line `time_from_now`; no words where the file has none. */
export function fromNow(lines: Lines, minutes: number): string {
  const seconds = clockSeconds(minutes);
  const n = Math.abs(seconds) / 60;
  if (seconds === 0) return lines.line("time_from_now", { now: true }) ?? "";
  if (seconds % 60 !== 0) return lines.line("time_from_now", seconds > 0 ? { aheadSeconds: Math.abs(seconds), one: Math.abs(seconds) === 1 } : { agoSeconds: Math.abs(seconds), one: Math.abs(seconds) === 1 }) ?? "";
  return lines.line("time_from_now", seconds > 0 ? { ahead: n, one: n === 1 } : { ago: n, one: n === 1 }) ?? "";
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
  // Each by whom it concerns, named with the id a call takes; and what it is in its game system's words where it has them (a need, as the Needs view says it).
  return listing.items.map((i) => ({ when: clockText(o, i.at, state), kind: i.kind, ...(i.where !== undefined ? { where: i.where } : {}), ...(i.who !== undefined ? { who: i.who.map((id) => named(o.reading, id)) } : {}), what: i.words ?? i.what }));
}

/**
 * The clock set to `to`: forward by a `clock` event, back by today's own set-back (`engine.rewind`). A set-back before the story starts
 * is made as asked, and the answer says it is before the start. A clock set back is reported. Where an argument of the operation names
 * `to` as a date and time, the move sets the clock as well (`settingClock`), the moment the clock already shows included.
 */
export function setClock(o: OpContext, to: number): Unread | undefined {
  const w = o.draft.w;
  const now = w.state.clock;
  // A clock he paused for the scene is moved as given, and the move is said; the pause stays as he set it.
  if (to !== now && clockPaused(w.ctx.world, w.state)) o.reply.report("clock_paused", { n: o.n, op: o.op });
  const sets = namesDate(o, to);
  const done = (events: LedgerEvent[]): Unread | undefined => {
    const bad = o.draft.applyAll(events);
    return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
  };
  if (to === now) {
    // Stating the moment the clock already shows sets it; nothing is moved.
    if (sets) return done([settingClock({ type: "clock", minutes: 0, cause: "advance" })]);
    o.reply.line("already_so", { n: o.n, op: o.op, what: clockText(o, now) });
    return undefined;
  }
  if (to > now) {
    // The clock moves, and what the world's own records arrange over the span happens in its order and is recorded with it (`standingRun`).
    const ran = o.draft.runStanding(o.n, to, sets ? settingClock : undefined);
    if ("code" in ran) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: ran.code } };
    if (ran.cut) o.reply.report("standing_cut", { n: o.n, op: o.op, reached: clockText(o, ran.to), asked: clockText(o, to) });
    return undefined;
  }
  const world = w.ctx.world;
  const start = minutesBetween(world.calendar.epoch, world.start.at);
  o.reply.report("time_back", { n: o.n, op: o.op, from: clockText(o, now), to: clockText(o, to) });
  if (to < start) o.reply.report("before_start", { n: o.n, op: o.op, start: clockText(o, start) });
  const rewind: LedgerEvent = { type: ENGINE_EVENTS.rewind, data: { minutes: clockOfSeconds(clockSeconds(now) - clockSeconds(to)) } };
  return done([sets ? settingClock(rewind) : rewind]);
}

/**
 * What the world's own records did over a span, as the GM view words a change (`authorLines`): each line once, with how many times it
 * happened where more than once (four paydays are one line, four times); the first `dueItems` of them, how many more there were, and
 * how many changes were worded in all.
 */
function ranOver(o: OpContext, made: readonly LedgerEvent[]): { lines: JsonObject[]; total: number; more: number } {
  const said = new Map<string, number>();
  let total = 0;
  for (const e of made) {
    const text = authorLines(o.reading.registry, o.reading.doc, o.draft.w.state, [e], 1)[0];
    if (text === undefined) continue;
    total++;
    said.set(text, (said.get(text) ?? 0) + 1);
  }
  const all = [...said].map(([line, times]): JsonObject => (times === 1 ? { line } : { line, times }));
  const most = o.call.settings.dueItems;
  return { lines: all.slice(0, most), total, more: Math.max(0, all.length - most) };
}

const passTime: OpDef = {
  name: "pass_time",
  lane: "engine",
  needs: [],
  takes: ["minutes", "seconds", "rounds", "for", "until", "at"],
  example: { op: "pass_time", for: "two hours", at: "thornbury", source: { from: "prose", message: "m-0017" } },
  run(o) {
    const w = o.draft.w;
    const now = w.state.clock;
    // The scene the call is about: the place `at` names, or the one someone or something it names is at, else where the story's point of view is.
    const at = findOptional(o, "at", "point");
    if (isUnread(at)) return at;
    const scene = at !== undefined ? (at.ref.startsWith("place:") ? at.id : placeOfEntity(w.state, at.id)) : placeOfEntity(w.state, w.ctx.world.pov);
    // Each way of saying how far the clock goes that the call gives, read; the end it names first, then a count of minutes, seconds or rounds, then words for a span.
    const read: { field: string; to: number }[] = [];
    const unread: Unread[] = [];
    for (const field of ["until", "minutes", "seconds", "rounds", "for"]) {
      const said = o.args[field];
      if (said === undefined || said === null || said === "") continue;
      const counted = typeof said === "number" && Number.isFinite(said);
      let to: number | Unread | undefined;
      if (field === "minutes") to = counted ? clockPlus(now, said) : notAs(o, field, said, "minutes");
      else if (field === "seconds") to = counted ? clockPlus(now, said / 60) : notAs(o, field, said, "seconds");
      else if (field === "rounds") {
        // Rounds are counted by the scene's grid; where it has none that counts them, they cannot be read.
        const grid = counted && Number.isInteger(said) && said > 0 ? roundsClock(w.ctx, scene, said, "advance", o.call.deps.mapSettings) : null;
        to = grid === null ? notAs(o, field, said, "rounds") : clockPlus(now, grid.took.seconds / 60);
      } else to = timeArg(o, field);
      if (to === undefined) continue;
      if (isUnread(to)) unread.push(to);
      else read.push({ field, to });
    }
    const [used, ...others] = read;
    if (used === undefined) return unread[0] ?? { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["minutes", "seconds", "rounds", "for", "until"] } };
    // What could be read is applied; what could not, or reads as another time, is reported with what was applied.
    for (const u of unread) o.reply.report("time_left_out", { ...u.fields, used: used.field });
    for (const other of others) if (other.to !== used.to) o.reply.report("time_differs", { n: o.n, op: o.op, field: other.field, other: clockText(o, other.to), used: used.field, to: clockText(o, used.to) });
    const to = used.to;
    const from = w.events.length;
    const failed = setClock(o, to);
    if (failed) return failed;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    const reached = w.state.clock;
    // What the world's own records did over the span, in the words the GM view words a change in; the Author is told, and decides none of it.
    const ran = ranOver(o, w.events.slice(from).filter((e) => e.type !== "clock"));
    if (ran.total > 0) o.reply.line("ran_said", { n: o.n, op: o.op, total: ran.total, one: ran.total === 1 });
    if (ran.more > 0) o.reply.line("ran_more", { n: o.n, op: o.op, listed: ran.lines.length, more: ran.more });
    const due = o.call.deps.due;
    // Told of the state as recorded: once this has set the clock, its times are dates.
    o.after((state): JsonObject => {
      const span: JsonObject = { from: clockText(o, Math.min(now, reached), state), to: clockText(o, Math.max(now, reached), state) };
      const listing = due.due(state, { from: Math.min(now, reached), to: Math.max(now, reached) }, at?.ref ?? null, o.call.settings.dueItems);
      const listed = listDue(o, listing, { n: o.n, op: o.op }, state);
      // What is listed has not happened: the Author is told which of it is its own to record.
      if (listing.items.length > 0) o.reply.line("due_open", { n: o.n, op: o.op });
      return { span, ...(ran.lines.length > 0 ? { ran: ran.lines } : {}), due: listed };
    });
    return undefined;
  },
};

/** The operations on time. */
export const TIME_OPS: readonly OpDef[] = [passTime];
