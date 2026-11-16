// Whether the Author is still working after a reply went out to the chat (plan §14, PlanChatUI-6): from
// the reply's release to the run's end, with the run's newest progress line, read from RPE's live feed of
// the chat and nowhere else. The marker is drawn under the newest reply, which is the message the
// newest turn is tied to; RPE is asked for it when a run is released and again when it ends.

import { createStore, type Readable } from "../store";
import { foldRun, NO_RUN, type RunLine } from "../kept/play/activity";
import type { FrameEnv } from "./surface";

export interface Working {
  /** The run is released and has not ended, with the line it last gave. */
  on: boolean;
  line: string | null;
  /** The message the newest turn is tied to: where the marker stands; null while it is not known. */
  message: string | null;
}

const OFF: Working = { on: false, line: null, message: null };

const made = new WeakMap<FrameEnv, { chat: string; store: Readable<Working>; stop(): void }>();

/** What the open chat's run is doing after its reply went out, kept while the chat stays open. */
export function working(env: FrameEnv): Readable<Working> {
  const chat = env.chat.get();
  const held = made.get(env);
  if (held !== undefined && held.chat === chat) return held.store;
  held?.stop();
  const state = createStore<Working>(OFF);
  if (chat === null) {
    made.set(env, { chat: "", store: state, stop: () => undefined });
    return state;
  }
  let run: RunLine = NO_RUN;
  let released = false;
  let alive = true;
  const publish = (): void => {
    const line = run.activity?.state === "running" ? run.activity.label : null;
    state.update((now) => ({ ...now, on: released && run.activity?.state === "running", line }));
  };
  /** The newest turn's message: where the marker stands. */
  const find = (): void => {
    env.client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: 1 } }).then(
      (reply) => {
        const turn = "turns" in reply ? reply.turns[0] : undefined;
        if (alive) state.update((now) => ({ ...now, message: turn?.message ?? null }));
      },
      () => undefined,
    );
  };
  const unfollow = env.client.follow(chat, {
    events(events) {
      run = foldRun(chat, run, events);
      for (const event of events) {
        if (event.kind === "released") {
          released = true;
          find();
        } else if (event.kind === "trace" && event.data.event.kind === "run_ended") released = false;
        else if (event.kind === "trace" && event.data.event.kind === "run_started") released = false;
      }
      publish();
    },
    reset: () => undefined,
    refused: () => undefined,
  });
  made.set(env, {
    chat,
    store: state,
    stop() {
      alive = false;
      unfollow();
      made.delete(env);
    },
  });
  return state;
}

/** Lets go of the open chat's run. */
export function releaseWorking(env: FrameEnv): void {
  made.get(env)?.stop();
}
