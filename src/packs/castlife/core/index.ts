// Cast life pack (DESIGN §8, §9.3, §24.8): commitments (jobs, school terms and timetables,
// appointments, trips and vacations, and each character's own plans), chores, needs and drives,
// agendas, occasions, the day planner, off-screen LOD1 execution, NPC↔NPC encounters and
// invitations, and the narrator's Stance section (§6.6): how the people with the POV stand toward
// it, what they are about, and the cues for their secrets.
//
// Commitments are what the planner treats as fixed blocks (`commitments.ts`): activity schedules
// (shifts, school timetables; terms are recurrence `from`/`until`), the person fields `appointments`
// [{at, minutes, place, label}] and `trips` [{from, until, place, label}], and the open plans a
// character's mind, memory or the GM recorded (`minds.plans`), laid into their windows. Chores
// [{label, minutes, place?, utility?}] are options. A day's occasion (`occasions.ts`: the weekend,
// holidays, birthdays, the season, the weather) shapes its options. Needs live in `needs`
// {name: {v, t}} for the POV; an NPC's are read from what their day's plan has them do.
//
// Level contract (domain `castlife`, read at each person):
//   0  off
//   1  day-part routines (schedules) and agendas as tracks; trips hold people away
//   2  commitments set the day
//   3  the day planner schedules whole days for LOD1 agents (seeded tie-breaks, recorded ties), with
//      their own plans at their times
//   4  needs and drives, invitations, NPC↔NPC encounters (regard through relationship.appraise)

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId, TierId } from "../../../shared/ids";
import { facetsInOrder, facetTree } from "../../../shared/classes";
import { MINDS_EVENTS } from "../../../shared/minds";
import { tierLabel, tierOf, tiersInOrder } from "../../../shared/tiers";
import type { FacetId, FacetValueId, WorldDoc } from "../../../shared/world";
import { minutesBetween } from "../../../engine/world-state";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { calendarOf, clockAt, dateAt, formatClock, formatHHMM, MINUTES_PER_DAY } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { labelOf, mutableSlice, numOf, objOf, optionalQuery, optionalService, sliceOf, sliceRecord, strOf, own } from "../../../engine/pack-kit";
import { planDay, tieKey, type PlanBlock, type PlanOption } from "../../../engine/plan-day";
import type { AgentInstant, EventTypeDef, PackDef, ReadContext, SlotInfo } from "../../../engine/registry";
import { createRng, type Rng } from "../../../engine/rng";
import { hashParts } from "../../../shared/hash";
import { routineStays, scheduleInstants } from "../../../engine/schedules";
import { isGone, kindDef, kindIs, placeOfEntity } from "../../../engine/scope";
import { acts as lifeActs, povLife } from "../../../engine/life";
import { classValues, isGroup, isMemberOf, MEMBER_OF } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { agendaFor } from "../../../engine/tracks";
import { lastSighting } from "../../../engine/seen";
import { hiddenNameCheck, playerKnows } from "../../../engine/player-events";
import { canSeeEntity, canSeeField, canSeePlace, findLeaks, HIDDEN_PLACE_NAME, knows, unrevealedSecrets, visibilityOf } from "../../../engine/visibility";
import { commitments, isPlayed, laidPlans, livesPlans, planTier, plansOf, type CommitmentBlock } from "./commitments";
import { cueIssues, cuesFor } from "./cues";
import { birthdayOf, FOND, occasionOf } from "./occasions";
import { homeOf, placeOfType } from "./places";

export { commitments, type CommitmentBlock, type CommitmentKind } from "./commitments";

// ---------------------------------------------------------------- needs

/**
 * Need growth per hour (0 = satisfied, 100 = urgent), the activities that satisfy each, and the
 * times of day (minutes) a routine satisfies it. Only the POV's needs, and one a rule or an action set
 * for someone, are recorded; an NPC's follow what their day's plan has them do (DESIGN §24.8), and
 * the routine's times stand in before the day has met a need and for anyone the planner doesn't plan.
 */
export const NEEDS: Record<string, { rate: number; satisfiedBy: string[]; label: string; daily: number[] }> = {
  hunger: { rate: 4, satisfiedBy: ["eat", "meal", "lunch", "dinner", "breakfast"], label: "hungry", daily: [420, 750, 1110] },
  fatigue: { rate: 3, satisfiedBy: ["sleep"], label: "tired", daily: [420] },
  social: { rate: 1.5, satisfiedBy: ["socialize", "chat", "drinks"], label: "lonely", daily: [1140] },
  fun: { rate: 1, satisfiedBy: ["leisure", "exercise", "drinks", "socialize"], label: "bored", daily: [1200] },
};
/** A need at or above this raises a `needs` interrupt for the POV (Cast life 4). */
export const NEED_ALERT = 80;

function satisfies(activity: string, need: string): boolean {
  return own(NEEDS, need)?.satisfiedBy.some((w) => activity.includes(w)) ?? false;
}

/**
 * A need at `at` given the blocks of the person's day: from its recorded anchor `{v, t}` (the POV's
 * starts at 20 at the world's start); else from when those blocks last met it (the end of the latest
 * satisfying block begun by then, or `at` while they're in it), else from the routine's last time.
 */
function needIn(ctx: ReadContext, who: EntityId, need: string, at: number, blocks: readonly Pick<PlanBlock, "start" | "end" | "activity">[]): number {
  const def = own(NEEDS, need);
  if (!def) return 0;
  const n = objOf(own(objOf(own(ctx.state.entities, who)?.fields.needs), need));
  if (typeof n.t === "number" || who === ctx.world.pov) {
    const v = numOf(n.v, 20);
    const t = numOf(n.t, minutesBetween(ctx.world.calendar.epoch, ctx.world.start.at));
    return Math.max(0, Math.min(100, v + (def.rate * Math.max(0, at - t)) / 60));
  }
  let met = -Infinity;
  for (const b of blocks) if (b.start <= at && satisfies(b.activity, need)) met = Math.max(met, Math.min(b.end, at));
  if (met === -Infinity) {
    const minute = dateAt(calendarOf(ctx.world), at).minuteOfDay;
    met = at - Math.min(...def.daily.map((t) => (minute - t + MINUTES_PER_DAY) % MINUTES_PER_DAY));
  }
  return Math.min(100, (def.rate * (at - met)) / 60);
}

/**
 * A need now (DESIGN §8, §24.8): recorded, or for an NPC the planner plans (an LOD1 agent from Cast
 * life 3) from what their day's plan had them do by then, else from the routine's times.
 */
