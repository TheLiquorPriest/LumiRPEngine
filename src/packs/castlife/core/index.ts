// Cast life pack (DESIGN §8, §9.3): commitments (jobs, school terms and timetables, appointments,
// trips and vacations, chores), needs and drives, agendas, the day planner, off-screen LOD1
// execution, NPC↔NPC encounters and invitations.
//
// Commitments are data the planner treats as fixed blocks: activity schedules (shifts, school
// timetables; terms are recurrence `from`/`until`), and the person fields `appointments`
// [{at, minutes, place, label}], `trips` [{from, until, place, label}] and `chores`
// [{label, minutes, place?, utility?}]. Needs live in `needs` {name: {v, t}} and are computed
// closed-form at read time (they rise with time; activities reset them).
//
// Level contract (domain `castlife`, read at each person):
//   0  off
//   1  day-part routines (schedules) and agendas as tracks; trips hold people away
//   2  commitments set the day
//   3  the day planner schedules whole days for LOD1 agents (seeded tie-breaks, recorded ties)
//   4  needs and drives, invitations, NPC↔NPC encounters (regard through relationship.appraise)

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { WorldDoc } from "../../../shared/world";
import { minutesBetween } from "../../../engine/world-state";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { calendarOf, clockAt, dateAt, formatClock, formatHHMM, MINUTES_PER_DAY } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { labelOf, mutableSlice, numOf, objOf, optionalQuery, optionalService, sliceOf, sliceRecord, strOf, own } from "../../../engine/pack-kit";
import { planDay, type FixedBlock, type PlanBlock, type PlanOption } from "../../../engine/plan-day";
import type { EventTypeDef, PackDef, ReadContext, SlotInfo } from "../../../engine/registry";
import { createRng, type Rng } from "../../../engine/rng";
import { hashParts } from "../../../shared/hash";
import { activeSlot, allSchedules, routineStays, scheduleInstants, scheduleOwners } from "../../../engine/schedules";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { agendaFor } from "../../../engine/tracks";

// ---------------------------------------------------------------- needs

/**
 * Need growth per hour (0 = satisfied, 100 = urgent), the activities that satisfy each, and the
 * times of day (minutes) a routine satisfies it: NPC needs follow that routine closed-form, so they
 * are never recorded; only the POV's needs have recorded anchors.
 */
export const NEEDS: Record<string, { rate: number; satisfiedBy: string[]; label: string; daily: number[] }> = {
  hunger: { rate: 4, satisfiedBy: ["eat", "meal", "lunch", "dinner", "breakfast"], label: "hungry", daily: [420, 750, 1110] },
  fatigue: { rate: 3, satisfiedBy: ["sleep"], label: "tired", daily: [420] },
  social: { rate: 1.5, satisfiedBy: ["socialize", "chat", "drinks"], label: "lonely", daily: [1140] },
  fun: { rate: 1, satisfiedBy: ["leisure", "exercise", "drinks", "socialize"], label: "bored", daily: [1200] },
};
/** A need at or above this raises a `needs` interrupt for the POV (Cast life 4). */
export const NEED_ALERT = 80;

/** A need now: from its recorded anchor `{v, t}`; else, for NPCs, from the routine's last satisfying time; else 20 at the world's start. */
export function needValue(ctx: { world: WorldDoc; state: Readonly<WorldState> }, who: EntityId, need: string, at = ctx.state.clock): number {
  const def = own(NEEDS, need);
  if (!def) return 0;
  const n = objOf(own(objOf(own(ctx.state.entities, who)?.fields.needs), need));
  if (typeof n.t !== "number" && who !== ctx.world.pov) {
    const minute = dateAt(calendarOf(ctx.world), at).minuteOfDay;
    const since = Math.min(...def.daily.map((t) => (minute - t + MINUTES_PER_DAY) % MINUTES_PER_DAY));
    return Math.min(100, (def.rate * since) / 60);
  }
  const v = numOf(n.v, 20);
  const t = numOf(n.t, minutesBetween(ctx.world.calendar.epoch, ctx.world.start.at));
  return Math.max(0, Math.min(100, v + (def.rate * Math.max(0, at - t)) / 60));
}

function satisfies(activity: string, need: string): boolean {
  return own(NEEDS, need)?.satisfiedBy.some((w) => activity.includes(w)) ?? false;
}

// ---------------------------------------------------------------- commitments

interface Commitment extends FixedBlock {
  kind: "work" | "school" | "appointment" | "trip" | "other";
}

function personPlaceFor(ctx: ReadContext, who: EntityId, at: number): PlaceId | null {
  for (const s of allSchedules(ctx.registry, ctx.world)) {
    if (s.target !== "place" || !scheduleOwners(ctx.registry, ctx.world, ctx.state, s).includes(who)) continue;
    const a = activeSlot(ctx.world, s, at);
    if (a && typeof a.slot.value === "string") return a.slot.value;
  }
  return null;
}

