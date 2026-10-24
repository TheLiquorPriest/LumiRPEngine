// Cast life pack (DESIGN §8, §9.3, §24.8): commitments (jobs, school terms and timetables,
// appointments, trips and vacations, and each character's own plans), routines, chores, needs and
// drives, agendas, the day planner, off-screen LOD1 execution, NPC↔NPC encounters and invitations,
// and the narrator's Stance section (§6.6): how the people with the POV stand toward it, what they
// are about, and the cues for their secrets.
//
// Commitments are what the planner treats as fixed blocks (`commitments.ts`): activity schedules
// (shifts, school timetables; terms are recurrence `from`/`until`), the person fields `appointments`
// [{at, minutes, place, label}] and `trips` [{from, until, place, label}], and the open plans a
// character's memory or the GM recorded (`minds.plans`), laid into their windows. Around them a
// person's routine (`routines.ts`: the world's routines, the chat's own changes, the basic needs)
// fills the day, with their chores [{label, minutes, place?, utility?}], agendas and overdue loans.
// Nothing else does: no outing, gathering or invitation that nothing in the world or the story
// grounds. Needs live in `needs` {name: {v, t}} for the POV; an NPC's are read from their day's plan.
// What the story established always wins over a routine (`routineYields`).
//
// Level contract (domain `castlife`, read at each person):
//   0  off
//   1  day-part routines (schedules) and agendas as tracks; trips hold people away
//   2  commitments set the day
//   3  the day planner lays whole days for LOD1 agents from their routines (seeded tie-breaks,
//      recorded ties), with their own plans at their times
//   4  needs and drives, invitations, NPC↔NPC encounters (regard through relationship.appraise)

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId, TierId } from "../../../shared/ids";
import { facetsInOrder, facetTree } from "../../../shared/classes";
import { MINDS_EVENTS } from "../../../shared/minds";
import { tierLabel, tierOf, tiersInOrder } from "../../../shared/tiers";
import type { FacetId, FacetValueId, FeedScope, ScheduleDef, WorldDoc } from "../../../shared/world";
import { initialState, minutesBetween } from "../../../engine/world-state";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { calendarOf, clockAt, dateAt, formatClock, formatHHMM, formatTimeOfDay, MINUTES_PER_DAY, parseHHMM } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { labelOf, mutableSlice, numOf, objOf, optionalQuery, optionalService, sliceOf, sliceRecord, strOf, own } from "../../../engine/pack-kit";
import { planDay, tieKey, type FixedBlock, type PlanBlock, type PlanOption } from "../../../engine/plan-day";
import type { AgentInstant, EventTypeDef, FeedLine, PackDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import type { PlayerBlock, RoutineEditOp, RoutineSociability, SkipBlock } from "../../../shared/routines";
import { BASIC_BLOCKS, blockShapeProblems, isOff, ROUTINE_AWARENESS, ROUTINE_EVENTS, ROUTINE_MODES, ROUTINE_ROLES, routineSettingsOf, SKIP_LIVES } from "../../../shared/routines";
import { createRng, type Rng } from "../../../engine/rng";
import { hashParts } from "../../../shared/hash";
import { allSchedules, routineStays, scheduleInstants, scheduleOwners } from "../../../engine/schedules";
import { fieldDef, isGone, kindDef, kindIs, placeOfEntity } from "../../../engine/scope";
import { povLead, together } from "../../../engine/presence";
import { relocate } from "../../../engine/relocate";
import { acts as lifeActs, povLife } from "../../../engine/life";
import { classValues, isGroup, isMemberOf, MEMBER_OF, selectEntities } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { agendaFor } from "../../../engine/tracks";
import { lastSighting } from "../../../engine/seen";
import { hiddenNameCheck, playerKnows } from "../../../engine/player-events";
import { canSeeEntity, canSeeField, canSeePlace, findLeaks, HIDDEN_PLACE_NAME, knows, loreGateReader, unrevealedSecrets, visibilityOf } from "../../../engine/visibility";
import { loreReadable } from "../../../engine/lore";
import { commitments, isPlayed, laidPlans, livesPlans, planTier, plansOf, type CommitmentBlock } from "./commitments";
import { cueIssues, cuesFor } from "./cues";
import { birthdayOf, FOND, occasionOf } from "./occasions";
import { homeOf, placeOfType } from "./places";
import { activeBlocks, blockOnDay, blockPlace, chatScheduleDefs, followOf, ROUTINE_OPTION, routineDay, routineLived, routineRole, routinesLint, routineYields, scheduleOff, schedulesLint, skipLifeOf, skipPlanOf, withPov, worldRoutines } from "./routines";
import { ROUTINE_EFFECT, routineChannel, storyEvents } from "./story";
import { usualRoutineHints } from "./usual";

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

/** How fast the social and fun needs grow for each sociability (DESIGN §8): half as fast, as they are, half again. */
const SOCIABILITY_RATE: Record<RoutineSociability, number> = { reserved: 0.5, usual: 1, outgoing: 1.5 };

/** A need's growth per hour for someone: the world's sociability sets an NPC's social and fun needs; the POV's are its own. */
function rateOf(ctx: ReadContext, who: EntityId, need: string, rate: number): number {
  return who === ctx.world.pov || (need !== "social" && need !== "fun") ? rate : rate * SOCIABILITY_RATE[routineSettingsOf(ctx.world).sociability];
}

/**
 * A need at `at` given the blocks of the person's day: from its recorded anchor `{v, t}` (the POV's
 * starts at 20 at the world's start); else from when those blocks last met it (the end of the latest
 * satisfying block begun by then, or `at` while they're in it), else from the routine's last time.
 */
function needIn(ctx: ReadContext, who: EntityId, need: string, at: number, blocks: readonly Pick<PlanBlock, "start" | "end" | "activity">[]): number {
  const def = own(NEEDS, need);
  if (!def) return 0;
  const rate = rateOf(ctx, who, need, def.rate);
  const n = objOf(own(objOf(own(ctx.state.entities, who)?.fields.needs), need));
  if (typeof n.t === "number" || who === ctx.world.pov) {
    const v = numOf(n.v, 20);
    const t = numOf(n.t, minutesBetween(ctx.world.calendar.epoch, ctx.world.start.at));
    return Math.max(0, Math.min(100, v + (rate * Math.max(0, at - t)) / 60));
  }
  let met = -Infinity;
  for (const b of blocks) if (b.start <= at && satisfies(b.activity, need)) met = Math.max(met, Math.min(b.end, at));
  if (met === -Infinity) {
    const minute = dateAt(calendarOf(ctx.world), at).minuteOfDay;
    met = at - Math.min(...def.daily.map((t) => (minute - t + MINUTES_PER_DAY) % MINUTES_PER_DAY));
  }
  return Math.min(100, (rate * (at - met)) / 60);
}

/**
 * A need now (DESIGN §8, §24.8): recorded, or for an NPC the planner plans (an LOD1 agent from Cast
 * life 3) from what their day's plan had them do by then, else from the routine's times. `legacy`
 * reads the day as the template of earlier builds laid it: only to fold a `castlife.need` event they
 * recorded without the value it started from, so an older chat folds as it did.
 */
export function needValue(ctx: ReadContext, who: EntityId, need: string, at = ctx.state.clock, legacy = false): number {
  const recorded = typeof objOf(own(objOf(own(ctx.state.entities, who)?.fields.needs), need)).t === "number";
  const planned = !recorded && livesPlans(ctx, who);
  const day = dateAt(calendarOf(ctx.world), at).dayIndex;
  return needIn(ctx, who, need, at, planned ? (legacy ? legacyDayPlan(ctx, who, day) : dayPlan(ctx, who, day)).blocks : []);
}

// ---------------------------------------------------------------- planning

function within(dayStart: number, fromH: number, toH: number): { from: number; to: number } {
  return { from: dayStart + fromH * 60, to: dayStart + toH * 60 };
}

/** The planner's option id prefix for an agenda's step: `agenda:<track>`. */
const AGENDA_OPTION = "agenda:";

/** The activity an agenda's step sets; which agenda it is isn't recorded with it. */
const AGENDA_ACTIVITY = "agenda";

/** The option id prefix for the block a host's invitation lays in a guest's day: `invited:<host>:<block>`. */
const INVITED_OPTION = "invited:";

/** Whether a track is public: the only agendas the player is shown. */
function publicTrack(world: WorldDoc, track: string): boolean {
  return visibilityOf(own(world.tracks, track)?.visibility) === "public";
}

/**
 * A person's activity as the player and the narrator read it (DESIGN §7): as it is, except an
 * agenda's step or a private block of their routine. An agenda's step doesn't say which agenda it is,
 * so it reads "busy" unless every agenda the person has is public: it never says they are pursuing
 * one the player may not know of; a private routine block's activity always reads "busy".
 */
export function shownActivity(ctx: ReadContext, who: EntityId, activity: string): string {
  if (activity !== AGENDA_ACTIVITY) return activeBlocks(ctx, who).some((a) => a.block.private === true && a.block.activity === activity) ? "busy" : activity;
  const agendas = agendaFor(ctx.world, ctx.state, who);
  return agendas.length > 0 && agendas.every((a) => publicTrack(ctx.world, a.track)) ? activity : "busy";
}

/**
 * The planner's options besides someone's routine, each grounded in the world or the story: their own
 * chores (authored), the steps of their agendas (story tracks), and getting back a thing an overdue
 * loan keeps from them.
 */
function groundedOptions(ctx: ReadContext, who: EntityId, dayStart: number): PlanOption[] {
  const home = homeOf(ctx, who);
  const options: PlanOption[] = [];
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
  return options;
}

/**
 * The day template earlier builds planned every agent's day from, story or no story: sleep, meals,
 * seeing friends and time out, holidays and birthdays, shaped by the day's occasion. It plans no new
 * day: it is kept only so a `castlife.need` event an earlier build recorded, without the value it
 * started from, folds as it did (`needValue` with `legacy`), which reads that day as it was laid then.
 */
export function legacyDayOptions(ctx: ReadContext, who: EntityId, dayStart: number): PlanOption[] {
  const level = ctx.levelOf(who, "castlife");
  const home = homeOf(ctx, who);
  const cal = calendarOf(ctx.world);
  const hourOf = (t: number): number => dateAt(cal, t).minuteOfDay / 60;
  const need = (n: string, t: number, laid: readonly PlanBlock[]): number => (level >= 4 ? needIn(ctx, who, n, t, laid) : 0);
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
  options.push(...groundedOptions(ctx, who, dayStart));
  for (const h of occasion.holidays) {
    options.push(h.dayOff ? { id: `holiday:${h.id}`, label: h.label, activity: "socialize", place: home, duration: 180, window: within(dayStart, 12, 20), utility: 5.5, reasons: [h.label] } : { id: `holiday:${h.id}`, label: h.label, activity: "leisure", place: company, duration: 90, window: within(dayStart, 17, 22), utility: 3, reasons: [h.label] });
  }
  if (occasion.birthday) options.push({ id: "birthday", label: "Birthday", activity: "socialize", place: company, duration: 150, window: within(dayStart, 17, 23), utility: 6.5, reasons: ["their birthday"] });
  for (const friend of occasion.friends.slice(0, 2)) {
    const theirs = homeOf(ctx, friend);
    options.push({ id: `birthday:${friend}`, label: "A friend's birthday", activity: "socialize", place: theirs !== null && own(ctx.world.places, theirs) ? theirs : company, duration: 90, window: within(dayStart, 17, 22), utility: 4 + (social?.(ctx, who, friend) ?? 0) / 50, reasons: ["a friend's birthday"] });
  }
  return options;
}

/**
 * The blocks invitations lay in a guest's day (DESIGN §8, with invitations between everyone): each
 * fixed block of someone's routine that asks its company along, on that day, with the guest among
 * its company, when the guest knows the host and follows their routine with invitations, cut around
 * the guest's commitments. Only an enforced routine asks anyone along: an informative one moves no
 * one, so its host wouldn't be there.
 */
function invitedBlocks(ctx: ReadContext, guest: EntityId, day: number, commitments: readonly FixedBlock[]): FixedBlock[] {
  if (routineSettingsOf(ctx.world).invitations !== "everyone" || followOf(ctx, guest).mode !== "follows" || guest === ctx.world.pov) return [];
  const cal = calendarOf(ctx.world);
  const start = clockAt(cal, day, 0);
  const hosts = new Set<EntityId>();
  for (const def of worldRoutines(ctx.world)) if (def.blocks.some((b) => !isOff(b) && b.company?.invite === true)) for (const who of Object.keys(ctx.state.entities).sort()) hosts.add(who);
  const out: FixedBlock[] = [];
  for (const host of [...hosts].sort()) {
    if (host === guest || !acquainted(ctx.state, host, guest) || followOf(ctx, host).mode !== "follows" || routineRole(ctx, host) !== "enforced") continue;
    for (const { block } of activeBlocks(ctx, host, day)) {
      if (block.kind !== "fixed" || block.company?.invite !== true || !selectEntities(ctx.registry, ctx.world, ctx.state, block.company.who).includes(guest) || !blockOnDay(ctx, host, block, day)) continue;
      const s = start + parseHHMM(block.at ?? "00:00");
      const e = s + block.minutes;
      if (commitments.some((c) => c.start < e && c.end > s)) continue;
      out.push({ start: s, end: e, label: block.label, activity: block.activity, place: blockPlace(ctx, host, block), reason: "invited", option: `${INVITED_OPTION}${host}:${block.id}` });
    }
  }
  return out;
}

export interface DayPlan {
  day: number;
  /** `option` is the planner's option the block came from (`routine:<block>`, `plan:<plan>`, `agenda:<track>` for an agenda's step, `invited:<host>:<block>`). */
  blocks: { start: number; end: number; option: string; label: string; activity: string; place: PlaceId | null; reasons: string[]; fixed: boolean }[];
  ties: { key: string; chosen: string; via: string; options: string[] }[];
  tieZone: boolean;
}

function decisions(state: Readonly<WorldState>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(objOf(sliceOf(state, "castlife").decisions))) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * Plans a day (DESIGN §8, §24.8): commitments fixed (schedules, appointments, trips, story plans),
 * then the fixed blocks of their routine and blocks invitations lay, then the flexible and optional
 * ones and what the world grounds (chores, agendas, overdue loans) by utility in the free time; ties
 * use a recorded `npc.choose` decision, else the seed. Only a person has a routine. `legacy` lays the
 * day from the template of earlier builds instead (`legacyDayOptions`), for folding what they recorded.
 */
export function planFor(ctx: ReadContext, who: EntityId, day: number, rng: Rng, legacy = false): DayPlan {
  const cal = calendarOf(ctx.world);
  const start = clockAt(cal, day, 0);
  const end = start + MINUTES_PER_DAY;
  const fixed = commitments(ctx, who, start, end);
  const person = kindIs(ctx.registry, ctx.world, own(ctx.state.entities, who)?.kind ?? "", "person");
  const level = ctx.levelOf(who, "castlife");
  const routine = !legacy && person ? routineDay(ctx, who, day, fixed, { need: (n, t, laid) => (level >= 4 ? needIn(ctx, who, n, t, laid) : 0), meets: (activity) => Object.keys(NEEDS).filter((n) => satisfies(activity, n)) }) : { fixed: [], options: [] };
  const invited = legacy || !person ? [] : invitedBlocks(ctx, who, day, [...fixed, ...routine.fixed]);
  const options = legacy ? legacyDayOptions(ctx, who, start) : [...routine.options, ...groundedOptions(ctx, who, start)];
  const plan = planDay({ agent: who, start, end, fixed: [...fixed, ...routine.fixed, ...invited], options, rng, recorded: decisions(ctx.state) });
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

/** A day as the template of earlier builds laid it, with the same seed: only for folding what they recorded (`needValue` with `legacy`). */
function legacyDayPlan(ctx: ReadContext, who: EntityId, day: number): DayPlan {
  return planFor(ctx, who, day, createRng(hashParts("castlife.plan", ctx.world.id, who, String(day))), true);
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
 * Someone takes up a block of their day (DESIGN §8): its place and its activity (null leaves either
 * as it is), unless a hold keeps either, a fight under way keeps them (the combat pack's
 * `combat.engaged`) or the POV's routine can't take it there (stranded, or the place out of reach).
 * Arriving where the POV is says so; `quiet`, it only notes, as an arrival a Live or Near character's
 * routine makes in a skip never stops it. `seen`, a block of their skip life taking them out of the
 * POV's scene: the POV sees them go, a note the Montage tells. A block of their own plan (`holdUntil`,
 * its end) holds its place and activity for its span, as a trip does, so a routine's schedule edge
 * inside it doesn't take them back (DESIGN §24.8).
 */
function takeUp(ctx: ReadContext, who: EntityId, place: PlaceId | null, activity: string | null, at: number, holdUntil?: number, quiet = false, seen = false): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const e = own(ctx.state.entities, who);
  if (!e || routineStays(ctx, who, place) || optionalQuery(ctx, "combat.engaged")?.(ctx, who) === true) return out;
  if (!held(ctx.state, who, "place", at) && place && own(ctx.world.places, place) && placeOfEntity(ctx.state, who) !== place) {
    // Seen as their arrival is: by a POV that can see them, whether or not it holds a `knows` link to them.
    if (seen && withPov(ctx, who)) out.push({ type: ENGINE_EVENTS.note, data: { text: `${e.name} leaves.`, entity: who, visibility: "public" } });
    out.push(...movesOf(relocate(ctx, who, place)));
    if (who !== ctx.world.pov && place === placeOfEntity(ctx.state, ctx.world.pov)) out.push({ type: ENGINE_EVENTS.signal, data: { class: "arrival", text: `${e.name} arrives.`, entity: who, ...(quiet ? { stops: false } : {}) } });
  }
  if (activity !== null && !held(ctx.state, who, "activity", at) && e.fields.activity !== activity) out.push({ type: "set", entity: who, field: "activity", value: activity });
  if (holdUntil !== undefined && holdUntil > at) {
    const holds = objOf(e.fields.holds);
    const kept = { ...holds, place: Math.max(numOf(holds.place, 0), holdUntil), activity: Math.max(numOf(holds.activity, 0), holdUntil) };
    if (kept.place !== holds.place || kept.activity !== holds.activity) out.push({ type: "set", entity: who, field: "holds", value: kept });
  }
  return out;
}

/** A move's events through the one move path (`relocate`); someone the world doesn't have moves nowhere. */
function movesOf(moved: LedgerEvent[] | Rejection): LedgerEvent[] {
  return "code" in moved ? [] : moved;
}

/** The activity a block sets: an overdue loan's retrieval is an errand. */
function blockActivity(activity: string): string {
  return activity.startsWith("retrieve:") ? "errand" : activity;
}

/**
 * Someone lives the block of their day that holds from `at` (DESIGN §8): what the story established
 * wins over it. A block of their own plan (the story's) moves them unless they're in a scene with the
 * POV. Any other block of their day (their routine, their schedules, the basic needs, what the world
 * grounds) moves only someone whose routine is lived now (`routineLived`: enforced, or informative in
 * a skip they spend on it, `skip`): for anyone else it is context only. It moves them at its own start (`edge`), as `routineYields` decides against
 * where their routine had them since the step before (`from`): on an edge, every block from the one
 * that held at `from` (the day before's, across midnight) to the one before this one, since the
 * blocks between were lived at their own moments in a timelapse, or not at all in a catch-up; between
 * the block's own edges, this block and the one before it. A block that names no place, after one
 * that did, takes them home, as a plan's end does. Going to bed is where balanced awareness hands the
 * day back to the routine. A scene with the POV holds them only while the story holds the POV
 * (`scene`, `SlotInfo.povRoutine` false); while time runs on its own, there's none.
 */
function liveBlock(ctx: ReadContext, who: EntityId, plan: DayPlan, block: DayPlan["blocks"][number], from: number, at: number, scene: boolean, skip: boolean): LedgerEvent[] {
  const activity = blockActivity(block.activity);
  if (block.option.startsWith("plan:")) return scene && withPov(ctx, who) ? [] : takeUp(ctx, who, block.place, activity, at, block.end);
  if (who !== ctx.world.pov && !routineLived(ctx, who, skip)) return [];
  const edge = block.start > from && block.start <= at;
  const index = plan.blocks.indexOf(block);
  const earlier = from < clockAt(calendarOf(ctx.world), plan.day, 0) ? [...dayPlan(ctx, who, plan.day - 1).blocks, ...plan.blocks.slice(0, index)] : plan.blocks.slice(0, index);
  const had = (edge ? earlier.filter((b) => b.end > from) : [...earlier.slice(-1), block]).reverse();
  const e = own(ctx.state.entities, who);
  const home = homeOf(ctx, who);
  // A place or activity any of those blocks set is the routine's own; anything else, the story's. So is
  // home after free time (which takes them there), and resting after a schedule (whose end returns them to rest).
  const rests = had.some((b) => b.option.startsWith("schedule:"));
  const places = [...had.flatMap((b) => (b.place !== null ? [b.place] : [])), ...(home !== null && (rests || had.some((b) => b.place === null)) ? [home] : [])];
  const resting = rests && e ? fieldDef(ctx.registry, ctx.world, e.kind, "activity")?.default : undefined;
  const doings = [...had.map((b) => blockActivity(b.activity)), ...(typeof resting === "string" ? [resting] : [])];
  const wasPlace = places.find((p) => p === e?.fields.place) ?? places[0] ?? [...earlier].reverse().find((b) => b.place !== null)?.place ?? home;
  const wasDoing = doings.find((d) => d === e?.fields.activity) ?? doings[0] ?? null;
  const target = block.place ?? (edge && earlier.at(-1)?.place ? home : null);
  const opts = { edge, release: block.activity === "sleep", scene, skip };
  const place = target !== null && !routineYields(ctx, who, "place", wasPlace, opts) ? target : null;
  const doing = routineYields(ctx, who, "activity", wasDoing, opts) ? null : activity;
  // A routine never stops a skip for the cast the story is about, nor for anyone it moves only in a
  // skip: their arrival only notes, and the POV sees the latter go from its scene (DESIGN §8 skip lives).
  const skipLife = skip && who !== ctx.world.pov && routineRole(ctx, who) !== "enforced";
  const tier = skip && place !== null ? (optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? "background") : "background";
  return takeUp(ctx, who, place, doing, at, undefined, tier === "live" || tier === "near" || skipLife, skipLife);
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
  const routineOnly = tier === "background" && followOf(ctx, who).awareness !== "story_first";
  const laid = laidPlans(ctx, who, routineOnly ? [] : due);
  const out: LedgerEvent[] = [];
  for (const p of due) {
    const blocks = laid.get(p.id) ?? [];
    const last = Math.max(...blocks.map((b) => b.end));
    if (blocks.length > 0 && last <= slot.end) out.push({ type: MINDS_EVENTS.plan, data: { entity: who, plan: p.id, status: "done", at: last, reason: null } });
    else if (blocks.length === 0 && p.when.to <= slot.end) out.push({ type: MINDS_EVENTS.plan, data: { entity: who, plan: p.id, status: "dropped", at: p.when.to, reason: routineOnly ? "routine only" : "no time for it" } });
  }
  return out;
}

/** How far ahead of a plan with the POV its invitation comes, at most: never before the day it's on, and at the earliest the moment after the plan was made. */
const INVITE_LEAD = 6 * 60;

/** Something that asks the POV along: when it asks, and when and where it meets, under a key naming it once. */
export interface Ask {
  key: string;
  ask: number;
  at: number;
  place: PlaceId | null;
  origin: { type: "plan"; plan: string } | { type: "routine"; block: string };
}

/**
 * Whether `host` may ask the POV along to `place` now (DESIGN §8): only on a ground (an ask is one),
 * and never from the cast the story is about (Live and Near characters: their minds and the scene
 * speak for them, so nothing interrupts play for them), from someone with the POV already, from
 * someone the chat set to make no invitations, to a POV that doesn't act, is held away, or is where
 * they'd meet, nor between people who don't know each other or where the host regards the POV badly.
 */
function mayInvite(ctx: ReadContext, host: EntityId, place: PlaceId | null): boolean {
  const pov = ctx.world.pov;
  if (followOf(ctx, host).mode !== "follows" || withPov(ctx, host) || !acts(ctx, pov)) return false;
  const tier = optionalQuery(ctx, "minds.tier")?.(ctx, host) ?? "background";
  if (tier === "live" || tier === "near") return false;
  if (held(ctx.state, pov, "place", ctx.state.clock) || (place !== null && placeOfEntity(ctx.state, pov) === place)) return false;
  if (!acquainted(ctx.state, host, pov) && !knows(ctx.state, host, pov)) return false;
  return (optionalQuery(ctx, "regard")?.(ctx, host, pov) ?? 0) >= 0;
}

/**
 * Everything of a character's that asks the POV along (DESIGN §8, §24.8): each of their plans with
 * the POV that something was laid for, and, while their routine is enforced (an informative one moves
 * no one, so they wouldn't be there), from their routine each block on `days` that asks its company
 * along with the POV among it, while the world's invitations reach the player. Each asks at most 6
 * hours ahead, never before the day it's on, and a plan never before the moment after it was made.
 */
export function asksOf(ctx: ReadContext, who: EntityId, days: readonly number[]): Ask[] {
  const pov = ctx.world.pov;
  const cal = calendarOf(ctx.world);
  const out: Ask[] = [];
  const plans = plansOf(ctx, who).filter((p) => p.with.includes(pov));
  if (plans.length > 0) {
    const laid = laidPlans(ctx, who, plans);
    for (const p of plans) {
      const first = laid.get(p.id)?.[0];
      // A plan everyone in it shares asks once, whoever in it asks first: its key names the plan alone.
      if (first) out.push({ key: p.shared === true ? `plan:${p.id}` : `${who}:plan:${p.id}`, ask: Math.max(first.start - INVITE_LEAD, p.made + 1, clockAt(cal, dateAt(cal, first.start).dayIndex, 0)), at: first.start, place: first.place ?? null, origin: { type: "plan", plan: p.id } });
    }
  }
  if (routineSettingsOf(ctx.world).invitations === "off" || followOf(ctx, who).mode !== "follows" || routineRole(ctx, who) !== "enforced") return out;
  const asking = activeBlocks(ctx, who).filter(({ block }) => block.company?.invite === true && selectEntities(ctx.registry, ctx.world, ctx.state, block.company.who).includes(pov));
  if (asking.length === 0) return out;
  for (const day of days) {
    for (const b of dayPlan(ctx, who, day).blocks) {
      const id = b.option.startsWith(ROUTINE_OPTION) ? b.option.slice(ROUTINE_OPTION.length) : null;
      if (id === null || !asking.some((a) => a.block.id === id)) continue;
      out.push({ key: `${who}:routine:${id}:${day}`, ask: Math.max(b.start - INVITE_LEAD, clockAt(cal, day, 0)), at: b.start, place: b.place, origin: { type: "routine", block: id } });
    }
  }
  return out;
}

/** The days a slot touches, for the asks inside it. */
function slotDays(ctx: ReadContext, slot: SlotInfo): number[] {
  const cal = calendarOf(ctx.world);
  const first = dateAt(cal, slot.start).dayIndex;
  const last = dateAt(cal, slot.end).dayIndex;
  return first === last ? [first] : [first, last];
}

/**
 * An ask's invitation (DESIGN §8, §24.8), once: the POV asked to where and when it meets, under its
 * key, when the host may invite (`mayInvite`) at that moment. Its text never names a place the POV
 * can't see.
 */
function invitation(ctx: ReadContext, who: EntityId, ask: Ask): LedgerEvent[] {
  const given = sliceOf(ctx.state, "castlife").invitations;
  if (!mayInvite(ctx, who, ask.place) || (Array.isArray(given) && given.some((i) => objOf(i).key === ask.key))) return [];
  const text = invitationText(ctx, who, ask.place, ask.at, ctx.world.pov);
  return [{ type: "castlife.invitation", data: { agent: who, place: ask.place, at: ask.at, text, key: ask.key, origin: ask.origin.type === "plan" ? `plan:${ask.origin.plan}` : `routine:${ask.origin.block}` } }, { type: ENGINE_EVENTS.signal, data: { class: "invitation", text, entity: who } }];
}

/**
 * The invitations to the POV still open (`invited`): the meeting at most 3 hours past and at most a
 * day ahead, from a host the POV doesn't know to have stopped acting.
 */
function openInvitations(ctx: ReadContext): JsonObject[] {
  const list = sliceOf(ctx.state, "castlife").invitations;
  const now = ctx.state.clock;
  return (Array.isArray(list) ? list : []).map(objOf).filter((inv) => {
    const at = numOf(inv.at);
    return povLife(ctx.world, ctx.state, strOf(inv.agent))?.acts !== false && at >= now - 180 && at <= now + MINUTES_PER_DAY;
  });
}

/**
 * Accepting `host`'s open invitation books it (DESIGN §8, §24.8): an appointment in the POV's day at
 * the meeting's time, for as long as the host's own block for it lasts (an hour when it can't be
 * found), with everyone in the plan that asked (the host alone for a routine's), under the
 * invitation's key, so accepting it again books nothing more. Its place only when the POV can see
 * it, so its day never takes it somewhere it doesn't know of; its label names only the host, never
 * a plan's words, which stay the character's own.
 */
function bookInvitation(ctx: ReadContext, host: EntityId): LedgerEvent[] {
  const pov = ctx.world.pov;
  const inv = openInvitations(ctx).findLast((i) => strOf(i.agent) === host);
  const e = own(ctx.state.entities, pov);
  if (!inv || !e) return [];
  const at = numOf(inv.at);
  const key = strOf(inv.key) || `${host}:${at}`;
  const booked = Array.isArray(e.fields.appointments) ? e.fields.appointments : [];
  if (booked.some((a) => objOf(a).invitation === key)) return [];
  const origin = strOf(inv.origin);
  const plan = origin.startsWith("plan:") ? (optionalQuery(ctx, "minds.plans")?.(ctx, host) ?? []).find((p) => `plan:${p.id}` === origin) : undefined;
  const cal = calendarOf(ctx.world);
  const blocks = plan ? (laidPlans(ctx, host, [plan]).get(plan.id) ?? []) : dayPlan(ctx, host, dateAt(cal, at).dayIndex).blocks;
  const end = blocks.find((b) => b.start === at)?.end;
  const place = typeof inv.place === "string" && own(ctx.world.places, inv.place) && canSeePlace(ctx.registry, ctx.world, ctx.state, pov, inv.place) ? inv.place : null;
  const people = [...new Set([host, ...(plan?.with ?? [])])].filter((id) => id !== pov);
  const appointment: JsonObject = { at, minutes: end !== undefined && end > at ? end - at : 60, ...(place ? { place } : {}), label: `With ${own(ctx.state.entities, host)?.name ?? host}`, with: people, invitation: key };
  return [{ type: "set", entity: pov, field: "appointments", value: [...booked, appointment] }];
}

/**
 * An agent's moments between slot steps (DESIGN §8, §24.8, `ProcessDef.instants`): each block of
 * their plans starting or ending inside the slot; while their routine is lived (`routineLived`), the
 * start of every other block of their day inside it, so a fixed block happens at its time and dinner
 * at dinner time, unless a plan's end hands them to it or it is a trip (`stepTrips` takes them away);
 * in a skip the model planned for them, the start of each block of their skip life (`skipBlocksOf`:
 * the plan's, and the basic needs filling the time it leaves open); and from
 * Cast life 4 the moment something of theirs asks the POV along. The POV's day only while its routine
 * runs (`SlotInfo.povRoutine`). Laid from the plans, the routine, the commitments and the recorded
 * skip plan alone, so every segment of a timelapse finds the same.
 */
function planMoments(ctx: ReadContext, who: EntityId, slot: SlotInfo): AgentInstant[] {
  const inside = (at: number): boolean => at > slot.start && at < slot.end;
  const out: AgentInstant[] = [];
  if (plansOf(ctx, who).length > 0) {
    for (const c of commitments(ctx, who, slot.start, slot.end)) {
      if (c.plan === undefined) continue;
      if (inside(c.start)) out.push({ at: c.start, key: `start:${c.plan}` });
      if (inside(c.end)) out.push({ at: c.end, key: `end:${c.plan}` });
    }
  }
  const from = skipPlanOf(ctx.state)?.from;
  for (const b of skipBlocksOf(ctx, who, slot)) {
    // A block already under way as the skip starts is taken up at its start (`opens`), not at the slot's step.
    if (from !== undefined && b.start <= from && from < b.end) {
      if (from >= slot.start && from < slot.end) out.push({ at: from, key: `skip:${b.start}`, opens: true });
    } else if (inside(b.start)) out.push({ at: b.start, key: `skip:${b.start}` });
  }
  if (who === ctx.world.pov ? slot.povRoutine !== false : routineLived(ctx, who, slot.timelapse === true)) {
    const cal = calendarOf(ctx.world);
    const handed = new Set(out.flatMap((m) => (m.key.startsWith("end:") ? [m.at] : [])));
    const lived = livedAtMinute(ctx, who, slot);
    const home = homeOf(ctx, who);
    // Where they are as each block starts: where they are now, then each block's place, and home in
    // free time after a block with one (`liveBlock`).
    let before = placeOfEntity(ctx.state, who);
    let placed = false;
    for (let day = dateAt(cal, slot.start).dayIndex; day <= dateAt(cal, slot.end - 1).dayIndex; day++) {
      for (const b of dayPlan(ctx, who, day).blocks) {
        if (!inside(b.start)) continue;
        if (!b.option.startsWith("plan:") && b.activity !== "trip" && !handed.has(b.start) && lived(b, before)) out.push({ at: b.start, key: `block:${b.option}` });
        before = b.place ?? (placed ? home : before);
        placed = b.place !== null;
      }
    }
  }
  if (ctx.levelOf(who, "castlife") >= 4) for (const a of asksOf(ctx, who, slotDays(ctx, slot))) if (inside(a.ask)) out.push({ at: a.ask, key: `invite:${a.key}` });
  return out;
}

/** Whether someone lives every block of their day at its own minute in this slot: in a turn, everyone; in a Timelapse, the POV and the Live, Near and Far cast. */
function livesEveryBlock(ctx: ReadContext, who: EntityId, slot: SlotInfo): boolean {
  return slot.timelapse !== true || who === ctx.world.pov || (optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? "background") !== "background";
}

/**
 * Which blocks of someone's day starting inside a slot they live at their own minute (DESIGN §8,
 * observable fidelity): every one, if they live every block (`livesEveryBlock`); otherwise only where
 * the POV could see it, meeting them where the block takes them while it lasts or seeing them leave
 * (`before`, where they were). An off-screen Background agent in a Timelapse otherwise lives the day
 * at slot steps only, as net state, so a skip spends no events on what no one sees.
 */
function livedAtMinute(ctx: ReadContext, who: EntityId, slot: SlotInfo): (block: DayPlan["blocks"][number], before: PlaceId | null) => boolean {
  if (livesEveryBlock(ctx, who, slot)) return () => true;
  const pov = ctx.world.pov;
  const here = placeOfEntity(ctx.state, pov);
  const home = homeOf(ctx, pov) ?? here;
  const cal = calendarOf(ctx.world);
  const plans = new Map<number, DayPlan>();
  const planOf = (day: number): DayPlan => {
    const plan = plans.get(day) ?? dayPlan(ctx, pov, day);
    plans.set(day, plan);
    return plan;
  };
  // Where the POV is over part of the slot: where the story holds it, else where its own day has it
  // (free time after a block with a place takes it home, as `liveBlock` lives it).
  const povAt = (from: number, to: number): Set<PlaceId> => {
    const out = new Set<PlaceId>();
    if (slot.povRoutine === false) {
      if (here !== null) out.add(here);
      return out;
    }
    for (let day = dateAt(cal, from).dayIndex; day <= dateAt(cal, to - 1).dayIndex; day++) {
      const blocks = planOf(day).blocks;
      blocks.forEach((b, i) => {
        if (b.end <= from || b.start >= to) return;
        const place = b.place ?? (blocks.slice(0, i).some((x) => x.place !== null) ? home : here);
        if (place !== null) out.add(place);
      });
    }
    return out;
  };
  // Lived at its minute where the POV could meet them there while it lasts, or sees them leave.
  return (block, before) => (block.place !== null && povAt(block.start, block.end).has(block.place)) || (before !== null && povAt(block.start, block.start + 1).has(before));
}

/** A block someone lives in a skip the model planned for them (DESIGN §8): one of its blocks, or a basic need or rest in time none covers (`place` null: where they are). */
type SkipLived = Pick<SkipBlock, "start" | "end" | "activity"> & { place: PlaceId | null };

/** The basic need (`BASIC_BLOCKS`) a day plan's block is, by its id: laid as `routine:<id>`, a night's sleep past midnight as `routine:<id>:carried`; null for any other block. */
function basicNeedOf(option: string): string | null {
  const id = option.startsWith(ROUTINE_OPTION) ? option.slice(ROUTINE_OPTION.length).replace(/:carried$/, "") : null;
  return BASIC_BLOCKS.some((b) => b.id === id) ? id : null;
}

/**
 * The blocks someone lives in this slot's skip while they spend skips as the model plans (DESIGN §8):
 * the recorded plan's blocks for them (`castlife.skip_plan`) and, in every minute of its span that no
 * planned block covers (between its blocks; all of it for someone it left out, or when its call failed),
 * their basic needs as their day lays them (sleep at home at night, their meals; one laid at work where
 * they are, since the floor never sends anyone to work), at rest after one
 * until the next block. Nothing else of their routine: basic needs are the floor, and they go home to
 * sleep on their own, so a plan never has to name a home the POV may not know. None outside a skip or
 * its span, or for anyone else. Laid for the slot's own days, which is all a slot looks up.
 */
function skipBlocksOf(ctx: ReadContext, who: EntityId, slot: SlotInfo): readonly SkipLived[] {
  if (slot.timelapse !== true || skipLifeOf(ctx, who) !== "model") return [];
  const plan = skipPlanOf(ctx.state);
  if (!plan) return [];
  const planned = plan.plans.find((p) => p.entity === who)?.blocks ?? [];
  const lo = Math.max(slot.start, plan.from);
  const hi = Math.min(slot.end, plan.to);
  if (lo > hi) return planned;
  // Part of [start, end) inside the span that no planned block covers.
  const open = (start: number, end: number): [number, number][] => {
    let pieces: [number, number][] = [[Math.max(start, plan.from), Math.min(end, plan.to)]];
    for (const b of planned) pieces = pieces.flatMap(([s, e]): [number, number][] => (b.end <= s || b.start >= e ? [[s, e]] : [...(s < b.start ? [[s, b.start] as [number, number]] : []), ...(b.end < e ? [[b.end, e] as [number, number]] : [])]));
    return pieces.filter(([s, e]) => s < e);
  };
  const cal = calendarOf(ctx.world);
  const basic: SkipLived[] = [];
  for (let day = dateAt(cal, lo).dayIndex; day <= dateAt(cal, hi).dayIndex; day++) {
    const atWork = activeBlocks(ctx, who, day).flatMap(({ block }) => (block.place === "work" ? [block.id] : []));
    for (const b of dayPlan(ctx, who, day).blocks) {
      const need = basicNeedOf(b.option);
      if (need === null) continue;
      for (const [start, end] of open(b.start, b.end)) basic.push({ start, end, place: atWork.includes(need) ? null : b.place, activity: b.activity });
    }
  }
  // After a basic need, at rest where it left them until the next block (planned or basic), as after a story plan.
  const rest = fieldDef(ctx.registry, ctx.world, own(ctx.state.entities, who)?.kind ?? "", "activity")?.default;
  const starts = [...planned, ...basic].map((b) => b.start);
  const resting =
    typeof rest !== "string"
      ? []
      : basic.flatMap((b): SkipLived[] => {
          const next = Math.min(plan.to, ...starts.filter((s) => s >= b.end));
          return next > b.end ? [{ start: b.end, end: next, place: null, activity: rest }] : [];
        });
  return [...planned, ...basic, ...resting];
}

/**
 * Someone takes up a block of their skip life (DESIGN §8: the model's, or a basic need filling time it
 * left open), as an enforced routine's block is taken up: not while a story plan, a trip or an
 * appointment of theirs holds the moment, nor against the GM's intent. Being their skip life's, it may
 * take them out of the scene the story holds with the POV, which sees them go (a note the Montage
 * tells), and back: their arrival where the POV is only notes.
 */
function liveSkipBlock(ctx: ReadContext, who: EntityId, block: SkipLived, at: number): LedgerEvent[] {
  if (commitments(ctx, who, at, at + 1).some((c) => c.kind === "plan" || c.kind === "trip" || c.kind === "appointment")) return [];
  if (optionalQuery(ctx, "minds.intent")?.(ctx, who) === true) return [];
  return takeUp(ctx, who, block.place, block.activity, at, undefined, true, true);
}

/**
 * What an agent does at a moment: the invitation goes out; at a block of their day starting, they
 * live it as a slot step would (`liveBlock`, so the story still comes first); at a block the model
 * planned for their skip starting, they take it up (`liveSkipBlock`); or at their own plan's start or
 * end they take up the block of their day that holds from then (the plan's own, held for its span;
 * after its end what follows, home when that names no place), unless they are in a scene with the POV
 * while the story holds the POV (`SlotInfo.povRoutine` false), which in a skip only a story plan's
 * block is held to. Someone whose routine isn't lived takes up only their plans: after one they take
 * up the skip's planned block holding then, if any, else stay where it left them, at rest, until the
 * story moves them.
 */
function atPlanMoment(ctx: ReadContext, who: EntityId, moment: AgentInstant, slot: SlotInfo): LedgerEvent[] {
  const cal = calendarOf(ctx.world);
  if (moment.key.startsWith("invite:")) {
    const ask = asksOf(ctx, who, [dateAt(cal, moment.at).dayIndex, dateAt(cal, moment.at).dayIndex + 1]).find((a) => `invite:${a.key}` === moment.key);
    return ask ? invitation(ctx, who, ask) : [];
  }
  const scene = slot.povRoutine === false;
  const planned = skipBlocksOf(ctx, who, slot);
  if (moment.key.startsWith("skip:")) {
    const starting = planned.find((b) => `skip:${b.start}` === moment.key);
    return starting ? liveSkipBlock(ctx, who, starting, moment.at) : [];
  }
  const plan = dayPlan(ctx, who, dateAt(cal, moment.at).dayIndex);
  if (moment.key.startsWith("block:")) {
    const starting = plan.blocks.find((b) => b.start === moment.at);
    // Someone who lives only the blocks the POV could see lived none since the slot's step but those:
    // the routine had them anywhere since then, as a slot step reads it.
    const from = livesEveryBlock(ctx, who, slot) ? moment.at - 1 : slot.start;
    return starting ? liveBlock(ctx, who, plan, starting, from, moment.at, scene, slot.timelapse === true) : [];
  }
  const block = plan.blocks.find((b) => b.start <= moment.at && moment.at < b.end);
  if (!block) return [];
  const skipLife = slot.timelapse === true && who !== ctx.world.pov && routineRole(ctx, who) !== "enforced" && !block.option.startsWith("plan:");
  if (scene && withPov(ctx, who) && !skipLife) return [];
  if (who !== ctx.world.pov && !block.option.startsWith("plan:") && !routineLived(ctx, who, slot.timelapse === true)) {
    const holding = planned.find((b) => b.start <= moment.at && moment.at < b.end);
    if (holding) return liveSkipBlock(ctx, who, holding, moment.at);
    if (scene && withPov(ctx, who)) return [];
    const rest = fieldDef(ctx.registry, ctx.world, own(ctx.state.entities, who)?.kind ?? "", "activity")?.default;
    return takeUp(ctx, who, null, typeof rest === "string" ? rest : null, moment.at);
  }
  return takeUp(ctx, who, block.place ?? (moment.key.startsWith("end:") ? homeOf(ctx, who) : null), blockActivity(block.activity), moment.at, block.option.startsWith("plan:") ? block.end : undefined, skipLife, skipLife);
}

/**
 * Steps one LOD1 agent through one slot (Cast life ≥ 3): plan the day, live the block (the POV only
 * while its routine runs: `SlotInfo.povRoutine`), settle their plans, needs, encounters and
 * invitations; nothing for someone who doesn't act.
 */
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
  if (who !== pov || slot.povRoutine !== false) out.push(...liveBlock(ctx, who, plan, block, slot.start, slot.end, slot.povRoutine === false, slot.timelapse === true));
  // In a skip the model planned for them, the planned block holding from the slot's end (taken up at its start already, unless something held them then).
  const planned = skipBlocksOf(ctx, who, slot).find((b) => b.start <= slot.end && slot.end < b.end);
  if (planned) out.push(...liveSkipBlock(ctx, who, planned, slot.end));
  out.push(...planOutcomes(ctx, who, slot));
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

  // Invitations come only on a ground (a plan with the POV, a routine block that asks it along): at
  // their moment inside a slot, or here when the ask falls on the slot's end or catch-up steps the
  // agent late. Nothing asks the POV along for company's sake alone.
  for (const a of asksOf(ctx, who, slotDays(ctx, slot))) if (a.ask > slot.start && a.ask <= slot.end) out.push(...invitation(ctx, who, a));
  return out;
}