export function needValue(ctx: ReadContext, who: EntityId, need: string, at = ctx.state.clock): number {
  const recorded = typeof objOf(own(objOf(own(ctx.state.entities, who)?.fields.needs), need)).t === "number";
  const planned = !recorded && livesPlans(ctx, who);
  return needIn(ctx, who, need, at, planned ? dayPlan(ctx, who, dateAt(calendarOf(ctx.world), at).dayIndex).blocks : []);
}

// ---------------------------------------------------------------- planning

function within(dayStart: number, fromH: number, toH: number): { from: number; to: number } {
  return { from: dayStart + fromH * 60, to: dayStart + toH * 60 };
}

/** The planner's option id prefix for an agenda's step: `agenda:<track>`. */
const AGENDA_OPTION = "agenda:";

/** The activity an agenda's step sets; which agenda it is isn't recorded with it. */
const AGENDA_ACTIVITY = "agenda";

/** Whether a track is public: the only agendas the player is shown. */
function publicTrack(world: WorldDoc, track: string): boolean {
  return visibilityOf(own(world.tracks, track)?.visibility) === "public";
}

/**
 * A person's activity as the player and the narrator read it (DESIGN §7): as it is, except an
 * agenda's step. That doesn't say which agenda it is, so it reads "busy" unless every agenda the
 * person has is public: it never says they are pursuing one the player may not know of.
 */
export function shownActivity(ctx: ReadContext, who: EntityId, activity: string): string {
  if (activity !== AGENDA_ACTIVITY) return activity;
  const agendas = agendaFor(ctx.world, ctx.state, who);
  return agendas.length > 0 && agendas.every((a) => publicTrack(ctx.world, a.track)) ? activity : "busy";
}

/**
 * The planner's options for one agent and day: sleep, meals, socializing, leisure, chores, agenda
 * steps and retrievals, shaped by the day's occasion (DESIGN §24.8). A day off makes a slow morning
 * and more time for friends and leisure; a holiday, an observance, their own birthday or a close
 * friend's brings an option of its own; summer draws people out to their time out and winter holds
 * them back from it, at the same place; bad weather keeps them in, with their time out at home.
 */
export function dayOptions(ctx: ReadContext, who: EntityId, dayStart: number): PlanOption[] {
  const level = ctx.levelOf(who, "castlife");
  const home = homeOf(ctx, who);
  const cal = calendarOf(ctx.world);
  const hourOf = (t: number): number => dateAt(cal, t).minuteOfDay / 60;
  // From level 4 needs push options as the day so far leaves them: a meal already laid meets hunger,
  // and a plan that took the lunch hour leaves it unmet.
  const need = (n: string, t: number, laid: readonly PlanBlock[]): number => (level >= 4 ? needIn(ctx, who, n, t, laid) : 0);
  // Reasons name what drives each option: its purpose, the day's occasion, and a need pressing when it's chosen.
  const pressed =
    (n: string, word: string) =>
    (t: number, laid: readonly PlanBlock[]): string[] => {
      const v = need(n, t, laid);
      return v >= 50 ? [`${word} (${n} ${Math.round(v)})`] : [];
    };
  const occasion = occasionOf(ctx, who, dateAt(cal, dayStart).dayIndex);
  const off = occasion.dayOff;
  const company = placeOfType(ctx, "conversation", home) ?? home;
  const outdoors = occasion.foul ? home : (placeOfType(ctx, "exploration", home) ?? home);
  const outside = (occasion.season === "summer" ? 0.5 : occasion.season === "winter" ? -0.5 : 0) - (occasion.foul ? 1 : 0);
  const unwind = [...(off ? ["a day off"] : []), ...(occasion.season === "summer" || occasion.season === "winter" ? [occasion.season] : []), ...(occasion.foul ? ["bad weather"] : [])];
  const options: PlanOption[] = [
    { id: "sleep", label: "Sleep", activity: "sleep", place: home, duration: 480, repeat: true, reasons: ["night"], utility: (t) => (hourOf(t) >= 21.5 || hourOf(t) < 6 ? 10 : 0) },
    { id: "breakfast", label: "Breakfast", activity: "breakfast", place: home, duration: 30, window: off ? within(dayStart, 7, 11) : within(dayStart, 6, 10), utility: (t, laid) => 4 + need("hunger", t, laid) / 20, reasons: off ? ["morning meal", "a slow morning"] : ["morning meal"], because: pressed("hunger", "hungry") },
    { id: "lunch", label: "Lunch", activity: "lunch", place: company, duration: 45, window: within(dayStart, 11, 14), utility: (t, laid) => 4 + need("hunger", t, laid) / 20, reasons: ["midday meal"], because: pressed("hunger", "hungry") },
    { id: "dinner", label: "Dinner", activity: "dinner", place: home, duration: 60, window: within(dayStart, 17, 21), utility: (t, laid) => 4.5 + need("hunger", t, laid) / 20, reasons: ["evening meal"], because: pressed("hunger", "hungry") },
    { id: "leisure", label: "Time out", activity: "leisure", place: outdoors, duration: 60, window: within(dayStart, 9, off ? 22 : 20), utility: (t, laid) => 1.5 + (off ? 1 : 0) + outside + need("fun", t, laid) / 30, reasons: ["unwind", ...unwind], because: pressed("fun", "bored") },
  ];
  const social = optionalQuery(ctx, "regard");
  let fondness = 0;
  if (social) for (const other of Object.keys(ctx.state.entities)) if (other !== who && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, other)?.kind ?? "", "person")) fondness = Math.max(fondness, social(ctx, who, other));
  options.push({ id: "socialize", label: "See friends", activity: "socialize", place: company, duration: 90, window: off ? within(dayStart, 12, 23) : within(dayStart, 17, 22), utility: (t, laid) => 2.5 + (off ? 1 : 0) - (occasion.foul ? 0.5 : 0) + fondness / 50 + need("social", t, laid) / 25, reasons: ["company", ...(fondness >= FOND ? ["a close friend"] : []), ...(off ? ["a day off"] : [])], because: pressed("social", "lonely") });
  const chores = own(ctx.state.entities, who)?.fields.chores;
  if (Array.isArray(chores)) {
    chores.forEach((raw, i) => {
      const c = objOf(raw);
      options.push({ id: `chore:${i}`, label: strOf(c.label, "Chores"), activity: "chores", place: strOf(c.place) || home, duration: numOf(c.minutes, 45), window: within(dayStart, 8, 20), utility: numOf(c.utility, 2), reasons: ["chore"] });
    });
  }
  for (const a of agendaFor(ctx.world, ctx.state, who)) options.push({ id: `${AGENDA_OPTION}${a.track}`, label: a.stageLabel, activity: AGENDA_ACTIVITY, place: home, duration: 60, window: within(dayStart, 9, 20), utility: 1 + a.priority, reasons: [`agenda: ${a.label}`] });
  const overdue = optionalQuery(ctx, "gear.overdue");
  if (overdue) {
    for (const g of overdue(ctx, who)) {
      const where = placeOfEntity(ctx.state, g.borrower) ?? placeOfEntity(ctx.state, g.thing);
      options.push({ id: `retrieve:${g.thing}`, label: `Get ${own(ctx.state.entities, g.thing)?.name ?? g.thing} back from ${own(ctx.state.entities, g.borrower)?.name ?? g.borrower}`, activity: `retrieve:${g.thing}`, place: where, duration: 45, window: within(dayStart, 8, 20), utility: 7, reasons: ["overdue loan"] });
    }
  }
  // The day's own occasions: calendar holidays and observances are public (the Scene line names them).
  for (const h of occasion.holidays) {
    options.push(h.dayOff ? { id: `holiday:${h.id}`, label: h.label, activity: "socialize", place: home, duration: 180, window: within(dayStart, 12, 20), utility: 5.5, reasons: [h.label] } : { id: `holiday:${h.id}`, label: h.label, activity: "leisure", place: company, duration: 90, window: within(dayStart, 17, 22), utility: 3, reasons: [h.label] });
  }
  if (occasion.birthday) options.push({ id: "birthday", label: "Birthday", activity: "socialize", place: company, duration: 150, window: within(dayStart, 17, 23), utility: 6.5, reasons: ["their birthday"] });
  // A close friend's birthday, at their home when it is a place: whose it is stays out of what Cast shows.
  for (const friend of occasion.friends.slice(0, 2)) {
    const theirs = homeOf(ctx, friend);
    options.push({ id: `birthday:${friend}`, label: "A friend's birthday", activity: "socialize", place: theirs !== null && own(ctx.world.places, theirs) ? theirs : company, duration: 90, window: within(dayStart, 17, 22), utility: 4 + (social?.(ctx, who, friend) ?? 0) / 50, reasons: ["a friend's birthday"] });
  }
  return options;
}