function homeOf(ctx: ReadContext, who: EntityId): PlaceId | null {
  const h = own(ctx.state.entities, who)?.fields.home;
  return typeof h === "string" ? h : null;
}

function workPlace(ctx: ReadContext, who: EntityId): PlaceId | null {
  const employer = own(ctx.state.entities, who)?.fields.employer;
  if (typeof employer !== "string") return null;
  if (own(ctx.world.places, employer)) return employer;
  return placeOfEntity(ctx.state, employer);
}

/**
 * A person's commitments overlapping [start, end): activity schedules, appointments and trips. A trip
 * preempts the routine and appointments it overlaps: they are cut around it.
 */
export function commitments(ctx: ReadContext, who: EntityId, start: number, end: number): Commitment[] {
  const out: Commitment[] = [];
  for (const s of allSchedules(ctx.registry, ctx.world)) {
    if (s.target !== "activity" || !scheduleOwners(ctx.registry, ctx.world, ctx.state, s).includes(who)) continue;
    const edges = scheduleInstants(ctx.world, [s], start - MINUTES_PER_DAY, end + MINUTES_PER_DAY);
    for (const e of edges) {
      if (e.edge !== "start") continue;
      const close = edges.find((x) => x.edge === "end" && x.occurrence === e.occurrence);
      const value = s.slots[e.slot]?.value;
      if (!close || typeof value !== "string" || close.at <= start || e.at >= end) continue;
      const kind = /school|class/.test(value) ? "school" : /work|shift/.test(value) ? "work" : "other";
      const place = personPlaceFor(ctx, who, e.at) ?? (kind === "work" ? workPlace(ctx, who) : null) ?? homeOf(ctx, who);
      out.push({ start: e.at, end: close.at, label: value.replace(/_/g, " "), activity: value, place, reason: kind === "other" ? "commitment" : kind, kind });
    }
  }
  const f = own(ctx.state.entities, who)?.fields;
  for (const raw of Array.isArray(f?.appointments) ? f.appointments : []) {
    const a = objOf(raw);
    const at = numOf(a.at, NaN);
    const until = at + numOf(a.minutes, 60);
    if (!(until > start && at < end)) continue;
    out.push({ start: at, end: until, label: strOf(a.label, "Appointment"), activity: "appointment", place: strOf(a.place) || null, reason: "appointment", kind: "appointment" });
  }
  const trips: Commitment[] = [];
  for (const raw of Array.isArray(f?.trips) ? f.trips : []) {
    const t = objOf(raw);
    const from = numOf(t.from, NaN);
    const until = numOf(t.until, NaN);
    if (!(until > start && from < end)) continue;
    trips.push({ start: from, end: until, label: strOf(t.label, "Away"), activity: "trip", place: strOf(t.place) || null, reason: "trip", kind: "trip" });
  }
  const cut = trips.reduce<Commitment[]>(
    (list, trip) =>
      list.flatMap((c) => {
        if (c.end <= trip.start || c.start >= trip.end) return [c];
        const parts: Commitment[] = [];
        if (c.start < trip.start) parts.push({ ...c, end: trip.start });
        if (c.end > trip.end) parts.push({ ...c, start: trip.end });
        return parts;
      }),
    out,
  );
  return [...cut, ...trips].sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- planning

function placeOfType(ctx: ReadContext, sceneType: string, near: PlaceId | null): PlaceId | null {
  const ids = Object.keys(ctx.world.places).sort();
  const parent = near ? own(ctx.world.places, near)?.parent : undefined;
  return ids.find((id) => own(ctx.world.places, id)?.sceneType === sceneType && own(ctx.world.places, id)?.parent === parent) ?? ids.find((id) => own(ctx.world.places, id)?.sceneType === sceneType && own(ctx.world.places, id)?.visibility !== "secret") ?? null;
}

function within(dayStart: number, fromH: number, toH: number): { from: number; to: number } {
  return { from: dayStart + fromH * 60, to: dayStart + toH * 60 };
}

/** The planner's options for one agent and day: sleep, meals, socializing, leisure, chores, agenda steps and retrievals. */
export function dayOptions(ctx: ReadContext, who: EntityId, dayStart: number): PlanOption[] {
  const level = ctx.levelOf(who, "castlife");
  const home = homeOf(ctx, who);
  const need = (n: string): number => (level >= 4 ? needValue(ctx, who, n, dayStart + 12 * 60) : 0);
  const cal = calendarOf(ctx.world);
  const hourOf = (t: number): number => dateAt(cal, t).minuteOfDay / 60;
  // Reasons name what drives each option: its purpose, and from level 4 the need that pushes it.
  const pressed = (n: string, word: string): string[] => (need(n) >= 50 ? [`${word} (${n} ${Math.round(need(n))})`] : []);
  const options: PlanOption[] = [
    { id: "sleep", label: "Sleep", activity: "sleep", place: home, duration: 480, repeat: true, reasons: ["night"], utility: (t) => (hourOf(t) >= 21.5 || hourOf(t) < 6 ? 10 : 0) },
    { id: "breakfast", label: "Breakfast", activity: "breakfast", place: home, duration: 30, window: within(dayStart, 6, 10), utility: 4 + need("hunger") / 20, reasons: ["morning meal", ...pressed("hunger", "hungry")] },
    { id: "lunch", label: "Lunch", activity: "lunch", place: placeOfType(ctx, "conversation", home) ?? home, duration: 45, window: within(dayStart, 11, 14), utility: 4 + need("hunger") / 20, reasons: ["midday meal", ...pressed("hunger", "hungry")] },
    { id: "dinner", label: "Dinner", activity: "dinner", place: home, duration: 60, window: within(dayStart, 17, 21), utility: 4.5 + need("hunger") / 20, reasons: ["evening meal", ...pressed("hunger", "hungry")] },
    { id: "leisure", label: "Time out", activity: "leisure", place: placeOfType(ctx, "exploration", home) ?? home, duration: 60, window: within(dayStart, 9, 20), utility: 1.5 + need("fun") / 30, reasons: ["unwind", ...pressed("fun", "bored")] },
  ];
  const social = optionalQuery(ctx, "regard");
  let fondness = 0;
  if (social) for (const other of Object.keys(ctx.state.entities)) if (other !== who && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, other)?.kind ?? "", "person")) fondness = Math.max(fondness, social(ctx, who, other));
  options.push({ id: "socialize", label: "See friends", activity: "socialize", place: placeOfType(ctx, "conversation", home) ?? home, duration: 90, window: within(dayStart, 17, 22), utility: 2.5 + fondness / 50 + need("social") / 25, reasons: ["company", ...(fondness >= 30 ? ["a close friend"] : []), ...pressed("social", "lonely")] });
  const chores = own(ctx.state.entities, who)?.fields.chores;
  if (Array.isArray(chores)) {
    chores.forEach((raw, i) => {
      const c = objOf(raw);
      options.push({ id: `chore:${i}`, label: strOf(c.label, "Chores"), activity: "chores", place: strOf(c.place) || home, duration: numOf(c.minutes, 45), window: within(dayStart, 8, 20), utility: numOf(c.utility, 2), reasons: ["chore"] });
    });
  }
  for (const a of agendaFor(ctx.world, ctx.state, who)) options.push({ id: `agenda:${a.track}`, label: a.stageLabel, activity: "agenda", place: home, duration: 60, window: within(dayStart, 9, 20), utility: 1 + a.priority, reasons: [`agenda: ${a.label}`] });
  const overdue = optionalQuery(ctx, "gear.overdue");
  if (overdue) {
    for (const g of overdue(ctx, who)) {
      const where = placeOfEntity(ctx.state, g.borrower) ?? placeOfEntity(ctx.state, g.thing);
      options.push({ id: `retrieve:${g.thing}`, label: `Get ${own(ctx.state.entities, g.thing)?.name ?? g.thing} back from ${own(ctx.state.entities, g.borrower)?.name ?? g.borrower}`, activity: `retrieve:${g.thing}`, place: where, duration: 45, window: within(dayStart, 8, 20), utility: 7, reasons: ["overdue loan"] });
    }
  }
  return options;
}