/**
 * An invitation as `viewer` reads it: where to meet only when they can see the place, else just "meet
 * up"; with no viewer (the GM's lines, Check world), the place by its own name.
 */
export function invitationText(ctx: ReadContext, agent: EntityId, place: PlaceId | null, at: number, viewer?: EntityId): string {
  const named = place !== null && (viewer === undefined || canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, place)) ? (own(ctx.world.places, place)?.name ?? place) : null;
  return `${own(ctx.state.entities, agent)?.name ?? agent} invites you to ${named ?? "meet up"} at ${formatTimeOfDay(dateAt(calendarOf(ctx.world), at).minuteOfDay)}.`;
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
      // A trip doesn't take anyone out of a scene with the POV while the story holds the POV (DESIGN
      // §8): they leave once the scene lets them go. In a timelapse the POV's routine runs in, they go.
      if (from <= slot.end && slot.end < until && !away && own(ctx.world.places, place) && !(slot.povRoutine === false && withPov(ctx, who))) {
        holds = { ...holds, place: until, activity: until };
        out.push({ type: "set", entity: who, field: "holds", value: holds }, ...movesOf(relocate(ctx, who, place)), { type: "set", entity: who, field: "activity", value: "trip" });
      }
      if (!(until <= slot.end && (until > slot.start || holding))) continue;
      // Nor does its end take anyone out of a scene the story holds with the POV: they stay, held by
      // the trip, and go home once the scene lets them go (DESIGN §8).
      if (slot.povRoutine === false && withPov(ctx, who)) continue;
      // Over: home if it ended within the slot, or if it still holds them at its place after slots
      // that couldn't end it (anyone something else took elsewhere meanwhile stays there).
      const home = homeOf(ctx, who);
      if ((until > slot.start || away) && home) out.push(...movesOf(relocate(ctx, who, home)), { type: "set", entity: who, field: "activity", value: "idle" });
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

