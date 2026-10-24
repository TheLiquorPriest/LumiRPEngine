// World Info as lore, read live (DESIGN §4.2, §5.4): the books a world chat reads lore from and each
// of their entries as one of the world's lore entries, its LRE fields (`BookLoreFields`) read from
// its extension data. The world's own list of lore books, the chat's books and the user's global
// books are read; the engine's own books never are. A character's or persona's book is read only
// when the world lists it: Spindle tells an extension no other book the host scans.

import type { ChatId, UserId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import { bookLoreFieldsOf, bookTextHash, engineWroteEntry, loreBooksOf, loreIsSecret, loreSourceOf, withBookLoreFields, type BookLoreFields } from "../shared/lore";
import type { LoreEntryDef, WorldDoc } from "../shared/world";
import { compile } from "../engine/expr";
import type { HostBookEntry, HostPort } from "./host";
import { bookEntryTitle } from "./lore-pins";

/** A book entry's id as a lore entry, the same as its pin's key, so it reads once however it comes. */
export function bookLoreId(bookId: string, entryId: string): string {
  return `book:${bookId}/${entryId}`;
}

/** Why LRE's fields can't go on a book entry as given, or null when they can: a secret needs a gate that reads. */
export function bookLoreProblem(fields: BookLoreFields): string | null {
  if (!loreIsSecret(fields)) return null;
  if (fields.gate === undefined || fields.gate.trim() === "") return "a secret entry needs a gate: the condition under which it may be read";
  try {
    compile(fields.gate);
  } catch (error) {
    return `its gate doesn't read: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

/**
 * Writes LRE's fields onto a World Info entry (Build → Lore → World Info, DESIGN §4.2); null takes
 * them off, and the rest of its extension data stays. Making it secret stores it switched off, so the
 * host never activates it by itself and the interceptor switches it on for a prompt only once its gate
 * holds (§6.1); making a secret one not secret switches it back on.
 */
export async function writeBookLore(host: Pick<HostPort, "books">, e: HostBookEntry, fields: BookLoreFields | null, userId: UserId): Promise<void> {
  const was = bookLoreFieldsOf(e.extensions);
  const secret = fields !== null && loreIsSecret(fields);
  const disabled = secret ? true : was !== null && loreIsSecret(was) ? false : null;
  await host.books.setExtensions(e.id, withBookLoreFields(e.extensions, fields), disabled, userId);
}

/**
 * Keeps the book entry each secret world entry was indexed from stored switched off, with LRE's
 * secret fields and the world entry's gate (DESIGN §4.2, §6.1): the host then never activates it by
 * itself, whatever happens to the interceptor (a throw, a state it can't read, the host's time running
 * out), and its gate switches it on for a prompt as any LRE-secret entry's does. `only` limits it to
 * some of the world's entries. A book entry already so stored, gone, in another book or written by
 * the engine is left alone, and one that can't be written is logged.
 */
export async function secureIndexedSecrets(host: Pick<HostPort, "books" | "log">, world: WorldDoc, userId: UserId, only?: (id: string) => boolean): Promise<void> {
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book" || !loreIsSecret(entry) || (only && !only(id))) continue;
    try {
      const e = await host.books.entry(source.entryId, userId);
      if (!e || e.bookId !== source.bookId || engineWroteEntry(e.extensions)) continue;
      const own = bookLoreFieldsOf(e.extensions);
      const gate = typeof entry.gate === "string" ? entry.gate : undefined;
      if (e.disabled && own !== null && loreIsSecret(own) && own.gate === gate) continue;
      const { gate: _theirs, ...rest } = own ?? {};
      await writeBookLore(host, e, { ...rest, secret: true, ...(gate !== undefined ? { gate } : {}) }, userId);
    } catch (error) {
      host.log("warn", `[LumiRPEngine] the World Info entry secret lore ${id} was indexed from wasn't switched off: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }
}

/**
 * A World Info entry as lore: null when it isn't any, because the engine wrote it, it holds no text,
 * or its author switched it off and gave it no LRE fields. An entry with LRE fields reads whether it
 * is stored on or off: a secret one is stored off and read only through its gate.
 */
export function bookLoreEntry(e: HostBookEntry): LoreEntryDef | null {
  if (engineWroteEntry(e.extensions) || e.content.trim() === "") return null;
  const fields = bookLoreFieldsOf(e.extensions);
  if (e.disabled && fields === null) return null;
  return {
    id: bookLoreId(e.bookId, e.id),
    title: bookEntryTitle(e),
    content: e.content,
    // The entry's own World Info keys are what its author wrote it to answer to.
    keys: e.keys.filter((k) => k.trim() !== ""),
    links: fields?.links ?? [],
    ...(fields?.aliases ? { aliases: fields.aliases } : {}),
    ...(fields?.secret !== undefined ? { secret: fields.secret } : {}),
    ...(fields?.gate !== undefined ? { gate: fields.gate } : {}),
    ...(fields?.audience ? { audience: fields.audience } : {}),
    ...(fields?.visibility ? { visibility: fields.visibility } : {}),
    ...(fields?.holders ? { holders: fields.holders } : {}),
    source: { kind: "book", bookId: e.bookId, entryId: e.id, hash: bookTextHash(e.content) },
  };
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
 * book reading that entry's text as the book has it now, then every lore entry of the books the chat
 * reads, live. An entry indexed into the world is read once, as the world's. A book that can't be
 * read gives nothing, and the log says so; a listed book that is gone is named too.
 */
export async function liveLore(host: Pick<HostPort, "books" | "chats" | "log">, world: WorldDoc, chatId: ChatId | null, userId: UserId): Promise<WorldDoc> {
  const books = await loreBookIds(host, world, chatId, userId);
  for (const id of books.gone) host.log("warn", `[LumiRPEngine] lore book ${id} the world lists is gone: no call reads it (Build → Lore → Lore books)`, userId);
  if (books.read.length === 0) return world;
  const read = await Promise.all(
    books.read.map((id) =>
      host.books.entries(id, userId).catch((error: unknown) => {
        host.log("warn", `[LumiRPEngine] lore book ${id} wasn't read: ${error instanceof Error ? error.message : String(error)}`, userId);
        return [];
      }),
    ),
  );
  const live = new Map(read.flat().map((e) => [bookLoreId(e.bookId, e.id), e]));
  const lore: Record<string, LoreEntryDef> = {};
  const indexed = new Set<string>();
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    const key = source.kind === "book" ? bookLoreId(source.bookId, source.entryId) : null;
    const now = key ? live.get(key) : undefined;
    if (key && now) indexed.add(key);
    lore[id] = now && now.content.trim() !== "" ? { ...entry, content: now.content } : entry;
  }
  for (const [key, e] of live) {
    if (indexed.has(key) || hasOwn(lore, key)) continue;
    const entry = bookLoreEntry(e);
    if (entry) lore[key] = entry;
  }
  return { ...world, lore };
}
