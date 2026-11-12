// Lumiverse's own rows behind the fake host's chats (fake-host.ts), as its database keeps them, and
// the shapes Lumiverse sends them in: its HTTP routes' answers (a chat's row; its messages by page,
// lean or whole, and by tail), its events' payloads, and what Spindle hands an extension of a message
// (`chat.getMessages`, as LumiAH's own host reads it). A LumiAH mounted in the engine reads a chat two
// ways: through its backend's host, over the link (lumiah-bed.ts), and through the runtime's own copy,
// over Lumiverse's routes as the runtime's user (runtime-bed.ts). Both read these rows, so the two
// roads can't drift apart.
//
// Every change the fake host tells the engine of is told here too, as the event Lumiverse sends for
// it, made of the rows as they stood the moment it was sent (`FakeHost.taps`). So are the two that
// Lumiverse tells every extension of while the engine's port hears nothing of them: a chat's own
// record written (its metadata: `chats.mergeChatMetadata`), and a message's swipes rewritten whole
// (SWIPE_EDITED, after the edit's own event). A branch is told of nowhere, as the fake host makes one
// silently: a new chat is read whole the first time it is wanted, so nothing is missed. A message's
// revision and a chat's stamp move on with every change, as Lumiverse's do, so an event that comes
// after a newer read is known for the older one it is.
//
// The fake keeps no clock: a message's `send_date` and `created_at` are 0, which every reader of
// Lumiverse's rows takes as no time, on either road. The mappers follow Lumiverse's own (`rowToChat`,
// `rowToMessage` and its lean form, `parsePagination` and `paginatedQuery`, the tail route,
// `diffChatChangedFields`, Spindle's reshape of a message).

import type { HostChat, HostMessage } from "lumi-ah/extension/backend";
import type { HostEventName, HostMessage as EngineMessage } from "../../src/backend/host";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import type { FakeChat, FakeHost } from "./fake-host";

/** A message as Lumiverse's database keeps it: its swipes, their dates and its extra as JSON text. */
export interface MessageRow {
  id: string;
  chat_id: string;
  index_in_chat: number;
  is_user: 0 | 1;
  name: string;
  content: string;
  send_date: number;
  swipe_id: number;
  swipes: string;
  extra: string;
  parent_message_id: string | null;
  branch_id: string | null;
  created_at: number;
  swipe_dates: string;
  revision: number;
}

/** A chat as Lumiverse's database keeps it: its metadata as JSON text. */
export interface ChatRow {
  id: string;
  user_id: string;
  character_id: string | null;
  name: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

/** A message as Lumiverse sends it (`rowToMessage`): its JSON parsed. Its lean form leaves only the shown swipe's text. */
export type Message = Omit<MessageRow, "is_user" | "swipes" | "swipe_dates" | "extra"> & { is_user: boolean; swipes: (string | null)[]; swipe_dates: number[]; extra: JsonObject };

/** A chat as Lumiverse sends it (`rowToChat`). */
export type Chat = Omit<ChatRow, "metadata"> & { metadata: JsonObject };

/** What Lumiverse answers one request. */
export interface Answered {
  status: number;
  body: unknown;
}

/** One of Lumiverse's events in its own form: its name and its payload. */
export type Told = (name: string, payload: JsonObject) => void;

const parsed = <T>(text: string, otherwise: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return otherwise;
  }
};

/** Lumiverse's `rowToMessage`. The fake keeps none of the per-swipe extras Lumiverse projects for the shown swipe, so the extra is as stored. */
export function rowToMessage(row: MessageRow): Message {
  return { ...row, is_user: row.is_user === 1, swipes: parsed<(string | null)[]>(row.swipes, [row.content]), swipe_dates: parsed<number[]>(row.swipe_dates || "[]", []), extra: parsed<JsonObject>(row.extra, {}), parent_message_id: row.parent_message_id || null, branch_id: row.branch_id || null };
}

/** Lumiverse's `rowToMessageLight`: as many slots as the swipes have, null but the shown one (and no per-swipe extras, of which the fake keeps none). */
export function rowToMessageLight(row: MessageRow): Message {
  const message = rowToMessage(row);
  if (message.swipes.length > 1) {
    const shown = row.swipe_id >= 0 && row.swipe_id < message.swipes.length ? row.swipe_id : 0;
    const light: (string | null)[] = new Array<string | null>(message.swipes.length).fill(null);
    light[shown] = message.swipes[shown] ?? null;
    message.swipes = light;
  }
  return message;
}

