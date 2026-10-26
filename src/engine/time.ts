// Time progression (DESIGN §9.2 Time, D29): the per-turn elapsed time, time controls, Timelapse
// with its interrupt policy and unit cap, Speed through, the `time.advance` channel, the clock's ✎
// fix and the Montage. Deterministic by default: nothing here needs a model call.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { hashParts } from "../shared/hash";
import type { EntityId, InterruptClass, InterruptPolicy, SceneTypeId } from "../shared/ids";
import { heldBy } from "../shared/finance";
import { INTERRUPT_CLASSES } from "../shared/ids";
import type { LedgerEvent, TimelapseEvent, TimelapseTarget } from "../shared/ledger";
import { activitySpanEnd, type WorldDoc } from "../shared/world";
import { calendarOf, clockAt, clockOfStamp, dateAt, formatClock, MINUTES_PER_DAY, nextTimeOfDay, placeOffset, shortestSlot, slotIndexAt, slotStart, type Calendar } from "./calendar";
import { ENGINE_EVENTS, readEngineSlice, signalOf, type Signal } from "./engine-pack";
import type { ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { allSchedules, nextStartFor, scheduleOwners } from "./schedules";
import { bandOf, fieldDef, placeOfEntity } from "./scope";
import { advance, ALL_NOTE, coarsen, lod1Agents, type AdvanceResult } from "./simulate";
import type { WorldState } from "./state";
import { optionalQuery, own } from "./pack-kit";
import { playerEventVisible, playerKnows } from "./player-events";
import { canSeeField } from "./visibility";
import { Working } from "./working";
import { clampScale, clampThreshold, clampTick, clampUnitCap, TIME_LIMITS } from "./time-limits";
import { fieldNoun, possessive } from "../shared/words";

export const DEFAULT_SCENE_TYPE = "conversation";

/** The engine's own scene types, ticked by default (Settings → Time); a world may add its own. */
export const ENGINE_SCENE_TYPES: readonly SceneTypeId[] = [DEFAULT_SCENE_TYPE, "action", "exploration", "downtime"];

// ---------------------------------------------------------------- scene, pause and elapsed time

/** The scene type: the POV's `scene` field (actions, ✎ fixes), else its place's default. */
export function sceneType(world: WorldDoc, state: Readonly<WorldState>): SceneTypeId {
  const pov = own(state.entities, world.pov);
  const scene = pov?.fields.scene;
  if (typeof scene === "string" && scene !== "") return scene;
  return placeSceneType(world, state);
}

/** The scene type the POV's place (or an ancestor) sets, else conversation: what a cleared `scene` field follows. */
export function placeSceneType(world: WorldDoc, state: Readonly<WorldState>): SceneTypeId {
  let place: string | undefined = placeOfEntity(state, world.pov) ?? undefined;
  for (let guard = 0; place && guard < 32; guard++) {
    const def = own(world.places, place);
    if (def?.sceneType) return def.sceneType;
    place = def?.parent;
  }
  return DEFAULT_SCENE_TYPE;
}

/** Identifies "the current scene" for the clock pause: the POV's place and scene type. */
export function sceneKey(world: WorldDoc, state: Readonly<WorldState>): string {
  return `${placeOfEntity(state, world.pov) ?? ""}|${sceneType(world, state)}`;
}

/** Paused applies to the scene it was paused in; a scene change resumes the clock (DESIGN §9.2). */
export function clockPaused(world: WorldDoc, state: Readonly<WorldState>): boolean {
  if (!state.time.paused) return false;
  const scene = readEngineSlice(state).pauseScene;
  return scene === null || scene === sceneKey(world, state);
}

/**
 * Whether a fight holds the clock: the POV is in one under way (the combat pack's `combat.engaged`),
 * and its rounds take no clock time (DESIGN §11), so no skip ahead, told or asked for, applies.
 */
export function fightHoldsClock(ctx: ReadContext): boolean {
  return optionalQuery(ctx, "combat.engaged")?.(ctx, ctx.world.pov) === true;
}

/** Why nothing skips ahead during a fight, as the player reads it. */
export const IN_FIGHT = "a fight is under way";

/** Bookkeeping that pins a fresh pause to the current scene, or clears a lifted one. */
export function pauseBookkeeping(world: WorldDoc, state: Readonly<WorldState>): LedgerEvent[] {
  const scene = readEngineSlice(state).pauseScene;
  if (state.time.paused && scene === null) return [{ type: ENGINE_EVENTS.pause, data: { scene: sceneKey(world, state) } }];
  if (!state.time.paused && scene !== null) return [{ type: ENGINE_EVENTS.pause, data: { scene: null } }];
  return [];
}

/** The scene's default tick × the time scale (time scale applies to ticks only), at most a day. */
export function tickMinutes(world: WorldDoc, state: Readonly<WorldState>): number {
  const type = sceneType(world, state);
  const tick = clampTick(own(state.time.sceneTicks, type) ?? own(world.time.sceneTicks, type) ?? own(state.time.sceneTicks, DEFAULT_SCENE_TYPE) ?? 2);
  return Math.min(TIME_LIMITS.tickMinutes, tick * clampScale(state.time.scale));
}

export interface TurnTime {
  minutes: number;
  source: "paused" | "action" | "tick";
}

/** Every turn's elapsed time: the action's duration, else the scene tick × scale; zero while paused. */
export function turnElapsed(world: WorldDoc, state: Readonly<WorldState>, actionMinutes: number | null): TurnTime {
  if (clockPaused(world, state)) return { minutes: 0, source: "paused" };
  if (actionMinutes !== null) return { minutes: Number.isFinite(actionMinutes) ? Math.min(TIME_LIMITS.timelapseMinutes, Math.max(0, actionMinutes)) : 0, source: "action" };
  return { minutes: tickMinutes(world, state), source: "tick" };
}

// ---------------------------------------------------------------- timelapse targets

/** "Until something happens" and "until a stage" look this far ahead at most (the unit cap bounds it further). */
export const DEFAULT_HORIZON = 7 * MINUTES_PER_DAY;

/** A target from an intent, or null when it is malformed. */
export function parseTarget(v: JsonValue | undefined): TimelapseTarget | null {
  if (!isRecord(v)) return null;
  const t = v as JsonObject;
  const str = (k: string): string | null => (typeof t[k] === "string" && t[k] !== "" ? (t[k] as string) : null);
  const num = (k: string): number | null => (typeof t[k] === "number" && Number.isFinite(t[k]) ? (t[k] as number) : null);
  switch (t.type) {
    case "duration": {
      const minutes = num("minutes");
      return minutes !== null && minutes > 0 ? { type: "duration", minutes } : null;
    }
    case "day_part": {
      const dayPart = str("dayPart");
      return dayPart ? { type: "day_part", dayPart } : null;
    }
    case "at": {
      const at = num("at");
      return at !== null ? { type: "at", at } : null;
    }
    case "stage": {
      const track = str("track");
      const stage = str("stage");
      return track && stage ? { type: "stage", track, stage } : null;
    }
    case "shift":
    case "commitment":
    case "arrival":
    case "interrupt":
      return { type: t.type };
    default:
      return null;
  }
}

/** Schedule targets whose slots are commitments. */
const COMMITMENT_TARGETS = new Set(["activity", "commitment", "shift"]);
const IDLE = new Set(["", "idle", "free", "home", "sleep"]);
const SHIFT = /shift|work/i;

export interface ResolvedTarget {
  to: number;
  label: string;
  stopWhen?: (w: Working) => boolean;
}

/** The POV's next commitment start (a shift when `shiftOnly`) from its activity schedules, or null. */
export function nextCommitment(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, shiftOnly: boolean): { at: number; label: string } | null {
  let best: { at: number; label: string } | null = null;
  const ctx = reg.context(world, state);
  for (const s of allSchedules(reg, world)) {
    if (!COMMITMENT_TARGETS.has(s.target)) continue;
    if (!scheduleOwners(reg, world, state, s).includes(who)) continue;
    let probe = state.clock;
    for (let i = 0; i < 16; i++) {
      const n = nextStartFor(reg, ctx, s, who, probe);
      if (!n) break;
      const v = n.slot.value ?? n.slot.weighted?.[0]?.value;
      if (typeof v === "string" && !IDLE.has(v) && (!shiftOnly || SHIFT.test(v))) {
        if (!best || n.at < best.at) best = { at: n.at, label: v.replace(/_/g, " ") };
        break;
      }
      probe = n.at;
    }
  }
  return best;
}

/**
 * Resolves a target to a clock reading. At Calendar level 1 a time target rounds up to the next
 * day part; at level 0 there is no timelapse.
 */
export function resolveTarget(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, target: TimelapseTarget): ResolvedTarget | Rejection {
  const level = reg.context(world, state).levelOf(world.pov, "calendar");
  if (level < 1) return { code: "calendar_off", reason: "Calendar & time is off" };
  const cal = calendarOf(world);
  const now = state.clock;
  let to: number;
  let label: string;
  let stopWhen: ResolvedTarget["stopWhen"];
  switch (target.type) {
    case "duration":
      to = now + target.minutes;
      label = `${target.minutes} min`;
      break;
    case "day_part": {
      const idx = cal.dayParts.findIndex((p) => p.id === target.dayPart);
      if (idx < 0) return { code: "bad_target", reason: `no day part ${target.dayPart}` };
      to = nextTimeOfDay(cal, now, cal.partStarts[idx] ?? 0);
      label = cal.dayParts[idx]?.label ?? target.dayPart;
      break;
    }
    case "at":
      to = target.at;
      label = formatClock(cal, target.at);
      break;
    case "shift":
    case "commitment": {
      const next = nextCommitment(reg, world, state, world.pov, target.type === "shift");
      if (!next) return { code: "no_commitment", reason: target.type === "shift" ? "no upcoming shift" : "no upcoming commitment" };
      to = next.at;
      label = next.label;
      break;
    }
    case "arrival": {
      const until = activitySpanEnd(own(state.entities, world.pov)?.fields);
      if (until === null || until <= now) return { code: "no_trip", reason: "no active trip" };
      to = until;
      label = "arrival";
      break;
    }
    case "stage": {
      const t = own(world.tracks, target.track);
      if (!t || !own(t.stages, target.stage)) return { code: "bad_target", reason: `no stage ${target.stage} in ${target.track}` };
      if ((own(state.tracks, target.track)?.stage ?? t.start) === target.stage) return { code: "already", reason: "already at that stage" };
      to = now + DEFAULT_HORIZON;
      label = `${t.label}: ${own(t.stages, target.stage)?.label ?? target.stage}`;
      stopWhen = (w) => (own(w.state.tracks, target.track)?.stage ?? t.start) === target.stage;
      break;
    }
    case "interrupt":
      to = now + DEFAULT_HORIZON;
      label = "something happens";
      break;
  }
  if (level <= 1 && target.type !== "stage" && target.type !== "interrupt") {
    const k = slotIndexAt(cal, to);
    if (slotStart(cal, k) < to) to = slotStart(cal, k + 1);
  }
  if (!Number.isFinite(to) || to <= now) return { code: "past", reason: "that time has passed" };
  if (to - now > TIME_LIMITS.timelapseMinutes) return { code: "too_long", reason: `a timelapse reaches at most ${TIME_LIMITS.timelapseMinutes / MINUTES_PER_DAY} days ahead` };
  return { to, label, ...(stopWhen ? { stopWhen } : {}) };
}

// ---------------------------------------------------------------- typed spans

/** A "next" day part closer than this is the one after it: "sleep until the next morning" at 07:14 means tomorrow's. */
const NEXT_DAY_PART_GAP = 180;

/**
 * "The next <day part>" (by its index in the calendar's day parts) as a target: its coming start,
 * or the one after that when the coming one is under three hours away, so "sleep until the next
 * morning" at 07:14 sleeps the night (DESIGN §9.2).
 */
export function nextDayPart(cal: Calendar, now: number, index: number): TimelapseTarget {
  const start = cal.partStarts[index] ?? 0;
  const at = nextTimeOfDay(cal, now, start);
  return { type: "at", at: at - now < NEXT_DAY_PART_GAP ? nextTimeOfDay(cal, at, start) : at };
}

/** Counts a typed span gives before its unit ("two hours", "a couple of hours"); "next" is one ("the next hour"). */
const SPAN_COUNTS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, next: 1, "a couple of": 2, "couple of": 2, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty five": 45, ninety: 90 };
/** Minutes in each unit a typed span names, by its singular. */
const SPAN_UNITS: Readonly<Record<string, number>> = { minute: 1, min: 1, hour: 60, hr: 60, day: MINUTES_PER_DAY, week: 7 * MINUTES_PER_DAY };
const longestFirst = (words: readonly string[]): string => [...words].sort((a, b) => b.length - a.length).join("|");
/** A name as typed text is read: lower case, anything but letters and digits a space. */
const plain = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** One length of time: a count, a unit, and "and a half" before or after the unit ("two and a half hours", "an hour and a half"). */
const SPAN_TERM = new RegExp(` (${longestFirst(Object.keys(SPAN_COUNTS))}|\\d+(?:\\.\\d+)?)( and a half)? (${longestFirst(Object.keys(SPAN_UNITS))})s?( and a half)?(?= )`, "g");
/** Words just before a length that make it no span ahead: one gone by ("the last two hours"), a rate ("every hour", "$20 an hour"). */
const SPAN_NOT_BEFORE = / (?:last|past|previous|every|per|each|\d+(?:\.\d+)?)$/;
/** Words just after a length that make it no span ahead: one gone by ("two hours ago", "an hour already"), an age ("a four day old"). */
const SPAN_NOT_AFTER = /^ (?:ago|earlier|before|already|back|previously|old)(?= )/;
/** How far either side of a length those words are looked for: a word or two, whatever the message's length. */
const SPAN_CONTEXT = 24;
/** A day and time in the words ("Friday at 6 PM", "at 8", "18:00", "1:45p", "noon", "the 18th"): the read's stated time, never half-read here. */
const STATED_TIME = / \d{1,2}:\d{2}| (?:\d{1,2} ?(?:am|pm)|o clock|at \d+|noon|midnight|\d{1,2}(?:st|nd|rd|th)|\d{4} \d{1,2} \d{1,2})(?= )/;
/** How a part of the day is led: up to it, later the same day, the coming one counted as "next", or tomorrow's. */
const PART_LEADS: Readonly<Record<string, "until" | "today" | "next" | "tomorrow">> = { until: "until", till: "until", til: "until", to: "until", by: "until", "later that": "today", "later this": "today", "later in the": "today", that: "today", this: "today", next: "next", following: "next", tomorrow: "tomorrow" };
/** Up to the player character's next shift or commitment ("until my next shift", "till work", "until my appointment"). */
const COMMITMENT_SPAN = / (?:until|till|til)(?: my| the| our)?(?: next)? (shift|work|commitment|appointment)s?(?= )/g;
/**
 * Minutes a vague span stands for (DESIGN §9.2 typed time), read like a length stated in numbers:
 * players say "a few minutes later" or "after a while" more often than they count.
 */
const VAGUE_SPANS: Readonly<Record<string, number>> = { "a moment": 5, "a few moments": 5, "a few minutes": 5, "a little while": 15, "a while": 30, "a few hours": 180 };
const VAGUE_SPAN = new RegExp(` (${longestFirst(Object.keys(VAGUE_SPANS))})(?= )`, "g");

/** A moment of the player character's own day a typed span runs up to: a meal, bedtime, or the morning he wakes. */
export type SpanAnchor = "breakfast" | "lunch" | "dinner" | "bedtime" | "morning";
/** The words that name an anchor. */
const ANCHOR_WORDS: Readonly<Record<string, SpanAnchor>> = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", supper: "dinner", bedtime: "bedtime", morning: "morning" };
/** The calendar's part of the day an anchor falls back to when his day has no block for it: the first of these the calendar has. */
const ANCHOR_PARTS: Readonly<Record<SpanAnchor, readonly string[]>> = { breakfast: ["morning"], lunch: ["midday", "afternoon"], dinner: ["evening"], bedtime: ["night"], morning: ["morning"] };
/** Up to an anchor: "until dinner", "till bedtime", "skip ahead to lunch", "until the morning". */
const ANCHOR_SPAN = new RegExp(` (?:until|till|til|to|by)(?: the| my| our)? (${longestFirst(Object.keys(ANCHOR_WORDS))})(?= )`, "g");

/**
 * The timelapse target a span typed in the player's own words names (DESIGN §9.2 typed time),
 * read the same way every time:
 * - a length: "over the next hour", "for the next two hours", "half an hour", "an hour and a half",
 *   "three hours later"; a vague one by `VAGUE_SPANS` ("a few minutes later" is 5 minutes, "a while"
 *   30, "a few hours" 180); one gone by ("two hours ago") or a rate ("every hour") is none;
 * - a part of the day: "skip ahead to evening", "until the afternoon" (its coming start, as the
 *   Timelapse sheet's Until runs it); "later that night", "this evening" and "tonight" only while
 *   that part is still ahead today; "the next morning" by `nextDayPart`; "tomorrow evening" that
 *   part tomorrow (before the day's first part it is still last night, so tomorrow is today);
 * - an anchor of the player character's own day: "until dinner", "until lunch", "until breakfast",
 *   "until bedtime" and "until morning" run to when `anchorAt` says his day has it (the start of his
 *   meal or his bed, the end of his night's sleep), else to the calendar's matching part of the day;
 * - the next shift or commitment: "until my next shift", "till work", "until my appointment".
 *
 * It is read only once `interpret` has chosen to let time pass, so it never decides whether typed
 * text is a time skip. Words that also name a day and time ("Friday at 6 PM") are left to the
 * read's stated time; words that name no span ("for some time"), or two different ones, read as none.
 */
export function typedSpan(cal: Calendar, now: number, words: string, anchorAt?: (anchor: SpanAnchor) => number | null): TimelapseTarget | null {
  // A sentence's or a clause's end stays as a break ("|"), so lengths either side of it never add up;
  // a decimal point stays as it is.
  const t = ` ${words
    .toLowerCase()
    .replace(/([ap])\.\s?m\.?/g, "$1m")
    .replace(/(?<!\d)[.,;!?]|[.,;!?](?!\d)/g, " | ")
    .replace(/[^a-z0-9.:|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `
    .replace(/ (?:a |an )?half (?:an? )?hour(?= )/g, " 30 minutes")
    .replace(/ (?:a |an )?quarter (?:of )?(?:an? )?hour(?= )/g, " 15 minutes");
  const weekdays = cal.system.weekdayNames.map(plain).filter((n) => n.length > 3);
  const months = cal.system.monthNames.map(plain).filter((n) => n !== "");
  if (STATED_TIME.test(t) || weekdays.some((d) => t.includes(` ${d} `)) || months.some((m) => new RegExp(` (?:${m} \\d|\\d+ (?:of )?${m} )`).test(t))) return null;
  const found: TimelapseTarget[] = [];
  const lengths: { start: number; end: number; minutes: number }[] = [];
  for (const m of t.matchAll(SPAN_TERM)) {
    const count = m[1] ?? "";
    const unit = SPAN_UNITS[m[3] ?? ""] ?? 0;
    // "The next day" names a day, not a length of one.
    if ((count === "next" && unit >= MINUTES_PER_DAY) || SPAN_NOT_BEFORE.test(t.slice(Math.max(0, m.index - SPAN_CONTEXT), m.index))) continue;
    lengths.push({ start: m.index, end: m.index + m[0].length, minutes: ((SPAN_COUNTS[count] ?? Number(count)) + (m[2] || m[4] ? 0.5 : 0)) * unit });
  }
  for (const m of t.matchAll(VAGUE_SPAN)) {
    if (SPAN_NOT_BEFORE.test(t.slice(Math.max(0, m.index - SPAN_CONTEXT), m.index))) continue;
    lengths.push({ start: m.index, end: m.index + m[0].length, minutes: VAGUE_SPANS[m[1] ?? ""] ?? 0 });
  }
  lengths.sort((a, b) => a.start - b.start);
  // Lengths side by side ("an hour and twenty minutes") add up as one.
  const runs: { end: number; minutes: number }[] = [];
  for (const length of lengths) {
    const last = runs.at(-1);
    if (last && /^(?: and)?$/.test(t.slice(last.end, length.start))) {
      last.end = length.end;
      last.minutes += length.minutes;
    } else runs.push({ end: length.end, minutes: length.minutes });
  }
  for (const run of runs) if (run.minutes > 0 && !SPAN_NOT_AFTER.test(t.slice(run.end, run.end + SPAN_CONTEXT))) found.push({ type: "duration", minutes: Math.round(run.minutes) });
  // An anchor of his own day: his block for it, else the calendar's part, so "until dinner" runs to
  // his dinner rather than to the evening's start. It reads before "until <part>" ("until morning").
  const anchored = new Set<number>();
  for (const m of t.matchAll(ANCHOR_SPAN)) {
    const anchor = ANCHOR_WORDS[m[1] ?? ""];
    if (!anchor) continue;
    anchored.add(m.index);
    const at = anchorAt?.(anchor) ?? null;
    const part = ANCHOR_PARTS[anchor].map((id) => cal.dayParts.find((p) => p.id === id)).find((p) => p !== undefined);
    if (at !== null && at > now) found.push({ type: "at", at });
    else if (part) found.push({ type: "day_part", dayPart: part.id });
  }
  // Parts of the day, by id or label, longest first so "early morning" isn't read as "morning".
  const named = cal.dayParts.flatMap((p, index) => [p.id, p.label].map((n) => ({ name: plain(n), index }))).filter((n) => n.name !== "");
  const day = dateAt(cal, now);
  /** A part while its start is still ahead today, as the Timelapse sheet's Until runs it; null once it has begun. */
  const aheadToday = (index: number): TimelapseTarget | null => (clockAt(cal, day.dayIndex, cal.partStarts[index] ?? 0) > now ? { type: "day_part", dayPart: cal.dayParts[index]?.id ?? "" } : null);
  for (const m of t.matchAll(new RegExp(` (${longestFirst(Object.keys(PART_LEADS))})(?: the)? (${longestFirst(named.map((n) => n.name))})(?= )`, "g"))) {
    const index = named.find((n) => n.name === m[2])?.index ?? -1;
    const lead = PART_LEADS[m[1] ?? ""];
    if (index < 0 || anchored.has(m.index)) continue;
    if (lead === "until") found.push({ type: "day_part", dayPart: cal.dayParts[index]?.id ?? "" });
    else if (lead === "next") found.push(nextDayPart(cal, now, index));
    else if (lead === "tomorrow") {
      // Before the day's first part it is still last night: tomorrow is the day that has begun.
      const base = day.minuteOfDay < (cal.partStarts[0] ?? 0) ? day.dayIndex - 1 : day.dayIndex;
      found.push({ type: "at", at: clockAt(cal, base + 1, cal.partStarts[index] ?? 0) });
    } else {
      const ahead = aheadToday(index);
      if (ahead) found.push(ahead);
    }
  }
  // Tonight: the evening while it is still ahead, else the night.
  if (/ tonight(?= )/.test(t)) {
    const ahead = cal.dayParts.map((p, index) => (p.id === "evening" || p.id === "night" ? aheadToday(index) : null)).find((target) => target !== null);
    if (ahead) found.push(ahead);
  }
  for (const m of t.matchAll(COMMITMENT_SPAN)) found.push({ type: m[1] === "shift" || m[1] === "work" ? "shift" : "commitment" });
  const distinct = [...new Map(found.map((f) => [JSON.stringify(f), f])).values()];
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

// ---------------------------------------------------------------- timelapse

export interface TimelapseOptions {
  runSeed: string;
  overrides?: Partial<Record<InterruptClass, InterruptPolicy>>;
  /** Segment number for the summary event (1 for the first). */
  segment?: number;
  unitCap?: { agentDays: number; events: number };
  /**
   * False for a span the player's own words spend doing something ("OOC: for the next two hours, I
   * service the fleet"): the story holds the POV where it has it for the span, and its scene holds
   * whoever is in it (DESIGN §8). Absent: time runs on its own, and the POV's routine runs.
   */
  povRoutine?: boolean;
}

export interface TimelapseOutcome {
  ok: true;
  result: AdvanceResult;
  summary: TimelapseEvent;
  /** Minutes left to the target when the unit cap or the before-the-reply clock ended the segment. */
  remaining: number;
  /** A Continue-timelapse chip when the cap or the before-the-reply clock ended the segment early. */
  chip: { kind: "continue_timelapse"; target: TimelapseTarget; remaining: number; povRoutine?: false } | null;
  montage: Montage;
  /** With a mind's stop (DESIGN §24.7): the character's name when the POV knows them; null words it as someone. */
  mindName?: string | null;
  /** False when the run held the POV where the story has it (`TimelapseOptions.povRoutine`): its Continue holds it too. */
  povRoutine?: false;
}

/**
 * What ends a time skip early besides what ends any timelapse (DESIGN §24.7): a character's mind
 * at a beat asked to stop it, or the before-the-reply clock ran out. Both stop at a beat's time.
 */
export type SkipStop = { by: "mind"; at: number; entity: EntityId } | { by: "clock"; at: number };

/**
 * A time skip as its pre phase ran it (DESIGN §24.7): every beat it stopped at, in time order,
 * with the events recorded there (the skip's beats at its start, the minds at each beat), and how
 * it ended early, if it did. The plan replays it (`replaySkip`); no model is asked again.
 */
export interface SkipRecord {
  beats: { at: number; events: LedgerEvent[] }[];
  stop: SkipStop | null;
}

/** Overrides from an intent (`{interrupt: policy}`), ignoring unknown classes and policies. */
export function parseOverrides(v: JsonValue | undefined): Partial<Record<InterruptClass, InterruptPolicy>> {
  const out: Partial<Record<InterruptClass, InterruptPolicy>> = {};
  if (!isRecord(v)) return out;
  for (const c of INTERRUPT_CLASSES) {
    const p = (v as JsonObject)[c];
    if (p === "stop" || p === "note" || p === "ignore") out[c] = p;
  }
  return out;
}

/**
 * One timelapse segment, run in pieces (DESIGN §9.2, §24.7): `advanceTo` moves it to a beat,
 * `apply` adds what was decided there, and `finish` closes the segment with its summary, Montage and
 * chip. The pre phase drives one beat by beat while minds think; the plan replays the recorded beats
 * through another, so both reach every beat in the same state. One piece to the target is a plain
 * timelapse. The unit cap holds for the whole segment, and only its first slot runs whatever it. A
 * slot a piece ends inside stays open into the next, whose stop check reads the signals raised in
 * all of it, so cutting the run at beats never changes where it stops.
 */
export class TimelapseRun {
  readonly from: number;
  /** The resolved target time. */
  readonly to: number;
  /** How the run ended before the target on its own (a `stop` interrupt, the cap, the stage), or null. */
  ended: AdvanceResult["stop"] | null = null;
  private readonly before: WorldState;
  private readonly start: number;
  private readonly cap: { agentDays: number; events: number };
  private readonly result: AdvanceResult;

  private constructor(
    private readonly reg: Registry,
    private readonly w: Working,
    private readonly target: TimelapseTarget,
    private readonly opts: TimelapseOptions,
    private readonly resolved: ResolvedTarget,
  ) {
    this.before = structuredClone(w.state) as WorldState;
    this.start = w.events.length;
    this.from = w.state.clock;
    this.to = resolved.to;
    this.cap = clampUnitCap(opts.unitCap ?? w.state.time.unitCap);
    this.result = { from: this.from, to: this.from, requested: resolved.to, slots: 0, stop: "target", stoppedBy: null, stops: [], notes: [], agentDays: 0, events: 0, rules: [], tracks: [], open: null };
  }

  /** A run toward `target`, or why none can start (the clock is paused, the target doesn't resolve). */
  static start(reg: Registry, w: Working, target: TimelapseTarget, opts: TimelapseOptions): TimelapseRun | Rejection {
    if (clockPaused(w.world, w.state)) return { code: "paused", reason: "The clock is paused; resume it first." };
    const resolved = resolveTarget(reg, w.world, w.state, target);
    return "code" in resolved ? resolved : new TimelapseRun(reg, w, target, opts, resolved);
  }

  get clock(): number {
    return this.w.state.clock;
  }

  /**
   * Runs on to `at` (never past the target); false once the run has ended on its own, here or before.
   * The cap may end it at the start of a slot an earlier piece ended inside, before the clock it had.
   */
  advanceTo(at: number): boolean {
    if (this.ended !== null) return false;
    const to = Math.min(at, this.to);
    if (to <= this.w.state.clock) return true;
    const r = advance(this.reg, this.w, to, {
      runSeed: this.opts.runSeed,
      mode: "timelapse",
      cause: "timelapse",
      includePov: true,
      // A span the player's words spend doing something keeps the POV where the story has it (DESIGN
      // §8); otherwise time runs on its own and the POV follows its routine.
      povRoutine: this.opts.povRoutine !== false,
      ...(this.opts.overrides ? { interrupts: this.opts.overrides } : {}),
      unitCap: this.cap,
      spent: { slots: this.result.slots, agentDays: this.result.agentDays, events: this.w.events.length - this.start },
      ...(this.result.open ? { open: this.result.open } : {}),
      segmentTo: this.to,
      ...(this.resolved.stopWhen ? { stopWhen: this.resolved.stopWhen } : {}),
    });
    const acc = this.result;
    acc.slots += r.slots;
    acc.agentDays += r.agentDays;
    acc.stops.push(...r.stops);
    acc.notes.push(...r.notes);
    acc.rules.push(...r.rules);
    acc.tracks.push(...r.tracks);
    acc.open = r.open;
    if (r.stop === "target") return true;
    this.ended = acc.stop = r.stop;
    acc.stoppedBy = r.stoppedBy;
    return false;
  }

  /** Applies what was decided at the current clock (a beat's minds); returns what applied. */
  apply(events: readonly LedgerEvent[]): LedgerEvent[] {
    return this.w.applyAll(events);
  }

  /** Closes the segment: at the target unless it ended on its own, or here when a skip stops it. */
  finish(stop: SkipStop | null): TimelapseOutcome {
    if (stop === null) this.advanceTo(this.to);
    const w = this.w;
    // A mind's stop is an interrupt of the run; the clock's leaves the rest of the way for a Continue, as the cap does.
    const result: AdvanceResult = { ...this.result, to: w.state.clock, events: w.events.length - this.start, ...(stop ? { stop: stop.by === "mind" ? "interrupt" : "cap" } : {}) };
    const summary: TimelapseEvent = { type: "timelapse", from: this.from, to: result.to, target: this.target, stoppedBy: stop?.by === "mind" ? "mind" : result.stoppedBy, segment: this.opts.segment ?? 1, ...(stop?.by === "mind" ? { mind: stop.entity } : {}) };
    w.apply(summary);
    const remaining = result.stop === "cap" ? Math.max(0, this.to - result.to) : 0;
    const montage = buildMontage(this.reg, w.world, this.before, w.state, w.events.slice(this.start), w.state.time.montage);
    const held = this.opts.povRoutine === false ? { povRoutine: false as const } : {};
    return {
      ok: true,
      result,
      summary,
      remaining,
      chip: remaining > 0 ? { kind: "continue_timelapse", target: this.target.type === "duration" ? { type: "duration", minutes: remaining } : this.target, remaining, ...held } : null,
      montage,
      ...(stop?.by === "mind" ? { mindName: playerKnows(this.reg, w.world, w.state, w.world.pov, stop.entity) ? (own(w.state.entities, stop.entity)?.name ?? null) : null } : {}),
      ...held,
    };
  }
}

/**
 * Runs one timelapse segment into the working state: the interval slot by slot with process
 * seeds, every LOD1 agent and the POV's routine, stopping at the first `stop` interrupt (at its
 * slot's end), the target predicate or the unit cap (always at least one slot).
 */
export function runTimelapse(reg: Registry, w: Working, target: TimelapseTarget, opts: TimelapseOptions): TimelapseOutcome | Rejection {
  const run = TimelapseRun.start(reg, w, target, opts);
  return "code" in run ? run : run.finish(null);
}

/**
 * A time skip replayed from its record (DESIGN §24.7): the same segment, stopping at each recorded
 * beat to apply what was decided there, then on to the target, or stopped where the record says (at a
 * beat whose minds gave nothing, too). A beat the run no longer reaches (it ended on its own first) and
 * every beat after it are left out.
 */
export function replaySkip(reg: Registry, w: Working, target: TimelapseTarget, record: SkipRecord, opts: TimelapseOptions): TimelapseOutcome | Rejection {
  const run = TimelapseRun.start(reg, w, target, opts);
  if ("code" in run) return run;
  const stopAt = record.stop?.at ?? Infinity;
  for (const beat of record.beats) {
    if (beat.at > stopAt) break;
    run.advanceTo(beat.at);
    if (run.clock !== beat.at) return run.finish(null);
    run.apply(beat.events);
  }
  if (record.stop) {
    run.advanceTo(record.stop.at);
    if (run.clock === record.stop.at) return run.finish(record.stop);
  }
  return run.finish(null);
}

/** The smallest unit cap that still fits one slot for every LOD1 agent plus the POV (lint and Settings use it). */
export function minimumUnitCap(world: WorldDoc, state: Readonly<WorldState>): number {
  const agents = lod1Agents(world, state).filter((a) => a !== world.pov).length + 1;
  return (agents * shortestSlot(calendarOf(world))) / MINUTES_PER_DAY;
}

// ---------------------------------------------------------------- the time.advance channel

export interface AdvanceOutcome {
  applied: boolean;
  /** Why it became a Timelapse chip instead, or (`in_fight`) why it was dropped: a fight holds the clock. */
  reason: "over_cap" | "unit_cap" | "in_fight" | null;
  chip: { kind: "timelapse_offer"; target: TimelapseTarget; overrides: Record<InterruptClass, InterruptPolicy> } | null;
}

/**
 * An extracted `time.advance` (DESIGN §9.2, §9.4): `minutes` beyond what the swipe already applied.
 * Under `capMinutes` it applies whole, with its catch-up run like a timelapse segment with every
 * interrupt class at `note`; over the cap, or when the catch-up exceeds the unit cap, nothing is
 * applied and it becomes a Timelapse chip to that time. During a fight nothing is applied and
 * nothing is offered, so no one in the fight or outside it moves.
 */
export function applyTimeAdvance(reg: Registry, w: Working, minutes: number, opts: { runSeed: string; capMinutes: number; unitCap?: { agentDays: number; events: number } }): AdvanceOutcome {
  const target: TimelapseTarget = { type: "duration", minutes };
  const chip = { kind: "timelapse_offer" as const, target, overrides: { ...ALL_NOTE } };
  if (!(minutes > 0)) return { applied: false, reason: null, chip: null };
  if (fightHoldsClock(w.ctx)) return { applied: false, reason: "in_fight", chip: null };
  // Beyond the timelapse reach there is nothing to offer: a narrated "ten years later" changes nothing.
  if (minutes > TIME_LIMITS.timelapseMinutes) return { applied: false, reason: "over_cap", chip: null };
  if (minutes > opts.capMinutes) return { applied: false, reason: "over_cap", chip };
  const mark = w.mark();
  // The narration told what the POV did in the skip, so its own routine doesn't move it (DESIGN §8).
  const result = advance(reg, w, w.state.clock + minutes, { runSeed: opts.runSeed, mode: "timelapse", cause: "advance", includePov: true, povRoutine: false, interrupts: ALL_NOTE, unitCap: clampUnitCap(opts.unitCap ?? w.state.time.unitCap) });
  if (result.stop !== "target") {
    w.restore(mark);
    return { applied: false, reason: "unit_cap", chip };
  }
  return { applied: true, reason: null, chip: null };
}

// ---------------------------------------------------------------- the clock's ✎ fix

/** A ✎ fix of the clock as the ledger records it: its events (none when the clock already reads that time), or why it can't. */
export type ClockFix = { events: LedgerEvent[] } | Rejection;

/**
 * The ✎ fix of the clock (DESIGN §9.2, §12): the clock set to `local`, a date and time of day in the
 * world's calendar (`YYYY-MM-DD HH:MM`) at the POV's place, as the HUD reads it. Calendar & time on.
 * - Later: the time passes as an applied `time.advance` to then does (L28): the interval run whole
 *   with every interrupt class at `note`, and no Montage. A fight holds the clock, as it does for a
 *   narrated skip, and past the unit cap nothing applies: a Timelapse gets there in steps. The
 *   events are recorded as a timelapse's are, coarsened, and as one unit kept or dropped whole.
 * - Earlier: the clock goes back (`engine.rewind`), never before the story starts. Nothing that ran
 *   up to where it stood is undone, and none of it runs again (L48).
 */
export function clockFix(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, local: string, runSeed: string): ClockFix {
  if (reg.context(world, state).levelOf(world.pov, "calendar") < 1) return { code: "calendar_off", reason: "Calendar & time is off" };
  const at = clockOfStamp(calendarOf(world), local);
  if (at === null) return { code: "bad_time", reason: "that isn't a date and time of day in this world's calendar (YYYY-MM-DD HH:MM)" };
  // Local time at the POV's place, as the HUD shows it and typed time reads it.
  const to = at - placeOffset(world, at, placeOfEntity(state, world.pov));
  const w = new Working(reg, world, state);
  if (to < state.clock) return w.apply({ type: ENGINE_EVENTS.rewind, data: { minutes: state.clock - to } }) ?? { events: [...w.events] };
  const advanced = applyTimeAdvance(reg, w, to - state.clock, { runSeed, capMinutes: TIME_LIMITS.timelapseMinutes });
  if (advanced.reason === "in_fight") return { code: "in_fight", reason: `${IN_FIGHT}, and its rounds take no clock time` };
  if (advanced.reason === "unit_cap") return { code: "unit_cap", reason: "too much happens before then to run in one go; a Timelapse to that time gets there in steps" };
  if (advanced.reason === "over_cap") return { code: "too_long", reason: `the clock moves on at most ${TIME_LIMITS.timelapseMinutes / MINUTES_PER_DAY} days at a time` };
  if (!advanced.applied) return { events: [] };
  const events = coarsen(reg, world, state, w.events);
  if (events.length < 2) return { events };
  const group = `time:${hashParts(JSON.stringify(events)).slice(0, 10)}`;
  return { events: events.map((e) => ({ ...e, group })) };
}

// ---------------------------------------------------------------- speed through

/**
 * `elapse` for spans at or under the threshold, or with no policy: no Speed through, so a stated length
 * runs on within the turn and any other span's time passes in the turns that follow (DESIGN §9.2);
 * else the activity's mode.
 */
export function speedThrough(state: Readonly<WorldState>, activity: string, remainingMinutes: number): "elapse" | "offer" | "auto" {
  const policy = own(state.time.speedThrough, activity);
  if (!policy || remainingMinutes <= clampThreshold(policy.thresholdMinutes)) return "elapse";
  return policy.mode;
}

// ---------------------------------------------------------------- montage

export interface Montage {
  granularity: "key" | "day" | "week";
  /** Key events, grouped per day or week (one group for `key`). */
  groups: { label: string; lines: string[] }[];
  /** Money in and out per POV-owned account over the interval. */
  money: { account: EntityId; label: string; in: number; out: number }[];
  /** Net numeric changes on the POV and what it owns; a banded field is left to `bands`, which words it, and `money` says the delta is in minor units. `label` is whose field and what it is ("Sam Rivera's fitness"). */
  changes: { entity: EntityId; field: string; label: string; delta: number; money: boolean }[];
  /** Band crossings the POV can see (regard, sheets, needs); `label` as `changes`' is. */
  bands: { entity: EntityId; field: string; label: string; from: string; to: string }[];
}

function ownedBy(state: Readonly<WorldState>, id: EntityId, pov: EntityId): boolean {
  return id === pov || heldBy(state.entities, id, pov);
}

/**
 * The Montage of an interval, filtered to what the POV knows (DESIGN §7): key events are the
 * visible `note`/`stop` signals and notes; aggregates come from the events themselves, so money
 * lines equal the ledger totals for the interval.
 */
export function buildMontage(reg: Registry, world: WorldDoc, before: Readonly<WorldState>, after: Readonly<WorldState>, events: readonly LedgerEvent[], granularity: Montage["granularity"]): Montage {
  const pov = world.pov;
  const cal = calendarOf(world);
  const groups = new Map<string, string[]>();
  const money = new Map<EntityId, { in: number; out: number }>();
  const changes = new Map<string, { entity: EntityId; field: string; delta: number }>();
  let clock = before.clock;
  for (const e of events) {
    if (e.type === "clock") {
      clock += e.minutes;
      continue;
    }
    if (e.type === "post") {
      for (const l of e.lines) {
        if (!ownedBy(after, l.account, pov) || l.account === pov) continue;
        const m = money.get(l.account) ?? { in: 0, out: 0 };
        if (l.amount >= 0) m.in += l.amount;
        else m.out -= l.amount;
        money.set(l.account, m);
      }
      continue;
    }
    if (e.type === "add") {
      if (!ownedBy(after, e.entity, pov) || !canSeeField(reg, world, after, pov, e.entity, e.field)) continue;
      const key = `${e.entity}.${e.field}`;
      const c = changes.get(key) ?? { entity: e.entity, field: e.field, delta: 0 };
      c.delta += e.delta;
      changes.set(key, c);
      continue;
    }
    let line: string | null = null;
    const s: Signal | null = "data" in e ? signalOf(e) : null;
    if (s) {
      const policy = own(after.time.interrupts, s.class);
      if (policy !== "ignore" && playerEventVisible(reg, world, after, pov, e)) line = s.text;
    } else if (e.type === ENGINE_EVENTS.note && playerEventVisible(reg, world, after, pov, e)) {
      const t = e.data.text;
      line = typeof t === "string" ? t : null;
    }
    if (!line) continue;
    const d = dateAt(cal, clock);
    const day = (at: number): string => formatClock(cal, at).split(",")[0] ?? "";
    // `key` is one group, labelled with the interval's days.
    const label = granularity === "key" ? (day(before.clock) === day(after.clock) ? day(before.clock) : `${day(before.clock)} – ${day(after.clock)}`) : granularity === "day" ? day(clock) : `Week of ${day(clock - ((d.weekday + 6) % 7) * MINUTES_PER_DAY)}`;
    const list = groups.get(label) ?? [];
    list.push(line);
    groups.set(label, list);
  }
  const bands: Montage["bands"] = [];
  for (const [id, e] of Object.entries(after.entities)) {
    const prev = own(before.entities, id);
    if (!prev) continue;
    for (const [field, v] of Object.entries(e.fields)) {
      if (typeof v !== "number") continue;
      const def = fieldDef(reg, world, e.kind, field);
      if (!def?.bands || !canSeeField(reg, world, after, pov, id, field) || !playerKnows(reg, world, after, pov, id)) continue;
      const old = own(prev.fields, field);
      const from = bandOf(def.bands, typeof old === "number" ? old : 0)?.label ?? "";
      const to = bandOf(def.bands, v)?.label ?? "";
      if (from !== to) bands.push({ entity: id, field, label: `${possessive(e.name)} ${fieldNoun(def.label, field).noun}`, from, to });
    }
  }
  return {
    granularity,
    groups: [...groups].map(([label, lines]) => ({ label, lines })),
    money: [...money].sort(([a], [b]) => a.localeCompare(b)).map(([account, m]) => ({ account, label: own(after.entities, account)?.name ?? account, in: m.in, out: m.out })),
    changes: [...changes.values()]
      .filter((c) => c.delta !== 0)
      .flatMap((c) => {
        const def = fieldDef(reg, world, own(after.entities, c.entity)?.kind ?? "", c.field);
        return def?.bands ? [] : [{ ...c, label: `${possessive(own(after.entities, c.entity)?.name ?? c.entity)} ${fieldNoun(def?.label, c.field).noun}`, money: def?.type === "money" }];
      }),
    bands,
  };
}
