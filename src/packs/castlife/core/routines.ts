// Routines (DESIGN §8, §24.8): which blocks of the world's routines, and of a chat's own changes,
// apply to someone, with the owner each comes from and what it shadows; whether a block is on a day,
// and where it happens; the blocks of one day as the planner lays them; how a routine yields to the
// story; and the lint that checks them. A routine is a default the world relies on, never authority:
// what the story established, a scene with the POV and the cast the story is about always win.

import type { EntityId, PlaceId, ScheduleId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { hashParts } from "../../../shared/hash";
import type { LintIssue } from "../../../shared/protocol";
import { FIDELITIES } from "../../../shared/minds";
import {
  BASIC_BLOCKS,
  blockShapeProblems,
  isOff,
  ROUTINE_AWARENESS,
  ROUTINE_LINT,
  ROUTINE_MODES,
  ROUTINE_ROLES,
  SKIP_LIVES,
  ROUTINE_SETTING_VALUES,
  routineSettingsOf,
  routineShapeProblems,
  storySourceLabel,
  type ChatRoutineSource,
  type ChatScheduleChange,
  type OwnerRef,
  type RoutineAwareness,
  type RoutineBlock,
  type RoutineBlockId,
  type RoutineDef,
  type RoutineEntry,
  type RoutineFollow,
  type RoutineMode,
  type RoutineRole,
  type SkipLife,
  type SkipPlan,
  type RoutineSource,
  type SourceView,
} from "../../../shared/routines";
import type { ScheduleDef, WorldDoc } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, holidaysOn, MINUTES_PER_DAY, parseHHMM } from "../../../engine/calendar";
import { acts } from "../../../engine/life";
import { objOf, optionalQuery, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { FixedBlock, PlanBlock, PlanOption } from "../../../engine/plan-day";
import type { ReadContext } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { createRng } from "../../../engine/rng";
import { allSchedules, ownerRank, scheduleOwners } from "../../../engine/schedules";
import { isGone, kindDef, kindIs, placeOfEntity } from "../../../engine/scope";
import { selectEntities, selectorProblems } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity } from "../../../engine/visibility";
import { occasionOf, type Occasion } from "./occasions";
import { bedPlace, homeOf, placeOfType, workPlace } from "./places";

/** The planner's option id prefix for a routine block: `routine:<block id>`. */
export const ROUTINE_OPTION = "routine:";

// ---------------------------------------------------------------- a chat's own changes

/** One block a chat changed for someone, with where the change came from. */
export interface ChatBlock {
  value: RoutineEntry;
  source: ChatRoutineSource;
}

/** One schedule a chat changed for someone. */
export interface ChatSchedule {
  value: ChatScheduleChange;
  source: ChatRoutineSource;
}

function chatSource(v: JsonValue | undefined): ChatRoutineSource | null {
  const o = objOf(v);
  if (o.type === "gm" && typeof o.at === "number") return { type: "gm", at: o.at };
  if (o.type === "story" && typeof o.at === "number") return { type: "story", at: o.at, ...(typeof o.turn === "string" ? { turn: o.turn } : {}), ...(o.by === "player" ? { by: "player" as const } : {}) };
  return null;
}

/** Someone's follow setting in a chat (`castlife.follow`), null when the chat set none. */
export function chatFollow(state: Readonly<WorldState>, who: EntityId): RoutineFollow | null {
  const raw = own(objOf(sliceOf(state, "castlife").follow), who);
  if (!isRecord(raw)) return null;
  const mode = ROUTINE_MODES.find((m) => m === raw.mode) ?? null;
  const awareness = ROUTINE_AWARENESS.find((a) => a === raw.awareness) ?? null;
  const role = ROUTINE_ROLES.find((r) => r === raw.role) ?? null;
  const skips = SKIP_LIVES.find((s) => s === raw.skips) ?? null;
  return mode === null && awareness === null && role === null && skips === null ? null : { mode, awareness, role, skips };
}

/** Everyone a chat set a routine role for (`routine_follow`), with it, by entity id: what the GM view carries (DESIGN §7). One following their level's role has none. */
export function chatRoles(state: Readonly<WorldState>): { entity: EntityId; role: RoutineRole }[] {
  return Object.keys(objOf(sliceOf(state, "castlife").follow))
    .sort()
    .flatMap((entity) => {
      const role = chatFollow(state, entity)?.role ?? null;
      return role === null ? [] : [{ entity, role }];
    });
}

/** The blocks a chat changed for someone (`castlife.routine`), by block id. */
export function chatBlocks(state: Readonly<WorldState>, who: EntityId): Record<RoutineBlockId, ChatBlock> {
  const out: Record<RoutineBlockId, ChatBlock> = {};
  for (const [id, raw] of Object.entries(objOf(own(objOf(sliceOf(state, "castlife").routines), who)))) {
    const c = objOf(raw);
    const source = chatSource(c.source);
    if (source && isRecord(c.value) && blockShapeProblems(c.value, false).length === 0) out[id] = { value: c.value as unknown as RoutineEntry, source };
  }
  return out;
}

