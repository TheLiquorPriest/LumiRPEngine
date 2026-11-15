// The stand-in Lumiverse's chats (`lumiverse.ts` builds on them): held in memory, which its prompts are
// assembled from, and, given a database (`db`), written there as Lumiverse's chat service writes their
// rows, at the same moments: a chat added, a message sent, edited, swiped or deleted, a reply's message
// staged, its swipe added, and the reply saved, with what Lumiverse stores beside a reply. Each write is
// told as Lumiverse's event bus tells it: to the user's sockets (behind the stand-in server, `http.ts`) and
// to the extensions' workers. What it copies from Lumiverse's source (staging at a70f4ed2) says the file
// and lines; paths are Lumiverse's `src/`.

import type { StandInDb } from "./db";
import { ExtensionHost } from "./host";
import { Library, type Character } from "./books";
import type { Role } from "./steps";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  hidden?: boolean;
  swipeId?: number;
  images?: { data: string; mime_type: string }[];
  /** A greeting of the chat's character, by its place among the card's greetings (`services/chats.service.ts:1239-1260`). */
  greeting?: number;
  /**
   * Lumiverse's stored number for it (`index_in_chat`): one past the chat's highest when it is made (`createMessage`,
   * `services/chats.service.ts:2642-2647`), and kept, so a delete leaves a gap and the next message made after a deleted last one
   * takes its number again (`:3236-3240`). A fixture may give it (a chat with earlier deletes); one held without it is numbered as
   * a new message is, in the chat's order, when the stand-in first holds it.
   */
  index?: number;
  /** The character who spoke it, in a group chat (`extra.character_id`, `services/generate.service.ts:1990`, `:4178`): what a regenerate, a swipe or a continue of it speaks as. */
  characterId?: string;
  /** The extensions' metadata on it (`extra.spindle_metadata`), which stays with the history message it becomes (`services/prompt-assembly.service.ts:3329`, `:3351`). */
  metadata?: Record<string, unknown>;
  /** A message the image generator made (`extra.image_gen`): its pictures reach the model only as the user's image settings recycle them (`attachmentsForContext`, `services/prompt-assembly.service.ts:1061-1074`), and one left with no text and no picture is not sent (`:3315-3317`). */
  imageGen?: boolean;
}

export interface Chat {
  id: string;
  user: string;
  /** The chat's character, its card's `extensions` as far as lore reads them: which books it has (`extensions.world_book_ids`, else `world_book_id`). */
  character: Character;
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
  /** The chat's name (`chats.name`, empty unless named). */
  name?: string;
}

/** What Lumiverse stores beside a reply (`services/generate.service.ts:4448-4469`). */
export interface Stored {
  entries: { name: string; type: string; tokens: number; role?: string; blockId?: string; content?: string }[];
  chatHistoryTokens: number;
  messages: { role: string; content: string }[];
  totalTokens: number;
  maxContext: number;
  model: string;
  provider: string;
  parameters: Record<string, unknown>;
  usage: Record<string, unknown> | null;
  presetName: string;
  presetId: string;
}

/** A message's stored number, once the stand-in holds it (`ChatRows.numbered`). */
export function indexInChat(m: ChatMessage): number {
  if (m.index === undefined) throw new Error(`the stand-in has not numbered message ${m.id}`);
  return m.index;
}

export class ChatRows extends ExtensionHost {
  readonly chats = new Map<string, Chat>();
  /** What Lumiverse stored beside each reply, by message id, with its chat (`services/breakdown.service.ts:3-12`). */
  readonly stored = new Map<string, { chatId: string; data: Stored }>();
  readonly events: { event: string; payload: unknown }[] = [];
  /** Where Lumiverse's event bus frames an event for the user's sockets (`ws/bus.ts:520-529`): the stand-in server's, when this host is behind one. */
  sockets: ((event: string, payload: unknown, user: string) => void) | null = null;
  /** The database Lumiverse's chat service writes the chats' rows to; with none, the chats are held in memory only. */
  db: StandInDb | null = null;
  /** The time for its rows' stamps: the host's clock (a test that moves time moves it), unless a test gives another; Lumiverse stamps seconds (`services/chats.service.ts:2640`). */
  now: () => number = () => this.clock.now();
  /** The books, characters, personas and settings a generation reads its lore sources from: kept here and, with a database, written to it and read from it. Set `db` before adding any. */
  readonly library = new Library(() => this.db, () => this.now());

