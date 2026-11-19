// The line under each reply (plan §14 l.1565, PlanChatUI-3 items 1, 5, 7): for the messages a page asks (the rows Lumiverse has
// mounted), by the swipe Lumiverse shows, the turn tied to it, the world's date and time at the turn's end and where his character
// was, what each lane of the turn did (how many changes took effect, and the lines a person reads: the engine's worded as his
// character knows them, in the chat's own copy of the history lines; the story's, each beat the turn wrote), and the
// turn's marks; and, where the turn's record of the reply was not finished (its run failed, reached a limit or was stopped once the reply
// had begun to go out, plan §10.10), why, with whether Settle now settles it. A reply no turn is tied to was made without RPE (§6.3); a
// carried one names the engine that played it (§15.2). A continue's held turn joined to the turn it extended is answered in the joined
// form the store's refusal names, with the line of the turn it joined. His own messages, and ids the chat's path does not hold, are left
// out. A read, which stores each line it works out with its turn (`store/turn-reads.ts`), so a restart reads it and folds nothing for
// it. It lives with the turn rather than in `src/play/` as PlanChatUI-3 names it: the turn's marks are the turn lane's, which the
// panels' zone may not import.

import type { ReplyError } from "rp-harness/contract";
import { textHash } from "../adapter/lumiverse/wire";
import { type Infer, route, shape, WritesClosed } from "../app";
import { type LinesPart, loadGuidance } from "../app/guidance";
import { playerLines } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { historyTexts, linesOf as wordsOf, type HistoryTexts } from "../iface";
import { hashParts } from "../shared/hash";
import { isRecord } from "../shared/json";
import { withLines } from "../shared/lines";
import { inStretches, JoinedTurnError, ownerPlaceOf, type Store, timeOf, type UserStore } from "../store";
import { eventOf } from "../store/fold";
import { type KeepTurnReads, storedTurnReads, type TurnReadMade, turnMark, turnReadKeeper } from "../store/turn-reads";
import { STORY_OPS } from "../story/fold";
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
  "The line under one reply, by the swipe shown: whether RPE played it (false: made without RPE, no turn tied to it), whether it is an empty reply (nothing written in it, as Lumiverse keeps one when a generation fails or is stopped before its first word with thinking already shown; never played), the old engine that played a carried one, its turn, the joined form where that turn was a continue's held turn joined to another (the line is then the joined turn's), the world's date and time at the turn's end and the place his character was in (null where the clock was never set, or no place holds him), each lane's changes, the turn's marks, and, where the turn's record of the reply was not finished (its newest run failed, reached a limit or was stopped once the reply had begun to go out), why in the reply-errors part's words and whether Settle now settles it (the turn is the newest of the chat's own on its path and no run of the chat goes on).",
  shape.object({
    message: T,
    played: shape.yesNo(),
    empty: shape.yesNo(),
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

/**
 * The version of the code that words a turn's line (`lanesAt`, and the engine's player lines, `playerLines`): bumped by whoever changes
 * how a line is worded, so lines stored under an earlier wording are worked out again.
 */
export const LINE_WORDING = 1;

/**
 * Each store's lines as last worked out from the state at the turn's end, or read from the rows they are stored in with their turns
 * (`store/turn-reads.ts`), by their key (`lineKey`): worked out once for as long as that state and the words stand, and no state is held
 * for them. The least recently read go first past `KEPT`.
 */
const keptBy = new WeakMap<Store, Map<string, Lanes>>();
const KEPT = 4096;

function keptOf(store: Store): Map<string, Lanes> {
  let kept = keptBy.get(store);
  if (kept === undefined) {
    kept = new Map();
    keptBy.set(store, kept);
  }
  return kept;
}

/** Holds a turn's line in memory as the most recently read. */
function hold(kept: Map<string, Lanes>, key: string, lanes: Lanes): void {
  kept.delete(key);
  kept.set(key, lanes);
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT) break;
    kept.delete(oldest);
  }
}

