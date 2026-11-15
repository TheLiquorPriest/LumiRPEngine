// Watching a chat as its pages show it. The Live page watches every run of the chat: whichever turn is
// its latest, and any run going on beside it (a job a turn started, or one the user did); the Turn page
// watches one turn, and every run of it (a continue runs it again), each under RPH's own id for it: a
// run is the turn's when its records' scope names the turn, and its streaming text and what it sent to
// the chat are known by that run. Either way: follow the chat's live events, read at once (so the page
// shows something even while the live road is not up) and again once following has begun, and read
// again wherever something was lost on the way (a hole in a run's records, read by that run, events the
// hub dropped for a page that fell behind, a relay frame lost). The Turn page also reads its turn again
// when one of its runs begins or ends, since what a read says beside the records (how the turn stands,
// its moments, what it spent) changes then. What the page is shown changes at most once each
// `renderMs`, however fast the events come, but a read's result shows at once. The Live page keeps
// `keepRuns` runs: past that the oldest that ended is let go, and named, so its Turn page stays in reach.

import type { RunStatus } from "rp-harness/contract";
import type { LiveEvent, TurnReply } from "../shared/api";
import { isRecord } from "../shared/json";
import { replyOf, type RpeClient } from "./client";
import { applyLive, applyRead, EMPTY_LIVE, type EventOf, holeIn, type LiveModel, type RunNode, runOf } from "./live-model";
import type { Timers } from "./roads";
import { errorWords } from "./words";

/** A run the Live page let go (it kept `keepRuns` and this had ended): enough to name it and lead to its Turn page, which holds all of it. */
export interface LetGo {
  readonly run: string;
  readonly turn: string | null;
  readonly started: EventOf<"run_started"> | null;
  readonly status: RunStatus | null;
  readonly endedAt: number | null;
}

export interface Watched {
  model: LiveModel;
  /** The first read has not come back yet. */
  loading: boolean;
  /** What could not be read, in RPE's words; null when all was. */
  problem: string | null;
  /** The last read of the turn watched, on the Turn page; null on the Live page, and until it has come. */
  detail: TurnReply | null;
  /** On the Live page: the runs let go, the one let go first first. */
  letGo: readonly LetGo[];
  /** How many events the hub dropped for this page because it fell behind, all told; 0 when none. */
  behind: number;
}

export const NOTHING_WATCHED: Watched = { model: EMPTY_LIVE, loading: true, problem: null, detail: null, letGo: [], behind: 0 };

/** What a watch is held to, read each time it is used so a change of the setting holds at once: the most often it redraws (ms) and the runs the Live page keeps. */
export interface WatchLimits {
  readonly renderMs: number;
  readonly keepRuns: number;
}

/** The model without its oldest ended runs past `keep`, and those it let go. */
function pruned(model: LiveModel, keep: number): { model: LiveModel; dropped: RunNode[] } {
  let extra = model.runs.length - keep;
  const dropped: RunNode[] = [];
  if (extra <= 0) return { model, dropped };
  const runs = model.runs.filter((run) => {
    if (extra <= 0 || run.outcome === null) return true;
    extra--;
    dropped.push(run);
    return false;
  });
  return { model: { runs }, dropped };
}

/** The run a live event is about: every kind a run publishes names it. */
function runOfEvent(event: LiveEvent): string | null {
  // Read as whatever came, the declared kinds' data or not.
  const data: unknown = event.data;
  return isRecord(data) && typeof data.run === "string" ? data.run : null;
}

/** The turn a live event's record is of, as its scope names it; null for any other event. */
function turnOfEvent(event: LiveEvent): string | null {
  const data: unknown = event.data;
  if (event.kind !== "trace" || !isRecord(data) || !isRecord(data.scope)) return null;
  return typeof data.scope.turn === "string" ? data.scope.turn : null;
}

/** Where a read of a turn begins: a run of it, by RPH's id for it, and the record of that run (none named: the turn's first run, whole). */
interface ReadFrom {
  run?: string;
  from: number;
}

/** Whether a live event is a run of its turn beginning or ending. */
function turning(event: LiveEvent): boolean {
  if (event.kind !== "trace" || !isRecord(event.data) || !isRecord(event.data.event)) return false;
  return event.data.event.kind === "run_started" || event.data.event.kind === "run_ended";
}

/**
 * Calls `onChange` each time what a page shows of a chat beside its turns may have changed: a run of it
 * began or ended, the chat's state changed, or the page is told to read afresh (following began, or
 * events were lost on the way). The Cast, Story and Turns pages read again then; nothing polls.
 */
export function onChatChange(client: Pick<RpeClient, "follow">, chat: string, onChange: () => void): () => void {
  return client.follow(chat, {
    events(events, missed) {
      if (missed !== null || events.some((event) => event.kind === "state" || turning(event))) onChange();
    },
    reset: onChange,
    refused: () => undefined,
  });
}

/** Watches a chat's runs, every one going on and the latest turn's, for the Live page. */
export function watchChat(client: RpeClient, chat: string, timers: Timers, onChange: (watched: Watched) => void, limits: () => WatchLimits): () => void {
  return watch(client, chat, null, timers, onChange, limits);
}

/** Watches one turn of a chat, each of its runs, for the Turn page. */
export function watchTurn(client: RpeClient, chat: string, turn: string, timers: Timers, onChange: (watched: Watched) => void, limits: () => WatchLimits): () => void {
  return watch(client, chat, turn, timers, onChange, limits);
}

