// A turn's timings as the Turn page says them: each moment with the time since the one before it, and
// the spans between them that tell where the time went. The span before the first words is what writing
// the intent record costs before the reply begins (plan §10.3), shown beside the gate.

import type { TurnTimings } from "./api";

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