/** The wording the lines' keys name beside the words: this code's (`LINE_WORDING`) and each pack's version. */
function wordingOf(store: Store): string {
  return hashParts("reply-line", String(LINE_WORDING), ...store.env.registry.packs.map((p) => `${p.id}@${p.version}`));
}

/**
 * Where a turn's line is kept: in memory under the turn's mark and what words it (`held`), in its node's row under what words it
 * (`worded`: the wording and the words). Throws the store's `JoinedTurnError` for a joined turn.
 */
function lineKey(s: UserStore, turn: string, words: string, wording: string): { mark: string; held: string; worded: string } {
  const worded = `${wording}\u0000${words}`;
  const mark = turnMark(s, turn);
  return { mark, held: `${mark}\u0000${worded}`, worded };
}

/** The turn whose state a line is worked out from (its own, or, for one joined, the turn it joined), with where the line is kept. */
function lineAt(s: UserStore, turn: string, words: string, wording: string): { turn: string; mark: string; held: string; worded: string } {
  try {
    return { turn, ...lineKey(s, turn, words, wording) };
  } catch (error) {
    if (!(error instanceof JoinedTurnError)) throw error;
    return lineAt(s, error.joined, words, wording);
  }
}

/**
 * A turn's line: the one held in memory, else worked out from the state at its end, held, and put in `made` to be stored with its node.
 * Throws the store's `JoinedTurnError` for a joined turn.
 */
function keptLanes(store: Store, s: UserStore, turn: string, words: string, wording: string, made: Map<string, TurnReadMade>): Lanes {
  const at = lineKey(s, turn, words, wording);
  const kept = keptOf(store);
  const hit = kept.get(at.held);
  if (hit !== undefined) {
    hold(kept, at.held, hit);
    return hit;
  }
  const lanes = lanesAt(s, store.env.registry, turn);
  hold(kept, at.held, lanes);
  const node = s.turn(turn)?.node;
  if (node !== undefined) made.set(turn, { node, mark: at.mark, key: at.worded, value: JSON.stringify(lanes) });
  return lanes;
}

/** A turn's line: the time and place at its end, and what each lane did. Throws the store's `JoinedTurnError` for a joined turn. */
function lanesAt(store: UserStore, registry: Registry, turn: string): Lanes {
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
  // A record kept before its end named the limit as its error has it only where the limit stopped it.
  const limit = last.stoppedBy !== null && "limit" in last.stoppedBy ? last.stoppedBy.limit : undefined;
  const e: ReplyError = last.error ?? (limit !== undefined ? { code: "limit", limit } : { code: last.status === "limit" ? "limit" : last.status === "stopped" ? "stopped" : "failed" });
  return replyErrorWords(e, errors, true) || `${e.code}${e.detail !== undefined ? `: ${e.detail}` : ""}`;
}

/** The words a line is worded in: the chat's history lines (the engine's lines), and what names them. */
export interface ReplyWords {
  texts: HistoryTexts;
  /** Names these words: lines kept under other words are worked out again. */
  key: string;
}

/**
 * The line under each reply of the chat that `ids` names, in the order asked; `errors` words a turn whose record was not finished. A
 * line is taken from memory, else from the row it is stored in with its turn, before anything is folded; the rest are worked out in the
 * order of the chat's path, whatever the order asked, so each turn's state folds on from the one before it, and in stretches that let
 * RPE's thread go (`inStretches`), and given to `keep` to be stored (none stored without it). The first state a line neither held nor
 * stored reads is folded where a long fold runs on a worker thread (`Store.afar`): after a restart no state is held, and its fold reads a
 * snapshot whole.
 */
