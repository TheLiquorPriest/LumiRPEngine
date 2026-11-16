// How each lore entry Lumiverse activated for a generation came into the prompt (STANDALONE-PLAN §4.2
// l.216, §9.2; READINGS N-5): always on, by one of its keys, by meaning, or still in force from an
// earlier turn. Lumiverse's event says "keyword" or "vector" and nothing more (`WORLD_INFO_ACTIVATED`
// carries the entry's `source`), so the rest is told from Lumiverse's own rows, at the moment the event
// is heard:
//
//   - a constant entry by its own flag (`world_book_entries.constant`);
//   - a vector hit by Lumiverse's `source`;
//   - a sticky window by the chat's `metadata.wi_state`, keyed by the entry's `uid` and saved before the
//     event is sent (`generate.service.ts:2827-2879`), so it holds this generation's counts: a keyword
//     match sets the entry's `stickyLeft` to its `sticky` (`world-info-activation.service.ts:846`), and
//     an entry brought back by its window counts one down first (`:454-470`). An entry with a sticky
//     setting whose count is below it came back as sticky; one whose count equals it was matched again,
//     which is a keyword match.
//
// Where the ways cannot be told apart the entry is left with no word and `told: false`: a count that
// equals the sticky setting after the setting was lowered while the window was open (the count the
// window left last time, less one, is the new setting: a match and a return look the same), an entry
// whose row or count is not there to read. The door never guesses; callers count what is not told.

import { isRecord } from "../../shared/json";
import type { LumiverseReads } from "./reads";
import type { LvEntry } from "./rows";
import type { TagLore } from "./wire";

/** The four ways an entry comes in. */
export const ACTIVATION_WORDS = ["constant", "keyword", "vector", "sticky"] as const;

export type ActivationWord = (typeof ACTIVATION_WORDS)[number];

/** What the door reads to tell an entry: the chat's metadata, books' entries, one entry, a book's name. */
export type ActivationReads = Pick<LumiverseReads, "chat" | "entries" | "entry" | "book">;

/** What an entry's count and sticky setting were when the chat's last generation was told: the next one compares. */
interface Seen {
  sticky: number;
  left: number;
}

/** The entries not told apart in a list of activated lore: what the turn counts. */
export function notTold(lore: readonly Pick<TagLore, "told">[]): number {
  return lore.filter((e) => !e.told).length;
}

/** One entry's way in, and whether it could be told. Pure: the rows are given. */
export function activationOf(entry: LvEntry | null, source: string | null, wiState: unknown, before: Seen | undefined): { how: ActivationWord | null; told: boolean; seen?: Seen } {
  if (entry !== null && entry.constant) return { how: "constant", told: true };
  if (source === "vector") return { how: "vector", told: true };
  if (entry === null) return { how: null, told: false };
  if (entry.sticky <= 0) return { how: "keyword", told: true };
  const state = isRecord(wiState) ? wiState[entry.uid] : undefined;
  const left = isRecord(state) && typeof state.stickyLeft === "number" && Number.isFinite(state.stickyLeft) ? state.stickyLeft : null;
  // A sticky entry has counts from its first match on: none to read says Lumiverse's own state was not as RPE reads it.
  if (left === null) return { how: null, told: false };
  const seen: Seen = { sticky: entry.sticky, left };
  // A match sets the count to the setting; coming back counts one down from what it was, so it is never above the setting but where the setting was lowered since.
  if (left !== entry.sticky) return { how: "sticky", told: true, seen };
  // Equal: matched again, unless the window was open at the last generation and its count less one is this setting, which a return also gives.
  if (before !== undefined && before.left - 1 === left) return { how: null, told: false, seen };
  return { how: "keyword", told: true, seen };
}

/** Tells each activated entry of a chat's generation. Remembers, per chat, only the counts it last saw. */
export class Activations {
  readonly #seen = new Map<string, Map<string, Seen>>();

  constructor(
    private readonly reads: ActivationReads,
    private readonly log: (message: string) => void,
  ) {}

  /** The entries as `lore` lists them, each told, with its book's name. A read that fails leaves every entry Lumiverse did not name the way of untold, and says so once. */
  async tell(chat: string, lore: readonly TagLore[]): Promise<TagLore[]> {
    if (lore.length === 0) return [];
    try {
      const [row, entries, names] = await Promise.all([this.reads.chat(chat), this.#entriesOf(lore), this.#namesOf(lore)]);
      const wiState = row?.metadata.wi_state;
      const before = this.#seen.get(chat);
      const now = new Map<string, Seen>();
      const told = lore.map((e): TagLore => {
        const entry = entries.get(e.id) ?? null;
        // Lumiverse's own word for it, where the event said one.
        if (e.told) return { ...e, bookName: e.bookName ?? (e.book === null ? null : (names.get(e.book) ?? null)) };
        const way = activationOf(entry, e.how, wiState, entry === null ? undefined : before?.get(entry.uid));
        if (entry !== null && way.seen !== undefined) now.set(entry.uid, way.seen);
        return { ...e, bookName: e.bookName ?? (e.book === null ? null : (names.get(e.book) ?? null)), how: way.how, told: way.told };
      });
      this.#seen.set(chat, now);
      return told;
    } catch (error) {
      this.log(`RPE could not tell how the lore of chat ${chat} came into its prompt: ${error instanceof Error ? error.message : String(error)}`);
      return lore.map((e) => (e.told || e.how === "vector" ? { ...e, how: e.how, told: true } : { ...e, how: null, told: false }));
    }
  }

  /** The entries of the books the lore names, by id (a book's rows are read once for all its entries); an entry with no known book is read alone. */
  async #entriesOf(lore: readonly TagLore[]): Promise<Map<string, LvEntry>> {
    const wanted = new Set(lore.filter((e) => !e.told).map((e) => e.id));
    const books = [...new Set(lore.flatMap((e) => (e.told || e.book === null ? [] : [e.book])))];
    const out = new Map<string, LvEntry>();
    await Promise.all([
      ...books.map(async (book) => {
        for (const entry of await this.reads.entries(book)) if (wanted.has(entry.id)) out.set(entry.id, entry);
      }),
      ...lore.filter((e) => !e.told && e.book === null).map(async (e) => {
        const entry = await this.reads.entry(e.id);
        if (entry !== null) out.set(e.id, entry);
      }),
    ]);
    return out;
  }

  /** The names of the books the lore names where the event gave none. */
  async #namesOf(lore: readonly TagLore[]): Promise<Map<string, string>> {
    const books = [...new Set(lore.flatMap((e) => (e.book === null || e.bookName !== null ? [] : [e.book])))];
    const found = await Promise.all(books.map((id) => this.reads.book(id)));
    return new Map(found.flatMap((b) => (b === null ? [] : [[b.id, b.name] as const])));
  }
}