/** A chat's own source as an event carries it: the GM's or the story's, with its time (the story's, said by the player when `by` says so). */
function isChatSource(v: JsonValue | undefined): boolean {
  const o = objOf(v);
  return typeof o.at === "number" && (o.type === "gm" || (o.type === "story" && (o.turn === undefined || typeof o.turn === "string") && (o.by === undefined || o.by === "player")));
}

/** A schedule change as an event carries it: off (until a time or for good), or their own slots with an optional recurrence. */
function isScheduleChange(v: JsonValue | undefined): boolean {
  const o = objOf(v);
  if (o.off === true) return o.until === null || typeof o.until === "number";
  const time = /^([01]\d|2[0-4]):[0-5]\d$/;
  return Array.isArray(o.slots) && o.slots.length > 0 && o.slots.every((s) => typeof objOf(s).start === "string" && time.test(strOf(objOf(s).start)) && time.test(strOf(objOf(s).end))) && (o.recurrence === undefined || typeof objOf(o.recurrence).every === "string");
}

/** Whose a chat change is, for the GM's lines: a player's line never tells of one (DESIGN §8, §24.9). */
function changeLine(ctx: ReadContext, e: PackEvent, viewer: EntityId | undefined, what: string): string {
  return viewer !== undefined ? "" : `${own(ctx.state.entities, strOf(e.data.entity))?.name ?? strOf(e.data.entity)}: ${what} (${objOf(e.data.source).type === "story" ? "the story" : "GM"})`;
}

