// How long turns and each of their parts took (plan §4.4 the `service` group, §14 Runtime): over the latest turns of a chat or of all
// chats, each part's time by turn, and what they come to: how many turns it was seen in, the middle one, the slowest and the latest.
// The turn lane gives each turn's own moments, as it keeps them; nothing here is measured again.

/** A stretch of a turn, in milliseconds since 1970; no end where it began and did not end. */
export interface Stretch {
  from: number;
  to: number | null;
}

/** One turn's moments, as the turn lane keeps them. */
export interface TurnTimes {
  chat: string;
  turn: string;
  received: number;
  started: number | null;
  firstWord: number | null;
  released: number | null;
  ended: number | null;
  intent: Stretch | null;
  thinking: readonly Stretch[];
  /** Intake's own steps, in order; none for a run with no intake of its own. */
  intake: readonly { step: string; from: number; to: number }[] | null;
  /** Each wait for the turn before; none for a run with no intake of its own. */
  wait: readonly { from: number; to: number }[] | null;
}

/** One part of a turn and how long it took. */
export interface PartTime {
  part: string;
  ms: number;
}

const length = (from: number, to: number | null): number | null => (to === null ? null : Math.max(0, to - from));

/** The parts a turn's moments tell, those that began and ended only: intake's steps by name, the waits, and the reply's own stretches. */
export function partsOf(t: TurnTimes): PartTime[] {
  const parts: PartTime[] = [];
  const add = (part: string, ms: number | null): void => void (ms === null ? undefined : parts.push({ part, ms }));
  for (const step of t.intake ?? []) add(`intake: ${step.step}`, length(step.from, step.to));
  if (t.wait !== null && t.wait.length > 0) add("waiting for the turn before", t.wait.reduce((sum, w) => sum + (length(w.from, w.to) ?? 0), 0));
  if (t.started !== null) {
    add("to the first word", t.firstWord === null ? null : length(t.started, t.firstWord));
    add("to the release", t.released === null ? null : length(t.started, t.released));
    add("the run after the release", t.released === null || t.ended === null ? null : length(t.released, t.ended));
  }
  if (t.intent !== null) add("the intent record", length(t.intent.from, t.intent.to));
  const thought = t.thinking.map((s) => length(s.from, s.to)).filter((ms): ms is number => ms !== null);
  if (thought.length > 0) add("thinking", thought.reduce((sum, ms) => sum + ms, 0));
  return parts;
}

/** What one part came to across the turns it was seen in. */
export interface PartsAcross {
  part: string;
  /** How many turns it was seen in. */
  turns: number;
  /** The middle time, the slowest, and the latest turn's. */
  median: number;
  slowest: number;
  latest: number;
}

/** Each part's time across `turns`, newest first as given; parts in the order first seen. */
export function acrossTurns(turns: readonly TurnTimes[]): PartsAcross[] {
  const by = new Map<string, number[]>();
  for (const t of turns) for (const p of partsOf(t)) by.set(p.part, [...(by.get(p.part) ?? []), p.ms]);
  return [...by].map(([part, times]) => {
    const sorted = [...times].sort((a, b) => a - b);
    return { part, turns: times.length, median: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, slowest: sorted.at(-1) ?? 0, latest: times[0] ?? 0 };
  });
}