  /**
   * `eventBus.emit` (`ws/bus.ts:502-544`): a frame to each of the user's sockets at once, through the
   * server where one serves this host, and the event to the extensions' workers.
   */
  emit(event: string, payload: unknown, userId: string): void {
    this.events.push({ event, payload });
    this.sockets?.(event, payload, userId);
    this.toWorkers(event, payload, userId);
  }

  /** A message row as Lumiverse's `rowToMessage` gives it in an event (`services/chats.service.ts:587-605`). */
  protected messageRow(id: string): Record<string, unknown> | null {
    const row = this.db?.rows("SELECT * FROM messages WHERE id = ?", id)[0];
    if (row === undefined) return null;
    return { ...row, is_user: row.is_user === 1, swipes: JSON.parse(String(row.swipes)) as unknown, swipe_dates: JSON.parse(String(row.swipe_dates)) as unknown, extra: JSON.parse(String(row.extra)) as unknown };
  }

  /**
   * Numbers each message of the chat that has no stored number yet, in the chat's order, one past the chat's highest, as
   * `createMessage` numbers a new one (`services/chats.service.ts:2642-2647`). Nothing already numbered changes.
   */
  protected numbered(chat: Chat): void {
    let max = -1;
    for (const m of chat.messages) if (m.index !== undefined && m.index > max) max = m.index;
    for (const m of chat.messages) if (m.index === undefined) m.index = ++max;
  }

  /** A chat's messages as its rows list them, in Lumiverse's order (`index_in_chat`), each with its stored number, its role as RPE's read gives it (`user` when `is_user`, `system` when `extra.spindle_role` is `system`, else `assistant`) and its hidden mark (`extra.hidden`); null for no such chat. */
  rowsOf(chatId: string): { id: string; index: number; hidden: boolean; role: "user" | "assistant" | "system" }[] | null {
    const chat = this.chats.get(chatId);
    if (chat === undefined) return null;
    this.numbered(chat);
    return chat.messages.map((m) => ({ id: m.id, index: indexInChat(m), hidden: m.hidden === true, role: m.role })).sort((a, b) => a.index - b.index);
  }

  /** `createMessage` (`services/chats.service.ts:2638-2683`): its stored number, its text its one swipe, dated now; a greeting marked as `createChat` marks it (`:1250-1259`). */
  protected createRow(chat: Chat, m: ChatMessage, name: string, extra: Record<string, unknown> = {}): void {
    this.numbered(chat);
    if (this.db === null) return;
    const now = Math.floor(this.now() / 1000);
    const marks = { ...extra, ...(m.characterId !== undefined ? { character_id: m.characterId } : {}), ...(m.hidden ? { hidden: true } : {}), ...(m.imageGen ? { image_gen: true } : {}), ...(m.metadata !== undefined ? { spindle_metadata: m.metadata } : {}), ...(m.greeting !== undefined ? { greeting: true, greeting_character_id: chat.character.id, greeting_index: m.greeting } : {}) };
    this.db.run(
      "INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, send_date, swipe_id, swipes, swipe_dates, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
      m.id,
      chat.id,
      indexInChat(m),
      m.role === "user" ? 1 : 0,
      name,
      m.content,
      now,
      JSON.stringify([m.content]),
      JSON.stringify([now]),
      JSON.stringify(marks),
      now,
    );
    this.db.run("UPDATE chats SET updated_at = ? WHERE id = ? AND user_id = ?", now, chat.id, chat.user);
  }