/** The schedules a chat changed for someone (`castlife.schedule`), by schedule id. */
export function chatSchedules(state: Readonly<WorldState>, who: EntityId): Record<ScheduleId, ChatSchedule> {
  const out: Record<ScheduleId, ChatSchedule> = {};
  for (const [id, raw] of Object.entries(objOf(own(objOf(sliceOf(state, "castlife").schedules), who)))) {
    const c = objOf(raw);
    const source = chatSource(c.source);
    const v = objOf(c.value);
    if (!source) continue;
    if (v.off === true) out[id] = { value: { off: true, until: typeof v.until === "number" ? v.until : null }, source };
    else if (Array.isArray(v.slots)) out[id] = { value: c.value as unknown as ChatScheduleChange, source };
  }
  return out;
}

/** How someone follows their routine in a chat: their mode and awareness, and what the chat set of them. */
export function followOf(ctx: Pick<ReadContext, "world" | "state">, who: EntityId): { mode: RoutineMode; awareness: RoutineAwareness; chat: RoutineFollow | null } {
  const chat = chatFollow(ctx.state, who);
  return { mode: chat?.mode ?? "follows", awareness: chat?.awareness ?? routineSettingsOf(ctx.world).awareness, chat };
}

/**
 * What someone's routine and their own place and activity schedules are to the engine now (DESIGN §8,
 * `RoutineRole`): the chat's role for them (`routine_follow`), else their level's in the world's
 * settings, their level read as it is now (`minds.tier`, recomputed every turn and at every beat;
 * Background without minds). The POV has none: whether its routine runs is the timelapse's.
 */
export function routineRole(ctx: ReadContext, who: EntityId): RoutineRole {
  return chatFollow(ctx.state, who)?.role ?? routineSettingsOf(ctx.world).roles[optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? "background"];
}

/**
 * How someone spends a time skip (DESIGN §8, `SkipLife`): the chat's choice for them (`routine_follow`),
 * else their level's in the world's settings, read as their level is now. Null for the POV and while
 * their routine isn't informative: an enforced routine is always lived, and an off one never.
 */
export function skipLifeOf(ctx: ReadContext, who: EntityId): SkipLife | null {
  if (who === ctx.world.pov || routineRole(ctx, who) !== "informative") return null;
  return chatFollow(ctx.state, who)?.skips ?? routineSettingsOf(ctx.world).skips[optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? "background"];
}

/** The latest skip plan the chat recorded (`castlife.skip_plan`, kept whole as the castlife slice's `skipPlan`), null before any. */
export function skipPlanOf(state: Readonly<WorldState>): SkipPlan | null {
  const raw = sliceOf(state, "castlife").skipPlan;
  // The event's own check let only a well-formed plan in, so the fold keeps one as recorded.
  return isRecord(raw) && typeof raw.from === "number" && typeof raw.to === "number" && Array.isArray(raw.plans) ? (raw as unknown as SkipPlan) : null;
}

// ---------------------------------------------------------------- whose blocks apply

/** A routine's rank among the owners of a block: 1 their own, 2 a group's, 3 a kind's, 4 a selector's, 5 the world's default. */
function routineRank(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, def: RoutineDef): number {
  const rank = ownerRank(reg, world, state, def);
  return rank === null ? 5 : rank + 1;
}

/** Whether a routine covers someone: its owner as a schedule's reads, or (no owner) every person who acts. */
function covers(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, def: RoutineDef, who: EntityId): boolean {
  if (def.owner === undefined) {
    const e = own(state.entities, who);
    return !!e && kindIs(reg, world, e.kind, "person") && !isGone(state, who) && acts(world, state, who);
  }
  return scheduleOwners(reg, world, state, def).includes(who);
}

/** One candidate for a block id: the entry, where it comes from and how specific it is. */
export interface Applied {
  entry: RoutineEntry;
  routine: RoutineDef | null;
  level: OwnerRef["level"];
  rank: number;
  source: RoutineSource;
}

/** The world's routines, well formed, in id order. */
export function worldRoutines(world: Pick<WorldDoc, "routines">): RoutineDef[] {
  const raw = world.routines ?? {};
  return Object.keys(raw)
    .sort()
    .flatMap((id) => {
      const r = own(raw, id);
      return r && routineShapeProblems(r).length === 0 ? [r] : [];
    });
}

/**
 * Every candidate for each block id of someone's routine, most specific first (the chat, their own,
 * a group's, a kind's, a selector's, the world's default, the basic needs; equal ranks by routine id),
 * with the less specific owners' blocks left out below a routine that doesn't inherit them. With the
 * chat's mode `off` they have no routine: only the basic needs and the chat's own changes stay.
 * With `day`, the candidates on that day: a block the story added or changed is theirs from the day
 * after its turn, since the day it was told was already laid as the story had it; what the story
 * turned off, and every change of the GM's, holds at once.
 */
