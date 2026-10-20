// A chat's messages as the host last gave them (DESIGN §9.6). The host reads a chat one way only:
// every message, with all its reasoning, so on a long chat one read moves hundreds of megabytes and
// takes seconds, and every request and every step of a turn reads the chat. The copy is kept per
// chat and patched from the message events the host sends for each change and from the engine's
// own writes. It is read afresh when an event can't be applied in place, after each generation
// (the host saves its reply itself), and for a chat it doesn't hold.

import type { ChatId, MessageId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { HostMessage, HostPort } from "./host";

/** How many chats' messages are kept: the open one, and a few the user moved between. */
const CHATS_KEPT = 8;

interface Kept {
  userId: UserId;
  messages: HostMessage[];
}

interface Reading {
  userId: UserId;
  /** The chat's change count when the read started: a read a change overtook is never kept, nor shared. */
  since: number;
  messages: Promise<HostMessage[]>;
}

export class MessageCache {
  /** The host, its chat reads answered from the copy. */
  readonly host: HostPort;
  private readonly kept = new Map<ChatId, Kept>();
  /** Every change seen per chat (an event, a write, an append), counted. */
  private readonly changes = new Map<ChatId, number>();
  private readonly reading = new Map<ChatId, Reading>();

  constructor(private readonly inner: HostPort) {
    inner.on("MESSAGE_SENT", (e) => this.change(e.chatId, (list) => sent(list, e.message)));
    inner.on("MESSAGE_EDITED", (e) => this.change(e.chatId, (list) => replaced(list, e.message)));
    inner.on("MESSAGE_SWIPED", (e) => this.change(e.chatId, (list) => replaced(list, e.message)));
    inner.on("MESSAGE_DELETED", (e) => this.change(e.chatId, (list) => deleted(list, e.messageId)));
    // The host saves a generation's reply and its reasoning itself: the chat is read afresh after one.
    inner.on("GENERATION_ENDED", (e) => this.change(e.chatId, () => false));
    inner.on("GENERATION_STOPPED", (e) => this.change(e.chatId, () => false));
    inner.on("CHAT_DELETED", (e) => this.change(e.chatId, () => false));
    const chats: HostPort["chats"] = {
      ...inner.chats,
      messages: (chatId, userId) => this.messages(chatId, userId),
      writeMetadata: (chatId, messageId, bag, userId) => this.writeMetadata(chatId, messageId, bag, userId),
      appendUserMessage: (chatId, content, metadata, triggerGeneration, userId) => this.append(chatId, content, metadata, triggerGeneration, userId),
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
    const kept = this.kept.get(chatId);
    if (kept) {
      if (kept.userId !== userId) return this.inner.chats.messages(chatId, userId);
      this.keep(chatId, kept);
      return [...kept.messages];
    }
    const since = this.count(chatId);
    let reading = this.reading.get(chatId);
    if (!reading || reading.since !== since || reading.userId !== userId) {
      const started: Reading = { userId, since, messages: this.inner.chats.messages(chatId, userId) };
      this.reading.set(chatId, started);
      // Kept (when no change overtook it) before any caller resumes; a failed read fails its callers only.
      void started.messages
        .then(
          (read) => {
            if (this.count(chatId) === since) this.keep(chatId, { userId, messages: [...read] });
          },
          () => undefined,
        )
        .finally(() => {
          if (this.reading.get(chatId) === started) this.reading.delete(chatId);
        });
      reading = started;
    }
    return [...(await reading.messages)];
  }

  private async writeMetadata(chatId: ChatId, messageId: MessageId, bag: JsonObject, userId: UserId): Promise<void> {
    const before = this.bump(chatId);
    try {
      await this.inner.chats.writeMetadata(chatId, messageId, bag, userId);
    } catch (error) {
      this.forget(chatId);
      throw error;
    }
    const after = this.count(chatId);
    this.bump(chatId);
    const kept = this.kept.get(chatId);
    const at = kept ? kept.messages.findIndex((m) => m.id === messageId) : -1;
    const now = kept?.messages[at];
    if (!kept || !now) {
      this.kept.delete(chatId);
      return;
    }
    // Nothing else changed the chat meanwhile: the copy takes what was written. Something did (the
    // host's own MESSAGE_EDITED for it, usually): the copy stands if it holds this write.
    if (after === before) kept.messages[at] = { ...now, metadata: structuredClone(bag) };
    else if (JSON.stringify(now.metadata) !== JSON.stringify(bag)) this.kept.delete(chatId);
  }

  private async append(chatId: ChatId, content: string, metadata: JsonObject, triggerGeneration: boolean, userId: UserId): Promise<MessageId> {
    this.bump(chatId);
    const id = await this.inner.chats.appendUserMessage(chatId, content, metadata, triggerGeneration, userId).finally(() => this.bump(chatId));
    // The host's MESSAGE_SENT for it adds it to the copy; until it does, the chat is read afresh.
    if (!this.kept.get(chatId)?.messages.some((m) => m.id === id)) this.kept.delete(chatId);
    return id;
  }

  /** A change to a chat: applied to the copy in place, or (`apply` can't) the copy is dropped. */
  private change(chatId: ChatId, apply: (list: HostMessage[]) => boolean): void {
    this.bump(chatId);
    const kept = this.kept.get(chatId);
    if (kept && !apply(kept.messages)) this.kept.delete(chatId);
  }

  /** Drops the copy of a chat's messages: the next read is the host's (a chat the engine starts over on). */
  forget(chatId: ChatId): void {
    this.kept.delete(chatId);
    this.bump(chatId);
  }

  private keep(chatId: ChatId, kept: Kept): void {
    this.kept.delete(chatId);
    this.kept.set(chatId, kept);
    for (const id of this.kept.keys()) {
      if (this.kept.size <= CHATS_KEPT) break;
      this.kept.delete(id);
    }
  }

  private count(chatId: ChatId): number {
    return this.changes.get(chatId) ?? 0;
  }

  private bump(chatId: ChatId): number {
    const next = this.count(chatId) + 1;
    this.changes.set(chatId, next);
    return next;
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
