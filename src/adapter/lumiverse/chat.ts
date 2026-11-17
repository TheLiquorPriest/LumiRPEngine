// RPH's chat port over Lumiverse's chats (STANDALONE-PLAN §4.2, §6.8 `chat_read`, `chat_search`): a
// chat's length and any stretch of its messages, whether or not the history window kept them in the
// prompt; a search of its messages by their words; the chat's path listed without text; and one
// message found by its id. A message the user hid from the prompt in Lumiverse is listed and marked,
// and its text is left out, of a read and of a search, unless the chat's setting lets agents read
// hidden messages (§4.2, "Hidden messages"). A message Lumiverse's own memory stands in for with a
// summary is marked as such (§4.2: "The turn's files mark a summary as a summary"). A message the chat's story choice (`story.from`,
// R-176) leaves out of the story is marked `story: false`: with the replies alone as the story, every message that is not a reply (his
// own, and a system message an extension added); as Lumiverse has it, the same while its Sovereign Hand is on, and none while it is off or unsaid.
//
// A message's place on the path counts from 0 at the chat's first message, in Lumiverse's order; it is
// not Lumiverse's `index_in_chat`, which keeps a gap where a message was deleted.
//
// The search is answered from the messages index of the index file, which holds the tokens of each message and its id, never its text
// (`index-feed.ts`; §4.2, "No copy"): a message is found when every word asked for begins one of its words, in any letter case, and only
// the hits' texts are read from Lumiverse; hits come oldest first. After the words' hits, and within the limit, come the messages nearest the query in meaning (`how: "meaning"`), where an
// embedding connection is set.

import type { ChatHit, ChatInfo, ChatMessage, ChatPort, ChatQuery, ChatRole, HistoryRange, Scope } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { IndexFeed } from "./index-feed";
import type { LumiverseReads } from "./reads";
import type { LvMessage } from "./rows";
import { matchAt, snippetOf, wordsOf } from "./words";

/** A chat's setting `story.from` (R-176): whose messages are its story: as Lumiverse has it (its Sovereign Hand), everyone's, or the replies alone. */
export type StoryFrom = "lumiverse" | "everyone" | "replies";

/** A message as the chat's path lists it, with no text: its place, and Lumiverse's own facts of it. */
export interface ChatStep {
  id: string;
  /** Its place on the path, from 0. */
  index: number;
  role: ChatRole;
  /** The swipe it shows, and how many it has. */
  swipe: number;
  swipes: number;
  hidden?: true;
  summarized?: true;
}

/** RPH's chat port, and two reads of RPE's own: the path without text, and one message by its id. */
export interface ChatReads extends ChatPort {
  /** Every message of the chat's path, in order, with no text. */
  list(scope: Scope): Promise<ChatStep[]>;
  /** One message of the chat, by Lumiverse's id; null when the chat has none such. */
  find(scope: Scope, id: string): Promise<ChatMessage | null>;
  /** A message's place on the chat's path, by its id, from 0 along the path as Lumiverse's rows have it (a gap left by a delete in `index_in_chat` counts for nothing); undefined when the path has none of that id. */
  position(scope: Scope, id: string): Promise<number | undefined>;
}

export interface ChatSearchSettings {
  /** The most hits a search gives when the query names no limit. */
  limit: number;
  /** How long a hit's snippet is, in characters. */
  snippetChars: number;
}

/** The defaults of `lumiverse.search`: as many hits as a lore search gives, and a snippet of a line's length (`src/lore/lore.ts`, `LORE_DEFAULTS`). */
export const CHAT_SEARCH_DEFAULTS: ChatSearchSettings = { limit: 20, snippetChars: 80 };

/** One message as the meaning index is given it: its id, its revision (a changed one is embedded again) and its text, which is sent to be embedded and never kept. */
export interface MeaningDoc {
  id: string;
  revision: string;
  text: string;
}

/** The ids of the chat's messages nearest `text` in meaning, at most `limit`, nearest first; null while no embedding connection is set. `docs` is read only once one is. */
export type MeaningNearest = (chat: string, text: string, limit: number, docs: () => Promise<readonly MeaningDoc[]>) => Promise<string[] | null>;

