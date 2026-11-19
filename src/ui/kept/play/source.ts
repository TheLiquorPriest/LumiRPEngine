// The chat's state, from RPE (plan §14, "What happens to today's UI"). Today's panels and HUD render
// the `StateView` today's state sync put in `App.sync`; here it is read from RPE's state route for one
// chat and put in the same place. It is read again whenever the chat's live view says the state may
// have changed: RPE says so (its `state` kind, which it publishes after a change made from a panel,
// when a run of the chat ends, and when a turn joins the chat; its `requests` kind, when what waits for
// his next message changed, which the view's `staged` shows), events were lost on the way, or
// following the chat began (again); and when today's page asks for the chat's view afresh, as it does
// once it attached a world. Nothing is read on a timer, and at most one read is out at a time: what
// asks meanwhile is answered by one read after it. A read that fails, or live updates RPE stops, is
// said in the client's own words until a read succeeds, and the last state read stays shown. The run
// line (who is at work, the progress line, a failure, an empty reply left standing) is folded from the
// live trace as it is heard, and, for what was told before the page followed, from the chat's newest
// turn, once following begins and again when events were lost: from its row in the list where that says
// the line is none (each of its runs ended with its reply out, or owed none), else from the turn read whole.

import type { SyncState } from "../../../frontend/protocol-client";
import type { LiveEvent } from "../../../shared/api";
import type { StateView } from "../../../shared/state-view";
import { createStore, type Readable } from "../../store";
import { replyOf, type RpeClient } from "../../client";
import { errorWords } from "../../words";
import { foldRun, NO_RUN, quietRow, type RunLine, runOfTurn } from "./activity";

/** The live kind RPE publishes on a chat once its state changed (`src/play/live.ts`), with no data of its own. */
export const STATE_CHANGED = "state";

/** The live kind RPE publishes on a chat when what waits there for his next message changed (`src/turn/requests.ts`): the view's `staged` with it. */
export const REQUESTS_CHANGED = "requests";

export interface ChatState extends Readable<SyncState> {
  /** Reads the chat's state again. */
  read(): void;
  /** Stops following the chat; a read still out changes nothing once it is back. */
  stop(): void;
}

export function chatState(client: Pick<RpeClient, "call" | "follow">, chat: string, heard?: (events: readonly LiveEvent[]) => void): ChatState {
  // Before anything is read: no view, and a read on its way.
  const state = createStore<SyncState>({ chatId: chat, rev: null, view: null, status: "syncing", resyncs: 0, activity: null, canStop: null, failed: null });
  let alive = true;
  let reading = false;
  let again = false;
  /** The chat's run as the trace told it, and the state as RPE last gave it: the view shows Paused while the run's call is held by his pause. */
  let run: RunLine = NO_RUN;
  let base: StateView | null = null;
  const shown = (view: StateView | null): StateView | null => (view !== null && run.held && view.status === "in_flight" ? { ...view, status: "paused" } : view);

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
        base = view;
        state.set({ ...state.get(), view: shown(base), status: "live", failed: null });
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
  /**
   * The run line as the chat's newest turn tells it (`runOfTurn`), for a page that was not following when it was told: read once following
   * has begun, and again when events were lost on the way, with what was heard while the read was out folded on after it, since it is newer.
   */
  let catching = false;
  let catchAgain = false;
  let heardMeanwhile: LiveEvent[] = [];
  const catchUp = (): void => {
    if (!alive) return;
    if (catching) {
      catchAgain = true;
      return;
    }
    catching = true;
    heardMeanwhile = [];
    const done = (): void => {
      catching = false;
      heardMeanwhile = [];
      if (catchAgain) {
        catchAgain = false;
        catchUp();
      }
    };
    void (async (): Promise<RunLine | null> => {
      const newest = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: 1 } })).turns[0];
      if (newest === undefined) return null;
      // A turn whose runs all ended with their reply out (or owed none) folds to no line: its whole record, often large, is not read for it.
      if (quietRow(newest)) return NO_RUN;
      return runOfTurn(chat, replyOf(await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat, turn: newest.id })));
    })().then(
      (told) => {
        const meanwhile = heardMeanwhile;
        if (alive && told !== null) {
          run = foldRun(chat, told, meanwhile);
          state.update((held) => ({ ...held, activity: run.activity, view: shown(base) }));
        }
        done();
      },
      // A chat RPE holds no turn of, or one it could not read: the line stays as the live events left it.
      done,
    );
  };

  const unfollow = client.follow(chat, {
    events(events, missed) {
      heard?.(events);
      if (catching) heardMeanwhile.push(...events);
      const next = foldRun(chat, run, events);
      if (next !== run) {
        run = next;
        state.update((held) => ({ ...held, activity: run.activity, view: shown(base) }));
      }
      if (missed !== null || events.some((event) => event.kind === STATE_CHANGED || event.kind === REQUESTS_CHANGED)) read();
      if (missed !== null) catchUp();
    },
    // Following began (the client says so once it has, or at once where it follows already): the first read, and each after events were lost.
    reset() {
      read();
      catchUp();
    },
    refused(words) {
      state.update((held) => ({ ...held, failed: words }));
    },
  });

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
