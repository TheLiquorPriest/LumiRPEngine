// What the line under each reply says (plan §14, PlanChatUI-3): for the messages Lumiverse has mounted, RPE
// gives each one's turn, when and where it happened, what each lane did and its marks, by the swipe shown.
// Only the rows mounted now are asked for, and one read at a time: each mounted row wants its message, and
// lets it go when the row is taken down; the wants of one moment are asked in one read, and those that come
// while a read is out wait for it, so a message RPE is still reading is never asked again. What was read is
// kept while the chat stays open. When RPE says the chat changed (a swipe flipped, a turn ended), the rows
// mounted then are asked again, and the lines of rows no longer mounted are let go, to be asked when their
// rows come back. A read that fails leaves its rows without their lines: they are asked again at the next
// change, or when they are mounted again. The route is the turn area's (`GET /api/v1/chats/:chat/replies`).

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
  /** A mounted row wants its message's line; what it gives back says the row was taken down. */
  want(message: string): () => void;
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
  /** The rows mounted now, by message: how many (a message may be drawn twice while Lumiverse swaps its row). */
  const mounted = new Map<string, number>();
  /** Messages to ask in the next read. */
  const wanted = new Set<string>();
  /** Messages the read out now asks; null while none is out. */
  let asking: ReadonlySet<string> | null = null;
  /** Messages the read out now asks that the chat changed under: asked again once it is in. */
  const stale = new Set<string>();
  let alive = true;
  let queued = false;
  const flush = (): void => {
    queued = false;
    if (!alive || asking !== null) return;
    const ids = [...wanted].filter((message) => mounted.has(message));
    wanted.clear();
    if (ids.length === 0) return;
    asking = new Set(ids);
    const settled = (): void => {
      asking = null;
      for (const message of stale) if (mounted.has(message)) wanted.add(message);
      stale.clear();
      schedule();
    };
    ask("GET /api/v1/chats/:chat/replies", { chat }, { query: { ids: ids.join(",") } }).then(
      (reply) => {
        if (!alive) return;
        const lines = new Map(state.get().lines);
        for (const line of reply.replies) lines.set(line.message, line);
        state.set({ lines, failed: null });
        settled();
      },
      (error: unknown) => {
        if (!alive) return;
        state.update((now) => ({ ...now, failed: errorWords(error) }));
        settled();
      },
    );
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  };
  const unfollow = env.client.follow(chat, {
    events(events) {
      // A swipe flipped or a turn ended: the rows on the page now are asked again, and the lines of rows taken down are let go.
      if (!events.some((event) => event.kind === "state")) return;
      const now = state.get();
      const kept = new Map([...now.lines].filter(([message]) => mounted.has(message)));
      if (kept.size !== now.lines.size) state.set({ ...now, lines: kept });
      for (const message of mounted.keys()) {
        if (asking?.has(message) === true) stale.add(message);
        else wanted.add(message);
      }
      schedule();
    },
    reset: () => undefined,
    refused: () => undefined,
  });
  const replies: Replies = {
    get: () => state.get(),
    subscribe: (listener) => state.subscribe(listener),
    want(message) {
      mounted.set(message, (mounted.get(message) ?? 0) + 1);
      if (!state.get().lines.has(message) && asking?.has(message) !== true) {
        wanted.add(message);
        schedule();
      }
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        const left = (mounted.get(message) ?? 1) - 1;
        if (left > 0) mounted.set(message, left);
        else {
          mounted.delete(message);
          wanted.delete(message);
        }
      };
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
