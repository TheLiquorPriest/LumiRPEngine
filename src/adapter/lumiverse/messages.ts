// A chat's messages, read for a page (`GET /api/v1/chats/:chat/messages`, STANDALONE-PLAN §4.2): by a list of ids, or by a stretch of the
// places Lumiverse numbers them with (`index_in_chat`, a gap where a message was deleted and all), through the door's reads and what they
// hold, on either road. Only the rows of the user RPE belongs to are read: another user's chat is none. Hidden messages are listed and
// marked, since the page is the owner's own.

import type { LumiverseReads } from "./reads";
import type { LvMessage } from "./rows";

export const CHAT_MESSAGES_PATH = "/api/v1/chats/:chat/messages";

/** One message as the page reads it. */
export interface MessageShown {
  id: string;
  chat: string;
  /** Lumiverse's `index_in_chat`. */
  index: number;
  role: LvMessage["role"];
  name: string;
  /** The text the prompt is built from. */
  text: string;
  /** The swipe it shows, and how many it has. */
  swipe: number;
  swipes: number;
  hidden: boolean;
  /** When it was sent, in milliseconds. */
  sentAt: number;
  revision: number;
}

/** What a page asks for: these ids, or the messages whose `index_in_chat` is from `from` up to but not including `to`. */
export type MessagesAsk = { ids: readonly string[] } | { from: number; to: number };

/** The messages asked for, in the chat's order; null when the user has no such chat. An id that is not the chat's is left out. */
export async function readMessages(reads: LumiverseReads, chat: string, ask: MessagesAsk): Promise<MessageShown[] | null> {
  const path = await reads.path(chat);
  if (path === null) return null;
  const wanted = "ids" in ask ? ask.ids : path.filter((s) => s.index >= ask.from && s.index < ask.to).map((s) => s.id);
  const found = await reads.messagesById(chat, wanted);
  const places = new Map(path.map((s, place) => [s.id, place] as const));
  return found
    .sort((a, b) => (places.get(a.id) ?? 0) - (places.get(b.id) ?? 0))
    .map((m): MessageShown => ({ id: m.id, chat: m.chat, index: m.index, role: m.role, name: m.name, text: m.text, swipe: m.swipe, swipes: m.swipes, hidden: m.hidden, sentAt: m.sentAt, revision: m.revision }));
}
