// World Info as lore, read live (DESIGN §4.2, §5.4): the books a world chat reads lore from and each
// of their entries as one of the world's lore entries, its LRE fields (`BookLoreFields`) read from
// its extension data. The world's own list of lore books, the chat's books and the user's global
// books are read; the engine's own books never are. A character's or persona's book is read only
// when the world lists it: Spindle tells an extension no other book the host scans.

import type { ChatId, UserId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import { bookLoreFieldsOf, bookTextHash, engineWroteEntry, LORE_AUDIENCE, loreBooksOf, loreIsSecret, loreSourceOf, withBookLoreFields, type BookLoreFields } from "../shared/lore";
import type { LoreEntryDef, StepPurpose, WorldDoc } from "../shared/world";
import { compile } from "../engine/expr";
import type { HostBookEntry, HostPort } from "./host";

/** The words a book entry with no comment is titled by. */
const TITLE_WORDS = 8;

/** A book entry's title: its comment, else its text's first words. */
export function bookEntryTitle(e: Pick<HostBookEntry, "comment" | "content">): string {
  const comment = e.comment.replace(/\s+/g, " ").trim();
  if (comment !== "") return comment;
  const words = e.content.replace(/\s+/g, " ").trim().split(" ").filter((w) => w !== "");
  return words.length === 0 ? "Untitled entry" : words.length > TITLE_WORDS ? `${words.slice(0, TITLE_WORDS).join(" ")}…` : words.join(" ");
}

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
    return `the gate doesn't read: ${error instanceof Error ? error.message : String(error)}`;
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
 * secret fields (DESIGN §4.2, §6.1): the host then never activates it by itself, whatever happens to
 * the interceptor (a throw, a state it can't read, the host's time running out). One with no secrecy
 * of its own takes the world entry's gate, which opens it as any LRE-secret entry's does; one the
 * author made secret in the book keeps its own gate, and both must hold (`indexedEntry`), unless
 * that gate is the one the world entry had `before` this write, which this keeps in step. `only`
 * limits it to some of the world's entries. A book entry gone, in another book or written by the
 * engine is left alone, and one that can't be written is logged.
 */
export async function secureIndexedSecrets(host: Pick<HostPort, "books" | "log">, world: WorldDoc, userId: UserId, only?: (id: string) => boolean, before?: WorldDoc): Promise<void> {
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book" || !loreIsSecret(entry) || (only && !only(id))) continue;
    try {
      const e = await host.books.entry(source.entryId, userId);
      if (!e || e.bookId !== source.bookId || engineWroteEntry(e.extensions)) continue;
      const own = bookLoreFieldsOf(e.extensions);
      const gate = typeof entry.gate === "string" ? entry.gate : undefined;
      const was = before && hasOwn(before.lore, id) ? before.lore[id]?.gate : undefined;
      const kept = own !== null && loreIsSecret(own) && own.gate !== gate && (was === undefined || own.gate !== was);
      if (kept || (own !== null && loreIsSecret(own) && own.gate === gate)) {
        if (!e.disabled) await host.books.setExtensions(e.id, e.extensions, true, userId);
        continue;
      }
      const { gate: _mirrored, ...rest } = own ?? {};
      await writeBookLore(host, e, { ...rest, secret: true, ...(gate !== undefined ? { gate } : {}) }, userId);
    } catch (error) {
      host.log("warn", `[LumiRPEngine] the World Info entry secret lore ${id} was indexed from wasn't switched off: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }
}

/**
 * A world entry indexed from a book entry, as read now (DESIGN §4.2): the book's text, and the
 * stricter secrecy of the two, since the author may make either secret: secret when either is, open
 * only once every secret side's gate holds (a missing gate never does), its audience and holders
 * joined; Known by when either is, about what both link.
 */
export function indexedEntry(entry: LoreEntryDef, e: HostBookEntry): LoreEntryDef {
  const out: LoreEntryDef = e.content.trim() === "" ? { ...entry } : { ...entry, content: e.content };
  const fields = bookLoreFieldsOf(e.extensions);
  if (fields === null) return out;
  const gates = [...(loreIsSecret(entry) ? [typeof entry.gate === "string" ? entry.gate : ""] : []), ...(loreIsSecret(fields) ? [fields.gate ?? ""] : [])];
  if (gates.length > 0) {
    out.secret = true;
    out.gate = gates.some((g) => g.trim() === "") ? "" : [...new Set(gates)].map((g) => `(${g})`).join(" && ");
  }
  const joined = (a: unknown, b: readonly string[] | undefined): string[] => [...new Set([...(Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []), ...(b ?? [])])];
  if (fields.audience) out.audience = joined(entry.audience, fields.audience).filter((p): p is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(p));
  if (fields.holders) out.holders = joined(entry.holders, fields.holders);
  if (fields.visibility === "known_by" || entry.visibility === "known_by" || (entry.visibility !== undefined && entry.visibility !== "public")) {
    out.visibility = "known_by";
    out.links = joined(entry.links, fields.links);
  }
  return out;
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
 * book read from that book entry as it is now (`indexedEntry`: its text and the stricter secrecy of
 * the two), whether or not the chat reads its book, then every lore entry of the books the chat
 * reads, live. An entry indexed into the world is read once, as the world's. A book that can't be
 * read gives nothing, and the log says so; a listed book that is gone is named too.
 */
export async function liveLore(host: Pick<HostPort, "books" | "chats" | "log">, world: WorldDoc, chatId: ChatId | null, userId: UserId): Promise<WorldDoc> {
  const books = await loreBookIds(host, world, chatId, userId);
  for (const id of books.gone) host.log("warn", `[LumiRPEngine] lore book ${id} the world lists is gone: no call reads it (Build → Lore → Lore books)`, userId);
  // The books entries of the world were indexed from, read for those entries alone.
  const sources = [...new Set(Object.values(world.lore).flatMap((entry) => {
    const source = loreSourceOf(entry.source);
    return source.kind === "book" && !books.read.includes(source.bookId) ? [source.bookId] : [];
  }))];
  if (books.read.length === 0 && sources.length === 0) return world;
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
  const lore: Record<string, LoreEntryDef> = {};
  const indexed = new Set<string>();
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    const key = source.kind === "book" ? bookLoreId(source.bookId, source.entryId) : null;
    const now = key ? fromBooks.get(key) : undefined;
    if (key && now) indexed.add(key);
    lore[id] = now && !engineWroteEntry(now.extensions) ? indexedEntry(entry, now) : entry;
  }
  for (const [key, e] of live) {
    if (indexed.has(key) || hasOwn(lore, key)) continue;
    const entry = bookLoreEntry(e);
    if (entry) lore[key] = entry;
  }
  return { ...world, lore };
}