/** Lumiverse's `rowToChat`. */
export const rowToChat = (row: ChatRow): Chat => ({ ...row, metadata: parsed<JsonObject>(row.metadata, {}) });

/** A time as an extension's host reads one, in milliseconds: Lumiverse stamps in seconds, or in milliseconds where only they can say it; 0 is none. */
const stampOf = (raw: number): number | null => (raw > 0 ? Math.floor(raw >= 100_000_000_000 ? raw : raw * 1000) : null);

/**
 * A message as an extension's host is given it: Spindle's reshape of what Lumiverse read
 * (`chat.getMessages`: the role from `is_user` and `extra.spindle_role`, `hidden` from `extra.hidden`,
 * the extensions' entries from `extra.spindle_metadata`), read as LumiAH's own host reads it, with
 * `identifier`'s entry as its own.
 */
export function hostMessageOf(m: Message, identifier: string): HostMessage {
  const entries = isRecord(m.extra.spindle_metadata) ? m.extra.spindle_metadata : {};
  const own = entries[identifier] as JsonValue | undefined;
  return {
    id: m.id,
    index: m.index_in_chat,
    role: m.is_user ? "user" : m.extra.spindle_role === "system" ? "system" : "assistant",
    name: m.name,
    swipeId: m.swipe_id,
    swipes: Math.max(1, m.swipes.length),
    content: m.content,
    hidden: m.extra.hidden === true,
    own: own === undefined ? null : own,
    at: stampOf(m.send_date) ?? stampOf(m.created_at),
  };
}

/** A chat as an extension's host is given it. */
export const hostChatOf = (c: Chat): HostChat => ({ id: c.id, name: c.name, characterId: c.character_id !== null && c.character_id !== "" ? c.character_id : null, metadata: c.metadata });

/** A whole number as Lumiverse reads one from a query (`parseStrictInteger`); undefined for anything else. */
function strictInteger(raw: string | null): number | undefined {
  return raw !== null && /^-?\d+$/.test(raw.trim()) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
}

/** A page's limit and offset as Lumiverse reads them (`parsePagination`): the limit 50 when not said, held between 1 and 1000; the offset 0 unless a whole number not below it. */
function paged(url: URL): { limit: number; offset: number } {
  const limit = strictInteger(url.searchParams.get("limit"));
  const offset = strictInteger(url.searchParams.get("offset"));
  return { limit: limit === undefined ? 50 : Math.min(Math.max(limit, 1), 1000), offset: offset !== undefined && offset >= 0 ? offset : 0 };
}

/** What changed between two of a chat's rows, as Lumiverse names it in a CHAT_CHANGED (`diffChatChangedFields`): its name, its character, each key of its metadata. */
function changedFields(before: Chat, now: Chat): string[] {
  const changed: string[] = [];
  if (before.name !== now.name) changed.push("name");
  if (before.character_id !== now.character_id) changed.push("character_id");
  for (const key of new Set([...Object.keys(before.metadata), ...Object.keys(now.metadata)])) {
    if (JSON.stringify(before.metadata[key]) !== JSON.stringify(now.metadata[key])) changed.push(`metadata.${key}`);
  }
  return changed;
}

/** A message as the fake keeps it, as the engine's port gives it in an event. */
type Shown = Pick<EngineMessage, "id" | "index" | "isUser" | "name" | "swipes" | "swipeId" | "metadata">;

/** What was last seen of a message: its state, the revision that state has, and how many swipes it had and which it showed. */
interface Seen {
  state: string;
  revision: number;
  swipes: number;
  swipeId: number;
}

/** Lumiverse's rows behind one fake host, and what it tells of them. */
export class LumiverseRows {
  /** What was last seen of each message, by chat and message. */
  private readonly messages = new Map<string, Seen>();
  /** What was last seen of each chat's own row, with its stamp (a count of changes, which Lumiverse's readers take as seconds). */
  private readonly chats = new Map<string, { state: string; stamp: number; chat: Chat }>();
  private stamps = 0;
  /** Lumiverse's own form of each event the fake host queued, by the payload it queued. */
  private readonly forms = new WeakMap<object, { name: string; payload: JsonObject }>();
  /** Who hears what Lumiverse tells every extension of and the engine's port hears nothing of. */
  private readonly quiet = new Set<Told>();

