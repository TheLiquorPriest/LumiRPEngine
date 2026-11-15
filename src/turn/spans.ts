// What a turn's run keeps of its lead's own writing as it arrives (plan §4.7, §17.1, R-185), from RPH's trace: the intent record's
// own time, from RPH's `intent_began` (its first token) to its `intent` (its last), and the thinking before the first output of each of
// the lead's model calls on the reply's path (those begun before the release). A run is known by RPH's own id for it, from its
// `run_started`. Nothing here waits for, holds or orders anything RPH does: it only notes when things came.

import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import type { Run, Runs, Span } from "./runs";

/** One of the lead's model calls as its pieces arrive: its thinking before its first output, the last thinking token so far, and whether its output began. */
interface Call {
  thinking: Span | null;
  lastThought: number;
  output: boolean;
}

/** A turn's run followed while it goes on: RPE's run, the lead's handle, and its calls on the reply's path, by number. */
interface Followed {
  run: Run;
  lead: string;
  calls: Map<number, Call>;
}

export class RunTimes {
  /** By RPH's id for each run. */
  readonly #followed = new Map<string, Followed>();

  constructor(private readonly runs: Pick<Runs, "started" | "running">) {}

  /** A record of RPH's trace, as it came. */
  record(record: TraceRecord): void {
    const { event } = record;
    if (event.kind === "run_started") {
      this.runs.started(record);
      const run = record.scope.turn === undefined ? undefined : this.runs.running(record.scope.user, record.scope.turn);
      if (run !== undefined && run.traceRun === record.run) this.#followed.set(record.run, { run, lead: record.agent.id, calls: new Map() });
      return;
    }
    const followed = this.#followed.get(record.run);
    if (followed === undefined) return;
    if (event.kind === "run_ended") {
      this.#followed.delete(record.run);
      return;
    }
    if (record.agent.id !== followed.lead) return;
    const { run, calls } = followed;
    // The record's first token (`intent_began`) opens its span, which stays open (`to` null) until the record ends (`intent`).
    if (event.kind === "intent_began") run.intent = { from: run.intent?.from ?? record.at, to: null };
    else if (event.kind === "intent") run.intent = { from: run.intent?.from ?? record.at, to: record.at };
    else if (event.kind === "call_started" && run.released === null) calls.set(event.call, { thinking: null, lastThought: record.at, output: false });
    else if (event.kind === "call_ended") {
      // A call whose only output was a tool call (the record written to its file) ended its thinking where its last thought came.
      const call = calls.get(event.call);
      if (call !== undefined && !call.output && call.thinking !== null && (event.text !== "" || event.toolCalls.length > 0)) this.#output(followed, call);
    }
  }

  /** A piece of a model call's streaming text or thinking, as it came. */
  delta(delta: TraceDelta): void {
    const followed = this.#followed.get(delta.run);
    if (followed === undefined || delta.agent !== followed.lead) return;
    const call = followed.calls.get(delta.call);
    if (call === undefined || call.output) return;
    if (delta.thinking !== undefined && delta.thinking !== "") {
      const first = call.thinking === null;
      call.thinking ??= { from: delta.at, to: null };
      call.lastThought = delta.at;
      if (first) this.#keep(followed);
    }
    if (delta.text !== undefined && delta.text !== "") {
      if (call.thinking === null) call.output = true;
      else this.#output(followed, call);
    }
  }

  /** A call's first output came: its thinking, if any, ended at its last thought. */
  #output(followed: Followed, call: Call): void {
    call.output = true;
    if (call.thinking !== null) call.thinking.to = call.lastThought;
    this.#keep(followed);
  }

  /** The run's thinking as its calls stand, in call order. */
  #keep(followed: Followed): void {
    followed.run.thinking = [...followed.calls.entries()].sort(([a], [b]) => a - b).flatMap(([, call]) => (call.thinking === null ? [] : [{ ...call.thinking }]));
  }
}
