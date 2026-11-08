// The layer carried in the chat's own metadata (DEPTH-PLAN §4.9, owner's ruling on exports): Lumiverse's
// chat export and import copy a chat's metadata, so a copy of the layer kept there travels
// with them. An imported chat takes it as a branch takes its ancestor's (`ancestorOf`): each entry onto
// the copy of its basis message, matched by the identities the messages show (`copyMap`). A layer too
// large to carry is marked so, and the chat keeps the warning that an export loses its depth.

import type { ChatId, MessageId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LayerEntry } from "../shared/layer";
import type { ChainMessage } from "../engine/ledger/chain";
import { swipeKeyOf } from "../engine/ledger/layer";

/** The top-level chat metadata key the carried layer sits under. */
export const LAYER_CARRY_KEY = "lre_layer";
/** The most characters the carried layer may take in the chat's metadata, as JSON: under 1 MiB. */
export const LAYER_CARRY_MAX = 1_000_000;

/** A basis message as the carrying chat showed it: what its copy is found by. */
export interface CarriedMessage {
  id: MessageId;
  user: boolean;
  /** Every swipe's identity (`swipeKeyOf`). */
  keys: string[];
}

export type LayerCarry =
  | { v: 1; chat: ChatId; runSeed: string; at: string; entries: number; messages: CarriedMessage[]; list: LayerEntry[] }
  /** Too large to carry: an export of this chat starts without its depth. */
  | { v: 1; chat: ChatId; runSeed: string; at: string; entries: number; over: true };

/** The carry for `entries` (all the chat folds, in its own message ids) on `chain`: the basis messages in chain order and the entries; or marked over the cap. */
export function carryOf(chatId: ChatId, runSeed: string, entries: readonly LayerEntry[], chain: readonly ChainMessage[]): LayerCarry {
  const at = new Date().toISOString();
  const head = { v: 1 as const, chat: chatId, runSeed, at, entries: entries.length };
  const size = JSON.stringify(entries).length;
  if (size > LAYER_CARRY_MAX) return { ...head, over: true };
  const bases = new Set(entries.map((e) => e.basis.message));
  const messages = chain.filter((m) => bases.has(m.id)).map((m): CarriedMessage => ({ id: m.id, user: m.isUser, keys: m.swipes.map((_, s) => swipeKeyOf({ ...m, swipeId: s }, [])) }));
  if (size + JSON.stringify(messages).length > LAYER_CARRY_MAX) return { ...head, over: true };
  return { ...head, messages, list: [...entries] };
}

/** The carry a chat's metadata holds, when it is one this build reads. */
export function carryIn(meta: Readonly<Record<string, unknown>>): LayerCarry | null {
  const c = meta[LAYER_CARRY_KEY];
  if (!isRecord(c) || c.v !== 1 || typeof c.chat !== "string" || typeof c.runSeed !== "string" || typeof c.at !== "string" || typeof c.entries !== "number") return null;
  if (c.over === true) return c as unknown as LayerCarry;
  if (!Array.isArray(c.list) || !Array.isArray(c.messages)) return null;
  return c as unknown as LayerCarry;
}

/** The entries a carry holds; null when it holds none (over the cap) or can't be read. */
export function carriedEntries(carry: LayerCarry): LayerEntry[] | null {
  return "over" in carry ? null : carry.list;
}

/** Which of `copy`'s messages shows each carried message's identity (`copyMap`), as a branch's copies are found. */
export function carriedMap(carry: Extract<LayerCarry, { list: LayerEntry[] }>, copy: readonly ChainMessage[]): Record<MessageId, MessageId> {
  return copyMap(
    carry.messages.map((m) => ({ id: m.id, user: m.user, keys: new Set(m.keys) })),
    copy.map((m) => ({ id: m.id, user: m.isUser, keys: new Set(m.swipes.map((_, s) => swipeKeyOf({ ...m, swipeId: s }, []))) })),
  );
}

/** An original message (`i`) and its copy (`j`), by their places in their lists, and the pair before them in a run of copies. */
interface CopyPair {
  i: number;
  j: number;
  prev: CopyPair | null;
}

/**
 * Pairs each of `originals` with its copy in `copies`, both in chat order, by the swipe identities
 * they share: as many as can be (their longest common run, the earlier copy where two would do), never
 * by place. One that shares no identity with a copy maps onto none.
 */
export function copyMap(originals: readonly { id: MessageId; user: boolean; keys: ReadonlySet<string> }[], copies: readonly { id: MessageId; user: boolean; keys: ReadonlySet<string> }[]): Record<MessageId, MessageId> {
  // Where each identity stands in the copies, in chat order.
  const places = new Map<string, number[]>();
  for (const [j, m] of copies.entries()) {
    for (const key of m.keys) {
      const list = places.get(key);
      if (list) list.push(j);
      else places.set(key, [j]);
    }
  }
  // The longest common run of copies (Hunt–Szymanski): `ends[k]` ends, of the runs of k + 1 pairs found so far, the one that stops earliest in the copies.
  const ends: CopyPair[] = [];
  for (const [i, m] of originals.entries()) {
    const found = new Set<number>();
    for (const key of m.keys) for (const j of places.get(key) ?? []) if (copies[j].user === m.user) found.add(j);
    // The latest first, so no message pairs twice in one run.
    for (const j of [...found].sort((x, y) => y - x)) {
      let lo = 0;
      let hi = ends.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid].j < j) lo = mid + 1;
        else hi = mid;
      }
      ends[lo] = { i, j, prev: ends[lo - 1] ?? null };
    }
  }
  const out: Record<MessageId, MessageId> = {};
  for (let p = ends.at(-1) ?? null; p !== null; p = p.prev) out[originals[p.i].id] = copies[p.j].id;
  return out;
}
