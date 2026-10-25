// Lore pinned to characters, places and steps, read on the host (DESIGN §24.5, §5.4). A world entry's
// text comes from the world document, a World Info book's from the host each time a call reads it,
// so a pinned book entry always reads as its book has it now (switched off in the book or not: the
// pin is the author's choice), and a pinned whole book as its switched-on entries are now, a new one
// included. A pinned book entry is as secret as the World Info interceptor and live lore hold it
// (`secrecyParts`): its own fields, the world entry indexed from it, and every secret its text is.
// Also what Build and the GM view show of the pins (each entry's title, where it comes from and
// whether it reads), and the books and entries a pin may name.

import type { ChatId, UserId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { bookLoreFieldsOf, engineWroteEntry, loreIsSecret, lorePinKey, lorePinsOf, loreSourceOf } from "../shared/lore";
import type { LoreBookEntryView, LoreBookView, LorePinView, LorePinsView } from "../shared/protocol";
import type { LorePin, WorldDoc } from "../shared/world";
import { worldPinText, type PinRef, type PinnedText } from "../engine/lore-pins";
import type { HostBookEntry, HostPort } from "./host";
import { bookEntryLore, bookEntryTitle } from "./book-lore";
import { loreIndex, secrecyParts, secretTexts, twinViews, type SecretTexts } from "./lore-secrets";

/** An entry the engine wrote (`engineWroteEntry`: its own books' sections, the Minds section among them, which holds other minds): never read through a pin, whatever names it. */
function engineWrote(e: HostBookEntry): boolean {
  return engineWroteEntry(e.extensions);
}

/**
 * What a set of pins names on the host, each read once: a book entry by its pin's key (null: gone,
 * or in another book), and a whole book's entries by its id, as the host lists them, in the book's
 * own order (its entries' Order, then id), switched-off ones too for the pin views (null: unread).
 */
interface BookReads {
  entries: Map<string, HostBookEntry | null>;
  books: Map<string, HostBookEntry[] | null>;
}

async function bookReads(host: Pick<HostPort, "books" | "log">, pins: readonly LorePin[], userId: UserId): Promise<BookReads> {
  const out: BookReads = { entries: new Map(), books: new Map() };
  const unread = (what: string, error: unknown): void => host.log("warn", `[LumiRPEngine] ${what} wasn't read: ${error instanceof Error ? error.message : String(error)}`, userId);
  await Promise.all(
    pins.map(async (pin) => {
      if ("lore" in pin) return;
      if (!("entry" in pin)) {
        if (out.books.has(pin.book)) return;
        out.books.set(pin.book, null);
        try {
          out.books.set(pin.book, (await host.books.entries(pin.book, userId)).filter((e) => !engineWrote(e)));
        } catch (error) {
          unread(`a pinned World Info book (${pin.book})`, error);
        }
        return;
      }
      const key = lorePinKey(pin);
      if (out.entries.has(key)) return;
      out.entries.set(key, null);
      try {
        const e = await host.books.entry(pin.entry, userId);
        out.entries.set(key, e && e.bookId === pin.book && !engineWrote(e) ? e : null);
      } catch (error) {
        unread(`a pinned World Info entry (${pin.book}/${pin.entry})`, error);
      }
    }),
  );
  return out;
}

/**
 * A book entry as pinned text, under the key a pin of that one entry has, so a call reads it once
 * however it is pinned; it keeps the part its pin keeps. One anything holds back (`secrecyParts`:
 * its LRE fields, the world entry indexed from it, a secret its text is) is lore as a world entry is
 * (`entry`), so that secrecy, audience, holders and Known by hold for every reader of the pin, the
 * traces included.
 */
function bookText(e: HostBookEntry, ref: PinRef, texts: SecretTexts): PinnedText {
  const parts = secrecyParts(e, texts);
  return { key: lorePinKey({ book: e.bookId, entry: e.id }), on: ref.on, title: bookEntryTitle(e), content: e.content, entry: parts.length > 0 ? bookEntryLore(e, parts) : null, keep: ref.pin.keep ?? "start" };
}

/**
 * Reads, once, every book entry and whole book `refs` name, and gives the text of any of those refs
 * in order (DESIGN §24.5): a world entry from the world, a book entry from its book, a whole book's
 * switched-on entries in the book's order; each entry once, where it first comes. A pin whose entry
 * or book is gone, or can't be read, gives nothing; lint and the pin views name it. `world` is the
 * world as the call reads lore (`liveLore`), whose entries say what their sources are held to.
 */
export async function pinReader(host: Pick<HostPort, "books" | "log">, world: WorldDoc, refs: readonly PinRef[], userId: UserId): Promise<(refs: readonly PinRef[]) => PinnedText[]> {
  const [read, index] = await Promise.all([bookReads(host, refs.map((r) => r.pin), userId), refs.some((r) => !("lore" in r.pin)) ? loreIndex(host, userId) : null]);
  const texts = secretTexts(index, { world });
  return (some) => {
    const out: PinnedText[] = [];
    const seen = new Set<string>();
    const give = (t: PinnedText | null): void => {
      if (!t || seen.has(t.key)) return;
      seen.add(t.key);
      out.push(t);
    };
    for (const ref of some) {
      if ("lore" in ref.pin) give(worldPinText(world, ref));
      else if ("entry" in ref.pin) {
        const e = read.entries.get(ref.key);
        give(e ? bookText(e, ref, texts) : null);
      } else for (const e of read.books.get(ref.pin.book) ?? []) if (!e.disabled) give(bookText(e, ref, texts));
    }
    return out;
  };
}

/** The text of the pins in `refs`, read now, in order (`pinReader`, for one set of pins). */
export async function readPins(host: Pick<HostPort, "books" | "log">, world: WorldDoc, refs: readonly PinRef[], userId: UserId): Promise<PinnedText[]> {
  return refs.length === 0 ? [] : (await pinReader(host, world, refs, userId))(refs);
}

/**
 * Every pin of `world`, read now (`lre.lore pins`), by character, by place and by step: each entry's
 * or book's title, where it comes from (the world's lore, or its book by name) and whether it reads.
 * GM and author data: secret entries are named here.
 */
export async function pinViews(host: Pick<HostPort, "books" | "log">, world: WorldDoc, userId: UserId): Promise<LorePinsView> {
  const pins = lorePinsOf(world);
  const all = [...Object.values(pins.characters), ...Object.values(pins.places), ...Object.values(pins.steps)].flatMap((list) => list ?? []);
  const read = await bookReads(host, all, userId);
  const books = all.some((p) => !("lore" in p)) ? await host.books.list(userId).catch(() => []) : [];
  const names = new Map(books.map((b) => [b.id, b.name]));
  const view = (pin: LorePin): LorePinView => {
    const key = lorePinKey(pin);
    if ("lore" in pin) {
      const entry = hasOwn(world.lore, pin.lore) ? world.lore[pin.lore] : undefined;
      if (!entry) return { key, pin, title: pin.lore, source: "World lore", status: "missing", secret: false };
      const source = loreSourceOf(entry.source);
      return { key, pin, title: entry.title || pin.lore, source: "World lore", status: source.kind === "ai" && source.status === "pending" ? "pending" : "ok", secret: loreIsSecret(entry) };
    }
    if (!("entry" in pin)) {
      // A whole book reads whatever it holds switched on; one that is gone, or the engine's own, reads nothing.
      const book = books.find((b) => b.id === pin.book);
      const entries = read.books.get(pin.book);
      if (!book || book.engine || !entries) return { key, pin, title: "A World Info book", source: "The whole book", status: "missing", secret: false };
      const on = entries.filter((e) => !e.disabled).length;
      return { key, pin, title: book.name, source: `The whole book: ${on} ${on === 1 ? "entry" : "entries"} switched on`, status: "ok", secret: false };
    }
    const e = read.entries.get(key) ?? null;
    const source = names.get(pin.book) ?? "A World Info book";
    return e ? { key, pin, title: bookEntryTitle(e), source, status: e.disabled ? "off" : "ok", secret: loreIsSecret(bookLoreFieldsOf(e.extensions) ?? {}) } : { key, pin, title: "A book entry", source, status: "missing", secret: false };
  };
  const part = (record: Readonly<Record<string, readonly LorePin[] | undefined>>): Record<string, LorePinView[]> => Object.fromEntries(Object.entries(record).map(([id, list]) => [id, (list ?? []).map(view)]));
  return { characters: part(pins.characters), places: part(pins.places), steps: part(pins.steps) };
}

/**
 * The World Info books a pin may name an entry of (`lre.lore books`): the engine's own left out,
 * those attached to the chat first, then by name. Each says whether a character brought it and when
 * it was made, which tells apart books that share a name (a character's card brings its own copy).
 */
export async function pinBooks(host: Pick<HostPort, "books" | "chats">, chatId: ChatId | null, userId: UserId): Promise<LoreBookView[]> {
  const meta = chatId === null ? {} : await host.chats.chatMetadata(chatId, userId);
  const attached = new Set(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((id): id is string => typeof id === "string") : []);
  return (await host.books.list(userId))
    .filter((b) => !b.engine)
    .map((b) => ({ id: b.id, name: b.name, attached: attached.has(b.id), character: b.character, added: b.added }))
    .sort((a, b) => Number(b.attached) - Number(a.attached) || a.name.localeCompare(b.name));
}

/**
 * One book's entries, for a pin picker and the lore editor (`lre.lore entries`), in the book's order,
 * each with its LRE fields when it has any, its twins in any of the user's books (what its secrecy
 * keeps off with it: `twinViews`), and, for a twin kept secret as a copy, the entry it follows.
 */
export async function pinEntries(host: Pick<HostPort, "books" | "log">, bookId: string, userId: UserId): Promise<LoreBookEntryView[]> {
  const [entries, index] = await Promise.all([host.books.entries(bookId, userId), loreIndex(host, userId)]);
  return entries.map((e) => {
    const lore = bookLoreFieldsOf(e.extensions);
    const { twins, copyOf } = twinViews(index, e);
    return { id: e.id, title: bookEntryTitle(e), disabled: e.disabled, chars: e.content.length, ...(lore ? { lore } : {}), ...(twins.length > 0 ? { twins } : {}), ...(copyOf ? { copyOf } : {}) };
  });
}
