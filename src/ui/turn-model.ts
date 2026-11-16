// A turn's timings as the Turn page says them: each moment with the time since the one before it, and
// the spans between them that tell where the time went, each under its own name: the wait for the turn
// before, the intent record's own time (plan §10.3) and, apart from it, the rest of the time before the
// first words. And the turn as its page shows it while it runs: its last read, with what the live road
// has said since.

import type { TurnReply, RunShown, TurnMoments } from "../shared/api";
import { addUsage, type RunNode, runTotals } from "./live-model";

/** The turn's view of a run the page holds the records of: the run the read names by RPH's id for it (RPE's own id before its first record), none for a run it does not list (a job the turn started). */
export function viewOf(views: readonly RunShown[], run: RunNode): RunShown | undefined {
  return views.find((view) => (view.run ?? view.id) === run.run);
}

/** The run the turn's head and reply are of: that of its latest view; the last the page holds where the read names none. */
export function latestOf(detail: TurnReply, runs: readonly RunNode[]): RunNode | undefined {
  const last = detail.runs.at(-1);
  return (last === undefined ? undefined : runs.find((run) => run.run === (last.run ?? last.id))) ?? runs.at(-1);
}

/**
 * The turn as its page shows it: its last read, with what its latest run has said on the live road
 * since: how it stands, when it began, released and ended, and while it runs, what it has spent so far,
 * its earlier runs' spending added (a read gives what all its runs spent together).
 */
export function liveTurn(detail: TurnReply, run: RunNode | undefined): TurnReply {
  if (run === undefined) return detail;
  const { timings } = detail;
  const live = run.outcome?.usage ?? runTotals(run).usage;
  return {
    ...detail,
    status: run.outcome?.status ?? detail.status,
    timings: { ...timings, started: timings.started ?? run.startedAt, released: timings.released ?? run.releasedAt, ended: timings.ended ?? run.endedAt },
    usage: detail.status === "running" ? detail.runs.slice(0, -1).reduce((sum, earlier) => addUsage(sum, earlier.usage), live) : detail.usage,
    intent: detail.intent ?? run.intent,
    error: detail.error ?? run.outcome?.error ?? null,
  };
}

export interface Moment {
  label: string;
  at: number;
  /** Since the moment before it that happened; null for the first. */
  since: number | null;
}

const MOMENTS: readonly { key: "received" | "started" | "firstWord" | "released" | "ended"; label: string }[] = [
  { key: "received", label: "Reached RPE" },
  { key: "started", label: "The lead began" },
  { key: "firstWord", label: "First words to the chat" },
  { key: "released", label: "Reply released" },
  { key: "ended", label: "The run ended" },
];

/** The moments that happened, in order. */
export function momentsOf(timings: TurnMoments): Moment[] {
  const out: Moment[] = [];
  for (const { key, label } of MOMENTS) {
    const at = timings[key];
    if (at === null) continue;
    const before = out.at(-1);
    out.push({ label, at, since: before === undefined ? null : at - before.at });
  }
  return out;
}

export interface Span {
  label: string;
  ms: number;
}

/**
 * Where the time went, each span under its own name, for each whose two ends happened: the wait for the turn before and intake's own
 * steps (the run's `received` to `started`, which the wait is no part of), the intent record's own time, and apart from it the rest of
 * the time before the first words (the calls made before the reply: a gap check, a read, a sub-agent). No span is called what the
 * record cost.
 */
export function spansOf(timings: TurnMoments): Span[] {
  const span = (label: string, from: number | null, to: number | null): Span[] => (from === null || to === null ? [] : [{ label, ms: to - from }]);
  const waited = timings.wait ?? [];
  const record = timings.intent === null || timings.intent.to === null ? null : timings.intent.to - timings.intent.from;
  const beforeWords = timings.started === null || timings.firstWord === null ? null : timings.firstWord - timings.started;
  return [
    ...(waited.length === 0 ? [] : [{ label: "Waiting for the turn before", ms: waited.reduce((sum, w) => sum + (w.to - w.from), 0) }]),
    ...(timings.intake === null ? span("Before the lead began", timings.received, timings.started) : timings.intake.map((step) => ({ label: `Intake: ${step.step}`, ms: step.to - step.from }))),
    ...(record === null ? [] : [{ label: "The intent record's own time", ms: record }]),
    ...(beforeWords === null ? [] : [{ label: record === null ? "Before the first words" : "Before the first words, apart from the intent record (the calls made before the reply)", ms: Math.max(0, beforeWords - (record ?? 0)) }]),
    ...span("Writing the reply", timings.firstWord, timings.released),
    ...span("After the reply", timings.finished ?? timings.released, timings.ended),
    ...span("In all", timings.received, timings.ended ?? timings.released),
  ];
}