export interface DayPlan {
  day: number;
  /** `option` is the planner's option the block came from (`agenda:<track>` for an agenda's step). */
  blocks: { start: number; end: number; option: string; label: string; activity: string; place: PlaceId | null; reasons: string[]; fixed: boolean }[];
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
      return { start: b.start, end: b.end, option: b.option, label: b.label, activity: b.activity, place: b.place, reasons: b.fixed || b.utility <= 0 ? b.reasons : [...b.reasons, `utility ${Math.round(b.utility * 10) / 10}`, ...close], fixed: b.fixed };
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

/**
 * Someone takes up a block of their day (DESIGN §8): its place and its activity, unless a hold keeps
 * either, a fight under way keeps them (the combat pack's `combat.engaged`) or the POV's routine
 * can't take it there (stranded, or the place out of reach). Arriving where the POV is says so. A
 * block of their own plan (`holdUntil`, its end) holds its place and activity for its span, as a
 * trip does, so a routine's schedule edge inside it doesn't take them back (DESIGN §24.8).
 */
function takeUp(ctx: ReadContext, who: EntityId, place: PlaceId | null, activity: string, at: number, holdUntil?: number): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const e = own(ctx.state.entities, who);
  if (!e || routineStays(ctx, who, place) || optionalQuery(ctx, "combat.engaged")?.(ctx, who) === true) return out;
  if (!held(ctx.state, who, "place", at) && place && own(ctx.world.places, place) && placeOfEntity(ctx.state, who) !== place) {
    out.push({ type: "set", entity: who, field: "place", value: place });
    if (who !== ctx.world.pov && place === placeOfEntity(ctx.state, ctx.world.pov)) out.push({ type: ENGINE_EVENTS.signal, data: { class: "arrival", text: `${e.name} arrives.`, entity: who } });
  }
  if (!held(ctx.state, who, "activity", at) && e.fields.activity !== activity) out.push({ type: "set", entity: who, field: "activity", value: activity });
  if (holdUntil !== undefined && holdUntil > at) {
    const holds = objOf(e.fields.holds);
    const kept = { ...holds, place: Math.max(numOf(holds.place, 0), holdUntil), activity: Math.max(numOf(holds.activity, 0), holdUntil) };
    if (kept.place !== holds.place || kept.activity !== holds.activity) out.push({ type: "set", entity: who, field: "holds", value: kept });
  }
  return out;
}

/**
 * A character's plans settled at a slot step (DESIGN §24.8): done once every block laid for one has
 * passed by the slot's end, dropped once its window has with none laid (no time was free in it, a
 * trip took it, or a Background character follows routine only). Each says when it was settled, the
 * end of its last block or of its window, never the clock: catch-up settles it late but alike.
 */
function planOutcomes(ctx: ReadContext, who: EntityId, slot: SlotInfo): LedgerEvent[] {
  if (who === ctx.world.pov) return [];
  const due = (optionalQuery(ctx, "minds.plans")?.(ctx, who) ?? []).filter((p) => p.status === "open" && isPlayed(p) && p.when.from <= slot.end);
  if (due.length === 0) return [];
  const tier = planTier(ctx, who);
  const laid = laidPlans(ctx, who, tier === "background" ? [] : due);
  const out: LedgerEvent[] = [];
  for (const p of due) {
    const blocks = laid.get(p.id) ?? [];
    const last = Math.max(...blocks.map((b) => b.end));
    if (blocks.length > 0 && last <= slot.end) out.push({ type: MINDS_EVENTS.plan, data: { entity: who, plan: p.id, status: "done", at: last, reason: null } });
    else if (blocks.length === 0 && p.when.to <= slot.end) out.push({ type: MINDS_EVENTS.plan, data: { entity: who, plan: p.id, status: "dropped", at: p.when.to, reason: tier === "background" ? "routine only" : "no time for it" } });
  }
  return out;
}

/** How far ahead of a plan with the POV its invitation comes, at most: never before the day it's on, and at the earliest the moment after the plan was made. */
const INVITE_LEAD = 6 * 60;

/** A plan with the POV asking it along: when it asks, and when and where the plan meets. */
interface PlanAsk {
  plan: string;
  ask: number;
  at: number;
  place: PlaceId | null;
}

/** Each of a character's plans with the POV that something was laid for, with when it asks the POV along (DESIGN §24.8). */
function planAsks(ctx: ReadContext, who: EntityId): PlanAsk[] {
  const pov = ctx.world.pov;
  const plans = plansOf(ctx, who).filter((p) => p.with.includes(pov));
  if (plans.length === 0) return [];
  const cal = calendarOf(ctx.world);
  const laid = laidPlans(ctx, who, plans);
  return plans.flatMap((p) => {
    const first = laid.get(p.id)?.[0];
    return first ? [{ plan: p.id, ask: Math.max(first.start - INVITE_LEAD, p.made + 1, clockAt(cal, dateAt(cal, first.start).dayIndex, 0)), at: first.start, place: first.place ?? null }] : [];
  });
}

