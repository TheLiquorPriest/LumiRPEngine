// Lore curation on the host (DESIGN §4.2): whether a lore entry indexed from a World Info book still
// matches its book entry. The host's books are readable, so the entry's stored hash is compared
// with the book entry's text now; Build offers the new text for review.

import type { UserId } from "../shared/ids";
import { bookTextHash, loreSourceOf } from "../shared/lore";
import type { LoreDrift } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import type { HostBookEntry, HostPort } from "./host";

/** The world's book-sourced entries (or just `only`) whose book entry changed since they were indexed, or is gone. Each book is read once. */
export async function bookDrift(host: HostPort, world: WorldDoc, userId: UserId, only?: string): Promise<Record<string, LoreDrift>> {
  const books = new Map<string, Map<string, HostBookEntry>>();
  const out: Record<string, LoreDrift> = {};
  for (const [id, entry] of Object.entries(world.lore)) {
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book" || (only !== undefined && id !== only)) continue;
    let book = books.get(source.bookId);
    if (!book) {
      // A deleted book reads as one with no entries: every entry from it is gone.
      const entries = await host.books.entries(source.bookId, userId).catch((): HostBookEntry[] => []);
      book = new Map(entries.map((e) => [e.id, e]));
      books.set(source.bookId, book);
    }
    const now = book.get(source.entryId);
    if (!now) {
      out[id] = { status: "missing" };
      continue;
    }
    const hash = bookTextHash(now.content);
    if (hash !== source.hash) out[id] = { status: "changed", content: now.content, hash };
  }
  return out;
}
