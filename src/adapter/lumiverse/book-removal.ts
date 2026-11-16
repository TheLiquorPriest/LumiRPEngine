// A book removed and detached from every chat that has it, as the user, through Lumiverse's own routes (STANDALONE-PLAN §15.4; READINGS N-17): the previous engine's world book on his press,
// and the projection book of a chat. Every chat of his that names the book in the one key `chat_world_book_ids` of its metadata has the book taken out of that key alone, by Lumiverse's
// atomic merge (`PATCH /api/v1/chats/:id/metadata`), so nothing else of any chat changes; the book is then deleted (`DELETE /api/v1/world-books/:id`). What it changed is reported.

import { isRecord } from "../../shared/json";
import type { LumiverseReads } from "./reads";
import { LumiverseError, type LumiverseSession } from "./session";

const enc = encodeURIComponent;

export interface BookRemovalDeps {
  session: LumiverseSession;
  /** The door's reads: every chat of the user's, to find the ones that have the book. */
  reads: Pick<LumiverseReads, "chats">;
}

/** What one removal changed. */
export interface BookRemoved {
  book: string;
  /** The chats the book was taken out of, in the order they were found. */
  detached: string[];
  /** The book was deleted; false where Lumiverse had no such book of his (already gone). */
  removed: boolean;
}

/** The chat's `chat_world_book_ids` as Lumiverse holds it now; null where the chat is not one of this user's. */
export async function chatBooksNow(session: LumiverseSession, chat: string): Promise<string[] | null> {
  const body = await session.json("GET", `/api/v1/chats/${enc(chat)}?messages=false`);
  if (!isRecord(body)) return null;
  const meta = isRecord(body.metadata) ? body.metadata : {};
  return Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids.filter((id): id is string => typeof id === "string") : [];
}

/** The chat's one key set, by Lumiverse's atomic merge: every other key of its metadata is left as it is. */
export async function setChatBooks(session: LumiverseSession, chat: string, ids: readonly string[]): Promise<void> {
  const a = await session.request("PATCH", `/api/v1/chats/${enc(chat)}/metadata`, { chat_world_book_ids: ids });
  if (a.status !== 200) throw new LumiverseError("protocol", `Lumiverse answered ${a.status} when RPE set the books of chat ${chat}.`, a.status);
}

/** The book taken out of every chat that names it, and deleted. A book already gone from Lumiverse is reported not removed. */
export async function removeBook(deps: BookRemovalDeps, book: string): Promise<BookRemoved> {
  const detached: string[] = [];
  for (const chat of await deps.reads.chats()) {
    const named = chat.metadata.chat_world_book_ids;
    if (!Array.isArray(named) || !named.includes(book)) continue;
    // The key as Lumiverse holds it now, not as it was read: only the book is taken out of it.
    const now = await chatBooksNow(deps.session, chat.id);
    if (now === null || !now.includes(book)) continue;
    await setChatBooks(deps.session, chat.id, now.filter((id) => id !== book));
    detached.push(chat.id);
  }
  const gone = await deps.session.request("DELETE", `/api/v1/world-books/${enc(book)}`);
  if (gone.status !== 200 && gone.status !== 404) throw new LumiverseError("protocol", `Lumiverse answered ${gone.status} when RPE deleted the book ${book}.`, gone.status);
  return { book, detached, removed: gone.status === 200 };
}
