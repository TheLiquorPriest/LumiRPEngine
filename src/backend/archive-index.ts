// The raw archive index (DEPTH-PLAN §4.3): the chat's prose as the host stores it, on the active
// chain, indexed per chat by message and swipe, story time, place, and the live beats citing each
// message with the people on them and who each beat reached (its exposure). The author and the GM
// search and quote it (their archive tools); a character never reads it. I keep the lexical index in
// the user's storage (`runs/<chatId>/archive/`, in shards by message id), so a chat reopened after
// eviction or a restart loads its tokenized pieces instead of tokenizing the whole chat again, and
// a few recently searched chats in memory. At each search it is brought up to date from the messages
// every ledger operation reads anyway: a message whose swipe or text changed is indexed again, one
// gone is dropped, and only the shards that changed are written back. A loaded message is checked
// against its stored fingerprint once, at load; after that a search compares the text as it is.

import type { ArchiveExposure, ArchiveHit, ArchiveQuery, ArchiveQuote, ArchiveQuoteRequest, ArchiveResult } from "../shared/archive";
import { ARCHIVE_QUOTE_MAX } from "../shared/archive";
import { hash32, hashParts } from "../shared/hash";
import type { ChatId, EntityId, MessageId, PlaceId, UserId } from "../shared/ids";
import { isRecord } from "../shared/json";
import { beatPeople, exposureChannels, type PlacedBeat, type StoryRead } from "../shared/story";
import { indexPieces, LexicalIndex, type IndexedPassage } from "../engine/lexical";
import type { HostPort } from "./host";
import type { ArchiveMessage, ArchiveView, LedgerService } from "./ledger-io";

/** Chats whose index is kept in memory, the most recently searched last. */
export const ARCHIVE_CHATS_KEPT = 3;
/** Shards of a chat's stored index: a change rewrites only the shards of the messages it touched. */
export const ARCHIVE_SHARDS = 16;
const SNIPPET = 400;
const STORED_VERSION = 1;

export function archiveDir(chatId: ChatId): string {
  return `runs/${chatId}/archive`;
}

/** One message as stored: the swipe and the fingerprint of the text it was indexed with, and its pieces as `[start, end, length, words, counts]`. */
interface StoredMessage {
  swipe: string;
  h: string;
  p: [number, number, number, string, number[]][];
}

interface ChatArchive {
  index: LexicalIndex<MessageId>;
  /** Per message, the swipe and text it was indexed with: compared as they are, so a search never hashes the chat. */
  seen: Map<MessageId, { swipe: string; text: string }>;
  /** The stored index, by shard: what each shard file holds. */
  shards: Map<MessageId, StoredMessage>[];
  /** Shards changed since they were last written. */
  dirty: Set<number>;
  /** The writes under way, in order. */
  writing: Promise<void>;
}

function shardOf(id: MessageId): number {
  return hash32(id) % ARCHIVE_SHARDS;
}

/** A stored message's pieces as the index takes them; null for one that doesn't read as stored. */
function piecesOfStored(s: StoredMessage): IndexedPassage[] | null {
  const out: IndexedPassage[] = [];
  for (const row of s.p) {
    if (!Array.isArray(row) || row.length !== 5) return null;
    const [start, end, length, words, counts] = row;
    if (typeof start !== "number" || typeof end !== "number" || typeof length !== "number" || typeof words !== "string" || !Array.isArray(counts)) return null;
    const list = words === "" ? [] : words.split(" ");
    if (list.length !== counts.length || !counts.every((n) => typeof n === "number")) return null;
    out.push({ passage: { start, end }, length, words: list.map((w, i) => [w, counts[i] as number]) });
  }
  return out;
}

/** A shard file's messages; an empty map for one missing or unreadable (its messages are indexed again). */
function shardOfText(text: string | null): Map<MessageId, StoredMessage> {
  const out = new Map<MessageId, StoredMessage>();
  if (text === null) return out;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return out;
  }
  if (!isRecord(v) || v.v !== STORED_VERSION || !isRecord(v.messages)) return out;
  for (const [id, m] of Object.entries(v.messages)) {
    if (isRecord(m) && typeof m.swipe === "string" && typeof m.h === "string" && Array.isArray(m.p)) out.set(id as MessageId, m as unknown as StoredMessage);
  }
  return out;
}

/** What the live beats say of each message they cite. */
interface Cited {
  beats: string[];
  places: Set<PlaceId>;
  people: Set<EntityId>;
  exposure: ArchiveExposure[];
  earliest: number | null;
}

/** The message a beat cites: its bootstrap source when that is on the chain, else the message it folds after. */
function citedBy(b: PlacedBeat, onChain: ReadonlySet<MessageId>): MessageId {
  const by = b.beat.by;
  if ("bootstrap" in by && onChain.has(by.bootstrap.message)) return by.bootstrap.message;
  return b.from.messageId;
}

