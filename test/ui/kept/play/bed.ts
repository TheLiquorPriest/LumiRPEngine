// What the Play page's tests share: RPE as the page reaches it, answering its three routes from recorded
// answers (recorded.ts) and telling the chat's followers what its live hub would, every body going and
// coming back as JSON, as over a road. Each call is kept, so a test can say what the page asked.

import type { LiveEvent } from "../../../../src/shared/api";
import type { FrontendToBackend } from "../../../../src/shared/protocol";
import type { StateView } from "../../../../src/shared/state-view";
import { type LiveListener, type RpeClient, RpeError } from "../../../../src/ui/client";

/** A call the page made: its route as the route map keys it, the chat it named, and the body it sent. */
export interface Asked {
  key: string;
  chat: string;
  body: unknown;
}

export interface RecordedRpe {
  client: Pick<RpeClient, "call" | "follow">;
  asked: Asked[];
  /** What the state route answers now: RPE's state of the chat, or the failure of the road the client says. */
  state: StateView | RpeError;
  /** What the action routes answer a message, by the route it came to. */
  answer: (route: string, message: FrontendToBackend) => unknown;
  /** The chat's live events, as the hub tells whoever follows it; `missed` as for a page that fell behind. */
  publish(events: readonly Pick<LiveEvent, "kind" | "data">[], missed?: { from: number; to: number }): void;
  /** Tells the followers that following began again, as the client does after a lost road. */
  reset(): void;
  /** Who follows the chat now. */
  followers(): number;
  /** The state route's reads so far. */
  reads(): number;
}

const STATE_ROUTE = "GET /api/v1/chats/:chat/state";

export function recordedRpe(chat: string, first: StateView): RecordedRpe {
  const listeners = new Set<LiveListener>();
  let seq = 0;
  const rpe: RecordedRpe = {
    client: {
      call: (async (key: string, params: { chat: string }, options?: { body?: unknown }) => {
        const body = options?.body === undefined ? undefined : JSON.parse(JSON.stringify(options.body));
        rpe.asked.push({ key, chat: params.chat, body });
        if (params.chat !== chat) throw new RpeError(404, `RPE has played no chat ${params.chat}.`);
        if (key === STATE_ROUTE) {
          if (rpe.state instanceof RpeError) throw rpe.state;
          return JSON.parse(JSON.stringify(rpe.state));
        }
        return JSON.parse(JSON.stringify(rpe.answer(key, body as FrontendToBackend)));
      }) as RpeClient["call"],
      follow(followed, listener) {
        if (followed !== chat) throw new Error(`The page followed ${followed}, not ${chat}`);
        listeners.add(listener);
        // As the client does once following has begun: read afresh.
        queueMicrotask(() => {
          if (listeners.has(listener)) listener.reset();
        });
        return () => listeners.delete(listener);
      },
    },
    asked: [],
    state: first,
    answer: (route) => {
      throw new RpeError(404, `No route ${route}.`);
    },
    publish(events, missed) {
      const numbered = events.map((event) => ({ chat, seq: (seq += 1), at: seq, ...event }) as LiveEvent);
      for (const listener of [...listeners]) listener.events(numbered, missed ?? null);
    },
    reset() {
      for (const listener of [...listeners]) listener.reset();
    },
    followers: () => listeners.size,
    reads: () => rpe.asked.filter((call) => call.key === STATE_ROUTE).length,
  };
  return rpe;
}

/** The trace record of a run of the chat beginning or ending, as the turn lane publishes it: only what the page reads of it, so not a whole record. */
export function runTrace(kind: "run_started" | "run_ended"): Pick<LiveEvent, "kind" | "data"> {
  return { kind: "trace", data: { run: "run-1", seq: 1, event: { kind } } } as unknown as Pick<LiveEvent, "kind" | "data">;
}
