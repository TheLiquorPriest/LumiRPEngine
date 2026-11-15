// The stand-in Lumiverse's chats (`lumiverse.ts` builds on them): held in memory, which its prompts are
// assembled from, and, given a database (`db`), written there as Lumiverse's chat service writes their
// rows, at the same moments: a chat added, a message sent, edited, swiped or deleted, a reply's message
// staged, its swipe added, and the reply saved, with what Lumiverse stores beside a reply. Each write is
// told as Lumiverse's event bus tells it: to the user's sockets (behind the stand-in server, `http.ts`) and
// to the extensions' workers. What it copies from Lumiverse's source (staging at a70f4ed2) says the file
// and lines; paths are Lumiverse's `src/`.

import type { StandInDb } from "./db";
import { keepStoredSwipeArrays, normalizeStoredExtra, projectActiveSwipeExtra, removeSwipeScopedEntry } from "./extra";
import { type ChatStore, ExtensionHost } from "./host";
import { SpindleManager } from "./spindle";
import { Library, type Character } from "./books";
import { isRecord } from "../../src/shared/json";
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
  sockets: ((event: string, payload: unknown, user?: string, options?: { topic?: string }) => void) | null = null;
  /** The database Lumiverse's chat service writes the chats' rows to; with none, the chats are held in memory only. */
  db: StandInDb | null = null;
  /** The time for its rows' stamps: the host's clock (a test that moves time moves it), unless a test gives another; Lumiverse stamps seconds (`services/chats.service.ts:2640`). */
  now: () => number = () => this.clock.now();
  /** The books, characters, personas and settings a generation reads its lore sources from: kept here and, with a database, written to it and read from it. Set `db` before adding any. */
  readonly library = new Library(() => this.db, () => this.now());
  /** Spindle's manager (`spindle.ts`): installs from a remote's branch, enables, grants as an admin does, and starts each extension's worker in this host. */
  readonly spindle = new SpindleManager(this, () => this.now());

  /** A user's setting as the library keeps it: what the extensions' limits read of the Spindle settings (`services/spindle-settings.service.ts:46-47`). */
  protected override userSetting(user: string, key: string): unknown {
    return this.library.setting(user, key);
  }

  /**
   * `eventBus.emit` (`ws/bus.ts:502-544`): a frame to each of the user's sockets at once, through the
   * server where one serves this host, and the event to the extensions' workers.
   */
  override emit(event: string, payload: unknown, userId?: string, options?: { topic?: string }): void {
    this.events.push({ event, payload });
    this.sockets?.(event, payload, userId, options);
    this.toWorkers(event, payload, userId);
  }

  /** A message row as Lumiverse's `rowToMessage` gives it in an event (`services/chats.service.ts:587-605`). */
  protected messageRow(id: string): Record<string, unknown> | null {
    const row = this.db?.rows("SELECT * FROM messages WHERE id = ?", id)[0];
    if (row === undefined) return null;
    // The fields kept for each swipe show those of the swipe on display, at the top of `extra` (`rowToMessage`, `services/chats.service.ts:402-470`).
    const swipes = JSON.parse(String(row.swipes)) as unknown[];
    const shown = Number(row.swipe_id);
    const extra = projectActiveSwipeExtra(normalizeStoredExtra(JSON.parse(String(row.extra)) as Record<string, unknown>, swipes.length, shown), shown);
    return { ...row, is_user: row.is_user === 1, swipes, swipe_dates: JSON.parse(String(row.swipe_dates)) as unknown, extra };
  }

  /**
   * Numbers each message of the chat that has no stored number yet, in the chat's order. One with a numbered message after it was put among them, and is numbered as `createMessage` numbers an
   * insertion before that message (`services/chats.service.ts:2645-2655`): it takes that message's number, and that one and each after it move up one place, in the rows too. Any other is one
   * past the chat's highest, as a new message is (`:2642-2647`). Nothing already numbered changes otherwise.
   */
  protected numbered(chat: Chat): void {
    let max = -1;
    for (const m of chat.messages) if (m.index !== undefined && m.index > max) max = m.index;
    for (const [at, m] of chat.messages.entries()) {
      if (m.index !== undefined) continue;
      const next = chat.messages.slice(at + 1).find((x) => x.index !== undefined);
      if (next?.index === undefined) {
        m.index = ++max;
        continue;
      }
      const place = next.index;
      for (const later of chat.messages) if (later.index !== undefined && later.index >= place) later.index += 1;
      this.db?.run("UPDATE messages SET index_in_chat = index_in_chat + 1, revision = revision + 1 WHERE chat_id = ? AND index_in_chat >= ?", chat.id, place);
      m.index = place;
      max += 1;
    }
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
    const marks = { ...extra, ...(m.role === "system" ? { spindle_role: "system" } : {}), ...(m.characterId !== undefined ? { character_id: m.characterId } : {}), ...(m.hidden ? { hidden: true } : {}), ...(m.imageGen ? { image_gen: true } : {}), ...(m.metadata !== undefined ? { spindle_metadata: m.metadata } : {}), ...(m.greeting !== undefined ? { greeting: true, greeting_character_id: chat.character.id, greeting_index: m.greeting } : {}) };
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
   * (`MESSAGE_SENT`, `:2675-2678`). `extra` is what the caller's own body carries beside the text; a system message is marked as Lumiverse marks one (`extra.spindle_role`, `spindle/runtime-state.ts:50`). With `before`
   * (`beforeId`, `:2645-2646`) the message is put before that one, which must be in this chat: it takes that message's number, the later ones move up one place (`:2653-2655`), and the event says `inserted` (`:2675`).
   * Gives its id.
   */
  createMessage(chatId: string, input: { role: Role; content: string; name?: string; characterId?: string; hidden?: boolean; metadata?: Record<string, unknown>; extra?: Record<string, unknown>; before?: string }): string {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error("the stand-in has no such chat");
    const m: ChatMessage = { id: crypto.randomUUID(), role: input.role, content: input.content, ...(input.characterId === undefined ? {} : { characterId: input.characterId }), ...(input.hidden ? { hidden: true } : {}), ...(input.metadata === undefined ? {} : { metadata: input.metadata }) };
    const before = input.before === undefined ? -1 : chat.messages.findIndex((x) => x.id === input.before);
    if (input.before !== undefined && before < 0) throw new Error("Insertion target is not in this chat");
    if (before >= 0) {
      // Numbered first, so the message put before another is the only one without a number, and `createRow` numbers it as an insertion.
      this.numbered(chat);
      chat.messages.splice(before, 0, m);
    } else chat.messages.push(m);
    this.createRow(chat, m, input.name ?? (input.role === "user" ? "User" : chat.character.name), input.extra);
    this.emit("MESSAGE_SENT", { chatId, message: this.messageRow(m.id) ?? m, ...(before >= 0 ? { inserted: true } : {}) }, chat.user);
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
    const gone = chat.messages[at]!;
    // A breakdown holds the history its reply was made from, so deleting a message voids that of every later one (`services/chats.service.ts:3236-3240`; `services/breakdown.service.ts:35-55`).
    const later = chat.messages.filter((m) => indexInChat(m) > indexInChat(gone)).map((m) => m.id);
    chat.messages.splice(at, 1);
    this.db?.run("DELETE FROM messages WHERE id = ? AND chat_id = ?", id, chatId);
    this.db?.run("DELETE FROM message_breakdowns WHERE message_id = ?", id);
    for (const after of later) this.db?.run("DELETE FROM message_breakdowns WHERE message_id = ?", after);
    for (const dropped of [id, ...later]) this.stored.delete(dropped);
    this.emit("MESSAGE_DELETED", { chatId, messageId: id }, chat.user);
  }

  /**
   * The player edits a message's text through the message route (`routes/chats.routes.ts:1085-1122`, `updateMessage`, `services/chats.service.ts:2922-3033`): into the swipe it shows, the revision raised, a fresh
   * `tokenCount` put in the `extra` it saves where the connection named has a tokenizer (`:1114-1118`), then told. A chat held with no database only has its text changed.
   */
  editMessage(chatId: string, id: string, text: string, options: { connection?: string } = {}): void {
    const chat = this.chats.get(chatId);
    const m = chat?.messages.find((x) => x.id === id);
    if (!chat || !m) throw new Error("the stand-in has no such message");
    if (this.db === null) {
      m.content = text;
      return;
    }
    const tokenCount = this.countTokens(chat.user, options.connection, text);
    const stored = this.messageRow(id)?.extra;
    this.updateMessage(chatId, id, { content: text, ...(tokenCount === null ? {} : { extra: { ...(isRecord(stored) ? stored : {}), tokenCount } }) });
  }

  /** `computeMessageTokenCount` (`services/message-token-count.ts:51-66`): none, here, as for a model with no tokenizer; the stand-in Lumiverse gives the count of the models it has one for. */
  protected countTokens(_user: string, _connection: string | undefined, _text: string): number | null {
    return null;
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

  /**
   * `deleteSwipe` (`services/chats.service.ts:3386-3453`) as the player's own act: the swipe and its date are taken out; `swipe_id` goes one down where the swipe deleted came before the one shown, and where it
   * was the one shown the message shows the swipe `restoreSwipeId` names, else the nearest (the next one, the last where there is none); the swipe's entry in every per-swipe list goes, and a user's message whose
   * text changed has its revision raised. The last swipe is never deleted, nor one that is not there. Told as `MESSAGE_SWIPED`, "deleted". Gives whether a swipe was deleted.
   */
  deleteSwipe(chatId: string, id: string, swipe: number, options?: { restoreSwipeId?: number }): boolean {
    const chat = this.chats.get(chatId);
    const m = chat?.messages.find((x) => x.id === id);
    const row = this.db?.rows("SELECT * FROM messages WHERE id = ? AND chat_id = ?", id, chatId)[0];
    if (!chat || !m || this.db === null || row === undefined) throw new Error("the stand-in has no such message");
    const swipes = JSON.parse(String(row.swipes)) as string[];
    const dates = JSON.parse(String(row.swipe_dates)) as number[];
    if (swipes.length <= 1 || swipe < 0 || swipe >= swipes.length) return false;
    const previous = Number(row.swipe_id);
    const left = swipes.filter((_, at) => at !== swipe);
    let shown = previous;
    if (swipe < previous) shown = previous - 1;
    else if (swipe === previous) {
      const restore = options?.restoreSwipeId;
      shown = restore !== undefined && Number.isInteger(restore) && restore >= 0 && restore < left.length ? restore : Math.min(previous, left.length - 1);
    }
    const content = left[shown] ?? left[0] ?? "";
    const extra = removeSwipeScopedEntry(JSON.parse(String(row.extra)) as Record<string, unknown>, swipes.length, previous, swipe);
    const revised = row.is_user === 1 && content !== String(row.content) ? ", revision = revision + 1" : "";
    this.db.run(`UPDATE messages SET swipes = ?, swipe_dates = ?, swipe_id = ?, content = ?, extra = ?${revised} WHERE id = ? AND chat_id = ?`, JSON.stringify(left), JSON.stringify(dates.filter((_, at) => at !== swipe)), shown, content, JSON.stringify(extra), id, chatId);
    m.swipeId = shown;
    m.content = content;
    this.emit("MESSAGE_SWIPED", { chatId, message: this.messageRow(id), action: "deleted", swipeId: swipe, previousSwipeId: previous }, chat.user);
    return true;
  }

  /**
   * `bulkSetHidden` (`services/chats.service.ts:3087-3132`), as the player's hide toggle and the extension's `chat.setMessageHidden` and `setMessagesHidden` (`spindle/worker-host.ts:4364-4418`) make it: at most 500 messages,
   * those not in the chat passed over, `extra.hidden` set or taken out and nothing else of the row changed; hiding the message the history is cut at takes that cut out of the chat's metadata; then one `MESSAGE_EDITED`
   * for each message found.
   */
  hideMessages(chatId: string, ids: readonly string[], hidden: boolean): void {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error("Chat not found");
    if (ids.length > 500) throw new Error("Maximum 500 messages per batch");
    const found: string[] = [];
    for (const id of ids) {
      const m = chat.messages.find((x) => x.id === id);
      if (!m) continue;
      const row = this.db?.rows("SELECT extra FROM messages WHERE id = ? AND chat_id = ?", id, chatId)[0];
      if (this.db !== null && row === undefined) continue;
      const extra = row === undefined ? {} : (JSON.parse(String(row.extra || "{}")) as Record<string, unknown>);
      if (hidden) extra.hidden = true;
      else delete extra.hidden;
      this.db?.run("UPDATE messages SET extra = ? WHERE id = ? AND chat_id = ?", JSON.stringify(extra), id, chatId);
      if (hidden) m.hidden = true;
      else delete m.hidden;
      found.push(id);
    }
    const anchor = this.metadataOf(chat).context_history_anchor_message_id;
    if (hidden && typeof anchor === "string" && ids.includes(anchor)) this.mergeChatMetadata(chat, { context_history_anchor_message_id: undefined });
    for (const id of found) this.emit("MESSAGE_EDITED", { chatId, message: this.messageRow(id) ?? chat.messages.find((x) => x.id === id) }, chat.user);
  }

  /**
   * `updateMessage` (`services/chats.service.ts:2922-3033`) as the message route and the extensions call it, over what Lumiverse names in the input: the text into the swipe `contentSwipeId` names, else the one shown;
   * a `swipes` list of another length with `swipe_dates` padded with now or cut to fit; an `extra` that replaces the stored one whole, except that it keeps the stored `variableStateBySwipe` and each per-swipe list it
   * leaves out (`:638-652`), folded into the lists for the swipe shown (`:2985-2994`); the revision raised for any write. Told as `MESSAGE_EDITED`, and as `SWIPE_EDITED` too where the swipe list, the swipe shown or
   * the dates were given (`:3024-3033`). An input that names no field changes nothing and tells nothing. The names are Lumiverse's own, snake case where it is.
   */
  updateMessage(chatId: string, id: string, input: MessageUpdate): void {
    const chat = this.chats.get(chatId);
    const m = chat?.messages.find((x) => x.id === id);
    const existing = this.messageRow(id);
    if (!chat || !m || this.db === null || existing === null) throw new Error("the stand-in has no such message");
    const stored = existing.extra as Record<string, unknown>;
    const old = existing.swipes as string[];
    const patchedContent = input.content !== undefined;
    const swipeShapeTouched = input.swipes !== undefined || input.swipe_id !== undefined || input.swipe_dates !== undefined;
    const swipes = input.swipes !== undefined ? [...input.swipes] : [...old];
    const swipeId = input.swipe_id ?? Number(existing.swipe_id);
    let dates = input.swipe_dates !== undefined ? [...input.swipe_dates] : [...(existing.swipe_dates as number[])];
    if (input.swipes !== undefined && input.swipe_dates === undefined) {
      const now = Math.floor(this.now() / 1000);
      while (dates.length < swipes.length) dates.push(now);
      dates = dates.slice(0, swipes.length);
    }
    const contentSwipe = patchedContent && input.contentSwipeId !== undefined && Number.isInteger(input.contentSwipeId) && input.contentSwipeId >= 0 && input.contentSwipeId < swipes.length ? input.contentSwipeId : swipeId;
    if (patchedContent) {
      if (!Number.isFinite(swipeId) || swipeId < 0 || swipeId >= swipes.length) throw new Error("updateMessage: swipe_id out of range");
      swipes[contentSwipe] = input.content ?? "";
    }
    if (swipes.length === 0) throw new Error("updateMessage: swipes must be non-empty");
    if (!Number.isFinite(swipeId) || swipeId < 0 || swipeId >= swipes.length) throw new Error("updateMessage: swipe_id out of range");
    if (swipes.length !== dates.length) throw new Error("updateMessage: swipes and swipe_dates length mismatch");
    const content = patchedContent || swipeShapeTouched ? swipes[swipeId] : undefined;
    const extra = input.extra !== undefined || swipeShapeTouched ? normalizeStoredExtra(input.extra !== undefined ? keepStoredSwipeArrays(input.extra, stored) : stored, swipes.length, input.extra !== undefined ? swipeId : Number(existing.swipe_id)) : undefined;
    // The variable records are cut to the swipes there are (`preserveSwipeVariablesSql`, `db/swipe-variable-state.ts:22-28`).
    if (extra !== undefined && Array.isArray(extra.variableStateBySwipe)) extra.variableStateBySwipe = extra.variableStateBySwipe.slice(0, swipes.length);
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (content !== undefined) {
      fields.push("content = ?");
      values.push(content);
    }
    if (patchedContent || swipeShapeTouched) {
      fields.push("swipes = ?", "swipe_dates = ?", "swipe_id = ?");
      values.push(JSON.stringify(swipes), JSON.stringify(dates), swipeId);
    }
    if (input.name !== undefined) {
      fields.push("name = ?");
      values.push(input.name);
    }
    if (input.is_user !== undefined) {
      fields.push("is_user = ?");
      values.push(input.is_user ? 1 : 0);
    }
    if (extra !== undefined) {
      fields.push("extra = ?");
      values.push(JSON.stringify(extra));
    }
    if (fields.length === 0) return;
    this.db.run(`UPDATE messages SET ${fields.join(", ")}, revision = revision + 1 WHERE id = ? AND chat_id = ?`, ...values, id, chatId);
    const updated = this.messageRow(id);
    if (updated === null) return;
    this.keepInMemory(m, updated);
    this.emit("MESSAGE_EDITED", { chatId, message: updated }, chat.user);
    if (swipeShapeTouched) this.emit("SWIPE_EDITED", { chatId, message: updated, previousSwipeId: Number(existing.swipe_id) }, chat.user);
  }

  /** What the held message takes of its row after a write that may change them all: its text and swipe, its role, and the marks of its `extra` the stand-in holds. */
  private keepInMemory(m: ChatMessage, row: Record<string, unknown>): void {
    const extra = row.extra as Record<string, unknown>;
    m.role = row.is_user === true ? "user" : extra.spindle_role === "system" ? "system" : "assistant";
    m.content = String(row.content);
    m.swipeId = Number(row.swipe_id);
    if (extra.hidden === true) m.hidden = true;
    else delete m.hidden;
    if (isRecord(extra.spindle_metadata)) m.metadata = extra.spindle_metadata;
    else delete m.metadata;
    if (typeof extra.character_id === "string") m.characterId = extra.character_id;
    else delete m.characterId;
    if (extra.image_gen === true) m.imageGen = true;
    else delete m.imageGen;
  }

  /** The chat's metadata as its row holds it now; the chat held in memory where there is no database. */
  protected metadataOf(chat: Chat): Record<string, unknown> {
    const row = this.db?.rows("SELECT metadata FROM chats WHERE id = ? AND user_id = ?", chat.id, chat.user)[0];
    return row === undefined ? (chat.metadata ?? {}) : (JSON.parse(String(row.metadata)) as Record<string, unknown>);
  }

  /**
   * `mergeChatMetadataAsync` (`services/chats.service.ts:5241-5244`; `db/chat-operations.ts:22-33`, `:57-80`): each key given replaces
   * the chat's own, a key given as undefined is removed (`:68`), the row's stamp is raised, and the change is told as `CHAT_CHANGED` with the keys that differ
   * (`services/chats.service.ts:1466-1500`, `:5198-5204`).
   */
  mergeChatMetadata(chat: Chat, partial: Record<string, unknown>): void {
    const before = this.metadataOf(chat);
    const metadata = { ...before, ...partial };
    for (const [key, value] of Object.entries(partial)) if (value === undefined) delete metadata[key];
    const changedFields = Object.keys(partial).filter((key) => (partial[key] === undefined ? key in before : !(key in before) || JSON.stringify(before[key]) !== JSON.stringify(partial[key]))).map((key) => `metadata.${key}`);
    this.db?.run("UPDATE chats SET metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?", JSON.stringify(metadata), Math.floor(this.now() / 1000), chat.id, chat.user);
    chat.metadata = metadata;
    const row = this.db?.rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chat.id, chat.user)[0];
    const shown = row === undefined ? { id: chat.id, user_id: chat.user, character_id: chat.character.id, name: chat.name ?? "", metadata } : { ...row, metadata };
    this.emit("CHAT_CHANGED", { chat: shown, changedFields }, chat.user);
  }

  /**
   * `branchChat` (`services/chats.service.ts:3506-3635`) as the player's own act, as `deleteMessage` is: a new chat of the same character, with the source's metadata and `branched_from` and
   * `branch_at_message`, named as the player names it, else "… — Branch at #N" (a second at the same place " (2)", and so on); every message up to the one branched at copied with a new id,
   * the same `index_in_chat` and `branch_id` of the branch, its `parent_message_id` as the copy of that parent; the history's cut kept where its message was copied, else taken out. Then told as `CHAT_FORKED`
   * with the map of ids. The swipe variable state (`:3599-3607`) is not kept by the stand-in. Gives the new chat's id; null where the chat or the message is not there.
   */
  branch(chatId: string, atMessageId: string, name?: string): string | null {
    const chat = this.chats.get(chatId);
    const at = chat?.messages.find((m) => m.id === atMessageId);
    if (!chat || !at) return null;
    this.numbered(chat);
    const atIndex = indexInChat(at);
    const branchId = crypto.randomUUID();
    const forkedId = crypto.randomUUID();
    const now = Math.floor(this.now() / 1000);
    let named = name?.trim() ?? "";
    if (named === "") {
      const base = (chat.name || chat.character.name || "Chat").replace(/\s+—\s+Branch.*$/i, "").replace(/\s+\(branch\s*\d*\)$/i, "");
      const label = `${base} — Branch at #${atIndex}`;
      const same = this.db?.rows("SELECT COUNT(*) AS count FROM chats WHERE user_id = ? AND name LIKE ?", chat.user, `${label}%`)[0];
      const count = same !== undefined ? Number(same.count) : [...this.chats.values()].filter((c) => c.user === chat.user && (c.name ?? "").toLowerCase().startsWith(label.toLowerCase())).length;
      named = count > 0 ? `${label} (${count + 1})` : label;
    }
    const metadata: Record<string, unknown> = { ...this.metadataOf(chat), branched_from: chat.id, branch_at_message: at.id };
    const copied = chat.messages.filter((m) => indexInChat(m) <= atIndex).sort((a, b) => indexInChat(a) - indexInChat(b));
    const ids = new Map<string, string>();
    for (const m of copied) ids.set(m.id, crypto.randomUUID());
    const anchor = this.metadataOf(chat).context_history_anchor_message_id;
    if (typeof anchor === "string") {
      const mapped = ids.get(anchor);
      if (mapped !== undefined) metadata.context_history_anchor_message_id = mapped;
      else delete metadata.context_history_anchor_message_id;
    }
    if (this.db !== null) {
      this.db.run("INSERT INTO chats (id, user_id, character_id, name, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", forkedId, chat.user, chat.character.id, named, JSON.stringify(metadata), now, now);
      for (const row of this.db.rows("SELECT * FROM messages WHERE chat_id = ? AND index_in_chat <= ? ORDER BY index_in_chat ASC", chat.id, atIndex)) {
        const parent = row.parent_message_id === null || row.parent_message_id === undefined || row.parent_message_id === "" ? null : (ids.get(String(row.parent_message_id)) ?? null);
        this.db.run(
          "INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, send_date, swipe_id, swipes, swipe_dates, extra, parent_message_id, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ids.get(String(row.id)) ?? crypto.randomUUID(),
          forkedId,
          Number(row.index_in_chat),
          Number(row.is_user),
          String(row.name),
          String(row.content),
          Number(row.send_date),
          Number(row.swipe_id),
          String(row.swipes),
          String(row.swipe_dates),
          String(row.extra),
          parent,
          branchId,
          now,
        );
      }
    }
    this.chats.set(forkedId, { id: forkedId, user: chat.user, character: chat.character, messages: copied.map((m) => ({ ...m, id: ids.get(m.id) ?? m.id })), metadata, name: named });
    const row = this.db?.rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", forkedId, chat.user)[0];
    const forked = row === undefined ? { id: forkedId, user_id: chat.user, character_id: chat.character.id, name: named, metadata } : { ...row, metadata };
    this.emit("CHAT_FORKED", { sourceChatId: chat.id, forkedChatId: forkedId, chat: forked, branchId, forkedAtMessageId: at.id, forkedAtMessageIndex: atIndex, messageIdMap: Object.fromEntries(ids) }, chat.user);
    return forkedId;
  }

  /** `handleChatAppendMessage` (`spindle/worker-host.ts:4145-4171`): the name given, else the role's; a character only for an assistant's message and one the user has; the role kept in `extra.spindle_role` whatever it is. */
  private appendRow(chatId: string, message: { role: Role; content: string; name?: string; characterId?: string; metadata?: Record<string, unknown> }): string {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error("Chat not found");
    if (message.characterId !== undefined && (message.role !== "assistant" || this.library.charactersByIds(chat.user, [message.characterId]).size === 0)) throw new Error("Invalid message character");
    const name = message.name ?? (message.role === "system" ? "System" : message.role === "assistant" ? "Assistant" : "User");
    return this.createMessage(chatId, { role: message.role, content: message.content, name, ...(message.characterId === undefined ? {} : { characterId: message.characterId }), ...(message.metadata === undefined ? {} : { metadata: message.metadata }), extra: { spindle_role: message.role } });
  }

  /** What the extensions' `chat` calls reach: the chats held here, by their owner. */
  protected override chatStore(): ChatStore {
    return {
      ownerOf: (chatId) => this.chats.get(chatId)?.user,
      hasMessage: (chatId, id) => this.chats.get(chatId)?.messages.some((m) => m.id === id) === true,
      isHidden: (chatId, id) => {
        const row = this.messageRow(id);
        return row === null ? this.chats.get(chatId)?.messages.find((m) => m.id === id)?.hidden === true : (row.extra as Record<string, unknown>).hidden === true;
      },
      hide: (chatId, ids, hidden) => this.hideMessages(chatId, ids, hidden),
      append: (chatId, message) => this.appendRow(chatId, message),
    };
  }
}

/** What `updateMessage` takes (`UpdateMessageInput`, `services/chats.service.ts`): the names are Lumiverse's own. */
export interface MessageUpdate {
  content?: string;
  /** The swipe `content` goes into, where not the one shown. */
  contentSwipeId?: number;
  swipes?: string[];
  swipe_id?: number;
  swipe_dates?: number[];
  name?: string;
  is_user?: boolean;
  extra?: Record<string, unknown>;
}
