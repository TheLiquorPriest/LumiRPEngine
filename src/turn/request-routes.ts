// The routes of what the player asks for beside his words (`requests.ts`; plan §10.10, §14): what waits
// in a chat, listed; a composer control's ask held for the next message; one that waits, withdrawn; a
// press a turn was told and did not carry out, held again for the next message or dropped; and what a
// turn was told and keeps. A panel's tap is held by the panel's own route. An ask longer than
// `turn.maxRequestChars` is not kept, and each refusal is said in the words of `.prompts/request-answers.md`.

import { loadGuidance } from "../app/guidance";
import { route, RouteError } from "../app";
import { JoinedTurnError } from "../store";
import type { Turns } from "./lane";
import { requestText } from "./requests";
import { turnSettings } from "./settings";
import { requestAsk, requestDroppedReply, requestHeldReply, requestsReply, requestWithdrawnReply } from "./shapes";
import { NO_SESSION } from "./turns";

/** The prompt part the request routes answer in. */
export const REQUEST_ANSWERS = "request-answers";

export function requestRoutes(turns: Turns) {
  /** A refusal in the words of the request answers in force for the chat; its name alone where the part has no such line. */
  const refused = async (user: string, chat: string, status: number, name: string, fields: Record<string, string | number>): Promise<never> => {
    const part = await loadGuidance(turns.files, { user, chat, session: NO_SESSION }).part(REQUEST_ANSWERS);
    throw new RouteError(status, (part?.format === "lines" ? part.line(name, fields) : undefined) ?? name);
  };
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/requests",
      access: "page",
      group: "chats",
      does: "What waits in a chat for the next message, asked for beside his words: each request with its kind, what was asked and when.",
      reply: requestsReply,
      handle: ({ user, params }) => ({ requests: turns.requests.waiting(user, params.chat) }),
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/requests",
      access: "page",
      group: "chats",
      does: "Holds a composer control's ask (depth or swipe) for the next message, in place of one of its kind that waited; one longer than turn.maxRequestChars is not kept, and the answer says so.",
      body: requestAsk,
      reply: requestHeldReply,
      handle: async ({ user, params, body }) => {
        const words = typeof body.words === "string" && body.words.trim() !== "" ? body.words : null;
        const asked = { choice: body.choice, words };
        const { requestsTextMost } = await turnSettings(turns.files, { user, chat: params.chat, session: NO_SESSION }, turns.env.log);
        const length = requestText(asked).length;
        if (length > requestsTextMost) await refused(user, params.chat, 413, "too_long", { length, most: requestsTextMost });
        return { request: await turns.requests.hold(user, params.chat, { kind: body.kind, asked }, Date.now()) };
      },
    }),
    route({
      method: "DELETE",
      path: "/api/v1/chats/:chat/requests/:request",
      access: "page",
      group: "chats",
      does: "Withdraws a request that waits; one kept with a turn already stays, and the answer names the turn.",
      reply: requestWithdrawnReply,
      handle: async ({ user, params }) => {
        const out = await turns.requests.withdraw(user, params.chat, params.request);
        if (out === null) return await refused(user, params.chat, 404, "not_found", { request: params.request });
        if ("kept" in out) return await refused(user, params.chat, 409, "kept", { turn: out.kept });
        return out;
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/requests/:request/again",
      access: "page",
      group: "chats",
      does: "Holds a panel's press a turn was told and did not carry out again for the next message, in place of a press that waited; the press told is dropped.",
      reply: requestHeldReply,
      handle: async ({ user, params }) => {
        const request = await turns.requests.again(user, params.chat, params.request, Date.now());
        if (request === null) return await refused(user, params.chat, 404, "not_told", { request: params.request });
        return { request };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/requests/:request/drop",
      access: "page",
      group: "chats",
      does: "Drops a panel's press a turn was told and did not carry out: it is shown no more, nor owed by a run of a turn told it.",
      reply: requestDroppedReply,
      handle: async ({ user, params }) => {
        if (!(await turns.requests.drop(user, params.chat, params.request))) return await refused(user, params.chat, 404, "not_told", { request: params.request });
        return { dropped: true as const };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/requests",
      access: "page",
      group: "turns",
      does: "What a turn was told beside his words and keeps, and what was played as its message.",
      reply: requestsReply,
      joined: true,
      handle: ({ user, params }) => {
        const store = turns.store.user(user);
        const row = store.turn(params.turn);
        if (row === null || row.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${params.turn}.`);
        if (row.joined !== null) throw new JoinedTurnError(params.turn, row.joined);
        return { requests: turns.requests.ofTurn(user, row.id, row.message) };
      },
    }),
  ] as const;
}
