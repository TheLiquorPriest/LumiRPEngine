// Schedules (DESIGN §3, §8 LOD0): calendar recurrence plus a slot table. A slot sets its owner's
// `target` field at its start to a fixed value, a weighted draw or a Markov draw conditioned on
// the field's previous value, and returns it to the field's default at its end unless another
// slot of the same schedule starts there. Shifts, routines, weather, bills, paydays and price
// paths are all schedules. Draws use the process seed `hash(runSeed, schedule, entity, occurrence)`.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { hashParts } from "../shared/hash";
import type { DomainId, EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { ScheduleDef, ScheduleSlot, WeightedValue, WorldDoc } from "../shared/world";
import { calendarOf, clockAt, dateAt, MINUTES_PER_DAY, parseHHMM, recursOn } from "./calendar";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { createRng, type Rng } from "./rng";
import { optionalQuery, own } from "./pack-kit";
import { fieldDef, kindIs, placeOfEntity } from "./scope";
import type { WorldState } from "./state";

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

/** Whether another slot of the same schedule starts exactly where this end instant falls. */
function handedOver(world: WorldDoc, instant: ScheduleInstant): boolean {
  const cal = calendarOf(world);
  return instant.schedule.slots.some((s, i) => {
    if (i === instant.slot) return false;
    const start = parseHHMM(s.start);
    return [instant.day, instant.day + 1].some((d) => recursOn(cal, instant.schedule.recurrence, d) && clockAt(cal, d, start) === instant.at);
  });
}

/** Entities a schedule applies to: the owner entity, or every entity of the owner kind; ownerless schedules apply to none. */
export function scheduleOwners(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, schedule: ScheduleDef): EntityId[] {
  if (!schedule.owner) return [];
  if (own(state.entities, schedule.owner)) return [schedule.owner];
  return Object.keys(state.entities)
    .sort()
    .filter((id) => {
      const e = own(state.entities, id);
      return !!e && kindIs(reg, world, e.kind, schedule.owner ?? "");
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

/**
 * The events one instant produces for every owner the schedule applies to. `povRoutine: false` (an
 * ordinary turn) leaves the POV's own place and activity to the player: its routine moves it only
 * when time runs on its own (a timelapse or a catch-up), DESIGN §9.2.
 */
export function instantEvents(reg: Registry, ctx: ReadContext, instant: ScheduleInstant, runSeed: string, opts: { povRoutine?: boolean } = {}): LedgerEvent[] {
  const { schedule } = instant;
  const out: LedgerEvent[] = [];
  const domain = scheduleDomain(reg, schedule);
  const slot = schedule.slots[instant.slot];
  if (!slot) return out;
  const startsHere = instant.edge === "end" && handedOver(ctx.world, instant);
  for (const entity of scheduleOwners(reg, ctx.world, ctx.state, schedule)) {
    if (domain && ctx.levelOf(entity, domain) < 1) continue;
    if (held(ctx.state, entity, schedule.target, instant.at)) continue;
    if (opts.povRoutine === false && entity === ctx.world.pov && (schedule.target === "place" || schedule.target === "activity")) continue;
    const current = own(own(ctx.state.entities, entity)?.fields ?? {}, schedule.target);
    let value: JsonValue | undefined;
    if (instant.edge === "start") value = sampleSlot(slot, current, createRng(scheduleSeed(runSeed, schedule.id, entity, instant.occurrence)));
    else {
      if (startsHere) continue;
      value = restValue(reg, ctx.world, ctx.state, entity, schedule.target);
    }
    if (value === undefined || keyOf(value) === keyOf(current)) continue;
    if (schedule.target === "place" && typeof value === "string" && !own(ctx.world.places, value)) continue;
    if ((schedule.target === "place" || schedule.target === "activity") && routineStays(ctx, entity, schedule.target === "place" ? value : null)) continue;
    out.push({ type: "set", entity, field: schedule.target, value });
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

/** The slot of a schedule active at `clock` for an owner, with its start and end, or null. */
export function activeSlot(world: WorldDoc, schedule: ScheduleDef, clock: number): { slot: ScheduleSlot; start: number; end: number } | null {
  const cal = calendarOf(world);
  const today = dateAt(cal, clock).dayIndex;
  for (const day of [today, today - 1]) {
    if (!recursOn(cal, schedule.recurrence, day)) continue;
    for (const slot of schedule.slots) {
      const span = slotSpan(slot);
      const start = clockAt(cal, day, span.start);
      if (start <= clock && clock < start + span.length) return { slot, start, end: start + span.length };
    }
  }
  return null;
}

/** The next slot start of a schedule after `clock`, within `horizonDays`, or null. */
export function nextStart(world: WorldDoc, schedule: ScheduleDef, clock: number, horizonDays = 14): { at: number; slot: ScheduleSlot } | null {
  const instants = scheduleInstants(world, [schedule], clock, clock + horizonDays * MINUTES_PER_DAY);
  for (const i of instants) {
    const slot = schedule.slots[i.slot];
    if (i.edge === "start" && slot) return { at: i.at, slot };
  }
  return null;
}
