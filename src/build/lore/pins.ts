// Lore pinned to characters, places and steps, as Build shows it (DESIGN §24.5; PlanChatUI-B3 item 2): every pin of a world read now, by
// character, by place and by step, each with its entry's or book's title, where it comes from and whether it reads. A pinned book entry is read as
// its book has it now (switched off in the book or not: the pin is the author's choice), a whole book as its switched-on entries are now. GM and
// author data: secret entries are named here. The text a pin brings into a turn is the turn lane's, not read here.

import type { UserId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { bookLoreFieldsOf, loreIsSecret, lorePinKey, lorePinsOf, loreSourceOf, secretCopyOf } from "../../shared/lore";
import type { LorePinView, LorePinsView } from "../../shared/lore-views";
import { parseSecretMarks, wholeEntrySecret } from "../../shared/secret-marks";
import type { LorePin, WorldDoc } from "../../shared/world";
import { bookEntryTitle } from "../../secrecy/book-lore";
import { type BookEntry, type BuildBooks, engineWrote, listBooks } from "./books";
import { say } from "../../engine/lines";

/** What a set of pins names in his books, each read once: a book entry by its pin's key (null: gone, or in another book), a whole book's entries by its id (null: unread). */
interface Read {
  entries: Map<string, BookEntry | null>;
  books: Map<string, BookEntry[] | null>;
}

async function readPinned(books: BuildBooks, pins: readonly LorePin[], user: UserId, said: (message: string) => void): Promise<Read> {
  const out: Read = { entries: new Map(), books: new Map() };
  const unread = (what: string, error: unknown): void => said(say("lint_what_wasnt_read_error", { what: what, error: error instanceof Error ? error.message : String(error) }));
  await Promise.all(
    pins.map(async (pin) => {
      if ("lore" in pin) return;
      if (!("entry" in pin)) {
        if (out.books.has(pin.book)) return;
        out.books.set(pin.book, null);
        try {
          out.books.set(pin.book, (await books.entries(user, pin.book)).filter((e) => !engineWrote(e)));
        } catch (error) {
          unread(`a pinned World Info book (${pin.book})`, error);
        }
        return;
      }
      const key = lorePinKey(pin);
      if (out.entries.has(key)) return;
      out.entries.set(key, null);
      try {
        const e = await books.entry(user, pin.entry, pin.book);
        out.entries.set(key, e && e.book === pin.book && !engineWrote(e) ? e : null);
      } catch (error) {
        unread(`a pinned World Info entry (${pin.book}/${pin.entry})`, error);
      }
    }),
  );
  return out;
}

/** Every pin of `world`, read now. */
export async function pinViews(books: BuildBooks, world: WorldDoc, user: UserId, said: (message: string) => void): Promise<LorePinsView> {
  const pins = lorePinsOf(world);
  const all = [...Object.values(pins.characters), ...Object.values(pins.places), ...Object.values(pins.steps)].flatMap((list) => list ?? []);
  const read = await readPinned(books, all, user, said);
  const listed = all.some((p) => !("lore" in p)) ? await listBooks(books, user, null).catch(() => []) : [];
  const names = new Map(listed.map((b) => [b.id, b.name]));
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
      const entries = read.books.get(pin.book);
      const name = names.get(pin.book);
      if (name === undefined || !entries) return { key, pin, title: "A World Info book", source: "The whole book", status: "missing", secret: false };
      const on = entries.filter((e) => !e.disabled).length;
      return { key, pin, title: name, source: `The whole book: ${on} ${on === 1 ? "entry" : "entries"} switched on`, status: "ok", secret: false };
    }
    const e = read.entries.get(key) ?? null;
    const source = names.get(pin.book) ?? "A World Info book";
    if (!e) return { key, pin, title: "A book entry", source, status: "missing", secret: false };
    // A whole-entry secret is a secret pin; an entry with marks only keeps them back, so its pin reads what anyone may; a copy an earlier build kept is as secret as its original.
    return { key, pin, title: bookEntryTitle(e), source, status: e.disabled ? "off" : "ok", secret: wholeEntrySecret(e.content) !== null || (parseSecretMarks(e.content).length === 0 && (loreIsSecret(bookLoreFieldsOf(e.extensions) ?? {}) || secretCopyOf(e.extensions) !== null)) };
  };
  const part = (record: Readonly<Record<string, readonly LorePin[] | undefined>>): Record<string, LorePinView[]> => Object.fromEntries(Object.entries(record).map(([id, list]) => [id, (list ?? []).map(view)]));
  return { characters: part(pins.characters), places: part(pins.places), steps: part(pins.steps) };
}
