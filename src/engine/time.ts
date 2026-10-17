// Time progression (DESIGN §9.2 Time, D29): the per-turn elapsed time, time controls, Timelapse
// with its interrupt policy and unit cap, Speed through, the `time.advance` channel and the
// Montage. Deterministic by default: nothing here needs a model call.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, InterruptClass, InterruptPolicy, SceneTypeId } from "../shared/ids";
import { INTERRUPT_CLASSES } from "../shared/ids";
import type { LedgerEvent, TimelapseEvent, TimelapseTarget } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { calendarOf, dateAt, formatClock, MINUTES_PER_DAY, nextTimeOfDay, shortestSlot, slotIndexAt, slotStart } from "./calendar";
import { ENGINE_EVENTS, readEngineSlice, signalOf, type Signal } from "./engine-pack";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { allSchedules, nextStartFor, scheduleOwners } from "./schedules";
import { bandOf, fieldDef, placeOfEntity } from "./scope";
import { advance, ALL_NOTE, lod1Agents, type AdvanceResult } from "./simulate";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import { playerEventVisible, playerKnows } from "./player-events";
import { canSeeField } from "./visibility";
import type { Working } from "./working";
import { clampScale, clampThreshold, clampTick, clampUnitCap, TIME_LIMITS } from "./time-limits";

export const DEFAULT_SCENE_TYPE = "conversation";

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
      const until = own(state.entities, world.pov)?.fields.activity_until;
      if (typeof until !== "number" || until <= now) return { code: "no_trip", reason: "no active trip" };
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

// ---------------------------------------------------------------- timelapse

export interface TimelapseOptions {
  runSeed: string;
  overrides?: Partial<Record<InterruptClass, InterruptPolicy>>;
  /** Segment number for the summary event (1 for the first). */
  segment?: number;
  unitCap?: { agentDays: number; events: number };
}

