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
export const TAPS_PATH = "/api/v1/chats/:chat/taps";
export const TAPS_UNDO_PATH = "/api/v1/chats/:chat/taps/undo";

const T = shape.text();
const opt = shape.optional;
const tell = opt(shape.yesNo(), "Whether the next turn's briefing tells the Author of it (his \"Tell the story\" choice); left out, the tap's group decides.");
const editOpAsk = shape.named(
  "EditOpAsk",
  "One field of the World page's edit: a value or a fact at a level (world, place:<id>, entity:<id>), set or removed, with how exact and how sure he says a fact is.",
  shape.object({
    op: shape.oneOf("set", "remove"),
    at: T,
    key: T,
    as: shape.oneOf("value", "fact"),
    value: opt(T),
    precision: opt(shape.oneOf("exact", "approximate", "vague", "unknown")),
    standing: opt(shape.oneOf("established", "proposed", "assumed")),
  }),
);
const tapAsk = shape.named(
  "TapAsk",
  "A tap that manages, recorded at once as his own edit: one of the world's actions done at once (money, a group, gear, a vehicle); one ✎ form (a hint, the time, a thing, things with a label, or a field); the World page's edit of values and facts; or an edit of operations (\"Make this a property\").",
  shape.union(
    shape.object({ kind: shape.literal("action"), action: T, params: shape.record(shape.json()), source: T, text: opt(T), now: opt(shape.yesNo()), tell }),
    shape.object({
      kind: shape.literal("fix"),
      fix: shape.union(
        shape.object({ hint: T }),
        shape.object({ time: T }),
        shape.object({ thing: shape.json() }),
        shape.object({ things: shape.list(shape.json()), label: T }),
        shape.object({ entity: T, field: T, value: shape.json() }),
      ),
      tell,
    }),
    shape.object({ kind: shape.literal("edit"), ops: shape.list(editOpAsk), tell }),
    shape.object({ kind: shape.literal("ops"), ops: shape.list(shape.json()), tell }),
  ),
);
const tapReply = shape.named(
  "TapReply",
  "What a tap or its Undo came to: whether it was applied, what the world's rules reported of it (kept with it, listed under unsettled), the id its Undo takes (null where nothing was recorded), and the answer in words.",
  shape.object({ applied: shape.yesNo(), reports: shape.list(T), undo: shape.nullable(T), words: T }),
);
const tapUndoAsk = shape.named("TapUndoAsk", "The Undo of an edit of his, by the id its answer gave.", shape.object({ undo: T }));

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
    route({
      method: "POST",
      path: TAPS_PATH,
      access: "page",
      group: "state",
      does: "A tap that manages, or a correction from any page, recorded at once as his own edit; what the world's rules turn down is applied with its report; a refusal is answered in words with nothing changed.",
      body: tapAsk,
      reply: tapReply,
      handle: ({ user, params, body }) => play.tap(user, params.chat, body),
    }),
    route({
      method: "POST",
      path: TAPS_UNDO_PATH,
      access: "page",
      group: "state",
      does: "The Undo of an edit of his, by the id its answer gave: all of it, or none and the answer says why.",
      body: tapUndoAsk,
      reply: tapReply,
      joined: true,
      handle: ({ user, params, body }) => play.undoEdit(user, params.chat, body.undo),
    }),
  ] as const;
}