/**
 * A plan's invitation (DESIGN §24.8), once: the POV asked to where and when the plan meets, under a
 * key naming the plan, while the POV acts. Its text never names a place the POV can't see.
 */
function planInvitation(ctx: ReadContext, who: EntityId, ask: PlanAsk): LedgerEvent[] {
  const key = `${who}:plan:${ask.plan}`;
  const given = sliceOf(ctx.state, "castlife").invitations;
  if (!acts(ctx, ctx.world.pov) || (Array.isArray(given) && given.some((i) => objOf(i).key === key))) return [];
  const text = invitationText(ctx, who, ask.place, ask.at, ctx.world.pov);
  return [{ type: "castlife.invitation", data: { agent: who, place: ask.place, at: ask.at, text, key } }, { type: ENGINE_EVENTS.signal, data: { class: "invitation", text, entity: who } }];
}

/**
 * An agent's moments between slot steps (DESIGN §24.8, `ProcessDef.instants`): each block of their
 * plans starting or ending inside the slot, and from Cast life 4 the moment a plan with the POV asks
 * it along. Laid from the plans and commitments alone, so every segment of a timelapse finds the same.
 */
function planMoments(ctx: ReadContext, who: EntityId, slot: SlotInfo): AgentInstant[] {
  if (plansOf(ctx, who).length === 0) return [];
  const inside = (at: number): boolean => at > slot.start && at < slot.end;
  const out: AgentInstant[] = [];
  for (const c of commitments(ctx, who, slot.start, slot.end)) {
    if (c.plan === undefined) continue;
    if (inside(c.start)) out.push({ at: c.start, key: `start:${c.plan}` });
    if (inside(c.end)) out.push({ at: c.end, key: `end:${c.plan}` });
  }
  if (ctx.levelOf(who, "castlife") >= 4) for (const a of planAsks(ctx, who)) if (inside(a.ask)) out.push({ at: a.ask, key: `invite:${a.plan}` });
  return out;
}

/**
 * What an agent does at a plan moment: the invitation goes out, or they take up the block of their
 * day that holds from then (the plan's own at its start, held for its span; after its end what
 * follows, home when that names no place).
 */
function atPlanMoment(ctx: ReadContext, who: EntityId, moment: AgentInstant): LedgerEvent[] {
  if (moment.key.startsWith("invite:")) {
    const ask = planAsks(ctx, who).find((a) => `invite:${a.plan}` === moment.key);
    return ask ? planInvitation(ctx, who, ask) : [];
  }
  const block = dayPlan(ctx, who, dateAt(calendarOf(ctx.world), moment.at).dayIndex).blocks.find((b) => b.start <= moment.at && moment.at < b.end);
  if (!block) return [];
  return takeUp(ctx, who, block.place ?? (moment.key.startsWith("end:") ? homeOf(ctx, who) : null), block.activity.startsWith("retrieve:") ? "errand" : block.activity, moment.at, block.option.startsWith("plan:") ? block.end : undefined);
}

/** Steps one LOD1 agent through one slot (Cast life ≥ 3): plan the day, live the block, settle their plans, needs, encounters, invitations; nothing for someone who doesn't act. */
function stepAgent(slot: SlotInfo, ctx: ReadContext, rngFor: (entity: EntityId) => Rng, who: EntityId): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const e = own(ctx.state.entities, who);
  if (!e || !acts(ctx, who)) return out;
  const level = ctx.levelOf(who, "castlife");
  const cal = calendarOf(ctx.world);
  // A slot is stepped when it completes: the agent takes up the block that holds from the slot's end.
  const day = dateAt(cal, slot.end).dayIndex;
  const rng = rngFor(who);
  const plan = dayPlan(ctx, who, day);
  const block = plan.blocks.find((b) => b.start <= slot.end && slot.end < b.end) ?? plan.blocks[plan.blocks.length - 1];
  if (!block) return out;
  const pov = ctx.world.pov;
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
  out.push(...takeUp(ctx, who, block.place, block.activity.startsWith("retrieve:") ? "errand" : block.activity, slot.end, block.option.startsWith("plan:") ? block.end : undefined), ...planOutcomes(ctx, who, slot));
  if (level < 4) return out;

  // Needs: only the POV's are recorded (an NPC's follow their day's plan); it gets alerts when it is an agent.
  if (who === pov) {
    for (const need of Object.keys(NEEDS)) {
      if (needValue(ctx, who, need, slot.end) >= NEED_ALERT && needValue(ctx, who, need, slot.start) < NEED_ALERT) out.push({ type: ENGINE_EVENTS.signal, data: { class: "needs", text: `You're getting ${own(NEEDS, need)?.label ?? need}.`, entity: pov } });
    }
    return out;
  }

  // NPC↔NPC encounters: at most one per slot, with someone at the block's place who still acts.
  // Acquaintances (a regard relation either way) meet and their regard moves; strangers sometimes get acquainted.
  const appraise = optionalService(ctx, "relationship.appraise");
  const g = rng.fork("encounters");
  if (appraise && block.place && g.next() < ENCOUNTER_CHANCE) {
    const here = Object.keys(ctx.state.entities)
      .sort()
      .filter((other) => other !== who && other !== pov && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, other)?.kind ?? "", "person") && placeOfEntity(ctx.state, other) === block.place && acts(ctx, other));
    const other = here[Math.floor(g.next() * here.length)];
    if (other) {
      const known = acquainted(ctx.state, who, other);
      const kind = known ? (g.next() < 0.1 ? "argument" : "encounter") : g.next() < ACQUAINT_CHANCE ? "greeting" : null;
      if (kind) out.push(...appraise(ctx, who, other, kind, `${kind} at ${own(ctx.world.places, block.place)?.name ?? block.place}`, true));
    }
  }

  // Invitations come from plans with the POV: at their moment inside a slot, or here when the ask
  // falls on the slot's end or catch-up steps the agent late. The old formula (a fond agent with free
  // evening time, a tie-zone decision) runs only while minds are off.
  for (const a of planAsks(ctx, who)) if (a.ask > slot.start && a.ask <= slot.end) out.push(...planInvitation(ctx, who, a));
  if (optionalQuery(ctx, "minds.on")?.(ctx) === true) return out;
  const regard = optionalQuery(ctx, "regard");
  const hour = dateAt(cal, slot.start).minuteOfDay / 60;
  if (regard && acts(ctx, pov) && !block.fixed && hour >= 12 && hour < 20 && regard(ctx, who, pov) >= 20) {
    const key = `${who}:invite:${slot.index}`;
    const invite = 1 + needValue(ctx, who, "social", slot.start) / 50 + regard(ctx, who, pov) / 50;
    const stay = 2;
    const recorded = own(decisions(ctx.state), key);
    const tie = Math.abs(invite - stay) <= 0.5;
    const choice = recorded ?? (tie ? (rng.fork(key).next() < 0.5 ? "invite" : "stay") : invite > stay ? "invite" : "stay");
    if (tie || recorded) out.push({ type: ENGINE_EVENTS.choice, data: { key, choice, via: recorded ? "recorded" : "seed", agent: who, options: "invite,stay" } });
    if (choice === "invite") {
      const where = block.place ?? placeOfType(ctx, "conversation", homeOf(ctx, who));
      // The invitation is the POV's: its text never names a place the POV can't see.
      const text = invitationText(ctx, who, where, slot.end, pov);
      out.push({ type: "castlife.invitation", data: { agent: who, place: where, at: slot.end, text, key } }, { type: ENGINE_EVENTS.signal, data: { class: "invitation", text, entity: who } });
    }
  }
  return out;
}