export interface DayPlan {
  day: number;
  blocks: { start: number; end: number; label: string; activity: string; place: PlaceId | null; reasons: string[]; fixed: boolean }[];
  ties: { key: string; chosen: string; via: string; options: string[] }[];
  tieZone: boolean;
}

function decisions(state: Readonly<WorldState>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(objOf(sliceOf(state, "castlife").decisions))) if (typeof v === "string") out[k] = v;
  return out;
}

/** Plans a day: commitments fixed, free time by utility; ties use a recorded `npc.choose` decision, else the seed. */
export function planFor(ctx: ReadContext, who: EntityId, day: number, rng: Rng): DayPlan {
  const cal = calendarOf(ctx.world);
  const start = clockAt(cal, day, 0);
  const end = start + MINUTES_PER_DAY;
  const plan = planDay({ agent: who, start, end, fixed: commitments(ctx, who, start, end), options: dayOptions(ctx, who, start), rng, recorded: decisions(ctx.state) });
  return {
    day,
    // Chosen-by-utility blocks state their utility; a close call says so, and says when the person's own choice (the recorded `npc.choose` decision) settled it.
    blocks: plan.blocks.map((b: PlanBlock) => {
      const tie = plan.ties.find((t) => t.at === b.start);
      const close = tie ? [tie.via === "seed" ? "close call" : `close call, ${own(ctx.state.entities, who)?.name.split(" ")[0] ?? "they"} chose`] : [];
      return { start: b.start, end: b.end, label: b.label, activity: b.activity, place: b.place, reasons: b.fixed || b.utility <= 0 ? b.reasons : [...b.reasons, `utility ${Math.round(b.utility * 10) / 10}`, ...close], fixed: b.fixed };
    }),
    ties: plan.ties.map((t) => ({ key: t.key, chosen: t.chosen, via: t.via, options: t.options.map((o) => o.id) })),
    tieZone: plan.tieZone,
  };
}

