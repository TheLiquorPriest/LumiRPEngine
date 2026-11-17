// What the lore reads, and from where (plan §9.1, §4.2): the user's Lumiverse books, read-only and
// only that user's rows, through the adapter; the world's own lore and who knows what, in the chat's
// world as its path stands, from the store; and which entries Lumiverse activated for a turn, which
// the turn's tag carried. Each is an interface here, so the lore holds no knowledge of Lumiverse.

import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import type { JsonObject } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import type { Store } from "../store/store";
import { horizonOf } from "../store/view";
import { StoreInputError } from "../store/types";
import { type OverlayRow, overlayRows } from "./overlays";

/** A Lumiverse book, as the lore names it. */
export interface LoreBook {
  id: string;
  name: string;
}

/** A Lumiverse book entry, as the lore reads it. */
export interface LoreBookEntry {
  /** Lumiverse's id of the entry. */
  id: string;
  /** Its book's id. */
  book: string;
  /** What Lumiverse's editor shows as the entry's title. */
  comment: string;
  content: string;
  /** The keys that activate it. */
  keys: string[];
  /** The keys Lumiverse checks beside them. */
  secondaryKeys: string[];
  disabled: boolean;
  /** Lumiverse activates it whatever the chat says. */
  constant: boolean;
  /** Lumiverse may activate it by meaning as well as by its keys. */
  vectorized: boolean;
  /** Its extension data, where today's build kept fields of its own. */
  extensions: JsonObject;
  /** Lumiverse's revision of it, raised by every change to it: what an index line and a write are checked against. */
  revision: number;
}

/** Who a generation is for, as the turn's tag says: the character speaking and the persona in use (their ids in Lumiverse). */
export interface LoreGeneration {
  speaker?: string | null;
  persona?: string | null;
}

/** One of the user's books as his choice of books lists it. */
export interface LoreBookListing {
  id: string;
  name: string;
  /** Whether the chat asked about has it attached. */
  attached: boolean;
  /** Whether a character brought it. */
  character: boolean;
  /** When Lumiverse made it, in seconds; null where it records none. */
  added: number | null;
}

/** A word a search asks the lore search index for: whole, or (`prefix`) as the start of a word, so a plural is found by its singular. */
export interface LoreIndexWord {
  text: string;
  prefix: boolean;
}

/** The user's Lumiverse books, read-only: every call reads that user's rows and no other's. */
export interface LoreBooks {
  /**
   * The books attached to the chat, as Lumiverse scans them for it: its character's, its persona's,
   * the chat's own and the user's global ones; a group chat's members' too, by its setting and mutes.
   * With `at`, as Lumiverse takes them for that generation: the speaker's books in a group chat, the
   * generation's persona, and no persona's book in a temporary chat.
   */
  attached(user: string, chat: string, at?: LoreGeneration): Promise<string[]>;
  /** One of the user's books; null when the user has none by that id. */
  book(user: string, id: string): Promise<LoreBook | null>;
  /** A book's entries, in Lumiverse's order; none for a book that is not the user's. */
  entries(user: string, book: string): Promise<LoreBookEntry[]>;
  /** One entry of any of the user's books; null when the user has none by that id. */
  entry(user: string, id: string): Promise<LoreBookEntry | null>;
  /** Every book of the user's, as a Settings page lists them for his choice of books (`lore.books`); `chat` says which have the chat attached. Absent where the host lists none. */
  list?(user: string, chat: string | null): Promise<LoreBookListing[]>;
  /**
   * The entries of `books` the lore search index finds for any of `words` (plan §4.2 "No copy"), each word asked of the entries' names and of their
   * whole texts, at most `limit` hits for each ask: those entries' rows alone, in each book's order. Absent where the host keeps no index: a search
   * then reads every entry of the books.
   */
  found?(user: string, books: readonly string[], words: readonly LoreIndexWord[], limit: number): Promise<LoreBookEntry[]>;
}

/** A chat's world where a point of its path stands. */
export interface WorldAt {
  registry: Registry;
  world: WorldDoc;
  /** Read it, never change it: it may be the store's own. */
  state: Readonly<WorldState>;
  /** The Author's horizon there (plan §6.4), as tree refs, in its order; absent where the reader keeps none. */
  horizon?: readonly string[];
}

