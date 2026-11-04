// The lore index's shared half (DESIGN §4.2, Settings → Lore): the routing table that tells the
// agents where the lore is and what each entry holds, made from the World Info books LRE reads, live,
// with nothing copied. Each entry goes by a short id: the World Info key of its own that matches the
// tag pattern (`lr0101`), else one LRE gave it and keeps for good (`lre0001`, `backend/lore-ids.ts`).
// Here: an index's shape, how an entry's tag and its holds line are read, and the registry texts it
// is worded in (the Every agent page's "Lore index" group), each with a reset. Pure.

import type { PromptDef, PromptVar } from "./prompts";

/** One entry of the index: its short id, its lore id (`book:<bookId>/<entryId>`), its title and what it holds beside it. */
export interface RoutingEntry {
  id: string;
  lore: string;
  entryId: string;
  title: string;
  /** A line of what it holds where its title doesn't say it; null for none, and for a secret, whose words its readers read whole. */
  holds: string | null;
  /** Whether anyone may read it: public, not a secret, not an AI entry waiting for review. Build's index entry lists these alone. */
  open: boolean;
}

/** One book's entries, in the book's own order. */
export interface RoutingBook {
  bookId: string;
  name: string;
  entries: RoutingEntry[];
}

/** The index: its books in the order they are read, and the hash of what it was made from, which keys its cache. */
export interface RoutingIndex {
  hash: string;
  books: RoutingBook[];
}

/** An entry's key in the id map: `bookId/entryId`, which the lore tools take too. */
export function entryKey(bookId: string, entryId: string): string {
  return `${bookId}/${entryId}`;
}

/** The entry's tag: the first of its own keys, trimmed, that `pattern` matches; null when none does. */
export function tagOf(keys: readonly string[], pattern: RegExp | null): string | null {
  if (!pattern) return null;
  for (const key of keys) {
    const tag = key.trim();
    if (tag !== "" && pattern.test(tag)) return tag;
  }
  return null;
}

const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * What an entry holds, in a line beside its title: the first line of its text, cut at a word to
 * `max` characters; null when it says nothing the title doesn't (an entry with no comment is titled
 * by its first words), when its text is empty, or when `max` is 0.
 */
export function holdsOf(title: string, text: string, max: number): string | null {
  if (max <= 0) return null;
  const line = squeeze(text.split("\n").find((l) => l.trim() !== "") ?? "");
  if (line === "") return null;
  const said = squeeze(title.replace(/…$/, "")).toLowerCase();
  if (said.startsWith(line.toLowerCase())) return null;
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > 0 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

/** The index's registry texts, so code names them once. */
export const LORE_INDEX_TEXT = {
  lead: "lore.index.lead",
  book: "lore.index.book",
  entry: "lore.index.entry",
  holds: "lore.index.holds",
  separator: "lore.index.separator",
  none: "lore.index.none",
  cut: "lore.index.cut",
  built: "lore.index.built",
} as const;

const GROUP = "Lore index";
const BOOKS: PromptVar = { name: "books", text: "a line per book, each as below", required: true };
const ID: PromptVar = { name: "id", text: "the entry's short id: its tag, else the id LRE gave it", required: true };
const TITLE: PromptVar = { name: "title", text: "the entry's title: its comment, else its first words" };

/** The index's texts, on `page` (the Every agent page, beside the tools' texts and answers). */
export function loreIndexPrompts(page: string): PromptDef[] {
  return [
    {
      id: LORE_INDEX_TEXT.lead,
      page,
      group: GROUP,
      label: "The lore index",
      note: "The index the agents read: lore_index's answer, and the prompt of a role whose context starts with it (Settings → Agents → Context). Unless you set your own index entry in Settings → Lore.",
      text: "Lore index: every lore entry of the World Info books read here, by book: its id and title, and what it holds where the title doesn't say. Read an entry whole with lore_read and its id. In a turn, lore_load and its id put an entry into the prompt of the reply the turn is writing.\n{{books}}",
      vars: [BOOKS],
    },
    { id: LORE_INDEX_TEXT.book, page, group: GROUP, label: "A book's line", note: "One book of the index, with its entries.", text: "{{book}}: {{entries}}", vars: [{ name: "book", text: "the book's name" }, { name: "entries", text: "its entries, each as below, joined by the separator", required: true }] },
    { id: LORE_INDEX_TEXT.entry, page, group: GROUP, label: "An entry", note: "One entry of a book's line, whose title says what it holds.", text: "{{id}} {{title}}", vars: [ID, TITLE] },
    { id: LORE_INDEX_TEXT.holds, page, group: GROUP, label: "An entry with what it holds", note: "One entry of a book's line whose text says more than its title: the first line of its text, within Settings → Lore's length.", text: "{{id}} {{title}} ({{holds}})", vars: [ID, TITLE, { name: "holds", text: "the first line of the entry's text", required: true }] },
    { id: LORE_INDEX_TEXT.separator, page, group: GROUP, label: "Between entries", note: "Joins the entries of a book's line.", text: " · ", vars: [], nonEmpty: true },
    { id: LORE_INDEX_TEXT.none, page, group: GROUP, label: "No entries", note: "Stands in for the books' lines when no book read here holds an entry the agent may read.", text: "(No lore entries in the World Info books read here.)", vars: [] },
    { id: LORE_INDEX_TEXT.cut, page, group: GROUP, label: "Past the budget", note: "Ends the index in a role's prompt when it runs past Settings → Lore's tokens for it: how many of its entries (or of your own index's lines) are left out.", text: "({{count}} more {{what}} past this index's budget: lore_index gives the whole index.)", vars: [{ name: "count", text: "how many entries, or lines of your own index, are left out", required: true }, { name: "what", text: '"entry" or "line" for 1, else "entries" or "lines"' }] },
    {
      id: LORE_INDEX_TEXT.built,
      page,
      group: GROUP,
      label: "The index entry Build writes",
      note: "The text of the World Info entry Build → Lore writes and keeps in sync, which reaches the narrator as any entry of its book does: every entry by its id and title, a secret or restricted one inside its secret mark (Secret marks texts).",
      text: "LORE INDEX: the lore entries of the World Info books, by book: each entry's id and title, and what it holds where the title doesn't say.\n{{books}}",
      vars: [BOOKS],
    },
  ];
}
