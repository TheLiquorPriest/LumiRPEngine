// A turn's timings as the Turn page says them: each moment with the time since the one before it, and
// the spans between them that tell where the time went. The span before the first words is what writing
// the intent record costs before the reply begins (plan §10.3), shown beside the gate. And the turn as
// its page shows it while it runs: its last read, with what the live road has said since.

import type { TurnDetail, TurnTimings } from "./api";
import { addUsage, type RunNode, runTotals } from "./live-model";

/**
 * The turn as its page shows it: its last read, with what its latest run has said on the live road
 * since: how it stands, when it began, released and ended, and while it runs, what it has spent so far,
 * its earlier runs' spending added (a read gives what all its runs spent together).
 */
export function liveTurn(detail: TurnDetail, run: RunNode | undefined): TurnDetail {
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

const MOMENTS: readonly { key: keyof TurnTimings; label: string }[] = [
  { key: "received", label: "Reached RPE" },
  { key: "started", label: "The lead began" },
  { key: "firstWord", label: "First words to the chat" },
  { key: "released", label: "Reply released" },
  { key: "ended", label: "The run ended" },
];

/** The moments that happened, in order. */
export function momentsOf(timings: TurnTimings): Moment[] {
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

/** Where the time went, for each span whose two ends both happened. */
export function spansOf(timings: TurnTimings): Span[] {
  const span = (label: string, from: number | null, to: number | null): Span[] => (from === null || to === null ? [] : [{ label, ms: to - from }]);
  return [
    ...span("Before the lead began", timings.received, timings.started),
    ...span("Before the first words", timings.started, timings.firstWord),
    ...span("Writing the reply", timings.firstWord, timings.released),
    ...span("After the reply", timings.released, timings.ended),
    ...span("In all", timings.received, timings.ended ?? timings.released),
  ];
}
