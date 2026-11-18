// How the world's own quests were moved (plan §8.3: a stage's state "recorded with its reason"): each move of a track along the chat's path
// is a `stage` change in the ledger, with the reason the Author gave it, and `/state/history` reads it there. A page of the quests reads
// the same changes, through the same reader (`valueHistory`), so a stage the quest has been moved past shows how it ended and why, and a
// quest standing on an end stage shows how it ended, with no second record kept beside the ledger. What the story itself called on a stage
// (`quests.call`) stands over what a move gives it. The play view's quest log lists the same stages under each quest it holds.

import type { TrackState } from "../engine/state";
import { isRecord, type JsonObject, type JsonValue } from "../shared/json";
import type { TrackDef } from "../shared/world";
import type { UserStore } from "../store";
import type { FoldEnv } from "../store/fold";
import { valueHistory } from "../store/history";
import { isTerminal } from "../engine/tracks";
import { type QuestCallDoc, type QuestClosedDoc, type QuestView } from "./record";

/** One move of a world's quest from a stage to another, as the ledger holds it. */
export interface QuestMove {
  from: string;
  to: string;
  /** How the move went: the outcome it was given, else by the way it took (a failing edge fails the stage it leaves). */
  state: "met" | "failed";
  why: string | null;
  turn: string;
  n: number;
  by: string | null;
}

/** The moves of each world quest that has moved, oldest first. */
export type QuestTrails = Readonly<Record<string, readonly QuestMove[]>>;

/**
 * The moves of the world's quests made along the chat's path, at its head (`turn` null) or up to one of its turns. A quest still standing
 * on its start stage, entered when the story began, has made none and is not read.
 */
export function trailsOf(store: UserStore, env: Pick<FoldEnv, "registry" | "areas">, chat: string, turn: string | null, tracks: Readonly<Record<string, TrackDef>>, now: Readonly<Record<string, TrackState>>): QuestTrails {
  const out: Record<string, QuestMove[]> = {};
  for (const [id, def] of Object.entries(tracks)) {
    const at = Object.hasOwn(now, id) ? now[id] : undefined;
    if (at === undefined || (at.stage === def.start && at.since === 0)) continue;
    const moves: QuestMove[] = [];
    let standing = def.start;
    for (const w of valueHistory(store, env, chat, `track:${id}`, "stage", turn ?? undefined)) {
      const v = w.change.value;
      if (!w.applied || !isRecord(v) || typeof v.to !== "string") continue;
      const from = typeof v.from === "string" ? v.from : standing;
      standing = v.to;
      if (from === v.to) continue;
      const left = Object.hasOwn(def.stages, from) ? def.stages[from] : undefined;
      const state = v.outcome === "failed" || (v.outcome !== "met" && left?.fail?.to === v.to) ? "failed" : "met";
      moves.push({ from, to: v.to, state, why: typeof v.why === "string" && v.why.trim() !== "" ? v.why.trim() : null, turn: w.turn ?? "", n: w.n, by: w.change.by });
    }
    if (moves.length > 0) out[id] = moves;
  }
  return out;
}

const callOf = (move: QuestMove): QuestCallDoc => ({ state: move.state, why: move.why, turn: move.turn, n: move.n, by: move.by });

/**
 * The quests as the page reads them with their moves in: each stage a world's quest was moved past carries, as its call, how it ended
 * and why (the story's own call on it standing over that); a quest standing on an end stage the story never closed is closed as that
 * stage ended it. A quest opened in play has its calls from the story alone and is left as it is.
 */
export function withTrails(views: readonly QuestView[], tracks: Readonly<Record<string, TrackDef>>, trails: QuestTrails): QuestView[] {
  return views.map((view) => {
    const moves = view.world && Object.hasOwn(trails, view.id) ? trails[view.id] : undefined;
    const def = view.world && Object.hasOwn(tracks, view.id) ? tracks[view.id] : undefined;
    if (moves === undefined || moves.length === 0 || def === undefined) return view;
    const ended = new Map<string, QuestCallDoc>();
    for (const move of moves) ended.set(move.from, callOf(move));
    const last = moves[moves.length - 1] as QuestMove;
    const closed: QuestClosedDoc | null = view.closed ?? (isTerminal(def, last.to) ? { outcome: Object.values(def.stages).some((s) => s.fail?.to === last.to) ? "failed" : "met", why: last.why, turn: last.turn, n: last.n, by: last.by } : null);
    return { ...view, closed, stages: view.stages.map((s) => (s.call !== null || !ended.has(s.id) ? s : { ...s, call: ended.get(s.id) as QuestCallDoc })) };
  });
}

/**
 * The quest log of the play view (`story.quests`: its active, done and failed tracks) with, under each track a world's quest stands behind,
 * the stages it was moved past or the story called on, as `withTrails` gives them to the pages. A track the log lists under a stand-in id
 * (a secret one) is no quest's here and lists none.
 */
export function withPast(log: JsonValue, views: readonly QuestView[]): JsonValue {
  if (!isRecord(log)) return log;
  const past = new Map<string, JsonObject[]>();
  for (const view of views) {
    if (!view.world) continue;
    const stages: JsonObject[] = [];
    for (const s of view.stages) if (s.call !== null && s.call.state !== "open") stages.push({ label: s.label, state: s.call.state, why: s.call.why });
    if (stages.length > 0) past.set(view.id, stages);
  }
  const out: JsonObject = { ...log };
  for (const status of ["active", "done", "failed"]) {
    const tracks = log[status];
    if (!Array.isArray(tracks)) continue;
    out[status] = tracks.map((t) => (isRecord(t) && typeof t.id === "string" && past.has(t.id) ? { ...t, past: past.get(t.id) ?? [] } : t));
  }
  return out;
}

/** The moves of a world's quest as its history lists them, each with its number on the path: the reason and outcome it came with, in the order made. */
export function movesAsHistory(moves: readonly QuestMove[]): { n: number; turn: string | null; by: string | null; op: string; value: Record<string, string> }[] {
  return moves.map((m) => ({ n: m.n, turn: m.turn === "" ? null : m.turn, by: m.by, op: "stage", value: { from: m.from, to: m.to, state: m.state, ...(m.why === null ? {} : { why: m.why }) } }));
}