/**
 * An invitation as `viewer` reads it: where to meet only when they can see the place, else just "meet
 * up"; with no viewer (the GM's lines, Check world), the place by its own name.
 */
function invitationText(ctx: ReadContext, agent: EntityId, place: PlaceId | null, at: number, viewer?: EntityId): string {
  const named = place !== null && (viewer === undefined || canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, place)) ? (own(ctx.world.places, place)?.name ?? place) : null;
  return `${own(ctx.state.entities, agent)?.name ?? agent} invites you to ${named ?? "meet up"} at ${formatHHMM(dateAt(calendarOf(ctx.world), at).minuteOfDay)}.`;
}

/**
 * Plans of people the planner doesn't live them for (DESIGN §24.8, `livesPlans`): anyone but an LOD1
 * agent from Cast life 3 follows routine only, so each of their plans is dropped once its window has
 * passed, as a Background character's is, with its own time, so a late step settles it alike.
 */
function dropUnlived(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const plans = optionalQuery(ctx, "minds.plans");
  if (!plans) return [];
  const out: LedgerEvent[] = [];
  for (const who of Object.keys(ctx.state.entities).sort()) {
    if (who === ctx.world.pov || livesPlans(ctx, who)) continue;
    for (const p of plans(ctx, who)) if (p.status === "open" && isPlayed(p) && p.when.to <= slot.end) out.push({ type: MINDS_EVENTS.plan, data: { entity: who, plan: p.id, status: "dropped", at: p.when.to, reason: "routine only" } });
  }
  return out;
}

/**
 * Trips and vacations hold people away (LOD0, every person who still acts, Cast life ≥ 1). A slot
 * is stepped when it completes, so a trip under way at the slot's end takes the person away then
 * (once: the hold marks it), and one ending within the slot brings them home. No one in a fight
 * under way leaves for a trip or comes home from one, as no day plan walks them out of it (the
 * combat pack's `combat.engaged`); someone still held away by a trip that has ended (the fight, or a
 * state that didn't act, kept them) comes home at the first slot they can. A trip that is over lets
 * go of its holds, wherever the person is, so a later visit to its place is only a visit.
 */
function stepTrips(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const engaged = optionalQuery(ctx, "combat.engaged");
  for (const who of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, who);
    const trips = e?.fields.trips;
    if (!e || !Array.isArray(trips) || ctx.levelOf(who, "castlife") < 1 || !acts(ctx, who) || engaged?.(ctx, who) === true) continue;
    // The holds as this slot's trips leave them, so one trip letting go never undoes another taking hold.
    let holds = objOf(e.fields.holds);
    for (const raw of trips) {
      const t = objOf(raw);
      const from = numOf(t.from, NaN);
      const until = numOf(t.until, NaN);
      const place = strOf(t.place);
      // The trip took them away and hasn't let go of them yet.
      const holding = objOf(e.fields.holds).place === until;
      const away = holding && e.fields.place === place;
      if (from <= slot.end && slot.end < until && !away && own(ctx.world.places, place)) {
        holds = { ...holds, place: until, activity: until };
        out.push({ type: "set", entity: who, field: "holds", value: holds }, { type: "set", entity: who, field: "place", value: place }, { type: "set", entity: who, field: "activity", value: "trip" });
      }
      if (!(until <= slot.end && (until > slot.start || holding))) continue;
      // Over: home if it ended within the slot, or if it still holds them at its place after slots
      // that couldn't end it (anyone something else took elsewhere meanwhile stays there).
      const home = homeOf(ctx, who);
      if ((until > slot.start || away) && home) out.push({ type: "set", entity: who, field: "place", value: home }, { type: "set", entity: who, field: "activity", value: "idle" });
      // Its holds have run out (they last until it ends), so dropping them changes nothing they hold:
      // it only keeps the trip from taking them for still away the next time they stand at its place.
      const kept = Object.fromEntries(Object.entries(holds).filter(([target, at]) => !((target === "place" || target === "activity") && at === until)));
      if (Object.keys(kept).length < Object.keys(holds).length) {
        holds = kept;
        out.push({ type: "set", entity: who, field: "holds", value: holds });
      }
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
      const v = Math.max(0, Math.min(100, needValue(ctx, strOf(e.data.entity), need, at) + numOf(e.data.delta)));
      who.fields.needs = { ...objOf(who.fields.needs), [need]: { v, t: at } };
    },
    touches: (e) => [{ entity: strOf(e.data.entity), field: "needs" }],
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
      list.push({ agent: strOf(e.data.agent), place: e.data.place ?? null, at: numOf(e.data.at), text: strOf(e.data.text), ...(typeof e.data.key === "string" ? { key: e.data.key } : {}) });
      s.invitations = list;
    },
    describe: (e, ctx, viewer) => invitationText(ctx, strOf(e.data.agent), typeof e.data.place === "string" ? e.data.place : null, numOf(e.data.at), viewer),
  },
];

