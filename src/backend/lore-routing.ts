// The lore index on the host (DESIGN §4.2, Settings → Lore): the routing table the agents read, made
// from the World Info books LRE reads, live, with no copy and no model call. Each book's entries in
// its own order, each by its short id (`lore-ids.ts`), its title (its comment, else its first key that
// isn't its tag, else its first words) and a line of what it holds where the title doesn't say
// (`holdsOf`). It is made from the lore as `liveLore` reads it, so an edit, an addition or a deletion
// in a book is what the next index holds; the latest one is kept by the hash of what it was made
// from, so it is made again exactly when that changes.
//
// Build → Lore's index entry: on the user's press, the index of a world's books (the entries anyone
// may read) is written as a World Info entry into a book the user picks, marked as LRE's own
// (`builtIndexMark`). From then on each engine run of that world's chats, and each look at it in
// Build or Settings, writes its text again when the index changed, until the user stops it
// (Settings → Lore), which counts at once, in a turn under way too: Settings are read as they stand,
// never as a turn's snapshot holds them. Nothing else of any entry is written: not its keys, not
// where it sits, and no other entry at all.

import type { UserId, WorldId } from "../shared/ids";
import { hashParts } from "../shared/hash";
import { builtIndexMark, builtIndexOf, loreIsSecret, loreSourceOf } from "../shared/lore";
import { entryKey, holdsOf, LORE_INDEX_TEXT, type RoutingBook, type RoutingEntry, type RoutingIndex, tagOf } from "../shared/lore-routing";
import type { LoreIndexView } from "../shared/protocol";
import type { PromptTexts } from "../shared/prompts";
import type { BuiltLoreIndex, LoreBooks, LoreIndexSettings, UserSettings } from "../shared/settings";
import { tagPatternOf } from "../shared/settings";
import { nounFor } from "../shared/words";
import type { LoreEntryDef, WorldDoc } from "../shared/world";
import { bookEntryTitle, booksLore, loreBookIds } from "./book-lore";
import { tokensOf } from "./book";
import type { HostBookEntry, HostPort } from "./host";
import { LoreIds } from "./lore-ids";
import { renderPrompt } from "./prompts";
import type { SettingsStore } from "./settings-store";
import { outsideTurns } from "./turn-frame";
import type { WorldStore } from "./worlds";

/** The label the index entry Build writes goes by in Lumiverse's World Info editor (its comment, which no prompt holds). */
const BUILT_COMMENT = "LumiRPEngine lore index";

/** An index's entries as one view lists them: each one's id, its title as that view names it, and its holds line where it has one. */
export interface IndexLine {
  id: string;
  title: string;
  holds: string | null;
}

/** An entry's title in the index: its comment, else its first key that isn't its tag, else its first words (`bookEntryTitle`). */
function indexTitle(e: HostBookEntry, tag: string | null): string {
  const comment = e.comment.replace(/\s+/g, " ").trim();
  if (comment !== "") return comment;
  const key = e.keys.map((k) => k.trim()).find((k) => k !== "" && k !== tag);
  return key ?? bookEntryTitle(e);
}

/** Whether anyone may read a lore entry: not a secret, public, and not an AI entry still waiting for review. */
function openLore(entry: LoreEntryDef): boolean {
  const source = loreSourceOf(entry.source);
  const visibility: unknown = entry.visibility;
  return !loreIsSecret(entry) && (visibility === undefined || visibility === "public") && !(source.kind === "ai" && source.status === "pending");
}

/**
 * The index as `lead` frames it (`{{books}}`), in `texts`: each book's line, its entries joined by
 * the separator. Within `tokens` when given: entries in order while the index, with the note of how
 * many are left out, fits; the rest are counted in that note.
 */
export function renderIndex(texts: PromptTexts, lead: string, books: readonly { name: string; entries: readonly IndexLine[] }[], tokens?: number): string {
  const sep = renderPrompt(LORE_INDEX_TEXT.separator, texts, {});
  const entry = (line: IndexLine): string => renderPrompt(line.holds !== null ? LORE_INDEX_TEXT.holds : LORE_INDEX_TEXT.entry, texts, { id: line.id, title: line.title, ...(line.holds !== null ? { holds: line.holds } : {}) });
  const lines = (shown: readonly { name: string; entries: readonly string[] }[]): string => shown.filter((b) => b.entries.length > 0).map((b) => renderPrompt(LORE_INDEX_TEXT.book, texts, { book: b.name, entries: b.entries.join(sep) })).join("\n");
  const whole = (shown: readonly { name: string; entries: readonly string[] }[], cut: number): string => {
    const body = [lines(shown), ...(cut > 0 ? [renderPrompt(LORE_INDEX_TEXT.cut, texts, { count: String(cut), what: nounFor(cut, "entry", "entries") })] : [])].filter((t) => t !== "").join("\n");
    return renderPrompt(lead, texts, { books: body === "" ? renderPrompt(LORE_INDEX_TEXT.none, texts, {}) : body });
  };
  const all = books.map((b) => ({ name: b.name, entries: b.entries.map(entry) }));
  const total = all.reduce((n, b) => n + b.entries.length, 0);
  if (tokens === undefined || tokensOf(whole(all, 0)) <= tokens) return whole(all, 0);
  const kept: { name: string; entries: string[] }[] = [];
  let shown = 0;
  for (const b of all) {
    const book = { name: b.name, entries: [] as string[] };
    kept.push(book);
    for (const line of b.entries) {
      book.entries.push(line);
      if (tokensOf(whole(kept, total - shown - 1)) > tokens) {
        book.entries.pop();
        return whole(kept, total - shown);
      }
      shown++;
    }
  }
  return whole(kept, total - shown);
}

