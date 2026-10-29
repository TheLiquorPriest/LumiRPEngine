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
import { hasOwn, isRecord } from "../shared/json";
import { bookLoreFieldsOf, bookTextHash, editedBookFields, engineWroteEntry, loreBooksOf, loreIsSecret, loreSourceOf, secretCopyOf, withBookLoreFields, type BookFieldsEdit, type BookLoreFields } from "../shared/lore";
import type { LoreMarkChange } from "../shared/protocol";
import { parseSecretMarks, publicText, SecretMarkError, unreadableMarks, wholeEntrySecret, writeSecretMark, type MarkNamesSource, type SecretMark, type SecretMarkInput } from "../shared/secret-marks";
import type { LoreEntryDef, WorldDoc } from "../shared/world";
import type { HostBookEntry, HostPort } from "./host";
import { copiedOriginals, heldTo, markFields, secrecyParts, secretTexts, textOf, textParts } from "./lore-secrets";

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
 * A world entry indexed from a book entry, as read now (DESIGN §4.2): the book's text, held back by
 * the stricter secrecy of the two, since the author may make either secret, and of every other secret
 * its text is (`parts`, `secrecyParts`): secret when any is, open only once every secret side's gate
 * holds (a missing gate never does), its audience and holders joined; Known by when any is, about what
 * each links. Of a book text with marks, it reads what anyone may read (its marks are entries of
 * their own, `bookMarkLores`); of a whole-entry secret, the secret, kept as the mark keeps it. A book
 * text the world's entry already holds is that entry, as `heldTo` keeps an entry nothing holds back:
 * each engine run reads its lore afresh, and these are kept for several runs. Its source carries the
 * hash of the book text read now (`source.hash`), as a book's own entry does, so a reader tells when
 * the text changed since it last read it; the world keeps the hash it was indexed with.
 */
export function indexedEntry(entry: LoreEntryDef, e: HostBookEntry, parts: readonly BookLoreFields[], world: MarkNamesSource): LoreEntryDef {
  const whole = wholeEntrySecret(e.content);
  const text = whole ? whole.text : publicText(e.content);
  const source = loreSourceOf(entry.source);
  const hash = bookTextHash(e.content);
  const read = source.kind === "book" && source.hash !== hash ? { ...entry, source: { ...source, hash } } : entry;
  return heldTo(text.trim() === "" || text === read.content ? read : { ...read, content: text }, whole ? [...parts, markFields(world, whole)] : parts);
}

/**
 * A book entry as lore, on or off (a pin reads either): its own keys, aliases and links, held back by
 * `parts` (`secrecyParts`). Its text is what anyone may read of it; a whole-entry secret is the
 * secret, read by its holders and no one else (a mark has no gate).
 */