export interface CastPerson {
  id: EntityId;
  name: string;
  role: string;
  here: boolean;
  activity?: string;
  place?: string;
  /** Someone away: where (when the POV may name the place) and when the POV last saw them. */
  lastSeen?: { place?: string; at: string };
  /** Their life state as the POV knows it (DESIGN §8), when that isn't alive: its label. */
  life?: string;
  regard?: { axis: string; band: string; value?: number }[];
  timeline?: { start: string; end: string; label: string; kind: "work" | "sleep" | "free" | "travel" | "other"; reasons: string[] }[];
  agenda?: { label: string; stage: string }[];
  next?: { at: string; label: string };
  /**
   * For grouping and filters: the person's tier, their values of the facets players can see, and
   * their groups. Hidden facets and tags are authoring data and never reach this view.
   */
  tier: TierId;
  classes: Record<FacetId, FacetValueId[]>;
  /** Every group shown that the person belongs to, directly or through a member group; `role` from a direct membership. */
  groups: { id: EntityId; role?: string }[];
}

/** A group as Cast shows it, with the POV's own membership details when it is one of theirs. */
export interface CastGroup {
  id: EntityId;
  name: string;
  kind: string;
  role?: string;
  rank?: number;
  since?: string;
}

export interface CastView {
  level: number;
  needs: { need: string; value: number; label: string }[];
  people: CastPerson[];
  /** The facets players can see (`shown`), in order, each value with its parent, depth first: Cast groups and filters by them. */
  facets: { id: FacetId; label: string; multiple: boolean; values: { id: FacetValueId; label: string; parent?: FacetValueId }[] }[];
  /** The tiers people are in, in the world's order. */
  tiers: { id: TierId; label: string }[];
  /** Every group shown that someone listed belongs to, by name. */
  groups: CastGroup[];
  /** The groups the POV belongs to, with its role in each. */
  mine: CastGroup[];
}

function kindOfBlock(activity: string): "work" | "sleep" | "free" | "travel" | "other" {
  if (/work|shift|school/.test(activity)) return "work";
  if (activity === "sleep") return "sleep";
  if (activity === "trip" || activity === "travel") return "travel";
  if (/leisure|socialize|idle|breakfast|lunch|dinner/.test(activity)) return "free";
  return "other";
}

/**
 * Play → Cast (DESIGN §7, §12): the people the POV knows (`playerKnows`) and anyone it can see here.
 * Someone here shows what they are doing and, with LOD1, their day; someone away shows only where
 * and when the POV last saw them, never where they are now or what they plan. A life state shows as
 * the POV knows it, and someone it knows doesn't act shows no doing or day. Fields follow field
 * visibility, and agendas show only when public: each agenda on its own, so a secret one never
 * shows behind a public one, and a block of the day spent on one that isn't public reads as busy.
 */
export function buildCastView(ctx: ReadContext): CastView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "castlife");
  const cal = calendarOf(ctx.world);
  const here = placeOfEntity(ctx.state, pov);
  const view = optionalQuery(ctx, "relationships.view");
  // Who the POV can see: the groups shown, and the people present (the shared rules, `isGone` included).
  const shown = (id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id);
  const groupIds = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => isGroup(ctx.registry, ctx.world, ctx.state, id) && shown(id));
  const membershipsOf = (who: EntityId): { id: EntityId; role?: string; rank?: number; since?: string }[] =>
    groupIds
      .filter((g) => isMemberOf(ctx.state, who, g))
      .map((g) => {
        const direct = objOf(own(ctx.state.entities, who)?.relations.find((r) => r.type === MEMBER_OF && r.to === g)?.fields);
        return { id: g, ...(typeof direct.role === "string" && direct.role !== "" ? { role: direct.role } : {}), ...(typeof direct.rank === "number" ? { rank: direct.rank } : {}), ...(typeof direct.since === "string" ? { since: direct.since } : {}) };
      });
  const facets = facetsInOrder(ctx.world).filter(([, f]) => f.shown === true);
  const people: CastPerson[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || id === pov || !kindIs(ctx.registry, ctx.world, e.kind, "person") || isGone(ctx.state, id)) continue;
    const place = placeOfEntity(ctx.state, id);
    const present = place !== null && place === here;
    if (!(present ? shown(id) : playerKnows(ctx.registry, ctx.world, ctx.state, pov, id))) continue;
    const classes: Record<FacetId, FacetValueId[]> = {};
    for (const [facet] of facets) {
      const values = classValues(ctx.world, ctx.state, id, facet);
      if (values.length > 0) classes[facet] = [...values];
    }
    const sees = (field: string): boolean => canSeeField(ctx.registry, ctx.world, ctx.state, pov, id, field);
    const role = sees("role") ? strOf(e.fields.role) : "";
    const p: CastPerson = {
      id,
      name: e.name,
      role: role !== "" ? role : sees("occupation") ? strOf(e.fields.occupation).replace(/_/g, " ") : "",
      here: present,
      tier: e.tier,
      classes,
      groups: membershipsOf(id).map((m) => ({ id: m.id, ...(m.role !== undefined ? { role: m.role } : {}) })),
    };
    const life = povLife(ctx.world, ctx.state, id);
    if (life) p.life = life.label;
    const still = life !== null && !life.acts;
    if (present) {
      if (typeof e.fields.activity === "string" && sees("activity") && !still) p.activity = shownActivity(ctx, id, e.fields.activity).replace(/_/g, " ");
      // Someone here is where the POV is: a place it can't see is named as every player surface names it.
      if (sees("place")) p.place = canSeePlace(ctx.registry, ctx.world, ctx.state, pov, place) ? (own(ctx.world.places, place)?.name ?? place) : HIDDEN_PLACE_NAME;
    } else if (level >= 2) {
      const last = lastSighting(ctx.state, id);
      if (last) p.lastSeen = { ...(canSeePlace(ctx.registry, ctx.world, ctx.state, pov, last.place) ? { place: own(ctx.world.places, last.place)?.name ?? last.place } : {}), at: formatClock(cal, last.at) };
    }
    const regard = view ? view(ctx, id, pov) : [];
    if (regard.length > 0) p.regard = regard;
    const plan = present && e.agent && !still ? dayPlan(ctx, id) : null;
    const blocks = plan?.blocks.map((b) => (b.option.startsWith(AGENDA_OPTION) && !publicTrack(ctx.world, b.option.slice(AGENDA_OPTION.length)) ? { ...b, label: "Busy", reasons: ["their own business"] } : b));
    if (blocks && level >= 3) p.timeline = blocks.map((b) => ({ start: formatHHMM(dateAt(cal, b.start).minuteOfDay), end: formatHHMM(dateAt(cal, b.end).minuteOfDay), label: b.label, kind: kindOfBlock(b.activity), reasons: b.reasons }));
    const agenda = agendaFor(ctx.world, ctx.state, id).filter((a) => publicTrack(ctx.world, a.track));
    if (agenda.length > 0) p.agenda = agenda.map((a) => ({ label: a.label, stage: a.stageLabel }));
    const next = blocks?.find((b) => b.start > ctx.state.clock);
    if (next) p.next = { at: formatClock(cal, next.start), label: next.label };
    people.push(p);
  }
  const needs = level >= 4 ? Object.entries(NEEDS).map(([need, def]) => ({ need, value: Math.round(needValue(ctx, pov, need)), label: def.label })) : [];
  const group = (id: EntityId): CastGroup => {
    const g = own(ctx.state.entities, id);
    return { id, name: g?.name ?? id, kind: kindDef(ctx.registry, ctx.world, g?.kind ?? "")?.label ?? g?.kind ?? "" };
  };
  const listed = new Set(people.flatMap((p) => p.groups.map((m) => m.id)));
  const byName = (a: CastGroup, b: CastGroup): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const tierIds = new Set(people.map((p) => p.tier));
  const tiers = [...tiersInOrder(ctx.world).map(([id]) => id).filter((id) => tierIds.has(id)), ...[...tierIds].filter((id) => !tierOf(ctx.world, id)).sort()];
  return {
    level,
    needs,
    people,
    facets: facets.map(([id, f]) => ({ id, label: f.label, multiple: f.multiple === true, values: facetTree(f.values).map((v) => ({ id: v.id, label: v.value.label, ...(v.value.parent !== undefined ? { parent: v.value.parent } : {}) })) })),
    tiers: tiers.map((id) => ({ id, label: tierLabel(ctx.world, id) })),
    groups: groupIds.filter((g) => listed.has(g)).map(group).sort(byName),
    mine: membershipsOf(pov)
      .map((m) => ({ ...group(m.id), ...(m.role !== undefined ? { role: m.role } : {}), ...(m.rank !== undefined ? { rank: m.rank } : {}), ...(m.since !== undefined ? { since: m.since } : {}) }))
      .sort(byName),
  };
}