function citations(story: StoryRead, onChain: ReadonlySet<MessageId>): Map<MessageId, Cited> {
  const out = new Map<MessageId, Cited>();
  for (const b of story.beats) {
    const id = citedBy(b, onChain);
    const c = out.get(id) ?? { beats: [], places: new Set<PlaceId>(), people: new Set<EntityId>(), exposure: [], earliest: null };
    c.beats.push(b.beat.id);
    c.places.add(b.beat.place);
    for (const who of beatPeople(b.beat)) c.people.add(who);
    for (const ref of b.beat.about) if ("entity" in ref) c.people.add(ref.entity);
    for (const x of b.beat.exposure) c.exposure.push({ who: x.who, beat: b.beat.id, channels: exposureChannels(x), reach: x.reach });
    c.earliest = c.earliest === null ? b.beat.at : Math.min(c.earliest, b.beat.at);
    out.set(id, c);
  }
  return out;
}

/** A passage cut to about `SNIPPET` characters at a word bound. */
function snippetOf(text: string, start: number, end: number): { snippet: string; span: [number, number] } {
  let stop = Math.min(end, start + SNIPPET);
  if (stop < end) {
    const space = text.lastIndexOf(" ", stop);
    if (space > start + SNIPPET / 2) stop = space;
  }
  return { snippet: text.slice(start, stop).trim(), span: [start, stop] };
}

export class ArchiveIndex {
  private readonly chats = new Map<string, ChatArchive>();
  private readonly loading = new Map<string, Promise<ChatArchive>>();
  /** Messages tokenized since this index started: a chat loaded from storage tokenizes only the messages that changed since it was written. */
  tokenized = 0;

  constructor(
    private readonly ledger: LedgerService,
    private readonly host: Pick<HostPort, "storage" | "log">,
  ) {}

  /** The chat's stored index, as its shard files hold it (a shard that can't be read holds nothing, so its messages are indexed again). */
  private async load(chatId: ChatId, userId: UserId): Promise<ChatArchive> {
    const dir = archiveDir(chatId);
    const shards = await Promise.all(
      Array.from({ length: ARCHIVE_SHARDS }, async (_, n) => shardOfText(await this.host.storage.read(`${dir}/shard-${n}.json`, userId).catch(() => null))),
    );
    return { index: new LexicalIndex<MessageId>(), seen: new Map(), shards, dirty: new Set(), writing: Promise.resolve() };
  }

  /** The chat's index, from memory or loaded once from storage; the most recently searched kept. */
  private async archiveOf(chatId: ChatId, userId: UserId): Promise<ChatArchive> {
    const key = `${userId}\u0000${chatId}`;
    let archive = this.chats.get(key);
    if (!archive) {
      let load = this.loading.get(key);
      if (!load) {
        load = this.load(chatId, userId).finally(() => this.loading.delete(key));
        this.loading.set(key, load);
      }
      archive = await load;
    }
    this.chats.delete(key);
    this.chats.set(key, archive);
    while (this.chats.size > ARCHIVE_CHATS_KEPT) this.chats.delete(this.chats.keys().next().value ?? "");
    return archive;
  }

  /** The chat's index brought up to date with `messages`, and the shards that changed written back. */
  private async synced(chatId: ChatId, userId: UserId, messages: readonly ArchiveMessage[]): Promise<ChatArchive> {
    const archive = await this.archiveOf(chatId, userId);
    const now = new Set<MessageId>();
    for (const m of messages) {
      now.add(m.id);
      const was = archive.seen.get(m.id);
      if (was && was.swipe === m.swipe && was.text === m.text) continue;
      const n = shardOf(m.id);
      const shard = archive.shards[n] as Map<MessageId, StoredMessage>;
      const h = hashParts(m.text);
      const stored = shard.get(m.id);
      let pieces = stored && stored.swipe === m.swipe && stored.h === h ? piecesOfStored(stored) : null;
      if (!pieces) {
        pieces = indexPieces(m.text);
        this.tokenized++;
        shard.set(m.id, { swipe: m.swipe, h, p: pieces.map((x) => [x.passage.start, x.passage.end, x.length, x.words.map(([w]) => w).join(" "), x.words.map(([, c]) => c)]) });
        archive.dirty.add(n);
      }
      archive.index.addIndexed(m.id, pieces);
      archive.seen.set(m.id, { swipe: m.swipe, text: m.text });
    }
    archive.shards.forEach((shard, n) => {
      for (const id of shard.keys()) {
        if (now.has(id)) continue;
        archive.index.remove(id);
        archive.seen.delete(id);
        shard.delete(id);
        archive.dirty.add(n);
      }
    });
    await this.flush(chatId, userId, archive);
    return archive;
  }