/**
 * A person's plan for a day (default today): a pure function of the state and a per-(world,
 * person, day) seed, so it is re-derived wherever it is needed and never recorded. Only
 * `npc.choose` decisions for its ties are (`castlife.decision`).
 */
export function dayPlan(ctx: ReadContext, who: EntityId, day = dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex): DayPlan {
  return planFor(ctx, who, day, createRng(hashParts("castlife.plan", ctx.world.id, who, String(day))));
}

function held(state: Readonly<WorldState>, who: EntityId, target: string, at: number): boolean {
  const until = own(objOf(own(state.entities, who)?.fields.holds), target);
  return typeof until === "number" && until > at;
}

/** Chance per slot that an agent runs into someone where it is, and the share of strangers who then get acquainted. */
const ENCOUNTER_CHANCE = 0.25;
const ACQUAINT_CHANCE = 0.15;

/** Two people know each other when either holds a regard relation toward the other. */
function acquainted(state: Readonly<WorldState>, a: EntityId, b: EntityId): boolean {
  return !!own(state.entities, a)?.relations.some((r) => r.type === "regard" && r.to === b) || !!own(state.entities, b)?.relations.some((r) => r.type === "regard" && r.to === a);
}

// ---------------------------------------------------------------- the agent process

/** Steps one LOD1 agent through one slot (Cast life ≥ 3): plan the day, live the block, needs, encounters, invitations. */
function stepAgent(slot: SlotInfo, ctx: ReadContext, rngFor: (entity: EntityId) => Rng, who: EntityId): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const e = own(ctx.state.entities, who);
  if (!e) return out;
  const level = ctx.levelOf(who, "castlife");
  const cal = calendarOf(ctx.world);
  // A slot is stepped when it completes: the agent takes up the block that holds from the slot's end.
  const day = dateAt(cal, slot.end).dayIndex;
  const rng = rngFor(who);
  const plan = dayPlan(ctx, who, day);
  const block = plan.blocks.find((b) => b.start <= slot.end && slot.end < b.end) ?? plan.blocks[plan.blocks.length - 1];
  if (!block) return out;
  const pov = ctx.world.pov;
  const povPlace = placeOfEntity(ctx.state, pov);
  if (block.activity.startsWith("retrieve:")) {
    // The owner's retrieval plan for an overdue use grant: the thing comes back (a vehicle to its home base).
    const thing = block.activity.slice("retrieve:".length);
    const lent = own(ctx.state.entities, thing)?.fields.owner === who && Object.values(ctx.state.entities).some((x) => x.relations.some((r) => r.type === "uses" && r.to === thing));
    const retrieve = lent ? optionalService(ctx, "gear.retrieve") : null;
    if (retrieve) {
      const got = retrieve(ctx, thing);
      if (Array.isArray(got)) out.push(...got, { type: ENGINE_EVENTS.note, data: { text: `${e.name} got ${own(ctx.state.entities, thing)?.name ?? thing} back.`, entity: who, visibility: "known_by" } });
    }
  }
  const activity = block.activity.startsWith("retrieve:") ? "errand" : block.activity;
  // The POV's routine leaves it where it is when it is stranded or can't reach the block's place.
  const stays = routineStays(ctx, who, block.place);
  if (!stays && !held(ctx.state, who, "place", slot.end) && block.place && own(ctx.world.places, block.place) && placeOfEntity(ctx.state, who) !== block.place) {
    out.push({ type: "set", entity: who, field: "place", value: block.place });
    if (who !== pov && block.place === povPlace) out.push({ type: ENGINE_EVENTS.signal, data: { class: "arrival", text: `${e.name} arrives.`, entity: who } });
  }
  if (!stays && !held(ctx.state, who, "activity", slot.end) && e.fields.activity !== activity) out.push({ type: "set", entity: who, field: "activity", value: activity });
  if (level < 4) return out;

  // Needs: NPCs' follow their routine closed-form; only the POV (when it is an agent) gets alerts.
  if (who === pov) {
    for (const need of Object.keys(NEEDS)) {
      if (needValue(ctx, who, need, slot.end) >= NEED_ALERT && needValue(ctx, who, need, slot.start) < NEED_ALERT) out.push({ type: ENGINE_EVENTS.signal, data: { class: "needs", text: `You're getting ${own(NEEDS, need)?.label ?? need}.`, entity: pov } });
    }
    return out;
  }

  // NPC↔NPC encounters: at most one per slot, with someone at the block's place. Acquaintances
  // (a regard relation either way) meet and their regard moves; strangers sometimes get acquainted.
  const appraise = optionalService(ctx, "relationship.appraise");
  const g = rng.fork("encounters");
  if (appraise && block.place && g.next() < ENCOUNTER_CHANCE) {
    const here = Object.keys(ctx.state.entities)
      .sort()
      .filter((other) => other !== who && other !== pov && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, other)?.kind ?? "", "person") && placeOfEntity(ctx.state, other) === block.place);
    const other = here[Math.floor(g.next() * here.length)];
    if (other) {
      const known = acquainted(ctx.state, who, other);
      const kind = known ? (g.next() < 0.1 ? "argument" : "encounter") : g.next() < ACQUAINT_CHANCE ? "greeting" : null;
      if (kind) out.push(...appraise(ctx, who, other, kind, `${kind} at ${own(ctx.world.places, block.place)?.name ?? block.place}`, true));
    }
  }

  // Invitations: a fond agent with free evening time may invite the POV (a tie-zone decision).
  const regard = optionalQuery(ctx, "regard");
  const hour = dateAt(cal, slot.start).minuteOfDay / 60;
  if (regard && !block.fixed && hour >= 12 && hour < 20 && regard(ctx, who, pov) >= 20) {
    const key = `${who}:invite:${slot.index}`;
    const invite = 1 + needValue(ctx, who, "social", slot.start) / 50 + regard(ctx, who, pov) / 50;
    const stay = 2;
    const recorded = own(decisions(ctx.state), key);
    const tie = Math.abs(invite - stay) <= 0.5;
    const choice = recorded ?? (tie ? (rng.fork(key).next() < 0.5 ? "invite" : "stay") : invite > stay ? "invite" : "stay");
    if (tie || recorded) out.push({ type: ENGINE_EVENTS.choice, data: { key, choice, via: recorded ? "recorded" : "seed", agent: who, options: "invite,stay" } });
    if (choice === "invite") {
      const where = block.place ?? placeOfType(ctx, "conversation", homeOf(ctx, who));
      const text = `${e.name} invites you to ${where ? (own(ctx.world.places, where)?.name ?? where) : "meet up"} at ${formatHHMM(dateAt(cal, slot.end).minuteOfDay)}.`;
      out.push({ type: "castlife.invitation", data: { agent: who, place: where, at: slot.end, text, key } }, { type: ENGINE_EVENTS.signal, data: { class: "invitation", text, entity: who } });
    }
  }
  return out;
}