const EVENTS: EventTypeDef<PackEvent>[] = [
  {
    type: "castlife.need",
    validate: (e, ctx) => (own(ctx.state.entities, strOf(e.data.entity)) && own(NEEDS, strOf(e.data.need)) && typeof e.data.delta === "number" ? null : { code: "bad_event", reason: "need needs an entity, a known need and a delta" }),
    // The need it started from rides with it (`from`), so the fold reads no day plan; an event an
    // earlier build recorded without it reads the day as that build laid it, so it folds as it did.
    apply: (e, state, ctx) => {
      const who = own(state.entities, strOf(e.data.entity));
      if (!who) return;
      const at = numOf(e.data.at, state.clock);
      const need = strOf(e.data.need);
      const from = typeof e.data.from === "number" ? e.data.from : needValue(ctx, strOf(e.data.entity), need, at, true);
      const v = Math.max(0, Math.min(100, from + numOf(e.data.delta)));
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
      list.push({ agent: strOf(e.data.agent), place: e.data.place ?? null, at: numOf(e.data.at), text: strOf(e.data.text), ...(typeof e.data.key === "string" ? { key: e.data.key } : {}), ...(typeof e.data.origin === "string" ? { origin: e.data.origin } : {}) });
      s.invitations = list;
    },
    describe: (e, ctx, viewer) => invitationText(ctx, strOf(e.data.agent), typeof e.data.place === "string" ? e.data.place : null, numOf(e.data.at), viewer),
  },
  {
    // How someone follows their routine in this chat (`routine_follow`), set whole; null clears it.
    // An earlier build's event has no role or skip life: it folds as it did, with none.
    type: ROUTINE_EVENTS.follow,
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, strOf(e.data.entity))) return { code: "missing_entity", reason: "a routine setting names someone in the world" };
      const f = e.data.follow;
      if (f === null) return null;
      const o = objOf(f);
      const mode = o.mode === null || ROUTINE_MODES.some((m) => m === o.mode);
      const awareness = o.awareness === null || ROUTINE_AWARENESS.some((a) => a === o.awareness);
      const role = o.role === undefined || o.role === null || ROUTINE_ROLES.some((r) => r === o.role);
      const skips = o.skips === undefined || o.skips === null || SKIP_LIVES.some((s) => s === o.skips);
      const some = o.mode !== null || o.awareness !== null || (o.role !== undefined && o.role !== null) || (o.skips !== undefined && o.skips !== null);
      return mode && awareness && role && skips && some ? null : { code: "bad_event", reason: "a routine setting is a mode, an awareness, a role, a skip life or some of them, or null to clear it" };
    },
    apply: (e, state) => {
      const follow = sliceRecord(state, "castlife", "follow");
      const who = strOf(e.data.entity);
      const f = objOf(e.data.follow);
      if (e.data.follow === null) delete follow[who];
      else follow[who] = { mode: f.mode ?? null, awareness: f.awareness ?? null, ...(f.role !== undefined ? { role: f.role } : {}), ...(f.skips !== undefined ? { skips: f.skips } : {}) };
    },
    describe: (e, ctx, viewer) => changeLine(ctx, e, viewer, e.data.follow === null ? "routine setting cleared" : `routine: ${[objOf(e.data.follow).mode, objOf(e.data.follow).awareness, objOf(e.data.follow).role, objOf(e.data.follow).skips].filter((x) => typeof x === "string").join(", ").replace(/_/g, " ")}`),
  },
  {
    // The model's plan for a time skip (DESIGN §8), recorded in the turn ahead of the timelapse it
    // plans and kept whole, so a replay, or a Continue inside its span, reads it and never asks again.
    // Only a well-formed plan is kept: people in the world, each block inside its span at a place the world has.
    type: ROUTINE_EVENTS.skipPlan,
    validate: (e, ctx) => {
      const { from, to, plans, note } = e.data;
      if (typeof from !== "number" || typeof to !== "number" || from >= to || !Array.isArray(plans) || (note !== undefined && typeof note !== "string")) return { code: "bad_event", reason: "a skip plan has its span, its plans and an optional note" };
      const block = (raw: JsonValue): boolean => {
        const b = objOf(raw);
        return typeof b.label === "string" && typeof b.start === "number" && typeof b.end === "number" && from <= b.start && b.start < b.end && b.end <= to && own(ctx.world.places, strOf(b.place)) !== undefined && strOf(b.activity) !== "" && (b.days === undefined || typeof b.days === "string");
      };
      const planned = plans.every((raw) => own(ctx.state.entities, strOf(objOf(raw).entity)) !== undefined && Array.isArray(objOf(raw).blocks) && (objOf(raw).blocks as JsonValue[]).every(block));
      return planned ? null : { code: "bad_value", reason: "a skip plan names people in the world, each block inside its span at a place the world has" };
    },
    apply: (e, state) => {
      mutableSlice(state, "castlife").skipPlan = structuredClone(e.data);
    },
    // The GM's line only: what someone did in a skip is no player's news.
    describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `skip planned for ${Array.isArray(e.data.plans) ? e.data.plans.length : 0}${typeof e.data.note === "string" ? ` (${e.data.note})` : ""}`),
  },
  {
    // One block of someone's routine in this chat (`routine_block`, or the story's): the block whole, or null to drop the chat's change.
    type: ROUTINE_EVENTS.block,
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, strOf(e.data.entity))) return { code: "missing_entity", reason: "a routine change names someone in the world" };
      if (strOf(e.data.block) === "" || !isChatSource(e.data.source)) return { code: "bad_event", reason: "a routine change names its block and where it came from" };
      const v = e.data.value;
      if (v === null) return null;
      const problems = blockShapeProblems(v, false);
      return problems.length === 0 && objOf(v).id === e.data.block ? null : { code: "bad_value", reason: problems[0] ?? "the block's id is the one it changes" };
    },
    apply: (e, state) => {
      const routines = sliceRecord(state, "castlife", "routines");
      const who = strOf(e.data.entity);
      const mine = { ...objOf(routines[who]) };
      if (e.data.value === null) delete mine[strOf(e.data.block)];
      else mine[strOf(e.data.block)] = { value: structuredClone(e.data.value ?? null), source: structuredClone(e.data.source ?? null) };
      if (Object.keys(mine).length === 0) delete routines[who];
      else routines[who] = mine;
    },
    describe: (e, ctx, viewer) => changeLine(ctx, e, viewer, `routine block ${strOf(e.data.block)} ${e.data.value === null ? "back to the world's" : objOf(e.data.value).off === true ? "off" : "changed"}`),
  },
  {
    // One of someone's schedules in this chat (`schedule_override`, or the story's): off, their own slots, or null to drop the chat's change.
    type: ROUTINE_EVENTS.schedule,
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, strOf(e.data.entity))) return { code: "missing_entity", reason: "a schedule change names someone in the world" };
      if (!allSchedules(ctx.registry, ctx.world).some((s) => s.id === strOf(e.data.schedule)) || !isChatSource(e.data.source)) return { code: "bad_event", reason: "a schedule change names one of the world's schedules and where it came from" };
      return e.data.value === null || isScheduleChange(e.data.value) ? null : { code: "bad_value", reason: "a schedule change is off (until a time or for good) or their own slots" };
    },
    apply: (e, state) => {
      const schedules = sliceRecord(state, "castlife", "schedules");
      const who = strOf(e.data.entity);
      const mine = { ...objOf(schedules[who]) };
      if (e.data.value === null) delete mine[strOf(e.data.schedule)];
      else mine[strOf(e.data.schedule)] = { value: structuredClone(e.data.value ?? null), source: structuredClone(e.data.source ?? null) };
      if (Object.keys(mine).length === 0) delete schedules[who];
      else schedules[who] = mine;
    },
    describe: (e, ctx, viewer) => changeLine(ctx, e, viewer, `schedule ${strOf(e.data.schedule)} ${e.data.value === null ? "back to the world's" : objOf(e.data.value).off === true ? "off" : "changed"}`),
  },
];

