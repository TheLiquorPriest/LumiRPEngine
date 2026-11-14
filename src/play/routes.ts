// The routes of a chat's play panels (plan §14): the chat's state view, at its head or at one of its
// turns, in the shape today's pages take; today's panel actions as a page sends them, each answered
// with today's `lre.result` or `lre.error`; and the Undo of a tap, sent as today's Undo chip is. Every
// route is a page's: it answers only for the user this RPE belongs to.

import { route, RouteError } from "../app";
import { isRecord } from "../shared/json";
import { type FrontendToBackend, PROTOCOL_VERSION } from "../shared/protocol";
import type { PlayService } from "./service";

export const STATE_PATH = "/api/v1/chats/:chat/state";
export const ACTIONS_PATH = "/api/v1/chats/:chat/actions";
export const UNDO_PATH = "/api/v1/chats/:chat/actions/undo";

/** Whether a body is one of today's requests, as today's dispatcher takes one (`isRequest`): its envelope. */
function isRequest(value: unknown): value is FrontendToBackend {
  return isRecord(value) && value.lre === PROTOCOL_VERSION && typeof value.type === "string" && typeof value.reqId === "string";
}

/** One of today's requests, with the parts its own type needs where this road serves it. */
function request(value: unknown): FrontendToBackend {
  if (!isRequest(value)) throw new RouteError(400, "The body is one of today's messages: { lre: 1, type, reqId, … }.");
  if (value.type === "lre.action" && (typeof value.action !== "string" || !isRecord(value.params) || typeof value.source !== "string")) throw new RouteError(400, "An lre.action names its action, its params and its source.");
  if (value.type === "lre.fix" && !["hint", "time", "thing", "things", "field"].some((k) => k in value)) throw new RouteError(400, "An lre.fix names a field, a time, a hint, a thing or things.");
  return value;
}

/** A request for the chat the path names: one that names another chat is refused. */
function forChat<R extends FrontendToBackend>(r: R, chat: string): R {
  const named = "chatId" in r ? r.chatId : undefined;
  if (named !== undefined && named !== chat) throw new RouteError(400, `The message names chat ${String(named)}, and the path chat ${chat}.`);
  return r;
}

export function playRoutes(play: PlayService) {
  return [
    route({
      method: "GET",
      path: STATE_PATH,
      access: "page",
      handle: ({ user, params, query }) => play.state(user, params.chat, query.get("turn")),
    }),
    route({
      method: "POST",
      path: ACTIONS_PATH,
      access: "page",
      body: request,
      handle: ({ user, params, body }) => play.act(user, params.chat, forChat(body, params.chat)),
    }),
    route({
      method: "POST",
      path: UNDO_PATH,
      access: "page",
      body: (value: unknown) => {
        const r = request(value);
        if (r.type !== "lre.chip" || r.choice !== "undo" || typeof r.chip !== "string") throw new RouteError(400, 'The body is today\'s Undo: { lre: 1, type: "lre.chip", reqId, chatId, chip, choice: "undo" }.');
        return r;
      },
      handle: ({ user, params, body }) => play.undo(user, params.chat, forChat(body, params.chat)),
    }),
  ] as const;
}
