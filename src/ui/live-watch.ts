// Watching a chat as its pages show it. The Live page watches its latest turn, whichever that is; the
// Turn page watches one turn, and every run of it (a continue runs it again). Either way: follow the
// chat's live events, read at once (so the page shows something even while the live road is not up)
// and again once following has begun, and read again wherever something was lost on the way (a hole in
// a run's records, events the hub dropped for a page that fell behind, a relay frame lost). The Turn
// page also reads its turn again when one of its runs begins or ends, since what a read says beside the
// records (how the turn stands, its moments, what it spent) changes then. What the page is shown changes
// at most once each `renderMs`, however fast the events come, but a read's result shows at once.

import { isRecord } from "../shared/json";
import type { LiveEvent, TurnDetail } from "./api";
import type { RpeClient } from "./client";
import { applyLive, applyRead, EMPTY_LIVE, holeIn, lastRunOf, type LiveModel } from "./live-model";
import type { Timers } from "./roads";
import { errorWords } from "./words";

export interface Watched {
  model: LiveModel;
  /** The first read has not come back yet. */
  loading: boolean;
  /** What could not be read, in RPE's words; null when all was. */
  problem: string | null;
  /** The last read of the turn watched, on the Turn page; null on the Live page, and until it has come. */
  detail: TurnDetail | null;
}

export const NOTHING_WATCHED: Watched = { model: EMPTY_LIVE, loading: true, problem: null, detail: null };

/** Fixed default: ten redraws a second at most while a busy turn streams. */
export const WATCH_RENDER_MS = 100;

/** Fixed: how many runs a page left open keeps; older ones that ended are let go (the Turns page has them all). */
export const WATCH_KEEP_RUNS = 4;

/** The model without its oldest ended runs past `keep`. */
function pruned(model: LiveModel, keep: number): LiveModel {
  let extra = model.runs.length - keep;
  if (extra <= 0) return model;
  return {
    runs: model.runs.filter((run) => {
      if (extra <= 0 || run.outcome === null) return true;
      extra--;
      return false;
    }),
  };
}

/** The run a live event is about: every kind a run publishes names it. */
function runOfEvent(event: LiveEvent): string | null {
  return isRecord(event.data) && typeof event.data.run === "string" ? event.data.run : null;
}

/** Whether a live event is a run of its turn beginning or ending. */
function turning(event: LiveEvent): boolean {
  if (event.kind !== "trace" || !isRecord(event.data) || !isRecord(event.data.event)) return false;
  return event.data.event.kind === "run_started" || event.data.event.kind === "run_ended";
}

/** Watches a chat's latest turn, whichever it is, for the Live page. */
export function watchChat(client: RpeClient, chat: string, timers: Timers, onChange: (watched: Watched) => void, renderMs: number = WATCH_RENDER_MS): () => void {
  return watch(client, chat, null, timers, onChange, renderMs);
}

/** Watches one turn of a chat, each of its runs, for the Turn page. */
export function watchTurn(client: RpeClient, chat: string, turn: string, timers: Timers, onChange: (watched: Watched) => void, renderMs: number = WATCH_RENDER_MS): () => void {
  return watch(client, chat, turn, timers, onChange, renderMs);
}

function watch(client: RpeClient, chat: string, only: string | null, timers: Timers, onChange: (watched: Watched) => void, renderMs: number): () => void {
  let model: LiveModel = EMPTY_LIVE;
  let loading = true;
  let problem: string | null = null;
  let detail: TurnDetail | null = null;
  let alive = true;
  let timer: unknown = null;
  /** Turns being read now, so one hole is not read twice at once. */
  const reading = new Set<string>();
  /** Turns to read again once the read of them now out is back. */
  const stale = new Set<string>();

  const publish = (): void => {
    timers.clearTimeout(timer);
    timer = null;
    if (alive) onChange({ model, loading, problem, detail });
  };
  const soon = (): void => {
    if (timer === null) timer = timers.setTimeout(publish, renderMs);
  };
  /** Where a read of a turn starts: past the records its latest run has. */
  const nextOf = (turn: string): number => (lastRunOf(model, turn)?.seq ?? 0) + 1;

  async function read(turn: string, from: number): Promise<void> {
    if (reading.has(turn)) return;
    reading.add(turn);
    let got: TurnDetail | null = null;
    try {
      got = await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat, turn }, { query: { from } });
    } catch (error) {
      problem = errorWords(error);
    } finally {
      reading.delete(turn);
    }
    if (!alive) return;
    if (got !== null) {
      model = applyRead(model, got);
      if (turn === only) detail = got;
      problem = null;
    }
    if (turn === only) loading = false;
    publish();
    // Events that came while the read was out may have left a hole the read did not reach: read on, while each read gets further.
    const run = lastRunOf(model, turn);
    const hole = run === undefined ? null : holeIn(run);
    if (stale.delete(turn)) refresh(turn);
    else if (got !== null && hole !== null && hole > from) void read(turn, hole);
  }

  /** Reads a turn again, or once the read of it now out is back. */
  function refresh(turn: string): void {
    if (reading.has(turn)) stale.add(turn);
    else void read(turn, nextOf(turn));
  }

  async function readLatest(): Promise<void> {
    try {
      const list = await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: 1 } });
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
        if (only !== null && runOfEvent(event) !== only) continue;
        model = applyLive(model, event);
        begunOrEnded ||= turning(event);
      }
      if (only === null) model = pruned(model, WATCH_KEEP_RUNS);
      soon();
      for (const run of model.runs) {
        const hole = holeIn(run);
        if (hole !== null) void read(run.run, hole);
      }
      if (only !== null && begunOrEnded) refresh(only);
      // The hub dropped events for this page: whatever they held is read again, the latest turn's included.
      if (missed !== null) {
        catchUp();
        for (const run of model.runs) if (run.outcome === null) void read(run.run, run.seq + 1);
      }
    },
    reset() {
      catchUp();
      for (const run of model.runs) if (run.outcome === null) void read(run.run, run.seq + 1);
    },
    refused(words) {
      problem = words;
      loading = false;
      publish();
    },
  });
  if (only === null) void readLatest();
  else void read(only, 1);

  return () => {
    alive = false;
    timers.clearTimeout(timer);
    timer = null;
    off();
  };
}
