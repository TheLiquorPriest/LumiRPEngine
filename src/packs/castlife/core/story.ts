// What the story changes of someone's routine (DESIGN §8, §9.4): the `routine` narration channel. A
// reply that plainly states a lasting change to someone's week (a new job or shift, a new habit,
// giving one up, moving house) changes their routine as the chat's own change on top of the world's,
// recorded with source `story` and the turn it came from, so the GM sees it among the changes the
// story made and an Undo or a GM edit takes it back. Like every channel it reads the reply alone,
// never a mind (no mind reaches a helper, §24.3), and it is bounded:
//   - whose: a person the POV may know, who still acts, and whom the reply speaks of (the POV, or
//     someone it names: the backend's read checks the naming, since a channel sees no text);
//   - what it names: places and people the world has and the POV may know (one the POV may not is
//     refused as one that doesn't exist, and every refusal is unseen: a routine is a soft default,
//     so a refusal never tells the next reply that something didn't happen);
//   - an authored schedule: a block that would clash with one of their schedules applies only when the
//     reply says it takes the place of what they did then (`replaces`), and then the same change
//     takes them off each schedule it clashes with, so the record says so;
//   - nothing new: a habit only mentioned, already their routine or their schedule, changes nothing.
// A block the story adds is theirs from the next day (`routineCandidates`); what it ends ends now.

import type { EntityId, PlaceId, ScheduleId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { BASIC_BLOCKS, isOff, ROUTINE_EVENTS, type ChatScheduleChange, type RoutineBlock, type RoutineBlockId, type RoutineDays, type RoutineEntry, type RoutinePlace } from "../../../shared/routines";
import type { EffectSpec, ScheduleDef, ScheduleSlot } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, MINUTES_PER_DAY, parseHHMM, recursOn } from "../../../engine/calendar";
import { acts } from "../../../engine/life";
import { objOf, own } from "../../../engine/pack-kit";
import { povMayKnow } from "../../../engine/player-events";
import type { EffectContext, ProposalChannelDef, ReadContext, Rejection } from "../../../engine/registry";
import { chatSchedulesIn, scheduleOwners } from "../../../engine/schedules";
import { isGone, kindIs } from "../../../engine/scope";
import { canSeePlace } from "../../../engine/visibility";
import { activeBlocks, blockOnDay, blockPlace, chatBlocks, routineCandidates, scheduleOff } from "./routines";

/** The proposal type: `routine{entity, change, label, days, start?, end?, minutes?, activity?, place?, with?, replaces?}`. */
export const ROUTINE_CHANNEL = "routine";
/** The effect a story change records with: the chat's own blocks and schedules for someone, with source `story`. */
export const ROUTINE_EFFECT = "castlife.routine";

/** A block the story adds outranks the world's defaults where they overlap (priority 3), never a block that must happen (5). */
const STORY_PRIORITY = 4;
/** A block with no stated time floats through the waking day. */
const WAKING: { from: string; to: string } = { from: "08:00", to: "20:00" };
const DAY_PARTS: Record<string, { from: string; to: string }> = { morning: { from: "06:00", to: "11:00" }, afternoon: { from: "12:00", to: "16:00" }, evening: { from: "17:00", to: "21:00" }, night: { from: "21:00", to: "02:00" } };
/** How long a block of an activity takes when the reply doesn't say. */
const MINUTES: Record<string, number> = { work: 480, school: 360, exercise: 60, leisure: 90, socialize: 120, errand: 45 };
const DEFAULT_MINUTES = 60;
const LABEL_MAX = 60;
const ACTIVITY_MAX = 40;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** Words that say when or how often, never what: they single out no block. */
const FILLER: Record<string, true> = { the: true, and: true, for: true, with: true, his: true, her: true, their: true, its: true, our: true, your: true, from: true, new: true, now: true, every: true, each: true, day: true, days: true, daily: true, week: true, weeks: true, weekly: true, weekday: true, weekdays: true, weekend: true, weekends: true, morning: true, mornings: true, afternoon: true, afternoons: true, evening: true, evenings: true, night: true, nights: true, usual: true };

type Change = "start" | "stop" | "move";
const CHANGES: Record<Change, true> = { start: true, stop: true, move: true };

