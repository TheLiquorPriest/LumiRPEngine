// Path hashing and liveness (DESIGN §4.3 P1, path hash), used by the optimized fold and the
// journal. The reference fold deliberately re-implements these rules on its own.

import { hashJson, hashParts } from "../../shared/hash";
import type { ContentId, Marker, PathHash, PostEntry, Rec, Tombstone } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import type { ChainMessage } from "./chain";

/**
 * Content ids by text (DESIGN §9.6): every sync and fold hashes each message of the chat, the same
 * long texts over and over, so each is hashed once while it is among the latest texts hashed. A text
 * found is kept again under the copy just asked about, as the newest: each read of the chat brings a
 * copy of every text, and the copy kept is the one the chat's messages hold now, not an older one.
 */
const CONTENT_IDS = new Map<string, ContentId>();
const CONTENT_IDS_KEPT = 4096;

export function contentId(text: string): ContentId {
  const known = CONTENT_IDS.get(text);
  if (known) {
    CONTENT_IDS.delete(text);
    CONTENT_IDS.set(text, known);
    return { ...known };
  }
  const id: ContentId = { len: text.length, hash: hashParts("lre.content", text) };
  if (CONTENT_IDS.size >= CONTENT_IDS_KEPT) CONTENT_IDS.delete(CONTENT_IDS.keys().next().value ?? "");
  CONTENT_IDS.set(text, id);
  return { ...id };
}

export function sameContent(a: ContentId | undefined, b: ContentId | undefined): boolean {
  return a !== undefined && b !== undefined && a.len === b.len && a.hash === b.hash;
}

/** The hash a tombstone matches: the whole stored record. */
export function storedRecordHash(rec: Rec): string {
  return hashJson(rec);
}

export function isTombstoned(tombstones: readonly Tombstone[], messageId: string, rec: Rec): boolean {
  if (tombstones.length === 0) return false;
  const recHash = storedRecordHash(rec);
  return tombstones.some((t) => t.messageId === messageId && sameContent(t.swipeHash, rec.swipeHash) && t.recHash === recHash);
}

/** P1: live when untagged (starting markers), made under the current parent path, or made with its record on-path. */
export function isLive(at: PathHash | null, parentPath: PathHash, recPath: PathHash | null): boolean {
  return at === null || at === parentPath || (recPath !== null && at === recPath);
}

/** A record with no effect hashes like no record, so a bare record never moves a path (L38). */
export function recordHash(rec: Rec | null, livePost: readonly PostEntry[], parentPath: PathHash): string {
  if (!rec) return "";
  const keep = rec.keep?.[parentPath];
  if (rec.events.length === 0 && livePost.length === 0 && rec.markersApplied === 0 && !keep && rec.undone.length === 0) return "";
  return hashJson({
    e: rec.events,
    m: rec.markersApplied,
    p: livePost.map((p) => ({ s: p.seq, k: p.kind, e: p.events })),
    k: keep ?? null,
    u: rec.undone,
  });
}

export function markersHash(live: readonly Marker[]): string {
  if (live.length === 0) return "";
  return hashJson(
    [...live]
      .sort((a, b) => a.seq - b.seq)
      .map((m) => {
        const { at: _at, start: _start, ...body } = m;
        return body;
      }),
  );
}

export function stepPath(parent: PathHash, isUser: boolean, content: string, rec: string, markers: string): PathHash {
  return hashParts("lre.path", parent, isUser ? "u" : "a", content, rec, markers);
}

/** The active swipe's record, unless tombstoned. */
export function activeRecord(m: ChainMessage, tombstones: readonly Tombstone[]): Rec | null {
  const rec = m.ledger?.swipes[String(m.swipeId)];
  if (!rec || isTombstoned(tombstones, m.id, rec)) return null;
  return rec;
}

export function activeText(m: ChainMessage): string {
  return m.swipes[m.swipeId] ?? "";
}

/**
 * A turn's own message: the user message right before its reply (`before` is the chain up to the
 * reply), as the turn's plan reads its words (`planBase`), or none for a new reply after a reply. The
 * pre phase reads it, the chips after the reply, a mind's recall and the GM's fidelity go by it, so
 * the message an earlier turn played is never read or counted again for a later one.
 */
export function ownMessage<M extends Pick<ChainMessage, "isUser">>(before: readonly M[]): M | undefined {
  const tail = before.at(-1);
  return tail?.isUser ? tail : undefined;
}

export interface PathPoint {
  parentPath: PathHash;
  path: PathHash;
}

/** Parent path and path of every message; hashing only, no state. */
export function computePaths(chain: readonly ChainMessage[], tombstones: readonly Tombstone[]): PathPoint[] {
  const out: PathPoint[] = [];
  let parent = ROOT_PATH;
  for (const m of chain) {
    const point = { parentPath: parent, path: nextPath(m, parent, tombstones) };
    out.push(point);
    parent = point.path;
  }
  return out;
}

/**
 * The path a record's turn was planned at, or null for a bare record (path ""), which has no
 * turn: entries on a bare record are live only where they were made, never travelling with it.
 */
export function turnPath(rec: Pick<Rec, "path"> | null): PathHash | null {
  return rec && rec.path !== "" ? rec.path : null;
}

/** The path after one message, given its parent path. */
export function nextPath(m: ChainMessage, parent: PathHash, tombstones: readonly Tombstone[]): PathHash {
  if (m.isUser) return stepPath(parent, true, contentId(activeText(m)).hash, "", "");
  const rec = activeRecord(m, tombstones);
  const recPath = turnPath(rec);
  const live = (m.ledger?.markers ?? []).filter((mk) => isLive(mk.at, parent, recPath));
  const livePost = rec ? rec.post.filter((p) => isLive(p.at, parent, recPath)).sort((a, b) => a.seq - b.seq) : [];
  const content = rec ? rec.swipeHash.hash : contentId(activeText(m)).hash;
  return stepPath(parent, false, content, recordHash(rec, livePost, parent), markersHash(live));
}