export async function replyLines(turns: Pick<Turns, "store" | "marks" | "runs">, user: string, chat: string, ids: readonly string[], errors: LinesPart | undefined, words: ReplyWords, keep?: KeepTurnReads): Promise<Line[]> {
  const store = turns.store.user(user);
  const row = store.chat(chat);
  if (row === null) return [];
  const steps = store.path(chat);
  const path = new Map(steps.map((entry, at) => [entry.message, { entry, at }]));
  // Settle now settles the newest turn of the chat's own on its path, while no run of the chat goes on.
  const settles = turns.runs.ofChat(user, chat).length > 0 ? null : (steps.findLast((e) => e.turn !== null && store.turn(e.turn)?.chat === chat)?.turn ?? null);
  const wording = wordingOf(turns.store);
  const made = new Map<string, TurnReadMade>();
  const lineOf = (message: string): Line => {
    const entry = path.get(message)?.entry;
    if (entry === undefined || entry.turn === null) {
      return { message, played: false, empty: entry?.hash === textHash(""), engine: null, turn: null, joined: null, time: null, place: null, lanes: [], marks: [], unfinished: null };
    }
    let turn = entry.turn;
    let joined: Line["joined"] = null;
    let lines: Lanes;
    try {
      lines = keptLanes(turns.store, store, turn, words.key, wording, made);
    } catch (error) {
      if (!(error instanceof JoinedTurnError)) throw error;
      joined = { turn: error.turn, joined: error.joined };
      turn = error.joined;
      lines = keptLanes(turns.store, store, turn, words.key, wording, made);
    }
    const imported = store.turn(turn)?.imported === true;
    const why = unfinishedWhy(turns, user, turn, errors);
    return {
      message,
      played: true,
      empty: false,
      engine: imported ? row.engine : null,
      turn: joined?.turn ?? turn,
      joined,
      ...lines,
      marks: turns.marks.ofTurn(user, turn).map((m) => ({ kind: m.kind })),
      unfinished: why === null ? null : { why, settle: settles === turn },
    };
  };
  // His own messages, and ids the chat's path does not hold, are left out; each reply once, in the path's order.
  const replies = [...new Set(ids)].filter((id) => path.get(id)?.entry.user === false).sort((a, b) => (path.get(a)?.at ?? 0) - (path.get(b)?.at ?? 0));
  // The turns whose lines memory does not hold are read from their nodes' rows, before anything is folded: after a restart, every turn's
  // line stored in these words. What is left is in the path's order.
  const kept = keptOf(turns.store);
  const missing = new Map<string, { node: string; held: string; worded: string }>();
  for (const id of replies) {
    const turn = path.get(id)?.entry.turn;
    if (turn == null) continue;
    const at = lineAt(store, turn, words.key, wording);
    const node = store.turn(at.turn)?.node;
    if (node !== undefined && !kept.has(at.held)) missing.set(at.turn, { node, held: at.held, worded: at.worded });
  }
  if (missing.size > 0) {
    const stored = storedTurnReads(turns.store, user, "line", [...missing.values()].map((m) => m.node));
    for (const [turn, m] of missing) {
      const read = stored.get(m.node);
      if (read?.key !== m.worded) continue;
      hold(kept, m.held, JSON.parse(read.value) as Lanes);
      missing.delete(turn);
    }
  }
  const cold = missing.keys().next().value ?? null;
  if (cold !== null) await turns.store.afar(() => store.stateAt(cold));
  const lines = wordsOf(words.texts);
  const shown = new Map(await inStretches(replies, (message) => [message, lineOf(message)] as const, (stretch) => withLines(lines, stretch)));
  keep?.(turns.store, user, "line", made);
  return ids.flatMap((id) => shown.get(id) ?? []);
}

export function replyRoutes(turns: Pick<Turns, "store" | "marks" | "runs" | "files" | "env" | "writes">) {
  // The lines a read works out are stored with their turns, so a restart reads them.
  const keep = turnReadKeeper(turns.writes, (error) => {
    if (!(error instanceof WritesClosed)) turns.env.log.warn("The lines under replies a read worked out could not be stored; the next read after a restart works them out again.", { error: error instanceof Error ? error.message : String(error) });
  });
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
        const texts = await historyTexts(guidanceTexts(turns.files, scope, turns.env.log));
        return { replies: await replyLines(turns, user, params.chat, query.ids.split(",").filter((id) => id !== ""), errors, { texts, key: hashParts("reply-words", JSON.stringify(texts)) }, keep) };
      },
    }),
  ] as const;
}
