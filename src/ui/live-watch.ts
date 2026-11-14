// Watching a chat for the Live page: follow its live events, read its latest turn at once (so the page
// shows it even while the live road is not up) and again once following has begun, and read again
// wherever something was lost on the way (a hole in a run's records, events the hub dropped for a page
// that fell behind, a relay frame lost). What the page is shown changes at most once each `renderMs`,
// however fast the events come, but a read's result shows at once.

import type { TurnDetail } from "./api";
import type { RpeClient } from "./client";
import { applyLive, applyRead, EMPTY_LIVE, holeIn, type LiveModel } from "./live-model";
import type { Timers } from "./roads";
import { errorWords } from "./words";

export interface Watched {
  model: LiveModel;
  /** The first read of the chat's turns has not come back yet. */
  loading: boolean;
  /** What could not be read, in RPE's words; null when all was. */
  problem: string | null;
}

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

export function watchChat(client: RpeClient, chat: string, timers: Timers, onChange: (watched: Watched) => void, renderMs: number = WATCH_RENDER_MS): () => void {
  let model: LiveModel = EMPTY_LIVE;
  let loading = true;
  let problem: string | null = null;
  let alive = true;
  let timer: unknown = null;
  /** Turns being read now, so one hole is not read twice at once. */
  const reading = new Set<string>();

  const publish = (): void => {
    timers.clearTimeout(timer);
    timer = null;
    if (alive) onChange({ model, loading, problem });
  };
  const soon = (): void => {
    if (timer === null) timer = timers.setTimeout(publish, renderMs);
  };

  async function read(turn: string, from: number): Promise<void> {
    if (reading.has(turn)) return;
    reading.add(turn);
    let detail: TurnDetail | null = null;
    try {
      detail = await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat, turn }, { query: { from } });
    } catch (error) {
      problem = errorWords(error);
    } finally {
      reading.delete(turn);
    }
    if (!alive) return;
    if (detail !== null) {
      model = applyRead(model, detail);
      problem = null;
    }
    publish();
    // Events that came while the read was out may have left a hole the read did not reach: read on, while each read gets further.
    const run = model.runs.find((r) => r.run === turn);
    const hole = run === undefined ? null : holeIn(run);
    if (detail !== null && hole !== null && hole > from) void read(turn, hole);
  }

  async function readLatest(): Promise<void> {
    try {
      const list = await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: 1 } });
      const latest = list.turns[0];
      if (latest !== undefined && alive) {
        const known = model.runs.find((r) => r.run === latest.id);
        await read(latest.id, known === undefined ? 1 : known.seq + 1);
      }
    } catch (error) {
      problem = errorWords(error);
    }
    loading = false;
    publish();
  }

  const off = client.follow(chat, {
    events(events, missed) {
      for (const event of events) model = applyLive(model, event);
      model = pruned(model, WATCH_KEEP_RUNS);
      soon();
      for (const run of model.runs) {
        const hole = holeIn(run);
        if (hole !== null) void read(run.run, hole);
      }
      // The hub dropped events for this page: whatever they held is read again, the latest turn's included.
      if (missed !== null) {
        void readLatest();
        for (const run of model.runs) if (run.outcome === null) void read(run.run, run.seq + 1);
      }
    },
    reset() {
      void readLatest();
      for (const run of model.runs) if (run.outcome === null) void read(run.run, run.seq + 1);
    },
    refused(words) {
      problem = words;
      loading = false;
      publish();
    },
  });
  void readLatest();

  return () => {
    alive = false;
    timers.clearTimeout(timer);
    timer = null;
    off();
  };
}
