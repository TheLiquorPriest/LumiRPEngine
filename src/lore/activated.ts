// The lore Lumiverse activated for a turn, as the floor and the Turn page read it (plan §9.1, §4.2): the
// entries of the turn's tag, in the order the tag lists them, each by the id the lore map gives it (`e-<n>`,
// RPE's own number for the entry) beside Lumiverse's ids of the entry and its book, its title, and how it
// activated as far as the tag says. One reader: the route of `./routes.ts` serves it and the turn folder's
// lore file calls it, so the tag is read one way only.
//
// It reads the tag and the numbers the lore map is made with and nothing else: no book is opened for a
// title the tag left empty, so the lore map, which does, may title such an entry from its text where this
// says nothing. An entry the lore map has not numbered yet is numbered here as the map numbers it, so the
// id it is given now is the one the map will give it.

import { bookEntryId, type EntryNumbers } from "./ids";
import { HOWS } from "./lore";
import type { LoreTurns } from "./sources";

/** How an entry activated, in the lore's own four words. */
export type ActivationWord = (typeof HOWS)[number];

/** An entry Lumiverse activated for a turn's prompt, as the floor reads it. */
export interface ActivatedLoreEntry {
  /** The lore map's id of the entry: `e-` and its number. */
  id: string;
  /** Lumiverse's id of the entry. */
  entry: string;
  /** Lumiverse's id of its book; empty where the tag does not say. */
  book: string;
  /** Its title as the tag gave it, its whitespace folded as the lore map folds it. */
  title: string;
  /** How it activated; null where the tag does not say, or says a word the lore has none for. */
  how: ActivationWord | null;
}

/** What the reader reads: the turns' tags and the numbers of the user's entries. */
export interface ActivatedLoreDeps {
  turns: LoreTurns;
  numbers: EntryNumbers;
}

/**
 * The entries Lumiverse activated for the prompt of `turn` of `chat`, in the tag's order. None for a
 * turn RPE holds no tag for, or one of another chat or another user: a tag is asked for by all three.
 */
export async function activatedLore(deps: ActivatedLoreDeps, user: string, chat: string, turn: string): Promise<ActivatedLoreEntry[]> {
  const tag = await deps.turns.activated(user, chat, turn);
  if (tag === null || tag.length === 0) return [];
  const numbers = await deps.numbers.of(user, tag.map((e) => e.id));
  return tag.map((e): ActivatedLoreEntry => {
    const n = numbers.get(e.id);
    if (n === undefined) throw new Error(`RPE gave lore entry ${e.id} no number, so the turn ${turn}'s activated lore cannot name it.`);
    return { id: bookEntryId(n), entry: e.id, book: e.book ?? "", title: e.title.replace(/\s+/g, " ").trim(), how: HOWS.find((h) => h === e.how) ?? null };
  });
}
