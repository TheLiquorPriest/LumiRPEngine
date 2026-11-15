// Lore ids (plan §9.1, R-148): an id says which source its entry comes from and is a short number,
// which stays the same for as long as RPE's database stands: `e-` and a number for a book entry,
// `w-` and a number for a world entry. Lumiverse names a book entry by a long random id, and a world
// document names an entry by its key (which stays the entry's address inside the world); agents copy
// both badly and pay for them in every line that shows them, so RPE gives each entry a short number
// the first time it sees it and keeps the number in its own database: a book entry's by the user
// and its Lumiverse id, a world entry's by the user, its world and its key. Each kind counts from 1
// for each user. A number is never given twice and never taken back, so an id an agent wrote down
// names the same entry for as long as RPE's database stands, whatever becomes of the entry.

import type { Database } from "bun:sqlite";

/** What a lore id names: a book entry by its number, or a world entry by its number. */
export type LoreRef = { kind: "book"; n: number } | { kind: "world"; n: number };

/** A number from 1, with no leading zero, short enough to stay an exact number. */
const NUMBER = "([1-9][0-9]{0,14})";
const BOOK_ID = new RegExp(`^e-${NUMBER}$`);
const WORLD_ID = new RegExp(`^w-${NUMBER}$`);

export function bookEntryId(n: number): string {
  return `e-${n}`;
}

export function worldEntryId(n: number): string {
  return `w-${n}`;
}

/** What `id` names, or null when it is not a lore id. */
export function loreRefOf(id: string): LoreRef | null {
  const book = BOOK_ID.exec(id);
  if (book) return { kind: "book", n: Number(book[1]) };
  const world = WORLD_ID.exec(id);
  if (world) return { kind: "world", n: Number(world[1]) };
  return null;
}

/**
 * How RPE's database takes a write: queued behind every write asked for before it, run alone inside
 * a transaction of its own (the application's write queue). Outside it the database takes no writes.
 */
export interface LoreWrites {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

/** Entries asked about in one statement: far below SQLite's limit on a statement's parameters. */
const ASK_AT_ONCE = 500;

/** The number of each of a world's entries asked for, by key, as the table holds them now; a key never numbered is left out. */
export function worldNumbersIn(db: Database, user: string, world: string, keys: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < keys.length; i += ASK_AT_ONCE) {
    const part = keys.slice(i, i + ASK_AT_ONCE);
    // Prepared rather than cached: the statement's shape changes with the number of keys asked about.
    const rows = db.prepare<{ key: string; n: number }, string[]>(`SELECT key, n FROM lore_world_number WHERE user = ? AND world = ? AND key IN (${part.map(() => "?").join(", ")})`).all(user, world, ...part);
    for (const row of rows) out.set(row.key, row.n);
  }
  return out;
}

/**
 * Gives each of a world's entries asked for that has no number the next one, in the order asked, and
 * answers every number of those asked for. It writes, so it is called inside a write of the queue.
 */
export function giveWorldNumbers(db: Database, user: string, world: string, keys: readonly string[]): Map<string, number> {
  const wanted = [...new Set(keys)];
  const fresh = wanted.filter((key) => !worldNumbersIn(db, user, world, [key]).has(key));
  if (fresh.length > 0) {
    let last = db.query<{ n: number | null }, [string]>("SELECT max(n) AS n FROM lore_world_number WHERE user = ?").get(user)?.n ?? 0;
    const give = db.query<unknown, [string, number, string, string]>("INSERT OR IGNORE INTO lore_world_number (user, n, world, key) VALUES (?, ?, ?, ?)");
    for (const key of fresh) if (give.run(user, last + 1, world, key).changes > 0) last++;
  }
  return worldNumbersIn(db, user, world, wanted);
}

/** The numbers of each user's lore entries (see the header). */
export class EntryNumbers {
  constructor(
    private readonly db: Database,
    private readonly writes: LoreWrites,
  ) {}

  /**
   * The number of each book entry, by Lumiverse's id. An entry seen for the first time is given the
   * next number, in the order asked, and the number is kept before it is given.
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

  /** The Lumiverse id of the book entry `n` was given to; null for a number never given. */
  entry(user: string, n: number): string | null {
    return this.db.query<{ entry: string }, [string, number]>("SELECT entry FROM lore_entry_number WHERE user = ? AND n = ?").get(user, n)?.entry ?? null;
  }

  /**
   * The number of each of a world's entries, by key. An entry seen for the first time is given the
   * next number, in the order asked, and the number is kept before it is given.
   */
  async ofWorld(user: string, world: string, keys: readonly string[]): Promise<Map<string, number>> {
    const wanted = [...new Set(keys)];
    const known = worldNumbersIn(this.db, user, world, wanted);
    if (wanted.every((key) => known.has(key))) return known;
    await this.writes.run((db) => giveWorldNumbers(db, user, world, wanted), "numbering world lore entries");
    return worldNumbersIn(this.db, user, world, wanted);
  }

  /** The world and the key of the world entry `n` was given to; null for a number never given. */
  worldEntry(user: string, n: number): { world: string; key: string } | null {
    return this.db.query<{ world: string; key: string }, [string, number]>("SELECT world, key FROM lore_world_number WHERE user = ? AND n = ?").get(user, n);
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