export function routineCandidates(ctx: Pick<ReadContext, "registry" | "world" | "state">, who: EntityId, day?: number): Map<RoutineBlockId, Applied[]> {
  const { registry: reg, world, state } = ctx;
  const out = new Map<RoutineBlockId, Applied[]>();
  const add = (a: Applied): void => {
    const list = out.get(a.entry.id) ?? [];
    list.push(a);
    out.set(a.entry.id, list);
  };
  const off = followOf(ctx, who).mode === "off";
  const ranked = off ? [] : worldRoutines(world).flatMap((def) => (covers(reg, world, state, def, who) ? [{ def, rank: routineRank(reg, world, state, def) }] : []));
  // A routine that doesn't inherit cuts every less specific routine's blocks for whom it covers.
  const cut = Math.min(6, ...ranked.filter((r) => r.def.inherit === false).map((r) => r.rank));
  for (const { def, rank } of ranked) {
    if (rank > cut) continue;
    const level = (["own", "own", "group", "kind", "selector", "world"] as const)[rank] ?? "world";
    for (const entry of def.blocks) add({ entry, routine: def, level, rank, source: entry.source ?? def.source ?? { type: "authored" } });
  }
  for (const entry of BASIC_BLOCKS) add({ entry, routine: null, level: "builtin", rank: 6, source: { type: "builtin" } });
  const cal = calendarOf(world);
  for (const [id, c] of Object.entries(chatBlocks(state, who))) {
    if (day !== undefined && c.source.type === "story" && !isOff(c.value) && day <= dateAt(cal, c.source.at).dayIndex) continue;
    add({ entry: { ...c.value, id }, routine: null, level: "chat", rank: 0, source: c.source });
  }
  for (const list of out.values()) list.sort((a, b) => a.rank - b.rank || (a.routine?.id ?? "").localeCompare(b.routine?.id ?? ""));
  return out;
}

/** The blocks of someone's routine in force (on `day`, when given: `routineCandidates`): each id's most specific entry, when it isn't turned off, with where it comes from. */
export function activeBlocks(ctx: Pick<ReadContext, "registry" | "world" | "state">, who: EntityId, day?: number): { block: RoutineBlock; from: Applied }[] {
  const out: { block: RoutineBlock; from: Applied }[] = [];
  for (const list of routineCandidates(ctx, who, day).values()) {
    const top = list[0];
    if (top && !isOff(top.entry)) out.push({ block: top.entry, from: top });
  }
  return out;
}

// ---------------------------------------------------------------- days and places

/** Whether a block's days hold on a day, read against its occasion (no weekly count or chance). */
function daysHold(ctx: ReadContext, block: RoutineBlock, day: number, occasion: Occasion): boolean {
  const d = block.days;
  if (!d) return true;
  const cal = calendarOf(ctx.world);
  const date = dateAt(cal, clockAt(cal, day, 0));
  if (d.weekdays && !d.weekdays.includes(date.weekday)) return false;
  if (d.off === "only" && !occasion.dayOff) return false;
  if (d.off === "never" && occasion.dayOff) return false;
  // Holidays as the calendar has them, whatever its level shows: the routine is the world's own data.
  const holidays = d.holidays || d.except ? holidaysOn(cal, day).map((h) => h.id) : [];
  if (d.holidays && !d.holidays.some((h) => holidays.includes(h))) return false;
  if (d.except?.some((h) => holidays.includes(h))) return false;
  if (d.birthday === "own" && !occasion.birthday) return false;
  if (d.birthday === "friend" && occasion.friends.length === 0) return false;
  if (d.seasons && occasion.season !== null && !d.seasons.some((s) => s === occasion.season)) return false;
  if (d.weather === "foul" && occasion.foul === false) return false;
  if (d.weather === "fair" && occasion.foul === true) return false;
  return true;
}

/**
 * Whether a block is on for someone on a day (DESIGN §8): its days hold; with `perWeek`, the day is
 * one of that many the week's seed picks among the week's days its days hold on; and an optional
 * block happens by its chance on the day's seed. Seeds are per world, person, block and week or day,
 * so a block is on or off the same however often the day is planned.
 */
export function blockOnDay(ctx: ReadContext, who: EntityId, block: RoutineBlock, day: number, occasion: Occasion = occasionOf(ctx, who, day)): boolean {
  if (!daysHold(ctx, block, day, occasion)) return false;
  if (block.perWeek !== undefined && block.kind !== "fixed") {
    const cal = calendarOf(ctx.world);
    const weekStart = day - dateAt(cal, clockAt(cal, day, 0)).weekday;
    const eligible: number[] = [];
    for (let d = weekStart; d < weekStart + 7; d++) if (d === day || daysHold(ctx, block, d, occasionOf(ctx, who, d))) eligible.push(d);
    const rng = createRng(hashParts("castlife.routine.week", ctx.world.id, who, block.id, String(weekStart)));
    const picked = [...eligible].sort((a, b) => a - b);
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [picked[i], picked[j]] = [picked[j] as number, picked[i] as number];
    }
    if (!picked.slice(0, block.perWeek).includes(day)) return false;
  }
  if (block.kind === "optional") return createRng(hashParts("castlife.routine.day", ctx.world.id, who, block.id, String(day))).next() < (block.chance ?? 0.5);
  return true;
}

