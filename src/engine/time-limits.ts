// Hard maxima for time controls and realism levels (DESIGN §9.1, §9.2). Markers are
// clamped where they are written and applied; these bounds hold wherever a value is used, so a
// world document, an imported ledger or an intent can never ask for an unbounded run.

import type { Level } from "../shared/ids";
import { MINUTES_PER_DAY } from "./calendar";

export const TIME_LIMITS = Object.freeze({
  /** Minutes one turn's tick may take, after the time scale. */
  tickMinutes: MINUTES_PER_DAY,
  /** The time scale's range (it applies to ticks only). */
  scale: [0.25, 10] as const,
  /** The farthest a timelapse may reach from now; Continue-timelapse segments stay inside it. */
  timelapseMinutes: 366 * MINUTES_PER_DAY,
  /** The unit cap's ceiling per segment: the default cap. */
  unitCap: Object.freeze({ agentDays: 600, events: 5000 }),
  /** NPC model calls per timelapse. */
  npcCalls: 50,
  /** A Speed-through threshold's range, in minutes. */
  thresholdMinutes: [1, 7 * MINUTES_PER_DAY] as const,
});

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function within(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A unit cap inside the ceiling; an absent or malformed part takes the ceiling. */
export function clampUnitCap(cap: { agentDays: number; events: number } | undefined): { agentDays: number; events: number } {
  const max = TIME_LIMITS.unitCap;
  const days = finite(cap?.agentDays);
  const events = finite(cap?.events);
  return {
    agentDays: days === null ? max.agentDays : within(days, 1 / 24, max.agentDays),
    events: events === null ? max.events : Math.round(within(events, 1, max.events)),
  };
}

/** Minutes for one tick: a finite, non-negative value of at most a day; else `fallback`. */
export function clampTick(v: unknown, fallback = 2): number {
  const n = finite(v);
  return n === null ? fallback : within(n, 0, TIME_LIMITS.tickMinutes);
}

export function clampScale(v: unknown): number {
  const n = finite(v);
  const [lo, hi] = TIME_LIMITS.scale;
  return n === null || n === 0 ? 1 : within(n, lo, hi);
}

export function clampThreshold(v: unknown): number {
  const n = finite(v);
  const [lo, hi] = TIME_LIMITS.thresholdMinutes;
  return n === null ? lo : Math.round(within(n, lo, hi));
}

export function clampNpcCalls(v: unknown): number {
  const n = finite(v);
  return n === null ? 0 : Math.round(within(n, 0, TIME_LIMITS.npcCalls));
}

/** A realism level: a whole number 0–4; anything else is 0 (off). */
export function clampLevel(v: unknown): Level {
  const n = finite(v);
  return (n === null ? 0 : Math.round(within(n, 0, 4))) as Level;
}
