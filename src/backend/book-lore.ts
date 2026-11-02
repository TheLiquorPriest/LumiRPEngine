// World Info as lore, read live (DESIGN §4.2, §5.4): the books a world chat reads lore from and each
// of their entries as one of the world's lore entries, its LRE fields (`BookLoreFields`) read from its
// extension data and its secret marks from its text (`shared/secret-marks.ts`). The world's own list
// of lore books, the chat's books and the user's global books are read; the engine's own books never
// are. A character's or persona's book is read only when the world lists it: Spindle tells an
// extension no other book the host scans. Every entry reads as secret as its text is
// (`lore-secrets.ts`): a secret's twin, in whatever book the chat reads, reads as the secret.
//
// A mark is a secret fact with holders: an entry whose whole text is one mark is a secret entry, and
// each mark in a longer entry is a secret entry of its own beside the rest of the text, which reads
// as the entry does. Nothing here writes a book but Build's own Save and Make secret, each on the
// user's press: no entry is switched off, nothing is copied, and LRE's old secrecy fields are read as
// they stand.

import type { ChatId, UserId } from "../shared/ids";
import { deepFreeze, hasOwn, isRecord } from "../shared/json";
import { bookLoreFieldsOf, bookTextHash, editedBookFields, engineWroteEntry, loreBooksOf, loreIsSecret, loreSourceOf, secretCopyOf, withBookLoreFields, type BookFieldsEdit, type BookLoreFields } from "../shared/lore";
import type { LoreMarkChange } from "../shared/protocol";
import { parseSecretMarks, publicText, SecretMarkError, unreadableMarks, wholeEntrySecret, writeSecretMark, type MarkNamesSource, type SecretMark, type SecretMarkInput } from "../shared/secret-marks";
import type { LoreEntryDef, LorePin, WorldDoc } from "../shared/world";
import type { LoreBooks } from "../shared/settings";
import type { HostBookEntry, HostPort } from "./host";
import { copiedOriginals, heldTextOf, heldTo, markFields, secrecyParts, secretTexts, textOf, textParts } from "./lore-secrets";

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

/** Why Build can't change a book entry's marks as asked (`markedContent`), in words for the user. */
export class MarkChangeError extends Error {}

/** A change to an entry's marks as a request gives it (`lre.lore mark`), or null when it isn't one; names absent read as none, and "kept from" absent as everyone. */
export function markChangeOf(raw: unknown): LoreMarkChange | null {
  if (!isRecord(raw)) return null;
  const names = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x): x is string => typeof x === "string") ? [...v] : null);
  const knownTo = raw.knownTo === undefined ? [] : names(raw.knownTo);
  const keptFrom = raw.keptFrom === undefined || raw.keptFrom === "everyone" ? "everyone" : names(raw.keptFrom);
  const mark = typeof raw.mark === "number" && Number.isInteger(raw.mark) && raw.mark >= 0 ? raw.mark : null;
  if (raw.kind === "public") return mark === null ? null : { kind: "public", mark };
  if (knownTo === null || keptFrom === null) return null;
  if (raw.kind === "secret") return { kind: "secret", knownTo, keptFrom };
  if (raw.kind === "add") return typeof raw.text === "string" ? { kind: "add", text: raw.text, knownTo, keptFrom } : null;
  if (raw.kind === "names") return mark === null ? null : { kind: "names", mark, knownTo, keptFrom };
  return null;
}

/**
 * An entry's text with `change` made to its secret marks (Build's Make secret, DESIGN §4.2): nothing
 * else of the text changes. An entry an earlier build keeps secret by its fields is refused: its
 * secrecy moves to marks with the rest of its book's, where it is kept for a restore. Throws
 * `MarkChangeError` with why it can't be made.
 */
export function markedContent(e: Pick<HostBookEntry, "content" | "extensions">, change: LoreMarkChange): string {
  const marks = parseSecretMarks(e.content);
  const old = bookLoreFieldsOf(e.extensions);
  if (marks.length === 0 && ((old !== null && loreIsSecret(old)) || secretCopyOf(e.extensions) !== null)) throw new MarkChangeError("an earlier build keeps this entry secret by its own fields: move its book's secrecy to marks first (Build → Lore), which keeps the entry as it stood for a restore");
  const written = (input: SecretMarkInput): string => {
    try {
      return writeSecretMark(input);
    } catch (error) {
      if (error instanceof SecretMarkError) throw new MarkChangeError(error.message);
      throw error;
    }
  };
  const at = (n: number): SecretMark => {
    const mark = marks[n];
    if (!Number.isInteger(n) || !mark) throw new MarkChangeError("that entry has no such secret mark");
    return mark;
  };
  switch (change.kind) {
    case "secret":
      if (marks.length > 0 || unreadableMarks(e.content).length > 0) throw new MarkChangeError("this entry already holds secret marks: change those, or make them public first");
      return written({ text: e.content, knownTo: change.knownTo, keptFrom: change.keptFrom });
    case "add": {
      const line = written({ text: change.text, knownTo: change.knownTo, keptFrom: change.keptFrom });
      return e.content === "" || e.content.endsWith("\n") ? `${e.content}${line}` : `${e.content}\n${line}`;
    }
    case "names":
    case "public": {
      const mark = at(change.mark);
      const text = change.kind === "public" ? mark.text : written({ text: mark.text, knownTo: change.knownTo, keptFrom: change.keptFrom });
      return `${e.content.slice(0, mark.start)}${text}${e.content.slice(mark.end)}`;
    }
  }
}