  /**
   * `updateMessage` with new text (`services/chats.service.ts:2922-3023`): into the swipe named
   * (`contentSwipeId`, `:2950-2960`), else into the one it shows, `content` mirroring the swipe it
   * shows (`:2977-2984`); the revision raised, and the edit told.
   */
  protected saveText(chat: Chat, id: string, text: string, swipe?: number): void {
    const row = this.messageRow(id);
    if (this.db === null || row === null) return;
    const swipes = [...(row.swipes as string[])];
    const shown = Number(row.swipe_id);
    swipes[swipe !== undefined && swipe >= 0 && swipe < swipes.length ? swipe : shown] = text;
    this.db.run("UPDATE messages SET content = ?, swipes = ?, revision = revision + 1 WHERE id = ? AND chat_id = ?", swipes[shown] ?? text, JSON.stringify(swipes), id, chat.id);
    this.emit("MESSAGE_EDITED", { chatId: chat.id, message: this.messageRow(id) }, chat.user);
  }

  /** `addSwipe` (`services/chats.service.ts:3301-3344`): a new swipe with this text, dated now and shown; an assistant's raises no revision. */
  protected addSwipeRow(chat: Chat, id: string, text: string, select = true): number | null {
    const row = this.messageRow(id);
    if (this.db === null || row === null) return null;
    const swipes = [...(row.swipes as string[]), text];
    const dates = [...(row.swipe_dates as number[]), Math.floor(this.now() / 1000)];
    const swipe = swipes.length - 1;
    this.db.run("UPDATE messages SET swipes = ?, swipe_dates = ?, swipe_id = ?, content = ? WHERE id = ? AND chat_id = ?", JSON.stringify(swipes), JSON.stringify(dates), select ? swipe : Number(row.swipe_id), select ? text : String(row.content), id, chat.id);
    this.emit("MESSAGE_SWIPED", { chatId: chat.id, message: this.messageRow(id), action: "added", swipeId: swipe }, chat.user);
    return swipe;
  }

  /** `updateSwipe` (`services/chats.service.ts:3346-3400`): one swipe's text, and the message's own where it shows that swipe. */
  protected saveSwipe(chat: Chat, id: string, swipe: number, text: string): void {
    const row = this.messageRow(id);
    if (this.db === null || row === null) return;
    const swipes = [...(row.swipes as string[])];
    swipes[swipe] = text;
    if (swipe === Number(row.swipe_id)) this.db.run("UPDATE messages SET swipes = ?, content = ? WHERE id = ? AND chat_id = ?", JSON.stringify(swipes), text, id, chat.id);
    else this.db.run("UPDATE messages SET swipes = ? WHERE id = ? AND chat_id = ?", JSON.stringify(swipes), id, chat.id);
    this.emit("MESSAGE_SWIPED", { chatId: chat.id, message: this.messageRow(id), action: "updated", swipeId: swipe }, chat.user);
  }

  /** What Lumiverse stores beside a saved reply (`services/generate.service.ts:4470-4476`; `services/breakdown.service.ts:3-12`), replacing any it stored before. */
  protected storeBreakdown(chat: Chat, messageId: string, stored: Stored): void {
    this.stored.set(messageId, { chatId: chat.id, data: stored });
    this.db?.run("INSERT INTO message_breakdowns (message_id, chat_id, user_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET data = excluded.data, chat_id = excluded.chat_id, user_id = excluded.user_id", messageId, chat.id, chat.user, JSON.stringify(stored));
  }

  /** A chat as Lumiverse holds one: its character's row, its own, and each message's in order, each numbered as it was made. */
  addChat(chat: Chat): void {
    this.chats.set(chat.id, chat);
    this.numbered(chat);
    this.library.addCharacter(chat.user, chat.character);
    if (this.db === null) return;
    this.db.run("INSERT INTO chats (id, character_id, name, metadata, user_id) VALUES (?, ?, ?, ?, ?)", chat.id, chat.character.id, chat.name ?? "", JSON.stringify(chat.metadata ?? {}), chat.user);
    // A group's reply is named for the character who spoke it, where the library holds that character (a member is added before the chat).
    for (const m of chat.messages) this.createRow(chat, m, m.role === "user" ? "User" : ((m.characterId === undefined ? undefined : this.library.charactersByIds(chat.user, [m.characterId]).get(m.characterId)?.name) ?? chat.character.name));
  }

