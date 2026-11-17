// Schedules (DESIGN §3, §8 LOD0): calendar recurrence plus a slot table. A slot sets its owner's
// `target` field at its start to a fixed value, a weighted draw or a Markov draw conditioned on
// the field's previous value, and returns it to the field's default at its end unless another
// slot of the same schedule starts there. Shifts, routines, weather, bills, paydays and price
// paths are all schedules. Draws use the process seed `hash(runSeed, schedule, entity, occurrence)`.
//
// Owners and precedence: an owner is an entity, a group (its members), a kind or a selector. When
// schedules of different precedence set the same field of the same entity, the most specific one
// with a slot running wins (entity, then group, then kind, then selector): a less specific slot
// doesn't start over it, and when the more specific slot ends the field returns to the less
// specific slot still running, else to its rest value. Schedules of equal precedence don't rank
// against each other; lint flags those that overlap (`scheduleOverlaps`).

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { hashParts } from "../shared/hash";
import type { DomainId, EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { LintIssue } from "../shared/lint";
import type { HolidayDef, Recurrence, ScheduleDef, ScheduleSlot, WeightedValue, WorldDoc } from "../shared/world";
import type { RoutineDef } from "../shared/routines";
import { type Calendar, calendarOf, clockAt, dateAt, dayIndexOfText, daysFromCivil, holidayDay, MINUTES_PER_DAY, parseHHMM, recursOn } from "./calendar";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { createRng, type Rng } from "./rng";
import { acts } from "./life";
import { optionalQuery, own } from "./pack-kit";
import { fieldDef, isGone, kindIs, placeOfEntity } from "./scope";
import { relocate } from "./relocate";
import { COMPANY_KIND, GROUP_KIND, membersOf, selectEntities, TRUST_KIND } from "./selector";
import type { WorldState } from "./state";
import { chatWorld, calendarIn } from "./holidays";
import { initialState, minutesBetween } from "./world-state";
import { say } from "./lines";

export interface ScheduleInstant {
  at: number;
  schedule: ScheduleDef;
  /** Index into `schedule.slots`. */
  slot: number;
  /** Day index of the occurrence's start. */
  day: number;
  /** A unique, segmentation-independent occurrence number: `day × slots + slot`. */
  occurrence: number;
  edge: "start" | "end";
}

/** World schedules (by id), then pack schedules not overridden by id. */
export function allSchedules(reg: Registry, world: WorldDoc): ScheduleDef[] {
  const out = Object.keys(world.schedules)
    .sort()
    .map((id) => own(world.schedules, id))
    .filter((s): s is ScheduleDef => s !== undefined);
  for (const s of reg.schedules) if (!own(world.schedules, s.id)) out.push(s);
  return out;
}

/**
 * The schedules in force in a chat: the world's (`allSchedules`), and the chat's own versions of them
 * for one person each (DESIGN §8: the GM's or the story's `schedule_override`, from Cast life).
 */
export function chatSchedulesIn(ctx: ReadContext): ScheduleDef[] {
  const mine = optionalQuery(ctx, "castlife.chat_schedules")?.(ctx) ?? [];
  return mine.length === 0 ? allSchedules(ctx.registry, ctx.world) : [...allSchedules(ctx.registry, ctx.world), ...mine];
}

function slotSpan(slot: ScheduleSlot): { start: number; length: number } {
  const start = parseHHMM(slot.start);
  let end = parseHHMM(slot.end);
  if (end <= start) end += MINUTES_PER_DAY;
  return { start, length: end - start };
}

/** Every slot edge of the schedules inside `(from, to]`, ordered by time, then end before start, then schedule order. */
export function scheduleInstants(world: WorldDoc, schedules: readonly ScheduleDef[], from: number, to: number): ScheduleInstant[] {
  const out: ScheduleInstant[] = [];
  if (to <= from) return out;
  const cal = calendarOf(world);
  // A slot may start the day before `from` and end inside the window.
  const firstDay = dateAt(cal, from).dayIndex - 1;
  const lastDay = dateAt(cal, to).dayIndex;
  for (const schedule of schedules) {
    const spans = schedule.slots.map(slotSpan);
    for (let day = firstDay; day <= lastDay; day++) {
      if (!recursOn(cal, schedule.recurrence, day)) continue;
      spans.forEach((span, slot) => {
        const start = clockAt(cal, day, span.start);
        const end = start + span.length;
        const occurrence = day * schedule.slots.length + slot;
        if (start > from && start <= to) out.push({ at: start, schedule, slot, day, occurrence, edge: "start" });
        if (end > from && end <= to) out.push({ at: end, schedule, slot, day, occurrence, edge: "end" });
      });
    }
  }
  const order = new Map(schedules.map((s, i) => [s, i]));
  return out.sort((a, b) => a.at - b.at || (a.edge === b.edge ? 0 : a.edge === "end" ? -1 : 1) || (order.get(a.schedule) ?? 0) - (order.get(b.schedule) ?? 0) || a.slot - b.slot);
}

/** The day index on which a calendar year starts. */
function yearStart(cal: Calendar, year: number): number {
  return cal.system.abs(year, 1, 1) - cal.epochAbs;
}

/** The days of the month a `month` recurrence names, in a month of `length` days: one past its end falls on its last, a negative one counts back from it. */
function monthDays(days: readonly number[], length: number): Set<number> {
  const out = new Set<number>();
  for (const d of days) {
    const day = d > 0 ? Math.min(d, length) : length + d + 1;
    if (Number.isInteger(day) && day >= 1 && day <= length) out.add(day);
  }
  return out;
}

/** The day a `year` recurrence runs on in a year: the date it starts from, or the epoch's; null in a year without that date. */
function anniversary(cal: Calendar, rec: Recurrence, year: number): number | null {
  const anchor = cal.system.date(cal.epochAbs + (rec.from ? dayIndexOfText(cal, rec.from) : 0));
  return anchor.day <= cal.system.monthLength(year, anchor.month) ? cal.system.abs(year, anchor.month, anchor.day) - cal.epochAbs : null;
}

/** The first day from `day` to `end` that a recurrence's own rule names (every day, its weekdays, its days of the month, its date in the year), its dates and holidays aside; null when there is none. */
function ruleDayFrom(cal: Calendar, rec: Recurrence, day: number, end: number): number | null {
  const sys = cal.system;
  switch (rec.every) {
    case "week": {
      if (!rec.weekdays || rec.weekdays.length === 0) return day <= end ? day : null;
      const week = sys.weekdayNames.length;
      const first = sys.weekday(cal.epochAbs + day);
      for (let k = 0; k < week && day + k <= end; k++) if (rec.weekdays.includes((first + k) % week)) return day + k;
      return null;
    }
    case "month": {
      if (!rec.days || rec.days.length === 0) return day <= end ? day : null;
      for (let d = day; d <= end; ) {
        const date = sys.date(cal.epochAbs + d);
        const length = sys.monthLength(date.year, date.month);
        const next = Math.min(...[...monthDays(rec.days, length)].filter((m) => m >= date.day));
        if (Number.isFinite(next)) return d + next - date.day <= end ? d + next - date.day : null;
        d += length - date.day + 1;
      }
      return null;
    }
    case "year":
      for (let year = sys.date(cal.epochAbs + day).year; yearStart(cal, year) <= end; year++) {
        const at = anniversary(cal, rec, year);
        if (at !== null && at >= day) return at <= end ? at : null;
      }
      return null;
    default:
      return day <= end ? day : null;
  }
}

/** The first day from `day` to `last` that a recurrence runs on (`recursOn`), stepping from one day its rule names to the next rather than through every day; null when there is none. */
function nextRecurring(cal: Calendar, rec: Recurrence, day: number, last: number): number | null {
  const from = rec.from ? dayIndexOfText(cal, rec.from) : null;
  const end = rec.until ? Math.min(last, dayIndexOfText(cal, rec.until)) : last;
  for (let d = from !== null && from > day ? from : day; d <= end; ) {
    const at = ruleDayFrom(cal, rec, d, end);
    if (at === null) return null;
    if (recursOn(cal, rec, at)) return at;
    d = at + 1;
  }
  return null;
}

/** How many days from `p` to `q`, both in `year`, a recurrence's rule names, less the holidays it skips among them (a day two of them fall on, once). */
function daysInYear(cal: Calendar, rec: Recurrence, year: number, p: number, q: number, skipped: readonly HolidayDef[]): number {
  if (q < p) return 0;
  const sys = cal.system;
  let n = q - p + 1;
  if (rec.every === "week" && rec.weekdays && rec.weekdays.length > 0) {
    const week = sys.weekdayNames.length;
    const first = sys.weekday(cal.epochAbs + p);
    n = 0;
    for (let w = 0; w < week; w++) {
      const r = (w - first + week) % week;
      if (rec.weekdays.includes(w) && r <= q - p) n += Math.floor((q - p - r) / week) + 1;
    }
  } else if (rec.every === "month" && rec.days && rec.days.length > 0) {
    n = 0;
    for (let month = sys.date(cal.epochAbs + p).month, last = sys.date(cal.epochAbs + q).month; month <= last; month++) {
      const start = sys.abs(year, month, 1) - cal.epochAbs;
      for (const d of monthDays(rec.days, sys.monthLength(year, month))) if (start + d - 1 >= p && start + d - 1 <= q) n++;
    }
  } else if (rec.every === "year") {
    const at = anniversary(cal, rec, year);
    n = at !== null && at >= p && at <= q ? 1 : 0;
  }
  const off = new Set<number>();
  for (const h of skipped) {
    const d = holidayDay(cal, h, p);
    if (d !== null && d >= p && d <= q && ruleDayFrom(cal, rec, d, d) === d) off.add(d);
  }
  return n - off.size;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Years after which a calendar's dates fall on the same weekdays again: the gregorian's 400 (146,097 days, whole weeks); a custom calendar's years are all one length, so as many as bring its week round. */
function cycleYears(cal: Calendar): number {
  if (cal.system.abs === daysFromCivil) return 400;
  const week = cal.system.weekdayNames.length;
  return week / gcd(week, (cal.system.abs(1, 1, 1) - cal.system.abs(0, 1, 1)) % week);
}

/** Whether a holiday falls on the same day in every cycle of the calendar: Easter does not, nor a day counted from it. */
function comesRound(cal: Calendar, holiday: HolidayDef, seen: ReadonlySet<string> = new Set()): boolean {
  const rule = holiday.rule;
  if (rule.type === "easter") return cal.def.system !== "gregorian";
  // A loop of days counted from one another gives no day in any year.
  if (rule.type !== "relative" || seen.has(holiday.id)) return true;
  const base = cal.def.holidays.find((h) => h.id === rule.to);
  return base === undefined || comesRound(cal, base, new Set([...seen, holiday.id]));
}

/**
 * How many days from `lo` to `hi` a recurrence runs on (`recursOn`), worked out a year at a time and,
 * over more years than the calendar's cycle, from the cycle's own count: the work is the same for a
 * thousand years as for one cycle. Null when it skips a holiday that does not come round with the
 * calendar (Easter, or a day counted from it) over more years than one cycle: that could only be
 * counted year by year.
 */
function recurringDays(cal: Calendar, rec: Recurrence, lo: number, hi: number): number | null {
  const a = rec.from ? Math.max(lo, dayIndexOfText(cal, rec.from)) : lo;
  const b = rec.until ? Math.min(hi, dayIndexOfText(cal, rec.until)) : hi;
  if (b < a) return 0;
  const first = cal.system.date(cal.epochAbs + a).year;
  const last = cal.system.date(cal.epochAbs + b).year;
  const cycle = cycleYears(cal);
  const over = (skipped: readonly HolidayDef[]): number | null => {
    const inYear = (year: number): number => daysInYear(cal, rec, year, Math.max(a, yearStart(cal, year)), Math.min(b, yearStart(cal, year + 1) - 1), skipped);
    let n = inYear(first) + (last > first ? inYear(last) : 0);
    const whole = Math.max(0, last - first - 1);
    if (whole <= cycle) {
      for (let year = first + 1; year < last; year++) n += inYear(year);
      return n;
    }
    if (!skipped.every((h) => comesRound(cal, h))) return null;
    // The whole years repeat the count of their first cycle; those past the last whole cycle, the count of its first years.
    let round = 0;
    let rest = 0;
    for (let i = 0; i < cycle; i++) {
      const count = inYear(first + 1 + i);
      round += count;
      if (i < whole % cycle) rest += count;
    }
    return n + Math.floor(whole / cycle) * round + rest;
  };
  const skipped = rec.except && rec.except.length > 0 ? cal.def.holidays.filter((h) => rec.except?.includes(h.id)) : [];
  const steady = skipped.filter((h) => comesRound(cal, h));
  if (steady.length === skipped.length) return over(skipped);
  // A holiday skipped only takes days away: a recurrence that runs on none without it runs on none with it.
  return over(steady) === 0 ? 0 : over(skipped);
}

/** A slot's starts as `slotStarts` makes them: the next one, the last day to look on, and how many it has made of how many there are. */
interface SlotRun {
  schedule: ScheduleDef;
  order: number;
  slot: number;
  minute: number;
  day: number;
  at: number;
  last: number;
  made: number;
  total: number | null;
}

/** The order `scheduleInstants` gives starts: by time, then schedule order, then slot order. */
function before(x: SlotRun, y: SlotRun): boolean {
  return x.at !== y.at ? x.at < y.at : x.order !== y.order ? x.order < y.order : x.slot < y.slot;
}

function pushRun(heap: SlotRun[], run: SlotRun): void {
  let i = heap.push(run) - 1;
  while (i > 0) {
    const up = (i - 1) >> 1;
    if (!before(heap[i] as SlotRun, heap[up] as SlotRun)) break;
    [heap[i], heap[up]] = [heap[up] as SlotRun, heap[i] as SlotRun];
    i = up;
  }
}

function popRun(heap: SlotRun[]): SlotRun | undefined {
  const top = heap[0];
  const end = heap.pop();
  if (end === undefined || end === top) return top;
  heap[0] = end;
  for (let i = 0; ; ) {
    const l = 2 * i + 1;
    const r = l + 1;
    let least = i;
    if (l < heap.length && before(heap[l] as SlotRun, heap[least] as SlotRun)) least = l;
    if (r < heap.length && before(heap[r] as SlotRun, heap[least] as SlotRun)) least = r;
    if (least === i) break;
    [heap[i], heap[least]] = [heap[least] as SlotRun, heap[i] as SlotRun];
    i = least;
  }
  return top;
}

/**
 * The slot starts of the schedules inside `(from, to]` that `keep` lets through, in the order
 * `scheduleInstants` gives them, at most `most`: made one at a time, soonest first, so a span of a
 * thousand years costs what its first `most` do. How many more there are is counted for each slot
 * from its recurrence, without making them (`recurringDays`); null when one of them could only be
 * counted year by year.
 */
export function slotStarts(world: WorldDoc, schedules: readonly ScheduleDef[], from: number, to: number, most: number, keep: (schedule: ScheduleDef, slot: number) => boolean): { starts: ScheduleInstant[]; more: number | null } {
  const cal = calendarOf(world);
  const heap: SlotRun[] = [];
  schedules.forEach((schedule, order) => {
    const counted = new Map<string, number | null>();
    schedule.slots.forEach((s, slot) => {
      const minute = parseHHMM(s.start);
      // The days on which this slot starts inside the span.
      const first = Math.floor((from - minute + cal.epochMinute) / MINUTES_PER_DAY) + 1;
      const last = Math.floor((to - minute + cal.epochMinute) / MINUTES_PER_DAY);
      if (last < first) return;
      const key = `${first}:${last}`;
      if (!counted.has(key)) counted.set(key, recurringDays(cal, schedule.recurrence, first, last));
      const total = counted.get(key) ?? null;
      if (total === 0 || !keep(schedule, slot)) return;
      const day = nextRecurring(cal, schedule.recurrence, first, last);
      if (day !== null) pushRun(heap, { schedule, order, slot, minute, day, at: clockAt(cal, day, minute), last, made: 0, total });
    });
  });
  const starts: ScheduleInstant[] = [];
  while (starts.length < most) {
    const run = popRun(heap);
    if (run === undefined) break;
    starts.push({ at: run.at, schedule: run.schedule, slot: run.slot, day: run.day, occurrence: run.day * run.schedule.slots.length + run.slot, edge: "start" });
    run.made++;
    const next = nextRecurring(cal, run.schedule.recurrence, run.day + 1, run.last);
    if (next === null) continue;
    run.day = next;
    run.at = clockAt(cal, next, run.minute);
    pushRun(heap, run);
  }
  let more: number | null = 0;
  for (const run of heap) more = more === null || run.total === null ? null : more + run.total - run.made;
  return { starts, more };
}

/** Whether another slot of the same schedule starts exactly where this end instant falls. */
function handedOver(world: WorldDoc, instant: ScheduleInstant): boolean {
  const cal = calendarOf(world);
  return instant.schedule.slots.some((s, i) => {
    if (i === instant.slot) return false;
    const start = parseHHMM(s.start);
    return [instant.day, instant.day + 1].some((d) => recursOn(cal, instant.schedule.recurrence, d) && clockAt(cal, d, start) === instant.at);
  });
}

/** Whether a schedule an entity of this kind owns applies to its members: a group's, but not a business's or a trust's, whose schedules are their own (ORG-SPEC §3.2, DESIGN §29.1). */
function ownsAsGroup(reg: Registry, world: WorldDoc, kind: string): boolean {
  return kindIs(reg, world, kind, GROUP_KIND) && !kindIs(reg, world, kind, COMPANY_KIND) && !kindIs(reg, world, kind, TRUST_KIND);
}

/**
 * A schedule's owner precedence, most specific first: 0 an entity, 1 a group, 2 a kind, 3 a
 * selector; null for a world process. An id naming both an entity and a kind is the entity.
 */
export function ownerRank(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, schedule: ScheduleDef | RoutineDef): number | null {
  const owner = schedule.owner;
  if (isRecord(owner)) return 3;
  if (typeof owner !== "string" || owner === "") return null;
  const e = own(state.entities, owner);
  if (e) return ownsAsGroup(reg, world, e.kind) ? 1 : 0;
  return 2;
}

/**
 * Entities a schedule applies to: the owner entity; a group's members that aren't groups
 * themselves (through member groups too); every entity of the owner kind; or what a selector
 * matches. Ownerless schedules apply to none, and a removed entity keeps no schedule (a removed
 * group routes none of its members), nor does someone whose life state doesn't act (DESIGN §8):
 * a body stays where it lies.
 */
export function scheduleOwners(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, schedule: ScheduleDef | RoutineDef): EntityId[] {
  const owner = schedule.owner;
  const acting = (ids: EntityId[]): EntityId[] => ids.filter((id) => acts(world, state, id));
  if (isRecord(owner)) return acting(selectEntities(reg, world, state, owner));
  if (typeof owner !== "string" || owner === "") return [];
  const e = own(state.entities, owner);
  if (e) {
    if (isGone(state, owner)) return [];
    return acting(ownsAsGroup(reg, world, e.kind) ? membersOf(reg, world, state, owner) : [owner]);
  }
  return Object.keys(state.entities)
    .sort()
    .filter((id) => {
      const x = own(state.entities, id);
      return !!x && kindIs(reg, world, x.kind, owner) && !isGone(state, id) && acts(world, state, id);
    });
}

function keyOf(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "null";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function draw(items: readonly WeightedValue[], rng: Rng): JsonValue | undefined {
  const usable = items.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
  if (usable.length === 0) return undefined;
  return rng.weighted(usable.map((w) => ({ value: w.value, weight: w.weight })));
}

/** A slot's value: a Markov row for the previous value, else the weighted row, else the fixed value. */
export function sampleSlot(slot: ScheduleSlot, previous: JsonValue | undefined, rng: Rng): JsonValue | undefined {
  const row = slot.given?.[keyOf(previous)];
  if (row) {
    const v = draw(row, rng);
    if (v !== undefined) return v;
  }
  if (slot.weighted) {
    const v = draw(slot.weighted, rng);
    if (v !== undefined) return v;
  }
  return slot.value;
}

export function scheduleSeed(runSeed: string, schedule: string, entity: EntityId, occurrence: number): string {
  return hashParts(runSeed, `schedule:${schedule}`, entity, occurrence);
}

/** The domain whose level gates a schedule: its pack's domain, else none. */
function scheduleDomain(reg: Registry, schedule: ScheduleDef): DomainId | null {
  if (!schedule.pack) return null;
  return reg.packs.find((p) => p.id === schedule.pack)?.domain ?? null;
}

function held(state: Readonly<WorldState>, entity: EntityId, target: string, at: number): boolean {
  const holds = own(state.entities, entity)?.fields.holds;
  if (!isRecord(holds)) return false;
  const until = own(holds, target);
  return typeof until === "number" && until > at;
}

/** The value a target returns to when a slot ends: `home` for `place`, else the field default. */
function restValue(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, entity: EntityId, target: string): JsonValue | undefined {
  const e = own(state.entities, entity);
  if (!e) return undefined;
  if (target === "place") {
    const home = e.fields.home;
    return typeof home === "string" ? home : undefined;
  }
  return fieldDef(reg, world, e.kind, target)?.default;
}

/** A schedule competing with another for its target, with a slot running at the instant asked about. */
interface Rival {
  schedule: ScheduleDef;
  rank: number;
  owners: ReadonlySet<EntityId>;
  domain: DomainId | null;
  slot: ScheduleSlot;
  occurrence: number;
}

/** The other schedules setting the same target, with an owner of another precedence, that have a slot running at `at`. */
function runningRivals(reg: Registry, ctx: ReadContext, schedule: ScheduleDef, rank: number, at: number): Rival[] {
  const out: Rival[] = [];
  for (const s of chatSchedulesIn(ctx)) {
    if (s.id === schedule.id || s.target !== schedule.target) continue;
    const r = ownerRank(reg, ctx.world, ctx.state, s);
    if (r === null || r === rank) continue;
    const active = activeSlot(chatWorld(ctx), s, at);
    if (active) out.push({ schedule: s, rank: r, owners: new Set(scheduleOwners(reg, ctx.world, ctx.state, s)), domain: scheduleDomain(reg, s), slot: active.slot, occurrence: active.occurrence });
  }
  return out;
}

/** Whether a rival runs for `entity` (it owns it, at a level where its domain runs). */
function runsFor(ctx: ReadContext, rival: Rival, entity: EntityId): boolean {
  return rival.owners.has(entity) && (!rival.domain || ctx.levelOf(entity, rival.domain) >= 1);
}

/** Whether a more specific schedule setting the same field has a slot running for `entity` at `at`, so this one gives way. */
export function overriddenAt(reg: Registry, ctx: ReadContext, schedule: ScheduleDef, entity: EntityId, at: number): boolean {
  const rank = ownerRank(reg, ctx.world, ctx.state, schedule);
  if (rank === null || rank === 0) return false;
  return runningRivals(reg, ctx, schedule, rank, at).some((r) => r.rank < rank && runsFor(ctx, r, entity));
}

/** The value a schedule last set at an edge it gave way at: the slot of it handing over here, if fixed; else rest. */
function valueBefore(reg: Registry, ctx: ReadContext, instant: ScheduleInstant, entity: EntityId): JsonValue | null {
  const cal = calendarIn(ctx);
  const s = instant.schedule;
  for (const [i, slot] of s.slots.entries()) {
    if (i === instant.slot) continue;
    const span = slotSpan(slot);
    for (const d of [instant.day - 1, instant.day]) if (recursOn(cal, s.recurrence, d) && clockAt(cal, d, span.start) + span.length === instant.at) return slot.value === undefined ? null : slot.value;
  }
  return restValue(reg, ctx.world, ctx.state, entity, s.target) ?? null;
}

/** Whether an edge starts the first slot of its schedule's day: where a balanced routine takes back a day the story had. */
function firstOfDay(instant: ScheduleInstant): boolean {
  if (instant.edge !== "start") return false;
  const starts = instant.schedule.slots.map((slot) => slotSpan(slot).start);
  return starts[instant.slot] === Math.min(...starts);
}

/**
 * The events one instant produces for every owner the schedule applies to. `povRoutine: false` (an
 * ordinary turn, a span the player's words spend doing something, a narrated skip, or a palette
 * Timelapse that holds the POV) leaves the POV's own place and activity to the player: its routine
 * moves it only when time runs on its own and follows it (a timelapse), DESIGN §9.2. A place or
 * activity edge gives way to the story (Cast life's `castlife.yields`, DESIGN §8): someone whose
 * routine isn't lived (by default the Live, Near and Far cast's, outside a skip they spend on it:
 * `timelapse`; their schedules are context only), someone the story put elsewhere than the schedule
 * last had them, and while the story holds the POV (`povRoutine: false`) anyone in a scene with it,
 * stays as they are; and to a chat that took them off the schedule (`castlife.schedule_off`). Every
 * other target (weather, prices, a business's hours) runs whatever anyone's role, as money flows do.
 */
export function instantEvents(reg: Registry, ctx: ReadContext, instant: ScheduleInstant, runSeed: string, opts: { povRoutine?: boolean; timelapse?: boolean } = {}): LedgerEvent[] {
  const { schedule } = instant;
  const out: LedgerEvent[] = [];
  const domain = scheduleDomain(reg, schedule);
  const slot = schedule.slots[instant.slot];
  if (!slot) return out;
  const startsHere = instant.edge === "end" && handedOver(chatWorld(ctx), instant);
  const rank = ownerRank(reg, ctx.world, ctx.state, schedule);
  const rivals = rank === null ? [] : runningRivals(reg, ctx, schedule, rank, instant.at);
  const yields = optionalQuery(ctx, "castlife.yields");
  const off = optionalQuery(ctx, "castlife.schedule_off");
  const routine = schedule.target === "place" || schedule.target === "activity";
  for (const entity of scheduleOwners(reg, ctx.world, ctx.state, schedule)) {
    if (domain && ctx.levelOf(entity, domain) < 1) continue;
    if (held(ctx.state, entity, schedule.target, instant.at)) continue;
    if (opts.povRoutine === false && entity === ctx.world.pov && routine) continue;
    if (off?.(ctx, entity, schedule.id, instant.at) === true) continue;
    // No one in a fight under way leaves it, or stops fighting, for a schedule (the combat pack).
    if (routine && optionalQuery(ctx, "combat.engaged")?.(ctx, entity) === true) continue;
    const mine = rivals.filter((r) => runsFor(ctx, r, entity));
    // A more specific slot is running: this edge gives way to it.
    if (rank !== null && mine.some((r) => r.rank < rank)) continue;
    const current = own(own(ctx.state.entities, entity)?.fields ?? {}, schedule.target);
    let value: JsonValue | undefined;
    if (instant.edge === "start") value = sampleSlot(slot, current, createRng(scheduleSeed(runSeed, schedule.id, entity, instant.occurrence)));
    else {
      if (startsHere) continue;
      // Back to the most specific less specific slot still running, else to rest.
      const under = mine.filter((r) => rank !== null && r.rank > rank).sort((a, b) => a.rank - b.rank)[0];
      value = under ? sampleSlot(under.slot, current, createRng(scheduleSeed(runSeed, under.schedule.id, entity, under.occurrence))) : restValue(reg, ctx.world, ctx.state, entity, schedule.target);
    }
    if (value === undefined || keyOf(value) === keyOf(current)) continue;
    if (schedule.target === "place" && typeof value === "string" && !own(ctx.world.places, value)) continue;
    if (routine && routineStays(ctx, entity, schedule.target === "place" ? value : null)) continue;
    if (routine && yields) {
      // Where their schedules last had them: before a start, a less specific slot still running, else
      // the slot of this one handing over, else rest; before an end, this slot's own value.
      const lower = mine.filter((r) => rank !== null && r.rank > rank).sort((a, b) => a.rank - b.rank)[0];
      const expected = instant.edge === "end" ? (slot.value ?? null) : lower ? (lower.slot.value ?? null) : valueBefore(reg, ctx, instant, entity);
      if (yields(ctx, entity, schedule.target === "place" ? "place" : "activity", expected, firstOfDay(instant), opts.povRoutine === false, opts.timelapse === true)) continue;
    }
    // A place goes through the one move path (out of what holds them, where they then stand), in the
    // shapes rules read; the player character's party goes with it, as on every move it makes.
    if (schedule.target === "place" && typeof value === "string") {
      const moved = relocate(ctx, entity, value, { party: true });
      if (!("code" in moved)) out.push(...moved);
    } else out.push({ type: "set", entity, field: schedule.target, value });
  }
  return out;
}

/**
 * Whether the POV's own routine must leave it where it is: it is stranded (no route home from where
 * it stands, say on an island it sailed to) or the routine's place `to` can't be reached from there.
 * Only the POV: NPC routines keep their schedule moves.
 */
export function routineStays(ctx: ReadContext, who: EntityId, to: JsonValue | null | undefined): boolean {
  if (who !== ctx.world.pov) return false;
  const reach = optionalQuery(ctx, "space.reachable");
  const here = placeOfEntity(ctx.state, who);
  if (!reach || !here) return false;
  const home = own(ctx.state.entities, who)?.fields.home;
  if (typeof home === "string" && own(ctx.world.places, home) && !reach(ctx, here, home)) return true;
  return typeof to === "string" && own(ctx.world.places, to) !== undefined && !reach(ctx, here, to);
}

/** The slot of a schedule running at `clock`, with its index, start, end and occurrence number, or null. */
export function activeSlot(world: WorldDoc, schedule: ScheduleDef, clock: number): { slot: ScheduleSlot; index: number; start: number; end: number; occurrence: number } | null {
  const cal = calendarOf(world);
  const today = dateAt(cal, clock).dayIndex;
  for (const day of [today, today - 1]) {
    if (!recursOn(cal, schedule.recurrence, day)) continue;
    for (const [index, slot] of schedule.slots.entries()) {
      const span = slotSpan(slot);
      const start = clockAt(cal, day, span.start);
      if (start <= clock && clock < start + span.length) return { slot, index, start, end: start + span.length, occurrence: day * schedule.slots.length + index };
    }
  }
  return null;
}

/** The next slot start of a schedule for `entity` after `clock` that no more specific schedule overrides, within `horizonDays`, or null. */
export function nextStartFor(reg: Registry, ctx: ReadContext, schedule: ScheduleDef, entity: EntityId, clock: number, horizonDays = 14): { at: number; slot: ScheduleSlot } | null {
  for (const i of scheduleInstants(chatWorld(ctx), [schedule], clock, clock + horizonDays * MINUTES_PER_DAY)) {
    const slot = schedule.slots[i.slot];
    if (i.edge === "start" && slot && !overriddenAt(reg, ctx, schedule, entity, i.at)) return { at: i.at, slot };
  }
  return null;
}

/** A schedule's slot spans as minutes of the day (an overnight slot split at midnight). */
function daySpans(schedule: ScheduleDef): [number, number][] {
  return schedule.slots.flatMap((slot): [number, number][] => {
    const { start, length } = slotSpan(slot);
    const end = start + length;
    return end <= MINUTES_PER_DAY ? [[start, end]] : [[start, MINUTES_PER_DAY], [0, end - MINUTES_PER_DAY]];
  });
}

/** Days of overlap search: a year and a week, enough for every recurrence to repeat. */
const OVERLAP_DAYS = 372;

/**
 * Lint (DESIGN §13): pairs of schedules that set the same field of the same entity at the same
 * time with the same precedence, so neither wins. Owners are read from the state a chat starts
 * with; times over a year from the world's start, or from the later of the two `from` dates.
 */
export function scheduleOverlaps(reg: Registry, world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  let startClock: number;
  try {
    startClock = minutesBetween(world.calendar.epoch, world.start.at);
  } catch {
    return issues;
  }
  const cal = calendarOf(world);
  const state = initialState(world, "", reg);
  const entries = allSchedules(reg, world).map((schedule) => ({ schedule, rank: ownerRank(reg, world, state, schedule), owners: new Set(scheduleOwners(reg, world, state, schedule)) }));
  const fromDay = (s: ScheduleDef): number => {
    try {
      return s.recurrence.from ? dayIndexOfText(cal, s.recurrence.from) : -Infinity;
    } catch {
      return -Infinity;
    }
  };
  // A schedule's runs from `day` on, as [start, end) clock spans in start order.
  const runs = (s: ScheduleDef, day: number): [number, number][] => {
    const from = clockAt(cal, day, 0);
    const starts = new Map<number, number>();
    const out: [number, number][] = [];
    for (const e of scheduleInstants(world, [s], from - MINUTES_PER_DAY, from + OVERLAP_DAYS * MINUTES_PER_DAY)) {
      if (e.edge === "start") starts.set(e.occurrence, e.at);
      else {
        const at = starts.get(e.occurrence);
        if (at !== undefined) out.push([at, e.at]);
      }
    }
    return out.sort((x, y) => x[0] - y[0]);
  };
  // Whether two start-ordered span lists share a minute (a merge walk).
  const meet = (ra: [number, number][], rb: [number, number][]): boolean => {
    let i = 0;
    let j = 0;
    while (i < ra.length && j < rb.length) {
      const [s1, e1] = ra[i] ?? [0, 0];
      const [s2, e2] = rb[j] ?? [0, 0];
      if (s1 < e2 && s2 < e1) return true;
      if (e1 <= e2) i++;
      else j++;
    }
    return false;
  };
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (!a || !b || a.schedule.target !== b.schedule.target || a.rank === null || a.rank !== b.rank) continue;
      const shared = [...a.owners].filter((id) => b.owners.has(id));
      if (shared.length === 0) continue;
      let spansA: [number, number][];
      let spansB: [number, number][];
      try {
        spansA = daySpans(a.schedule);
        spansB = daySpans(b.schedule);
      } catch {
        continue;
      }
      // Slots that never share a minute of the day never overlap; skip the calendar walk.
      if (!spansA.some(([s1, e1]) => spansB.some(([s2, e2]) => s1 < e2 && s2 < e1))) continue;
      const day = Math.max(dateAt(cal, startClock).dayIndex, fromDay(a.schedule), fromDay(b.schedule));
      let clash = false;
      try {
        clash = meet(runs(a.schedule, day), runs(b.schedule, day));
      } catch {
        continue;
      }
      if (!clash) continue;
      const names = shared.map((id) => own(state.entities, id)?.name ?? id);
      const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
      issues.push({ severity: "warning", path: `schedules.${b.schedule.id}`, code: "schedule_overlap", message: say("lint_who_isare_double_booked_id_and_id2", { who: who, id: a.schedule.id, id2: b.schedule.id, target: a.schedule.target, if_names: names.length === 1 }) });
    }
  }
  return issues;
}