/**
 * The GM's routine controls as the events of one `fix` entry (DESIGN §8): how someone follows their
 * routine (each part kept unless given; null returns it to the world's), one block of their routine,
 * or one of their schedules, in this chat. Each event carries the change whole.
 */
function routineEdit(ctx: ReadContext, op: RoutineEditOp): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, op.entity);
  if (!e) return { code: "missing_entity", reason: `no ${labelOf(ctx, op.entity)}` };
  if (!kindIs(ctx.registry, ctx.world, e.kind, "person")) return { code: "not_person", reason: `${e.name} has no routine: only people do` };
  const source = { type: "gm", at: ctx.state.clock };
  if (op.op === "routine_follow") {
    const now = followOf(ctx, op.entity).chat;
    const mode = op.mode === undefined ? (now?.mode ?? null) : op.mode;
    const awareness = op.awareness === undefined ? (now?.awareness ?? null) : op.awareness;
    const role = op.role === undefined ? (now?.role ?? null) : op.role;
    const skips = op.skips === undefined ? (now?.skips ?? null) : op.skips;
    return [{ type: ROUTINE_EVENTS.follow, data: { entity: op.entity, follow: mode === null && awareness === null && role === null && skips === null ? null : { mode, awareness, role, skips } } }];
  }
  if (op.op === "routine_block") {
    if (op.value === null) return [{ type: ROUTINE_EVENTS.block, data: { entity: op.entity, block: op.block, value: null, source } }];
    const value = { ...op.value, id: op.block } as unknown as JsonObject;
    const problems = blockShapeProblems(value, false);
    if (problems.length > 0) return { code: "bad_value", reason: problems.join("; ") };
    return [{ type: ROUTINE_EVENTS.block, data: { entity: op.entity, block: op.block, value, source } }];
  }
  const schedule = allSchedules(ctx.registry, ctx.world).find((s) => s.id === op.schedule);
  if (!schedule) return { code: "missing_schedule", reason: `there's no schedule ${op.schedule}` };
  if (op.value !== null && "off" in op.value && !scheduleOwners(ctx.registry, ctx.world, ctx.state, schedule).includes(op.entity)) return { code: "not_owner", reason: `${e.name} doesn't follow ${op.schedule}` };
  const value = op.value === null ? null : (structuredClone(op.value) as unknown as JsonObject);
  if (value !== null && !isScheduleChange(value)) return { code: "bad_value", reason: "a schedule change is off (until a time or for good) or their own slots (HH:MM to HH:MM)" };
  return [{ type: ROUTINE_EVENTS.schedule, data: { entity: op.entity, schedule: op.schedule, value, source } }];
}

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
  /** Their day as the POV may know it (`playerBlocks`): no place, company or GM change; `source` says why each block is there. */
  timeline?: { start: string; end: string; label: string; kind: "work" | "sleep" | "free" | "travel" | "other"; reasons: string[]; source: PlayerBlock["source"] }[];
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

