// What the player asks for beside his words, for the next message (plan §10.10, §14): a depth for the
// turn, or how the next swipe is played with a line of feedback. A composer control holds one ask in RPE
// (`POST /api/v1/chats/:chat/requests`); it waits there until the turn takes it, and can be withdrawn
// before. RPE says when what waits changes (`requests` on the chat's live feed), so each control shows
// what is set until the turn takes it, and clears with it.

import { useCallback, useEffect, useState } from "preact/hooks";
import type { RequestShown } from "../../shared/api";
import type { RpeClient } from "../client";
import { errorWords } from "../words";

type Asked = { choice: string; words: string | null };

/** What waits for a chat, of the kinds a composer control asks. */
export interface Asks {
  /** The ask of a kind that waits, or null. */
  of(kind: "depth" | "swipe"): (RequestShown & { asked: Asked }) | null;
  /** Holds an ask for the next message, in place of the one of its kind that waited. */
  hold(kind: "depth" | "swipe", choice: string, words: string | null): Promise<void>;
  /** Withdraws the ask of a kind that waits. */
  withdraw(kind: "depth" | "swipe"): Promise<void>;
  /** Why the last read or change failed, in the client's words; null once one worked. */
  failed: string | null;
}

function isAsk(request: RequestShown): request is RequestShown & { asked: Asked } {
  return (request.kind === "depth" || request.kind === "swipe") && "choice" in request.asked;
}

export function useAsks(client: Pick<RpeClient, "call" | "follow">, chat: string): Asks {
  const [waiting, setWaiting] = useState<readonly (RequestShown & { asked: Asked })[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const read = useCallback(() => {
    client.call("GET /api/v1/chats/:chat/requests", { chat }).then(
      (reply) => {
        setWaiting(reply.requests.filter(isAsk));
        setFailed(null);
      },
      (error: unknown) => setFailed(errorWords(error)),
    );
  }, [client, chat]);
  useEffect(() => {
    setWaiting([]);
    read();
    return client.follow(chat, {
      events: (events) => {
        if (events.some((event) => event.kind === "requests")) read();
      },
      reset: read,
      refused: () => undefined,
    });
  }, [chat]);
  const of: Asks["of"] = (kind) => waiting.find((request) => request.kind === kind && !request.played) ?? null;
  return {
    of,
    failed,
    async hold(kind, choice, words) {
      try {
        const { request } = await client.call("POST /api/v1/chats/:chat/requests", { chat }, { body: { kind, choice, ...(words === null || words.trim() === "" ? {} : { words }) } });
        setWaiting((all) => [...all.filter((held) => held.kind !== kind), ...(isAsk(request) ? [request] : [])]);
        setFailed(null);
      } catch (error) {
        setFailed(errorWords(error));
      }
    },
    async withdraw(kind) {
      const held = of(kind);
      if (held === null) return;
      try {
        await client.call("DELETE /api/v1/chats/:chat/requests/:request", { chat, request: held.id });
        setWaiting((all) => all.filter((request) => request.id !== held.id));
        setFailed(null);
      } catch (error) {
        setFailed(errorWords(error));
        read();
      }
    },
  };
}