function watch(client: RpeClient, chat: string, only: string | null, timers: Timers, onChange: (watched: Watched) => void, limits: () => WatchLimits): () => void {
  let model: LiveModel = EMPTY_LIVE;
  let loading = true;
  let problem: string | null = null;
  let detail: TurnReply | null = null;
  let letGo: readonly LetGo[] = [];
  let behind = 0;
  let alive = true;
  let timer: unknown = null;
  /** Turns being read now, so one hole is not read twice at once. */
  const reading = new Set<string>();
  /** Turns to read again once the read of them now out is back. */
  const stale = new Set<string>();
  /** On the Turn page: the runs of its turn heard of so far, by RPH's id for each. */
  const ours = new Set<string>();

  const publish = (): void => {
    timers.clearTimeout(timer);
    timer = null;
    if (!alive) return;
    if (only === null) {
      // A run read again after it was let go is let go again, and named once.
      const kept = pruned(model, limits().keepRuns);
      model = kept.model;
      const gone = kept.dropped.filter((run) => !letGo.some((l) => l.run === run.run));
      if (gone.length > 0) letGo = [...letGo, ...gone.map((run): LetGo => ({ run: run.run, turn: run.turn, started: run.started, status: run.outcome?.status ?? null, endedAt: run.endedAt }))];
    }
    onChange({ model, loading, problem, detail, letGo, behind });
  };
  const soon = (): void => {
    if (timer === null) timer = timers.setTimeout(publish, limits().renderMs);
  };
  /** Where a read of a turn starts: past the records of the latest run of it the page holds records of, a turn's own run before a job's. */
  const nextOf = (turn: string): ReadFrom => {
    const held = (r: RunNode): boolean => r.turn === turn && (r.seq > 0 || r.waiting.length > 0);
    const run = model.runs.findLast((r) => held(r) && r.started?.run !== "job") ?? model.runs.findLast(held);
    return run === undefined ? { from: 1 } : { run: run.run, from: run.seq + 1 };
  };
  /** Reads a turn's run on from `from`; for a run the page holds no record of yet (one read before its first), the turn on from where the page has it. */
  const readOn = (run: RunNode, from: number): void => {
    if (run.turn === null) return;
    if (run.seq > 0 || run.waiting.length > 0) void read(run.turn, { run: run.run, from });
    else refresh(run.turn);
  };
  /** Whether a live event is of a run of the turn the Turn page watches: its records' scope names the turn, and its other events name the run. */
  const ofOurs = (event: LiveEvent): boolean => {
    const run = runOfEvent(event);
    if (run === null) return false;
    if (turnOfEvent(event) === only) ours.add(run);
    return ours.has(run);
  };

  async function read(turn: string, at: ReadFrom): Promise<void> {
    if (reading.has(turn)) return;
    reading.add(turn);
    let got: TurnReply | null = null;
    try {
      got = replyOf(await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat, turn }, { query: at }));
    } catch (error) {
      problem = errorWords(error);
    } finally {
      reading.delete(turn);
    }
    if (!alive) return;
    if (got !== null) {
      // The Live page does not take back a run it let go.
      const kept = only === null ? got : { ...got, trace: got.trace.filter((r) => !letGo.some((l) => l.run === r.run)), runs: got.runs.filter((view) => !letGo.some((l) => l.run === (view.run ?? view.id))) };
      model = applyRead(model, kept);
      if (turn === only) {
        detail = got;
        for (const record of got.trace) ours.add(record.run);
        for (const view of got.runs) if (view.run !== null) ours.add(view.run);
      }
      problem = null;
    }
    if (turn === only) loading = false;
    publish();
    // Events that came while the read was out may have left a hole in the run read that the read did not reach: read on, while each read gets further.
    const run = at.run === undefined ? model.runs.findLast((r) => r.turn === turn) : runOf(model, at.run);
    const hole = run === undefined ? null : holeIn(run);
    if (stale.delete(turn)) refresh(turn);
    else if (got !== null && run !== undefined && hole !== null && (at.run !== run.run || hole > at.from)) void read(turn, { run: run.run, from: hole });
  }

  /** Reads a turn again, or once the read of it now out is back. */
  function refresh(turn: string): void {
    if (reading.has(turn)) stale.add(turn);
    else void read(turn, nextOf(turn));
  }

  async function readLatest(): Promise<void> {
    try {
      const list = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: 1 } }));
      const latest = list.turns[0];
      if (latest !== undefined && alive) await read(latest.id, nextOf(latest.id));
    } catch (error) {
      problem = errorWords(error);
    }
    loading = false;
    publish();
  }

  /** Reads afresh what the page shows: the chat's latest turn, or the turn watched. */
  const catchUp = (): void => {
    if (only === null) void readLatest();
    else refresh(only);
  };

  const off = client.follow(chat, {
    events(events, missed) {
      let begunOrEnded = false;
      for (const event of events) {
        if (only !== null && !ofOurs(event)) continue;
        model = applyLive(model, event);
        begunOrEnded ||= turning(event);
      }
      if (missed !== null) behind += missed.to - missed.from + 1;
      soon();
      for (const run of model.runs) {
        const hole = holeIn(run);
        if (hole !== null) readOn(run, hole);
      }
      if (only !== null && begunOrEnded) refresh(only);
      // The hub dropped events for this page: whatever they held is read again, the latest turn's included.
      if (missed !== null) {
        catchUp();
        for (const run of model.runs) if (run.outcome === null) readOn(run, run.seq + 1);
      }
    },
    reset() {
      catchUp();
      for (const run of model.runs) if (run.outcome === null) readOn(run, run.seq + 1);
    },
    refused(words) {
      problem = words;
      loading = false;
      publish();
    },
  });
  if (only === null) void readLatest();
  else void read(only, { from: 1 });

  return () => {
    alive = false;
    timers.clearTimeout(timer);
    timer = null;
    off();
  };
}
