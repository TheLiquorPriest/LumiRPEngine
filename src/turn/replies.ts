// The line under each reply (plan §14 l.1565, PlanChatUI-3 items 1, 5, 7): for the messages a page asks (the rows Lumiverse has
// mounted), by the swipe Lumiverse shows, the turn tied to it, the world's date and time at the turn's end and where his character
// was, what each lane of the turn did (how many changes took effect, and the lines a person reads: the engine's worded as his
// character knows them, in the chat's own copy of the history lines; the story's, each beat the turn wrote), and the
// turn's marks; and, where the turn's record of the reply was not finished (its run failed, reached a limit or was stopped once the reply
// had begun to go out, plan §10.10), why, with whether Settle now settles it. A reply no turn is tied to was made without RPE (§6.3); a
// carried one names the engine that played it (§15.2). A continue's held turn joined to the turn it extended is answered in the joined
// form the store's refusal names, with the line of the turn it joined. His own messages, and ids the chat's path does not hold, are left
// out. A read only. It lives with the turn rather than in `src/play/` as PlanChatUI-3 names it: the turn's marks are the turn lane's,
// which the panels' zone may not import.

import type { ReplyError } from "rp-harness/contract";
import { type Infer, route, shape } from "../app";
import { type LinesPart, loadGuidance } from "../app/guidance";
import { playerLines } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { isRecord } from "../shared/json";
import { JoinedTurnError, ownerPlaceOf, timeOf, type UserStore } from "../store";
import { eventOf } from "../store/fold";
import { STORY_OPS } from "../story/fold";
import { withHistoryLines } from "../iface";
import type { Turns } from "./lane";
import { guidanceTexts } from "./texts";
import { NO_SESSION, PARTS, replyErrorWords } from "./turns";

const T = shape.text();

const laneShown = shape.named(
  "LaneShown",
  "What a lane of a turn did: how many of its changes took effect, and the lines a person reads of them (the engine's worded as his character knows them; the story's, each beat the turn wrote).",
  shape.object({ lane: shape.oneOf("story", "engine"), count: shape.number(), lines: shape.list(T) }),
);

const replyLine = shape.named(
  "ReplyLine",
  "The line under one reply, by the swipe shown: whether RPE played it (false: made without RPE, no turn tied to it), the old engine that played a carried one, its turn, the joined form where that turn was a continue's held turn joined to another (the line is then the joined turn's), the world's date and time at the turn's end and the place his character was in (null where the clock was never set, or no place holds him), each lane's changes, the turn's marks, and, where the turn's record of the reply was not finished (its newest run failed, reached a limit or was stopped once the reply had begun to go out), why in the reply-errors part's words and whether Settle now settles it (the turn is the newest of the chat's own on its path and no run of the chat goes on).",
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
    unfinished: shape.nullable(shape.object({ why: T, settle: shape.yesNo() })),
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
  // Each beat the turn wrote once, as its latest write words it: a beat written again (its text set twice) is one beat.
  const beats = new Map<string, string>();
  for (const c of story) if (c.op === STORY_OPS.write && isRecord(c.value) && c.value.part === "beat" && typeof c.value.item === "string" && isRecord(c.value.value) && typeof c.value.value.text === "string") beats.set(c.value.item, c.value.value.text);
  return {
    time: timeOf(view, place).time,
    place: place === null ? null : (view.nameOf(place) ?? place),
    lanes: [
      { lane: "story", count: story.length, lines: [...beats.values()] },
      { lane: "engine", count: engine.length, lines: events.length === 0 ? [] : playerLines(registry, view.world, view.state.world, view.world.pov, events, events.length) },
    ],
  };
}

/**
 * Where a turn's record of its reply was not finished: its newest run (a Settle now run's included) failed, reached a limit or was stopped
 * once its reply had begun to go out, or, a Settle now run, at all; why, in the reply-errors part's words (its `-after` lines), or the
 * error's own where the part has none. Null where the newest run is going on or ended well.
 */
function unfinishedWhy(turns: Pick<Turns, "runs">, user: string, turn: string, errors: LinesPart | undefined): string | null {
  const last = turns.runs.record(user, turn);
  if (last === null || last.status === "running" || last.status === "released" || last.status === "no-reply") return null;
  if (last.kind !== "settle" && last.released === null) return null;
  const e: ReplyError = last.error ?? { code: last.status === "limit" ? "limit" : last.status === "stopped" ? "stopped" : "failed" };
  return replyErrorWords(e, errors, true) || `${e.code}${e.detail !== undefined ? `: ${e.detail}` : ""}`;
}

/** The line under each reply of the chat that `ids` names, in the order asked; `errors` words a turn whose record was not finished. */
export function replyLines(turns: Pick<Turns, "store" | "marks" | "runs">, user: string, chat: string, ids: readonly string[], errors: LinesPart | undefined): Line[] {
  const store = turns.store.user(user);
  const row = store.chat(chat);
  if (row === null) return [];
  const steps = store.path(chat);
  const path = new Map(steps.map((entry) => [entry.message, entry]));
  // Settle now settles the newest turn of the chat's own on its path, while no run of the chat goes on.
  const settles = turns.runs.ofChat(user, chat).length > 0 ? null : (steps.findLast((e) => e.turn !== null && store.turn(e.turn)?.chat === chat)?.turn ?? null);
  const out: Line[] = [];
  for (const message of ids) {
    const entry = path.get(message);
    if (entry === undefined || entry.user) continue;
    if (entry.turn === null) {
      out.push({ message, played: false, engine: null, turn: null, joined: null, time: null, place: null, lanes: [], marks: [], unfinished: null });
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
    const why = unfinishedWhy(turns, user, turn, errors);
    out.push({
      message,
      played: true,
      engine: imported ? row.engine : null,
      turn: joined?.turn ?? turn,
      joined,
      ...lines,
      marks: turns.marks.ofTurn(user, turn).map((m) => ({ kind: m.kind })),
      unfinished: why === null ? null : { why, settle: settles === turn },
    });
  }
  return out;
}

export function replyRoutes(turns: Pick<Turns, "store" | "marks" | "runs" | "files" | "env">) {
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/replies",
      access: "page",
      group: "turns",
      does: "The line under each reply asked for, by the swipe Lumiverse shows: its turn, the world's date and time at the turn's end and his character's place, each lane's changes (a count and the lines a person reads), the turn's marks, and why the turn's record of the reply was not finished where it was not, with whether Settle now settles it; a reply made without RPE says so, a carried one names the engine that played it, and a continue's held turn joined to another is answered in the joined form with the line of the turn it joined.",
      query: { ids: shape.field(T, "The messages' ids, comma-separated: the rows the page has mounted.") },
      reply: repliesReply,
      // The engine's lines are worded in the chat's own copy of the history lines, the nearest level's; a record not finished, in its reply-errors part.
      handle: async ({ user, params, query }) => {
        const scope = { user, chat: params.chat, session: NO_SESSION };
        const part = await loadGuidance(turns.files, scope).part(PARTS.errors);
        const errors = part?.format === "lines" ? part : undefined;
        return await withHistoryLines(guidanceTexts(turns.files, scope, turns.env.log), () => ({
          replies: replyLines(turns, user, params.chat, query.ids.split(",").filter((id) => id !== ""), errors),
        }));
      },
    }),
  ] as const;
}
