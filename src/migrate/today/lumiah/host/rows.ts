// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/host/rows.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// What both ends read of Lumiverse's chats and world books (PI-BUILD-PLAN §4.5): the rows the
// extension's host gives (spindle.ts makes them from Spindle's answers), and the reads of them the
// shared logic in this folder runs over. The extension's backend reads them through Spindle; the
// runtime through its copy of chat and lore (runtime/copy/), which gives the very same rows, and over
// the link wherever the copy can't vouch for one.
//
// Nothing in this folder reaches Spindle, the filesystem, a socket or a model's library: the
// extension's backend bundles it, and Lumiverse refuses a backend that does.

import type { ChatRole, JsonObject, JsonValue } from "../core/ports";

export interface HostChat {
  id: string;
  name: string;
  characterId: string | null;
  metadata: JsonObject;
}

/** A chat message with the swipe it shows and what LumiAH keeps on it. */
export interface HostMessage {
  id: string;
  /** Its place in the chat, from 0. */
  index: number;
  role: ChatRole;
  name: string;
  swipeId: number;
  /** How many swipes it has. */
  swipes: number;
  /** The text of the swipe it shows. */
  content: string;
  /** The user hid it from the prompt: Lumiverse's own mark on the message, which its prompt assembly passes over. False where Lumiverse doesn't say. */
  hidden: boolean;
  /** LumiAH's own entry in the message's extension metadata; null when it has none. */
  own: JsonValue | null;
  /** When it was sent, in milliseconds since 1970; null where Lumiverse has no time for it. */
  at: number | null;
}

export interface HostBook {
  id: string;
  name: string;
  description: string;
}

export interface HostBookEntry {
  id: string;
  bookId: string;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
}

/** A world book as the lore and history tools read it (DESIGN §24): with what its makers keep on it, and when it last changed. */
export interface HostBookRecord extends HostBook {
  /** The book's own metadata: where an extension marks a book it made (LumiBooks marks a chat's book with the chat). */
  metadata: JsonObject;
  /** When the book or any entry of it last changed, in milliseconds since 1970, as Lumiverse stamps it: to the second. 0 where it has no stamp. */
  updatedAt: number;
}

/** An entry with the state Lumiverse keeps on it beside its text, and what extensions keep on it. */
export interface HostEntryRecord extends HostBookEntry {
  /** Lumiverse may activate it by a vector match as well as by its keys. */
  vectorized: boolean;
  /** Its keys are regular expressions, not words. */
  regex: boolean;
  /** As whose message it goes into the prompt; null: as the preset's World Info marker has it. */
  role: ChatRole | null;
  /** Its order among the entries put in one place: the lower comes first. */
  order: number;
  /** When it last changed, in milliseconds since 1970; 0 where Lumiverse has no stamp. */
  updatedAt: number;
  /** What extensions keep on the entry, each under its own key. */
  extensions: JsonObject;
}

/** A World Info entry Lumiverse activated for a prompt: which, of which book, and how it got there (a key matched, or a match by meaning with its score), where Lumiverse says. */
export interface ActivatedInfo {
  entryId: string;
  bookId: string | null;
  title: string;
  how?: "key" | "vector";
  score?: number;
}

/** What is read of a user's chats. Every call names its user, or reads by a chat's id alone, which a caller checks is the user's first (`ChatReader.own`). */
export interface ChatReads {
  get(chatId: string, userId: string): Promise<HostChat | null>;
  /** The chat's messages in chat order: all of them, `count` from the `from`th, or the last `tail`. */
  messages(chatId: string, range?: { from: number; count: number } | { tail: number }): Promise<HostMessage[]>;
  /** The text of one swipe of a message, shown or not; null when there is no such message or swipe, or its text can't be read. */
  swipe(chatId: string, messageId: string, swipe: number): Promise<string | null>;
  /** The user's chats, `limit` of them from the `offset`th in an order that holds still, and how many they have in all. */
  list(userId: string, offset: number, limit: number): Promise<{ chats: HostChat[]; total: number }>;
  /** A character's name; null when there is no such character, or the permission to read characters isn't granted. */
  characterName(characterId: string, userId: string): Promise<string | null>;
  /**
   * Whether Lumiverse's Sovereign Hand is on for the user in a chat (DESIGN §24.4): what a story
   * that follows Lumiverse reads. Null where Lumiverse doesn't tell extensions.
   */
  sovereignHand(chatId: string, userId: string): Promise<boolean | null>;
}

/** What is read of a user's world books, and of what attaches one to a chat. */
export interface LoreReads {
  /** A book of the user's; null when they have none such, or the permission to read world books isn't granted. */
  book(bookId: string, userId: string): Promise<HostBook | null>;
  /** A book's entries, in the book's order; none without that permission. */
  entries(bookId: string, userId: string): Promise<HostBookEntry[]>;
  /** One entry; null when there is none such, or without that permission. */
  entry(entryId: string, userId: string): Promise<HostBookEntry | null>;
  /** A book with what its makers keep on it and when it last changed; null as `book` is. */
  record(bookId: string, userId: string): Promise<HostBookRecord | null>;
  /** A book's entries, in the book's order, each with its state and what extensions keep on it; none as `entries` are. */
  records(bookId: string, userId: string): Promise<HostEntryRecord[]>;
  /** The books switched on for every chat; none without that permission. */
  global(userId: string): Promise<string[]>;
  /** The books attached to a character, and the one attached to a persona; none where the permission to read them isn't granted. */
  ofCharacter(characterId: string, userId: string): Promise<string[]>;
  /** The book attached to a persona (null: to the user's active persona); none where there is no such persona or the permission to read it isn't granted. */
  ofPersona(personaId: string | null, userId: string): Promise<string | null>;
}

/** The reads the shared logic runs over: the extension's own host, or the runtime's copy. */
export interface HostReads {
  chats: ChatReads;
  lore: LoreReads;
}