export interface TimelapseOutcome {
  ok: true;
  result: AdvanceResult;
  summary: TimelapseEvent;
  /** Minutes left to the target when the unit cap ended the segment. */
  remaining: number;
  /** A Continue-timelapse chip when the cap ended the segment early. */
  chip: { kind: "continue_timelapse"; target: TimelapseTarget; remaining: number } | null;
  montage: Montage;
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
 * Runs one timelapse segment into the working state: the interval slot by slot with process
 * seeds, every LOD1 agent and the POV's routine, stopping at the first `stop` interrupt (at its
 * slot's end), the target predicate or the unit cap (always at least one slot).
 */
export function runTimelapse(reg: Registry, w: Working, target: TimelapseTarget, opts: TimelapseOptions): TimelapseOutcome | Rejection {
  if (clockPaused(w.world, w.state)) return { code: "paused", reason: "The clock is paused; resume it first." };
  const resolved = resolveTarget(reg, w.world, w.state, target);
  if ("code" in resolved) return resolved;
  const before = structuredClone(w.state) as WorldState;
  const start = w.events.length;
  const from = w.state.clock;
  const result = advance(reg, w, resolved.to, {
    runSeed: opts.runSeed,
    mode: "timelapse",
    cause: "timelapse",
    includePov: true,
    ...(opts.overrides ? { interrupts: opts.overrides } : {}),
    unitCap: clampUnitCap(opts.unitCap ?? w.state.time.unitCap),
    ...(resolved.stopWhen ? { stopWhen: resolved.stopWhen } : {}),
  });
  const summary: TimelapseEvent = { type: "timelapse", from, to: result.to, target, stoppedBy: result.stoppedBy, segment: opts.segment ?? 1 };
  w.apply(summary);
  const remaining = result.stop === "cap" ? resolved.to - result.to : 0;
  const montage = buildMontage(reg, w.world, before, w.state, w.events.slice(start), w.state.time.montage);
  return {
    ok: true,
    result,
    summary,
    remaining,
    chip: result.stop === "cap" ? { kind: "continue_timelapse", target: target.type === "duration" ? { type: "duration", minutes: remaining } : target, remaining } : null,
    montage,
  };
}

/** The smallest unit cap that still fits one slot for every LOD1 agent plus the POV (lint and Settings use it). */
export function minimumUnitCap(world: WorldDoc, state: Readonly<WorldState>): number {
  const agents = lod1Agents(state).filter((a) => a !== world.pov).length + 1;
  return (agents * shortestSlot(calendarOf(world))) / MINUTES_PER_DAY;
}

// ---------------------------------------------------------------- the time.advance channel

export interface AdvanceOutcome {
  applied: boolean;
  /** Why it became a Timelapse chip instead. */
  reason: "over_cap" | "unit_cap" | null;
  chip: { kind: "timelapse_offer"; target: TimelapseTarget; overrides: Record<InterruptClass, InterruptPolicy> } | null;
}

/**
 * An extracted `time.advance` (DESIGN §9.2, §9.4): `minutes` beyond what the swipe already applied.
 * Under `capMinutes` it applies whole, with its catch-up run like a timelapse segment with every
 * interrupt class at `note`; over the cap, or when the catch-up exceeds the unit cap, nothing is
 * applied and it becomes a Timelapse chip to that time.
 */
export function applyTimeAdvance(reg: Registry, w: Working, minutes: number, opts: { runSeed: string; capMinutes: number; unitCap?: { agentDays: number; events: number } }): AdvanceOutcome {
  const target: TimelapseTarget = { type: "duration", minutes };
  const chip = { kind: "timelapse_offer" as const, target, overrides: { ...ALL_NOTE } };
  if (!(minutes > 0)) return { applied: false, reason: null, chip: null };
  // Beyond the timelapse reach there is nothing to offer: a narrated "ten years later" changes nothing.
  if (minutes > TIME_LIMITS.timelapseMinutes) return { applied: false, reason: "over_cap", chip: null };
  if (minutes > opts.capMinutes) return { applied: false, reason: "over_cap", chip };
  const mark = w.mark();
  const result = advance(reg, w, w.state.clock + minutes, { runSeed: opts.runSeed, mode: "timelapse", cause: "advance", includePov: true, interrupts: ALL_NOTE, unitCap: clampUnitCap(opts.unitCap ?? w.state.time.unitCap) });
  if (result.stop !== "target") {
    w.restore(mark);
    return { applied: false, reason: "unit_cap", chip };
  }
  return { applied: true, reason: null, chip: null };
}

// ---------------------------------------------------------------- speed through

/** `elapse` for spans at or under the threshold (they pass within the turn), else the activity's mode. */
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
  /** Net numeric changes on the POV and what it owns. */
  changes: { entity: EntityId; field: string; label: string; delta: number }[];
  /** Band crossings the POV can see (regard, sheets, needs). */
  bands: { entity: EntityId; field: string; label: string; from: string; to: string }[];
}

function ownedBy(state: Readonly<WorldState>, id: EntityId, pov: EntityId): boolean {
  return id === pov || own(state.entities, id)?.fields.owner === pov;
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
      if (!def?.bands || !canSeeField(reg, world, after, pov, id, field) || !playerKnows(world, after, pov, id)) continue;
      const old = own(prev.fields, field);
      const from = bandOf(def.bands, typeof old === "number" ? old : 0)?.label ?? "";
      const to = bandOf(def.bands, v)?.label ?? "";
      if (from !== to) bands.push({ entity: id, field, label: `${e.name} ${def.label ?? field}`, from, to });
    }
  }
  return {
    granularity,
    groups: [...groups].map(([label, lines]) => ({ label, lines })),
    money: [...money].sort(([a], [b]) => a.localeCompare(b)).map(([account, m]) => ({ account, label: own(after.entities, account)?.name ?? account, in: m.in, out: m.out })),
    changes: [...changes.values()].filter((c) => c.delta !== 0).map((c) => ({ ...c, label: `${own(after.entities, c.entity)?.name ?? c.entity} ${fieldDef(reg, world, own(after.entities, c.entity)?.kind ?? "", c.field)?.label ?? c.field.replace(/_/g, " ")}` })),
    bands,
  };
}
