// The chat's state, from RPE (plan §14, "What happens to today's UI"). Today's panels and HUD render
// the `StateView` today's state sync put in `App.sync`; here it is read from RPE's state route for one
// chat and put in the same place. It is read again whenever the chat's live view says the state may
// have changed: RPE says so (its `state` kind, which it publishes after a change made from a panel,
// when a run of the chat ends, and when a turn joins the chat), events were lost on the way, or
// following the chat began (again); and when today's page asks for the chat's view afresh, as it does
// once it attached a world. Nothing is read on a timer, and at most one read is out at a time: what
// asks meanwhile is answered by one read after it. A read that fails, or live updates RPE stops, is
// said in the client's own words until a read succeeds, and the last state read stays shown.

import type { SyncState } from "../../../frontend/protocol-client";
import { createStore, type Readable } from "../../../frontend/store";
import { replyOf, type RpeClient } from "../../client";
import { errorWords } from "../../words";

/** The live kind RPE publishes on a chat once its state changed (`src/play/live.ts`), with no data of its own. */
export const STATE_CHANGED = "state";

export interface ChatState extends Readable<SyncState> {
  /** Reads the chat's state again. */
  read(): void;
  /** Stops following the chat; a read still out changes nothing once it is back. */
  stop(): void;
}

export function chatState(client: Pick<RpeClient, "call" | "follow">, chat: string): ChatState {
  // Before anything is read: no view, and a read on its way.
  const state = createStore<SyncState>({ chatId: chat, rev: null, view: null, status: "syncing", resyncs: 0, activity: null, canStop: null, failed: null });
  let alive = true;
  let reading = false;
  let again = false;

  const read = (): void => {
    if (!alive) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    if (state.get().view !== null) state.update((held) => ({ ...held, status: "resyncing" }));
    client.call("GET /api/v1/chats/:chat/state", { chat }).then(replyOf).then(
      (view) => {
        reading = false;
        if (!alive) return;
        state.set({ ...state.get(), view, status: "live", failed: null });
        if (again) {
          again = false;
          read();
        }
      },
      (error: unknown) => {
        reading = false;
        if (!alive) return;
        // The last state read stays shown; with none, there is nothing to show but why.
        state.update((held) => ({ ...held, status: held.view === null ? "closed" : "live", failed: errorWords(error) }));
        if (again) {
          again = false;
          read();
        }
      },
    );
  };

  const unfollow = client.follow(chat, {
    events(events, missed) {
      if (missed !== null || events.some((event) => event.kind === STATE_CHANGED)) read();
    },
    reset: read,
    refused(words) {
      state.update((held) => ({ ...held, failed: words }));
    },
  });
  read();

  return {
    get: () => state.get(),
    subscribe: (listener) => state.subscribe(listener),
    read,
    stop() {
      if (!alive) return;
      alive = false;
      unfollow();
    },
  };
}
