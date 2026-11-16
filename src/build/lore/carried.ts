// A secrecy undo copy carried from today's `secrecy/<hash>.json` (plan §15.2; PlanChatUI-B3): written whole as the row of the book it names, replacing the
// book's row, so the page reads the move as it stood and Restore puts the book back from it. The file is kept as it is: a copy that does not read is
// kept too, and the page says so (`damaged`) and moves nothing over it.

import type { Database } from "bun:sqlite";
import type { UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";

/** Writes the carried file `text` as its book's undo copy; the book's id, or null for a file that names none. */
export function writeCarriedSecrecy(db: Database, user: UserId, text: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.bookId !== "string" || raw.bookId === "") return null;
  db.query("INSERT OR REPLACE INTO build_secrecy (user, book, body) VALUES (?, ?, ?)").run(user, raw.bookId, text);
  return raw.bookId;
}
