// A World Info entry as lore, found by its own fields alone (DESIGN §4.2): its id and title, the
// entry and each of its marks as secret lore entries held back by what holds them (`lore-secrets.ts`),
// and the lore a world reads of the books it is given, as a function of the world, the entries read
// and the originals of the copies among them. Pure: nothing is read from a host or written to one.

import type { HostBookEntry } from "../shared/host";
import { deepFreeze, hasOwn } from "../shared/json";
import { bookLoreFieldsOf, bookTextHash, engineWroteEntry, loreSourceOf, type BookLoreFields } from "../shared/lore";
import { parseSecretMarks, publicText, wholeEntrySecret, type MarkNamesSource } from "../shared/secret-marks";
import type { LoreEntryDef, LorePin, WorldDoc } from "../shared/world";
import { heldTextOf, heldTo, markFields, secrecyParts, secretTexts, textOf, textParts } from "./lore-secrets";

/** The words a book entry with no comment is titled by. */
const TITLE_WORDS = 8;

/** A text's first words as a title, or null when it has none. */
function wordsTitle(text: string): string | null {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter((w) => w !== "");
  return words.length === 0 ? null : words.length > TITLE_WORDS ? `${words.slice(0, TITLE_WORDS).join(" ")}…` : words.join(" ");
}

/** A book entry's title: its comment, else the first words of what anyone may read of its text, else of its whole-entry secret's. */
export function bookEntryTitle(e: Pick<HostBookEntry, "comment" | "content">): string {
  const comment = e.comment.replace(/\s+/g, " ").trim();
  if (comment !== "") return comment;
  return wordsTitle(publicText(e.content)) ?? wordsTitle(wholeEntrySecret(e.content)?.text ?? "") ?? "Untitled entry";
}

/** A book entry's id as a lore entry, the same as its pin's key, so it reads once however it comes. */
export function bookLoreId(bookId: string, entryId: string): string {
  return `book:${bookId}/${entryId}`;
}

/** The lore id of the `n`th mark (from 1) in a longer book entry's text: a secret entry of its own beside the entry. */
export function bookMarkLoreId(bookId: string, entryId: string, n: number): string {
  return `${bookLoreId(bookId, entryId)}#${n}`;
}

/**
 * A book entry as lore, on or off (a pin reads either), found by its own fields alone: its title (its
 * comment, else its first words), its World Info keys, its secondary keys and LRE aliases as other
 * names, and its text; its links are its own LRE fields'. Held back by `parts` (`secrecyParts`). Its
 * text is what anyone may read of it; a whole-entry secret is the secret, read by its holders and no
 * one else (a mark has no gate).
 */
export function bookEntryLore(e: HostBookEntry, parts: readonly BookLoreFields[], world: MarkNamesSource): LoreEntryDef {
  const fields = bookLoreFieldsOf(e.extensions);
  const aliases = [...new Set([...(fields?.aliases ?? []), ...(e.secondaryKeys ?? [])].map((a) => a.trim()).filter((a) => a !== ""))];
  const whole = wholeEntrySecret(e.content);
  return heldTo(
    {
      id: bookLoreId(e.bookId, e.id),
      title: bookEntryTitle(e),
      content: whole ? whole.text : publicText(e.content),
      // The entry's own World Info keys are what its author wrote it to answer to.
      keys: e.keys.filter((k) => k.trim() !== ""),
      links: fields?.links ?? [],
      ...(aliases.length > 0 ? { aliases } : {}),
      source: { kind: "book", bookId: e.bookId, entryId: e.id, hash: bookTextHash(e.content) },
    },
    whole ? [...parts, markFields(world, whole)] : parts,
  );
}

/**
 * The marks of a longer book entry as secret lore entries (DESIGN §4.2): each its own text, read by
 * its holders and no one else, and about what the entry links. It answers to no key and goes by no
 * name of the entry's, which anyone may say: a screen on what the player reads takes its words alone
 * as the secret's. None for a whole-entry secret, which is the entry itself (`bookEntryLore`).
 */
export function bookMarkLores(e: HostBookEntry, world: MarkNamesSource): LoreEntryDef[] {
  if (engineWroteEntry(e.extensions) || wholeEntrySecret(e.content)) return [];
  const links = bookLoreFieldsOf(e.extensions)?.links ?? [];
  return parseSecretMarks(e.content).map((mark, i): LoreEntryDef => ({
    id: bookMarkLoreId(e.bookId, e.id, i + 1),
    title: wordsTitle(mark.text) ?? "A secret",
    content: mark.text,
    keys: [],
    links,
    source: { kind: "book", bookId: e.bookId, entryId: e.id, hash: bookTextHash(e.content) },
    ...markFields(world, mark),
  }));
}

/**
 * A World Info entry as lore: none when it isn't any, because the engine wrote it, it holds no text,
 * or its author switched it off and gave it no LRE fields (an earlier build stored its secrets off, so
 * one with fields reads whether on or off); else the entry, unless all of its text is marks, and each
 * of its marks. `parts` hold it back (`secrecyParts`).
 */