/** The first of a block's company who isn't `who`, by id. */
function companyOf(ctx: ReadContext, who: EntityId, block: RoutineBlock): EntityId[] {
  return block.company ? selectEntities(ctx.registry, ctx.world, ctx.state, block.company.who).filter((id) => id !== who) : [];
}

/**
 * Where a block happens for someone: their home, their work (else home), wherever they are (null),
 * the home of the first of its company (a friend's birthday: the friend's), a place, or the nearest
 * place of a scene type to their home. A place the world doesn't have is home. Sleep at home is in
 * their bed, wherever it is, when they have one (`bedPlace`).
 */
export function blockPlace(ctx: ReadContext, who: EntityId, block: RoutineBlock, occasion?: Occasion): PlaceId | null {
  const home = homeOf(ctx, who);
  const p = block.place ?? "home";
  if (p === "here") return null;
  if (p === "home") return block.activity === "sleep" ? (bedPlace(ctx, who) ?? home) : home;
  if (p === "work") return workPlace(ctx, who) ?? home;
  if (p === "with") {
    const host = companyOf(ctx, who, block)[0] ?? occasion?.friends[0];
    const theirs = host ? homeOf(ctx, host) : null;
    return theirs !== null && own(ctx.world.places, theirs) ? theirs : home;
  }
  if ("place" in p) return own(ctx.world.places, p.place) ? p.place : home;
  return placeOfType(ctx, p.nearest, home) ?? home;
}

/** A window's span from a day's start, in minutes; one whose end is at or before its start runs past midnight. */
function windowSpan(window: { from: string; to: string }): { from: number; to: number } {
  const from = parseHHMM(window.from);
  const to = parseHHMM(window.to);
  return { from, to: to > from ? to : to + MINUTES_PER_DAY };
}

/** The reason a routine block gives the player: what kind of block it is, never what it rests on. */
function blockReason(block: RoutineBlock, from: Applied): string {
  if (from.level === "builtin") return "basic need";
  return block.kind === "optional" ? "a habit" : "routine";
}

/** What the planner needs from the castlife core to lay a day: how pressing a need is, and the needs an activity meets. */
export interface NeedReader {
  need: (need: string, t: number, laid: readonly PlanBlock[]) => number;
  meets: (activity: string) => string[];
}

/**
 * Someone's routine for one day as the planner takes it (DESIGN §8, §24.8): fixed blocks at their
 * times (cut around the day's commitments and the stronger fixed blocks), and flexible and optional
 * ones as options in their windows, worth their priority plus, from Cast life 4, the needs they meet.
 * A window or a fixed block that runs past midnight carries into the next day: the day before's comes
 * in as the morning's (a night's sleep), as the day before had the block: one the story added that
 * day wasn't theirs yet, so it brings no morning.
 */
