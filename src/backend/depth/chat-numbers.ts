// How the chat numbers its messages: each by `index_in_chat`, the #N the chat shows it with (from 0),
// which a message deleted before it never renumbers. Every depth view (GM → Depth's Turn, Drafts,
// Treatments, Notebook and Archive, GM → Minds, the bootstrap's spot check) names a message by it, so
// "message 8" is the chat's #8 wherever it is read.

import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { HostMessage } from "../host";

/** What the numbers are read of: the chat's messages, each with its number. */
export interface ChatNumbersHost {
  chats: { messages(chatId: ChatId, userId: UserId): Promise<readonly Pick<HostMessage, "id" | "index">[]> };
}

/** Each of the chat's messages by the number the chat shows it with. */
export async function chatNumbers(host: ChatNumbersHost, chatId: ChatId, userId: UserId): Promise<Map<MessageId, number>> {
  return new Map((await host.chats.messages(chatId, userId)).map((m) => [m.id, m.index]));
}

/** The chain's messages (`ids`, in order) by the chat's number, each the chat no longer lists by its place on the chain (from 0). */
export async function chainNumbers(host: ChatNumbersHost, chatId: ChatId, userId: UserId, ids: readonly MessageId[]): Promise<Map<MessageId, number>> {
  const numbers = await chatNumbers(host, chatId, userId);
  return new Map(ids.map((id, i) => [id, numbers.get(id) ?? i]));
}