export function bookLoreEntries(e: HostBookEntry, parts: readonly BookLoreFields[], world: MarkNamesSource): LoreEntryDef[] {
  if (engineWroteEntry(e.extensions) || e.content.trim() === "") return [];
  if (e.disabled && bookLoreFieldsOf(e.extensions) === null) return [];
  const entry = bookEntryLore(e, parts, world);
  return [...(entry.content.trim() === "" ? [] : [entry]), ...bookMarkLores(e, world)];
}

/** The lore last made of each kept (frozen) book entry, with what it was made with: the world it names holders by and the parts holding it back. */
const MADE = new WeakMap<HostBookEntry, { world: MarkNamesSource; parts: string; lore: LoreEntryDef[] }>();

/** `bookLoreEntries`, made once per kept entry for the same world and parts; an entry of a read not kept (not frozen) is made each time. */
function entryLore(e: HostBookEntry, parts: readonly BookLoreFields[], world: MarkNamesSource): LoreEntryDef[] {
  if (!Object.isFrozen(e)) return bookLoreEntries(e, parts, world);
  const key = JSON.stringify(parts);
  const made = MADE.get(e);
  if (made && made.world === world && made.parts === key) return made.lore;
  const lore = deepFreeze(bookLoreEntries(e, parts, world));
  MADE.set(e, { world, parts: key, lore });
  return lore;
}

/** The World Info entry an earlier build's copy of one (a world entry with a `book` source) stands for, by the copy's lore id in `world`; null for any other id. */
export function copiedEntry(world: WorldDoc, loreId: string): { bookId: string; entryId: string } | null {
  const source = hasOwn(world.lore, loreId) ? loreSourceOf(world.lore[loreId]?.source) : null;
  return source?.kind === "book" ? { bookId: source.bookId, entryId: source.entryId } : null;
}

/**
 * The world's lore pins with each pin of a copy an earlier build made of a World Info entry (a world
 * entry with a `book` source) pinned to that entry instead, which is what reads now (DESIGN §24.5).
 */
function pinsToBooks(world: WorldDoc): WorldDoc["lorePins"] {
  const pins = world.lorePins;
  if (!pins) return pins;
  const moved = (list: readonly LorePin[] | undefined): LorePin[] =>
    (list ?? []).map((pin) => {
      if (!("lore" in pin)) return pin;
      const copied = copiedEntry(world, pin.lore);
      return copied ? { book: copied.bookId, entry: copied.entryId, ...(pin.keep ? { keep: pin.keep } : {}) } : pin;
    });
  const part = (record: Readonly<Record<string, readonly LorePin[] | undefined>> | undefined): Record<string, LorePin[]> => Object.fromEntries(Object.entries(record ?? {}).map(([id, list]) => [id, moved(list)]));
  return { ...pins, characters: part(pins.characters), places: part(pins.places), steps: part(pins.steps) };
}


/** The entries of the books as the reader has them: each once, by the lore id it reads as (`bookLoreId`), where it first came, as the last read of it has it. */
export function entriesRead(read: readonly HostBookEntry[]): HostBookEntry[] {
  return [...new Map(read.map((e) => [bookLoreId(e.bookId, e.id), e])).values()];
}

/**
 * `world` with the lore of the book entries `live` (`entriesRead`) beside its own, and `live` as it
 * was read, the engine's own left out. `originals` are the originals the copies among `live` name,
 * read apart (`copiedOriginals`): a copy is as secret as its original, wherever that is. Each entry
 * and mark is held back as its text is, against the world's secrets and the entries read: a secret's
 * twin in one of these books reads as that secret, a text read already (a world entry's, or a twin's)
 * is read once, where it first comes.
 */
export function booksAsLore(world: WorldDoc, live: readonly HostBookEntry[], originals: readonly HostBookEntry[]): { world: WorldDoc; entries: HostBookEntry[] } {
  const texts = secretTexts({ world, entries: [...live, ...originals] });
  const lore: Record<string, LoreEntryDef> = {};
  for (const [id, entry] of Object.entries(world.lore)) {
    if (loreSourceOf(entry.source).kind === "book") continue;
    // A world entry's own text may hold marks copied from a book: what anyone may read of it, as its book's would be.
    lore[id] = heldTo(typeof entry.content === "string" && publicText(entry.content) !== entry.content ? { ...entry, content: publicText(entry.content) } : entry, textParts(texts, entry.content));
  }
  const seen = new Set(Object.values(lore).map((entry) => textOf(entry.content)));
  // A book's entry or mark whose text is read already is left out: its twin reads where it first came.
  const keep = (entry: LoreEntryDef): void => {
    const text = heldTextOf(entry, entry.content);
    if (hasOwn(lore, entry.id) || (text !== "" && seen.has(text))) return;
    lore[entry.id] = entry;
    seen.add(text);
  };
  for (const e of live) for (const entry of entryLore(e, secrecyParts(e, texts), world)) keep(entry);
  const lorePins = pinsToBooks(world);
  return { world: { ...world, lore, ...(lorePins ? { lorePins } : {}) }, entries: live.filter((e) => !engineWroteEntry(e.extensions)) };
}