/**
 * Trips and vacations hold people away (LOD0, every person, Cast life ≥ 1). A slot is stepped when
 * it completes, so a trip under way at the slot's end takes the person away then (once: the hold
 * marks it), and one ending within the slot brings them home.
 */
function stepTrips(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const who of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, who);
    const trips = e?.fields.trips;
    if (!e || !Array.isArray(trips) || ctx.levelOf(who, "castlife") < 1) continue;
    for (const raw of trips) {
      const t = objOf(raw);
      const from = numOf(t.from, NaN);
      const until = numOf(t.until, NaN);
      const place = strOf(t.place);
      const away = objOf(e.fields.holds).place === until && e.fields.place === place;
      if (from <= slot.end && slot.end < until && !away && own(ctx.world.places, place)) {
        out.push({ type: "set", entity: who, field: "holds", value: { ...objOf(e.fields.holds), place: until, activity: until } }, { type: "set", entity: who, field: "place", value: place }, { type: "set", entity: who, field: "activity", value: "trip" });
      }
      const home = homeOf(ctx, who);
      if (until > slot.start && until <= slot.end && home) out.push({ type: "set", entity: who, field: "place", value: home }, { type: "set", entity: who, field: "activity", value: "idle" });
    }
  }
  return out;
}

// ---------------------------------------------------------------- events, view, pack

