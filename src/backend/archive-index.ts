// The raw archive index (DEPTH-PLAN §4.3): the chat's prose as the host stores it, on the active
// chain, indexed per chat by message and swipe, story time, place, and the live beats citing each
// message with the people on them. The author and the GM search and quote it (their archive tools);
// a character never reads it. The lexical index is kept per open chat and brought up to date at each
// search from the messages every ledger operation reads anyway (a message whose swipe or text
// changed is indexed again, one gone is dropped): rebuilding it costs about what parsing a stored
// copy would, so none is kept.

import type { ArchiveHit, ArchiveQuery, ArchiveQuote, ArchiveQuoteRequest, ArchiveResult } from "../shared/archive";
import { ARCHIVE_QUOTE_MAX } from "../shared/archive";
import type { ChatId, EntityId, MessageId, PlaceId, UserId } from "../shared/ids";
import { beatPeople, type PlacedBeat, type StoryRead } from "../shared/story";
import { LexicalIndex } from "../engine/lexical";
import { contentId } from "../engine/ledger/path";
import type { ArchiveMessage, ArchiveView, LedgerService } from "./ledger-io";

/** Chats whose index is kept, the most recently searched last. */
export const ARCHIVE_CHATS_KEPT = 3;
const SNIPPET = 400;

interface ChatArchive {
  index: LexicalIndex<MessageId>;
  /** Per message, the swipe and text it was indexed with. */
  seen: Map<MessageId, string>;
}

/** What the live beats say of each message they cite. */
interface Cited {
  beats: string[];
  places: Set<PlaceId>;
  people: Set<EntityId>;
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
    const c = out.get(id) ?? { beats: [], places: new Set<PlaceId>(), people: new Set<EntityId>(), earliest: null };
    c.beats.push(b.beat.id);
    c.places.add(b.beat.place);
    for (const who of beatPeople(b.beat)) c.people.add(who);
    for (const ref of b.beat.about) if ("entity" in ref) c.people.add(ref.entity);
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

  constructor(private readonly ledger: LedgerService) {}

  /** The chat's index brought up to date with `messages`. */
  private synced(chatId: ChatId, userId: UserId, messages: readonly ArchiveMessage[]): ChatArchive {
    const key = `${userId}\u0000${chatId}`;
    const archive = this.chats.get(key) ?? { index: new LexicalIndex<MessageId>(), seen: new Map<MessageId, string>() };
    this.chats.delete(key);
    this.chats.set(key, archive);
    while (this.chats.size > ARCHIVE_CHATS_KEPT) this.chats.delete(this.chats.keys().next().value ?? "");
    const now = new Set<MessageId>();
    for (const m of messages) {
      now.add(m.id);
      const stamp = `${m.swipe}\u0000${contentId(m.text).hash}`;
      if (archive.seen.get(m.id) === stamp) continue;
      archive.index.add(m.id, m.text);
      archive.seen.set(m.id, stamp);
    }
    for (const id of [...archive.seen.keys()]) {
      if (now.has(id)) continue;
      archive.index.remove(id);
      archive.seen.delete(id);
    }
    return archive;
  }

  /** Searches the chat's prose (DEPTH-PLAN §4.3): ranked by the words when given, else newest first, filtered by person, place, story time and basis. */
  async search(chatId: ChatId, userId: UserId, q: ArchiveQuery): Promise<ArchiveResult> {
    const view = await this.ledger.archiveView(chatId, userId);
    return view ? this.searchView(chatId, userId, view, q) : { hits: [], total: 0 };
  }

  /** `search` over a view a caller already holds (`archiveViewOf` on a turn's own core, which holds the chat's queue). */
  searchView(chatId: ChatId, userId: UserId, view: ArchiveView, q: ArchiveQuery): ArchiveResult {
    const archive = this.synced(chatId, userId, view.messages);
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
      return [{ messageId: m.id, index: m.index, isUser: m.isUser, swipeId: m.swipeId, swipe: m.swipe, storyTime: timeOf(m), places: [...(c?.places ?? [])], people: [...(c?.people ?? [])], beats: c?.beats ?? [], score: r.score, snippet, span }];
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