  /** Writes the changed shards, as they are now, after the writes before them; a shard that fails stays changed, for the next search. */
  private flush(chatId: ChatId, userId: UserId, archive: ChatArchive): Promise<void> {
    if (archive.dirty.size === 0) return archive.writing;
    const texts = [...archive.dirty].map((n) => [n, JSON.stringify({ v: STORED_VERSION, messages: Object.fromEntries(archive.shards[n] ?? []) })] as const);
    archive.dirty.clear();
    const dir = archiveDir(chatId);
    archive.writing = archive.writing.then(async () => {
      for (const [n, text] of texts) {
        const path = `${dir}/shard-${n}.json`;
        try {
          await this.host.storage.write(`${path}.tmp`, text, userId);
          await this.host.storage.move(`${path}.tmp`, path, userId);
        } catch (error) {
          archive.dirty.add(n);
          this.host.log("warn", `The archive index of chat ${chatId} couldn't write ${path}: ${error instanceof Error ? error.message : String(error)}`, userId);
        }
      }
    });
    return archive.writing;
  }

  /** Searches the chat's prose (DEPTH-PLAN §4.3): ranked by the words when given, else newest first, filtered by person, place, story time and basis. */
  async search(chatId: ChatId, userId: UserId, q: ArchiveQuery): Promise<ArchiveResult> {
    const view = await this.ledger.archiveView(chatId, userId);
    return view ? this.searchView(chatId, userId, view, q) : { hits: [], total: 0 };
  }

  /** `search` over a view a caller already holds (`archiveViewOf` on a turn's own core, which holds the chat's queue). */
  async searchView(chatId: ChatId, userId: UserId, view: ArchiveView, q: ArchiveQuery): Promise<ArchiveResult> {
    const archive = await this.synced(chatId, userId, view.messages);
    const byId = new Map(view.messages.map((m) => [m.id, m]));
    const cited = citations(view.story, new Set(byId.keys()));
    const upTo = q.upTo === undefined ? Infinity : (byId.get(q.upTo)?.index ?? -1);
    const timeOf = (m: ArchiveMessage): number | null => m.clock ?? cited.get(m.id)?.earliest ?? null;
    const keep = (id: MessageId): boolean => {
      const m = byId.get(id);
      if (!m || m.index > upTo) return false;
      const c = cited.get(id);
      if (q.who !== undefined && !c?.people.has(q.who)) return false;
      if (q.place !== undefined && !c?.places.has(q.place)) return false;
      if (q.from !== undefined || q.to !== undefined) {
        const t = timeOf(m);
        if (t === null || (q.from !== undefined && t < q.from) || (q.to !== undefined && t > q.to)) return false;
      }
      return true;
    };
    const text = q.text?.trim() ?? "";
    const ranked: { id: MessageId; score: number; start: number; end: number }[] =
      text !== ""
        ? archive.index.search(text, keep).map((h) => ({ id: h.key, score: h.score, start: h.passage.start, end: h.passage.end }))
        : view.messages
            .filter((m) => keep(m.id))
            .reverse()
            .map((m) => ({ id: m.id, score: 0, start: 0, end: m.text.length }));
    const limit = Math.max(1, Math.min(50, q.limit ?? 8));
    const offset = Math.max(0, q.offset ?? 0);
    const hits = ranked.slice(offset, offset + limit).flatMap((r): ArchiveHit[] => {
      const m = byId.get(r.id);
      if (!m) return [];
      const c = cited.get(r.id);
      const { snippet, span } = snippetOf(m.text, r.start, r.end);
      return [{ messageId: m.id, index: m.index, isUser: m.isUser, swipeId: m.swipeId, swipe: m.swipe, storyTime: timeOf(m), places: [...(c?.places ?? [])], people: [...(c?.people ?? [])], beats: c?.beats ?? [], exposure: c?.exposure ?? [], score: r.score, snippet, span }];
    });
    return { hits, total: ranked.length };
  }

  /** Quotes a message of the active chain, or a span of it, exactly as the host stores it (capped at `ARCHIVE_QUOTE_MAX`). */
  async quote(chatId: ChatId, userId: UserId, req: ArchiveQuoteRequest): Promise<ArchiveQuote | null> {
    const view = await this.ledger.archiveView(chatId, userId);
    return view ? quoteView(view, req) : null;
  }
}

/** `ArchiveIndex.quote` over a view a caller already holds. */
export function quoteView(view: ArchiveView, req: ArchiveQuoteRequest): ArchiveQuote | null {
  const m = view.messages.find((x) => x.id === req.messageId);
  if (!m) return null;
  const start = Math.max(0, Math.min(m.text.length, req.span?.[0] ?? 0));
  const end = Math.max(start, Math.min(m.text.length, req.span?.[1] ?? m.text.length));
  const stop = Math.min(end, start + ARCHIVE_QUOTE_MAX);
  const cited = citations(view.story, new Set(view.messages.map((x) => x.id))).get(m.id);
  return { messageId: m.id, index: m.index, isUser: m.isUser, swipeId: m.swipeId, swipe: m.swipe, storyTime: m.clock ?? cited?.earliest ?? null, span: [start, stop], text: m.text.slice(start, stop), truncated: stop < end };
}
