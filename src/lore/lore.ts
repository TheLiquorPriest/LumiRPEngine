// One reader over both sources of a chat's lore (plan §9.1, §9.4): the user's Lumiverse books, read
// live and read-only, and the world's own lore, in the chat's world where its path stands. Every
// entry goes by an id that says its source (`ids.ts`), with its title and keys; a world entry also
// says who may know it.
//
// Who may know a world entry is today's own rule, called as it is (`engine/lore.ts` `loreReadable`):
// an entry known only to those who would know it is read by a character once that character knows
// every person and place it links; a secret is read by its holders, gate or no gate, and by no other
// character, ever; an entry an agent wrote that still awaits the user's review is the GM's alone. As
// shipped the lead and the GM read every entry, a world entry marked with who may know it now. The
// character a reader plays is the world's person the cast would find as a secret's holder: the one
// the agent's `plays` names by id or name, else the one named as the cast's character it names is.
// Whoever reads, a book entry is read only from the books the chat reads, as its search reads them.
//
// The search is today's too (`loreSearch`), over both sources at once as today's lore tools search
// (`backend/agents/tools/lore.ts:350-366`): the world's lookup table, aliases, keys, titles and topics,
// then the words of each entry. A book entry is read by a character as today's live lore reads it (`secrets/character.ts`): the entry as
// lore found by its own fields, each secret mark of it its own secret, held by those it names and those the story made holders; a mark a
// character does not hold is left out of what it reads, and an entry it may not know is not there for it.

