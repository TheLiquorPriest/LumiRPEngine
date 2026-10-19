// A person's commitments (DESIGN §8, §24.8): what the day planner treats as fixed blocks. Routine
// (activity schedules: shifts, school timetables), dated appointments and trips, and the plans their
// mind, their memory or the GM recorded, each laid into its window. Everything here is a pure
// function of the plans and the authored commitments, never of the clock or of where anyone stands,
// so a plan lands at the same time however often, and from whatever segment of a timelapse, its day
// is planned again.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { Fidelity, MindPlan, PlanKind } from "../../../shared/minds";
import { calendarOf, clockAt, dateAt, MINUTES_PER_DAY } from "../../../engine/calendar";
import type { FixedBlock } from "../../../engine/plan-day";
import { numOf, objOf, optionalQuery, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { activeSlot, allSchedules, ownerRank, scheduleInstants, scheduleOwners } from "../../../engine/schedules";
import { homeOf, workPlace } from "./places";

/** What a block of someone's commitments is: routine work or school, an appointment, a trip, one of their own plans, or other routine. */
export type CommitmentKind = "work" | "school" | "appointment" | "trip" | "plan" | "other";

export interface Commitment extends FixedBlock {
  kind: CommitmentKind;
  /** A plan's id, for a block laid from one. */
  plan?: string;
}

/** One block a person is committed to, as `castlife.commitments` gives it (economy pay counts the work ones). */
export interface CommitmentBlock {
  start: number;
  end: number;
  activity: string;
  place: PlaceId | null;
  kind: CommitmentKind;
  label: string;
}

/**
 * How each kind of plan plays: how long it takes when its window leaves that open, the hours of the
 * day it keeps then, what the person is doing, and how the player reads the block. The plan's own
 * words are the character's private intent, so no player surface ever shows them.
 */
const PLAYED: Readonly<Record<PlanKind, { minutes: number; hours: readonly [number, number]; activity: string; label: string }>> = {
  errand: { minutes: 45, hours: [9, 18], activity: "errand", label: "Errand" },
  meet: { minutes: 90, hours: [10, 22], activity: "socialize", label: "Meeting someone" },
  visit: { minutes: 120, hours: [10, 21], activity: "visiting", label: "A visit" },
  work: { minutes: 240, hours: [6, 20], activity: "work", label: "Work" },
  rest: { minutes: 60, hours: [0, 24], activity: "rest", label: "Rest" },
  leisure: { minutes: 90, hours: [9, 22], activity: "leisure", label: "Time out" },
  other: { minutes: 60, hours: [8, 21], activity: "busy", label: "Busy" },
};

/** The furthest a plan's window is searched for room: a plan for "sometime this month" lands in its first fortnight or not at all. */
const SEARCH_DAYS = 14;

/** `blocks` with every span a cutter covers taken out: a block overlapping one keeps only its parts outside it. */
export function cutAround(blocks: Commitment[], cutters: readonly Commitment[]): Commitment[] {
  return cutters.reduce<Commitment[]>(
    (list, cutter) =>
      list.flatMap((c) => {
        if (c.end <= cutter.start || c.start >= cutter.end) return [c];
        const parts: Commitment[] = [];
        if (c.start < cutter.start) parts.push({ ...c, end: cutter.start });
        if (c.end > cutter.end) parts.push({ ...c, start: cutter.end });
        return parts;
      }),
    blocks,
  );
}

/** Where a person's place schedules have them at `at`: the most specific schedule with a slot running wins (DESIGN §8 precedence). */
function personPlaceFor(ctx: ReadContext, who: EntityId, at: number): PlaceId | null {
  let best: { rank: number; place: PlaceId } | null = null;
  for (const s of allSchedules(ctx.registry, ctx.world)) {
    if (s.target !== "place" || !scheduleOwners(ctx.registry, ctx.world, ctx.state, s).includes(who)) continue;
    const rank = ownerRank(ctx.registry, ctx.world, ctx.state, s) ?? Number.MAX_SAFE_INTEGER;
    const a = activeSlot(ctx.world, s, at);
    if (a && typeof a.slot.value === "string" && (!best || rank < best.rank)) best = { rank, place: a.slot.value };
  }
  return best?.place ?? null;
}

/** A person's authored commitments: routine (activity schedules), dated appointments and trips. */
interface Authored {
  routine: Commitment[];
  appointments: Commitment[];
  trips: Commitment[];
}

/**
 * A person's authored commitments overlapping [start, end): activity schedules (a more specific one,
 * their own over a group's over their kind's, cutting the less specific ones it overlaps),
 * appointments and trips, each as authored.
 */
function authored(ctx: ReadContext, who: EntityId, start: number, end: number): Authored {
  const ranked: { block: Commitment; rank: number }[] = [];
  for (const s of allSchedules(ctx.registry, ctx.world)) {
    if (s.target !== "activity" || !scheduleOwners(ctx.registry, ctx.world, ctx.state, s).includes(who)) continue;
    const rank = ownerRank(ctx.registry, ctx.world, ctx.state, s) ?? Number.MAX_SAFE_INTEGER;
    const edges = scheduleInstants(ctx.world, [s], start - MINUTES_PER_DAY, end + MINUTES_PER_DAY);
    for (const e of edges) {
      if (e.edge !== "start") continue;
      const close = edges.find((x) => x.edge === "end" && x.occurrence === e.occurrence);
      const value = s.slots[e.slot]?.value;
      if (!close || typeof value !== "string" || close.at <= start || e.at >= end) continue;
      const kind = /school|class/.test(value) ? "school" : /work|shift/.test(value) ? "work" : "other";
      const place = personPlaceFor(ctx, who, e.at) ?? (kind === "work" ? workPlace(ctx, who) : null) ?? homeOf(ctx, who);
      ranked.push({ block: { start: e.at, end: close.at, label: value.replace(/_/g, " "), activity: value, place, reason: kind === "other" ? "commitment" : kind, kind }, rank });
    }
  }
  const routine = ranked.flatMap(({ block, rank }) => cutAround([block], ranked.filter((r) => r.rank < rank).map((r) => r.block)));
  const f = own(ctx.state.entities, who)?.fields;
  const appointments: Commitment[] = [];
  for (const raw of Array.isArray(f?.appointments) ? f.appointments : []) {
    const a = objOf(raw);
    const at = numOf(a.at, NaN);
    const until = at + numOf(a.minutes, 60);
    if (!(until > start && at < end)) continue;
    appointments.push({ start: at, end: until, label: strOf(a.label, "Appointment"), activity: "appointment", place: strOf(a.place) || null, reason: "appointment", kind: "appointment" });
  }
  const trips: Commitment[] = [];
  for (const raw of Array.isArray(f?.trips) ? f.trips : []) {
    const t = objOf(raw);
    const from = numOf(t.from, NaN);
    const until = numOf(t.until, NaN);
    if (!(until > start && from < end)) continue;
    trips.push({ start: from, end: until, label: strOf(t.label, "Away"), activity: "trip", place: strOf(t.place) || null, reason: "trip", kind: "trip" });
  }
  return { routine, appointments, trips };
}

/** A person's fidelity as recorded (DESIGN §24.1), as the planner reads it: Background without the minds pack. */
export function planTier(ctx: ReadContext, who: EntityId): Fidelity {
  return optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? "background";
}

/**
 * The open plans that shape a person's days (DESIGN §24.8): none for a Background character, who
 * follows routine only, nor for the player character, whose plans are the player's.
 */
export function plansOf(ctx: ReadContext, who: EntityId, tier: Fidelity = planTier(ctx, who)): MindPlan[] {
  if (tier === "background" || who === ctx.world.pov) return [];
  return (optionalQuery(ctx, "minds.plans")?.(ctx, who) ?? []).filter((p) => p.status === "open" && p.when.to > p.when.from);
}

/** A window that is the plan's own time (at most twice what its kind takes): it happens when the plan says. */
function tight(p: MindPlan): boolean {
  return p.when.to - p.when.from <= 2 * PLAYED[p.kind].minutes;
}

/**
 * Whether a plan takes its time from routine (work, school): a strong one for anyone who follows
 * plans; for a Live or Near character also an ordinary one at a set time. A Far character's
 * routine bends only for strong plans.
 */
function cutsRoutine(p: MindPlan, tier: Fidelity): boolean {
  return p.priority >= 4 || (tier !== "far" && p.priority >= 3 && tight(p));
}

/** Higher priority first, then the older plan, then by id. */
function precedence(a: MindPlan, b: MindPlan): number {
  return b.priority - a.priority || a.made - b.made || a.id.localeCompare(b.id);
}

/** What a plan's block is: its kind's activity (company makes a visit social), at its own place, else at home for rest. */
function planBlock(ctx: ReadContext, who: EntityId, p: MindPlan, start: number, end: number): Commitment {
  const played = PLAYED[p.kind];
  const place = p.where !== null && own(ctx.world.places, p.where) ? p.where : p.kind === "rest" ? homeOf(ctx, who) : null;
  return { start, end, label: played.label, activity: p.kind === "visit" && p.with.length > 0 ? "socialize" : played.activity, place, reason: "their own plan", kind: "plan", plan: p.id, option: `plan:${p.id}` };
}

/**
 * Where a plan goes (DESIGN §24.8): a tight window is the plan's own time; a wider one gets its
 * kind's length at the first time in it, within its kind's hours, that leaves trips, appointments
 * (unless the plan must happen, priority 5) and, for a plan that doesn't take its time from routine,
 * the routine free. Null when nothing in the window fits.
 */
function placed(ctx: ReadContext, who: EntityId, p: MindPlan, tier: Fidelity, a: Authored): Commitment | null {
  if (tight(p)) return planBlock(ctx, who, p, p.when.from, p.when.to);
  const cal = calendarOf(ctx.world);
  const { minutes, hours } = PLAYED[p.kind];
  const to = Math.min(p.when.to, p.when.from + SEARCH_DAYS * MINUTES_PER_DAY);
  const blockers = [...a.trips, ...(p.priority >= 5 ? [] : a.appointments), ...(cutsRoutine(p, tier) ? [] : a.routine)];
  const candidates = new Set<number>([p.when.from]);
  for (const b of blockers) if (b.end > p.when.from && b.end < to) candidates.add(b.end);
  for (let day = dateAt(cal, p.when.from).dayIndex; clockAt(cal, day, 0) < to; day++) candidates.add(clockAt(cal, day, hours[0] * 60));
  for (const c of [...candidates].sort((x, y) => x - y)) {
    if (c < p.when.from || c >= to) continue;
    const day = dateAt(cal, c).dayIndex;
    const start = Math.max(c, clockAt(cal, day, hours[0] * 60));
    const end = start + minutes;
    if (end > Math.min(to, clockAt(cal, day, hours[1] * 60))) continue;
    if (!blockers.some((b) => b.start < end && b.end > start)) return planBlock(ctx, who, p, start, end);
  }
  return null;
}

/**
 * A person's commitments overlapping [start, end): routine, appointments, trips and their own plans
 * (DESIGN §8, §24.8). A plan that takes its time from routine cuts the routine it overlaps; one that
 * must happen (priority 5) cuts appointments too; otherwise appointments and routine cut the plan.
 * Plans cut each other by precedence, and a trip preempts everything it overlaps.
 */
export function commitments(ctx: ReadContext, who: EntityId, start: number, end: number): Commitment[] {
  const tier = planTier(ctx, who);
  const plans = plansOf(ctx, who, tier)
    .filter((p) => p.when.to > start && p.when.from < end)
    .sort(precedence);
  // Plans are laid against the authored commitments of their whole windows, whatever span is asked about.
  const from = Math.min(start, ...plans.map((p) => p.when.from));
  const to = Math.max(end, ...plans.map((p) => Math.min(p.when.to, p.when.from + SEARCH_DAYS * MINUTES_PER_DAY)));
  const a = authored(ctx, who, from, to);
  const laid: { p: MindPlan; block: Commitment }[] = [];
  for (const p of plans) {
    const block = placed(ctx, who, p, tier, a);
    if (block) laid.push({ p, block });
  }
  const pieces: Commitment[] = [];
  laid.forEach(({ p, block }, i) => {
    const cutters = [...laid.slice(0, i).map((l) => l.block), ...(p.priority >= 5 ? [] : a.appointments), ...(cutsRoutine(p, tier) ? [] : a.routine)];
    pieces.push(...cutAround([block], cutters));
  });
  const routine = cutAround(
    a.routine,
    laid.filter((l) => cutsRoutine(l.p, tier)).map((l) => l.block),
  );
  const appointments = cutAround(
    a.appointments,
    laid.filter((l) => l.p.priority >= 5).map((l) => l.block),
  );
  return [...cutAround([...routine, ...appointments, ...pieces], a.trips), ...a.trips].filter((c) => c.end > start && c.start < end).sort((x, y) => x.start - y.start);
}

/** Each open plan's blocks as laid (after every cut), by plan id: none for a plan nothing left room for. */
export function laidPlans(ctx: ReadContext, who: EntityId, plans: readonly MindPlan[]): Map<string, Commitment[]> {
  const out = new Map<string, Commitment[]>(plans.map((p) => [p.id, []]));
  if (plans.length === 0) return out;
  const from = Math.min(...plans.map((p) => p.when.from));
  const to = Math.max(...plans.map((p) => p.when.to));
  for (const c of commitments(ctx, who, from, to)) if (c.plan !== undefined) out.get(c.plan)?.push(c);
  return out;
}