export class LoreRouting {
  readonly ids: LoreIds;
  /** Each user's latest index, by the hash of what it was made from. */
  private readonly latest = new Map<UserId, RoutingIndex>();
  /** Each user's syncs of the built entry, one after another. */
  private readonly syncs = new Map<UserId, Promise<unknown>>();

  constructor(
    private readonly host: Pick<HostPort, "books" | "chats" | "storage" | "log">,
    private readonly settings: Pick<SettingsStore, "get" | "set">,
    private readonly worlds: Pick<WorldStore, "working">,
  ) {
    this.ids = new LoreIds(host);
  }

  /**
   * The index of `live` (a world as `liveLore` read it; `entries`, the book entries it was read from):
   * its books in the order they were read, each entry of a book once (a secret mark of an entry is
   * the entry's, not one of its own), the user's own index entry left out. The ids are given first,
   * so a new entry has its id for good once any index lists it.
   */
  async index(userId: UserId, live: WorldDoc, entries: readonly HostBookEntry[], settings: LoreIndexSettings): Promise<RoutingIndex> {
    const raw = new Map(entries.map((e) => [entryKey(e.bookId, e.id), e]));
    const own = settings.own;
    const listed = Object.values(live.lore).flatMap((lore) => {
      const source = loreSourceOf(lore.source);
      if (source.kind !== "book" || lore.id.includes("#")) return [];
      const key = entryKey(source.bookId, source.entryId);
      const e = raw.get(key);
      return e && !(own && own.bookId === source.bookId && own.entryId === source.entryId) ? [{ lore, e, key }] : [];
    });
    const ids = await this.ids.assign(userId, listed.map(({ e }) => ({ bookId: e.bookId, entryId: e.id, keys: e.keys })), settings);
    const names = new Map((await this.host.books.list(userId).catch(() => [])).map((b) => [b.id, b.name]));
    const pattern = tagPatternOf(settings.tagPattern);
    const made = listed.map(({ lore, e, key }) => ({ book: e.bookId, id: ids.get(key) ?? key, lore: lore.id, entryId: e.id, title: indexTitle(e, tagOf(e.keys, pattern)), text: typeof lore.content === "string" ? lore.content : "", open: openLore(lore), secret: loreIsSecret(lore) }));
    const hash = hashParts("lre-lore-routing-v1", settings.holdsChars, JSON.stringify([...new Set(made.map((m) => m.book))].map((b) => [b, names.get(b) ?? b])), JSON.stringify(made));
    const kept = this.latest.get(userId);
    if (kept?.hash === hash) return kept;
    const books = new Map<string, RoutingBook>();
    for (const m of made) {
      const book = books.get(m.book) ?? { bookId: m.book, name: names.get(m.book) ?? m.book, entries: [] };
      books.set(m.book, book);
      // A secret's own words are its readers' to read whole: its line says no more than its title.
      const entry: RoutingEntry = { id: m.id, lore: m.lore, entryId: m.entryId, title: m.title, holds: m.secret ? null : holdsOf(m.title, m.text, settings.holdsChars), open: m.open };
      book.entries.push(entry);
    }
    const index: RoutingIndex = { hash, books: [...books.values()] };
    this.latest.set(userId, index);
    return index;
  }

  /** The books Build's index entry lists for `world`: those Settings → Lore picks, or, on Auto, those every chat of the world reads (its Lore books, the global ones, those its old copies came from). */
  private async builtBooks(world: WorldDoc, userId: UserId, picked: LoreBooks): Promise<string[]> {
    if (picked === "auto") return (await loreBookIds(this.host, world, null, userId, "auto")).read;
    const engine = new Map((await this.host.books.list(userId)).map((b) => [b.id, b.engine]));
    return picked.filter((id) => engine.get(id) === false);
  }

  /** The index Build's entry holds for `worldId` (its draft, as Build shows it): the entries anyone may read, worded in `texts`. */
  async builtText(userId: UserId, worldId: WorldId, settings: UserSettings): Promise<{ text: string; index: RoutingIndex }> {
    const world = await this.worlds.working(worldId, userId);
    const read = await booksLore(this.host, world, { read: await this.builtBooks(world, userId, settings.loreBooks), gone: [] }, userId);
    const index = await this.index(userId, read.world, read.entries, settings.loreIndex);
    const books = index.books.map((b) => ({ name: b.name, entries: b.entries.filter((e) => e.open).map((e) => ({ id: e.id, title: e.title, holds: e.holds })) }));
    return { text: renderIndex(settings.prompts.texts, LORE_INDEX_TEXT.built, books), index };
  }