/** What a story change does: the chat's own changes to one person's blocks and schedules, or their new home. */
export type StoryChange =
  | { entity: EntityId; home: PlaceId }
  | { entity: EntityId; blocks: { block: RoutineBlockId; value: RoutineEntry | null }[]; schedules: { schedule: ScheduleId; value: ChatScheduleChange | null }[] };

interface Span {
  start: number;
  end: number;
}

function refuse(reason: string): Rejection {
  return { code: "routine", reason, unseen: true };
}

function text(v: JsonValue | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A reply's words as a label: letters, digits and plain punctuation only, so no markup, macro or formula rides in it. */
function cleanLabel(v: JsonValue | undefined): string {
  return text(v)
    .replace(/[^\p{L}\p{N} .,'’&()/:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LABEL_MAX)
    .trim();
}

function wordsOf(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !FILLER[w]);
}

/** Whether two texts name the same thing: a word in common, or one the start of the other ("swim", "swimming"). */
function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

/**
 * The days a reply states, as a block's days: every day (`{}`), working days (never on a day off),
 * days off, or weekdays by the calendar's own names ("tue", "Tuesdays", "monday to friday"). Null
 * when they don't read: a day the reply doesn't name is never guessed.
 */
function daysOf(ctx: ReadContext, v: JsonValue | undefined): RoutineDays | null {
  const said = (Array.isArray(v) ? v : [v]).filter((x): x is string | number => typeof x === "string" || typeof x === "number");
  const whole = said.map(String).join(" ").toLowerCase().replace(/\b(?:every|each|on)\b/g, " ").replace(/\s+/g, " ").trim();
  if (/^(daily|everyday|days?|nights?|nightly)$/.test(whole)) return {};
  if (/^(weekdays?|working days?|workdays?)$/.test(whole)) return { off: "never" };
  if (/^(weekends?|days? off)$/.test(whole)) return { off: "only" };
  if (whole === "") return null;
  const names = calendarOf(ctx.world).system.weekdayNames.map((n) => n.toLowerCase());
  // A name in full or in part, either way round: the calendar may keep "Tue" and the reply say
  // "Tuesdays" or "tues", but "monthly" is no Monday.
  const dayOf = (w: string): number => {
    const one = w.replace(/s$/, "");
    return names.findIndex((n) => n === w || n === one || (n.length >= 3 && one.startsWith(n) && (one.endsWith("day") || one.length - n.length <= 2)) || (one.length >= 3 && n.startsWith(one)));
  };
  const weekdays = new Set<number>();
  for (const raw of said) {
    if (typeof raw === "number") {
      if (!Number.isInteger(raw) || raw < 0 || raw >= names.length) return null;
      weekdays.add(raw);
      continue;
    }
    for (const item of raw.toLowerCase().split(/\s*(?:,|;|&|\band\b)\s*/).map((x) => x.replace(/\b(?:every|each|on)\b/g, " ").replace(/\s+/g, " ").trim()).filter((x) => x !== "")) {
      // A name, a span of them ("monday to friday", "mon-fri"), or names in a row ("mon wed fri").
      const range = /^(.+?)\s*(?:-|–|\s(?:to|through|thru)\s)\s*(.+)$/.exec(item);
      const span = dayOf(item) < 0 && range ? [dayOf((range[1] ?? "").trim()), dayOf((range[2] ?? "").trim())] : null;
      if (span && span[0] !== undefined && span[1] !== undefined && span[0] >= 0 && span[1] >= 0) {
        for (let i = span[0]; ; i = (i + 1) % names.length) {
          weekdays.add(i);
          if (i === span[1]) break;
        }
        continue;
      }
      const each = dayOf(item) >= 0 ? [dayOf(item)] : item.split(/\s+/).map(dayOf);
      if (each.some((i) => i < 0)) return null;
      for (const i of each) weekdays.add(i);
    }
  }
  return { weekdays: [...weekdays].sort((a, b) => a - b) };
}

/** A place a reply names, by id or by its name, among the places the POV may know: one it may not reads as none. */
function placeOf(ctx: ReadContext, v: JsonValue | undefined): PlaceId | null {
  const said = text(v);
  if (said === "") return null;
  const mayKnow = (id: string): boolean => own(ctx.world.places, id) !== undefined && canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
  if (mayKnow(said)) return said;
  const named = Object.keys(ctx.world.places).filter((id) => own(ctx.world.places, id)?.name.toLowerCase() === said.toLowerCase() && mayKnow(id));
  return named.length === 1 ? (named[0] ?? null) : null;
}

/** The first day a block the story adds is theirs: the one after the turn's. */
function firstDay(ctx: ReadContext): number {
  return dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex + 1;
}

/** The week of days from `from` a block is on for someone. */
function weekOf(ctx: ReadContext, who: EntityId, block: RoutineBlock, from: number): number[] {
  const out: number[] = [];
  for (let d = from; d < from + 7; d++) if (blockOnDay(ctx, who, block, d)) out.push(d);
  return out;
}

/** A fixed block's spans on the days given. */
function blockSpans(ctx: ReadContext, block: RoutineBlock, days: readonly number[]): Span[] {
  if (block.kind !== "fixed" || !block.at) return [];
  const cal = calendarOf(ctx.world);
  const at = parseHHMM(block.at);
  return days.map((d) => ({ start: clockAt(cal, d, at), end: clockAt(cal, d, at) + block.minutes }));
}

/** A schedule's slots on the days around `days` (the day before and after too, for slots and blocks that run past midnight), with the slot each span is. */
function slotSpans(ctx: ReadContext, schedule: ScheduleDef, days: readonly number[]): { span: Span; slot: ScheduleSlot }[] {
  const cal = calendarOf(ctx.world);
  const out: { span: Span; slot: ScheduleSlot }[] = [];
  for (const d of new Set(days.flatMap((x) => [x - 1, x, x + 1]))) {
    if (!recursOn(cal, schedule.recurrence, d)) continue;
    for (const slot of schedule.slots) {
      if (!HHMM.test(slot.start) || !(HHMM.test(slot.end) || slot.end === "24:00")) continue;
      const s = clockAt(cal, d, parseHHMM(slot.start));
      let e = clockAt(cal, d, parseHHMM(slot.end));
      if (e <= s) e += MINUTES_PER_DAY;
      out.push({ span: { start: s, end: e }, slot });
    }
  }
  return out;
}

function overlaps(a: readonly Span[], b: readonly Span[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

/**
 * The schedules that set someone's place or activity, as a chat now has them: each under the id a
 * chat change names (their own version `id@who` is the world's `id`), leaving out one the chat took
 * them off.
 */
function theirSchedules(ctx: ReadContext, who: EntityId): { id: ScheduleId; def: ScheduleDef }[] {
  const out: { id: ScheduleId; def: ScheduleDef }[] = [];
  for (const def of chatSchedulesIn(ctx)) {
    if ((def.target !== "place" && def.target !== "activity") || !scheduleOwners(ctx.registry, ctx.world, ctx.state, def).includes(who)) continue;
    const at = def.id.indexOf("@");
    if (at >= 0) out.push({ id: def.id.slice(0, at), def });
    else if (!scheduleOff(ctx.state, who, def.id, ctx.state.clock)) out.push({ id: def.id, def });
  }
  return out;
}

/** The person a change is for: someone the POV may know, who still acts; the reason otherwise. */
function personOf(ctx: ReadContext, p: JsonObject): EntityId | Rejection {
  const who = text(p.entity);
  const e = own(ctx.state.entities, who);
  if (!e || isGone(ctx.state, who) || !povMayKnow(ctx.registry, ctx.world, ctx.state, who)) return refuse("there's no one by that name");
  if (!kindIs(ctx.registry, ctx.world, e.kind, "person")) return refuse(`${e.name} has no routine: only people do`);
  if (!acts(ctx.world, ctx.state, who)) return refuse(`${e.name} keeps no routine now`);
  return who;
}

/** The block a `start` lays: what the reply says, with nothing invented but how long it takes and where, when it doesn't say. */
function startBlock(ctx: ReadContext, who: EntityId, p: JsonObject): RoutineBlock | Rejection {
  const label = cleanLabel(p.label);
  if (label === "") return refuse("a new routine needs what it is");
  const days = daysOf(ctx, p.days);
  if (!days) return refuse("the reply doesn't say which days");
  const said = text(p.activity)
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .slice(0, ACTIVITY_MAX)
    .trim();
  const activity = said !== "" ? said : /\b(job|shift|work|works|working)\b/i.test(label) ? "work" : /\b(school|class|classes|course)\b/i.test(label) ? "school" : label.toLowerCase().slice(0, ACTIVITY_MAX);
  // A basic need the reply moves ("she sleeps days now") is that need, replaced.
  const basic = BASIC_BLOCKS.find((b) => b.activity === activity);
  const id = basic?.id ?? `story_${wordsOf(label).join("_").slice(0, ACTIVITY_MAX) || "block"}`;
  const start = text(p.start).toLowerCase();
  const end = text(p.end);
  const hm = HHMM.exec(start);
  const at = hm ? `${(hm[1] ?? "").padStart(2, "0")}:${hm[2] ?? "00"}` : null;
  const part = at === null && start !== "" ? DAY_PARTS[start] : undefined;
  if (at === null && start !== "" && !part) return refuse("its time doesn't read");
  const endHm = HHMM.exec(end);
  const stated = typeof p.minutes === "number" && Number.isInteger(p.minutes) ? p.minutes : null;
  const minutes = at !== null && endHm ? (parseHHMM(`${(endHm[1] ?? "").padStart(2, "0")}:${endHm[2] ?? "00"}`) - parseHHMM(at) + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY : (stated ?? MINUTES[activity] ?? basic?.minutes ?? DEFAULT_MINUTES);
  if (minutes < 1 || minutes > MINUTES_PER_DAY) return refuse("its length is a day at most");
  // A place it names, or their home or work; else where the reply leaves it: their work for a job, and wherever they are for anything else, so the block moves no one the reply didn't.
  const keyword = text(p.place).toLowerCase();
  const named = keyword === "home" || keyword === "work" ? null : placeOf(ctx, p.place);
  if (named === null && keyword !== "" && keyword !== "home" && keyword !== "work") return refuse("there's no such place");
  const place: RoutinePlace = named !== null ? { place: named } : keyword === "home" || keyword === "work" ? keyword : activity === "work" ? "work" : basic ? (basic.place ?? "home") : "here";
  const company: EntityId[] = [];
  for (const raw of Array.isArray(p.with) ? p.with : []) {
    const id = text(raw);
    const e = own(ctx.state.entities, id);
    if (!e || isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, e.kind, "person") || !povMayKnow(ctx.registry, ctx.world, ctx.state, id)) return refuse("there's no one by that name");
    if (id !== who && !company.includes(id)) company.push(id);
  }
  return {
    id,
    label,
    activity,
    kind: at !== null ? "fixed" : "flexible",
    ...(at !== null ? { at } : { window: part ?? WAKING }),
    minutes,
    priority: STORY_PRIORITY,
    ...(Object.keys(days).length > 0 ? { days } : {}),
    place,
    ...(company.length > 0 ? { company: { who: { ids: company } } } : {}),
  };
}

/** Whether a block is already theirs: the chat holds it as it is, or a block of their routine by that name is on its days at its time, or a schedule takes them where it happens on each of its days. */
function already(ctx: ReadContext, who: EntityId, block: RoutineBlock, days: readonly number[]): boolean {
  const held = own(chatBlocks(ctx.state, who), block.id);
  if (held && JSON.stringify(held.value) === JSON.stringify(block)) return true;
  const mine = blockSpans(ctx, block, days);
  const words = wordsOf(block.label);
  for (const { block: b, from } of activeBlocks(ctx, who, days[0])) {
    if (b.id === block.id || from.level === "builtin") continue;
    if (!sameWords(words, wordsOf(b.label)) || !days.every((d) => blockOnDay(ctx, who, b, d))) continue;
    if (mine.length === 0 || b.kind !== "fixed" || overlaps(mine, blockSpans(ctx, b, days))) return true;
  }
  if (block.kind === "fixed" || !block.place || typeof block.place !== "object" || !("place" in block.place)) return false;
  const where = block.place.place;
  return theirSchedules(ctx, who).some(({ def }) => def.target === "place" && days.every((d) => slotSpans(ctx, def, [d]).some((s) => s.slot.value === where && dateAt(calendarOf(ctx.world), s.span.start).dayIndex === d)));
}

/** A new job, shift or habit: the block, and what it takes the place of when the reply says it does. */
function startChange(ctx: ReadContext, who: EntityId, p: JsonObject): StoryChange | Rejection {
  const block = startBlock(ctx, who, p);
  if ("code" in block) return block;
  const days = weekOf(ctx, who, block, firstDay(ctx));
  if (days.length === 0) return refuse("it falls on no day of the week");
  if (already(ctx, who, block, days)) return refuse("it's already their routine");
  const mine = blockSpans(ctx, block, days);
  const clashing = theirSchedules(ctx, who).filter(({ def }) => overlaps(mine, slotSpans(ctx, def, days).map((s) => s.span)));
  const replaces = p.replaces === true;
  if (clashing.length > 0 && !replaces) return refuse("it clashes with their schedule, and the reply doesn't say it takes its place");
  const schedules = [...new Set(clashing.map((c) => c.id))].map((schedule) => ({ schedule, value: { off: true as const, until: null } }));
  // What it takes the place of in their routine: the fixed blocks it overlaps (not a basic need, nor a private block: the reply can't know of one).
  const blocks: { block: RoutineBlockId; value: RoutineEntry | null }[] = [];
  if (replaces) {
    const candidates = routineCandidates(ctx, who);
    for (const { block: b, from } of activeBlocks(ctx, who, days[0])) {
      if (b.id === block.id || from.level === "builtin" || b.private === true || !overlaps(mine, blockSpans(ctx, b, days))) continue;
      blocks.push({ block: b.id, value: (candidates.get(b.id) ?? []).every((a) => a.level === "chat") ? null : { id: b.id, off: true } });
    }
  }
  blocks.push({ block: block.id, value: block });
  return { entity: who, blocks, schedules };
}

/**
 * Something they gave up: the blocks of their routine it names (by what they're called, or where they
 * happen) and the slots of their schedules at the place it names, with the slots of their activity
 * schedules at the same times. With days said, only what falls on none but those days: the rest of a
 * week isn't the reply's to end. A private block isn't the story's to end: the reply can't know of it.
 */
function stopChange(ctx: ReadContext, who: EntityId, p: JsonObject): StoryChange | Rejection {
  const cal = calendarOf(ctx.world);
  const words = wordsOf(cleanLabel(p.label));
  const where = placeOf(ctx, p.place);
  if (where === null && text(p.place) !== "") return refuse("there's no such place");
  if (words.length === 0 && where === null) return refuse("the reply doesn't say what they gave up");
  const stated = p.days === undefined || p.days === null ? {} : daysOf(ctx, p.days);
  if (!stated) return refuse("the reply doesn't say which days");
  const from = dateAt(cal, ctx.state.clock).dayIndex;
  const week = [0, 1, 2, 3, 4, 5, 6].map((i) => from + i);
  const probe: RoutineBlock = { id: "", label: "", activity: "", kind: "flexible", window: WAKING, minutes: 1, ...(Object.keys(stated).length > 0 ? { days: stated } : {}) };
  const allowed = new Set(weekOf(ctx, who, probe, from));
  const within = (on: readonly number[]): boolean => on.length > 0 && on.every((d) => allowed.has(d));
  const blocks: { block: RoutineBlockId; value: RoutineEntry | null }[] = [];
  for (const [id, list] of routineCandidates(ctx, who)) {
    const top = list[0];
    if (!top || isOff(top.entry) || top.entry.private === true) continue;
    const b = top.entry;
    const named = (where !== null && blockPlace(ctx, who, b) === where) || (words.length > 0 && sameWords(words, wordsOf(b.label)));
    if (!named || !within(weekOf(ctx, who, b, from))) continue;
    blocks.push({ block: id, value: list.every((a) => a.level === "chat") ? null : { id, off: true } });
  }
  const cut = (s: ScheduleDef, drop: (slot: ScheduleSlot) => boolean): ChatScheduleChange => {
    const left = s.slots.filter((slot) => !drop(slot));
    return left.length === 0 ? { off: true, until: null } : { slots: left, recurrence: s.recurrence };
  };
  const schedules: { schedule: ScheduleId; value: ChatScheduleChange | null }[] = [];
  const mine = where === null ? [] : theirSchedules(ctx, who);
  for (const { id, def } of mine) {
    const gone = def.slots.filter((s) => s.value === where);
    if (def.target !== "place" || gone.length === 0 || !within(week.filter((d) => recursOn(cal, def.recurrence, d)))) continue;
    schedules.push({ schedule: id, value: cut(def, (slot) => slot.value === where) });
    // What they did there goes with it: their activity schedule's slots at the same times, on the same days.
    const paired = (slot: ScheduleSlot): boolean => gone.some((g) => g.start === slot.start && g.end === slot.end);
    for (const other of mine) {
      if (other.def.target !== "activity" || JSON.stringify(other.def.recurrence) !== JSON.stringify(def.recurrence) || !other.def.slots.some(paired) || schedules.some((s) => s.schedule === other.id)) continue;
      schedules.push({ schedule: other.id, value: cut(other.def, paired) });
    }
  }
  if (blocks.length === 0 && schedules.length === 0) return refuse("nothing of their routine is what the reply says they gave up");
  return { entity: who, blocks, schedules };
}

/** What a `routine` proposal changes (DESIGN §9.4), or why it changes nothing. */
export function storyChange(p: JsonObject, ctx: ReadContext): StoryChange | Rejection {
  const who = personOf(ctx, p);
  if (typeof who !== "string") return who;
  const change = text(p.change).toLowerCase();
  if (!(change in CHANGES)) return refuse("a routine change starts, stops or moves house");
  if (change === "start") return startChange(ctx, who, p);
  if (change === "stop") return stopChange(ctx, who, p);
  const home = placeOf(ctx, p.place);
  if (home === null) return refuse("there's no such place");
  if (own(ctx.state.entities, who)?.fields.home === home) return refuse("it's already their home");
  return { entity: who, home };
}

/** The `routine` narration channel (DESIGN §9.4). */
export const routineChannel: ProposalChannelDef = {
  type: ROUTINE_CHANNEL,
  boundField: "routine",
  validate(p, ctx) {
    const change = storyChange(p, ctx);
    return "code" in change ? change : null;
  },
  toEffects(p, ctx): EffectSpec[] {
    const change = storyChange(p, ctx);
    if ("code" in change) return [];
    // Moving house moves every block at home with them, the schedules' rest place included.
    if ("home" in change) return [{ type: "set", args: { entity: change.entity, field: "home", value: change.home } }];
    const turn = text(p.turn);
    // A change the player's own message stated, which the player said yes to adding, says so (`by`).
    return [{ type: ROUTINE_EFFECT, args: { entity: change.entity, blocks: change.blocks as unknown as JsonValue, schedules: change.schedules as unknown as JsonValue, ...(turn !== "" ? { turn } : {}), ...(p.by === "player" ? { by: "player" } : {}) } }];
  },
};

/**
 * The `castlife.routine` effect: the chat's own changes to someone's routine and schedules, with
 * source `story` (the turn whose reply made them, when known) at the clock. Each change is the event
 * the GM's controls write too, so an Undo, a GM edit and both folds read them alike; the events'
 * own checks refuse a block or a schedule change that doesn't read.
 */
export function storyEvents(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const who = text(args.entity);
  const e = own(ctx.state.entities, who);
  if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "person")) return { code: "not_person", reason: "only people have a routine" };
  const turn = text(args.turn);
  const source: JsonObject = { type: "story", at: ctx.state.clock, ...(turn !== "" ? { turn } : {}), ...(args.by === "player" ? { by: "player" } : {}) };
  const list = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.filter(isRecord).map(objOf) : []);
  return [
    ...list(args.schedules).map((s): LedgerEvent => ({ type: ROUTINE_EVENTS.schedule, data: { entity: who, schedule: text(s.schedule), value: s.value ?? null, source } })),
    ...list(args.blocks).map((b): LedgerEvent => ({ type: ROUTINE_EVENTS.block, data: { entity: who, block: text(b.block), value: b.value ?? null, source } })),
  ];
}