const EVENTS: EventTypeDef<PackEvent>[] = [
  {
    type: "castlife.need",
    validate: (e, ctx) => (own(ctx.state.entities, strOf(e.data.entity)) && own(NEEDS, strOf(e.data.need)) && typeof e.data.delta === "number" ? null : { code: "bad_event", reason: "need needs an entity, a known need and a delta" }),
    apply: (e, state, ctx) => {
      const who = own(state.entities, strOf(e.data.entity));
      if (!who) return;
      const at = numOf(e.data.at, state.clock);
      const need = strOf(e.data.need);
      const v = Math.max(0, Math.min(100, needValue({ world: ctx.world, state }, strOf(e.data.entity), need, at) + numOf(e.data.delta)));
      who.fields.needs = { ...objOf(who.fields.needs), [need]: { v, t: at } };
    },
    describe: (e) => `${strOf(e.data.need).replace(/_/g, " ")} ${numOf(e.data.delta) < 0 ? "eased" : "rose"}`,
  },
  {
    type: "castlife.decision",
    validate: (e) => (strOf(e.data.key) !== "" && strOf(e.data.choice) !== "" ? null : { code: "bad_event", reason: "decision needs key and choice" }),
    apply: (e, state) => {
      sliceRecord(state, "castlife", "decisions")[strOf(e.data.key)] = strOf(e.data.choice);
    },
    describe: (e) => `decided ${strOf(e.data.choice)}`,
  },
  {
    type: "castlife.invitation",
    validate: (e, ctx) => (own(ctx.state.entities, strOf(e.data.agent)) ? null : { code: "missing_entity", reason: "invitation needs an agent" }),
    apply: (e, state) => {
      const s = mutableSlice(state, "castlife");
      const list = Array.isArray(s.invitations) ? s.invitations.slice(-9) : [];
      list.push({ agent: strOf(e.data.agent), place: e.data.place ?? null, at: numOf(e.data.at), text: strOf(e.data.text) });
      s.invitations = list;
    },
    describe: (e) => strOf(e.data.text),
  },
];

export interface CastPerson {
  id: EntityId;
  name: string;
  role: string;
  here: boolean;
  activity?: string;
  place?: string;
  regard?: { axis: string; band: string; value?: number }[];
  timeline?: { start: string; end: string; label: string; kind: "work" | "sleep" | "free" | "travel" | "other"; reasons: string[] }[];
  agenda?: { label: string; stage: string }[];
  next?: { at: string; label: string };
}

export interface CastView {
  level: number;
  needs: { need: string; value: number; label: string }[];
  people: CastPerson[];
}

function kindOfBlock(activity: string): "work" | "sleep" | "free" | "travel" | "other" {
  if (/work|shift|school/.test(activity)) return "work";
  if (activity === "sleep") return "sleep";
  if (activity === "trip" || activity === "travel") return "travel";
  if (/leisure|socialize|idle|breakfast|lunch|dinner/.test(activity)) return "free";
  return "other";
}

export function buildCastView(ctx: ReadContext): CastView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "castlife");
  const cal = calendarOf(ctx.world);
  const here = placeOfEntity(ctx.state, pov);
  const view = optionalQuery(ctx, "relationships.view");
  const people: CastPerson[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || id === pov || !kindIs(ctx.registry, ctx.world, e.kind, "person")) continue;
    const vis = own(ctx.world.entities, id)?.visibility ?? "public";
    if (vis === "secret" || (vis === "known_by" && !own(ctx.state.entities, pov)?.relations.some((r) => r.type === "knows" && r.to === id))) continue;
    const place = placeOfEntity(ctx.state, id);
    const p: CastPerson = { id, name: e.name, role: strOf(e.fields.role, strOf(e.fields.occupation).replace(/_/g, " ")), here: place !== null && place === here };
    if (typeof e.fields.activity === "string") p.activity = e.fields.activity.replace(/_/g, " ");
    if (place && (p.here || level >= 2)) p.place = own(ctx.world.places, place)?.name ?? place;
    const regard = view ? view(ctx, id, pov) : [];
    if (regard.length > 0) p.regard = regard;
    const plan = e.agent ? dayPlan(ctx, id) : null;
    if (plan && level >= 3) p.timeline = plan.blocks.map((b) => ({ start: formatHHMM(dateAt(cal, b.start).minuteOfDay), end: formatHHMM(dateAt(cal, b.end).minuteOfDay), label: b.label, kind: kindOfBlock(b.activity), reasons: b.reasons }));
    const agenda = agendaFor(ctx.world, ctx.state, id);
    if (agenda.length > 0 && own(ctx.world.tracks, agenda[0]?.track ?? "")?.visibility === "public") p.agenda = agenda.map((a) => ({ label: a.label, stage: a.stageLabel }));
    const next = plan?.blocks.find((b) => b.start > ctx.state.clock);
    if (next) p.next = { at: formatClock(cal, next.start), label: next.label };
    people.push(p);
  }
  const needs = level >= 4 ? Object.entries(NEEDS).map(([need, def]) => ({ need, value: Math.round(needValue(ctx, pov, need)), label: def.label })) : [];
  return { level, needs, people };
}

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Ties the planner left to the seed and invitations not yet decided: inputs for `npc.choose`. */
    "castlife.tie_zones": (ctx: ReadContext) => { key: string; agent: EntityId; options: string[] }[];
  }
}