  /**
   * Build → Lore's Build an index entry, on the user's press: the index of `worldId`'s books written
   * as a new entry of `bookId`, marked as LRE's, switched on as a constant entry whose text never
   * triggers another (Prevent further recursion), where Lumiverse puts a new entry (its own defaults;
   * the World Info editor moves it). One entry is kept at a time: Settings → Lore's Stop lets the one
   * before go first, and one that is gone is let go here.
   */
  async build(userId: UserId, worldId: WorldId, bookId: string): Promise<BuiltLoreIndex> {
    await this.sync(userId);
    const settings = await this.settings.get(userId);
    if (settings.loreIndex.built) throw new LoreIndexError("an index entry is kept already: stop it in Settings → Lore first");
    const book = (await this.host.books.list(userId)).find((b) => b.id === bookId);
    if (!book || book.engine) throw new LoreIndexError("pick one of your World Info books");
    const { text } = await this.builtText(userId, worldId, settings);
    const entryId = await this.host.books.createEntry(bookId, { comment: BUILT_COMMENT, content: text, keys: [], disabled: false, constant: true, preventRecursion: true, extensions: builtIndexMark(worldId) }, userId);
    const built: BuiltLoreIndex = { bookId, entryId, worldId };
    await this.settings.set(userId, { loreIndex: { built: { ...built } } });
    return built;
  }

  /**
   * Writes the built entry's text again when the index of its world's books changed (see the
   * header); with `worldId`, only when the entry is that world's. The entry is the user's, not a
   * turn's: every read of Settings here is of Settings as they stand (`outsideTurns`), never a
   * turn's snapshot of them, and its text is written, or the entry let go, only while they still name
   * it, so a Stop, or another entry built, while a turn runs counts at once. An entry that is gone, or
   * no longer carries LRE's mark, is let go: Settings no longer names it, and the log says why. Never
   * throws: a sync that fails is logged and tried again the next time.
   */
  sync(userId: UserId, worldId?: WorldId): Promise<void> {
    const run = (this.syncs.get(userId) ?? Promise.resolve()).then(() =>
      outsideTurns(async () => {
        try {
          const settings = await this.settings.get(userId);
          const built = settings.loreIndex.built;
          if (!built || (worldId !== undefined && built.worldId !== worldId)) return;
          const e = await this.host.books.entry(built.entryId, userId);
          if (!e || e.bookId !== built.bookId || builtIndexOf(e.extensions) !== built.worldId) {
            if (!(await this.keeps(userId, built))) return;
            await this.settings.set(userId, { loreIndex: { built: null } });
            this.host.log("warn", `[LumiRPEngine] the lore index entry Build wrote (${built.bookId}/${built.entryId}) is gone or no longer LumiRPEngine's, so it is no longer kept in sync (Build → Lore builds another)`, userId);
            return;
          }
          const { text } = await this.builtText(userId, built.worldId, settings);
          if (text !== e.content && (await this.keeps(userId, built))) await this.host.books.update(e.id, { content: text }, userId);
        } catch (error) {
          this.host.log("warn", `[LumiRPEngine] the lore index entry wasn't brought up to date: ${error instanceof Error ? error.message : String(error)}`, userId);
        }
      }),
    );
    this.syncs.set(userId, run);
    return run;
  }

  /** Whether Settings as they stand still name `built` as the index entry kept in sync: not once it is stopped, nor once another is built. */
  private async keeps(userId: UserId, built: BuiltLoreIndex): Promise<boolean> {
    const now = (await outsideTurns(() => this.settings.get(userId))).loreIndex.built;
    return now?.bookId === built.bookId && now.entryId === built.entryId && now.worldId === built.worldId;
  }

  /** What Build → Lore and Settings → Lore show of the index of `worldId`'s books (the built entry brought up to date first when it is that world's): each book's name and how many entries it lists, the text Build's entry holds, and the entry kept, if any. */
  async view(userId: UserId, worldId: WorldId): Promise<LoreIndexView> {
    await this.sync(userId, worldId);
    const settings = await this.settings.get(userId);
    const { text, index } = await this.builtText(userId, worldId, settings);
    const built = settings.loreIndex.built;
    const names = built ? new Map((await this.host.books.list(userId).catch(() => [])).map((b) => [b.id, b.name])) : new Map<string, string>();
    return {
      text,
      books: index.books.map((b) => ({ id: b.bookId, name: b.name, entries: b.entries.filter((e) => e.open).length })),
      built: built ? { ...built, book: names.get(built.bookId) ?? built.bookId } : null,
    };
  }
}

/** Why Build's index entry can't be written as asked, in words for the user. */
export class LoreIndexError extends Error {}
