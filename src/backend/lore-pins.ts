// Lore pinned to characters and places, read on the host (DESIGN §24.5, §5.4). A world entry's text
// comes from the world document, a World Info book entry's from the host each time a call reads it,
// so a pinned book entry always reads as its book has it now (switched off in the book or not: the
// pin is the author's choice). Also what Build and the GM view show of the pins (each entry's title,
// where it comes from and whether it reads), and the books and entries a pin may name.

import type { ChatId, UserId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import { loreIsSecret, lorePinKey, lorePinsOf, loreSourceOf } from "../shared/lore";
import type { LoreBookEntryView, LoreBookView, LorePinView, LorePinsView } from "../shared/protocol";
import type { LorePin, WorldDoc } from "../shared/world";
import { worldPinText, type PinRef, type PinnedText } from "../engine/lore-pins";
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

/** Reads each book entry a set of pins names once, by key; one that is gone, or in another book, reads as null. */
async function bookEntries(host: Pick<HostPort, "books" | "log">, pins: readonly LorePin[], userId: UserId): Promise<Map<string, HostBookEntry | null>> {
  const out = new Map<string, HostBookEntry | null>();
  await Promise.all(
    pins.map(async (pin) => {
      if ("lore" in pin) return;
      const key = lorePinKey(pin);
      if (out.has(key)) return;
      out.set(key, null);
      try {
        const e = await host.books.entry(pin.entry, userId);
        out.set(key, e && e.bookId === pin.book ? e : null);
      } catch (error) {
        host.log("warn", `[LumiRPEngine] a pinned World Info entry (${pin.book}/${pin.entry}) wasn't read: ${error instanceof Error ? error.message : String(error)}`, userId);
      }
    }),
  );
  return out;
}

/**
 * The text of each pin in `refs`, in order (DESIGN §24.5): a world entry from the world, a book's
 * from the host, each book entry read once. A pin whose entry is gone, or whose book can't be read,
 * is left out; lint and the pin views name it.
 */
export async function readPins(host: Pick<HostPort, "books" | "log">, world: WorldDoc, refs: readonly PinRef[], userId: UserId): Promise<PinnedText[]> {
  if (refs.length === 0) return [];
  const books = await bookEntries(host, refs.map((r) => r.pin), userId);
  return refs.flatMap((ref): PinnedText[] => {
    if ("lore" in ref.pin) {
      const text = worldPinText(world, ref);
      return text ? [text] : [];
    }
    const e = books.get(ref.key);
    return e ? [{ key: ref.key, on: ref.on, title: bookEntryTitle(e), content: e.content, entry: null }] : [];
  });
}

/**
 * Every pin of `world`, read now (`lre.lore pins`), by character and by place: each entry's title,
 * where it comes from (the world's lore, or its book by name) and whether it reads. GM and author
 * data: secret entries are named here.
 */
export async function pinViews(host: Pick<HostPort, "books" | "log">, world: WorldDoc, userId: UserId): Promise<LorePinsView> {
  const pins = lorePinsOf(world);
  const all = [...Object.values(pins.characters), ...Object.values(pins.places)].flat();
  const books = await bookEntries(host, all, userId);
  const names = all.some((p) => !("lore" in p)) ? new Map((await host.books.list(userId).catch(() => [])).map((b) => [b.id, b.name])) : new Map<string, string>();
  const view = (pin: LorePin): LorePinView => {
    const key = lorePinKey(pin);
    if ("lore" in pin) {
      const entry = hasOwn(world.lore, pin.lore) ? world.lore[pin.lore] : undefined;
      if (!entry) return { key, pin, title: pin.lore, source: "World lore", status: "missing", secret: false };
      const source = loreSourceOf(entry.source);
      return { key, pin, title: entry.title || pin.lore, source: "World lore", status: source.kind === "ai" && source.status === "pending" ? "pending" : "ok", secret: loreIsSecret(entry) };
    }
    const e = books.get(key) ?? null;
    const source = names.get(pin.book) ?? "A World Info book";
    return e ? { key, pin, title: bookEntryTitle(e), source, status: e.disabled ? "off" : "ok", secret: false } : { key, pin, title: "A book entry", source, status: "missing", secret: false };
  };
  const part = (record: Readonly<Record<string, readonly LorePin[]>>): Record<string, LorePinView[]> => Object.fromEntries(Object.entries(record).map(([id, list]) => [id, list.map(view)]));
  return { characters: part(pins.characters), places: part(pins.places) };
}

/** The World Info books a pin may name an entry of (`lre.lore books`): the engine's own left out, those attached to the chat first, then by name. */
export async function pinBooks(host: Pick<HostPort, "books" | "chats">, chatId: ChatId | null, userId: UserId): Promise<LoreBookView[]> {
  const meta = chatId === null ? {} : await host.chats.chatMetadata(chatId, userId);
  const attached = new Set(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((id): id is string => typeof id === "string") : []);
  return (await host.books.list(userId))
    .filter((b) => !b.engine)
    .map((b) => ({ id: b.id, name: b.name, attached: attached.has(b.id) }))
    .sort((a, b) => Number(b.attached) - Number(a.attached) || a.name.localeCompare(b.name));
}

/** One book's entries, for a pin picker (`lre.lore entries`), in the book's order. */
export async function pinEntries(host: Pick<HostPort, "books">, bookId: string, userId: UserId): Promise<LoreBookEntryView[]> {
  return (await host.books.entries(bookId, userId)).map((e) => ({ id: e.id, title: bookEntryTitle(e), disabled: e.disabled, chars: e.content.length }));
}
