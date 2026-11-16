// Build's lore tools on his books (plan §9, §14; PlanChatUI-B3): his books and their entries with LRE's fields and secret marks, the pins read
// now, LRE's fields and Make secret written on his press, and a chat's reply saved as a draft lore entry of its world. His books are read
// through the door (`BuildBooks`); every write to one goes through the lore's one recorded writer (`BuildWrites`) with the revision the page
// read the entry at, so a stale write is refused and the entry as it now stands is read again, and each write is kept with the entry before
// and after and can be put back from the Lore page. The secrecy page's moves are `SecrecyMoves`. Every call is for the user this RPE belongs to.

import type { Database } from "bun:sqlite";
import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../../app";
import type { ChatId, UserId, WorldId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { LEDGER_NAMESPACE } from "../../shared/ledger";
import { bookLoreFieldsOf, type BookFieldsEdit, editedBookFields, OLD_SECRECY_FIELDS, topicIdOf, withBookLoreFields } from "../../shared/lore";
import { neutralizeMacros } from "../../shared/macros";
import type { LoreBookEntryView, LoreBookView, LoreMarkChange, LorePinsView } from "../../shared/lore-views";
import { PROTOCOL_VERSION } from "../../shared/protocol";
import type { Store } from "../../store";
import type { WorldService } from "../../worlds/service";
import { WorldError } from "../../worlds/worlds";
import { type BookEntry, type BuildBooks, type BuildWrites, engineWrote, entryView, listBooks } from "./books";
import { MarkChangeError, markedContent } from "./marks";
import { pinViews } from "./pins";
import { SecrecyMoves } from "./secrecy";

/** The most of a chat's text a saved entry keeps. */
export const SAVED_MAX_CHARS = 20_000;

/** What a write on an entry that changed since the page read it says. */
const STALE = "that entry changed in Lumiverse since you read it: it is shown as it stands now, so look at it again before you write";

/** A request the lore tools turn down, with the code its route answers with. */
export class LoreError extends Error {
  constructor(
    readonly code: "bad_request" | "not_found" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "LoreError";
  }
}

/** One message of a chat as Save to lore reads it. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface BuildLoreDeps {
  books: BuildBooks;
  writes: BuildWrites;
  worlds: WorldService;
  store: Store;
  /** A chat's messages in order, with their texts; none for a chat Lumiverse does not hold. */
  messages(user: UserId, chat: ChatId): Promise<ChatMessage[]>;
  db: Database;
  queue: WriteQueue;
  log: Log;
}

