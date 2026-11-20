// What a turn's run keeps of its lead's own writing as it arrives (plan §4.7, §17.1, R-185), from RPH's trace: the intent record's
// own time, from RPH's `intent_began` (its first token) to its `intent` (its last), and the thinking before the first output of each of
// the lead's model calls on the reply's path (those begun before the release). With them, every agent's lore lookups in the run, its
// `lore_search` and `lore_read` calls as each began, kept with what the run spent; and the lead's model call as it stands (`leadCall`):
// its newest failure since a call last ended whole, and the call under way. A run is known by RPH's own id for it, from its
// `run_started`. Nothing here waits for, holds or orders anything RPH does: it only notes when things came.

import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import { TIMELAPSE_ACTION } from "../engine/turn";
import { isRecord } from "../shared/json";
import type { Run, Runs, Span } from "./runs";

/** One of the lead's model calls as its pieces arrive: its thinking before its first output, the last thinking token so far, and whether its output began. */
interface Call {
  thinking: Span | null;
  lastThought: number;
  output: boolean;
}

/** A turn's run followed while it goes on: RPE's run, the lead's handle, its calls on the reply's path, by number, and its agents' `world_apply` calls under way that act, by agent and call: the action ids they name. */
interface Followed {
  run: Run;
  lead: string;
  calls: Map<number, Call>;
  acting: Map<string, string[]>;
}

/** The action ids a `world_apply` call's `act` operations name, as written; none for another call. */
function actionsOf(tool: string, args: unknown): string[] {
  if (tool !== "world_apply" || !isRecord(args) || !Array.isArray(args.operations)) return [];
  // A skip of time the player pressed is carried out by `pass_time` (the notice names it), as an `act` of the timelapse action is too.
  return args.operations.flatMap((op) => (isRecord(op) && op.op === "pass_time" ? [TIMELAPSE_ACTION] : isRecord(op) && op.op === "act" && typeof op.action === "string" && op.action.trim() !== "" ? [op.action.trim()] : []));
}

export class RunTimes {
  /** By RPH's id for each run. */
  readonly #followed = new Map<string, Followed>();

  /**
   * `acted`: told, for a turn, the action ids of the `act` operations of a `world_apply` call of any of its run's agents the moment that
   * call ended, carried out or refused: the presses the turn was told of those actions are answered.
   */
  constructor(
    private readonly runs: Pick<Runs, "started" | "running">,
    private readonly acted: (user: string, turn: string, actions: readonly string[]) => void = () => undefined,
  ) {}

  /** A record of RPH's trace, as it came. */
  record(record: TraceRecord): void {
    const { event } = record;
    if (event.kind === "run_started") {
      this.runs.started(record);
      const run = record.scope.turn === undefined ? undefined : this.runs.running(record.scope.user, record.scope.turn);
      if (run !== undefined && run.traceRun === record.run && record.agent !== undefined) this.#followed.set(record.run, { run, lead: record.agent.id, calls: new Map(), acting: new Map() });
      return;
    }
    const followed = this.#followed.get(record.run);
    if (followed === undefined) return;
    if (event.kind === "run_ended") {
      this.#followed.delete(record.run);
      return;
    }
    if (event.kind === "tool_started" && (event.tool === "lore_search" || event.tool === "lore_read")) {
      if (event.tool === "lore_search") followed.run.lookups.searches++;
      else followed.run.lookups.reads++;
    }
    // An `act` of any agent of the run, once its call ended: the press of that action the turn was told is answered.
    const key = `${record.agent?.id ?? ""}\n${event.kind === "tool_started" || event.kind === "tool_ended" ? event.callId : ""}`;
    if (event.kind === "tool_started") {
      const actions = actionsOf(event.tool, event.args);
      if (actions.length > 0) followed.acting.set(key, actions);
    } else if (event.kind === "tool_ended") {
      const actions = followed.acting.get(key);
      if (actions !== undefined) {
        followed.acting.delete(key);
        for (const a of actions) (followed.run.acted ??= new Set()).add(a.toLowerCase());
        this.acted(followed.run.user, followed.run.turn, actions);
      }
    }
    if (record.agent?.id !== followed.lead) return;
    const { run, calls } = followed;
    // The record's first token (`intent_began`) opens its span, which stays open (`to` null) until the record ends (`intent`).
    if (event.kind === "intent_began") run.intent = { from: run.intent?.from ?? record.at, to: null };
    else if (event.kind === "intent") run.intent = { from: run.intent?.from ?? record.at, to: record.at };
    // The fact a rule said to the lead named, the moment it fired: a fact read later in the run can tell it was said.
    else if (event.kind === "rule_fired" && event.firing.fact !== undefined) (run.told ??= new Set()).add(event.firing.fact.name);
    else if (event.kind === "call_started") {
      run.firstCall ??= record.at;
      run.leadCall.open = { heard: false };
      if (run.released === null) calls.set(event.call, { thinking: null, lastThought: record.at, output: false });
    } else if (event.kind === "call_ended") {
      run.leadCall.open = null;
      if (event.error === undefined) run.leadCall.failed = null;
      // A call whose only output was a tool call (the record written to its file) ended its thinking where its last thought came.
      const call = calls.get(event.call);
      if (call !== undefined && !call.output && call.thinking !== null && (event.text !== "" || event.toolCalls.length > 0)) this.#output(followed, call);
    } else if (event.kind === "call_failed") run.leadCall.failed = { tries: event.tries, failure: event.failure };
  }

  /** A piece of a model call's streaming text or thinking, as it came. */
  delta(delta: TraceDelta): void {
    const followed = this.#followed.get(delta.run);
    if (followed === undefined || delta.agent !== followed.lead) return;
    if ((delta.thinking !== undefined && delta.thinking !== "") || (delta.text !== undefined && delta.text !== "")) followed.run.leadCall.open = { heard: true };
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