export function routineDay(ctx: ReadContext, who: EntityId, day: number, commitments: readonly FixedBlock[], needs: NeedReader): { fixed: FixedBlock[]; options: PlanOption[] } {
  const cal = calendarOf(ctx.world);
  const start = clockAt(cal, day, 0);
  const blocks = activeBlocks(ctx, who, day);
  const before = new Map(activeBlocks(ctx, who, day - 1).map((a) => [a.block.id, a]));
  const occasions = new Map<number, Occasion>();
  const occasion = (d: number): Occasion => {
    const cached = occasions.get(d);
    if (cached) return cached;
    const o = occasionOf(ctx, who, d);
    occasions.set(d, o);
    return o;
  };
  const fixed: FixedBlock[] = [];
  const options: PlanOption[] = [];
  const pressed = (block: RoutineBlock) => (t: number, laid: readonly PlanBlock[]): string[] => {
    const met = block.needs ?? needs.meets(block.activity);
    return met.flatMap((n) => {
      const v = needs.need(n, t, laid);
      return v >= 50 ? [`${n === "hunger" ? "hungry" : n === "fatigue" ? "tired" : n === "social" ? "lonely" : "bored"} (${n} ${Math.round(v)})`] : [];
    });
  };
  const worth = (block: RoutineBlock) => (t: number, laid: readonly PlanBlock[]): number => (block.priority ?? 3) + Math.max(0, ...(block.needs ?? needs.meets(block.activity)).map((n) => needs.need(n, t, laid) / 20));
  // Stronger fixed blocks first: a weaker one is cut around them, as each is around the commitments.
  const firm = blocks.filter((b) => b.block.kind === "fixed").sort((a, b) => (b.block.priority ?? 3) - (a.block.priority ?? 3) || a.block.id.localeCompare(b.block.id));
  const taken: { start: number; end: number }[] = commitments.map((c) => ({ start: c.start, end: c.end }));
  for (const today of firm) {
    for (const d of [day - 1, day]) {
      const had = d === day ? today : before.get(today.block.id);
      if (!had || had.block.kind !== "fixed" || !blockOnDay(ctx, who, had.block, d, occasion(d))) continue;
      const { block, from } = had;
      const s = clockAt(cal, d, parseHHMM(block.at ?? "00:00"));
      const e = s + block.minutes;
      if (e <= start || s >= start + MINUTES_PER_DAY) continue;
      let pieces = [{ start: s, end: e }];
      for (const t of taken) pieces = pieces.flatMap((p) => (p.end <= t.start || p.start >= t.end ? [p] : [...(p.start < t.start ? [{ start: p.start, end: t.start }] : []), ...(p.end > t.end ? [{ start: t.end, end: p.end }] : [])]));
      for (const p of pieces) {
        fixed.push({ start: p.start, end: p.end, label: block.label, activity: block.activity, place: blockPlace(ctx, who, block, occasion(d)), reason: blockReason(block, from), option: `${ROUTINE_OPTION}${block.id}` });
        taken.push(p);
      }
    }
  }
  for (const { block, from } of blocks) {
    if (block.kind === "fixed" || !block.window) continue;
    const span = windowSpan(block.window);
    const prior = before.get(block.id);
    const night = prior && prior.block.kind !== "fixed" && prior.block.window ? { block: prior.block, from: prior.from, span: windowSpan(prior.block.window) } : null;
    const reasons = [blockReason(block, from)];
    // Today's window, and the day before's when it runs past midnight: then its block began last
    // night, so what is left of it is the morning's (from the window's middle, a typical start).
    if (blockOnDay(ctx, who, block, day, occasion(day))) {
      options.push({ id: `${ROUTINE_OPTION}${block.id}`, label: block.label, activity: block.activity, place: blockPlace(ctx, who, block, occasion(day)), duration: block.minutes, window: { from: start + span.from, to: start + span.to }, utility: worth(block), reasons, because: pressed(block) });
    }
    if (night && night.span.to > MINUTES_PER_DAY && blockOnDay(ctx, who, night.block, day - 1, occasion(day - 1))) {
      const left = Math.round((night.span.from + night.span.to) / 2) + night.block.minutes - MINUTES_PER_DAY;
      if (left > 0) options.push({ id: `${ROUTINE_OPTION}${block.id}:carried`, label: night.block.label, activity: night.block.activity, place: blockPlace(ctx, who, night.block, occasion(day - 1)), duration: left, window: { from: start, to: start + 1 }, utility: (night.block.priority ?? 3) + 5, reasons: [blockReason(night.block, night.from)], because: pressed(night.block) });
    }
  }
  return { fixed, options };
}

// ---------------------------------------------------------------- the story first

/** Whether `who` is in a scene with the POV: where it is, and seen by it. */
export function withPov(ctx: ReadContext, who: EntityId): boolean {
  const pov = ctx.world.pov;
  if (who === pov) return false;
  const here = placeOfEntity(ctx.state, pov);
  return here !== null && placeOfEntity(ctx.state, who) === here && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, who);
}

/**
 * Whether someone's routine moves them in this slot (DESIGN §8): an enforced one always; an
 * informative one only in a time skip (`skip`: a palette Timelapse, a typed span, a narrated skip)
 * they spend on their routine (`skipLifeOf`). Never an off one.
 */
export function routineLived(ctx: ReadContext, who: EntityId, skip: boolean): boolean {
  return routineRole(ctx, who) === "enforced" || (skip && skipLifeOf(ctx, who) === "routine");
}

/**
 * Whether a routine or a schedule must leave someone's place or activity as it is (DESIGN §8): a
 * routine is a default, never authority, so it never moves anyone out of a scene with the POV, and
 * moves no one whose routine it doesn't live (`routineLived`: by default the Live, Near and Far cast's
 * is lived only in a skip they spend on it; otherwise their minds, story plans and the narration
 * decide what they do). A skip's is the exception to the scene: in a time skip (`skip`), the routine
 * of someone who spends it on their routine may take them out of the scene the story holds with the
 * POV, and back. An enforced routine gives way to the GM's intent for anyone but a Background
 * character (for anyone, story first); a skip's always does. Otherwise it yields to what the story
 * set: when `who` isn't where the routine last had them (`expected`), something else put them there.
 * Between its own edges it never moves them then; at an edge it does under routine first, never under
 * story first, and under balanced only where the story's day ends (`release`: going to bed, or a
 * schedule's first slot of a day). The POV has no role: its routine runs only in a timelapse that
 * follows it, and yields to what the player or the narration set as anyone's does. A scene with the
 * POV holds whoever is in it while the story holds the POV (`scene`: an ordinary turn, a span the
 * player's words spend, a narrated skip, a palette Timelapse that holds it); while time runs on its
 * own (`scene` false: a timelapse the POV's routine runs in) there's no scene to keep them in, so a
 * housemate still goes to work and a trip still leaves.
 */
