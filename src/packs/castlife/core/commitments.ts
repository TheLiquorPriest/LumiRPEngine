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
  /** The plan a block was laid from: for a time skip's beats (DESIGN §24.7). */
  plan?: string;
}

/** How a kind of plan plays as a block of someone's day. */
interface Played {
  minutes: number;
  hours: readonly [number, number];
  activity: string;
  label: string;
}

/**
 * How each kind of plan plays: how long it takes when its window leaves that open, the hours of the
 * day it keeps then, what the person is doing, and how the player reads the block. The plan's own
 * words are the character's private intent, so no player surface ever shows them.
 */
const PLAYED: Readonly<Record<PlanKind, Played>> = {
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

/** A plan as the planner lays it. */
interface Layable {
  p: MindPlan;
  played: Played;
  /** Its window's start. */
  from: number;
  /** When it was settled, from which it lays nothing; for an open plan, never. */
  until: number;
}

/**
 * The plans that shape a person's days (DESIGN §24.8): the open ones, and the settled ones for the
 * times before they were settled, so settling a plan never changes the day it had, nor what another
 * plan was cut to. None for a Background character, who follows routine only, nor for the player
 * character, whose plans are the player's.
 */
function layable(ctx: ReadContext, who: EntityId, tier: Fidelity): Layable[] {
  if (tier === "background" || who === ctx.world.pov) return [];
  return (optionalQuery(ctx, "minds.plans")?.(ctx, who) ?? []).flatMap((p) => {
    const from = p.when.from;
    const until = p.status === "open" ? Infinity : (p.closed ?? from);
    return p.when.to > from && until > from ? [{ p, played: PLAYED[p.kind], from, until }] : [];
  });
}

/** The open plans that shape a person's days (DESIGN §24.8), as `layable` finds them. */
export function plansOf(ctx: ReadContext, who: EntityId, tier: Fidelity = planTier(ctx, who)): MindPlan[] {
  return layable(ctx, who, tier).flatMap((l) => (l.p.status === "open" ? [l.p] : []));
}

/** A window that is the plan's own time (at most twice what its kind takes): it happens when the plan says. */
function tight(l: Layable): boolean {
  return l.p.when.to - l.from <= 2 * l.played.minutes;
}

/** Where the search for a wide window's room ends: its end, or its first fortnight's. */
function searchEnd(l: Layable): number {
  return Math.min(l.p.when.to, l.from + SEARCH_DAYS * MINUTES_PER_DAY);
}

/**
 * Whether a plan takes its time from routine (work, school): a strong one for anyone who follows
 * plans; for a Live or Near character also an ordinary one at a set time. A Far character's
 * routine bends only for strong plans.
 */
function cutsRoutine(l: Layable, tier: Fidelity): boolean {
  return l.p.priority >= 4 || (tier !== "far" && l.p.priority >= 3 && tight(l));
}

/** Higher priority first, then the older plan, then by id. */
function precedence(a: MindPlan, b: MindPlan): number {
  return b.priority - a.priority || a.made - b.made || a.id.localeCompare(b.id);
}

/** What a plan's block is: its kind's activity (company makes a visit social), at its own place, else at home for rest. */
function planBlock(ctx: ReadContext, who: EntityId, { p, played }: Layable, start: number, end: number): Commitment {
  const place = p.where !== null && own(ctx.world.places, p.where) ? p.where : p.kind === "rest" ? homeOf(ctx, who) : null;
  return { start, end, label: played.label, activity: p.kind === "visit" && p.with.length > 0 ? "socialize" : played.activity, place, reason: "their own plan", kind: "plan", plan: p.id, option: `plan:${p.id}` };
}

/**
 * Where a plan goes (DESIGN §24.8): a tight window is the plan's own time; a wider one gets its
 * kind's length at the first time in it, within its kind's hours, that leaves trips, appointments
 * (unless the plan must happen, priority 5), the stronger plans and, for a plan that doesn't take its
 * time from routine, the routine free. Null when nothing in the window fits.
 */
function placed(ctx: ReadContext, who: EntityId, l: Layable, tier: Fidelity, a: Authored, stronger: readonly Commitment[]): Commitment | null {
  if (tight(l)) return planBlock(ctx, who, l, l.from, l.p.when.to);
  const cal = calendarOf(ctx.world);
  const { minutes, hours } = l.played;
  const to = searchEnd(l);
  const blockers = [...a.trips, ...(l.p.priority >= 5 ? [] : a.appointments), ...(cutsRoutine(l, tier) ? [] : a.routine), ...stronger];
  const candidates = new Set<number>([l.from]);
  for (const b of blockers) if (b.end > l.from && b.end < to) candidates.add(b.end);
  for (let day = dateAt(cal, l.from).dayIndex; clockAt(cal, day, 0) < to; day++) candidates.add(clockAt(cal, day, hours[0] * 60));
  for (const c of [...candidates].sort((x, y) => x - y)) {
    if (c < l.from || c >= to) continue;
    const day = dateAt(cal, c).dayIndex;
    const start = Math.max(c, clockAt(cal, day, hours[0] * 60));
    const end = start + minutes;
    if (end > Math.min(to, clockAt(cal, day, hours[1] * 60))) continue;
    if (!blockers.some((b) => b.start < end && b.end > start)) return planBlock(ctx, who, l, start, end);
  }
  return null;
}

/**
 * The plans whose windows reach [start, end), and every plan whose window reaches one of theirs: all
 * that can bear on how those are laid, since a plan avoids and is cut by the stronger ones it meets.
 * So a plan lands where it does whatever span is asked about.
 */
function bearing(plans: readonly Layable[], start: number, end: number): Layable[] {
  const reached: [number, number][] = [[start, end]];
  const out: Layable[] = [];
  const rest = [...plans];
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      const l = rest[i];
      if (!l) continue;
      const window: [number, number] = [l.from, searchEnd(l)];
      if (!reached.some(([a, b]) => window[0] < b && window[1] > a)) continue;
      out.push(l);
      reached.push(window);
      rest.splice(i, 1);
      grew = true;
    }
  }
  return out;
}

