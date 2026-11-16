// The routes of a chat's play panels (plan §14): the chat's state view, at its head or at one of its
// turns, in the shape today's pages take; what a turn's time brought due; a tap that manages and its
// Undo; the HUD's time controls; a panel's tap held for his next message, and a tap that plays now.
// Every route is a page's: it answers only for the user this RPE belongs to.

import { route, shape, stateView } from "../app";
import { requestShown } from "../turn/shapes";
import type { PlayService } from "./service";

export const STATE_PATH = "/api/v1/chats/:chat/state";
export const DUE_PATH = "/api/v1/chats/:chat/state/due";
export const TAPS_PATH = "/api/v1/chats/:chat/taps";
export const EDIT_UNDO_PATH = "/api/v1/chats/:chat/edits/:edit/undo";
export const TIME_PATH = "/api/v1/chats/:chat/time";
export const PANEL_REQUEST_PATH = "/api/v1/chats/:chat/requests/panel";
export const PLAYS_PATH = "/api/v1/chats/:chat/plays";

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

const values = shape.record(shape.json());
const panelTapAsk = shape.named(
  "PanelTapAsk",
  "A panel's tap for his next message: one of the world's actions (Walk here among them, or a Timelapse with its label and its \"follow my routine\" choice among its values), its values, and where it was made.",
  shape.object({ action: T, values, from: shape.oneOf("palette", "map", "panel") }),
);
const panelHeldReply = shape.named(
  "PanelHeldReply",
  "The tap held: it waits for his next message, in place of a panel's tap that waited; null where the same tap again took the one that waited back.",
  shape.object({ request: shape.nullable(requestShown) }),
);
const playAsk = shape.named(
  "PlayAsk",
  "A tap that plays now: one of the world's actions with its values, where it was made, and any words typed with it (its line in the chat; with none, what was pressed); or the id of a request that waits (Send now).",
  shape.union(
    shape.object({ action: T, values, from: shape.oneOf("palette", "map", "panel", "chip", "send-now", "command"), words: opt(T, "Words typed with it: the line put in the chat as his message.") }),
    shape.object({ request: T }),
  ),
);
const playedReply = shape.named(
  "PlayedReply",
  "The tap played: the message its line went into the chat as, the generation Lumiverse started to answer it, and the request kept with it as played now.",
  shape.object({ message: T, generation: T, request: T }),
);

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
      path: TIME_PATH,
      access: "page",
      group: "state",
      does: "One of the HUD's time controls (Pause clock, Resume clock, and the others the clock's controls carry), at its scope and with its value, recorded at once as his own edit; a refusal is answered in words with nothing changed.",
      body: shape.object({ control: T, scope: shape.field(shape.json(), "Where it holds: every scene, a kind of scene, an activity, or an interrupt."), to: shape.json() }),
      reply: tapReply,
      handle: ({ user, params, body }) => play.time(user, params.chat, body),
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
      path: EDIT_UNDO_PATH,
      access: "page",
      group: "state",
      does: "The Undo of an edit of his, by the edit's own id (the `undo` its answer gave): all of it, the world's defaults given with it included, or none and the answer says why; at once, whatever runs.",
      reply: tapReply,
      handle: ({ user, params }) => play.undoEdit(user, params.chat, params.edit),
    }),
    route({
      method: "POST",
      path: PANEL_REQUEST_PATH,
      access: "page",
      group: "state",
      does: "A panel's tap for his next message (the palette, Walk here, any tap with no words): held as a request in place of the panel's tap that waited, and the same tap again takes it back; the turn that answers his next message is told what was pressed and on what.",
      body: panelTapAsk,
      reply: panelHeldReply,
      handle: ({ user, params, body }) => play.holdTap(user, params.chat, body),
    }),
    route({
      method: "POST",
      path: PLAYS_PATH,
      access: "page",
      group: "state",
      does: "A tap that plays now (a chip, Send now, Timelapse or a tap with words): its line put in the chat as his message and a reply started, through Lumiverse's own routes as him, with nothing written into message or chat metadata; the turn that answers it is told what was pressed.",
      body: playAsk,
      reply: playedReply,
      handle: ({ user, params, body }) => play.playTap(user, params.chat, "request" in body ? { request: body.request } : { tap: { action: body.action, values: body.values, from: body.from }, words: body.words ?? "" }),
    }),
  ] as const;
}