  /**
   * `createMessage` (`services/chats.service.ts:2638-2683`) as `POST /api/v1/chats/:id/messages` calls it: the message is saved under the name given (the user's, or the chat's character's, where none), then told
   * (`MESSAGE_SENT`, `:2675-2678`). `extra` is what the caller's own body carries beside the text. Gives its id.
   */
  createMessage(chatId: string, input: { role: "user" | "assistant"; content: string; name?: string; characterId?: string; hidden?: boolean; metadata?: Record<string, unknown>; extra?: Record<string, unknown> }): string {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error("the stand-in has no such chat");
    const m: ChatMessage = { id: crypto.randomUUID(), role: input.role, content: input.content, ...(input.characterId === undefined ? {} : { characterId: input.characterId }), ...(input.hidden ? { hidden: true } : {}), ...(input.metadata === undefined ? {} : { metadata: input.metadata }) };
    chat.messages.push(m);
    this.createRow(chat, m, input.name ?? (input.role === "user" ? "User" : chat.character.name), input.extra);
    this.emit("MESSAGE_SENT", { chatId, message: this.messageRow(m.id) ?? m }, chat.user);
    return m.id;
  }

  /** The user sends a message (`createMessage` with `is_user`): saved, then told. Gives its id. */
  send(chatId: string, text: string): string {
    return this.createMessage(chatId, { role: "user", content: text });
  }

  /** A reply saved in the chat with no generation (`createMessage` with `is_user` false), as the user's own hand or another app writes one: saved, then told. Gives its id. */
  reply(chatId: string, text: string): string {
    return this.createMessage(chatId, { role: "assistant", content: text });
  }

  /** `deleteMessage` (`services/chats.service.ts:3230-3270`): the row and its breakdown gone, then told (`MESSAGE_DELETED`); no other message is numbered again. */
  deleteMessage(chatId: string, id: string): void {
    const chat = this.chats.get(chatId);
    const at = chat?.messages.findIndex((m) => m.id === id) ?? -1;
    if (!chat || at < 0) throw new Error("the stand-in has no such message");
    // A chat put in place by hand is numbered before its first delete, so the gap is where Lumiverse would leave it.
    this.numbered(chat);
    chat.messages.splice(at, 1);
    this.db?.run("DELETE FROM messages WHERE id = ? AND chat_id = ?", id, chatId);
    this.db?.run("DELETE FROM message_breakdowns WHERE message_id = ?", id);
    this.stored.delete(id);
    this.emit("MESSAGE_DELETED", { chatId, messageId: id }, chat.user);
  }

  /** The player edits a message's text (`updateMessage`, `services/chats.service.ts:2922-3023`): into the swipe it shows, the revision raised, then told. */
  editMessage(chatId: string, id: string, text: string): void {
    const chat = this.chats.get(chatId);
    const m = chat?.messages.find((x) => x.id === id);
    if (!chat || !m) throw new Error("the stand-in has no such message");
    m.content = text;
    this.saveText(chat, id, text);
  }

  /**
   * The player shows the swipe left or right of the one shown (`cycleSwipe`, `services/chats.service.ts:3455-3492`):
   * past either end nothing changes; an assistant's flip raises no revision. Told as `MESSAGE_SWIPED`, "navigated".
   */
  cycleSwipe(chatId: string, id: string, direction: "left" | "right"): void {
    const chat = this.chats.get(chatId);
    const m = chat?.messages.find((x) => x.id === id);
    const row = this.messageRow(id);
    if (!chat || !m || this.db === null || row === null) throw new Error("the stand-in has no such message");
    const swipes = row.swipes as string[];
    const previous = Number(row.swipe_id);
    const next = direction === "left" ? previous - 1 : previous + 1;
    if (swipes.length <= 1 || next < 0 || next >= swipes.length) return;
    const text = swipes[next] ?? String(row.content);
    this.db.run(`UPDATE messages SET swipe_id = ?, content = ?${m.role === "user" ? ", revision = revision + 1" : ""} WHERE id = ? AND chat_id = ?`, next, text, id, chatId);
    m.swipeId = next;
    m.content = text;
    this.emit("MESSAGE_SWIPED", { chatId, message: this.messageRow(id), action: "navigated", swipeId: next, previousSwipeId: previous }, chat.user);
  }
}