/**
 * A person's commitments overlapping [start, end): routine, appointments, trips and their own plans
 * (DESIGN §8, §24.8). A plan that takes its time from routine cuts the routine it overlaps; one that
 * must happen (priority 5) cuts appointments too; otherwise appointments and routine cut the plan.
 * Plans cut each other by precedence, a wide one placed around the stronger ones, and a trip
 * preempts everything it overlaps. A settled plan keeps only what it laid before it was settled.
 */
export function commitments(ctx: ReadContext, who: EntityId, start: number, end: number): Commitment[] {
  const tier = planTier(ctx, who);
  const plans = bearing(layable(ctx, who, tier), start, end).sort((x, y) => precedence(x.p, y.p));
  // Plans are laid against the authored commitments of their whole windows, whatever span is asked about.
  const from = Math.min(start, ...plans.map((l) => l.from));
  const to = Math.max(end, ...plans.map(searchEnd));
  const a = authored(ctx, who, from, to);
  const laid: { l: Layable; block: Commitment }[] = [];
  const blocks: Commitment[] = [];
  for (const l of plans) {
    const block = placed(ctx, who, l, tier, a, blocks);
    if (!block || block.start >= l.until) continue;
    const kept = block.end > l.until ? { ...block, end: l.until } : block;
    laid.push({ l, block: kept });
    blocks.push(kept);
  }
  const pieces: Commitment[] = [];
  laid.forEach(({ l, block }, i) => {
    const cutters = [...blocks.slice(0, i), ...(l.p.priority >= 5 ? [] : a.appointments), ...(cutsRoutine(l, tier) ? [] : a.routine)];
    pieces.push(...cutAround([block], cutters));
  });
  const routine = cutAround(
    a.routine,
    laid.filter((x) => cutsRoutine(x.l, tier)).map((x) => x.block),
  );
  const appointments = cutAround(
    a.appointments,
    laid.filter((x) => x.l.p.priority >= 5).map((x) => x.block),
  );
  return [...cutAround([...routine, ...appointments, ...pieces], a.trips), ...a.trips].filter((c) => c.end > start && c.start < end).sort((x, y) => x.start - y.start);
}

/** Each given plan's blocks as laid (after every cut), by plan id: none for a plan nothing left room for. */
export function laidPlans(ctx: ReadContext, who: EntityId, plans: readonly MindPlan[]): Map<string, Commitment[]> {
  const out = new Map<string, Commitment[]>(plans.map((p) => [p.id, []]));
  if (plans.length === 0) return out;
  const from = Math.min(...plans.map((p) => p.when.from));
  const to = Math.max(...plans.map((p) => p.when.to));
  for (const c of commitments(ctx, who, from, to)) if (c.plan !== undefined) out.get(c.plan)?.push(c);
  return out;
}
