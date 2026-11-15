// What Lumiverse tells RPE about the user's chats (STANDALONE-PLAN §4.2, §10.8): a generation ended and
// which message it saved, a message edited, deleted or swiped, a chat forked with the ids its messages
// were given. They come as events on the event socket (`socket.ts`), and the turn lane hears them through
// `ChatChanges`. An event can be missed (the socket was closed, RPE was down), so at a turn's start the
// turn lane asks `reconcile` what changed against what it knew: it finds the same changes in the
// database, and a missed event is never fatal.
//
// The events and their payloads (Lumiverse's `src/`): `GENERATION_STARTED` `{generationId, chatId, …}`
// (`services/generate.service.ts:2040-2054`); `GENERATION_ENDED` `{generationId, chatId,
// messageId, …}`, with `error` when it failed and no `messageId` when it failed before writing
// (`:4289-4306`, `:4565-4583`, `:3038-3050`); `GENERATION_STOPPED`
// `{generationId, chatId, content}` (`:3013-3021`, `:4528-4536`); `MESSAGE_EDITED` `{chatId, message}`,
// for a hidden mark too (`services/chats.service.ts:1551`, `:3131`); `MESSAGE_DELETED` `{chatId,
// messageId}` (`:3205`, `:3255`); `MESSAGE_SWIPED` `{chatId, message, action, swipeId}` (`:3331`,
// `:3369`, `:3439`, `:3478`); `CHAT_FORKED` `{sourceChatId, forkedChatId, messageIdMap}` (`:3604-3616`).
// A message an event carries is read as RPE reads a row (`rows.ts` `messageFrom`), so its showing
// swipe's date and hash are the ones a comparison of the chat's rows finds.

import { isRecord } from "../../shared/json";
import type { LumiverseReads, LvStep } from "./reads";
import { type LvMessage, messageFrom } from "./rows";
import type { LumiverseSocket } from "./socket";
import type { TagLore } from "./wire";

/** A message's showing swipe as a change gives it: its date as `swipe_dates` holds it, and the hash of its text (`messageFrom`). */
export type ShownSwipe = LvMessage["shown"];

export type ChatChange =
  /** A generation began in the chat, on the model Lumiverse names: Lumiverse's own writes to the chat's messages for it come until its end is told. */
  | { kind: "generation-started"; chat: string; generation: string; model: string | null }
  /** A generation is over. `message`: the message it saved to; null when it saved none (it failed before writing, or the event did not say). */
  | { kind: "generation-ended"; chat: string; generation: string; message: string | null; error?: string; stopped?: true }
  /** A message's text, its hidden mark or its `extra` changed in the swipe it shows: its hidden mark and that swipe, as they are now. */
  | { kind: "message-edited"; chat: string; message: string; hidden: boolean; shown: ShownSwipe }
  | { kind: "message-deleted"; chat: string; message: string }
  /**
   * A message shows another swipe, gained or lost one, or had a swipe's text written: `swipe` is the one it shows now, `shown` that
   * swipe as it is now; `updated` where the swipe written is the one it shows.
   */
  | { kind: "message-swiped"; chat: string; message: string; swipe: number; shown: ShownSwipe; updated?: true }
  /** `chat` was made from `from`, each message of `from` up to the fork given a new id: old id to new. */
  | { kind: "chat-forked"; from: string; chat: string; ids: Record<string, string> }
  /**
   * Lumiverse's own list of the lore that activated for the chat's running generation (`WORLD_INFO_ACTIVATED` `{chatId, entries,
   * stats}`, sent after the interceptors and before the provider is called, and only when something activated,
   * `generate.service.ts:2868-2879`): the turn's activated lore. None heard is none activated.
   */
  | { kind: "lore-activated"; chat: string; lore: TagLore[] };

