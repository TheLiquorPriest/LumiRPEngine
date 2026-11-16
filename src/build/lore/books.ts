// His books as Build reads and writes them (plan §9; PlanChatUI-B3): the shapes the door and the lore's one recorded writer match, kept here as
// Build's own so it imports neither (a book entry is the door's `LoreBookEntry` as the lore reads it), and the views the pickers and the lore
// editor show of a book and its entries: LRE's fields, the secret marks in an entry's text and what starts like one that can't be read.

import type { JsonObject } from "../../shared/json";
import { bookLoreFieldsOf, engineWroteEntry, secretCopyOf } from "../../shared/lore";
import type { LoreBookEntryView, LoreBookView } from "../../shared/lore-views";
import { parseSecretMarks, unreadableMarks, wholeEntrySecret } from "../../shared/secret-marks";
import { bookEntryTitle } from "../../secrecy/book-lore";

/** One entry of a book as the door reads it: what Build shows of it and what it writes back. */
export interface BookEntry {
  id: string;
  book: string;
  comment: string;
  content: string;
  keys: string[];
  disabled: boolean;
  extensions: JsonObject;
  /** Lumiverse's revision of it: a write names the one it was read at and is refused where the entry has moved on. */
  revision: number;
}

/** His books, read: each as a picker lists it (the engine's own left out), a book's entries, one entry. Another user's books are none of his. */
export interface BuildBooks {
  /** Every book of his as a picker lists it; absent where the door lists none. */
  list?(user: string, chat: string | null): Promise<LoreBookView[]>;
  entries(user: string, book: string): Promise<BookEntry[]>;
  entry(user: string, id: string, book?: string): Promise<BookEntry | null>;
}

/** The fields of an entry a write sets: its text, title and keys, and where Build means to change them, its switch and its extension data. */
export interface BookWrite {
  content: string;
  comment: string;
  keys: string[];
  disabled?: boolean;
  extensions?: JsonObject;
}

/** Why a write was not made: the entry changed after it was read, is gone, or a draft of a world stands in the way. */
export type WriteRefused = "changed" | "missing" | "draft";

/** The one recorded writer over his books, revision-checked, each write kept with the entry before and after so it can be put back. */
export interface BuildWrites {
  edit(user: string, entry: string, fields: BookWrite, revision: number): Promise<{ written: { id: number } } | { refused: WriteRefused }>;
}

/** An entry as the page shows it in a book's list, in the book's order. */
export function entryView(e: BookEntry): LoreBookEntryView {
  const lore = bookLoreFieldsOf(e.extensions);
  const marks = parseSecretMarks(e.content).map((m) => ({ text: m.text, knownTo: m.knownTo, keptFrom: m.keptFrom }));
  const unreadable = unreadableMarks(e.content).map((u) => ({ raw: u.raw, problem: u.problem }));
  const note = secretCopyOf(e.extensions);
  const slash = note ? note.entry.indexOf("/") : -1;
  return {
    id: e.id,
    title: bookEntryTitle(e),
    disabled: e.disabled,
    chars: e.content.length,
    revision: e.revision,
    ...(lore ? { lore } : {}),
    ...(marks.length > 0 ? { marks } : {}),
    ...(wholeEntrySecret(e.content) ? { whole: true as const } : {}),
    ...(unreadable.length > 0 ? { unreadable } : {}),
    ...(note && slash > 0 ? { copyOf: { bookId: note.entry.slice(0, slash), entryId: note.entry.slice(slash + 1) } } : {}),
  };
}

/** Whether the engine wrote the entry (its own books' sections): never read or written through Build's lore. */
export const engineWrote = (e: Pick<BookEntry, "extensions">): boolean => engineWroteEntry(e.extensions);

/** His books as a picker lists them; refused in words where the door gives no list. */
export async function listBooks(books: BuildBooks, user: string, chat: string | null): Promise<LoreBookView[]> {
  if (books.list === undefined) throw new Error("The door's books give no list of the user's books.");
  return await books.list(user, chat);
}
