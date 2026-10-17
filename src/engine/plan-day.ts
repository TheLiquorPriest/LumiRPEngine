// The day planner (DESIGN §8, §9.3 Cast life): deterministic utility over the free time between an
// agent's fixed commitments, with seeded tie-breaks. Options whose utilities fall within
// `tieEpsilon` of the best form a tie zone: a recorded choice wins (re-fold and Re-narrate repeat
// it), then the caller's decision hook (the `npc.choose` step, where the model-use preset allows
// it), then a seeded pick. Every tie is returned, so the caller records it (`engine.choice`) and
// can raise the `tie_zone` signal for model consultation.

import type { EntityId } from "../shared/ids";
import type { Rng } from "./rng";

export interface PlanOption {
  id: string;
  label: string;
  activity: string;
  place?: string | null;
  /** Minutes; a block is cut short at the next commitment or the day's end. */
  duration: number;
  /** A number, or a function of the start time (clock minutes). */
  utility: number | ((start: number) => number);
  reasons: string[];
  /** Absolute clock window in which the option may start. */
  window?: { from: number; to: number };
  /** May be chosen more than once a day. */
  repeat?: boolean;
}

export interface FixedBlock {
  start: number;
  end: number;
  label: string;
  activity: string;
  place?: string | null;
  reason: string;
}

export interface PlanBlock {
  start: number;
  end: number;
  option: string;
  label: string;
  activity: string;
  place: string | null;
  utility: number;
  reasons: string[];
  fixed: boolean;
}

export interface TieRecord {
  /** Stable key: agent, day start and block start. */
  key: string;
  at: number;
  options: { id: string; utility: number }[];
  chosen: string;
  via: "recorded" | "model" | "seed";
}

export interface DayPlan {
  agent: EntityId;
  start: number;
  end: number;
  blocks: PlanBlock[];
  ties: TieRecord[];
  /** True when any tie was left to the seed: the caller may consult `npc.choose`. */
  tieZone: boolean;
}

export interface PlanInput {
  agent: EntityId;
  start: number;
  end: number;
  fixed: readonly FixedBlock[];
  options: readonly PlanOption[];
  rng: Rng;
  /** Utility gap within which options tie (default 0.5). */
  tieEpsilon?: number;
  /** Choices already recorded for this agent and day, by tie key. */
  recorded?: Readonly<Record<string, string>>;
  /** A decision for a tie, or null to fall through to the seed. */
  decide?: (tie: { key: string; at: number; options: { id: string; label: string; utility: number }[] }) => string | null;
}

export const IDLE_OPTION = "idle";
/** The longest idle stretch before options with time-dependent utility are looked at again. */
const IDLE_STEP = 30;

function utilityAt(o: PlanOption, t: number): number {
  const u = typeof o.utility === "number" ? o.utility : o.utility(t);
  return Number.isFinite(u) ? u : 0;
}

export function tieKey(agent: EntityId, dayStart: number, at: number): string {
  return `${agent}:${dayStart}:${at}`;
}

export function planDay(input: PlanInput): DayPlan {
  const eps = input.tieEpsilon ?? 0.5;
  const fixed = [...input.fixed].filter((b) => b.end > input.start && b.start < input.end).sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: PlanBlock[] = [];
  const ties: TieRecord[] = [];
  const used = new Set<string>();
  let tieZone = false;
  let t = input.start;
  let fi = 0;
  for (let guard = 0; t < input.end && guard < 1000; guard++) {
    while (fi < fixed.length && (fixed[fi]?.end ?? 0) <= t) fi++;
    const f = fixed[fi];
    if (f && f.start <= t) {
      blocks.push({ start: t, end: Math.min(f.end, input.end), option: `fixed:${f.label}`, label: f.label, activity: f.activity, place: f.place ?? null, utility: 0, reasons: [f.reason], fixed: true });
      t = Math.min(f.end, input.end);
      continue;
    }
    const gapEnd = f ? Math.min(f.start, input.end) : input.end;
    const candidates = input.options
      .filter((o) => o.duration > 0 && (o.repeat || !used.has(o.id)) && (!o.window || (o.window.from <= t && t < o.window.to)))
      .map((o) => ({ o, u: utilityAt(o, t) }))
      .sort((a, b) => b.u - a.u || a.o.id.localeCompare(b.o.id));
    const best = candidates[0];
    if (!best || best.u <= 0) {
      // Idle until something may become worth doing: the next unused window opens, or 30 minutes on.
      const opens = input.options.filter((o) => (o.repeat || !used.has(o.id)) && o.window && o.window.from > t).map((o) => o.window?.from ?? gapEnd);
      const idleEnd = Math.min(gapEnd, t + IDLE_STEP, ...opens);
      const last = blocks[blocks.length - 1];
      if (last && last.option === IDLE_OPTION && last.end === t) last.end = idleEnd;
      else blocks.push({ start: t, end: idleEnd, option: IDLE_OPTION, label: "Free time", activity: IDLE_OPTION, place: null, utility: 0, reasons: ["nothing better to do"], fixed: false });
      t = idleEnd;
      continue;
    }
    const tied = candidates.filter((c) => c.u > 0 && best.u - c.u <= eps);
    let chosen = best;
    if (tied.length > 1) {
      const key = tieKey(input.agent, input.start, t);
      const ids = tied.map((c) => c.o.id);
      const recorded = input.recorded?.[key];
      let via: TieRecord["via"];
      let pick: string;
      if (recorded && ids.includes(recorded)) {
        pick = recorded;
        via = "recorded";
      } else {
        const model = input.decide?.({ key, at: t, options: tied.map((c) => ({ id: c.o.id, label: c.o.label, utility: c.u })) }) ?? null;
        if (model && ids.includes(model)) {
          pick = model;
          via = "model";
        } else {
          pick = input.rng.fork(key).pick(ids);
          via = "seed";
          tieZone = true;
        }
      }
      chosen = tied.find((c) => c.o.id === pick) ?? best;
      ties.push({ key, at: t, options: tied.map((c) => ({ id: c.o.id, utility: c.u })), chosen: pick, via });
    }
    const end = Math.min(t + chosen.o.duration, gapEnd);
    blocks.push({ start: t, end, option: chosen.o.id, label: chosen.o.label, activity: chosen.o.activity, place: chosen.o.place ?? null, utility: chosen.u, reasons: chosen.o.reasons, fixed: false });
    used.add(chosen.o.id);
    t = end;
  }
  return { agent: input.agent, start: input.start, end: input.end, blocks, ties, tieZone };
}

/** The block of a plan covering `clock`, or null. */
export function blockAt(plan: Pick<DayPlan, "blocks">, clock: number): PlanBlock | null {
  for (const b of plan.blocks) if (b.start <= clock && clock < b.end) return b;
  return null;
}
