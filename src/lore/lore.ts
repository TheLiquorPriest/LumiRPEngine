// One reader over both sources of a chat's lore (plan §9.1, §9.4): the user's Lumiverse books, read
// live and read-only, and the world's own lore, in the chat's world where its path stands. Every
// entry goes by an id that says its source (`ids.ts`), with its title and keys; a world entry also
// says who may know it.
//
// Who may know a world entry is today's own rule, called as it is (`engine/lore.ts` `loreReadable`):
// an entry known only to those who would know it is read by a character once that character knows
// every person and place it links; a secret is read by its holders, gate or no gate, and by no other
// character, ever; an entry an agent wrote that still awaits the user's review is the GM's alone. As
// shipped the lead and the GM read every entry, a world entry marked with who may know it now.
//
// The search is today's too (`loreSearch`), over both sources at once as today's lore tools search
// (`backend/agents/tools/lore.ts:350-366`): the world's lookup table, aliases, keys, titles and topics,
// then the words of each entry. A book entry's own secrecy (its secret marks, today's fields on it,
// the copies of secrets) is the secrets' to carry (§9.6): until then its marked parts are left out
// of what any reader is given, and a book entry is given to no character.

import type { ActivatedLore, LoreEntry, LoreHit, LoreKnowing, LoreQuery } from "rp-harness/contract";
import { blankWorld } from "../engine/authoring";
import { loreReadable, loreSearch, wordsOf } from "../engine/lore";
import { isGone, kindIs } from "../engine/scope";
import { loreGateReader } from "../engine/visibility";
import { initialState } from "../engine/world-state";
import { hashJson } from "../shared/hash";
import type { EntityId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { bookLoreFieldsOf, engineWroteEntry, loreBooksOf, loreIsSecret, loreSourceOf } from "../shared/lore";
import { publicText } from "../shared/secret-marks";
import type { LoreEntryDef, StepPurpose } from "../shared/world";
import { bookEntryId, type EntryNumbers, loreRefOf, worldEntryId } from "./ids";
import { type KeyMatching, keysIn, LUMIVERSE_KEY_MATCHING } from "./keys";
import type { LoreMap, LoreMapLine } from "./map";
import type { ActivatedEntry, LoreBook, LoreBookEntry, LoreBooks, LoreTurns, LoreWorlds, WorldAt } from "./sources";

/** The lore's settings. */
export interface LoreSettings {
  /** Hits a search gives when the query sets no limit of its own. */
  searchLimit: number;
  /** Characters of an entry's text a hit's snippet keeps on each side of the first word the search matched. */
  snippetChars: number;
  /** Words of its text that title a book entry with no title of its own (today's, `backend/book-lore.ts:26`). */
  titleWords: number;
}

export const LORE_DEFAULTS: Readonly<LoreSettings> = Object.freeze({ searchLimit: 20, snippetChars: 80, titleWords: 8 });

export interface LoreOptions {
  books: LoreBooks;
  worlds: LoreWorlds;
  turns: LoreTurns;
  numbers: EntryNumbers;
  settings?: Partial<LoreSettings>;
}

/** Whose lore, which chat, and where on its path: at a turn, with what it has staged, else at the head. */
export interface LoreAt {
  user: string;
  chat: string;
  turn?: string;
}

/** What a lore map is built from: the turn, whose tag says what activated, and the recent messages. */
export interface LoreMapAsk extends LoreAt {
  turn: string;
  /** Each recent message's text, as Lumiverse scans it for keys. */
  messages: readonly string[];
  /** How the user's Lumiverse matches keys; its defaults when absent. */
  matching?: KeyMatching;
}

/**
 * How today's code reads lore as a character: as the minds read it, the character named
 * (`backend/minds-context.ts:519,528`). Once a character is named, every purpose but the GM's reads alike.
 */
const AS_CHARACTER: StepPurpose = "mind";

/** How an entry activated, in the words of the contract; anything else Lumiverse says is left unsaid. */
const HOWS = ["constant", "keyword", "vector", "sticky"] as const;

/** A world entry an earlier build copied from a book entry: today's lore reads the book entry instead, as its book has it now (`backend/book-lore.ts:296-338`). */
function isCopy(entry: LoreEntryDef): boolean {
  return loreSourceOf(entry.source).kind === "book";
}

/** A world entry's title as today's views give it: its own, else its key. */
function worldTitle(entry: LoreEntryDef, key: string): string {
  return typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : key;
}

/** A book entry's title: its own, else the first words of what anyone may read of its text, as today's (`backend/book-lore.ts:28-39`). */
function bookTitle(row: LoreBookEntry, words: number): string {
  const comment = row.comment.replace(/\s+/g, " ").trim();
  if (comment !== "") return comment;
  const all = publicText(row.content).replace(/\s+/g, " ").trim().split(" ").filter((w) => w !== "");
  return all.length > words ? `${all.slice(0, words).join(" ")}…` : all.join(" ");
}

/** Whether a book entry is lore, as today's build reads books (`backend/book-lore.ts:179-183`): not one the engine wrote, not empty, and not one its author switched off without giving it fields of today's. */
function isLore(row: LoreBookEntry): boolean {
  return !engineWroteEntry(row.extensions) && row.content.trim() !== "" && !(row.disabled && bookLoreFieldsOf(row.extensions) === null);
}

/**
 * A book entry as today's search reads it (`backend/book-lore.ts:134-147`, less what holds it back,
 * which is the secrets'): its title, its keys, its secondary keys and today's aliases as other names,
 * today's links, and what anyone may read of its text.
 */
function searchDef(key: string, row: LoreBookEntry, title: string, text: string): LoreEntryDef {
  const fields = bookLoreFieldsOf(row.extensions);
  const aliases = [...new Set([...(fields?.aliases ?? []), ...row.secondaryKeys].map((a) => a.trim()).filter((a) => a !== ""))];
  return { id: key, title, content: text, keys: row.keys.filter((k) => k.trim() !== ""), links: fields?.links ?? [], ...(aliases.length > 0 ? { aliases } : {}) };
}

/** The world's people, who may know an entry: those whose kind is a person's and who are still in the world, as today's knowers are (`backend/agents/tools/read-view.ts:223-233`). */
function peopleOf(at: WorldAt): EntityId[] {
  return Object.keys(at.state.entities).filter((id) => {
    const e = at.state.entities[id];
    return e !== undefined && kindIs(at.registry, at.world, e.kind, "person") && !isGone(at.state, id);
  });
}

/**
 * Who may know a world entry, as the lead sees it marked: nothing for an entry anyone may know; else
 * the people of the world who may know it now, each asked by today's rule as a character. An entry
 * is held to some when it is a secret, awaits review, or is not public: the cases in which today's
 * rule can refuse a character.
 */
function knowingOf(at: WorldAt, entry: LoreEntryDef, open: (entry: LoreEntryDef) => boolean, people: readonly EntityId[]): LoreKnowing | undefined {
  const source = loreSourceOf(entry.source);
  const visibility: unknown = entry.visibility;
  if (!loreIsSecret(entry) && !(source.kind === "ai" && source.status === "pending") && (visibility === undefined || visibility === "public")) return undefined;
  const names = people.filter((who) => loreReadable(at.registry, at.world, at.state, entry, AS_CHARACTER, false, open, who)).map((who) => at.state.entities[who]?.name ?? who);
  return { by: "characters", names };
}

function worldEntry(at: WorldAt, key: string, entry: LoreEntryDef, knowing?: LoreKnowing): LoreEntry {
  const title = worldTitle(entry, key);
  const keys = Array.isArray(entry.keys) ? entry.keys.filter((k): k is string => typeof k === "string") : [];
  const content = typeof entry.content === "string" ? entry.content : "";
  return { id: worldEntryId(key), source: at.world.name, title, keys, text: publicText(content), revision: hashJson([title, keys, content]), ...(knowing ? { knowing } : {}) };
}

function bookEntry(n: number, row: LoreBookEntry, book: LoreBook, title: string): LoreEntry {
  const keys = row.keys.filter((k) => k.trim() !== "");
  return { id: bookEntryId(n), source: book.name, title, keys, text: publicText(row.content), revision: hashJson([title, keys, row.secondaryKeys, row.content]) };
}

/** The words around the first of `words` in `text`, each side cut at a word; the start of the text where none of them is in it. */
function snippetOf(text: string, words: readonly string[], room: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // `wordsOf` gives letters and digits only, so the words go into the pattern as they are.
  const found = words.length > 0 ? new RegExp(words.join("|"), "iu").exec(flat) : null;
  const at = found?.index ?? 0;
  const end = found ? at + found[0].length : 0;
  let from = Math.max(0, at - room);
  let to = Math.min(flat.length, end + (found ? room : 2 * room));
  if (from > 0) {
    const space = flat.indexOf(" ", from);
    if (space >= 0 && space < at) from = space + 1;
  }
  if (to < flat.length) {
    const space = flat.lastIndexOf(" ", to);
    if (space > end) to = space;
  }
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}

/** What a search found, before its book entries are numbered. */
type Found = { kind: "world"; id: string; source: string; title: string; text: string } | { kind: "book"; entry: string; source: string; title: string; text: string };

export class Lore {
  private readonly books: LoreBooks;
  private readonly worlds: LoreWorlds;
  private readonly turns: LoreTurns;
  private readonly numbers: EntryNumbers;
  private readonly settings: Readonly<LoreSettings>;
  private blank: WorldAt | null = null;

  constructor(options: LoreOptions) {
    this.books = options.books;
    this.worlds = options.worlds;
    this.turns = options.turns;
    this.numbers = options.numbers;
    this.settings = Object.freeze({ ...LORE_DEFAULTS, ...options.settings });
  }

  /** Entries in full, in the order asked, as the lead and the GM read them: every entry, a world entry marked with who may know it. An id that names nothing is left out. */
  read(at: LoreAt, ids: readonly string[]): Promise<LoreEntry[]> {
    return this.entries(at, ids);
  }

  /** The entries asked for that `character` may know, in the order asked: world entries only, until a book entry's secrecy is carried. */
  readAs(at: LoreAt, character: EntityId, ids: readonly string[]): Promise<LoreEntry[]> {
    return this.entries(at, ids, character);
  }

  /** Every entry of the chat's books and its world that the query finds, best first, as the lead and the GM search. */
  search(at: LoreAt, query: LoreQuery): Promise<LoreHit[]> {
    return this.find(at, query);
  }

  /** The world's entries that the query finds and `character` may know, best first. */
  searchAs(at: LoreAt, character: EntityId, query: LoreQuery): Promise<LoreHit[]> {
    return this.find(at, query, character);
  }

  /** The entries Lumiverse activated for the prompt of `at.turn`, in its order; none for no turn, or a turn with no tag. */
  async activated(at: LoreAt): Promise<ActivatedLore[]> {
    if (at.turn === undefined) return [];
    const entries = await this.turns.activated(at.user, at.chat, at.turn);
    return entries === null ? [] : this.named(at.user, entries);
  }

  /** The lore map for a turn (`map.ts`): what activated for its prompt, and the world's entries whose keys come up in `ask.messages`, matched as Lumiverse matches keys. */
  async loreMap(ask: LoreMapAsk): Promise<LoreMap> {
    const activated = (await this.turns.activated(ask.user, ask.chat, ask.turn)) ?? [];
    const inPrompt = (await this.named(ask.user, activated)).map(({ id, title }): LoreMapLine => ({ id, title }));
    const at = this.worlds.at(ask.user, ask.chat, ask.turn);
    if (at === null) return { inPrompt, world: [] };
    const said = keysIn(ask.messages, ask.matching ?? LUMIVERSE_KEY_MATCHING);
    const world = Object.entries(at.world.lore).flatMap(([key, entry]): LoreMapLine[] => (hasOwn(at.world.lore, key) && !isCopy(entry) && Array.isArray(entry.keys) && entry.keys.some((k) => typeof k === "string" && said(k)) ? [{ id: worldEntryId(key), title: worldTitle(entry, key) }] : []));
    return { inPrompt, world };
  }

  private async entries(at: LoreAt, ids: readonly string[], as?: EntityId): Promise<LoreEntry[]> {
    const refs = ids.map(loreRefOf);
    const world = refs.some((ref) => ref?.kind === "world") ? this.worlds.at(at.user, at.chat, at.turn) : null;
    const open = world === null ? null : loreGateReader(world.registry, world.world, world.state);
    let people: EntityId[] | null = null;
    const out: LoreEntry[] = [];
    for (const ref of refs) {
      if (ref?.kind === "world") {
        const entry = world !== null && hasOwn(world.world.lore, ref.key) ? world.world.lore[ref.key] : undefined;
        if (world === null || open === null || entry === undefined || isCopy(entry)) continue;
        if (as === undefined) {
          people ??= peopleOf(world);
          out.push(worldEntry(world, ref.key, entry, knowingOf(world, entry, open, people)));
        } else if (loreReadable(world.registry, world.world, world.state, entry, AS_CHARACTER, false, open, as)) out.push(worldEntry(world, ref.key, entry));
      } else if (ref?.kind === "book" && as === undefined) {
        const id = this.numbers.entry(at.user, ref.n);
        const row = id === null ? null : await this.books.entry(at.user, id);
        const book = row === null ? null : await this.books.book(at.user, row.book);
        if (row !== null && book !== null) out.push(bookEntry(ref.n, row, book, bookTitle(row, this.settings.titleWords)));
      }
    }
    return out;
  }

  private async find(at: LoreAt, query: LoreQuery, as?: EntityId): Promise<LoreHit[]> {
    const limit = Math.max(0, Math.floor(query.limit ?? this.settings.searchLimit));
    const world = this.worlds.at(at.user, at.chat, at.turn);
    if (limit === 0 || (as !== undefined && world === null)) return [];
    const asked = (source: string): boolean => query.sources === undefined || query.sources.includes(source);
    const lore: Record<string, LoreEntryDef> = {};
    const found = new Map<string, Found>();
    const texts = new Set<string>();
    if (world !== null && asked(world.world.name)) {
      for (const [key, entry] of Object.entries(world.world.lore)) {
        if (!hasOwn(world.world.lore, key) || isCopy(entry)) continue;
        const text = publicText(typeof entry.content === "string" ? entry.content : "");
        lore[key] = text === entry.content ? entry : { ...entry, content: text };
        found.set(key, { kind: "world", id: worldEntryId(key), source: world.world.name, title: worldTitle(entry, key), text });
        // Twins are told apart as today's lore tells them (`backend/lore-secrets.ts:23-26`): white space aside.
        texts.add(text.replace(/\s+/g, " ").trim());
      }
    }
    if (as === undefined) {
      const books = (await this.booksOf(at, world)).filter((book) => asked(book.name));
      const rows = await Promise.all(books.map((book) => this.books.entries(at.user, book.id)));
      for (const [i, book] of books.entries()) {
        for (const row of rows[i] ?? []) {
          if (!isLore(row)) continue;
          const text = publicText(row.content);
          const twin = text.replace(/\s+/g, " ").trim();
          // A text read already is read once, where it first came, as today's lore reads its books (`backend/book-lore.ts:342-350`).
          if (twin === "" || texts.has(twin)) continue;
          texts.add(twin);
          // Today's id of a book entry read as lore (`backend/book-lore.ts:42`): the world's lookup table may lead a term to one by it.
          const key = `book:${book.id}/${row.id}`;
          const title = bookTitle(row, this.settings.titleWords);
          lore[key] = searchDef(key, row, title, text);
          found.set(key, { kind: "book", entry: row.id, source: book.name, title, text });
        }
      }
    }
    const base = world ?? this.noWorld();
    // No snippet is cut by the search itself: none costs a token, as today's lore tools ask (`backend/agents/tools/lore.ts:361-362`).
    const { hits } = loreSearch({ reg: base.registry, world: { ...base.world, lore }, state: base.state, tokens: () => 0 }, { query: query.text, purpose: as === undefined ? "gm" : AS_CHARACTER, ...(as === undefined ? {} : { as }), tokenBudget: 0, limit });
    const hit = hits.flatMap((h) => found.get(h.id) ?? []);
    const numbers = await this.numbers.of(at.user, hit.flatMap((f) => (f.kind === "book" ? [f.entry] : [])));
    const words = wordsOf(query.text);
    return hit.flatMap((f): LoreHit[] => {
      const n = f.kind === "book" ? numbers.get(f.entry) : undefined;
      const id = f.kind === "world" ? f.id : n === undefined ? null : bookEntryId(n);
      return id === null ? [] : [{ id, source: f.source, title: f.title, snippet: snippetOf(f.text, words, this.settings.snippetChars) || f.title, how: "words" }];
    });
  }

  /**
   * The books whose entries are the chat's lore, each once, in today's order (`backend/book-lore.ts:195-207`):
   * those its world lists, those attached to the chat, then those an earlier build copied world entries
   * from, whose entries are read as their books have them now. A book the user has not is left out.
   */
  private async booksOf(at: LoreAt, world: WorldAt | null): Promise<LoreBook[]> {
    const listed = world === null ? [] : loreBooksOf(world.world);
    const copied = world === null ? [] : Object.values(world.world.lore).flatMap((entry) => {
      const source = loreSourceOf(entry.source);
      return source.kind === "book" ? [source.bookId] : [];
    });
    const ids = [...new Set([...listed, ...(await this.books.attached(at.user, at.chat)), ...copied])];
    const books = await Promise.all(ids.map((id) => this.books.book(at.user, id)));
    return books.filter((book): book is LoreBook => book !== null);
  }

  /** Activated entries by RPE's ids, titled as reading them titles them, with their books' names (none where the book cannot be read) and how each activated. */
  private async named(user: string, entries: readonly ActivatedEntry[]): Promise<ActivatedLore[]> {
    const numbers = await this.numbers.of(user, entries.map((e) => e.id));
    const bookIds = [...new Set(entries.flatMap((e) => (e.book === null ? [] : [e.book])))];
    const books = await Promise.all(bookIds.map((id) => this.books.book(user, id)));
    const names = new Map(books.flatMap((book) => (book === null ? [] : [[book.id, book.name] as const])));
    const out = await Promise.all(
      entries.map(async (e): Promise<ActivatedLore | null> => {
        const n = numbers.get(e.id);
        if (n === undefined) return null;
        let title = e.title.replace(/\s+/g, " ").trim();
        if (title === "") {
          const row = await this.books.entry(user, e.id);
          if (row !== null) title = bookTitle(row, this.settings.titleWords);
        }
        const how = HOWS.find((h) => h === e.how);
        return { id: bookEntryId(n), source: e.book === null ? "" : (names.get(e.book) ?? ""), title, ...(how === undefined ? {} : { how }) };
      }),
    );
    return out.filter((a): a is ActivatedLore => a !== null);
  }

  /**
   * A world with no lore of its own, for a chat that has none: its books are searched as any chat's.
   * It is the engine's minimal world; a search as the lead reads nothing of it but its empty lore and
   * lookup table.
   */
  private noWorld(): WorldAt {
    if (this.blank === null) {
      const world = blankWorld("", "");
      this.blank = { registry: this.worlds.registry, world, state: initialState(world, "", this.worlds.registry) };
    }
    return this.blank;
  }
}
