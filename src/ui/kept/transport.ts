// Today's frontend reaches its backend through two calls, send a message and hear messages
// (`frontend/protocol-client.ts`, `Transport`). Here they reach RPE's Build route instead, by whichever
// road the page's client is on: a sent message is posted to `POST /api/v1/build` as it is, and what RPE
// answers, today's `lre.result` or `lre.error` and then the pushes the request caused, is handed to
// whoever hears, in that order. A call the client could not make is answered as today's backend
// answers what it cannot do: an `lre.error` coded `unavailable`, in the client's own words.
//
// Build's background tools, its lore tools and its secrecy tools are ones this build of RPE may not
// serve. Once RPE has answered one of them `unavailable`, the page does not ask again while it shows:
// the transport answers each later request of that kind with RPE's own answer.

import type { Transport } from "../../frontend/protocol-client";
import { type ErrorMessage, type FrontendToBackend, PROTOCOL_VERSION } from "../../shared/protocol";
import type { RpeClient } from "../client";
import { errorWords } from "../words";

/** The kinds of request RPE's `unavailable` answer stands for the rest of the page's life. */
const ASKED_ONCE: Readonly<Partial<Record<FrontendToBackend["type"], true>>> = { "lre.job": true, "lre.lore": true, "lre.secrecy": true };

export interface BuildTransport extends Transport {
  /** RPE's own `unavailable` answers so far to the kinds of request it is asked once: one for each kind it refused. */
  refusals(): readonly ErrorMessage[];
  /** Hands nothing on from here: every hearer is let go, answers still on their way are dropped, and nothing more is sent. */
  close(): void;
}

export function buildTransport(client: Pick<RpeClient, "call">): BuildTransport {
  const hearers = new Set<(payload: unknown) => void>();
  const refusals = new Map<FrontendToBackend["type"], ErrorMessage>();
  let closed = false;
  const hand = (payload: unknown): void => {
    for (const hearer of [...hearers]) hearer(payload);
  };
  return {
    send(message) {
      if (closed) return;
      const refused = refusals.get(message.type);
      if (refused !== undefined) {
        // Answered as a reply comes, after the send returns.
        queueMicrotask(() => {
          if (!closed) hand({ ...refused, reqId: message.reqId });
        });
        return;
      }
      client.call("POST /api/v1/build", {}, { body: message }).then(
        (answer) => {
          if (closed) return;
          const { result } = answer;
          if (result.type === "lre.error" && result.code === "unavailable" && ASKED_ONCE[message.type] === true) refusals.set(message.type, result);
          hand(result);
          for (const push of answer.pushes) hand(push);
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