/** The chats' worlds. */
export interface LoreWorlds {
  /** The registry every world is read with. */
  readonly registry: Registry;
  /** The chat's world at `turn`, with what that turn has staged, else at the head of its path; null when the chat has no world. */
  at(user: string, chat: string, turn?: string): WorldAt | null;
  /**
   * The name of the cast's character `said` names, by its id or its name, in the chat or one it was
   * branched from; null when none is. Absent where no cast is kept.
   */
  castName?(user: string, chat: string, said: string): string | null;
}

/** An entry Lumiverse activated for a turn's prompt, as the turn's tag carries it. */
export interface ActivatedEntry {
  /** Lumiverse's id of the entry. */
  id: string;
  /** Its book's id, where Lumiverse said. */
  book: string | null;
  /** Its title as Lumiverse gave it. */
  title: string;
  /** How it activated, in Lumiverse's word, where Lumiverse said. */
  how: string | null;
}

/** What the check of the lore on receipt did to one entry: kept it out of the prompt, worded it otherwise, or did not find its text there. */
export const LORE_RECEIPTS = ["kept-out", "reworded", "not-found"] as const;
export type LoreReceipt = (typeof LORE_RECEIPTS)[number];

/** What activated for each turn's prompt. */
export interface LoreTurns {
  /** The entries activated for the prompt of `turn`, in the tag's order; null when RPE holds no tag for that turn. */
  activated(user: string, chat: string, turn: string): Promise<readonly ActivatedEntry[] | null>;
  /** Who the turn's generation was for, from its tag; null where RPE holds no tag for it. Absent where the host keeps none: the books are then those the chat has. */
  generation?(user: string, chat: string, turn: string): Promise<LoreGeneration | null>;
  /**
   * What the check of the lore on receipt did to the entries Lumiverse activated for the prompt of `turn`, each by Lumiverse's id: kept out
   * of the prompt, worded otherwise, or not found in it (so the verdict was not applied). Null where nothing was checked (the extension
   * applied RPE's own verdict), or RPE holds no prompt for the turn. Absent where the host keeps none.
   */
  receipt?(user: string, chat: string, turn: string): Promise<ReadonlyMap<string, LoreReceipt> | null>;
}

/**
 * The chats' worlds as the store folds them: the world document in force, the state and the horizon,
 * at a turn or at the head. The cast's characters are the cast's: the host that keeps both gives
 * `castName`, which the lore may not reach itself.
 */
export function storeWorlds(store: Store, castName?: LoreWorlds["castName"]): LoreWorlds {
  const registry = store.env.registry;
  return {
    registry,
    at(user, chat, turn) {
      const s = store.user(user);
      const row = s.chat(chat);
      if (row === null || row.revision === null) return null;
      if (turn !== undefined && s.turn(turn)?.chat !== chat) throw new StoreInputError(`turn ${turn} is not one of chat ${chat}'s`);
      const folded = (turn === undefined ? s.headState(chat) : s.stateAt(turn)).state;
      const state = folded.world;
      const world = store.env.worlds(state.revision);
      if (world === undefined) throw new Error(`The world revision ${state.revision} that chat ${chat} stands on is not available, so its lore cannot be read.`);
      return { registry, world, state, horizon: horizonOf(store.env, folded).map((h) => h.at) };
    },
    ...(castName !== undefined ? { castName } : {}),
  };
}

/** What a reading of what RPE keeps beside the lore sees: the story's overlays as the store folded them at a point, so what a swipe or a delete takes off a chat's path goes with its turn. */
export interface LorePath {
  /**
   * The overlays on the chat's path, in the path's order: at its head, those of the turns on the path as the store last compared
   * it; at `turn`, those of the turns it was made after and the turn itself, so a turn sees what it wrote before its reply is tied.
   */
  overlays(user: string, chat: string, turn?: string): readonly OverlayRow[];
}

/** The chats' paths as the store keeps them, read as the story record reads its own (plan §6.3). */
export function storePath(store: Store): LorePath {
  return { overlays: (user, chat, turn) => overlayRows(store, user, chat, turn ?? null) };
}
