// Today's frontend reaches its backend through two calls, send a message and hear messages
// (`frontend/protocol-client.ts`, `Transport`). On the Play page they reach RPE's routes for the
// chat the page shows, by whichever road the page's client is on: an Undo (`lre.chip` with the
// choice `undo`) is posted to `POST /api/v1/chats/:chat/actions/undo`, every other message to
// `POST /api/v1/chats/:chat/actions`, each as it is; what RPE answers, today's `lre.result` or
// `lre.error`, is handed to whoever hears. A call the client could not make is answered as today's
// backend answers what it cannot do: an `lre.error` coded `unavailable`, in the client's own words.
//
// What RPE answers `unavailable` it does not serve: the same message is not sent again while the
// page shows, and the transport answers it with RPE's own answer. What a done tap changed comes as the
// chat's state does, once RPE's live hub says it changed (source.ts).

import type { Transport } from "../../../frontend/protocol-client";
import { type ErrorMessage, PROTOCOL_VERSION } from "../../../shared/protocol";
import type { RpeClient } from "../../client";
import { errorWords } from "../../words";

export interface PlayTransport extends Transport {
  /** RPE's own `unavailable` answers so far, one for each message it refused, in the order refused. */
  refusals(): readonly ErrorMessage[];
  /** Hands nothing on from here: every hearer is let go, answers still on their way are dropped, and nothing more is sent. */
  close(): void;
}

export function playTransport(client: Pick<RpeClient, "call">, chat: string): PlayTransport {
  const hearers = new Set<(payload: unknown) => void>();
  const refusals = new Map<string, ErrorMessage>();
  let closed = false;
  const hand = (payload: unknown): void => {
    for (const hearer of [...hearers]) hearer(payload);
  };
  return {
    send(message) {
      if (closed) return;
      // The same tap asked again is the same message, whatever its request's own id.
      const { reqId, ...rest } = message;
      const key = JSON.stringify(rest);
      const refused = refusals.get(key);
      if (refused !== undefined) {
        // Answered as a reply comes, after the send returns.
        queueMicrotask(() => {
          if (!closed) hand({ ...refused, reqId });
        });
        return;
      }
      const route = message.type === "lre.chip" && message.choice === "undo" ? "POST /api/v1/chats/:chat/actions/undo" : "POST /api/v1/chats/:chat/actions";
      client.call(route, { chat }, { body: message }).then(
        (answer) => {
          if (closed) return;
          if (answer.type === "lre.error" && answer.code === "unavailable") refusals.set(key, answer);
          hand(answer);
        },
        (error: unknown) => {
          if (closed) return;
          const failed: ErrorMessage = { lre: PROTOCOL_VERSION, type: "lre.error", reqId: message.reqId, code: "unavailable", message: errorWords(error) };
          hand(failed);
        },
      );
    },
    subscribe(hearer) {
      hearers.add(hearer);
      return () => hearers.delete(hearer);
    },
    refusals: () => [...refusals.values()],
    close() {
      closed = true;
      hearers.clear();
    },
  };
}
