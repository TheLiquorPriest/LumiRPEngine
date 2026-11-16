// The line under each reply (plan §14 l.1565, PlanChatUI-3 items 1, 5, 7): for the messages a page asks (the rows Lumiverse has
// mounted), by the swipe Lumiverse shows, the turn tied to it, the world's date and time at the turn's end and where his character
// was, what each lane of the turn did (how many changes took effect, and the lines a person reads: the engine's worded as his
// character knows them, the story's each beat the turn wrote), and the turn's marks. A reply no turn is tied to was made without RPE
// (§6.3); a carried one names the engine that played it (§15.2). A continue's held turn joined to the turn it extended is answered in
// the joined form the store's refusal names, with the line of the turn it joined. His own messages, and ids the chat's path does not
// hold, are left out. A read only. It lives with the turn rather than in `src/play/` as PlanChatUI-3 names it: the turn's marks are
// the turn lane's, which the panels' zone may not import.

import { type Infer, route, shape } from "../app";
import { playerLines } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { isRecord } from "../shared/json";
import { JoinedTurnError, ownerPlaceOf, timeOf, type UserStore } from "../store";
import { eventOf } from "../store/fold";
import { STORY_OPS } from "../story/fold";
import type { Turns } from "./lane";

const T = shape.text();

const laneShown = shape.named(
  "LaneShown",
  "What a lane of a turn did: how many of its changes took effect, and the lines a person reads of them (the engine's worded as his character knows them; the story's, each beat the turn wrote).",
  shape.object({ lane: shape.oneOf("story", "engine"), count: shape.number(), lines: shape.list(T) }),
);

const replyLine = shape.named(
  "ReplyLine",
  "The line under one reply, by the swipe shown: whether RPE played it (false: made without RPE, no turn tied to it), the old engine that played a carried one, its turn, the joined form where that turn was a continue's held turn joined to another (the line is then the joined turn's), the world's date and time at the turn's end and the place his character was in (null where the clock was never set, or no place holds him), each lane's changes, and the turn's marks.",
  shape.object({
    message: T,
    played: shape.yesNo(),
    engine: shape.nullable(T),
    turn: shape.nullable(T),
    joined: shape.nullable(shape.object({ turn: T, joined: T })),
    time: shape.nullable(T),
    place: shape.nullable(T),
    lanes: shape.list(laneShown),
    marks: shape.list(shape.object({ kind: T })),
  }),
);

const repliesReply = shape.named("RepliesReply", "The line under each reply asked for that the chat's path holds; his own messages are left out.", shape.object({ replies: shape.list(replyLine) }));

type Line = Infer<typeof replyLine>;
type Lanes = Pick<Line, "time" | "place" | "lanes">;

/** A turn's line: the time and place at its end, and what each lane did. Throws the store's `JoinedTurnError` for a joined turn. */
function linesOf(store: UserStore, registry: Registry, turn: string): Lanes {
  const view = store.viewAt(turn);
  const place = ownerPlaceOf(view);
  const changes = store.changes(turn).filter((c) => c.applied);
  const engine = changes.filter((c) => c.lane === "engine");
  const story = changes.filter((c) => c.lane === "story");
  const events = engine.flatMap((c) => eventOf(c.op, c.value) ?? []);
  const beats = story.flatMap((c) => (c.op === STORY_OPS.write && isRecord(c.value) && c.value.part === "beat" && isRecord(c.value.value) && typeof c.value.value.text === "string" ? [c.value.value.text] : []));
  return {
    time: timeOf(view, place).time,
    place: place === null ? null : (view.nameOf(place) ?? place),
    lanes: [
      { lane: "story", count: story.length, lines: beats },
      { lane: "engine", count: engine.length, lines: events.length === 0 ? [] : playerLines(registry, view.world, view.state.world, view.world.pov, events, events.length) },
    ],
  };
}

/** The line under each reply of the chat that `ids` names, in the order asked. */
export function replyLines(turns: Pick<Turns, "store" | "marks">, user: string, chat: string, ids: readonly string[]): Line[] {
  const store = turns.store.user(user);
  const row = store.chat(chat);
  if (row === null) return [];
  const path = new Map(store.path(chat).map((entry) => [entry.message, entry]));
  const out: Line[] = [];
  for (const message of ids) {
    const entry = path.get(message);
    if (entry === undefined || entry.user) continue;
    if (entry.turn === null) {
      out.push({ message, played: false, engine: null, turn: null, joined: null, time: null, place: null, lanes: [], marks: [] });
      continue;
    }
    let turn = entry.turn;
    let joined: Line["joined"] = null;
    let lines: Lanes;
    try {
      lines = linesOf(store, turns.store.env.registry, turn);
    } catch (error) {
      if (!(error instanceof JoinedTurnError)) throw error;
      joined = { turn: error.turn, joined: error.joined };
      turn = error.joined;
      lines = linesOf(store, turns.store.env.registry, turn);
    }
    const imported = store.turn(turn)?.imported === true;
    out.push({ message, played: true, engine: imported ? row.engine : null, turn: joined?.turn ?? turn, joined, ...lines, marks: turns.marks.ofTurn(user, turn).map((m) => ({ kind: m.kind })) });
  }
  return out;
}

export function replyRoutes(turns: Pick<Turns, "store" | "marks">) {
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/replies",
      access: "page",
      group: "turns",
      does: "The line under each reply asked for, by the swipe Lumiverse shows: its turn, the world's date and time at the turn's end and his character's place, each lane's changes (a count and the lines a person reads) and the turn's marks; a reply made without RPE says so, a carried one names the engine that played it, and a continue's held turn joined to another is answered in the joined form with the line of the turn it joined.",
      query: { ids: shape.field(T, "The messages' ids, comma-separated: the rows the page has mounted.") },
      reply: repliesReply,
      handle: ({ user, params, query }) => ({ replies: replyLines(turns, user, params.chat, query.ids.split(",").filter((id) => id !== "")) }),
    }),
  ] as const;
}