export interface ChatDeps {
  reads: LumiverseReads;
  /** The Lumiverse user this RPE belongs to: no other user's chat is read. */
  user: string;
  /** The chat's setting: agents may read the messages the user hid from the prompt (off unless the user turns it on). */
  hiddenReadable(chat: string): Promise<boolean>;
  /** The chat's setting `story.from` (the turn lane's): whose messages are its story. */
  storyFrom(chat: string): Promise<StoryFrom>;
  /**
   * The stretches the chat names, by name (the story record's: `scene`, the stretch since the scene opened, §5.4), read along the line of the turn the work belongs to (the scope's turn),
   * not at the chat's head, so a swipe or a branch is named by its own story; at the head where the work belongs to no turn (null).
   */
  ranges(chat: string, turn: string | null): Promise<Record<string, HistoryRange>>;
  /** The messages Lumiverse's memory stands in for with a summary in the chat's prompt (the turn lane's, from the tag's `summary` marks). */
  summarized(chat: string): Promise<ReadonlySet<string>>;
  /** The search's limits, read at each search (the door's settings); `CHAT_SEARCH_DEFAULTS` when not given. */
  search?: () => ChatSearchSettings;
  /** The messages index of the index file, fed from Lumiverse's rows (`index-feed.ts`): a search is answered from it. */
  feed: Pick<IndexFeed, "searchChat">;
  /** The meaning index (the turn lane's): the ids of the chat's messages nearest a text in meaning, nearest first, or null while no embedding connection is set. Absent: a search is by words alone. */
  meaning?: MeaningNearest;
}

/** Why a chat cannot be read, in words an agent and the user can read. */
export class NoSuchChat extends Error {
  constructor(chat: string) {
    super(`There is no chat ${chat} for this RPE's Lumiverse user.`);
    this.name = "NoSuchChat";
  }
}