export const castlifePack: PackDef = {
  id: "castlife",
  label: "Cast life",
  version: 1,
  domain: "castlife",
  requires: ["space", "gear", "relationships"],
  register(r) {
    for (const def of EVENTS) r.event(def);
    r.process({ id: "castlife.agents", domain: "castlife", minLevel: 3, scope: "agent", step: (slot, ctx, rng, agent) => (agent ? stepAgent(slot, ctx, rng, agent) : []) });
    r.process({ id: "castlife.trips", domain: "castlife", minLevel: 1, step: (slot, ctx) => stepTrips(slot, ctx) });
    r.query("castlife.tie_zones", (ctx) => {
      const out: { key: string; agent: EntityId; options: string[] }[] = [];
      const decided = decisions(ctx.state);
      for (const id of Object.keys(ctx.state.entities).sort()) {
        const plan = own(ctx.state.entities, id)?.agent ? dayPlan(ctx, id) : null;
        for (const t of plan?.ties ?? []) if (t.via === "seed" && !own(decided, t.key)) out.push({ key: t.key, agent: id, options: t.options });
      }
      return out;
    });
    // An invitation from `host` still open: its meeting time is at most 3 hours past and at most a day ahead.
    r.formula("invited", (ctx, host) => {
      const list = sliceOf(ctx.state, "castlife").invitations;
      const now = ctx.state.clock;
      return Array.isArray(list) && list.some((raw) => {
        const inv = objOf(raw);
        const at = numOf(inv.at);
        return strOf(inv.agent) === String(host ?? "") && at >= now - 180 && at <= now + MINUTES_PER_DAY;
      });
    });
    r.formula("need", (ctx, who, need) => needValue(ctx, String(who ?? ctx.world.pov), String(need ?? "")));
    r.formula("busy", (ctx, who) => {
      const id = String(who ?? "");
      return commitments(ctx, id, ctx.state.clock, ctx.state.clock + 1).length > 0;
    });

    r.effect({ type: "castlife.satisfy", resolve: (a, ctx) => { const who = strOf(a.entity) || ctx.world.pov; const need = strOf(a.need); const v = needValue(ctx, who, need); return own(NEEDS, need) && v > 0 ? [{ type: "castlife.need", data: { entity: who, need, delta: -v, at: ctx.state.clock } }] : []; } });
    r.effect({ type: "castlife.decide", resolve: (a) => [{ type: "castlife.decision", data: { key: strOf(a.key), choice: strOf(a.choice) } }] });
    r.effect({
      type: "castlife.override",
      resolve(a, ctx) {
        const who = strOf(a.who);
        const e = own(ctx.state.entities, who);
        if (!e) return { code: "missing_entity", reason: `no ${labelOf(ctx, who)}` };
        const until = ctx.state.clock + numOf(a.minutes, 60);
        const holds: JsonObject = { ...objOf(e.fields.holds) };
        const out: LedgerEvent[] = [];
        if (typeof a.place === "string" && own(ctx.world.places, a.place)) {
          holds.place = until;
          out.push({ type: "set", entity: who, field: "place", value: a.place });
        }
        if (typeof a.activity === "string") {
          holds.activity = until;
          out.push({ type: "set", entity: who, field: "activity", value: a.activity });
        }
        return [{ type: "set", entity: who, field: "holds", value: holds }, ...out];
      },
    });

    r.action({ id: "eat", label: "Eat", pack: "castlife", params: {}, requires: [], outcomes: { default: [{ type: "castlife.satisfy", args: { entity: "self", need: "hunger" } }, { type: "set", args: { entity: "self", field: "activity", value: "meal" } }] }, duration: "30", lexicon: ["eat", "have lunch", "have dinner", "grab a bite"], observable: "eats" });
    r.action({ id: "sleep", label: "Go to bed", pack: "castlife", params: {}, requires: [], outcomes: { default: [{ type: "castlife.satisfy", args: { entity: "self", need: "fatigue" } }] }, duration: "5", activity: { type: "sleep", until: "next_time('07:00')" }, lexicon: ["go to bed", "sleep", "turn in", "hit the sack"], observable: "goes to bed" });
    r.action({ id: "rest", label: "Rest", pack: "castlife", params: {}, requires: [], outcomes: { default: [{ type: "castlife.satisfy", args: { entity: "self", need: "fun" } }] }, duration: "30", activity: { type: "waiting", until: "clock + 30" }, lexicon: ["rest", "relax", "take a break"], observable: "rests" });
    r.action({ id: "accept_invitation", label: "Accept invitation", pack: "castlife", params: { host: { type: "ref", ref: "person" } }, requires: ["invited(host)"], outcomes: { default: [{ type: "relationships.appraise", args: { from: "host", to: "self", appraisal: "promise_kept" } }] }, duration: "1", lexicon: ["accept", "sure, let's", "count me in"], observable: "accepts an invitation" });

    r.renderer({
      slot: "people",
      render(ctx) {
        const pov = ctx.world.pov;
        const lines: string[] = [];
        const here = placeOfEntity(ctx.state, pov);
        for (const id of Object.keys(ctx.state.entities).sort()) {
          const e = own(ctx.state.entities, id);
          if (!e || id === pov || !here || placeOfEntity(ctx.state, id) !== here || !kindIs(ctx.registry, ctx.world, e.kind, "person")) continue;
          const act = e.fields.activity;
          lines.push(`${e.name}${typeof act === "string" && act !== "idle" ? ` (${act.replace(/_/g, " ")})` : ""} is here.`);
        }
        if (ctx.levelOf(pov, "castlife") >= 4) {
          const urgent = Object.entries(NEEDS).filter(([n]) => needValue(ctx, pov, n) >= 60).map(([, d]) => d.label);
          if (urgent.length > 0) lines.push(`You feel ${urgent.join(" and ")}.`);
        }
        return lines;
      },
    });
    r.view({ panel: "castlife.cast", build: (ctx) => buildCastView(ctx) as unknown as JsonValue });

    r.lint({
      code: "castlife.double_booking",
      check(world) {
        const issues = [];
        for (const e of Object.values(world.entities)) {
          const owned = Object.values(world.schedules).filter((s) => s.owner === e.id && s.target === "activity");
          for (let i = 0; i < owned.length; i++) {
            for (let j = i + 1; j < owned.length; j++) {
              const a = owned[i];
              const b = owned[j];
              if (!a || !b) continue;
              const days = (s: typeof a): number[] => (s.recurrence.every === "week" ? (s.recurrence.weekdays ?? [0, 1, 2, 3, 4, 5, 6]) : [0, 1, 2, 3, 4, 5, 6]);
              const sharedDay = days(a).some((d) => days(b).includes(d));
              const overlap = a.slots.some((x) => b.slots.some((y) => x.start < y.end && y.start < x.end));
              // Recurrences whose date ranges don't meet (two school terms) never run on the same day. ISO dates compare as strings.
              const ra = a.recurrence;
              const rb = b.recurrence;
              const apart = (ra.until !== undefined && rb.from !== undefined && ra.until < rb.from) || (rb.until !== undefined && ra.from !== undefined && rb.until < ra.from);
              if (sharedDay && overlap && !apart) issues.push({ severity: "warning" as const, code: "castlife.double_booking", message: `${e.name} is double-booked: ${a.id} and ${b.id} overlap.`, path: `schedules.${b.id}` });
            }
          }
          // Appointments clash with each other, with trips, and with the person's activity schedules.
          const dated = [
            ...(Array.isArray(e.fields.appointments) ? e.fields.appointments : []).map((raw, i) => ({ path: `entities.${e.id}.fields.appointments.${i}`, label: strOf(objOf(raw).label, "an appointment"), start: numOf(objOf(raw).at, NaN), end: numOf(objOf(raw).at, NaN) + numOf(objOf(raw).minutes, 60), trip: false })),
            ...(Array.isArray(e.fields.trips) ? e.fields.trips : []).map((raw, i) => ({ path: `entities.${e.id}.fields.trips.${i}`, label: strOf(objOf(raw).label, "a trip"), start: numOf(objOf(raw).from, NaN), end: numOf(objOf(raw).until, NaN), trip: true })),
          ].filter((d) => Number.isFinite(d.start) && Number.isFinite(d.end));
          for (let i = 0; i < dated.length; i++) {
            const a = dated[i];
            if (!a) continue;
            for (const b of dated.slice(i + 1)) if ((!a.trip || !b.trip) && a.start < b.end && b.start < a.end) issues.push({ severity: "warning" as const, code: "castlife.double_booking", message: `${e.name} is double-booked: ${a.label} and ${b.label} overlap.`, path: b.path });
            if (a.trip) continue;
            for (const s of owned) {
              const edges = scheduleInstants(world, [s], a.start - MINUTES_PER_DAY, a.end + MINUTES_PER_DAY);
              const clash = edges.some((x) => x.edge === "start" && x.at < a.end && (edges.find((y) => y.edge === "end" && y.occurrence === x.occurrence)?.at ?? x.at) > a.start);
              if (clash) issues.push({ severity: "warning" as const, code: "castlife.double_booking", message: `${e.name} is double-booked: ${a.label} falls in ${s.id}.`, path: a.path });
            }
          }
        }
        return issues;
      },
    });
  },
};

export default castlifePack;