export function routineYields(ctx: ReadContext, who: EntityId, field: "place" | "activity", expected: JsonValue | null, opts: { edge: boolean; release?: boolean; scene?: boolean; skip?: boolean }): boolean {
  const pov = who === ctx.world.pov;
  const enforced = routineRole(ctx, who) === "enforced";
  if ((pov || enforced || opts.skip !== true) && opts.scene !== false && withPov(ctx, who)) return true;
  const awareness = followOf(ctx, who).awareness;
  if (!pov) {
    if (!routineLived(ctx, who, opts.skip === true)) return true;
    const tier = optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? "background";
    if ((!enforced || tier !== "background" || awareness === "story_first") && optionalQuery(ctx, "minds.intent")?.(ctx, who) === true) return true;
  }
  const current = own(ctx.state.entities, who)?.fields[field];
  const diverged = expected === null || expected === undefined ? !opts.edge : current !== undefined && current !== expected;
  if (!opts.edge) return diverged;
  if (!diverged || awareness === "routine_first") return false;
  return awareness === "story_first" || !opts.release;
}

// ---------------------------------------------------------------- views of sources and owners

/** A source as a reader names it: a lore entry by its title, a sheet field by its owner's name. */
export function sourceView(ctx: Pick<ReadContext, "world" | "state">, source: RoutineSource): SourceView {
  switch (source.type) {
    case "authored":
      return { ...source, label: "Authored" };
    case "lore": {
      const title = own(ctx.world.lore, source.entry)?.title;
      return { ...source, label: `Lore: ${title ?? source.entry}`, ...(title !== undefined ? { title } : {}) };
    }
    case "sheet":
      return { ...source, label: `${own(ctx.state.entities, source.entity)?.name ?? source.entity} · ${source.field.replace(/_/g, " ")}` };
    case "builtin":
      return { ...source, label: "Basic needs" };
    case "story":
      return { ...source, label: storySourceLabel(source) };
    case "gm":
      return { ...source, label: "The GM" };
  }
}

/** Whose a candidate is, as the read model names it. */
export function ownerOf(ctx: Pick<ReadContext, "registry" | "world" | "state">, level: OwnerRef["level"], owner: RoutineDef["owner"] | undefined): OwnerRef {
  const rank = { chat: 0, own: 1, group: 2, kind: 3, selector: 4, world: 5, builtin: 6 }[level];
  if (level === "chat") return { level, name: "This chat", rank };
  if (level === "builtin") return { level, name: "Basic needs", rank };
  if (level === "world" || owner === undefined) return { level: "world", name: "Everyone", rank: 5 };
  if (typeof owner !== "string") return { level, name: "Selected people", rank };
  if (level === "kind") return { level, id: owner, name: kindDef(ctx.registry, ctx.world, owner)?.label ?? owner, rank };
  return { level, id: owner, name: own(ctx.state.entities, owner)?.name ?? owner, rank };
}

// ---------------------------------------------------------------- lint

/**
 * What is wrong with one routine of a world (a Build write, a proposal, the lint): its shape, then
 * what it names that the world doesn't have (an owner that matches nobody, an unknown place, scene
 * type, need, holiday or lore entry, company that names nobody) and windows a block can't keep.
 * Paths are `routines.<id>…`.
 */
