// The reads RPE makes of Lumiverse's own rows (STANDALONE-PLAN §4.2, "History, books, entries,
// characters, personas, presets, settings"): one interface over two sources, the database file read
// directly (`db.ts`) where RPE runs beside Lumiverse, and Lumiverse's HTTP routes as the signed-in
// user (`http-reads.ts`) where the file cannot be read. Every read is of one user's rows: the user RPE
// belongs to. Nothing is copied or written down: each read asks the source as it stands, or holds what
// it read for a few seconds, and lets it go the moment the rows change (`memo.ts`).

import type { JsonValue } from "../../shared/json";
import type { LvBook, LvCharacter, LvChat, LvEntry, LvMessage, LvPersona, LvPreset, LvSetting } from "./rows";

/** A message as the chat's path lists it: everything but its texts. */
export type LvStep = Omit<LvMessage, "text" | "name" | "sentAt" | "saves">;

/** A stretch of a chat's messages by their place on its path, from 0: `from` up to but not including `to`. */
export interface Places {
  from: number;
  to: number;
}

export interface LumiverseReads {
  /** Which source answers now. */
  readonly kind: "database" | "http";
  chat(chat: string): Promise<LvChat | null>;
  /** Every chat of the user's, in no order, as Lumiverse holds them now (never held). */
  chats(): Promise<LvChat[]>;
  /** The chat's messages in Lumiverse's order, every one listed with no text; null when there is no such chat of this user. `signal` ends a read that takes time (over HTTP). */
  path(chat: string, signal?: AbortSignal): Promise<LvStep[] | null>;
  /** The messages at these places on the chat's path, in order; a stretch past the end is cut to the chat. */
  messages(chat: string, places: Places): Promise<LvMessage[]>;
  /** These messages of the chat, by id; an id that is not the chat's is left out. */
  messagesById(chat: string, ids: readonly string[]): Promise<LvMessage[]>;
  book(book: string): Promise<LvBook | null>;
  /** Every book of the user's, in no order. */
  books(): Promise<LvBook[]>;
  /** A book's entries in Lumiverse's order (by order, then id); none for a book that is not this user's. */
  entries(book: string): Promise<LvEntry[]>;
  /**
   * One entry. Lumiverse has no route for one entry, so over HTTP a caller that knows the entry's book names it (the tag's lore
   * carries it) and only that book is read; with none named, the entry index says which book it is in.
   */
  entry(entry: string, book?: string): Promise<LvEntry | null>;
  character(character: string): Promise<LvCharacter | null>;
  /** Every character of the user's. */
  characters(): Promise<LvCharacter[]>;
  persona(persona: string): Promise<LvPersona | null>;
  /** The user's default persona, the one Lumiverse falls back on (`services/personas.service.ts:183-185`). */
  defaultPersona(): Promise<LvPersona | null>;
  preset(preset: string): Promise<LvPreset | null>;
  setting(key: string): Promise<LvSetting | null>;
  /** The breakdown Lumiverse stored with the chat's latest reply that has one (`generate.service.ts:4448-4476`); null when none is stored. */
  breakdown(chat: string): Promise<JsonValue | null>;
  /** Lets go of what was held of this chat's reads (its messages, its row): the next read of each reads Lumiverse again. Another chat's stay held. */
  dropChat(chat: string): void;
  /** An event Lumiverse sent: what was held of what it says changed is let go. */
  heard(event: string, payload: unknown): void;
}

/** The database reader turned itself off: every read goes to the other source. Its message is the one sentence saying why. */
export class SourceOff extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceOff";
  }
}

/**
 * The reads from the database, and from HTTP whenever the database reader refuses the file
 * (`SourceOff`): it is asked first every time, since a refusal lasts only until the file changes. Any
 * other failure is that read's own.
 */
export function preferDatabase(database: LumiverseReads & { state(): { off: string | null } }, http: LumiverseReads): LumiverseReads {
  const ask = async <T>(read: (source: LumiverseReads) => Promise<T>): Promise<T> => {
    try {
      return await read(database);
    } catch (error) {
      if (error instanceof SourceOff) return read(http);
      throw error;
    }
  };
  return {
    get kind() {
      return database.state().off === null ? database.kind : http.kind;
    },
    chat: (chat) => ask((s) => s.chat(chat)),
    chats: () => ask((s) => s.chats()),
    path: (chat, signal) => ask((s) => s.path(chat, signal)),
    messages: (chat, places) => ask((s) => s.messages(chat, places)),
    messagesById: (chat, ids) => ask((s) => s.messagesById(chat, ids)),
    book: (book) => ask((s) => s.book(book)),
    books: () => ask((s) => s.books()),
    entries: (book) => ask((s) => s.entries(book)),
    entry: (entry, book) => ask((s) => s.entry(entry, book)),
    character: (character) => ask((s) => s.character(character)),
    characters: () => ask((s) => s.characters()),
    persona: (persona) => ask((s) => s.persona(persona)),
    defaultPersona: () => ask((s) => s.defaultPersona()),
    preset: (preset) => ask((s) => s.preset(preset)),
    setting: (key) => ask((s) => s.setting(key)),
    breakdown: (chat) => ask((s) => s.breakdown(chat)),
    dropChat: (chat) => {
      database.dropChat(chat);
      http.dropChat(chat);
    },
    heard: (event, payload) => {
      database.heard(event, payload);
      http.heard(event, payload);
    },
  };
}