  constructor(private readonly host: FakeHost) {
    host.taps.add((event, payload) => this.tapped(event, payload));
    // Lumiverse's `updateChat`: the chat as it now is, with the fields that changed, told to every extension; the engine's port reads no chat in that event, so the fake host tells the engine nothing.
    const merge = host.chats.mergeChatMetadata;
    host.chats.mergeChatMetadata = async (chatId, patch, userId) => {
      const before = this.chatRow(chatId);
      await merge(chatId, patch, userId);
      const now = this.chatRow(chatId);
      if (before === undefined || now === undefined) return;
      this.whisper("CHAT_CHANGED", { chat: rowToChat(now) as unknown as JsonObject, changedFields: changedFields(rowToChat(before), rowToChat(now)) });
    };
  }

  /** A chat's rows as Lumiverse's database holds them now, for `userId`: null for a chat there isn't, and for another user's, which Lumiverse never gives. */
  chat(chatId: string, userId: string): { chat: ChatRow; messages: MessageRow[] } | null {
    const chat = userId === this.host.userId ? this.host.chatsById.get(chatId) : undefined;
    if (chat === undefined) return null;
    return { chat: this.rowOf(chat), messages: chat.messages.map((m) => this.messageRow(chatId, { ...m, metadata: m.bag })) };
  }

  /** What Lumiverse answers a GET of its chat routes as `userId` (`/api/v1/chats/:id`, with `messages=false` its row alone; `/api/v1/chats/:id/messages`, a page or the tail, lean unless `full=true`); null for any other route. */
  route(url: URL, userId: string): Answered | null {
    const asked = /^\/api\/v1\/chats\/([^/]+)(\/messages)?$/.exec(url.pathname);
    if (asked === null) return null;
    const rows = this.chat(decodeURIComponent(asked[1] ?? ""), userId);
    if (rows === null) return { status: 404, body: { error: asked[2] === undefined ? "Not found" : "Chat not found" } };
    if (asked[2] === undefined) {
      // A chat with no character has no one to show it as.
      const head = { ...rowToChat(rows.chat), character_display_owner: null };
      return { status: 200, body: url.searchParams.get("messages") === "false" ? head : { ...head, messages: rows.messages.map(rowToMessage) } };
    }
    const map = url.searchParams.get("full") === "true" ? rowToMessage : rowToMessageLight;
    const total = rows.messages.length;
    const { limit, offset } = paged(url);
    if (url.searchParams.get("tail") === "true") {
      // The last `limit` by place, oldest first.
      const data = rows.messages.slice(Math.max(0, total - limit));
      return { status: 200, body: { data: data.map(map), total, limit, offset: Math.max(0, total - data.length) } };
    }
    return { status: 200, body: { data: rows.messages.slice(offset, offset + limit).map(map), total, limit, offset } };
  }

  /** Lumiverse's own form of an event the fake host delivers now (by the payload it queued); null for one Lumiverse tells no extension of here. */
  form(payload: unknown): { name: string; payload: JsonObject } | null {
    return typeof payload === "object" && payload !== null ? (this.forms.get(payload) ?? null) : null;
  }

  /** Hears every event Lumiverse tells each extension of that the engine's port hears nothing of, in Lumiverse's form, soon after the change it tells of. */
  hear(listener: Told): void {
    this.quiet.add(listener);
  }

  /** The chat's own row now, stamped; undefined for a chat there isn't. */
  private chatRow(chatId: string): ChatRow | undefined {
    const chat = this.host.chatsById.get(chatId);
    return chat === undefined ? undefined : this.rowOf(chat);
  }

  /** A chat of the fake's as Lumiverse's row: stamped anew whenever its name or metadata differ from what was last seen of them. */
  private rowOf(chat: FakeChat): ChatRow {
    const state = JSON.stringify([chat.name, chat.metadata]);
    const seen = this.chats.get(chat.id);
    const stamp = seen !== undefined && seen.state === state ? seen.stamp : ++this.stamps;
    const row: ChatRow = { id: chat.id, user_id: this.host.userId, character_id: null, name: chat.name, metadata: JSON.stringify(chat.metadata), created_at: 0, updated_at: stamp };
    this.chats.set(chat.id, { state, stamp, chat: rowToChat(row) });
    return row;
  }