export function routineIssues(world: WorldDoc, reg: Registry, id: string, value: unknown, state: Readonly<WorldState>): LintIssue[] {
  const at = `routines.${id}`;
  if (routineShapeProblems(value).length > 0 || !isRecord(value)) {
    // A block's own problems at its path, so Build opens that block; the routine's at its root.
    const blocks = isRecord(value) && Array.isArray(value.blocks) ? value.blocks : [];
    const top = routineShapeProblems(isRecord(value) && Array.isArray(value.blocks) ? { ...value, blocks: [] } : value).map((message) => ({ severity: "error" as const, code: ROUTINE_LINT.shape, message: `Routine ${id}: ${message}.`, path: at }));
    const seen = new Set<string>();
    const each = blocks.flatMap((b, i) => {
      const blockId = isRecord(b) && typeof b.id === "string" ? b.id : "";
      const twice = blockId !== "" && seen.has(blockId) ? [`another block of this routine is ${blockId}`] : [];
      seen.add(blockId);
      return [...blockShapeProblems(b, true), ...twice].map((message) => ({ severity: "error" as const, code: ROUTINE_LINT.shape, message: `Routine ${id}, block ${i + 1}: ${message}.`, path: `${at}.blocks.${i}` }));
    });
    return [...top, ...each];
  }
  const def = value as unknown as RoutineDef;
  const issues: LintIssue[] = [];
  const warn = (code: string, path: string, message: string): void => {
    issues.push({ severity: "warning", code, path, message });
  };
  if (def.id !== id) warn(ROUTINE_LINT.shape, `${at}.id`, `Routine ${id} is saved under another id (${def.id}).`);
  if (typeof def.owner === "string" && !own(world.entities, def.owner) && !kindDef(reg, world, def.owner)) warn(ROUTINE_LINT.owner, `${at}.owner`, `Routine ${id}'s owner ${def.owner} is no entity, group or kind of the world.`);
  else if (isRecord(def.owner)) for (const p of selectorProblems(reg, world, def.owner)) warn(ROUTINE_LINT.owner, `${at}.owner`, `Routine ${id}'s owner ${p}.`);
  if (def.owner !== undefined && scheduleOwners(reg, world, state, def).length === 0) warn(ROUTINE_LINT.owner, `${at}.owner`, `Routine ${id}'s owner matches nobody as a chat starts, so it applies to no one.`);
  const holidays = new Set(world.calendar.holidays.map((h) => h.id));
  const scenes = new Set(Object.values(world.places).flatMap((p) => (p.sceneType ? [p.sceneType] : [])));
  def.blocks.forEach((entry, i) => {
    const path = `${at}.blocks.${i}`;
    const source = entry.source ?? def.source;
    if (source?.type === "lore" && !own(world.lore, source.entry)) warn(ROUTINE_LINT.source, `${path}.source`, `Routine ${id}, block ${entry.id}: rests on lore entry ${source.entry}, which the world doesn't have.`);
    if (source?.type === "sheet" && !own(world.entities, source.entity)) warn(ROUTINE_LINT.source, `${path}.source`, `Routine ${id}, block ${entry.id}: rests on ${source.entity}'s sheet, who isn't in the world.`);
    if (isOff(entry)) return;
    const b = entry;
    const name = `Routine ${id}, block ${b.id}`;
    if (b.place !== undefined && typeof b.place === "object" && "place" in b.place && !own(world.places, b.place.place)) warn(ROUTINE_LINT.place, `${path}.place`, `${name}: there's no place ${b.place.place}; it happens at home.`);
    if (b.place !== undefined && typeof b.place === "object" && "nearest" in b.place && !scenes.has(b.place.nearest)) warn(ROUTINE_LINT.place, `${path}.place`, `${name}: no place has the scene type ${b.place.nearest}; it happens at home.`);
    if (b.place === "with" && !b.company && b.days?.birthday !== "friend") warn(ROUTINE_LINT.place, `${path}.place`, `${name}: happens with its company, but names none; it happens at home.`);
    if (b.company && isRecord(b.company.who)) {
      for (const p of selectorProblems(reg, world, b.company.who)) warn(ROUTINE_LINT.company, `${path}.company`, `${name}: its company ${p}.`);
      if (selectEntities(reg, world, state, b.company.who).length === 0) warn(ROUTINE_LINT.company, `${path}.company`, `${name}: its company matches nobody as a chat starts.`);
    }
    for (const n of b.needs ?? []) if (!["hunger", "fatigue", "social", "fun"].includes(n)) warn(ROUTINE_LINT.need, `${path}.needs`, `${name}: there's no need ${n} (hunger, fatigue, social, fun).`);
    for (const h of [...(b.days?.holidays ?? []), ...(b.days?.except ?? [])]) if (!holidays.has(h)) warn(ROUTINE_LINT.days, `${path}.days`, `${name}: the calendar has no holiday ${h}.`);
    if (b.days?.weekdays?.length === 0) warn(ROUTINE_LINT.days, `${path}.days`, `${name}: lists no weekdays, so it's never on.`);
    if (b.window) {
      const span = windowSpan(b.window);
      if (span.to - span.from + b.minutes > MINUTES_PER_DAY * 2) warn(ROUTINE_LINT.window, `${path}.window`, `${name}: its window and length run past the next day.`);
      if (b.window.from === b.window.to) warn(ROUTINE_LINT.window, `${path}.window`, `${name}: its window opens and closes at ${b.window.from}, which reads as a whole day; give it a span.`);
    }
    if (b.perWeek !== undefined && b.days?.weekdays && b.perWeek > b.days.weekdays.length) warn(ROUTINE_LINT.days, `${path}.perWeek`, `${name}: ${b.perWeek} times a week, but it's on only ${b.days.weekdays.length} weekdays.`);
  });
  return issues;
}

/**
 * The world's routines linted (DESIGN §13): each as `routineIssues` reads it, routines of equal
 * precedence that set the same block for the same person (the one with the lower id wins), and the
 * routine settings. Owners are read from the state a chat starts with.
 */