// ---------------------------------------------------------------- the Stance section

/**
 * Whether someone acts (DESIGN §6.6, §8): still in the world and in a life state that acts. The one
 * test Cast life reads, so encounters, trips, day-plan ties and the Stance section agree: someone who
 * doesn't act has no stance to tell, and a body the POV knows of reads through the people lines.
 */
export function acts(ctx: ReadContext, who: EntityId): boolean {
  return !isGone(ctx.state, who) && lifeActs(ctx.world, ctx.state, who);
}

/** "Label: one; two." Clauses as one sentence: whitespace collapsed, each without its own full stop. */
function listed(label: string, clauses: readonly string[]): string {
  const body = clauses.map((c) => c.replace(/\s+/g, " ").trim().replace(/[.;]$/, "")).join("; ");
  return `${label}: ${body}${/[.!?…]$/.test(body) ? "" : "."}`;
}

/**
 * The block of today's plan that `who`'s own recorded choice settled (`npc.choose`, or an author's
 * `castlife.decide`), the one under way or the next, named as Cast names the day: a block of an
 * agenda that isn't public is "Busy". Null when no such block is left today.
 */
function decidedBlock(ctx: ReadContext, who: EntityId): string | null {
  const cal = calendarOf(ctx.world);
  const plan = dayPlan(ctx, who);
  const dayStart = clockAt(cal, plan.day, 0);
  const chosen = new Set(plan.ties.filter((t) => t.via === "recorded").map((t) => t.key));
  const block = plan.blocks.find((b) => b.end > ctx.state.clock && chosen.has(tieKey(who, dayStart, b.start)));
  if (!block) return null;
  const label = block.option.startsWith(AGENDA_OPTION) && !publicTrack(ctx.world, block.option.slice(AGENDA_OPTION.length)) ? "Busy" : block.label;
  return block.start <= ctx.state.clock ? label : `${label} at ${formatHHMM(dateAt(cal, block.start).minuteOfDay)}`;
}

/**
 * Who the Stance section tells of (DESIGN §6.6): everyone at the POV's place it can see who acts, in
 * id order, and the test each piece about them passes: no unrevealed secret, nothing hidden named.
 * The test is built on its first use, so a renderer with nothing to check never pays for it.
 */
function stanceCast(ctx: ReadContext): { people: EntityId[]; safe: (text: string) => boolean } {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const here = placeOfEntity(state, pov);
  // Who acts as far as the POV knows, as People and Cast read it: a body it hasn't found reads as them.
  // A character the Minds section tells of this turn has no Stance line (DESIGN §24.3): their mind says it.
  const minded = new Set(optionalQuery(ctx, "minds.minded")?.(ctx) ?? []);
  const people = here === null ? [] : Object.keys(state.entities).sort().filter((id) => id !== pov && placeOfEntity(state, id) === here && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && canSeeEntity(reg, world, state, pov, id) && !isGone(state, id) && povLife(world, state, id)?.acts !== false && !minded.has(id));
  let check: ((text: string) => boolean) | null = null;
  const safe = (text: string): boolean => {
    if (!check) {
      const secrets = unrevealedSecrets(reg, world, state);
      const namesHidden = hiddenNameCheck(reg, world, state, pov);
      check = (t) => findLeaks(t, secrets).length === 0 && !namesHidden(t);
    }
    return check(text);
  };
  return { people, safe };
}

/**
 * The Stance section's own lines (DESIGN §6.6): for each person it tells of, what they know of the
 * POV and what they are about. Each piece that would carry an unrevealed secret or name something
 * the POV can't see is left out on its own.
 */
export function stanceLines(ctx: ReadContext): string[] {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const { people, safe } = stanceCast(ctx);
  const regard = optionalQuery(ctx, "relationships.words");
  const lines: string[] = [];
  for (const id of people) {
    const e = own(state.entities, id);
    if (!e) continue;
    // Nobody regards a stranger: regard toward the POV is knowing it as much as a `knows` relation.
    const known = knows(state, id, pov) || e.relations.some((r) => r.type === "regard" && r.to === pov);
    const words = regard?.(ctx, id, pov) ?? null;
    const parts = [`${e.name} ${known ? "knows" : "doesn't know"} you${words ? `; regard: ${words}` : ""}.`];
    const activity = canSeeField(reg, world, state, pov, id, "activity") ? e.fields.activity : undefined;
    const doing = typeof activity === "string" && activity !== "idle" ? shownActivity(ctx, id, activity).replace(/_/g, " ") : "";
    if (doing !== "" && safe(doing)) parts.push(listed("Doing", [doing]));
    // A public agenda's current stage, in its cue's words where the author wrote one, else its label as Cast shows it.
    const agenda = agendaFor(world, state, id)
      .filter((a) => publicTrack(world, a.track))
      .map((a) => {
        const track = own(world.tracks, a.track);
        const cue = track ? own(track.stages, a.stage)?.cue?.trim() : undefined;
        return cue ? cue : a.stageLabel;
      })
      .filter(safe);
    if (agenda.length > 0) parts.push(listed("Agenda", agenda));
    const decided = e.agent && ctx.levelOf(id, "castlife") >= 3 ? decidedBlock(ctx, id) : null;
    if (decided !== null && safe(decided)) parts.push(listed("Decided", [decided]));
    lines.push(parts.join(" "));
  }
  return lines;
}

