// Where each swipe of a chat was played (STANDALONE-PLAN §15.3 item 7: "each swipe is folded along
// its own recorded path"). A record keeps the path its turn was planned at: a hash chained over
// every message before it, the swipe each earlier reply showed then, and what of their records was
// live. Today's data holds no list of those swipes, so the chain is found again by hashing: from the
// chat as it stands, and from each earlier record's own path, every swipe of each reply is tried,
// and a path is kept when it is the chat's own, a path a later record was planned at, or the end of
// a record folded on its own path (which a later turn may have been played on, as a rebased view).
//
// Today's build never folds a record on a path it cannot hash again either: once an earlier message
// was edited or deleted, its records fold as rebased views wherever they show. Such a swipe, and one
// with no turn of its own (no record, a bare one, or one discarded), is folded where it shows now:
// on the chat as it stands, with that swipe showing.

import type { ChainMessage } from "../engine/ledger/chain";
import { activeText, computePaths, contentId, isTombstoned, nextPath, stepPath, turnPath } from "../engine/ledger/path";
import type { PathHash, Rec, Tombstone } from "../shared/ledger";

/** The swipe an earlier reply showed on a chain, and the picks before it. */
export interface Pick {
  /** The reply's index in the chain. */
  at: number;
  swipe: number;
  prev: Pick | null;
}

/**
 * Where one swipe is folded: the swipes the replies before it show (`picks`), and why there. `own`:
 * its own recorded path. `shown`: where it shows now, because it has no turn path of its own
 * (`lost` false) or because its own path can't be hashed again from today's data (`lost` true).
 * `head`: a reply's showing swipe placed on the chat as it stands by choice (`placements`' option).
 */
export interface Placement {
  at: number;
  swipe: number;
  picks: Pick | null;
  how: "own" | "shown" | "head";
  lost: boolean;
}

/** A swipe's record that folds as a turn: not discarded, and not a bare record (which has no turn path). */
function liveRecord(m: ChainMessage, swipe: number, tombstones: readonly Tombstone[]): Rec | null {
  const rec = m.ledger?.swipes[String(swipe)];
  if (!rec || isTombstoned(tombstones, m.id, rec)) return null;
  return turnPath(rec) === null ? null : rec;
}

/** The picks as a list, by reply index. */
export function picksOf(picks: Pick | null): Map<number, number> {
  const out = new Map<number, number>();
  for (let p = picks; p !== null; p = p.prev) out.set(p.at, p.swipe);
  return out;
}

/** The chain a placement is folded on: the chat's messages up to its reply, each earlier reply showing its pick, the reply its swipe. */
export function chainOf(chain: readonly ChainMessage[], placement: Pick | Placement): ChainMessage[] {
  const picks = picksOf("how" in placement ? placement.picks : placement.prev);
  const out: ChainMessage[] = [];
  for (let i = 0; i < placement.at; i++) {
    const m = chain[i] as ChainMessage;
    const pick = picks.get(i);
    out.push(m.isUser || pick === undefined || pick === m.swipeId ? m : { ...m, swipeId: pick });
  }
  const m = chain[placement.at] as ChainMessage;
  out.push(placement.swipe === m.swipeId ? m : { ...m, swipeId: placement.swipe });
  return out;
}

/**
 * Every swipe of every reply in `chain` (the chat as it stands, the journal's records over the
 * messages'), with where it is folded. With `headShown`, the swipe each reply shows now is placed on
 * the chat as it stands, whatever its own path: the chat's head then stands on the turns' own paths.
 */
export function placements(chain: readonly ChainMessage[], tombstones: readonly Tombstone[], options: { headShown?: boolean } = {}): Placement[] {
  const replies = chain.flatMap((m, i) => (m.isUser ? [] : [i]));
  const current = computePaths(chain, tombstones);
  // The picks of the chat as it stands, before each reply.
  const shownBefore = new Map<number, Pick | null>();
  let shown: Pick | null = null;
  for (const r of replies) {
    shownBefore.set(r, shown);
    shown = { at: r, swipe: (chain[r] as ChainMessage).swipeId, prev: shown };
  }
  const out: Placement[] = [];
  const first = replies[0];
  if (first === undefined) return out;
  // The paths known before a reply, each with the picks that make it.
  let known = new Map<PathHash, Pick | null>([[current[first]?.parentPath ?? "", shownBefore.get(first) ?? null]]);
  for (const [q, r] of replies.entries()) {
    const m = chain[r] as ChainMessage;
    const asShown = shownBefore.get(r) ?? null;
    for (let swipe = 0; swipe < m.swipes.length; swipe++) {
      const rec = liveRecord(m, swipe, tombstones);
      if (options.headShown && swipe === m.swipeId) out.push({ at: r, swipe, picks: asShown, how: "head", lost: false });
      else if (rec !== null && known.has(rec.path)) out.push({ at: r, swipe, picks: known.get(rec.path) ?? null, how: "own", lost: false });
      else out.push({ at: r, swipe, picks: asShown, how: "shown", lost: rec !== null });
    }
    const next = replies[q + 1];
    if (next === undefined) break;
    const nextMessage = chain[next] as ChainMessage;
    const planned = new Set<PathHash>();
    for (let swipe = 0; swipe < nextMessage.swipes.length; swipe++) {
      const rec = liveRecord(nextMessage, swipe, tombstones);
      if (rec !== null) planned.add(rec.path);
    }
    const ahead = new Map<PathHash, Pick | null>([[current[next]?.parentPath ?? "", shownBefore.get(next) ?? null]]);
    for (const [path, picks] of known) {
      for (let swipe = 0; swipe < m.swipes.length; swipe++) {
        let after = nextPath(swipe === m.swipeId ? m : { ...m, swipeId: swipe }, path, tombstones);
        for (let u = r + 1; u < next; u++) after = stepPath(after, true, contentId(activeText(chain[u] as ChainMessage)).hash, "", "");
        if (ahead.has(after)) continue;
        // Kept when a later record was planned at it, or when it ends a record folded on its own path.
        const ownEnd = liveRecord(m, swipe, tombstones)?.path === path;
        if (planned.has(after) || ownEnd) ahead.set(after, { at: r, swipe, prev: picks });
      }
    }
    known = ahead;
  }
  return out;
}
