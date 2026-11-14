// Lore ids (plan §9.1): an id says which source its entry comes from. A world entry is `w-` and its
// key in the world document, which the world format keeps for good. A book entry is `e-` and a
// number. Lumiverse names an entry by a long random id, which agents copy badly and pay for in every
// line that shows it, so RPE gives each entry a short number the first time it sees it and keeps the
// number in its own database. A number is never given twice and never taken back, so an id an agent
// wrote down names the same entry for as long as RPE's database stands, whatever becomes of the entry.

import type { Database } from "bun:sqlite";

/** What a lore id names: a book entry by its number, or a world entry by its key. */
export type LoreRef = { kind: "book"; n: number } | { kind: "world"; key: string };

/** A book entry's id: `e-` and a number from 1, with no leading zero, short enough to stay an exact number. */
const BOOK_ID = /^e-([1-9][0-9]{0,14})$/;
const WORLD_PREFIX = "w-";

export function bookEntryId(n: number): string {
  return `e-${n}`;
}

export function worldEntryId(key: string): string {
  return `${WORLD_PREFIX}${key}`;
}

/** What `id` names, or null when it is not a lore id. */
export function loreRefOf(id: string): LoreRef | null {
  const book = BOOK_ID.exec(id);
  if (book) return { kind: "book", n: Number(book[1]) };
  if (id.startsWith(WORLD_PREFIX) && id.length > WORLD_PREFIX.length) return { kind: "world", key: id.slice(WORLD_PREFIX.length) };
  return null;
}

/** The lore area's tables, as steps for the application's migration runner (its area `lore`). */
export const LORE_MIGRATIONS: readonly { readonly version: number; readonly name: string; readonly sql: string }[] = [
  {
    version: 1,
    name: "book entry numbers",
    sql: `CREATE TABLE lore_entry_number (
  user TEXT NOT NULL,
  n INTEGER NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (user, n),
  UNIQUE (user, entry)
)`,
  },
];

/**
 * How RPE's database takes a write: queued behind every write asked for before it, run alone inside
 * a transaction of its own (the application's write queue). Outside it the database takes no writes.
 */
export interface LoreWrites {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

/** Entries asked about in one statement: far below SQLite's limit on a statement's parameters. */
const ASK_AT_ONCE = 500;

/** The numbers of each user's book entries (see the header). */
export class EntryNumbers {
  constructor(
    private readonly db: Database,
    private readonly writes: LoreWrites,
  ) {}

  /**
   * The number of each entry, by Lumiverse's id. An entry seen for the first time is given the next
   * number, in the order asked, and the number is kept before it is given.
   */
  async of(user: string, entries: readonly string[]): Promise<Map<string, number>> {
    const wanted = [...new Set(entries)];
    const known = this.known(user, wanted);
    const fresh = wanted.filter((entry) => !known.has(entry));
    if (fresh.length === 0) return known;
    await this.writes.run((db) => {
      let last = db.query<{ n: number | null }, [string]>("SELECT max(n) AS n FROM lore_entry_number WHERE user = ?").get(user)?.n ?? 0;
      const give = db.query<unknown, [string, number, string]>("INSERT OR IGNORE INTO lore_entry_number (user, n, entry) VALUES (?, ?, ?)");
      // An entry numbered by a write queued just before this one keeps its number.
      for (const entry of fresh) if (give.run(user, last + 1, entry).changes > 0) last++;
    }, "numbering lore entries");
    return this.known(user, wanted);
  }

  /** The Lumiverse id of the entry `n` was given to; null for a number never given. */
  entry(user: string, n: number): string | null {
    return this.db.query<{ entry: string }, [string, number]>("SELECT entry FROM lore_entry_number WHERE user = ? AND n = ?").get(user, n)?.entry ?? null;
  }

  private known(user: string, entries: readonly string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < entries.length; i += ASK_AT_ONCE) {
      const part = entries.slice(i, i + ASK_AT_ONCE);
      // Prepared rather than cached: the statement's shape changes with the number of entries asked about.
      const rows = this.db.prepare<{ entry: string; n: number }, string[]>(`SELECT entry, n FROM lore_entry_number WHERE user = ? AND entry IN (${part.map(() => "?").join(", ")})`).all(user, ...part);
      for (const row of rows) out.set(row.entry, row.n);
    }
    return out;
  }
}