/**
 * The Stance section's hints (DESIGN §6.6): a line of cues for each person it tells of who has any
 * kept. They follow what the POV doesn't know, so they ride last on the section budget (`hint`).
 */
export function stanceCues(ctx: ReadContext): string[] {
  const { people, safe } = stanceCast(ctx);
  return people.flatMap((id) => {
    const cues = cuesFor(ctx, id, safe);
    return cues.length > 0 ? [listed(`${own(ctx.state.entities, id)?.name ?? id}'s cues`, cues)] : [];
  });
}

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Ties the planner left to the seed and invitations not yet decided: inputs for `npc.choose`. */
    "castlife.tie_zones": (ctx: ReadContext) => { key: string; agent: EntityId; options: string[] }[];
    /** A person's activity as the player and the narrator read it: an agenda's step reads "busy" unless all their agendas are public (`shownActivity`). */
    "castlife.activity": (ctx: ReadContext, who: EntityId, activity: string) => string;
    /** The blocks a person is committed to in [start, end), after every cut (a trip, a plan of their own, a more specific schedule): what they will actually be doing. */
    "castlife.commitments": (ctx: ReadContext, who: EntityId, start: number, end: number) => CommitmentBlock[];
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
    r.process({ id: "castlife.agents", domain: "castlife", minLevel: 3, scope: "agent", step: (slot, ctx, rng, agent) => (agent ? stepAgent(slot, ctx, rng, agent) : []), instants: planMoments, atInstant: atPlanMoment });
    r.process({ id: "castlife.trips", domain: "castlife", minLevel: 1, step: (slot, ctx) => stepTrips(slot, ctx) });
    // Whatever the level: a plan nothing lives is still settled.
    r.process({ id: "castlife.plans", domain: "castlife", minLevel: 0, step: (slot, ctx) => dropUnlived(slot, ctx) });
    r.query("castlife.activity", shownActivity);
    r.query("castlife.commitments", (ctx, who, start, end) => commitments(ctx, who, start, end).map((c) => ({ start: c.start, end: c.end, activity: c.activity, place: c.place ?? null, kind: c.kind, label: c.label, ...(c.plan !== undefined ? { plan: c.plan } : {}) })));
    r.query("castlife.tie_zones", (ctx) => {
      const out: { key: string; agent: EntityId; options: string[] }[] = [];
      const decided = decisions(ctx.state);
      for (const id of Object.keys(ctx.state.entities).sort()) {
        const plan = own(ctx.state.entities, id)?.agent && acts(ctx, id) ? dayPlan(ctx, id) : null;
        for (const t of plan?.ties ?? []) if (t.via === "seed" && !own(decided, t.key)) out.push({ key: t.key, agent: id, options: t.options });
      }
      return out;
    });
    // An invitation from `host` still open: its meeting time is at most 3 hours past and at most a day
    // ahead, from a host the POV doesn't know to have stopped acting.
    r.formula("invited", (ctx, host) => {
      if (povLife(ctx.world, ctx.state, String(host ?? ""))?.acts === false) return false;
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

    r.effect({ type: "castlife.satisfy", args: ["need", "entity?"], resolve: (a, ctx) => { const who = strOf(a.entity) || ctx.world.pov; const need = strOf(a.need); const v = needValue(ctx, who, need); return own(NEEDS, need) && v > 0 ? [{ type: "castlife.need", data: { entity: who, need, delta: -v, at: ctx.state.clock } }] : []; } });
    r.effect({ type: "castlife.decide", args: ["key", "choice"], resolve: (a) => [{ type: "castlife.decision", data: { key: strOf(a.key), choice: strOf(a.choice) } }] });
    r.effect({
      type: "castlife.override",
      args: ["who", "minutes?", "place?", "activity?"],
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
          if (!e || id === pov || !here || placeOfEntity(ctx.state, id) !== here || !kindIs(ctx.registry, ctx.world, e.kind, "person") || isGone(ctx.state, id)) continue;
          // The narrator is told only who the POV can see: a secret or unknown person stays out of the prose.
          if (!canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id)) continue;
          // What they are doing is a field: told only when the POV may see it. A life state the POV
          // knows reads instead ("lies dead"); one it doesn't know of is never told.
          const life = povLife(ctx.world, ctx.state, id);
          const act = canSeeField(ctx.registry, ctx.world, ctx.state, pov, id, "activity") ? e.fields.activity : undefined;
          lines.push(life ? `${e.name} ${life.reads}.` : `${e.name}${typeof act === "string" && act !== "idle" ? ` (${shownActivity(ctx, id, act).replace(/_/g, " ")})` : ""} is here.`);
        }
        if (ctx.levelOf(pov, "castlife") >= 4) {
          const urgent = Object.entries(NEEDS).filter(([n]) => needValue(ctx, pov, n) >= 60).map(([, d]) => d.label);
          if (urgent.length > 0) lines.push(`You feel ${urgent.join(" and ")}.`);
        }
        return lines;
      },
    });
    r.view({ panel: "castlife.cast", build: (ctx) => buildCastView(ctx) as unknown as JsonValue });
    r.renderer({ slot: "stance", render: stanceLines });
    r.renderer({ slot: "stance", hint: true, render: stanceCues });
    r.lint({ code: "castlife.cues", check: cueIssues });
    // A birthday the planner can't read is no occasion: say so where it is written.
    r.lint({
      code: "castlife.birthday",
      check: (world) => {
        const cal = calendarOf(world);
        return Object.values(world.entities).flatMap((e) =>
          e.fields.birthday === undefined || e.fields.birthday === null || birthdayOf(cal, e.fields.birthday) ? [] : [{ severity: "warning" as const, code: "castlife.birthday", message: `${e.name}'s birthday doesn't read as a date of the world's calendar: write it MM-DD, or YYYY-MM-DD with the year they were born.`, path: `entities.${e.id}.fields.birthday` }],
        );
      },
    });

    // Two schedules setting the same field of the same person at once are the engine's
    // `schedule_overlap`; this rule covers what a schedule can't express: dated appointments and trips.
    r.lint({
      code: "castlife.double_booking",
      check(world) {
        const issues = [];
        for (const e of Object.values(world.entities)) {
          const owned = Object.values(world.schedules).filter((s) => s.owner === e.id && s.target === "activity");
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