/** Writes `change` into a World Info entry's text, on the user's press in Build, and nothing else of it; gives the entry as written. */
export async function markBookEntry(host: Pick<HostPort, "books">, e: HostBookEntry, change: LoreMarkChange, userId: UserId): Promise<HostBookEntry> {
  const content = markedContent(e, change);
  if (content !== e.content) await host.books.update(e.id, { content }, userId);
  return { ...e, content };
}

/**
 * Writes Build's Save of a World Info entry's own LRE fields (DESIGN §4.2): its visibility, links
 * and aliases (null takes them off), the rest of its extension data and an earlier build's secrecy
 * fields kept as they are; nothing else of the entry. Gives the entry as written.
 */
export async function writeBookFields(host: Pick<HostPort, "books">, e: HostBookEntry, edit: BookFieldsEdit | null, userId: UserId): Promise<HostBookEntry> {
  const extensions = withBookLoreFields(e.extensions, editedBookFields(bookLoreFieldsOf(e.extensions), edit));
  await host.books.update(e.id, { extensions }, userId);
  return { ...e, extensions };
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

/**
 * The books a world chat reads lore from (DESIGN §4.2), each once, in order: the world's list, the
 * chat's books, the global ones, then the books an earlier build copied the world's lore from (so a
 * world that has such copies reads the books themselves now); never the engine's own, nor one that is
 * gone. The user's books setting (`picked`, Settings → Lore) narrows them: `"auto"` reads
 * them all, a list only those of them it names. `gone`: listed books that are gone. `updated`: each
 * read book's last change as the host stamps it (`books.list`), which says when a kept read of it
 * is stale (`BookReads`).
 */
export async function loreBookIds(host: Pick<HostPort, "books" | "chats">, world: WorldDoc, chatId: ChatId | null, userId: UserId, picked: LoreBooks): Promise<{ read: string[]; gone: string[]; updated: Map<string, number | null> }> {
  const listed = loreBooksOf(world);
  const copied = Object.values(world.lore).flatMap((entry) => {
    const source = loreSourceOf(entry.source);
    return source.kind === "book" ? [source.bookId] : [];
  });
  const meta = chatId ? await host.chats.chatMetadata(chatId, userId) : {};
  const chat = isRecord(meta) && Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((id): id is string => typeof id === "string") : [];
  const [books, global] = await Promise.all([host.books.list(userId), host.books.global(userId)]);
  const known = new Map(books.map((b) => [b.id, b.engine]));
  const ids = [...new Set([...listed, ...chat, ...global, ...copied])];
  const read = ids.filter((id) => known.get(id) === false && (picked === "auto" || picked.includes(id)));
  return { read, gone: listed.filter((id) => !known.has(id)), updated: bookStamps(books, read) };
}

/** The host's last-change stamp of each of `ids` among `books`. */
export function bookStamps(books: readonly { id: string; updated: number | null }[], ids: readonly string[]): Map<string, number | null> {
  const of = new Map(books.map((b) => [b.id, b.updated]));
  return new Map(ids.map((id) => [id, of.get(id) ?? null]));
}

/**
 * Each World Info book's entries as last read, per user, kept until the book changes (DESIGN §9.6),
 * frozen and shared, so the lore made of each entry is made once (`entryLore`): every turn, Minds run
 * and agent read reads lore live, and reading and hashing every book each time is most of its cost.
 * The host's stamp of a book (`books.list` `updated`) moves whenever it or any of its entries
 * changes, in whole seconds; a read made within the second its stamp names is read again the next
 * time, since a change later in that second wouldn't move it, and a book the host gives no stamp is
 * read every time. The memory budget lets every one go (`trim`).
 */
export class BookReads {
  private readonly kept = new Map<string, { updated: number; at: number; entries: readonly HostBookEntry[] }>();

  async entries(host: Pick<HostPort, "books">, bookId: string, userId: UserId, updated: number | null): Promise<readonly HostBookEntry[]> {
    const key = `${userId}\u0000${bookId}`;
    const kept = this.kept.get(key);
    if (updated !== null && kept && kept.updated === updated && updated < kept.at) return kept.entries;
    const at = Math.floor(Date.now() / 1000);
    const entries = deepFreeze(await host.books.entries(bookId, userId));
    if (updated !== null) this.kept.set(key, { updated, at, entries });
    else this.kept.delete(key);
    return entries;
  }

  /** Lets every kept read go; how many books' went. */
  trim(): number {
    const n = this.kept.size;
    this.kept.clear();
    return n;
  }
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
function copiedEntry(world: WorldDoc, loreId: string): { bookId: string; entryId: string } | null {
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

/**
 * The lore id a turn recorded reads by now (DESIGN §4.2): the id of an earlier build's copy of a
 * World Info entry reads as that entry, as a pin of the copy does (`pinsToBooks`), so an old turn's
 * scene lore still tells it; any other id as recorded. `world` is the revision the turn was played
 * on, its copies with it, before its lore is read live.
 */
export function recordedLoreId(world: WorldDoc, loreId: string): string {
  const copied = copiedEntry(world, loreId);
  return copied ? bookLoreId(copied.bookId, copied.entryId) : loreId;
}

/**
 * The world as its helpers, minds and agents read lore now (DESIGN §4.2): the world's own entries
 * (written in Build, saved from a chat, or written by Index this text), then every lore entry of the
 * World Info books the chat reads (`loreBookIds`), live, marks included (`bookLoreEntries`), each found
 * by its own fields. A copy an earlier build made of a World Info entry (a world entry with a `book`
 * source) isn't read: its book entry is, as the book has it now, and a pin of the copy reads that
 * entry (`pinsToBooks`); the copy still holds the entry back as it did (`secrecyParts`, which reads
 * the world's entries indexed from it). Each is held back as its text is, against the world's secrets
 * and the entries read here: a secret's twin in one of these books reads as that secret; a text read
 * already, a world entry's or a twin's, is read once, where it first comes. A book that can't be read
 * gives nothing, and the log says so; a listed book that is gone is named too. When the chat's books
 * can't be told (the books not listed, say), none is read and the run goes on with the world's own lore.
 * With `reads`, a book unchanged since it was last read isn't read again (`BookReads`).
 */
export async function liveLore(host: Pick<HostPort, "books" | "chats" | "log">, world: WorldDoc, chatId: ChatId | null, userId: UserId, picked: LoreBooks, reads?: BookReads): Promise<WorldDoc> {
  const books = await loreBookIds(host, world, chatId, userId, picked).catch((error: unknown): { read: string[]; gone: string[] } => {
    host.log("warn", `[LumiRPEngine] the World Info books this chat reads weren't told, so none is read as lore this run: ${error instanceof Error ? error.message : String(error)}`, userId);
    return { read: [], gone: [] };
  });
  return (await booksLore(host, world, books, userId, reads)).world;
}

/**
 * `world` with the lore of the books `books.read` names, read live as `liveLore` reads a chat's (a
 * gone one of `books.gone` logged), and the books' entries as they were read, the engine's own left
 * out: what the lore index is made from too (`lore-routing.ts`). With `reads`, a book whose stamp
 * (`books.updated`) is the one it was last read at is taken as read then (`BookReads`).
 */
export async function booksLore(host: Pick<HostPort, "books" | "log">, world: WorldDoc, books: { read: readonly string[]; gone: readonly string[]; updated?: ReadonlyMap<string, number | null> }, userId: UserId, reads?: BookReads): Promise<{ world: WorldDoc; entries: HostBookEntry[] }> {
  for (const id of books.gone) host.log("warn", `[LumiRPEngine] lore book ${id} the world lists is gone: no call reads it (Build → Lore → Lore books)`, userId);
  const read = await Promise.all(
    books.read.map((id) =>
      (reads ? reads.entries(host, id, userId, books.updated?.get(id) ?? null) : host.books.entries(id, userId)).catch((error: unknown) => {
        host.log("warn", `[LumiRPEngine] lore book ${id} wasn't read: ${error instanceof Error ? error.message : String(error)}`, userId);
        return [];
      }),
    ),
  );
  const live = new Map(read.flat().map((e) => [bookLoreId(e.bookId, e.id), e]));
  // A copy in these books is as secret as its original, which is read for it wherever it is.
  const texts = secretTexts({ world, entries: [...live.values(), ...(await copiedOriginals(host, [...live.values()], userId))] });
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
  for (const e of live.values()) for (const entry of entryLore(e, secrecyParts(e, texts), world)) keep(entry);
  const lorePins = pinsToBooks(world);
  return { world: { ...world, lore, ...(lorePins ? { lorePins } : {}) }, entries: [...live.values()].filter((e) => !engineWroteEntry(e.extensions)) };
}