export function kindOfBlock(activity: string): "work" | "sleep" | "free" | "travel" | "other" {
  if (/work|shift|school/.test(activity)) return "work";
  if (activity === "sleep") return "sleep";
  if (activity === "trip" || activity === "travel") return "travel";
  if (/leisure|socialize|idle|breakfast|lunch|dinner/.test(activity)) return "free";
  return "other";
}

/**
 * A day's blocks as the player may know them (DESIGN §7, §8), for Cast and the player's routine view:
 * each with its times, label, kind and reasons, and why it's there: their routine, a lore entry the
 * POV may read (by its title), the story, their own plan, a commitment, or free time. A block of an
 * agenda that isn't public, or a private routine block, reads "Busy" for their own business; a lore
 * entry the POV may not read, and any change the GM made, read as their routine.
 */
export function playerBlocks(ctx: ReadContext, who: EntityId, plan: DayPlan): (PlayerBlock & { start: number })[] {
  const cal = calendarOf(ctx.world);
  const applied = new Map(activeBlocks(ctx, who, plan.day).map((a) => [a.block.id, a]));
  const open = loreGateReader(ctx.registry, ctx.world, ctx.state);
  return plan.blocks.map((b) => {
    const from = formatTimeOfDay(dateAt(cal, b.start).minuteOfDay);
    const to = formatTimeOfDay(dateAt(cal, b.end).minuteOfDay);
    const routineId = b.option.startsWith(ROUTINE_OPTION) ? b.option.slice(ROUTINE_OPTION.length).replace(/:carried$/, "") : null;
    const a = routineId !== null ? applied.get(routineId) : undefined;
    if ((b.option.startsWith(AGENDA_OPTION) && !publicTrack(ctx.world, b.option.slice(AGENDA_OPTION.length))) || a?.block.private === true) return { start: b.start, from, to, label: "Busy", kind: "other", reasons: ["their own business"], source: { type: "routine" } };
    let source: PlayerBlock["source"];
    if (a) {
      const entry = a.from.source.type === "lore" ? own(ctx.world.lore, a.from.source.entry) : undefined;
      source = entry && loreReadable(ctx.registry, ctx.world, ctx.state, entry, "brief", false, open) ? { type: "lore", entry: entry.id, title: entry.title } : a.from.source.type === "story" ? { type: "story" } : { type: "routine" };
    } else if (b.option.startsWith("plan:")) source = { type: "plan" };
    else if (b.fixed && !b.option.startsWith(INVITED_OPTION)) source = { type: "commitment" };
    else if (b.option === "idle" || b.option.startsWith("retrieve:")) source = { type: "free" };
    else source = { type: "routine" };
    return { start: b.start, from, to, label: b.label, kind: kindOfBlock(b.activity), reasons: b.reasons, source };
  });
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
    const blocks = plan ? playerBlocks(ctx, id, plan) : null;
    if (blocks && level >= 3) p.timeline = blocks.map((b) => ({ start: b.from, end: b.to, label: b.label, kind: b.kind, reasons: b.reasons, source: b.source }));
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
 * `castlife.decide`), the one under way or the next, named as Cast names the day (`playerBlocks`): a
 * block of an agenda that isn't public, or a private routine block, is "Busy". Null when no such
 * block is left today.
 */
