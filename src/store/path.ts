// The turn tree's paths (plan §6.3), without the database: a path node's key, which turn a shown
// swipe is, the chain of path nodes a path's turns stand at, and what changed between the path last
// compared and the one the chat shows now. The comparison is of ids and hashes only.
//
// A path node is one turn as it stands after the turns before it on one path. The same turn stands
// on as many nodes as the paths it has been folded on: its own (the path it was made on), and any
// other after an earlier reply's swipe was flipped. A node's key chains the key before it with the
// turn's id, so equal keys are equal paths, and a turn is on its own path exactly where the key is
// the one it was made on.

import { hashParts } from "../shared/hash";
import { StoreInputError, type PathEntry, type PathReport, type SeenMessage, type ShownMessage, type TurnPoint, type TurnRow } from "./types";

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
 * which was edited since it was saved; else `last`, the turn the path showed there last time, when
 * its date matches (swipes can share a date: Lumiverse's own migration gave every swipe of an older
 * message the message's date), edited too; else none (a reply no turn is tied to). Swipe positions
 * are never read: deleting a swipe shifts the later ones and changes nothing here. With `swipes`
 * (the message's swipes, looked up only when a date ties), a turn whose saved text is still among
 * them was not edited: the reply is another swipe made in the same second, and no turn's.
 */
export function matchTurn(candidates: readonly TurnRow[], shown: Pick<ShownMessage, "hash" | "date">, last: string | null = null, swipes?: () => readonly { hash: string }[] | null): Match {
  const date = shown.date ?? null;
  const tied = candidates.filter((t) => t.status === "done" || t.status === "cut");
  const both = tied.find((t) => date !== null && t.date === date && t.hash === shown.hash);
  if (both) return { turn: both, edited: false };
  const byHash = tied.filter((t) => t.hash === shown.hash).sort((a, b) => b.created - a.created)[0];
  if (byHash) return { turn: byHash, edited: false };
  const byDate = date === null ? [] : tied.filter((t) => t.date === date);
  const onlyDate = byDate.length === 1 ? byDate[0] : undefined;
  const edited = onlyDate ?? (last === null ? undefined : tied.find((t) => t.id === last && t.date === date));
  if (!edited) return { turn: null, edited: false };
  const kept = edited.hash !== null && (swipes?.() ?? []).some((s) => s.hash === edited.hash);
  return kept ? { turn: null, edited: false } : { turn: edited, edited: true };
}

/** Where a turn's swipe stands among a message's swipes now, looked up when needed: by date and hash, else by hash; null when none is it. */
export function swipeIndex(turn: Pick<TurnRow, "hash" | "date">, swipes: readonly { hash: string; date?: number | null }[]): number | null {
  const both = swipes.findIndex((s) => turn.date !== null && (s.date ?? null) === turn.date && s.hash === turn.hash);
  if (both >= 0) return both;
  const byHash = swipes.findIndex((s) => s.hash === turn.hash);
  return byHash >= 0 ? byHash : null;
}

/**
 * The turn a reply's showing text is, among the turns tied to its message, by that text's hash alone (plan §9.6 l.1121, §6.3 l.617):
 * the newest whose saved text has it, else the newest the chat was last compared showing edited to it. None for a text no turn is
 * known by: a reply edited since the last comparison, or a swipe RPE did not play. With no swipe's date to go by, a reply whose text
 * changed cannot be told from another swipe, and its position is never read.
 */
export function turnByHash(candidates: readonly TurnRow[], hash: string): TurnRow | null {
  const tied = candidates.filter((t) => t.status === "done" || t.status === "cut").sort((a, b) => b.created - a.created);
  return tied.find((t) => t.hash === hash) ?? tied.find((t) => t.edited === hash) ?? null;
}

/**
 * A path as it was seen when it was asked where a coming turn starts (plan §9.6 l.1121-1122), up to the point, which is where it
 * ends: each message with the turn its showing text is (`turnOf`, asked of the replies only; the player's own lines have none, as in
 * a comparison). A path that holds a message twice cannot be read, and is refused (plan §6.1), as a point that does not agree with
 * where the path ends is.
 */
export function turnsShown(path: readonly SeenMessage[], point: TurnPoint, turnOf: (reply: SeenMessage) => string | null): { message: SeenMessage; turn: string | null }[] {
  const ids = new Set<string>();
  for (const m of path) {
    if (ids.has(m.id)) throw new StoreInputError(`the message ${m.id} is on the path twice`);
    ids.add(m.id);
  }
  const newest = path.at(-1)?.id ?? null;
  let upTo = path.length;
  if (point.replaces !== undefined) {
    if (newest === point.replaces) upTo--;
    else if (path.some((m) => m.id === point.replaces)) throw new StoreInputError(`the reply ${point.replaces} a turn replaces is on its path but not where the path ends`);
  } else if (newest !== point.follows) {
    throw new StoreInputError(`a turn that follows ${point.follows ?? "no message"} does not start where its path ends (${newest ?? "no message"})`);
  }
  return path.slice(0, upTo).map((message) => ({ message, turn: message.user ? null : turnOf(message) }));
}

/** A turn showing on a path, and the message it shows at. */
export interface ShowingTurn {
  turn: string;
  message: string;
}

/**
 * The path nodes a run of turns showing along a path stand at, chained after the node `prev` (null: the chat's start), the first at
 * `depth` (plan §6.3): each turn after the one before it, so a turn made after another stands rebased there, and a turn begun after
 * the turn its own message holds (a branch's continue of a reply it shares; `goesOn` names that turn) after a node for that turn
 * first, which stays on the line. A key names the whole path to its node, so a path seen before has the keys it had. Gives each
 * turn's key, and every node as a row: its key, the node before it, its turn and its depth.
 */
export function chainOf(run: readonly ShowingTurn[], prev: string | null, depth: number, goesOn: ReadonlyMap<string, string>): { keys: string[]; nodes: [string, string | null, string, number][] } {
  const keys: string[] = [];
  const nodes: [string, string | null, string, number][] = [];
  for (const { turn } of run) {
    const first = goesOn.get(turn);
    if (first !== undefined) {
      const key = nodeKey(prev, first);
      nodes.push([key, prev, first, depth++]);
      prev = key;
    }
    const key = nodeKey(prev, turn);
    nodes.push([key, prev, turn, depth++]);
    keys.push(key);
    prev = key;
  }
  return { keys, nodes };
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