import type { LinesPart } from "../app/guidance";
import type { ActivatedLore, LoreEntry, LoreHit, LoreKnowing, LoreQuery, LoreSecret } from "rp-harness/contract";
import { blankWorld } from "../engine/authoring";
import { loreReadable, loreSearch, SEARCH_LIMITS, type SearchLimits, wordsOf } from "../engine/lore";
import { kindIs } from "../engine/scope";
import { loreGateReader } from "../engine/visibility";
import { initialState } from "../engine/world-state";
import { hashJson } from "../shared/hash";
import type { EntityId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { bookLoreFieldsOf, engineWroteEntry, loreBooksOf, loreIsSecret, loreSourceOf, withoutOldSecrecy } from "../shared/lore";
import { hasSecretMarks, publicText, unreadableMarks } from "../shared/secret-marks";
import type { LoreEntryDef, StepPurpose } from "../shared/world";
import type { LoreScope, LoreSettingsFor } from "./chat-settings";
import { bookEntryId, type EntryNumbers, loreRefOf, worldEntryId } from "./ids";
import { foldName, type KeyMatching, keysFound, LUMIVERSE_KEY_MATCHING } from "./keys";
import type { LoreMap, LoreMapLine } from "./map";
import { AS_CHARACTER, CharacterReads, type HeldSecret, worldWithBooks } from "./secrets/character";
import { HoldersAt, peopleOf } from "./secrets/holders";
import { bookRead, type SecretWords, secretWords } from "./secrets/shown";
import type { ActivatedEntry, LoreBook, LoreBookEntry, LoreBookListing, LoreBooks, LoreTurns, LoreWorlds, WorldAt } from "./sources";

/** The lore's settings: the numbers; the stop words and his choice of books are read for the chat (`LoreChatSettings`). */
export interface LoreSettings {
  /** Hits a search gives when the query sets no limit of its own. */
  searchLimit: number;
  /** Characters of an entry's text a hit's snippet keeps on each side of the first word the search matched. */
  snippetChars: number;
  /** Words of its text that title a book entry with no title of its own (today's, `backend/book-lore.ts:26`). */
  titleWords: number;
  /** The shortest term or word a search matches (`engine/lore.ts`). */
  minTerm: number;
  /** The most a word repeated in an entry counts in a search's ranking. */
  wordCap: number;
  /** Tokens the secrets a character holds may take in what it is given as its own (`lore.held.budget`). */
  heldBudget: number;
  /** Entries past which the catalogue's deterministic step (title, text, keys, size, activation, revision) runs on a worker thread (`lore.workerCatalogueAt`). */
  workerCatalogueAt: number;
}

export const LORE_DEFAULTS: Readonly<LoreSettings> = Object.freeze({ searchLimit: 20, snippetChars: 80, titleWords: 8, minTerm: SEARCH_LIMITS.minTerm, wordCap: SEARCH_LIMITS.wordCap, heldBudget: 1600, workerCatalogueAt: 200 });

/** What one call reads of the lore's settings for its chat. */
interface Chosen {
  lore: Readonly<LoreSettings>;
  limits: Readonly<SearchLimits>;
  /** His books: the ids the lore reads of the books the chat reads; null for `auto`, all of them. */
  books: readonly string[] | null;
}

export interface LoreOptions {
  books: LoreBooks;
  worlds: LoreWorlds;
  turns: LoreTurns;
  numbers: EntryNumbers;
  settings?: Partial<LoreSettings>;
  /** What a chat's levels set of the lore's settings, read at each call; absent, only `settings` and every book. */
  settingsFor?: LoreSettingsFor;
  /** The lines of `.prompts/lore-answers.md` in force for a chat, which word a secret in an entry the lead reads; absent, no secret's text is shown. */
  lines?: (at: LoreScope) => Promise<LinesPart | undefined>;
  /** Runs the catalogue's deterministic step somewhere else (a worker thread) when a library is long; absent, it runs where it is asked. */
  away?: (input: CatalogueInput) => Promise<LoreCatalogEntry[]>;
  /** The search by meaning, once the turn lane has one; absent, every hit is by words. */
  meaning?: LoreMeaning;
}

/**
 * The search by meaning as the lore asks it (plan §9.4, §10.5): the turn lane's index of one vector per entry by id and revision, searched on
 * the user's embedding connection (RPH's one setting `embedding.connection`).
 */
export interface LoreMeaning {
  /** The entries of the chat's lore nearest `text` in meaning, nearest first, by the ids the lore gives them (`e-12`, `w-3`), at most `limit`; null while no embedding connection is set, with nothing sent anywhere. */
  find(at: LoreAt, text: string, limit: number): Promise<readonly string[] | null>;
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

/** How an entry activated, in the words of the contract; anything else Lumiverse says is left unsaid. */
export const HOWS = ["constant", "keyword", "vector", "sticky"] as const;

/** A world entry an earlier build copied from a book entry: today's lore reads the book entry instead, as its book has it now (`backend/book-lore.ts:296-338`). */
function isCopy(entry: LoreEntryDef): boolean {
  return loreSourceOf(entry.source).kind === "book";
}

/** A world entry's keys: the texts among them. */
function keysOf(entry: LoreEntryDef): string[] {
  return Array.isArray(entry.keys) ? entry.keys.filter((k): k is string => typeof k === "string") : [];
}

/** A world entry's title as today's views give it: its own, else its key. */
function worldTitle(entry: LoreEntryDef, key: string): string {
  return typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : key;
}

/** A world entry's revision, as `lore_read`, the catalog and the index give it: what a proposal for it is drafted against, and a write to it checked against. */
export function worldRevision(entry: LoreEntryDef, key: string): string {
  return hashJson([worldTitle(entry, key), keysOf(entry), typeof entry.content === "string" ? entry.content : ""]);
}

/** A book entry's title: its own, else the first words of what anyone may read of its text (or `text`, what the reader may read of it), as today's (`backend/book-lore.ts:28-39`). */
function bookTitle(row: LoreBookEntry, words: number, text = publicText(row.content)): string {
  const comment = row.comment.replace(/\s+/g, " ").trim();
  if (comment !== "") return comment;
  const all = text.replace(/\s+/g, " ").trim().split(" ").filter((w) => w !== "");
  return all.length > words ? `${all.slice(0, words).join(" ")}…` : all.join(" ");
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

/**
 * The person of the world `said` names, as the cast finds a secret's holder (`cast/secrets.ts`
 * `personNamed`): the one person with that id, else the one person of that name, names compared as the
 * lore folds them. Null for no one, or for several so named.
 */
function personNamedIn(at: WorldAt, said: string): EntityId | null {
  const people = Object.entries(at.state.entities).filter(([, e]) => kindIs(at.registry, at.world, e.kind, "person"));
  if (people.some(([id]) => id === said.trim())) return said.trim();
  const named = people.filter(([, e]) => foldName(e.name) === foldName(said));
  return named.length === 1 ? (named[0]?.[0] ?? null) : null;
}

/**
 * Who may know an entry, as the lead sees it marked: nothing for an entry anyone may know. A secret with a gate is marked with its gate
 * and whether it holds now; any other entry held to some (a secret with no gate, one awaiting review, one not public) with the people of
 * the world who may know it now, each asked by today's rule as a character. `readers` are those people by name, whichever the mark: an
 * entry that is a secret is held by them.
 */
function knowingOf(at: WorldAt, entry: LoreEntryDef, open: (entry: LoreEntryDef) => boolean, people: readonly EntityId[]): { knowing?: LoreKnowing; readers: string[] } {
  const source = loreSourceOf(entry.source);
  const visibility: unknown = entry.visibility;
  if (!loreIsSecret(entry) && !(source.kind === "ai" && source.status === "pending") && (visibility === undefined || visibility === "public")) return { readers: [] };
  const readers = people.filter((who) => loreReadable(at.registry, at.world, at.state, entry, AS_CHARACTER, false, open, who)).map((who) => at.state.entities[who]?.name ?? who);
  const gate = typeof entry.gate === "string" ? entry.gate.trim() : "";
  return { knowing: loreIsSecret(entry) && gate !== "" ? { by: "gate", gate, open: open(entry) } : { by: "characters", names: readers }, readers };
}

/** Who may know a book entry as the lead sees it marked, by the fields it carries: the same rule as a world entry's, an entry whose marks hold its secrecy asking only for its visibility. */
function bookKnowing(at: WorldAt, open: (entry: LoreEntryDef) => boolean, people: readonly EntityId[], row: LoreBookEntry): { knowing?: LoreKnowing; readers: string[] } {
  const marked = hasSecretMarks(row.content) || unreadableMarks(row.content).length > 0;
  const own = bookLoreFieldsOf(row.extensions);
  const fields = marked ? withoutOldSecrecy(own) : own;
  if (fields === null) return { readers: [] };
  const def: LoreEntryDef = {
    id: `${row.book}/${row.id}`,
    title: "",
    content: "",
    keys: [],
    links: fields.links ?? [],
    ...(fields.secret === undefined ? {} : { secret: fields.secret }),
    ...(fields.gate === undefined ? {} : { gate: fields.gate }),
    ...(fields.holders === undefined ? {} : { holders: fields.holders }),
    ...(fields.visibility === undefined ? {} : { visibility: fields.visibility }),
  };
  return knowingOf(at, def, open, people);
}

function worldEntry(at: WorldAt, n: number, key: string, entry: LoreEntryDef, held?: { knowing?: LoreKnowing; readers: string[] }): LoreEntry {
  const title = worldTitle(entry, key);
  const keys = Array.isArray(entry.keys) ? entry.keys.filter((k): k is string => typeof k === "string") : [];
  const content = typeof entry.content === "string" ? entry.content : "";
  const id = worldEntryId(n);
  return {
    id,
    source: at.world.name,
    title,
    keys,
    text: publicText(content),
    revision: worldRevision(entry, key),
    ...(held?.knowing ? { knowing: held.knowing } : {}),
    ...(held !== undefined && loreIsSecret(entry) ? { secrets: [{ id, heldBy: held.readers }] } : {}),
  };
}

/** A book entry as `lore_read` gives it: its revision is Lumiverse's own, the one the catalog, the batch, the index and the map give. `read` is its text with its secrets worded as such, and the secrets. */
function bookEntry(n: number, row: LoreBookEntry, book: LoreBook, title: string, read: { text: string; secrets: LoreSecret[] }, knowing?: LoreKnowing): LoreEntry {
  const keys = row.keys.filter((k) => k.trim() !== "");
  return { id: bookEntryId(n), source: book.name, title, keys, text: read.text, revision: String(row.revision), ...(knowing ? { knowing } : {}), ...(read.secrets.length > 0 ? { secrets: read.secrets } : {}) };
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
type Found = { kind: "world"; key: string; source: string; title: string; text: string } | { kind: "book"; entry: string; source: string; title: string; text: string };

/** An entry of the chat's lore as today's lore reads it, with what any reader may read of its text. */
type Gathered = { kind: "world"; key: string; entry: LoreEntryDef; source: string; title: string; text: string } | { kind: "book"; book: LoreBook; row: LoreBookEntry; title: string; text: string };

/** An entry of the chat's lore as it is held, before its title and the text any reader may read of it are worked out. */
type Raw = { kind: "world"; key: string; entry: LoreEntryDef; source: string } | { kind: "book"; book: LoreBook; row: LoreBookEntry };

/**
 * How an entry comes into play by itself: a book entry by Lumiverse's ways (always, by its keys, by
 * meaning); a world entry by its keys, in the lore map. None for one that never does (switched off,
 * or a world entry with no keys).
 */
export type LoreActivation = "constant" | "keyword" | "vector";

/** An entry of a chat's lore as the database holds it now (plan §9.1): read at once, never by a run. */
export interface LoreCatalogEntry {
  /** RPE's id: `e-` or `w-` and its number. */
  id: string;
  /** For a world entry, its world's id, which its key is unique in; '' for a book entry, whose number is the user's for good. */
  world: string;
  /** Its book's name, or its world's. */
  source: string;
  /** Its book's id in Lumiverse; null for a world entry. */
  book: string | null;
  /** A world entry's key in its world, which the world's own pins name it by; null for a book entry. */
  key: string | null;
  /** Lumiverse's id of a book entry, which a pin of its book names it by; null for a world entry. */
  lumiverse: string | null;
  title: string;
  keys: string[];
  /** Characters in its text as Lumiverse holds it. */
  size: number;
  activation: LoreActivation[];
  /** Lumiverse's revision of a book entry; for a world entry, a hash of its title, keys and text. */
  revision: string;
  /** What any reader may read of its text. */
  text: string;
}

function bookActivation(row: LoreBookEntry): LoreActivation[] {
  if (row.disabled) return [];
  if (row.constant) return ["constant"];
  return [...(row.keys.some((k) => k.trim() !== "") ? (["keyword"] as const) : []), ...(row.vectorized ? (["vector"] as const) : [])];
}

/** What the catalogue is made from: each entry of the chat's lore with its number, as it is held. Plain data, so a thread may be handed it. */
export interface CatalogueInput {
  /** The chat's world's id; '' for none. */
  world: string;
  /** Words of its text that title a book entry with no title of its own. */
  titleWords: number;
  entries: CatalogueRow[];
}

/** One entry of `CatalogueInput`: a world entry by its key, or a book entry by its row, with its number. */
export type CatalogueRow = { kind: "world"; n: number; key: string; entry: LoreEntryDef; source: string } | { kind: "book"; n: number; book: { id: string; name: string }; row: LoreBookEntry };

/**
 * The catalogue's deterministic part (plan §9.1): each entry's id, book, title, keys, size, how it activates, revision and the text
 * any reader may read of it, worked out from the rows alone. It reads nothing and writes nothing, so it runs as well on a thread.
 */
export function catalogueOf(input: CatalogueInput): LoreCatalogEntry[] {
  return input.entries.map((e): LoreCatalogEntry => {
    if (e.kind === "world") {
      const content = typeof e.entry.content === "string" ? e.entry.content : "";
      const keys = keysOf(e.entry);
      // The revision `lore_read` gives the same entry (`worldEntry`).
      return { id: worldEntryId(e.n), world: input.world, source: e.source, book: null, key: e.key, lumiverse: null, title: worldTitle(e.entry, e.key), keys, size: content.length, activation: keys.some((k) => k !== "") ? ["keyword"] : [], revision: worldRevision(e.entry, e.key), text: publicText(content) };
    }
    const text = publicText(e.row.content);
    return { id: bookEntryId(e.n), world: "", source: e.book.name, book: e.book.id, key: null, lumiverse: e.row.id, title: bookTitle(e.row, input.titleWords, text), keys: e.row.keys.filter((k) => k.trim() !== ""), size: e.row.content.length, activation: bookActivation(e.row), revision: String(e.row.revision), text };
  });
}

export class Lore {
  private readonly books: LoreBooks;
  private readonly worlds: LoreWorlds;
  private readonly turns: LoreTurns;
  private readonly numbers: EntryNumbers;
  private readonly settings: Readonly<LoreSettings>;
  private readonly settingsFor: LoreSettingsFor | undefined;
  private readonly lines: LoreOptions["lines"];
  private readonly away: LoreOptions["away"];
  private readonly meaning: LoreOptions["meaning"];
  private blank: WorldAt | null = null;

  constructor(options: LoreOptions) {
    this.books = options.books;
    this.worlds = options.worlds;
    this.turns = options.turns;
    this.numbers = options.numbers;
    this.settings = Object.freeze({ ...LORE_DEFAULTS, ...options.settings });
    this.settingsFor = options.settingsFor;
    this.lines = options.lines;
    this.away = options.away;
    this.meaning = options.meaning;
  }

  /**
   * What the lore reads for this chat: its levels' settings over the global ones the lore was made with, as they stand now (a change
   * applies at the chat's next call, no restart). Without a reader of levels, the settings it was made with, and every book.
   */
  private async settingsOf(at: LoreAt): Promise<Chosen> {
    const chat = await this.settingsFor?.(at);
    return { lore: { ...this.settings, ...chat?.lore }, limits: chat?.search ?? { minTerm: this.settings.minTerm, wordCap: this.settings.wordCap, stopWords: SEARCH_LIMITS.stopWords }, books: chat?.books ?? null };
  }

  /** Entries in full, in the order asked, as the lead and the GM read them: every entry, a world entry marked with who may know it. An id that names nothing is left out. */
  read(at: LoreAt, ids: readonly string[]): Promise<LoreEntry[]> {
    return this.entries(at, ids);
  }

  /**
   * The entries asked for that the character a reader plays may know, in the order asked: a world entry or a book entry, each as today's
   * rule lets that character read it (a book entry's marks only where it holds them). `plays` is who the reader plays as it was
   * started (`personPlayed`); one that names no one in the chat's world reads nothing.
   */
  readAs(at: LoreAt, plays: string, ids: readonly string[]): Promise<LoreEntry[]> {
    return this.entries(at, ids, plays);
  }

  /** Every entry of the chat's books and its world that the query finds, best first, as the lead and the GM search. */
  search(at: LoreAt, query: LoreQuery): Promise<LoreHit[]> {
    return this.find(at, query);
  }

  /** The entries of the chat's world and books that the query finds and the character a reader plays (`readAs`) may know, best first. */
  searchAs(at: LoreAt, plays: string, query: LoreQuery): Promise<LoreHit[]> {
    return this.find(at, query, plays);
  }

  /**
   * The world's person a reader plays, by `plays` as the agent was started, found as the cast finds a
   * secret's holder: the person of the chat's world it names by id or by name; else the one named as
   * the cast's character it names is (`LoreWorlds.castName`). Null when it names no one there, or several.
   */
  personPlayed(at: LoreAt, plays: string): { id: EntityId; name: string } | null {
    const world = this.worlds.at(at.user, at.chat, at.turn);
    return world === null ? null : this.personIn(at, world, plays);
  }

  /** The name of the cast's character `said` names (its id or its name), in the chat or one it was branched from; null for none. Its person in the world, where it is one, is `personPlayed`. */
  castName(at: LoreAt, said: string): string | null {
    return this.worlds.castName?.(at.user, at.chat, said) ?? null;
  }

  private personIn(at: LoreAt, world: WorldAt, plays: string): { id: EntityId; name: string } | null {
    let id = personNamedIn(world, plays);
    if (id === null) {
      const name = this.worlds.castName?.(at.user, at.chat, plays) ?? null;
      if (name !== null) id = personNamedIn(world, name);
    }
    return id === null ? null : { id, name: world.state.entities[id]?.name ?? id };
  }

  /** The entries Lumiverse activated for the prompt of `at.turn`, in its order; none for no turn, or a turn with no tag. */
  async activated(at: LoreAt): Promise<ActivatedLore[]> {
    if (at.turn === undefined) return [];
    const entries = await this.turns.activated(at.user, at.chat, at.turn);
    return entries === null ? [] : this.named(at.user, entries, (await this.settingsOf(at)).lore.titleWords);
  }

  /**
   * The lore map's first form for a turn (`map.ts`): what activated for its prompt, and the world's
   * entries whose keys come up in `ask.messages`, matched as Lumiverse matches keys. The index's
   * `LoreIndex.loreMap` builds the map in full on it.
   */
  async loreMap(ask: LoreMapAsk): Promise<LoreMap> {
    const activated = (await this.turns.activated(ask.user, ask.chat, ask.turn)) ?? [];
    const inPrompt = (await this.named(ask.user, activated, (await this.settingsOf(ask)).lore.titleWords)).map(({ id, title, source, how }): LoreMapLine => ({ id, title, source, ...(how !== undefined ? { how } : {}) }));
    const at = this.worlds.at(ask.user, ask.chat, ask.turn);
    if (at === null) return { inPrompt, world: [] };
    // Every world key at once, over the messages once, as Lumiverse's matcher goes.
    const candidates = Object.entries(at.world.lore).filter(([key, entry]) => hasOwn(at.world.lore, key) && !isCopy(entry));
    const said = keysFound(ask.messages, ask.matching ?? LUMIVERSE_KEY_MATCHING, candidates.flatMap(([, entry]) => keysOf(entry)));
    const matched = candidates.filter(([, entry]) => keysOf(entry).some((k) => said.has(k)));
    const numbers = await this.numbers.ofWorld(ask.user, at.world.id, matched.map(([key]) => key));
    const world = matched.flatMap(([key, entry]): LoreMapLine[] => {
      const n = numbers.get(key);
      return n === undefined ? [] : [{ id: worldEntryId(n), title: worldTitle(entry, key) }];
    });
    return { inPrompt, world };
  }

  /** The chat's world where `at` stands, with the Author's horizon there; null for a chat with no world. */
  worldAt(at: LoreAt): WorldAt | null {
    return this.worlds.at(at.user, at.chat, at.turn);
  }

  /** Every book of the user's, as his choice of books (`lore.books`) lists them; none where the host lists none. */
  async bookList(at: LoreAt): Promise<LoreBookListing[]> {
    return (await this.books.list?.(at.user, at.chat)) ?? [];
  }

  /**
   * The text of one of the user's book entries as any reader may read it: by its id in Lumiverse, or RPE's (`e-12`). Null for no
   * such entry, or one with no text. Used for his own lore index entry, whose text heads `LORE-INDEX.md`.
   */
  async bookText(at: LoreAt, id: string): Promise<string | null> {
    const ref = loreRefOf(id);
    const lumiverse = ref === null ? id : ref.kind === "book" ? this.numbers.entry(at.user, ref.n) : null;
    const row = lumiverse === null ? null : await this.books.entry(at.user, lumiverse);
    const text = row === null ? "" : publicText(row.content).trim();
    return text === "" ? null : text;
  }

  private async entries(at: LoreAt, ids: readonly string[], plays?: string): Promise<LoreEntry[]> {
    const s = await this.settingsOf(at);
    const refs = ids.map(loreRefOf);
    const world = plays !== undefined || refs.some((ref) => ref !== null) ? this.worlds.at(at.user, at.chat, at.turn) : null;
    const as = plays === undefined || world === null ? undefined : this.personIn(at, world, plays)?.id;
    if (plays !== undefined && as === undefined) return [];
    const open = world === null ? null : loreGateReader(world.registry, world.world, world.state);
    // A book entry is read only from a book the chat reads, as its search reads them.
    let books: Promise<Set<string>> | null = null;
    let people: EntityId[] | null = null;
    // What a character reads: the world's own entries as it may know them, and its books' as lore.
    let holders: HoldersAt | null | undefined;
    let reads: CharacterReads | undefined;
    let bookReads: Promise<CharacterReads> | undefined;
    // What the lead reads of a book entry's secrets: how a secret is worded in a text.
    let words: SecretWords | undefined;
    const out: LoreEntry[] = [];
    for (const ref of refs) {
      if (ref?.kind === "world") {
        const numbered = this.numbers.worldEntry(at.user, ref.n);
        // A world entry is read from the chat's own world only, as a book entry is read only from a book the chat reads.
        const key = world !== null && numbered?.world === world.world.id ? numbered.key : null;
        const entry = world !== null && key !== null && hasOwn(world.world.lore, key) ? world.world.lore[key] : undefined;
        if (world === null || open === null || key === null || entry === undefined || isCopy(entry)) continue;
        if (as === undefined) {
          people ??= peopleOf(world);
          out.push(worldEntry(world, ref.n, key, entry, knowingOf(world, entry, open, people)));
        } else {
          holders ??= new HoldersAt(world);
          reads ??= new CharacterReads(world, world.world, as, holders);
          if (reads.readable(key, entry)) out.push(worldEntry(world, ref.n, key, entry));
        }
      } else if (ref?.kind === "book") {
        const id = this.numbers.entry(at.user, ref.n);
        const row = id === null ? null : await this.books.entry(at.user, id);
        books ??= this.booksOf(at, world, s.books).then((read) => new Set(read.map((b) => b.id)));
        if (row === null || !(await books).has(row.book)) continue;
        const book = await this.books.book(at.user, row.book);
        if (book === null) continue;
        if (as !== undefined) {
          if (world === null) continue;
          holders ??= new HoldersAt(world);
          bookReads ??= this.bookReads(at, world, s, as, holders);
          const text = (await bookReads).bookText(row);
          if (text !== null) out.push(bookEntry(ref.n, row, book, bookTitle(row, s.lore.titleWords, text), { text, secrets: [] }));
          continue;
        }
        words ??= secretWords(await this.lines?.({ user: at.user, chat: at.chat }));
        if (holders === undefined) holders = world === null ? null : new HoldersAt(world);
        people ??= world === null ? [] : peopleOf(world);
        const knowing = world === null || open === null ? undefined : bookKnowing(world, open, people, row).knowing;
        out.push(bookEntry(ref.n, row, book, bookTitle(row, s.lore.titleWords), bookRead(row, bookEntryId(ref.n), holders, words), knowing));
      }
    }
    return out;
  }

  private async find(at: LoreAt, query: LoreQuery, plays?: string): Promise<LoreHit[]> {
    const s = await this.settingsOf(at);
    const limit = Math.max(0, Math.floor(query.limit ?? s.lore.searchLimit));
    const world = this.worlds.at(at.user, at.chat, at.turn);
    const as = plays === undefined || world === null ? undefined : this.personIn(at, world, plays)?.id;
    if (limit === 0 || (plays !== undefined && as === undefined)) return [];
    const asked = (source: string): boolean => query.sources === undefined || query.sources.includes(source);
    const lore: Record<string, LoreEntryDef> = {};
    const found = new Map<string, Found>();
    // A character reads the world's entries as it may know them, with the secrets the story made it a holder of, and its books' as lore.
    const holders = as === undefined || world === null ? null : new HoldersAt(world);
    const reads = as === undefined || world === null || holders === null ? null : new CharacterReads(world, world.world, as, holders);
    const bookReads = as === undefined || world === null || holders === null ? null : await this.bookReads(at, world, s, as, holders);
    for (const g of await this.gather(at, world, asked, s)) {
      if (g.kind === "world") {
        const entry = reads === null ? g.entry : reads.view(g.key, g.entry);
        lore[g.key] = g.text === g.entry.content ? entry : { ...entry, content: g.text };
        found.set(g.key, { kind: "world", key: g.key, source: g.source, title: g.title, text: g.text });
      } else {
        // What the reader may read of it: all that anyone may, or, for a character, as it reads it (none where it may know none of it).
        const text = bookReads === null ? g.text : bookReads.bookText(g.row);
        if (text === null) continue;
        const title = bookReads === null ? g.title : bookTitle(g.row, s.lore.titleWords, text);
        // Today's id of a book entry read as lore (`backend/book-lore.ts:42`): the world's lookup table may lead a term to one by it.
        const key = `book:${g.book.id}/${g.row.id}`;
        lore[key] = searchDef(key, g.row, title, text);
        found.set(key, { kind: "book", entry: g.row.id, source: g.book.name, title, text });
      }
    }
    const base = world ?? this.noWorld();
    // No snippet is cut by the search itself: none costs a token, as today's lore tools ask (`backend/agents/tools/lore.ts:361-362`).
    const { hits } = loreSearch({ reg: base.registry, world: { ...base.world, lore }, state: base.state, tokens: () => 0 }, { query: query.text, purpose: as === undefined ? "gm" : AS_CHARACTER, ...(as === undefined ? {} : { as }), tokenBudget: 0, limit, limits: s.limits });
    const hit = hits.flatMap((h) => found.get(h.id) ?? []);
    const numbers = await this.numbers.of(at.user, hit.flatMap((f) => (f.kind === "book" ? [f.entry] : [])));
    const worldNumbers = world === null ? new Map<string, number>() : await this.numbers.ofWorld(at.user, world.world.id, hit.flatMap((f) => (f.kind === "world" ? [f.key] : [])));
    const words = wordsOf(query.text, s.limits);
    const byWords = hit.flatMap((f): LoreHit[] => {
      const n = f.kind === "book" ? numbers.get(f.entry) : worldNumbers.get(f.key);
      const id = n === undefined ? null : f.kind === "book" ? bookEntryId(n) : worldEntryId(n);
      return id === null ? [] : [{ id, source: f.source, title: f.title, snippet: snippetOf(f.text, words, s.lore.snippetChars) || f.title, how: "words" }];
    });
    return [...byWords, ...(await this.byMeaning(at, query, plays, s, limit, byWords))];
  }

  /**
   * The entries a search by meaning finds beyond those the words found, each marked `meaning`, within the search's limit (plan §9.4, §10.5): asked
   * of `LoreOptions.meaning`, which answers nothing while no embedding connection is set, so with none every hit is by words and nothing calls out.
   * What a character may not know is left out as in a read: each entry is read as that character reads it.
   */
  private async byMeaning(at: LoreAt, query: LoreQuery, plays: string | undefined, s: Chosen, limit: number, words: readonly LoreHit[]): Promise<LoreHit[]> {
    const room = limit - words.length;
    if (this.meaning === undefined || room <= 0) return [];
    const near = await this.meaning.find(at, query.text, limit);
    if (near === null) return [];
    const taken = new Set(words.map((h) => h.id));
    const read = await this.entries(at, near.filter((id) => !taken.has(id)), plays);
    return read
      .filter((e) => query.sources === undefined || query.sources.includes(e.source))
      .slice(0, room)
      .map((e): LoreHit => ({ id: e.id, source: e.source, title: e.title, snippet: snippetOf(e.text, [], s.lore.snippetChars) || e.title, how: "meaning" }));
  }

  /**
   * Every entry of the chat's lore as the database holds it now (plan §9.1), as search reads it: the
   * world's own entries, then those of the books the chat reads. A book entry is numbered the first
   * time it is seen.
   */
  async catalog(at: LoreAt): Promise<LoreCatalogEntry[]> {
    const world = this.worlds.at(at.user, at.chat, at.turn);
    const s = await this.settingsOf(at);
    const gathered = await this.gatherRaw(at, world, () => true, s);
    const numbers = await this.numbers.of(at.user, gathered.flatMap((g) => (g.kind === "book" ? [g.row.id] : [])));
    const worldNumbers = world === null ? new Map<string, number>() : await this.numbers.ofWorld(at.user, world.world.id, gathered.flatMap((g) => (g.kind === "world" ? [g.key] : [])));
    const entries = gathered.flatMap((g): CatalogueRow[] => {
      const n = g.kind === "world" ? worldNumbers.get(g.key) : numbers.get(g.row.id);
      if (n === undefined) return [];
      return [g.kind === "world" ? { kind: "world", n, key: g.key, entry: g.entry, source: g.source } : { kind: "book", n, book: { id: g.book.id, name: g.book.name }, row: g.row }];
    });
    const input: CatalogueInput = { world: world?.world.id ?? "", titleWords: s.lore.titleWords, entries };
    if (this.away === undefined || entries.length <= s.lore.workerCatalogueAt) return catalogueOf(input);
    try {
      return await this.away(input);
    } catch {
      // A thread that failed has told the log; the catalogue is made here, as it always was.
      return catalogueOf(input);
    }
  }

  /**
   * The entries of the chat's lore of the sources `asked` names, as today's lore reads them: the
   * world's own, then its books', each in its source's order. Every entry of a book the
   * chat reads is one, a disabled one and an empty one included (a disabled entry is indexed and can be
   * bound; an empty one shows its title and keys) and a copy of another entry as much as any: each is
   * its own entry. Not the entries the engine itself wrote (an earlier build's own book of blank,
   * disabled entries, `shared/lore.ts` `engineWroteEntry`).
   */
  private async gather(at: LoreAt, world: WorldAt | null, asked: (source: string) => boolean, s: Chosen): Promise<Gathered[]> {
    return (await this.gatherRaw(at, world, asked, s)).map((r): Gathered => {
      if (r.kind === "world") return { ...r, title: worldTitle(r.entry, r.key), text: publicText(typeof r.entry.content === "string" ? r.entry.content : "") };
      const text = publicText(r.row.content);
      return { ...r, title: bookTitle(r.row, s.lore.titleWords, text), text };
    });
  }

  /** The entries `gather` finds, as they are held: the rows alone, with nothing worked out of them. */
  private async gatherRaw(at: LoreAt, world: WorldAt | null, asked: (source: string) => boolean, s: Chosen): Promise<Raw[]> {
    const out: Raw[] = [];
    if (world !== null && asked(world.world.name)) {
      for (const [key, entry] of Object.entries(world.world.lore)) {
        if (!hasOwn(world.world.lore, key) || isCopy(entry)) continue;
        out.push({ kind: "world", key, entry, source: world.world.name });
      }
    }
    const read = (await this.booksOf(at, world, s.books)).filter((book) => asked(book.name));
    const rows = await Promise.all(read.map((book) => this.books.entries(at.user, book.id)));
    for (const [i, book] of read.entries()) {
      for (const row of rows[i] ?? []) {
        if (engineWroteEntry(row.extensions)) continue;
        out.push({ kind: "book", book, row });
      }
    }
    return out;
  }

  /**
   * The books whose entries are the chat's lore, each once, in today's order (`backend/book-lore.ts:195-207`),
   * asked with the turn's speaker and persona where the turn has a tag (a group chat's speaker's books, a temporary chat reading no persona's):
   * those its world lists, those attached to the chat, then those an earlier build copied world entries
   * from, whose entries are read as their books have them now. A book the user has not is left out.
   */
  private async booksOf(at: LoreAt, world: WorldAt | null, only: readonly string[] | null): Promise<LoreBook[]> {
    const listed = world === null ? [] : loreBooksOf(world.world);
    const copied = world === null ? [] : Object.values(world.world.lore).flatMap((entry) => {
      const source = loreSourceOf(entry.source);
      return source.kind === "book" ? [source.bookId] : [];
    });
    // The books of the turn's own generation: the speaker's in a group chat and the generation's persona, as Lumiverse decides them for it.
    const generation = at.turn === undefined ? null : ((await this.turns.generation?.(at.user, at.chat, at.turn)) ?? null);
    // His choice of books (`lore.books`): `auto` reads every book the chat reads, a list only those of them it names (today's `loreBookIds`).
    const ids = [...new Set([...listed, ...(await this.books.attached(at.user, at.chat, generation ?? undefined)), ...copied])].filter((id) => only === null || only.includes(id));
    const books = await Promise.all(ids.map((id) => this.books.book(at.user, id)));
    return books.filter((book): book is LoreBook => book !== null);
  }

  /**
   * What the character `who` of the chat's world reads of its books: the books the chat reads as lore beside the world's own, each entry and each
   * mark held back as its fields and text say, and who holds what at the point `world` stands at (`CharacterReads`).
   */
  private async bookReads(at: LoreAt, world: WorldAt, s: Chosen, who: EntityId, holders: HoldersAt): Promise<CharacterReads> {
    const read = await this.booksOf(at, world, s.books);
    const rows = (await Promise.all(read.map((book) => this.books.entries(at.user, book.id)))).flat();
    return new CharacterReads(world, await worldWithBooks(world.world, rows, (id) => this.books.entry(at.user, id)), who, holders);
  }

  /**
   * The secrets the character a reader plays holds (plan §9.6), with how it came by each and the tokens they may take together
   * (`lore.held.budget`): those the world or a mark names it a holder of, and those the story made it one of, as they hold at the point
   * `at` stands at. Null when it plays no one in the chat's world.
   */
  async held(at: LoreAt, plays: string): Promise<{ secrets: HeldSecret[]; budget: number } | null> {
    const world = this.worlds.at(at.user, at.chat, at.turn);
    const person = world === null ? null : this.personIn(at, world, plays);
    if (world === null || person === null) return null;
    const s = await this.settingsOf(at);
    return { secrets: (await this.bookReads(at, world, s, person.id, new HoldersAt(world))).held(), budget: s.lore.heldBudget };
  }

  /** Activated entries by RPE's ids, titled as reading them titles them, with their books' names (none where the book cannot be read) and how each activated. */
  private async named(user: string, entries: readonly ActivatedEntry[], titleWords: number): Promise<ActivatedLore[]> {
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
          if (row !== null) title = bookTitle(row, titleWords);
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
