// The turn tree's paths (plan §6.3), without the database: a path node's key, which turn a shown
// swipe is, and what changed between the path last compared and the one the chat shows now. The
// comparison is of ids and hashes only.
//
// A path node is one turn as it stands after the turns before it on one path. The same turn stands
// on as many nodes as the paths it has been folded on: its own (the path it was made on), and any
// other after an earlier reply's swipe was flipped. A node's key chains the key before it with the
// turn's id, so equal keys are equal paths, and a turn is on its own path exactly where the key is
// the one it was made on.

import { hashParts } from "../shared/hash";
import type { PathEntry, PathReport, ShownMessage, TurnRow } from "./types";

/** The key of `turn` standing after the path node `prev` (null: at the chat's start). */
export function nodeKey(prev: string | null, turn: string): string {
  return hashParts("rpe.path", prev ?? "", turn);
}

/** What a shown reply is in the tree: the turn tied to it, and whether its text was edited since. */
export interface Match {
  turn: TurnRow | null;
  edited: boolean;
}

/**
 * The turn a shown reply is, among the turns tied to its message: the one whose swipe date and
 * saved hash both match; else the newest whose hash matches; else the only one whose date matches,
 * which was edited since it was saved; else none (a reply no turn is tied to). Swipe positions are
 * never read: deleting a swipe shifts the later ones and changes nothing here.
 */
export function matchTurn(candidates: readonly TurnRow[], shown: Pick<ShownMessage, "hash" | "date">): Match {
  const date = shown.date ?? null;
  const tied = candidates.filter((t) => t.status === "done" || t.status === "cut");
  const both = tied.find((t) => date !== null && t.date === date && t.hash === shown.hash);
  if (both) return { turn: both, edited: false };
  const byHash = tied.filter((t) => t.hash === shown.hash).sort((a, b) => b.created - a.created)[0];
  if (byHash) return { turn: byHash, edited: false };
  const byDate = date === null ? [] : tied.filter((t) => t.date === date);
  if (byDate.length === 1 && byDate[0]) return { turn: byDate[0], edited: true };
  return { turn: null, edited: false };
}

/** Where a turn's swipe stands among a message's swipes now, looked up when needed: by date and hash, else by hash; null when none is it. */
export function swipeIndex(turn: Pick<TurnRow, "hash" | "date">, swipes: readonly { hash: string; date?: number | null }[]): number | null {
  const both = swipes.findIndex((s) => turn.date !== null && (s.date ?? null) === turn.date && s.hash === turn.hash);
  if (both >= 0) return both;
  const byHash = swipes.findIndex((s) => s.hash === turn.hash);
  return byHash >= 0 ? byHash : null;
}

/** What comparing the path last compared (`before`) with the one shown now (`after`) finds, besides edits, a branch and what no longer applies. */
export function comparePaths(before: readonly PathEntry[], after: readonly PathEntry[]): Pick<PathReport, "gone" | "swiped" | "flipped" | "rebased" | "unplayed"> {
  const now = new Map(after.map((e) => [e.message, e]));
  const gone = before.filter((e) => !now.has(e.message)).map((e) => ({ message: e.message, turn: e.turn }));
  const replies = after.filter((e) => !e.user);
  const newest = replies.at(-1)?.message ?? null;
  const was = new Map(before.map((e) => [e.message, e]));
  let swiped: PathReport["swiped"] = null;
  const flipped: PathReport["flipped"] = [];
  for (const e of replies) {
    const old = was.get(e.message);
    if (!old || old.turn === e.turn) continue;
    const change = { message: e.message, from: old.turn, to: e.turn };
    if (e.message === newest) swiped = change;
    else flipped.push(change);
  }
  // A turn stands rebased where the path before it is not the one it was made on.
  const rebasedOnes = after.filter((e) => e.turn !== null && e.own === false);
  const rebased = rebasedOnes.length === 0 ? null : { from: rebasedOnes[0]?.message ?? "", to: rebasedOnes.at(-1)?.message ?? "", turns: rebasedOnes.map((e) => e.turn as string) };
  // Replies after the first turn that no turn is tied to, in runs broken only by a played reply.
  const unplayed: PathReport["unplayed"] = [];
  const first = replies.findIndex((e) => e.turn !== null);
  let run: { from: string; to: string; count: number } | null = null;
  for (const e of first < 0 ? [] : replies.slice(first)) {
    if (e.turn !== null) {
      if (run) unplayed.push(run);
      run = null;
    } else if (run) {
      run.to = e.message;
      run.count++;
    } else run = { from: e.message, to: e.message, count: 1 };
  }
  if (run) unplayed.push(run);
  return { gone, swiped, flipped, rebased, unplayed };
}
