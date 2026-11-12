// A chat's messages as the agents outside a turn and the story's pages read them: the prepared
// start's tools, the reader of a job's run (`outsideReader`), the story record such a run reads, and
// the preparation's page. Read once through the engine's host and kept, with what is worked out of
// them (each message by its number, how many are the player's, the chat's size in tokens), so the
// next call and the next agent of the same chat read none of it again.
//
// A kept read ends the moment the chat changes, by the host's own events: a message sent, edited,
// swiped or deleted, a reply saved, the chat deleted, or its user messages renamed for a persona. A
// read under way when one comes answers the call that asked for it and is kept for no one. Where the
// host keeps the chat itself (the engine's: `MessageCache`), its stamp of the chat is checked too, so
// the engine's own writes, which it holds before their events come, end it as well. And none is kept
// longer than the user's setting (Settings → Agents → Kept in memory → "Chat kept for its agents");
// at 0 every read asks the host. What a turn's own steps read of the chat is not this.

import type { ChatId, UserId } from "../shared/ids";
import type { HostMessage, HostPort } from "./host";

/** A chat as it was read, with what is worked out of it. */
export interface ChatRead {
  /** Its messages, in the chat's order. */
  readonly messages: readonly HostMessage[];
  /** Each message by its number (`#12`). */
  readonly numbered: ReadonlyMap<number, HostMessage>;
  /** How many of them are the player's. */
  readonly players: number;
  /** The chat's size in tokens, each message as `count` reckons it: counted the first time it is asked, and kept with the read. */
  tokens(count: (text: string) => number): number;
}

/** A host whose chats are read: the engine's, or a test's. */
export type ReadHost = Pick<HostPort, "chats" | "on">;

interface Held {
  chatId: ChatId;
  read: Promise<ChatRead>;
  /** When it was asked for, and until when it is kept, by the clock it was read on. */
  at: number;
  until: number;
  /** The host's stamp of the chat the read stands for: undefined while it is under way, null where the host gave none. */
  stamp: number | null | undefined;
}

function readOf(messages: readonly HostMessage[]): ChatRead {
  const counted = new Map<(text: string) => number, number>();
  return {
    messages,
    numbered: new Map(messages.map((m) => [m.index, m])),
    players: messages.filter((m) => m.isUser).length,
    tokens(count) {
      let total = counted.get(count);
      if (total === undefined) {
        total = messages.reduce((sum, m) => sum + count(m.content), 0);
        counted.set(count, total);
      }
      return total;
    },
  };
}

class ChatReads {
  /** The reads kept and under way, by `user \0 chat`. */
  private readonly held = new Map<string, Held>();

  constructor(
    private readonly host: ReadHost,
    private readonly now: () => number,
  ) {
    const end = (chatId: ChatId): void => {
      for (const [key, held] of this.held) if (held.chatId === chatId) this.held.delete(key);
    };
    host.on("MESSAGE_SENT", (e) => end(e.chatId));
    host.on("MESSAGE_EDITED", (e) => end(e.chatId));
    host.on("MESSAGE_SWIPED", (e) => end(e.chatId));
    host.on("MESSAGE_DELETED", (e) => end(e.chatId));
    host.on("GENERATION_ENDED", (e) => end(e.chatId));
    host.on("CHAT_DELETED", (e) => end(e.chatId));
    host.on("CHAT_CHANGED", (e) => {
      if (e.renamed) end(e.chatId);
    });
  }

  read(chatId: ChatId, userId: UserId, keepMs: number): Promise<ChatRead> {
    const now = this.now();
    for (const [key, held] of this.held) if (held.until <= now) this.held.delete(key);
    const key = `${userId}\u0000${chatId}`;
    const { chats } = this.host;
    const kept = this.held.get(key);
    if (kept && now - kept.at < keepMs && (kept.stamp === undefined || chats.stamp === undefined || chats.stamp(chatId, userId) === kept.stamp)) return kept.read;
    // The stamp as the read is asked for: a change that lands while it reads moves it, and the read is then kept for no later call. A host that holds no copy yet makes one by this read.
    const before = chats.stamp?.(chatId, userId) ?? null;
    const read = chats.messages(chatId, userId).then((messages) => {
      held.stamp = before ?? chats.stamp?.(chatId, userId) ?? null;
      return readOf(messages);
    });
    const held: Held = { chatId, read, at: now, until: now + keepMs, stamp: undefined };
    if (keepMs <= 0) return held.read;
    this.held.set(key, held);
    // A read that failed is asked again by the next call, not kept as the answer.
    held.read.catch(() => {
      if (this.held.get(key) === held) this.held.delete(key);
    });
    return held.read;
  }
}

const READS = new WeakMap<ReadHost, ChatReads>();

/**
 * The chat as it stands, read through `host` (the engine's own, `Runtime.host`) or kept from the
 * last read of it, kept no longer than `keepMs` (the user's `agents.kept.chatMs`; 0 keeps none).
 */
export function chatRead(host: ReadHost, at: { chatId: ChatId; userId: UserId }, keepMs: number): Promise<ChatRead> {
  let reads = READS.get(host);
  if (!reads) READS.set(host, (reads = new ChatReads(host, () => Date.now())));
  return reads.read(at.chatId, at.userId, keepMs);
}