export function createChatReads(deps: ChatDeps): ChatReads {
  const own = (scope: Scope): string => {
    if (scope.user !== deps.user) throw new NoSuchChat(scope.chat);
    return scope.chat;
  };

  /** Whether the chat's story is the replies alone: by the chat's setting, or by Lumiverse's Sovereign Hand switched on (`sovereignHand.enabled`, the user's Lumiverse setting). */
  async function repliesAlone(chat: string): Promise<boolean> {
    const from = await deps.storyFrom(chat);
    if (from !== "lumiverse") return from === "replies";
    const hand = (await deps.reads.setting("sovereignHand"))?.value;
    return isRecord(hand) && hand.enabled === true;
  }

  const shown = (m: LvMessage, index: number, readable: boolean, summarized: ReadonlySet<string>, outside: boolean): ChatMessage => ({
    id: m.id,
    index,
    role: m.role,
    name: m.name,
    ...(!m.hidden || readable ? { text: m.text } : {}),
    ...(m.hidden ? { hidden: true as const } : {}),
    ...(summarized.has(m.id) ? { summarized: true as const } : {}),
    ...(outside && m.role !== "assistant" ? { story: false as const } : {}),
    at: m.sentAt,
  });

  /**
   * Every message of the chat the embedding may be asked about, as it stands now: the path's messages less the hidden ones where agents may not read them. Read only when an embedding
   * connection is set. A message's revision is Lumiverse's own with the hash of the text showing, so an edit and a swipe flip both embed it again.
   */
  async function meaningDocs(chat: string, path: readonly { id: string; hidden?: boolean }[], readable: boolean): Promise<MeaningDoc[]> {
    const messages = await deps.reads.messages(chat, { from: 0, to: path.length });
    return messages.filter((m) => readable || !m.hidden).map((m) => ({ id: m.id, revision: `${m.revision}:${m.shown.hash}`, text: m.text }));
  }

  return {
    async info(scope): Promise<ChatInfo> {
      const chat = own(scope);
      const [path, hiddenReadable, ranges] = await Promise.all([deps.reads.path(chat), deps.hiddenReadable(chat), deps.ranges(chat, scope.turn ?? null)]);
      if (path === null) throw new NoSuchChat(chat);
      return { length: path.length, hiddenReadable, ranges };
    },
    async read(scope, range: HistoryRange): Promise<ChatMessage[]> {
      const chat = own(scope);
      const from = Math.max(0, Math.floor(range.from));
      if (range.to <= from) return [];
      const [messages, readable, summarized, outside] = await Promise.all([deps.reads.messages(chat, { from, to: range.to }), deps.hiddenReadable(chat), deps.summarized(chat), repliesAlone(chat)]);
      return messages.map((m, i) => shown(m, from + i, readable, summarized, outside));
    },
    async search(scope, query: ChatQuery): Promise<ChatHit[]> {
      const chat = own(scope);
      const settings = deps.search?.() ?? CHAT_SEARCH_DEFAULTS;
      const wanted = [...new Set(wordsOf(query.text).map((w) => w.word))];
      const limit = Math.max(0, Math.floor(query.limit ?? settings.limit));
      if (wanted.length === 0 || limit === 0) return [];
      const found = await deps.feed.searchChat(chat, query.text);
      if (found === null) throw new NoSuchChat(chat);
      const { path, ids } = found;
      const from = Math.max(0, Math.floor(query.within?.from ?? 0));
      const to = Math.min(path.length, query.within?.to ?? path.length);
      if (to <= from) return [];
      const readable = await deps.hiddenReadable(chat);
      const places = new Map(path.map((s, i) => [s.id, i] as const));
      // The index says which messages hold the words; what is read of Lumiverse is the text of the hits alone, oldest first.
      const word = ids
        .flatMap((id) => {
          const i = places.get(id);
          const step = i === undefined ? undefined : path[i];
          return i === undefined || step === undefined || i < from || i >= to || (step.hidden && !readable) ? [] : [{ id, i }];
        })
        .sort((a, b) => a.i - b.i)
        .slice(0, limit);
      // Beyond the words' hits and within the limit: the messages nearest the query in meaning, where the lane has an embedding connection set (none: no word of the chat is sent anywhere).
      const nearest = word.length >= limit || deps.meaning === undefined ? null : await deps.meaning(chat, query.text, to - from < path.length ? path.length : limit + word.length, () => meaningDocs(chat, path, readable));
      const taken = new Set(word.map((h) => h.id));
      const near = (nearest ?? [])
        .flatMap((id) => {
          const i = places.get(id);
          const step = i === undefined ? undefined : path[i];
          return taken.has(id) || i === undefined || step === undefined || i < from || i >= to || (step.hidden && !readable) ? [] : [{ id, i }];
        })
        .slice(0, limit - word.length);
      const hits = [...word.map((h) => ({ ...h, how: "words" as const })), ...near.map((h) => ({ ...h, how: "meaning" as const }))];
      const [read, outside] = await Promise.all([deps.reads.messagesById(chat, hits.map((h) => h.id)), repliesAlone(chat)]);
      const texts = new Map(read.map((m) => [m.id, m] as const));
      return hits.flatMap(({ id, i, how }): ChatHit[] => {
        const m = texts.get(id);
        return m === undefined ? [] : [{ id, index: i, role: m.role, name: m.name, snippet: snippetOf(m.text, how === "words" ? (matchAt(m.text, wanted) ?? 0) : 0, settings.snippetChars), how, ...(outside && m.role !== "assistant" ? { story: false as const } : {}) }];
      });
    },
    async position(scope, id): Promise<number | undefined> {
      const path = await deps.reads.path(own(scope));
      if (path === null) throw new NoSuchChat(scope.chat);
      const place = path.findIndex((s) => s.id === id);
      return place < 0 ? undefined : place;
    },
    async list(scope): Promise<ChatStep[]> {
      const chat = own(scope);
      const [path, summarized] = await Promise.all([deps.reads.path(chat), deps.summarized(chat)]);
      if (path === null) throw new NoSuchChat(chat);
      return path.map((s, index) => ({ id: s.id, index, role: s.role, swipe: s.swipe, swipes: s.swipes, ...(s.hidden ? { hidden: true as const } : {}), ...(summarized.has(s.id) ? { summarized: true as const } : {}) }));
    },
    async find(scope, id): Promise<ChatMessage | null> {
      const chat = own(scope);
      const [path, found, readable, summarized, outside] = await Promise.all([deps.reads.path(chat), deps.reads.messagesById(chat, [id]), deps.hiddenReadable(chat), deps.summarized(chat), repliesAlone(chat)]);
      const message = found[0];
      const index = path?.findIndex((s) => s.id === id) ?? -1;
      return message === undefined || index < 0 ? null : shown(message, index, readable, summarized, outside);
    },
  };
}