/** A saved entry's first title: its text's first sentence without roleplay markup, at most eight words. */
function savedTitle(text: string): string {
  const first = neutralizeMacros(text.replace(/[*_"“”]/g, " "))
    .trim()
    .split(/(?<=[.!?…])\s/)[0]
    ?.trim()
    .replace(/[.!?…]+$/, "");
  const words = (first ?? "").split(/\s+/).filter((w) => w !== "");
  return words.length === 0 ? "Saved from a chat" : words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
}

export class BuildLore {
  readonly secrecy: SecrecyMoves;

  constructor(private readonly deps: BuildLoreDeps) {
    this.secrecy = new SecrecyMoves({ db: deps.db, queue: deps.queue, log: deps.log, books: deps.books, writes: deps.writes });
  }

  /** The books a pin may name an entry of, the engine's own left out, those attached to `chat` first, then by name. */
  books(user: UserId, chat: ChatId | null): Promise<LoreBookView[]> {
    return listBooks(this.deps.books, user, chat);
  }

  /** One book's entries, in the book's order, each with its fields, marks and the revision a write must name. */
  async entries(user: UserId, book: string): Promise<LoreBookEntryView[]> {
    return (await this.deps.books.entries(user, book)).map(entryView);
  }

  /** Every pin of a world's draft (Build), or of the revision a chat plays (the GM view), read now. */
  async pins(user: UserId, at: { world: WorldId } | { chat: ChatId }): Promise<LorePinsView> {
    const said = (message: string): void => this.deps.log.warn(`[LumiRPEngine] ${message}`);
    if ("world" in at) return pinViews(this.deps.books, await this.working(user, at.world), user, said);
    const played = this.deps.store.user(user).headState(at.chat).state.world.revision;
    const world = this.deps.store.user(user).chat(at.chat)?.world ?? null;
    if (world === null) throw new LoreError("bad_request", "this chat is not attached to a world");
    return pinViews(this.deps.books, (await this.deps.worlds.read(user, world, played)).world, user, said);
  }

  private async working(user: UserId, world: WorldId) {
    try {
      return await this.deps.worlds.worlds.working(world, user);
    } catch (error) {
      if (error instanceof WorldError && error.code === "not_found") throw new LoreError("not_found", error.message);
      throw error;
    }
  }

  /** The entry as it stands, refused when it is not in `book`, the engine wrote it, or it is no longer at the revision the page read it at. */
  private async entryOf(user: UserId, book: string, id: string, revision: number): Promise<BookEntry> {
    const entry = await this.deps.books.entry(user, id, book);
    if (!entry || entry.book !== book) throw new LoreError("not_found", "that book has no such entry");
    if (engineWrote(entry)) throw new LoreError("bad_request", "the engine wrote that entry; a world's own lore is its document's");
    if (entry.revision !== revision) throw new LoreError("conflict", STALE);
    return entry;
  }

  /** Writes `fields` of the entry through the recorded writer at the revision the page read; a refusal is the entry having changed since. */
  private async write(user: UserId, e: BookEntry, change: { content?: string; extensions?: JsonObject }, revision: number): Promise<void> {
    const done = await this.deps.writes.edit(user, e.id, { content: change.content ?? e.content, comment: e.comment, keys: e.keys, ...(change.extensions === undefined ? {} : { extensions: change.extensions }) }, revision);
    if ("refused" in done) throw new LoreError("conflict", done.refused === "missing" ? "that entry is gone from its book: read the book again" : STALE);
  }

  /**
   * Build's Save of one entry's own LRE fields (its visibility, links and aliases; null takes them off): the rest of its extension data and an
   * earlier build's secrecy fields stay as they are, and nothing else of the entry is written. Answers the book's entries as read after.
   */
  async fields(user: UserId, book: string, entry: string, edit: BookFieldsEdit | null, revision: number): Promise<LoreBookEntryView[]> {
    if (edit !== null) {
      const read = bookLoreFieldsOf({ [LEDGER_NAMESPACE]: { lore: edit } });
      if (read === null) throw new LoreError("bad_request", "give the fields as an object, or null to take them off");
      if (OLD_SECRECY_FIELDS.some((key) => (read as Record<string, unknown>)[key] !== undefined)) throw new LoreError("bad_request", "an entry is made secret by a secret mark in its text, not by fields: use Make secret (the mark op)");
    }
    const e = await this.entryOf(user, book, entry, revision);
    await this.write(user, e, { extensions: withBookLoreFields(e.extensions, editedBookFields(bookLoreFieldsOf(e.extensions), edit)) }, revision);
    return this.entries(user, book);
  }

  /** Build's Make secret and Make public: the change written as secret marks into the entry's text, nothing else of it. Answers the book's entries as read after. */
  async mark(user: UserId, book: string, entry: string, change: LoreMarkChange, revision: number): Promise<LoreBookEntryView[]> {
    const e = await this.entryOf(user, book, entry, revision);
    let content: string;
    try {
      content = markedContent(e, change);
    } catch (error) {
      if (error instanceof MarkChangeError) throw new LoreError("bad_request", error.message);
      throw error;
    }
    if (content !== e.content) await this.write(user, e, { content }, revision);
    return this.entries(user, book);
  }

  /**
   * Saves the chat's latest reply, or `excerpt`, as a lore entry in the draft of the world the chat plays, read from the chat's row and no turn.
   * Its source names the message it came from: the latest one holding the excerpt word for word (spacing and case aside), else the latest reply.
   * The title is the text's first words, for the author to edit in the form that opens next; nothing is committed. The entry's id is picked from
   * the draft in turn with the world's other writes, so two saves at once never pick the same one.
   */
  async save(user: UserId, chat: ChatId, excerpt?: string): Promise<{ worldId: WorldId; id: string }> {
    const world = this.deps.store.user(user).chat(chat)?.world ?? null;
    if (world === null) throw new LoreError("bad_request", "this chat is not attached to a world");
    const messages = await this.deps.messages(user, chat);
    const reply = messages.filter((m) => m.role !== "user" && m.text.trim() !== "").at(-1);
    const plain = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = excerpt === undefined ? "" : plain(excerpt);
    const from = wanted === "" ? reply : (messages.filter((m) => plain(m.text).includes(wanted)).at(-1) ?? reply);
    if (!from) throw new LoreError("not_found", "the chat has no reply to save yet");
    const content = (wanted === "" ? from.text : (excerpt ?? "")).trim().slice(0, SAVED_MAX_CHARS);
    const title = savedTitle(content);
    const base = `lore_${topicIdOf(title.split(/\s+/).slice(0, 5).join(" ")) || "saved"}`;
    let id = base;
    try {
      await this.deps.worlds.worlds.editFrom(world, user, (draft) => {
        for (let n = 2; hasOwn(draft.lore, id); n++) id = `${base}_${n}`;
        const value: JsonObject = { id, title, content, keys: [], links: [], source: { kind: "chat", chatId: chat, messageId: from.id } };
        return { lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "", worldId: world, base: null, op: "put", collection: "lore", id, value };
      });
    } catch (error) {
      if (error instanceof WorldError) throw new LoreError(error.code === "not_found" ? "not_found" : "bad_request", error.message);
      throw error;
    }
    return { worldId: world, id };
  }
}
