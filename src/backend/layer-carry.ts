// The layer carried in the chat's own metadata (DEPTH-PLAN §4.9, owner's ruling on exports): Lumiverse's
// chat export and import copy a chat's metadata, so a copy of the layer kept there travels
// with them. An imported chat takes it as a branch takes its ancestor's (`ancestorOf`): each entry onto
// the copy of its basis message, matched by the identities the messages show (`copyMap`). The texts the
// entries name travel beside them, so an import into another account puts them in its own store. A
// layer too large to carry whole carries its newest entries that fit, and says how many it holds.

import type { ChatId, MessageId, UserId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LayerEntry } from "../shared/layer";
import { blobHash, isBlobHash } from "../shared/stores";
import { storyBlobs } from "../shared/story";
import { mindBlobs } from "../shared/character-engine";
import { authorBlobs } from "../shared/author";
import { episodeBlobs, STORY_DRAFT } from "../shared/episodes";
import { workspaceRefs } from "../engine/workspace";
import type { ChainMessage } from "../engine/ledger/chain";
import { swipeKeyOf } from "../engine/ledger/layer";
import { blobPath } from "./agents/blobs";
import type { HostPort } from "./host";

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

export interface LayerCarry {
  v: 1;
  chat: ChatId;
  runSeed: string;
  at: string;
  /** How many entries the chat folds; `list` holds the newest of them that fit, so fewer says the rest stayed behind. */
  entries: number;
  messages: CarriedMessage[];
  list: LayerEntry[];
  /** The texts the carried entries name, by hash, as the carrying account stored them. */
  texts: Record<string, string>;
}

/** The blobs a list of events names: the workspace files it writes, the texts of its beats, staging, strikes, prose and scenes, its mind writes, the author's records' notes, and a draft's own beats and changes; anything that isn't such a list names nothing. */
export function eventBlobs(events: unknown, into: Set<string>): void {
  if (!Array.isArray(events)) return;
  for (const hash of workspaceRefs(events)) into.add(hash);
  for (const ev of events) if (isRecord(ev) && typeof ev.type === "string" && ev.type.startsWith("story.")) for (const hash of storyBlobs(ev.type, ev.data)) into.add(hash);
  for (const ev of events) if (isRecord(ev) && typeof ev.type === "string" && ev.type.startsWith("minds.v2.")) for (const hash of mindBlobs(ev.type, ev.data)) into.add(hash);
  for (const ev of events) if (isRecord(ev) && typeof ev.type === "string" && ev.type.startsWith("author.")) for (const hash of authorBlobs(ev.type, ev.data)) into.add(hash);
  // A draft holds its beats and the changes it would make as its own data (DEPTH-PLAN §4.6).
  for (const ev of events) {
    if (!isRecord(ev) || ev.type !== STORY_DRAFT || !isRecord(ev.data)) continue;
    for (const hash of episodeBlobs(ev.type, ev.data)) into.add(hash);
    eventBlobs(ev.data.effects, into);
  }
}

/** The blobs a layer entry (or a held draft) names: its events' and its reasoning. Lenient. */
export function entryBlobs(entry: unknown, into: Set<string>): void {
  if (!isRecord(entry)) return;
  eventBlobs(entry.events, into);
  if (isBlobHash(entry.reasoning)) into.add(entry.reasoning);
}

/** A blob's text as `userId`'s store holds it; null when it isn't there or doesn't hash to its address. */
export async function storedText(host: Pick<HostPort, "storage">, userId: UserId, hash: string): Promise<string | null> {
  if (!isBlobHash(hash)) return null;
  const text = await host.storage.read(blobPath(hash), userId);
  return text !== null && blobHash(text) === hash ? text : null;
}

/** Puts a carry's texts in `userId`'s store, each under its hash; one that doesn't hash to its address is left out. */
export async function putCarriedTexts(host: Pick<HostPort, "storage">, userId: UserId, carry: LayerCarry): Promise<void> {
  for (const [hash, text] of Object.entries(carry.texts)) {
    if (!isBlobHash(hash) || typeof text !== "string" || blobHash(text) !== hash) continue;
    const path = blobPath(hash);
    await host.storage.write(`${path}.tmp`, text, userId);
    await host.storage.move(`${path}.tmp`, path, userId);
  }
}

/**
 * The carry for `entries` (all the chat folds, in its own message ids, in landing order) on `chain`:
 * the newest entries whose JSON, texts (`text` reads one) and basis messages fit the cap together,
 * taken newest first and stopping at the first that doesn't, kept in landing order.
 */
export async function carryOf(chatId: ChatId, runSeed: string, entries: readonly LayerEntry[], chain: readonly ChainMessage[], text: (hash: string) => Promise<string | null>): Promise<LayerCarry> {
  const head = { v: 1 as const, chat: chatId, runSeed, at: new Date().toISOString(), entries: entries.length };
  const onChain = new Map(chain.map((m) => [m.id, m]));
  const list: LayerEntry[] = [];
  const texts: Record<string, string> = {};
  const messages = new Map<MessageId, CarriedMessage>();
  let size = JSON.stringify({ ...head, messages: [], list: [], texts: {} }).length;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e) continue;
    let cost = JSON.stringify(e).length + 1;
    const named = new Set<string>();
    entryBlobs(e, named);
    const own: Record<string, string> = {};
    for (const hash of named) {
      if (hash in texts) continue;
      const t = await text(hash);
      if (t === null) continue;
      own[hash] = t;
      cost += JSON.stringify(hash).length + JSON.stringify(t).length + 2;
    }
    const m = messages.has(e.basis.message) ? undefined : onChain.get(e.basis.message);
    const message = m ? { id: m.id, user: m.isUser, keys: m.swipes.map((_, s) => swipeKeyOf({ ...m, swipeId: s }, [])) } : undefined;
    if (message) cost += JSON.stringify(message).length + 1;
    if (size + cost > LAYER_CARRY_MAX) break;
    size += cost;
    list.push(e);
    Object.assign(texts, own);
    if (message) messages.set(message.id, message);
  }
  list.reverse();
  return { ...head, messages: chain.flatMap((m) => messages.get(m.id) ?? []), list, texts };
}

/** The carry a chat's metadata holds, when it is one this build reads: none for one an earlier build marked too large to carry anything. */
export function carryIn(meta: Readonly<Record<string, unknown>>): LayerCarry | null {
  const c = meta[LAYER_CARRY_KEY];
  if (!isRecord(c) || c.v !== 1 || typeof c.chat !== "string" || typeof c.runSeed !== "string" || typeof c.at !== "string" || typeof c.entries !== "number") return null;
  if (!Array.isArray(c.list) || !Array.isArray(c.messages)) return null;
  return { ...(c as unknown as LayerCarry), texts: isRecord(c.texts) ? (c.texts as Record<string, string>) : {} };
}

/** Which of `copy`'s messages shows each carried message's identity (`copyMap`), as a branch's copies are found. */
export function carriedMap(carry: LayerCarry, copy: readonly ChainMessage[]): Record<MessageId, MessageId> {
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