function decidedBlock(ctx: ReadContext, who: EntityId): string | null {
  const cal = calendarOf(ctx.world);
  const plan = dayPlan(ctx, who);
  const dayStart = clockAt(cal, plan.day, 0);
  const chosen = new Set(plan.ties.filter((t) => t.via === "recorded").map((t) => t.key));
  const block = playerBlocks(ctx, who, plan).find((b, i) => (plan.blocks[i]?.end ?? 0) > ctx.state.clock && chosen.has(tieKey(who, dayStart, b.start)));
  if (!block) return null;
  return block.start <= ctx.state.clock ? block.label : `${block.label} at ${block.from}`;
}

/**
 * Who the Stance section tells of (DESIGN §6.6): everyone in the POV's scene (`together`) it can
 * see who acts, in id order, and the test each piece about them passes: no unrevealed secret,
 * nothing hidden named. The test is built on its first use, so a renderer with nothing to check
 * never pays for it.
 */
function stanceCast(ctx: ReadContext): { people: EntityId[]; safe: (text: string) => boolean } {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const here = placeOfEntity(state, pov);
  // Who acts as far as the POV knows, as People and Cast read it: a body it hasn't found reads as them.
  // A character the Minds section tells of this turn has no Stance line (DESIGN §24.3): their mind says it.
  const minded = new Set(optionalQuery(ctx, "minds.minded")?.(ctx) ?? []);
  const people = here === null ? [] : Object.keys(state.entities).sort().filter((id) => id !== pov && together(world, here, placeOfEntity(state, id)) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && canSeeEntity(reg, world, state, pov, id) && !isGone(state, id) && povLife(world, state, id)?.acts !== false && !minded.has(id));
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
 * Stance by scope (DESIGN §6.11): its people's lines as the POV may read them; in `scene` and `gm`
 * scopes, each one's agendas that aren't public, at their stage, as theirs to know.
 */
export function stanceFeed(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const lines: FeedLine[] = stanceLines(ctx).map((text) => ({ text, known: "pov" }));
  if (scope === "player") return lines;
  for (const id of stanceCast(ctx).people) {
    const name = own(ctx.state.entities, id)?.name ?? id;
    for (const a of agendaFor(ctx.world, ctx.state, id).filter((x) => !publicTrack(ctx.world, x.track))) {
      const track = own(ctx.world.tracks, a.track);
      lines.push({ text: `${name}'s private agenda, ${track?.label ?? a.track}: ${a.stageLabel}.`, known: "scene", who: name });
    }
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

/**
 * The People section (DESIGN §6.6, §6.11): the POV by name with its pressing needs, then each person
 * with it that it can see, what they are doing as it may see it and how they regard it. In `scene`
 * scope, also someone here the POV can't see whom another person here knows, marked with who; in
 * `gm`, someone here no one the POV can see knows of, marked as the GM's.
 */
export function peopleLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  const see = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
  // The POV leads, by name, so the narrator knows who "you" is, with the needs pressing on it.
  const urgent = ctx.levelOf(pov, "castlife") >= 4 ? Object.entries(NEEDS).filter(([n]) => needValue(ctx, pov, n) >= 60).map(([, d]) => d.label) : [];
  const lead = povLead(own(ctx.state.entities, pov)?.name ?? pov);
  const lines: FeedLine[] = [{ text: urgent.length > 0 ? `${lead}: ${urgent.join(", ")}.` : `${lead}.`, known: "pov" }];
  const here = placeOfEntity(ctx.state, pov);
  const voice = optionalQuery(ctx, "relationships.voice");
  const present = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && id !== pov && together(ctx.world, here, placeOfEntity(ctx.state, id)) && kindIs(ctx.registry, ctx.world, e.kind, "person") && !isGone(ctx.state, id);
    });
  for (const id of present) {
    const e = own(ctx.state.entities, id);
    if (!e) continue;
    if (!see(pov, id)) {
      // The narrator is told only who the POV can see, unless the scope asks for more, marked.
      if (scope === "player") continue;
      const knowers = present.filter((k) => k !== id && see(pov, k) && see(k, id)).map((k) => own(ctx.state.entities, k)?.name ?? k);
      const act = typeof e.fields.activity === "string" && e.fields.activity !== "idle" ? ` (${e.fields.activity.replace(/_/g, " ")})` : "";
      if (knowers.length > 0) lines.push({ text: `${e.name}${act} is here.`, known: "scene", who: knowers.join(", ") });
      else if (scope === "gm") lines.push({ text: `${e.name}${act} is here.`, known: "gm" });
      continue;
    }
    // What they are doing is a field: told only when the POV may see it. A life state the POV
    // knows reads instead ("lies dead"); one it doesn't know of is never told.
    const life = povLife(ctx.world, ctx.state, id);
    const act = canSeeField(ctx.registry, ctx.world, ctx.state, pov, id, "activity") ? e.fields.activity : undefined;
    lines.push({ text: life ? `${e.name} ${life.reads}.` : `${e.name}${typeof act === "string" && act !== "idle" ? ` (${shownActivity(ctx, id, act).replace(/_/g, " ")})` : ""} is here.`, known: "pov" });
    // How they regard the POV follows them; a body the POV knows of holds no regard to voice.
    const regard = life && !life.acts ? null : (voice?.(ctx, id) ?? null);
    if (regard) lines.push({ text: regard, known: "pov" });
  }
  return lines;
}

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** The GM's routine controls (DESIGN §8): a character's follow setting, one block of their routine and one of their schedules in this chat, as events. */
    "castlife.edit": (ctx: ReadContext, op: RoutineEditOp) => LedgerEvent[] | Rejection;
  }
  interface QueryMap {
    /** Ties the planner left to the seed and invitations not yet decided: inputs for `npc.choose`. */
    "castlife.tie_zones": (ctx: ReadContext) => { key: string; agent: EntityId; options: string[] }[];
    /** A person's activity as the player and the narrator read it: an agenda's step reads "busy" unless all their agendas are public (`shownActivity`). */
    "castlife.activity": (ctx: ReadContext, who: EntityId, activity: string) => string;
    /** The blocks a person is committed to in [start, end), after every cut (a trip, a plan of their own, a more specific schedule): what they will actually be doing. */
    "castlife.commitments": (ctx: ReadContext, who: EntityId, start: number, end: number) => CommitmentBlock[];
    /** Invitations to the POV still open (`invited`), each with its host and as `viewer` reads it ("Danny invites you to Bluebird Coffee at 19:00."). */
    "castlife.invitations": (ctx: ReadContext, viewer: EntityId) => { host: EntityId; text: string }[];
    /** Whether a schedule's edge must leave someone's place or activity as the story has it (`routineYields`: whether their routine is lived, `release` where a balanced routine takes the day back, `scene` false while time runs on its own, `skip` in a time skip). */
    "castlife.yields": (ctx: ReadContext, who: EntityId, field: "place" | "activity", expected: JsonValue | null, release: boolean, scene: boolean, skip: boolean) => boolean;
    /** Whether the chat took someone off a schedule at `at` (`schedule_override`). */
    "castlife.schedule_off": (ctx: ReadContext, who: EntityId, schedule: string, at: number) => boolean;
    /** The chat's own versions of schedules, each owned by the one person it's for. */
    "castlife.chat_schedules": (ctx: ReadContext) => ScheduleDef[];
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
    r.service("castlife.edit", routineEdit);
    r.query("castlife.yields", (ctx, who, field, expected, release, scene, skip) => routineYields(ctx, who, field, expected, { edge: true, release, scene, skip }));
    r.query("castlife.schedule_off", (ctx, who, schedule, at) => scheduleOff(ctx.state, who, schedule, at));
    r.query("castlife.chat_schedules", chatScheduleDefs);
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
    // Accepting an invitation books it in the POV's day (`bookInvitation`).
    r.effect({ type: "castlife.book_invitation", args: ["host"], resolve: (a, ctx) => bookInvitation(ctx, strOf(a.host)) });
    r.formula("invited", (ctx, host) => openInvitations(ctx).some((inv) => strOf(inv.agent) === String(host ?? "")));
    r.query("castlife.invitations", (ctx, viewer) => openInvitations(ctx).map((inv) => ({ host: strOf(inv.agent), text: invitationText(ctx, strOf(inv.agent), typeof inv.place === "string" ? inv.place : null, numOf(inv.at), viewer) })));
    r.formula("need", (ctx, who, need) => needValue(ctx, String(who ?? ctx.world.pov), String(need ?? "")));
    r.formula("busy", (ctx, who) => {
      const id = String(who ?? "");
      return commitments(ctx, id, ctx.state.clock, ctx.state.clock + 1).length > 0;
    });

    // The need it starts from rides with the event, so a fold reads no day plan (DESIGN §8).
    r.effect({ type: "castlife.satisfy", args: ["need", "entity?"], resolve: (a, ctx) => { const who = strOf(a.entity) || ctx.world.pov; const need = strOf(a.need); const v = needValue(ctx, who, need); return own(NEEDS, need) && v > 0 ? [{ type: "castlife.need", data: { entity: who, need, delta: -v, at: ctx.state.clock, from: v } }] : []; } });
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
          out.push(...movesOf(relocate(ctx, who, a.place)));
        }
        if (typeof a.activity === "string") {
          holds.activity = until;
          out.push({ type: "set", entity: who, field: "activity", value: a.activity });
        }
        return [{ type: "set", entity: who, field: "holds", value: holds }, ...out];
      },
    });
    // What the story changes of someone's routine (DESIGN §8, §9.4): the `routine` narration channel,
    // and the effect it records with, the chat's own blocks and schedules with source `story`.
    r.proposal(routineChannel);
    r.effect({ type: ROUTINE_EFFECT, args: ["entity", "blocks?", "schedules?", "turn?", "by?"], resolve: storyEvents });

    r.action({ id: "eat", label: "Eat", description: "Have a meal or a snack.", pack: "castlife", params: {}, requires: [], outcomes: { default: [{ type: "castlife.satisfy", args: { entity: "self", need: "hunger" } }, { type: "set", args: { entity: "self", field: "activity", value: "meal" } }] }, duration: "30", lexicon: ["eat", "have lunch", "have dinner", "grab a bite"], observable: "eats" });
    r.action({ id: "sleep", label: "Go to bed", description: "Go to bed and sleep until morning.", pack: "castlife", params: {}, requires: [], outcomes: { default: [{ type: "castlife.satisfy", args: { entity: "self", need: "fatigue" } }] }, duration: "5", activity: { type: "sleep", until: "next_time('07:00')" }, lexicon: ["go to bed", "sleep", "turn in", "hit the sack"], observable: "goes to bed" });
    r.action({ id: "rest", label: "Rest", description: "Rest or relax for a while.", pack: "castlife", params: {}, requires: [], outcomes: { default: [{ type: "castlife.satisfy", args: { entity: "self", need: "fun" } }] }, duration: "30", activity: { type: "waiting", until: "clock + 30" }, lexicon: ["rest", "relax", "take a break"], observable: "rests" });
    r.action({ id: "accept_invitation", label: "Accept invitation", description: "Say yes to an invitation someone made you.", pack: "castlife", params: { host: { type: "ref", ref: "person" } }, requires: ["invited(host)"], outcomes: { default: [{ type: "relationships.appraise", args: { from: "host", to: "self", appraisal: "promise_kept" } }, { type: "castlife.book_invitation", args: { host: "host" } }] }, duration: "1", lexicon: ["accept", "sure, let's", "count me in"], observable: "accepts an invitation" });

    r.renderer({ slot: "people", render: (ctx) => peopleLines(ctx, "player").map((l) => l.text), feed: peopleLines });
    // Their usual routine as background the narrator may use or ignore (DESIGN §6.6): a hint, so it
    // rides last on the budget and stays out of the helpers' facts.
    r.renderer({ slot: "people", source: "routines", hint: true, render: usualRoutineHints });
    r.view({ panel: "castlife.cast", build: (ctx) => buildCastView(ctx) as unknown as JsonValue });
    r.renderer({ slot: "stance", render: stanceLines, feed: stanceFeed });
    r.renderer({ slot: "stance", source: "cues", hint: true, render: stanceCues });
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

    // Routines and the schedule checks they lean on (DESIGN §8, §13): owners as a chat starts.
    r.lint({
      code: "castlife.routines",
      check(world, registry) {
        if (!registry) return [];
        const state = initialState(world, "", registry);
        return [...routinesLint(world, registry, state), ...schedulesLint(world, registry, state)];
      },
    });
  },
};

export default castlifePack;
