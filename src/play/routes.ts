// The routes of a chat's play panels (plan §14): the chat's state view, at its head or at one of its
// turns, in the shape today's pages take; today's panel actions as a page sends them, each answered
// with today's `lre.result` or `lre.error`; and the Undo of a tap, sent as today's Undo chip is. Every
// route is a page's: it answers only for the user this RPE belongs to. The actions and the undo are a
// tunnel for the previous build's message envelope, declared as such (`src/app/tunnel.ts`), until the
// panels have routes of their own.

import { errorMessage, requestMessage, resultMessage, route, RouteError, shape, stateView } from "../app";
import { isRecord } from "../shared/json";
import type { FrontendToBackend } from "../shared/protocol";
import type { PlayService } from "./service";

export const STATE_PATH = "/api/v1/chats/:chat/state";
export const ACTIONS_PATH = "/api/v1/chats/:chat/actions";
export const UNDO_PATH = "/api/v1/chats/:chat/actions/undo";
export const DUE_PATH = "/api/v1/chats/:chat/state/due";

const dueShown = shape.named(
  "DueShown",
  "One thing a turn's time brought due: its kind, what it is, when it fell due as the world prints it, the level it concerns (null where none), and the turn's changes recorded for it (null while none were).",
  shape.object({ kind: shape.text(), words: shape.text(), when: shape.text(), at: shape.nullable(shape.text()), outcome: shape.nullable(shape.text()) }),
);
const dueReply = shape.named(
  "DueReply",
  "What a turn's time brought due, soonest first, as many as the chat's engine.dueItems lists, and how many more fell due (null: more did, uncounted).",
  shape.object({
    turn: shape.turnId(),
    span: shape.field(shape.nullable(shape.object({ from: shape.text(), to: shape.text() })), "The turn's span as the world prints its two ends; null where no time passed."),
    items: shape.list(dueShown),
    more: shape.nullable(shape.number()),
  }),
);

/** One of today's requests, with the parts its own type needs where this road serves it. */
function request(value: FrontendToBackend): FrontendToBackend {
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

/** Today's answer to a request: a result, or an error. */
const answered = shape.union(resultMessage, errorMessage);

/** Today's Undo of a tap: a chip's request with the choice `undo`, its chip the tap's id. */
const undoAsk = shape.named(
  "UndoAsk",
  'Today\'s Undo of a tap, as the previous build\'s Undo chip sends it: `{ lre: 1, type: "lre.chip", reqId, chatId, chip, choice: "undo" }`, the chip being the tap\'s id.',
  shape.object({
    lre: shape.literal(1),
    type: shape.literal("lre.chip"),
    reqId: shape.text(),
    chatId: shape.text(),
    chip: shape.field(shape.turnId("tap:<turn>:<tap>"), "The tap's id: `tap:<turn>:<tap>`, the turn it was recorded on and its own id there."),
    choice: shape.literal("undo"),
    payload: shape.optional(shape.record(shape.json())),
  }),
);

export function playRoutes(play: PlayService) {
  return [
    route({
      method: "GET",
      path: STATE_PATH,
      access: "page",
      group: "state",
      does: "A chat's state view, at its head or as it stood at one of its turns, in the shape the previous build's pages take.",
      query: { turn: shape.optional(shape.turnId(), "A turn's id: the state as it stood at that turn; left out, at the chat's head.") },
      reply: stateView,
      joined: true,
      handle: ({ user, params, query }) => play.state(user, params.chat, query.turn ?? null),
    }),
    route({
      method: "POST",
      path: ACTIONS_PATH,
      access: "page",
      group: "state",
      does: "Tunnel for the previous build's messages: a panel's action as a page sends it, answered with today's `lre.result` or `lre.error`.",
      body: requestMessage,
      reply: answered,
      handle: ({ user, params, body }) => play.act(user, params.chat, forChat(request(body), params.chat)),
    }),
    route({
      method: "POST",
      path: UNDO_PATH,
      access: "page",
      group: "state",
      does: "Tunnel for the previous build's messages: the Undo of a tap, sent as the previous build's Undo chip is, answered with today's `lre.result` or `lre.error`; a tap of a turn joined to another is answered with the turn it joined.",
      body: undoAsk,
      reply: answered,
      joined: true,
      handle: ({ user, params, body }) => play.undo(user, params.chat, forChat(body, params.chat)),
    }),
    route({
      method: "GET",
      path: DUE_PATH,
      access: "page",
      group: "state",
      does: "What a turn's time brought due, each thing with what the turn recorded for it.",
      query: { turn: shape.optional(shape.turnId(), "A turn's id; left out, the chat's newest turn.") },
      reply: dueReply,
      joined: true,
      handle: ({ user, params, query }) => play.due(user, params.chat, query.turn ?? null),
    }),
  ] as const;
}
