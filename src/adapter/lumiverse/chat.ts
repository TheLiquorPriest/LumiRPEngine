// RPH's chat port over Lumiverse's chats (STANDALONE-PLAN §4.2, §6.8 `chat_read`, `chat_search`): a
// chat's length and any stretch of its messages, whether or not the history window kept them in the
// prompt; a search of its messages by their words; the chat's path listed without text; and one
// message found by its id. A message the user hid from the prompt in Lumiverse is listed and marked,
// and its text is left out, of a read and of a search, unless the chat's setting lets agents read
// hidden messages (§4.2, "Hidden messages"). A message Lumiverse's own memory stands in for with a
// summary is marked as such (§4.2: "The turn's files mark a summary as a summary").
//
// A message's place on the path counts from 0 at the chat's first message, in Lumiverse's order; it is
// not Lumiverse's `index_in_chat`, which keeps a gap where a message was deleted.
//
// The search reads the messages where they are, in Lumiverse's rows, as everything here does (§4.2,
// "No copy"): a message is found when every word asked for begins one of its words, in any letter
// case; hits come oldest first. Search by meaning is not here.

import type { ChatHit, ChatInfo, ChatMessage, ChatPort, ChatQuery, ChatRole, HistoryRange, Scope } from "rp-harness/contract";
import type { LumiverseReads } from "./reads";
import type { LvMessage } from "./rows";

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
}

export interface ChatSearchSettings {
  /** The most hits a search gives when the query names no limit. */
  limit: number;
  /** How long a hit's snippet is, in characters. */
  snippetChars: number;
}

/** Defaults: as many hits as a lore search gives, and a snippet of a line's length (`src/lore/lore.ts`, `LORE_DEFAULTS`). */
export const CHAT_SEARCH_DEFAULTS: ChatSearchSettings = { limit: 20, snippetChars: 80 };

export interface ChatDeps {
  reads: LumiverseReads;
  /** The Lumiverse user this RPE belongs to: no other user's chat is read. */
  user: string;
  /** The chat's setting: agents may read the messages the user hid from the prompt (off unless the user turns it on). */
  hiddenReadable(chat: string): Promise<boolean>;
  /** The stretches the chat names, by name (the story record's: `scene`, the stretch since the scene opened, §5.4). */
  ranges(chat: string): Promise<Record<string, HistoryRange>>;
  /** The messages Lumiverse's memory stands in for with a summary in the chat's prompt (the turn lane's, from the tag's `summary` marks). */
  summarized(chat: string): Promise<ReadonlySet<string>>;
  search?: Partial<ChatSearchSettings>;
}

/** Why a chat cannot be read, in words an agent and the user can read. */
export class NoSuchChat extends Error {
  constructor(chat: string) {
    super(`There is no chat ${chat} for this RPE's Lumiverse user.`);
    this.name = "NoSuchChat";
  }
}

/** A text's words as the search reads them: runs of letters and digits, in lower case, each with where it starts. */
function wordsOf(text: string): { word: string; at: number }[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ word: m[0].toLowerCase(), at: m.index }));
}

/** Where the first word of the text that a wanted word begins sits; null unless every wanted word begins one of its words. */
function matchAt(text: string, wanted: readonly string[]): number | null {
  const words = wordsOf(text);
  let first: number | null = null;
  for (const w of wanted) {
    const found = words.find((x) => x.word.startsWith(w));
    if (found === undefined) return null;
    first = first === null ? found.at : Math.min(first, found.at);
  }
  return first;
}

/** About `chars` characters of the text around `at`, on one line, with "…" where it was cut. */
function snippetOf(text: string, at: number, chars: number): string {
  const start = Math.max(0, Math.min(at - Math.floor(chars / 4), text.length - chars));
  const end = Math.min(text.length, start + chars);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

export function createChatReads(deps: ChatDeps): ChatReads {
  const settings = { ...CHAT_SEARCH_DEFAULTS, ...deps.search };
  const own = (scope: Scope): string => {
    if (scope.user !== deps.user) throw new NoSuchChat(scope.chat);
    return scope.chat;
  };

  const shown = (m: LvMessage, index: number, readable: boolean, summarized: ReadonlySet<string>): ChatMessage => ({
    id: m.id,
    index,
    role: m.role,
    name: m.name,
    ...(!m.hidden || readable ? { text: m.text } : {}),
    ...(m.hidden ? { hidden: true as const } : {}),
    ...(summarized.has(m.id) ? { summarized: true as const } : {}),
    at: m.sentAt,
  });

  return {
    async info(scope): Promise<ChatInfo> {
      const chat = own(scope);
      const [path, hiddenReadable, ranges] = await Promise.all([deps.reads.path(chat), deps.hiddenReadable(chat), deps.ranges(chat)]);
      if (path === null) throw new NoSuchChat(chat);
      return { length: path.length, hiddenReadable, ranges };
    },
    async read(scope, range: HistoryRange): Promise<ChatMessage[]> {
      const chat = own(scope);
      const from = Math.max(0, Math.floor(range.from));
      if (range.to <= from) return [];
      const [messages, readable, summarized] = await Promise.all([deps.reads.messages(chat, { from, to: range.to }), deps.hiddenReadable(chat), deps.summarized(chat)]);
      return messages.map((m, i) => shown(m, from + i, readable, summarized));
    },
    async search(scope, query: ChatQuery): Promise<ChatHit[]> {
      const chat = own(scope);
      const wanted = [...new Set(wordsOf(query.text).map((w) => w.word))];
      const limit = Math.max(0, Math.floor(query.limit ?? settings.limit));
      if (wanted.length === 0 || limit === 0) return [];
      const path = await deps.reads.path(chat);
      if (path === null) throw new NoSuchChat(chat);
      const from = Math.max(0, Math.floor(query.within?.from ?? 0));
      const to = Math.min(path.length, query.within?.to ?? path.length);
      if (to <= from) return [];
      const [messages, readable] = await Promise.all([deps.reads.messages(chat, { from, to }), deps.hiddenReadable(chat)]);
      const hits: ChatHit[] = [];
      for (const [i, m] of messages.entries()) {
        if (m.hidden && !readable) continue;
        const at = matchAt(m.text, wanted);
        if (at === null) continue;
        hits.push({ id: m.id, index: from + i, role: m.role, name: m.name, snippet: snippetOf(m.text, at, settings.snippetChars), how: "words" });
        if (hits.length >= limit) break;
      }
      return hits;
    },
    async list(scope): Promise<ChatStep[]> {
      const chat = own(scope);
      const [path, summarized] = await Promise.all([deps.reads.path(chat), deps.summarized(chat)]);
      if (path === null) throw new NoSuchChat(chat);
      return path.map((s, index) => ({ id: s.id, index, role: s.role, swipe: s.swipe, swipes: s.swipes, ...(s.hidden ? { hidden: true as const } : {}), ...(summarized.has(s.id) ? { summarized: true as const } : {}) }));
    },
    async find(scope, id): Promise<ChatMessage | null> {
      const chat = own(scope);
      const [path, found, readable, summarized] = await Promise.all([deps.reads.path(chat), deps.reads.messagesById(chat, [id]), deps.hiddenReadable(chat), deps.summarized(chat)]);
      const message = found[0];
      const index = path?.findIndex((s) => s.id === id) ?? -1;
      return message === undefined || index < 0 ? null : shown(message, index, readable, summarized);
    },
  };
}
