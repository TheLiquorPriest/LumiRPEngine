// What the door has read of Lumiverse's rows, kept for a short while (STANDALONE-PLAN §4.2 "No copy": "short-lived caches keyed by
// row revision"): a chat's messages, a book's entries, a preset. Each thing read is kept under its own key with a stamp that says
// which state of Lumiverse's rows it was read at. The database reader stamps it with what its file says changed (`PRAGMA data_version`
// for a chat, Lumiverse's own signature of a book's entries, a preset's `updated_at` and `cache_revision`), so a thing is read again
// the moment its rows change and never before; over HTTP, where nothing can be asked alone, a thing lives `keepMs` and is dropped
// the moment an event Lumiverse sent says it changed. The text kept is the text of rows Lumiverse itself holds, for seconds: none of it
// is written anywhere.

/** The default of `lumiverse.reads.kept`: how many chats, books and presets have what was read of them held at once. */
export const KEPT = 32;
/** The default of `lumiverse.reads.keepSeconds`: how many milliseconds a read over HTTP is held, where nothing can be asked of whether it changed. */
export const HTTP_KEEP_MS = 15_000;

interface Kept {
  stamp: string;
  at: number;
  /** What was read under this key, by what it was: each is the read itself, so two askers at once read once. */
  parts: Map<string, Promise<unknown>>;
}

export class Memo {
  readonly #kept = new Map<string, Kept>();

  constructor(
    private readonly deps: {
      /** How many keys are kept; the one left alone longest goes first. */
      most(): number;
      now(): number;
    },
  ) {}

  /**
   * One part of what is kept under `key`, read by `fill` unless it is held: held only while its stamp is `stamp` and, where `keepMs`
   * is finite, younger than it. A failed read is not kept.
   */
  get<T>(key: string, stamp: string, keepMs: number, part: string, fill: () => Promise<T>): Promise<T> {
    const now = this.deps.now();
    let held = this.#kept.get(key);
    if (held !== undefined && (held.stamp !== stamp || now - held.at >= keepMs)) held = undefined;
    held ??= { stamp, at: now, parts: new Map() };
    // Last in, so the keys left alone the longest are the ones that go.
    this.#kept.delete(key);
    this.#kept.set(key, held);
    const most = Math.max(1, Math.floor(this.deps.most()));
    for (const oldest of this.#kept.keys()) {
      if (this.#kept.size <= most) break;
      this.#kept.delete(oldest);
    }
    const had = held.parts.get(part);
    if (had !== undefined) return had as Promise<T>;
    const parts = held.parts;
    const read = fill();
    parts.set(part, read);
    read.catch(() => {
      if (parts.get(part) === read) parts.delete(part);
    });
    return read;
  }

  /** Lets go of every key that starts with `prefix`; the next read of each is a read again. */
  drop(prefix: string): void {
    for (const key of [...this.#kept.keys()]) if (key.startsWith(prefix)) this.#kept.delete(key);
  }

  clear(): void {
    this.#kept.clear();
  }
}

/** Where a chat's reads are kept, and a book's, a preset's: the keys, and the prefixes `drop` is given (`chats`, `books`, `presets`: every one of the kind). */
export const KEEP = {
  chat: (id: string): string => `chat\u0000${id}\u0000`,
  book: (id: string): string => `book\u0000${id}\u0000`,
  preset: (id: string): string => `preset\u0000${id}\u0000`,
  chats: "chat\u0000",
  books: "book\u0000",
  presets: "preset\u0000",
} as const;
