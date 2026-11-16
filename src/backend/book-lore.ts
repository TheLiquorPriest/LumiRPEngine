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
// user's press (`build/lore/`): no entry is switched off, nothing is copied, and LRE's old secrecy fields are read as
// they stand.

import type { ChatId, UserId } from "../shared/ids";
import { deepFreeze, isRecord } from "../shared/json";
import { loreBooksOf, loreSourceOf } from "../shared/lore";
import type { WorldDoc } from "../shared/world";
import type { LoreBooks } from "../shared/settings";
import type { HostBookEntry, HostPort } from "../shared/host";
import { bookLoreId, booksAsLore, copiedEntry, entriesRead } from "../secrecy/book-lore";
import { copiedOriginals } from "../secrecy/lore-secrets";

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
  const live = entriesRead(read.flat());
  // A copy in these books is as secret as its original, which is read for it wherever it is.
  const originals = await copiedOriginals((id) => host.books.entry(id, userId), live, (message) => host.log("warn", message, userId));
  return booksAsLore(world, live, originals);
}
