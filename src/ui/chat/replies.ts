// What the line under each reply says (plan §14, PlanChatUI-3): for the messages Lumiverse has mounted, RPE
// gives each one's turn, when and where it happened, what each lane did and its marks, by the swipe shown.
// Only the rows mounted are asked for: each mounted row wants its message, the wants of one moment are
// asked in one read, what was read is kept while the chat stays open, and a row asked again after RPE
// says the chat changed (a swipe flipped, a turn ended). The route is the turn area's
// (`GET /api/v1/chats/:chat/replies`).

import type { LaneShown, ReplyLine } from "../../shared/api";
import { createStore, type Readable } from "../store";
import { errorWords } from "../words";
import type { FrameEnv } from "./surface";

export type { LaneShown, ReplyLine };

export interface RepliesState {
  /** What was read, by message. */
  lines: ReadonlyMap<string, ReplyLine>;
  failed: string | null;
}

export interface Replies extends Readable<RepliesState> {
  /** A mounted row wants its message's line. */
  want(message: string): void;
  stop(): void;
}

const made = new WeakMap<FrameEnv, { chat: string; replies: Replies }>();

export function repliesOf(env: FrameEnv): Replies | null {
  const chat = env.chat.get();
  const held = made.get(env);
  if (chat === null) {
    held?.replies.stop();
    return null;
  }
  if (held !== undefined && held.chat === chat) return held.replies;
  held?.replies.stop();
  const state = createStore<RepliesState>({ lines: new Map(), failed: null });
  const ask = env.client.call;
  const wanted = new Set<string>();
  const shown = new Set<string>();
  let alive = true;
  let queued = false;
  const flush = (): void => {
    queued = false;
    if (!alive || wanted.size === 0) return;
    const ids = [...wanted];
    wanted.clear();
    ask("GET /api/v1/chats/:chat/replies", { chat }, { query: { ids: ids.join(",") } }).then(
      (reply) => {
        if (!alive) return;
        const lines = new Map(state.get().lines);
        for (const line of reply.replies) lines.set(line.message, line);
        state.set({ lines, failed: null });
      },
      (error: unknown) => {
        if (alive) state.update((now) => ({ ...now, failed: errorWords(error) }));
      },
    );
  };
  const unfollow = env.client.follow(chat, {
    events(events) {
      // A swipe flipped or a turn ended: what the rows on the page show is asked for again.
      if (!events.some((event) => event.kind === "state")) return;
      for (const message of shown) wanted.add(message);
      if (!queued) {
        queued = true;
        queueMicrotask(flush);
      }
    },
    reset: () => undefined,
    refused: () => undefined,
  });
  const replies: Replies = {
    get: () => state.get(),
    subscribe: (listener) => state.subscribe(listener),
    want(message) {
      shown.add(message);
      if (state.get().lines.has(message) || wanted.has(message)) return;
      wanted.add(message);
      if (!queued) {
        queued = true;
        queueMicrotask(flush);
      }
    },
    stop() {
      alive = false;
      unfollow();
      if (made.get(env)?.replies === replies) made.delete(env);
    },
  };
  made.set(env, { chat, replies });
  return replies;
}

/** Lets go of the open chat's replies. */
export function releaseReplies(env: FrameEnv): void {
  made.get(env)?.replies.stop();
}
