// Where the history window ends (plan §14, PlanChatUI-6 item 2): what RPE says of the window the Author
// reads the chat through now: the history message just above the first it keeps, how many messages lie above
// the window and how many of those the story does not cover yet. Read when the chat opens and again when
// RPE says the chat's state changed (a turn ended, the story covered more), and kept while the chat stays
// open. The route is the door's (`GET /api/v1/chats/:chat/window`); until the generated client has it, it is
// asked through the client's call as it is written there.

import { createStore, type Readable } from "../store";
import { errorWords } from "../words";
import type { FrameEnv } from "./surface";

/** What RPE answers of the window. */
export interface WindowShown {
  /** The window is on for this chat. */
  on: boolean;
  /** Lumiverse's id of the first history message the window keeps. */
  first: string | null;
  /** The history message just above `first`: the one the marker stands under. */
  before: string | null;
  /** History messages above the window. */
  above: number;
  /** Of those, how many the story does not cover yet. */
  uncovered: number;
}

export interface WindowState {
  shown: WindowShown | null;
  failed: string | null;
}

type Ask = (key: string, params: Record<string, string>) => Promise<WindowShown>;

const made = new WeakMap<FrameEnv, { chat: string; store: Readable<WindowState>; stop(): void }>();

export function windowOf(env: FrameEnv): Readable<WindowState> {
  const chat = env.chat.get();
  const held = made.get(env);
  if (held !== undefined && held.chat === (chat ?? "")) return held.store;
  held?.stop();
  const state = createStore<WindowState>({ shown: null, failed: null });
  if (chat === null) {
    made.set(env, { chat: "", store: state, stop: () => undefined });
    return state;
  }
  const ask = env.client.call as unknown as Ask;
  let alive = true;
  const read = (): void => {
    ask("GET /api/v1/chats/:chat/window", { chat }).then(
      (shown) => {
        if (alive) state.set({ shown, failed: null });
      },
      (error: unknown) => {
        if (alive) state.set({ shown: null, failed: errorWords(error) });
      },
    );
  };
  const unfollow = env.client.follow(chat, {
    events: (events) => {
      if (events.some((event) => event.kind === "state")) read();
    },
    reset: read,
    refused: () => undefined,
  });
  read();
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

/** Lets go of the open chat's window. */
export function releaseWindow(env: FrameEnv): void {
  made.get(env)?.stop();
}

/** What the marker says: how many messages lie above the window, and how many of them the story does not cover yet. */
export function windowWords(shown: WindowShown): string {
  if (shown.above === 0) return "The whole chat is in the window.";
  const above = shown.above === 1 ? "1 message above" : `${shown.above} messages above`;
  return shown.uncovered === 0 ? `${above} the window, all covered by the story.` : `${above} the window, ${shown.uncovered} not covered by the story yet.`;
}