export function routinesLint(world: WorldDoc, reg: Registry, state: Readonly<WorldState>): LintIssue[] {
  const issues: LintIssue[] = [];
  const raw = world.routines ?? {};
  for (const id of Object.keys(raw).sort()) issues.push(...routineIssues(world, reg, id, own(raw, id), state));
  const settings = isRecord(world.routineSettings) ? world.routineSettings : {};
  // Each part a world may set, from the table a write is held to, so the two never disagree.
  const known = ROUTINE_SETTING_VALUES;
  const warn = (path: string, message: string): void => void issues.push({ severity: "warning", code: ROUTINE_LINT.settings, path: `routineSettings.${path}`, message });
  for (const [key, v] of Object.entries(settings)) {
    const allowed = own(known, key);
    if (!allowed) warn(key, `Routine settings have no ${key}; it does nothing.`);
    else if (allowed === "switch") {
      if (typeof v !== "boolean") warn(key, `Routine settings: ${key} is true or false; the default stands.`);
    } else if ("levels" in allowed) {
      if (!isRecord(v)) warn(key, `Routine settings: ${key} give live, near, far and background each one of ${allowed.levels.join(", ")}; the defaults stand.`);
      else
        for (const [level, one] of Object.entries(v)) {
          if (!FIDELITIES.some((f) => f === level)) warn(`${key}.${level}`, `Routine settings: ${key} have no ${level}; it does nothing.`);
          else if (typeof one !== "string" || !allowed.levels.includes(one)) warn(`${key}.${level}`, `Routine settings: ${key}.${level} is ${allowed.levels.join(", ")}; the default stands.`);
        }
    } else if (typeof v !== "string" || !allowed.includes(v)) warn(key, `Routine settings: ${key} is ${allowed.join(", ")}; the default stands.`);
  }
  if (Object.keys(raw).length > 0 && !world.packs.castlife) issues.push({ severity: "warning", code: ROUTINE_LINT.pack, path: "routines", message: "The world has routines but not the Cast life pack, which lives them." });
  // Equal precedence, the same block, the same person: the routine with the lower id wins.
  const routines = worldRoutines(world);
  const people = Object.keys(state.entities).sort();
  const told = new Set<string>();
  for (const who of people) {
    const seen = new Map<string, string>();
    for (const def of routines) {
      if (!covers(reg, world, state, def, who)) continue;
      const rank = routineRank(reg, world, state, def);
      for (const b of def.blocks) {
        const key = `${rank}:${b.id}`;
        const first = seen.get(key);
        if (first === undefined) seen.set(key, def.id);
        else if (first !== def.id && !told.has(`${first}:${def.id}:${b.id}`)) {
          told.add(`${first}:${def.id}:${b.id}`);
          issues.push({ severity: "warning", code: ROUTINE_LINT.overlap, path: `routines.${def.id}`, message: `Routines ${first} and ${def.id} both set ${b.id} for ${own(state.entities, who)?.name ?? who} at the same precedence; ${first} wins.` });
        }
      }
    }
  }
  return issues;
}

/**
 * Schedule checks routines lean on (DESIGN §13): an owner that matches nobody, a slot whose times
 * don't read, a source naming lore or a sheet the world doesn't have.
 */
export function schedulesLint(world: WorldDoc, reg: Registry, state: Readonly<WorldState>): LintIssue[] {
  const issues: LintIssue[] = [];
  const time = /^([01]\d|2[0-4]):[0-5]\d$/;
  const sourceIssue = (source: ScheduleDef["source"], path: string, name: string): void => {
    if (source?.type === "lore" && !own(world.lore, source.entry)) issues.push({ severity: "warning", code: ROUTINE_LINT.scheduleSource, path, message: `${name} rests on lore entry ${source.entry}, which the world doesn't have.` });
    if (source?.type === "sheet" && !own(world.entities, source.entity)) issues.push({ severity: "warning", code: ROUTINE_LINT.scheduleSource, path, message: `${name} rests on ${source.entity}'s sheet, who isn't in the world.` });
  };
  for (const s of allSchedules(reg, world)) {
    if (!own(world.schedules, s.id)) continue;
    const at = `schedules.${s.id}`;
    if (s.owner !== undefined && scheduleOwners(reg, world, state, s).length === 0) issues.push({ severity: "warning", code: ROUTINE_LINT.scheduleOwner, path: `${at}.owner`, message: `Schedule ${s.id}'s owner matches nobody as a chat starts, so it moves no one.` });
    sourceIssue(s.source, `${at}.source`, `Schedule ${s.id}`);
    s.slots.forEach((slot, i) => {
      if (!time.test(String(slot.start)) || !time.test(String(slot.end))) issues.push({ severity: "error", code: ROUTINE_LINT.scheduleSlot, path: `${at}.slots.${i}`, message: `Schedule ${s.id}, slot ${i + 1}: its times are HH:MM.` });
      sourceIssue(slot.source, `${at}.slots.${i}.source`, `Schedule ${s.id}, slot ${i + 1}`);
    });
  }
  return issues;
}

/** The chat's own schedules for everyone (`schedule_override` with slots): each the world's schedule with their slots, owned by them. */
export function chatScheduleDefs(ctx: Pick<ReadContext, "registry" | "world" | "state">): ScheduleDef[] {
  const out: ScheduleDef[] = [];
  const all = new Map(allSchedules(ctx.registry, ctx.world).map((s) => [s.id, s]));
  for (const who of Object.keys(objOf(sliceOf(ctx.state, "castlife").schedules)).sort()) {
    for (const [id, c] of Object.entries(chatSchedules(ctx.state, who))) {
      const base = all.get(id);
      if (!base || "off" in c.value) continue;
      out.push({ id: `${id}@${who}`, owner: who, target: base.target, recurrence: c.value.recurrence ?? base.recurrence, slots: c.value.slots, ...(base.pack ? { pack: base.pack } : {}) });
    }
  }
  return out;
}

/** Whether the chat took `who` off a schedule at `at` (`schedule_override`: off, or their own version of it). */
export function scheduleOff(state: Readonly<WorldState>, who: EntityId, schedule: ScheduleId, at: number): boolean {
  const c = own(chatSchedules(state, who), schedule);
  if (!c) return false;
  return "off" in c.value ? c.value.until === null || c.value.until > at : true;
}
