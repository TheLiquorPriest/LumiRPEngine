// The projection book (plan §9.5): built, and off unless the user turns it on. A book RPE owns, made
// for one chat and attached to that chat alone, holding what the chat's story has changed of its lore
// (the overlays on its path) under the entries' own keys, so that Lumiverse's own activation carries
// story-made canon into its prompt, with or without RPE. It is rewritten from RPE's database when the
// turn lane asks: at a scene's end and whenever the chat's path changes (a swipe, a delete, a branch),
// never on a reply's path. RPE's turn tree is its version history, so it always matches the path; a
// branch is a chat of its own and gets a book of its own. It never touches the user's own books.
//
// With the setting off nothing of it runs, and a book made while it was on is taken away.

import type { Database } from "bun:sqlite";
import type { Fields, LinesPart } from "../app/guidance";
import { hashJson } from "../shared/hash";
import type { LoreWrites } from "./ids";
import type { Lore, LoreAt } from "./lore";
import { overlayNotes } from "./overlays";
import type { LoreEntryFields } from "./proposals";
import type { LorePath } from "./sources";
import { loreLine } from "./tools";

/** The adapter's writes of a projection book, as the signed-in user (plan §4.2: the book, and its attachment to the chat by one key in the chat's metadata). */
export interface ProjectionBooks {
  /** Makes a book of the user's and attaches it to this one chat; its id. */
  create(user: string, chat: string, name: string): Promise<string>;
  /** Sets the book's entries to exactly these, in this order. */
  replace(user: string, book: string, entries: readonly LoreEntryFields[]): Promise<void>;
  /** Detaches the book from its chat and deletes it. */
  remove(user: string, book: string): Promise<void>;
}

/** Something the story made, as the book holds it: the names it goes by, which its entry answers to, and the facts its line words. */
export interface MadeThing {
  kind: "person" | "place" | "canon";
  title: string;
  keys: string[];
  facts: Fields;
}

export interface LoreProjectionDeps {
  db: Database;
  writes: LoreWrites;
  lore: Lore;
  /** The chat's path, whose overlays the book holds. */
  path: LorePath;
  books: ProjectionBooks;
  /** The user's setting for the chat; off unless the user turns it on. */
  enabled(user: string, chat: string): Promise<boolean>;
  /** The answers' lines in force for the chat: the book's name and each entry's words. */
  lines(at: LoreAt): Promise<LinesPart | undefined>;
  /** What the story made at the chat's head, which the book holds beside the notes (`madeOf`); absent, only the notes. */
  made?(user: string, chat: string): Promise<readonly MadeThing[]>;
  now?: () => number;
}

/** What a refresh did: nothing, the setting being off (taking away a book made while it was on); or the chat's book, written or already as the path has it. */
export type ProjectionOutcome = { off: true; removed: string | null } | { book: string; written: boolean };

export class LoreProjection {
  /** Each chat's refresh runs after the one before it, so a chat never gets two books. */
  readonly #running = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: LoreProjectionDeps) {}

  /** Brings the chat's book in line with its path and the setting. */
  refresh(user: string, chat: string): Promise<ProjectionOutcome> {
    const key = `${user}\u0000${chat}`;
    const next = (this.#running.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => this.#refresh(user, chat));
    this.#running.set(key, next);
    return next.finally(() => {
      if (this.#running.get(key) === next) this.#running.delete(key);
    });
  }

  /** The chat's book, where one has been made. */
  book(user: string, chat: string): string | null {
    return this.#held(user, chat)?.book ?? null;
  }

  /** Whether the chat's setting has the projection book on. */
  on(user: string, chat: string): Promise<boolean> {
    return this.deps.enabled(user, chat);
  }

  async #refresh(user: string, chat: string): Promise<ProjectionOutcome> {
    const { writes, books } = this.deps;
    const held = this.#held(user, chat);
    if (!(await this.deps.enabled(user, chat))) {
      if (held === null) return { off: true, removed: null };
      await books.remove(user, held.book);
      await writes.run((d) => d.run("DELETE FROM lore_projection WHERE user = ? AND chat = ?", [user, chat]), "taking away a projection book");
      return { off: true, removed: held.book };
    }
    const notes = overlayNotes(this.deps.path.overlays(user, chat), null);
    const lines = await this.deps.lines({ user, chat });
    const read = await this.deps.lore.read({ user, chat }, [...notes.keys()]);
    const noted = read.flatMap((e): LoreEntryFields[] => {
      const content = loreLine(lines, "projection_entry", { id: e.id, title: e.title, notes: notes.get(e.id) ?? [] });
      return content === undefined ? [] : [{ comment: e.title, content, keys: [...e.keys] }];
    });
    // What the story made, each worded by the line of its kind (`projection_person`, `projection_place`, `projection_canon`) under the names it goes by.
    const made = ((await this.deps.made?.(user, chat)) ?? []).flatMap((m): LoreEntryFields[] => {
      const content = loreLine(lines, `projection_${m.kind}`, m.facts);
      return content === undefined ? [] : [{ comment: m.title, content, keys: m.keys }];
    });
    const entries = [...noted, ...made];
    const signature = hashJson(entries);
    if (held !== null && held.signature === signature) return { book: held.book, written: false };
    const book = held?.book ?? (await books.create(user, chat, loreLine(lines, "projection_book", { chat }) ?? chat));
    await books.replace(user, book, entries);
    const at = (this.deps.now ?? Date.now)();
    await writes.run(
      (d) =>
        d.run("INSERT INTO lore_projection (user, chat, book, signature, written) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, chat) DO UPDATE SET book = excluded.book, signature = excluded.signature, written = excluded.written", [
          user,
          chat,
          book,
          signature,
          at,
        ]),
      "keeping a projection book's state",
    );
    return { book, written: true };
  }

  #held(user: string, chat: string): { book: string; signature: string | null } | null {
    return this.deps.db.query<{ book: string; signature: string | null }, [string, string]>("SELECT book, signature FROM lore_projection WHERE user = ? AND chat = ?").get(user, chat);
  }
}
