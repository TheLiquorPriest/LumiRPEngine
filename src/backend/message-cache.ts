// A chat's messages as the host last gave them (DESIGN §9.6). The host reads a chat one way only:
// every message with all its reasoning, so on a long chat one read moves a couple of hundred
// megabytes through the host and this process. A chat is read whole once, when it is first used, and
// a copy is kept per (chat, user), patched in place from everything that changes it:
// - the host's message events, each with the whole message as saved, or the id deleted;
// - the engine's own metadata writes, once the host has taken them.
//
// A generation changes the chat only through those events. Lumiverse saves its reply, and whatever a
// stop or an error leaves, with createMessage, updateMessage, updateSwipe, deleteSwipe or deleteMessage,
// each sending its MESSAGE_* event before GENERATION_ENDED or GENERATION_STOPPED (generate.service.ts
// on core 7524546f); what it writes beside them (reasoning, usage, metrics: `setSwipeScopedExtra`) is
// in `extra`, which the copy doesn't hold. The engine's own helper calls (`generate.quiet`) send no
// events at all. The host sends its events in the order it makes the changes, so a read in flight
// takes every change seen while it reads, replayed in order onto what it returns.
//
// So a chat is read again only when a change can't be applied in place (an event for a message the
// copy doesn't hold, a reply saved without its event, the host renaming the chat's user messages for
// a persona, which it tells only by CHAT_CHANGED), when the engine starts a chat over (`forget`), or
// after the memory budget let its copy go (`trim`). Lumiverse's rename across every chat
// (`bulkReattributeByPersonaName`) tells nothing at all: a copy keeps the old names until it is read again.