/** What the turn lane implements to hear Lumiverse's changes. */
export interface ChatChanges {
  changed(change: ChatChange): void;
  /** The event socket opened again after it was closed: events may have been missed meanwhile. */
  reopened(): void;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** One event as a change; null for an event that is none of these, or that names no chat. */
export function changeOf(event: string, payload: unknown): ChatChange | null {
  if (!isRecord(payload)) return null;
  const message = isRecord(payload.message) ? payload.message : null;
  switch (event) {
    case "GENERATION_ENDED":
    case "GENERATION_STOPPED": {
      const chat = str(payload.chatId);
      const generation = str(payload.generationId);
      if (chat === null || generation === null) return null;
      const error = str(payload.error);
      return { kind: "generation-ended", chat, generation, message: str(payload.messageId), ...(error !== null ? { error } : {}), ...(event === "GENERATION_STOPPED" ? { stopped: true as const } : {}) };
    }
    case "GENERATION_STARTED": {
      const chat = str(payload.chatId);
      const generation = str(payload.generationId);
      return chat === null || generation === null ? null : { kind: "generation-started", chat, generation, model: str(payload.model) };
    }
    case "MESSAGE_EDITED": {
      const chat = str(payload.chatId) ?? str(message?.chat_id);
      if (chat === null || message === null || str(message.id) === null) return null;
      const m = messageFrom(message);
      return { kind: "message-edited", chat, message: m.id, hidden: m.hidden, shown: m.shown };
    }
    case "MESSAGE_DELETED": {
      const chat = str(payload.chatId);
      const id = str(payload.messageId);
      return chat === null || id === null ? null : { kind: "message-deleted", chat, message: id };
    }
    case "MESSAGE_SWIPED": {
      const chat = str(payload.chatId);
      if (chat === null || message === null || str(message.id) === null || typeof message.swipe_id !== "number") return null;
      const m = messageFrom(message);
      // A swipe's text written (`updateSwipe`, `action: "updated"`) is an edit of what shows only where the swipe written is the one shown.
      const updated = payload.action === "updated" && payload.swipeId === m.swipe;
      return { kind: "message-swiped", chat, message: m.id, swipe: m.swipe, shown: m.shown, ...(updated ? { updated: true as const } : {}) };
    }
    case "CHAT_FORKED": {
      const from = str(payload.sourceChatId);
      const chat = str(payload.forkedChatId);
      if (from === null || chat === null || !isRecord(payload.messageIdMap)) return null;
      const ids: Record<string, string> = {};
      for (const [old, made] of Object.entries(payload.messageIdMap)) if (typeof made === "string") ids[old] = made;
      return { kind: "chat-forked", from, chat, ids };
    }
    case "WORLD_INFO_ACTIVATED": {
      const chat = str(payload.chatId);
      if (chat === null) return null;
      const lore: TagLore[] = [];
      for (const e of Array.isArray(payload.entries) ? payload.entries : []) {
        if (!isRecord(e) || typeof e.id !== "string") continue;
        lore.push({ id: e.id, book: str(e.bookId), title: typeof e.comment === "string" ? e.comment : "", how: str(e.source) });
      }
      return { kind: "lore-activated", chat, lore };
    }
    default:
      return null;
  }
}

/** Hands every change the event socket hears to the turn lane, and says when the socket opened again. Returns the unsubscribe. */
export function followChanges(socket: LumiverseSocket, sink: ChatChanges): () => void {
  let opened = false;
  const offEvent = socket.onEvent((event, payload) => {
    const change = changeOf(event, payload);
    if (change !== null) sink.changed(change);
  });
  const offOpen = socket.onOpen(() => {
    if (opened) sink.reopened();
    opened = true;
  });
  return () => {
    offEvent();
    offOpen();
  };
}

/** A message as RPE last saw it, enough to tell what has changed since. */
export interface KnownMessage {
  id: string;
  swipe: number;
  swipes: number;
  /** The hash of its showing swipe's saved text, as RPE's store and the importer give it (`LvMessage.shown`). */
  hash: string;
  hidden: boolean;
}

export function knownOf(m: LvStep): KnownMessage {
  return { id: m.id, swipe: m.swipe, swipes: m.swipes, hash: m.shown.hash, hidden: m.hidden };
}

/** What the turn lane knew of a chat: the messages its turns are tied to, and the generations it played whose end it has not heard. */
export interface KnownChat {
  chat: string;
  messages: readonly KnownMessage[];
  /** `message`: the message the generation was to save to (the tag's target); null where Lumiverse named none. */
  awaiting: readonly { generation: string; message: string | null }[];
}

/**
 * The changes to a chat since what the turn lane knew, found in Lumiverse's rows, as the events would
 * have told them. Called at a turn's start: Lumiverse runs one generation per chat and stops the one
 * before when a new one starts (`services/generate.service.ts:1601-1651`), so every generation awaited
 * has ended, and saved to its target where that message is there.
 */
export async function reconcile(reads: LumiverseReads, known: KnownChat): Promise<ChatChange[]> {
  const ids = [...new Set([...known.messages.map((m) => m.id), ...known.awaiting.flatMap((a) => (a.message === null ? [] : [a.message]))])];
  const now = new Map((await reads.messagesById(known.chat, ids)).map((m) => [m.id, m]));
  const changes: ChatChange[] = [];
  for (const a of known.awaiting) changes.push({ kind: "generation-ended", chat: known.chat, generation: a.generation, message: a.message !== null && now.has(a.message) ? a.message : null });
  for (const k of known.messages) {
    const m = now.get(k.id);
    if (m === undefined) changes.push({ kind: "message-deleted", chat: known.chat, message: k.id });
    else if (m.swipe !== k.swipe || m.swipes !== k.swipes) changes.push({ kind: "message-swiped", chat: known.chat, message: k.id, swipe: m.swipe, shown: m.shown });
    else if (m.hidden !== k.hidden || m.shown.hash !== k.hash) changes.push({ kind: "message-edited", chat: known.chat, message: k.id, hidden: m.hidden, shown: m.shown });
  }
  return changes;
}

/**
 * The fork a chat RPE has never seen was made by, found in Lumiverse's rows: a branch keeps the chat it
 * came from and the message it was made at in its metadata (`branched_from`, `branch_at_message`), and
 * copies every message up to that one, in order, each at its own place (`services/chats.service.ts:
 * 3540-3576`). Null for a chat that is no fork, or whose source is gone.
 */
export async function forkOf(reads: LumiverseReads, chat: string): Promise<Extract<ChatChange, { kind: "chat-forked" }> | null> {
  const made = await reads.chat(chat);
  const from = made === null ? null : str(made.metadata.branched_from);
  const at = made === null ? null : str(made.metadata.branch_at_message);
  if (from === null || at === null) return null;
  const [source, copy] = await Promise.all([reads.path(from), reads.path(chat)]);
  const atStep = source?.find((s) => s.id === at);
  if (source === null || copy === null || atStep === undefined) return null;
  // Paired by place: each copied message kept the place its original had.
  const copies = new Map<number, string[]>();
  for (const s of copy) if (s.index <= atStep.index) copies.set(s.index, [...(copies.get(s.index) ?? []), s.id]);
  const ids: Record<string, string> = {};
  for (const s of source) {
    if (s.index > atStep.index) continue;
    const next = copies.get(s.index)?.shift();
    if (next !== undefined) ids[s.id] = next;
  }
  return { kind: "chat-forked", from, chat, ids };
}