export function bookEntryLore(e: HostBookEntry, parts: readonly BookLoreFields[], world: MarkNamesSource): LoreEntryDef {
  const fields = bookLoreFieldsOf(e.extensions);
  const whole = wholeEntrySecret(e.content);
  return heldTo(
    {
      id: bookLoreId(e.bookId, e.id),
      title: bookEntryTitle(e),
      content: whole ? whole.text : publicText(e.content),
      // The entry's own World Info keys are what its author wrote it to answer to.
      keys: e.keys.filter((k) => k.trim() !== ""),
      links: fields?.links ?? [],
      ...(fields?.aliases ? { aliases: fields.aliases } : {}),
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

/** The books a world chat reads lore from, each once, in order: the world's list, the chat's books, then the global ones; never the engine's own, nor one that is gone. */
export async function loreBookIds(host: Pick<HostPort, "books" | "chats">, world: WorldDoc, chatId: ChatId | null, userId: UserId): Promise<{ read: string[]; gone: string[] }> {
  const listed = loreBooksOf(world);
  const meta = chatId ? await host.chats.chatMetadata(chatId, userId) : {};
  const chat = isRecord(meta) && Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((id): id is string => typeof id === "string") : [];
  const [books, global] = await Promise.all([host.books.list(userId), host.books.global(userId)]);
  const known = new Map(books.map((b) => [b.id, b.engine]));
  const ids = [...new Set([...listed, ...chat, ...global])];
  return { read: ids.filter((id) => known.get(id) === false), gone: listed.filter((id) => !known.has(id)) };
}

/**
 * The world as its helpers and minds read lore now (DESIGN §4.2): its own entries, one indexed from a
 * book read from that book entry as it is now (`indexedEntry`: its text and the stricter secrecy of
 * the two, its marks beside it), whether or not the chat reads its book, then every lore entry of the
 * books the chat reads, live, marks included (`bookLoreEntries`). Each is held back as its text is
 * (`secrecyParts`), against the world's secrets and the entries read here: a secret's twin in one of
 * these books reads as that secret; a text read already, a world entry's or a twin's, is read once,
 * where it first comes. A book that can't be read gives nothing, and the log says so; a listed book
 * that is gone is named too. When the chat's books can't be told (the books not listed, say), none
 * is read and the run goes on with the world's own lore.
 */
export async function liveLore(host: Pick<HostPort, "books" | "chats" | "log">, world: WorldDoc, chatId: ChatId | null, userId: UserId): Promise<WorldDoc> {
  const books = await loreBookIds(host, world, chatId, userId).catch((error: unknown): { read: string[]; gone: string[] } => {
    host.log("warn", `[LumiRPEngine] the World Info books this chat reads weren't told, so none is read as lore this run: ${error instanceof Error ? error.message : String(error)}`, userId);
    return { read: [], gone: [] };
  });
  for (const id of books.gone) host.log("warn", `[LumiRPEngine] lore book ${id} the world lists is gone: no call reads it (Build → Lore → Lore books)`, userId);
  // The books entries of the world were indexed from, read for those entries alone.
  const sources = [...new Set(Object.values(world.lore).flatMap((entry) => {
    const source = loreSourceOf(entry.source);
    return source.kind === "book" && !books.read.includes(source.bookId) ? [source.bookId] : [];
  }))];
  const entriesOf = (ids: readonly string[]): Promise<HostBookEntry[][]> =>
    Promise.all(
      ids.map((id) =>
        host.books.entries(id, userId).catch((error: unknown) => {
          host.log("warn", `[LumiRPEngine] lore book ${id} wasn't read: ${error instanceof Error ? error.message : String(error)}`, userId);
          return [];
        }),
      ),
    );
  const [read, sourced] = await Promise.all([entriesOf(books.read), entriesOf(sources)]);
  const live = new Map(read.flat().map((e) => [bookLoreId(e.bookId, e.id), e]));
  const fromBooks = new Map([...live, ...sourced.flat().map((e): [string, HostBookEntry] => [bookLoreId(e.bookId, e.id), e])]);
  // A copy in these books is as secret as its original, which is read for it wherever it is.
  const texts = secretTexts({ world, entries: [...fromBooks.values(), ...(await copiedOriginals(host, [...fromBooks.values()], userId))] });
  const lore: Record<string, LoreEntryDef> = {};
  const indexed = new Set<string>();
  const sourceEntries: HostBookEntry[] = [];
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    const key = source.kind === "book" ? bookLoreId(source.bookId, source.entryId) : null;
    const now = key ? fromBooks.get(key) : undefined;
    if (key && now) indexed.add(key);
    if (now && !engineWroteEntry(now.extensions)) {
      lore[id] = indexedEntry(entry, now, secrecyParts(now, texts), world);
      sourceEntries.push(now);
      // A world entry's own text may hold marks copied from a book: what anyone may read of it, as its book's would be.
    } else lore[id] = heldTo(typeof entry.content === "string" && publicText(entry.content) !== entry.content ? { ...entry, content: publicText(entry.content) } : entry, textParts(texts, entry.content));
  }
  const seen = new Set(Object.values(lore).map((entry) => textOf(entry.content)));
  // A book's entry or mark whose text is read already is left out: its twin reads where it first came.
  const keep = (entry: LoreEntryDef): void => {
    const text = textOf(entry.content);
    if (hasOwn(lore, entry.id) || (text !== "" && seen.has(text))) return;
    lore[entry.id] = entry;
    seen.add(text);
  };
  for (const e of sourceEntries) for (const mark of bookMarkLores(e, world)) keep(mark);
  for (const [key, e] of live) if (!indexed.has(key) && !hasOwn(lore, key)) for (const entry of bookLoreEntries(e, secrecyParts(e, texts), world)) keep(entry);
  return { ...world, lore };
}