  /** A message of the fake's as Lumiverse's row: the extensions' entries in its extra, its place as the host numbered it, and a revision that moves on whenever it differs from what was last seen of it. */
  private messageRow(chatId: string, m: Shown): MessageRow {
    const key = `${chatId}\u0000${m.id}`;
    const state = JSON.stringify([m.index, m.isUser, m.name, m.swipes, m.swipeId, m.metadata]);
    const seen = this.messages.get(key);
    const revision = seen === undefined ? 1 : seen.state === state ? seen.revision : seen.revision + 1;
    this.messages.set(key, { state, revision, swipes: m.swipes.length, swipeId: m.swipeId });
    return { id: m.id, chat_id: chatId, index_in_chat: m.index, is_user: m.isUser ? 1 : 0, name: m.name, content: m.swipes[m.swipeId] ?? "", send_date: 0, swipe_id: m.swipeId, swipes: JSON.stringify(m.swipes), extra: JSON.stringify({ spindle_metadata: m.metadata }), parent_message_id: null, branch_id: null, created_at: 0, swipe_dates: "[]", revision };
  }

  /** Lumiverse's form of an event the fake host just queued, made of its rows as they stand the moment it was sent. */
  private tapped(event: HostEventName, payload: unknown): void {
    if (!isRecord(payload) || typeof payload.chatId !== "string") return;
    const chatId = payload.chatId;
    const told = (name: string, form: JsonObject): void => void this.forms.set(payload, { name, payload: form });
    const shown = isRecord(payload.message) ? (payload.message as unknown as Shown) : null;
    switch (event) {
      case "MESSAGE_SENT":
        if (shown !== null) told(event, { chatId, message: this.messageOf(chatId, shown) });
        return;
      case "MESSAGE_EDITED": {
        if (shown === null) return;
        const before = this.messages.get(`${chatId}\u0000${shown.id}`);
        const message = this.messageOf(chatId, shown);
        told(event, { chatId, message });
        // Lumiverse's `updateMessage` with swipes: the edit, then SWIPE_EDITED when it changed how many swipes there are or which is shown.
        if (before !== undefined && (before.swipes !== shown.swipes.length || before.swipeId !== shown.swipeId)) this.whisper("SWIPE_EDITED", { chatId, message, previousSwipeId: before.swipeId });
        return;
      }
      case "MESSAGE_SWIPED": {
        if (shown === null) return;
        const before = this.messages.get(`${chatId}\u0000${shown.id}`);
        const previous = typeof payload.previousSwipeId === "number" ? payload.previousSwipeId : payload.action === "deleted" ? before?.swipeId : undefined;
        told(event, { chatId, message: this.messageOf(chatId, shown), action: String(payload.action), swipeId: Number(payload.swipeId), ...(previous !== undefined ? { previousSwipeId: previous } : {}) });
        return;
      }
      case "MESSAGE_DELETED":
        if (typeof payload.messageId === "string") told(event, { chatId, messageId: payload.messageId });
        return;
      case "CHAT_DELETED":
        told(event, { id: chatId });
        return;
      case "CHAT_CHANGED": {
        const chat = this.host.chatsById.get(chatId);
        if (chat === undefined) return;
        // The user's messages given to another persona all at once: Lumiverse names how many, and no chat.
        if (payload.renamed === true) {
          told(event, { chatId, reattributedUserMessages: chat.messages.filter((m) => m.isUser).length });
          return;
        }
        const before = this.chats.get(chatId)?.chat;
        const now = rowToChat(this.rowOf(chat));
        told(event, { chat: now as unknown as JsonObject, changedFields: before === undefined ? [] : changedFields(before, now) });
        return;
      }
    }
  }

  /** A message as an event of Lumiverse's carries it: whole. */
  private messageOf(chatId: string, shown: Shown): JsonObject {
    return rowToMessage(this.messageRow(chatId, shown)) as unknown as JsonObject;
  }

  /** Tells every listener an event the engine's port hears nothing of, once what is under way now is done, as Lumiverse's events reach an extension. */
  private whisper(name: string, payload: JsonObject): void {
    queueMicrotask(() => {
      for (const listener of [...this.quiet]) listener(name, payload);
    });
  }
}

const ROWS = new WeakMap<FakeHost, LumiverseRows>();

/** The rows behind a fake host: one set for each, whoever asks. */
export function lumiverseRows(host: FakeHost): LumiverseRows {
  let rows = ROWS.get(host);
  if (rows === undefined) {
    rows = new LumiverseRows(host);
    ROWS.set(host, rows);
  }
  return rows;
}
