// RPH's chat port over Lumiverse's chats (STANDALONE-PLAN §4.2, §6.8 `chat_read`): a chat's length and
// any stretch of its messages, whether or not the history window kept them in the prompt; the chat's
// path listed without text; and one message found by its id. A message the user hid from the prompt in
// Lumiverse is listed and marked, and its text is left out unless the chat's setting lets agents read
// hidden messages (§4.2, "Hidden messages"). Search is not here yet: it comes with the search index.
//
// A message's place on the path counts from 0 at the chat's first message, in Lumiverse's order; it is
// not Lumiverse's `index_in_chat`, which keeps a gap where a message was deleted.

import type { ChatInfo, ChatMessage, ChatPort, ChatRole, HistoryRange, Scope } from "rp-harness/contract";
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
}

/** The chat port as RPE gives it now: `search` comes with the search index (it is RPH's `ChatPort` less that one call). */
export interface ChatReads extends Omit<ChatPort, "search"> {
  /** Every message of the chat's path, in order, with no text. */
  list(scope: Scope): Promise<ChatStep[]>;
  /** One message of the chat, by Lumiverse's id; null when the chat has none such. */
  find(scope: Scope, id: string): Promise<ChatMessage | null>;
}

export interface ChatDeps {
  reads: LumiverseReads;
  /** The Lumiverse user this RPE belongs to: no other user's chat is read. */
  user: string;
  /** The chat's setting: agents may read the messages the user hid from the prompt (off unless the user turns it on). */
  hiddenReadable(chat: string): Promise<boolean>;
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

  const shown = (m: LvMessage, index: number, readable: boolean): ChatMessage => ({
    id: m.id,
    index,
    role: m.role,
    name: m.name,
    ...(m.hidden ? { hidden: true as const } : {}),
    ...(!m.hidden || readable ? { text: m.text } : {}),
    at: m.sentAt,
  });

  return {
    async info(scope): Promise<ChatInfo> {
      const chat = own(scope);
      const [path, hiddenReadable] = await Promise.all([deps.reads.path(chat), deps.hiddenReadable(chat)]);
      if (path === null) throw new NoSuchChat(chat);
      // RPE names no stretch of a chat yet: the scene's comes with the story record.
      return { length: path.length, hiddenReadable, ranges: {} };
    },
    async read(scope, range: HistoryRange): Promise<ChatMessage[]> {
      const chat = own(scope);
      const from = Math.max(0, Math.floor(range.from));
      if (range.to <= from) return [];
      const [messages, readable] = await Promise.all([deps.reads.messages(chat, { from, to: range.to }), deps.hiddenReadable(chat)]);
      return messages.map((m, i) => shown(m, from + i, readable));
    },
    async list(scope): Promise<ChatStep[]> {
      const chat = own(scope);
      const path = await deps.reads.path(chat);
      if (path === null) throw new NoSuchChat(chat);
      return path.map((s, index) => ({ id: s.id, index, role: s.role, swipe: s.swipe, swipes: s.swipes, ...(s.hidden ? { hidden: true as const } : {}) }));
    },
    async find(scope, id): Promise<ChatMessage | null> {
      const chat = own(scope);
      const [path, found, readable] = await Promise.all([deps.reads.path(chat), deps.reads.messagesById(chat, [id]), deps.hiddenReadable(chat)]);
      const message = found[0];
      const index = path?.findIndex((s) => s.id === id) ?? -1;
      return message === undefined || index < 0 ? null : shown(message, index, readable);
    },
  };
}