import type { ChatId, MessageId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { HostMessage, HostPort } from "./host";

/** How many copies are kept, by (chat, user): the open chat, and a few the user moved between. */
const CHATS_KEPT = 8;

/** A change to a chat's messages, made in place; false when it can't be. */
type Change = (list: HostMessage[]) => boolean;

interface Copy {
  chatId: ChatId;
  userId: UserId;
  messages: HostMessage[];
}

interface Reading {
  chatId: ChatId;
  userId: UserId;
  /** The changes seen since the read was asked for, replayed onto what it returns. */
  changes: Change[];
  /** The chat was forgotten while it read: it answers whoever waits on it, and isn't kept. */
  forgotten: boolean;
  messages: Promise<HostMessage[]>;
}

export class MessageCache {
  /** The host, its chat reads answered from the copy. */
  readonly host: HostPort;
  /** Copies by `user \0 chat`, the least recently used first. */
  private readonly copies = new Map<string, Copy>();
  /** Whole reads from the host under way, by `user \0 chat`: callers meanwhile share one. */
  private readonly reading = new Map<string, Reading>();
  /** Hears each whole read of a chat once it has landed (the memory budget looks then). */
  onRead: ((chatId: ChatId) => void) | null = null;

  constructor(private readonly inner: HostPort) {
    inner.on("MESSAGE_SENT", (e) => this.change(e.chatId, (list) => sent(list, e.message)));
    inner.on("MESSAGE_EDITED", (e) => this.change(e.chatId, (list) => replaced(list, e.message)));
    inner.on("MESSAGE_SWIPED", (e) => this.change(e.chatId, (list) => replaced(list, e.message)));
    inner.on("MESSAGE_DELETED", (e) => this.change(e.chatId, (list) => deleted(list, e.messageId)));
    // The host saved the reply (or what a failed one left) with its own message events, which came
    // first: a copy that doesn't hold the message missed one.
    inner.on("GENERATION_ENDED", (e) => {
      const saved = e.messageId;
      if (saved !== undefined) this.change(e.chatId, (list) => list.some((m) => m.id === saved));
    });
    inner.on("CHAT_DELETED", (e) => this.change(e.chatId, () => false));
    // A persona rename changes the names the copy holds: the next read is the host's. Any other
    // change of the chat's record changes no message.
    inner.on("CHAT_CHANGED", (e) => {
      if (e.renamed) this.change(e.chatId, () => false);
    });
    const chats: HostPort["chats"] = {
      ...inner.chats,
      messages: (chatId, userId) => this.messages(chatId, userId),
      writeMetadata: (chatId, messageId, bag, userId) => this.writeMetadata(chatId, messageId, bag, userId),
    };
    this.host = new Proxy(inner, {
      get: (target, prop) => {
        if (prop === "chats") return chats;
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  private async messages(chatId: ChatId, userId: UserId): Promise<HostMessage[]> {
    // One user's read never answers another's.
    const key = `${userId}\u0000${chatId}`;
    const copy = this.copies.get(key);
    if (copy) {
      this.keep(key, copy);
      return [...copy.messages];
    }
    const reading = this.reading.get(key) ?? this.read(key, chatId, userId);
    return [...(await reading.messages)];
  }

  /**
   * Reads the chat whole from the host. The changes seen meanwhile are replayed onto what it returns
   * (each event carries the message as saved, so one the read already holds changes nothing), and
   * that is kept; one that can't be applied leaves the read as the host gave it, kept for no one.
   */
  private read(key: string, chatId: ChatId, userId: UserId): Reading {
    const reading: Reading = { chatId, userId, changes: [], forgotten: false, messages: Promise.resolve([]) };
    reading.messages = this.inner.chats.messages(chatId, userId).then(
      (read) => {
        if (this.reading.get(key) === reading) this.reading.delete(key);
        const list = [...read];
        const whole = !reading.forgotten && reading.changes.every((change) => change(list));
        reading.changes.length = 0;
        if (whole) this.keep(key, { chatId, userId, messages: list });
        this.onRead?.(chatId);
        return whole ? list : read;
      },
      (error: unknown) => {
        if (this.reading.get(key) === reading) this.reading.delete(key);
        throw error;
      },
    );
    this.reading.set(key, reading);
    return reading;
  }

  /**
   * The engine's write lands in the copy once the host has taken it. Any event for the message that
   * comes before the answer was sent before the write and is applied first; the host's event for the
   * write itself comes after it, carrying what it stored.
   */
  private async writeMetadata(chatId: ChatId, messageId: MessageId, bag: JsonObject, userId: UserId): Promise<void> {
    try {
      await this.inner.chats.writeMetadata(chatId, messageId, bag, userId);
    } catch (error) {
      this.forget(chatId);
      throw error;
    }
    this.change(chatId, (list) => {
      const at = list.findIndex((m) => m.id === messageId);
      const now = list[at];
      if (!now) return false;
      list[at] = { ...now, metadata: structuredClone(bag) };
      return true;
    });
  }

  /** A change to a chat: made in each copy of it (one it can't be made in is dropped), and in each read of it under way. */
  private change(chatId: ChatId, apply: Change): void {
    for (const [key, copy] of this.copies) if (copy.chatId === chatId && !apply(copy.messages)) this.copies.delete(key);
    for (const reading of this.reading.values()) if (reading.chatId === chatId) reading.changes.push(apply);
  }

  /** Drops every copy of a chat's messages: the next read is the host's (a chat the engine starts over on). */
  forget(chatId: ChatId): void {
    for (const [key, copy] of this.copies) if (copy.chatId === chatId) this.copies.delete(key);
    for (const [key, reading] of this.reading) {
      if (reading.chatId !== chatId) continue;
      reading.forgotten = true;
      this.reading.delete(key);
    }
  }

  /** Lets go of the copies of the chats `inUse` doesn't name (the memory budget); a read under way is left to land. How many went. */
  trim(inUse: (chatId: ChatId) => boolean): number {
    let dropped = 0;
    for (const [key, copy] of this.copies) {
      if (inUse(copy.chatId)) continue;
      this.copies.delete(key);
      dropped++;
    }
    return dropped;
  }

  /** Each user's latest chat read: the newest of their copies. */
  latest(): Set<ChatId> {
    const last = new Map<UserId, ChatId>();
    for (const copy of this.copies.values()) last.set(copy.userId, copy.chatId);
    return new Set(last.values());
  }

  private keep(key: string, copy: Copy): void {
    this.copies.delete(key);
    this.copies.set(key, copy);
    for (const old of this.copies.keys()) {
      if (this.copies.size <= CHATS_KEPT) break;
      this.copies.delete(old);
    }
  }
}

/** A message sent: one already held is replaced; a new one is added only at the end, after every held one. */
function sent(list: HostMessage[], message: HostMessage): boolean {
  if (replaced(list, message)) return true;
  const last = list.at(-1);
  if (last && message.index <= last.index) return false;
  list.push(message);
  return true;
}

function replaced(list: HostMessage[], message: HostMessage): boolean {
  const at = list.findIndex((m) => m.id === message.id);
  if (at < 0) return false;
  list[at] = message;
  return true;
}

function deleted(list: HostMessage[], messageId: MessageId): boolean {
  const at = list.findIndex((m) => m.id === messageId);
  if (at >= 0) list.splice(at, 1);
  return true;
}
