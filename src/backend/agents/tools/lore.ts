// The lore family's tools (AGENT-LOOP-PLAN §6; INC1-SPEC R3b; DESIGN §4.2): the world's lore and the
// World Info books the chat reads, as the agent's knowledge may read them. Index, search, grep and
// read read; load puts an entry into the prompt of the reply a turn is writing; save and draft
// propose a workspace file (`propose`). Nothing here writes a book, the world's lore or any host
// store: a draft is applied in Build, on the game master's own press.
//
// The corpus is the view's live lore (`ToolReadView.lore`, `liveLore`), each entry as the view gives
// it (`loreEntry`); one the view gives nothing of reads as one that doesn't exist. Live lore reads a
// book entry's text with its marks left out (`publicText`), each mark an entry of its own beside it
// (`bookMarkLores`), so an entry whose live text is its book entry's public text is read from the book
// entry as written instead: its marks then go through `applyMarks` for this view, in place (under the
// player character's knowledge only those it holds, marked; under everyone's and the GM's every one,
// marked). A whole-entry secret's live text is the mark's own text already, and stays so.
//
// The lore index (`lore_index`, `ToolReadView.loreIndex`) names each World Info entry by its short
// id, and every tool here gives a book entry by it (a mark of it as the id, then `#` and its number);
// each takes it, an entry's `bookId/entryId`, or a lore id as it stands. The user's own index entry
// (Settings → Lore) is given instead of the index, its text as written, its marks as the view reads.

import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import type { JsonObject } from "../../../shared/json";
import { loreSourceOf } from "../../../shared/lore";
import { LORE_INDEX_TEXT } from "../../../shared/lore-routing";
import { publicText, wholeEntrySecret } from "../../../shared/secret-marks";
import { nounFor } from "../../../shared/words";
import type { LoreEntryDef } from "../../../shared/world";
import { loreSearch } from "../../../engine/lore";
import { bookLoreId } from "../../book-lore";
import { tokensOf } from "../../book";
import { renderIndex } from "../../lore-routing";
import type { ToolOutcome } from "../runtime";
import { propose } from "./propose";
import type { ToolReadView, ViewLore } from "./read-view";
import type { ToolDefinition } from "./registry";
import { needText, objectSchema, text, textArg } from "./schema";

/** A lore entry the view may read: the entry as the search reads it (its text the viewed one), and as the view gives it. */
interface ReadableLore {
  entry: LoreEntryDef;
  lore: ViewLore;
}

interface SearchResult {
  id: string;
  title: string;
  why: string[];
  secret?: true;
}

interface GrepMatch {
  id: string;
  title: string;
  line: number;
  text: string;
  secret?: true;
}

/** Where a lore draft goes: never a book, nor the world's lore (see the header). */
const DRAFTS = "lore-drafts/";

/** What a workspace path's name can't hold: an entry id names its file with each such character as `_`. */
const NOT_IN_NAME = /[^\p{L}\p{N}._-]/gu;

/** A World Info entry named as `bookId/entryId`, which nothing else of a lore id looks like. */
const ENTRY_REF = /^[^/:#\s]+\/[^/:#\s]+$/;

/** Every lore entry the view may read, in the live lore's order (see the header). */
async function readableLore(view: ToolReadView): Promise<ReadableLore[]> {
  const entries = Object.values((await view.lore()).lore);
  // The books are read only when some entry comes from one.
  const books = new Map(entries.some((e) => loreSourceOf(e.source).kind === "book") ? (await view.bookEntries()).map((e) => [bookLoreId(e.bookId, e.id), e] as const) : []);
  return view.read(() =>
    entries.flatMap((entry): ReadableLore[] => {
      const source = loreSourceOf(entry.source);
      const book = source.kind === "book" ? books.get(bookLoreId(source.bookId, source.entryId)) : undefined;
      const written = book && !wholeEntrySecret(book.content) && entry.content === publicText(book.content) ? { ...entry, content: book.content } : entry;
      const lore = view.loreEntry(written);
      return lore ? [{ entry: { ...entry, content: lore.text }, lore }] : [];
    }),
  );
}

/** How the tools name each entry (see the header): a book entry by its short id, a mark of it by that and its number; any other by its own id. */
async function shownIds(view: ToolReadView): Promise<(loreId: string) => string> {
  const index = await view.loreIndex();
  const short = new Map((index?.books ?? []).flatMap((b) => b.entries.map((e) => [e.lore, e.id] as const)));
  return (loreId) => {
    const hash = loreId.indexOf("#");
    const base = hash < 0 ? loreId : loreId.slice(0, hash);
    const id = short.get(base);
    return id === undefined ? loreId : `${id}${hash < 0 ? "" : loreId.slice(hash)}`;
  };
}

/**
 * The lore id `ref` names: a lore id `has` holds as it stands; else a short id (a mark's number
 * after it), the index's first, which gives every entry read its id, then one given before; else a
 * World Info entry as `bookId/entryId`. The lore tools and the scene's answer read ids by it.
 */
export async function loreIdOf(view: ToolReadView, has: (loreId: string) => boolean, ref: string): Promise<string> {
  if (has(ref)) return ref;
  const hash = ref.indexOf("#");
  const base = hash < 0 ? ref : ref.slice(0, hash);
  const mark = hash < 0 ? "" : ref.slice(hash);
  const listed = (await view.loreIndex())?.books.flatMap((b) => b.entries).find((e) => e.id === base);
  if (listed) return `${listed.lore}${mark}`;
  const key = (await view.routing?.entryOf(base)) ?? (ENTRY_REF.test(base) ? base : null);
  return key === null ? ref : `book:${key}${mark}`;
}

/** The readable entry the call's `id` names, with how the tools name it; or the note that there is none, a hidden one alike. */
async function namedLore(view: ToolReadView, tool: string, args: JsonObject): Promise<(ReadableLore & { id: string }) | ToolOutcome> {
  const ref = needText(view, tool, args, "id");
  if (typeof ref !== "string") return ref;
  const corpus = await readableLore(view);
  const loreId = await loreIdOf(view, (id) => corpus.some((r) => r.entry.id === id), ref);
  const found = corpus.find((r) => r.lore.id === loreId);
  return found ? { ...found, id: (await shownIds(view))(found.lore.id) } : view.refuse(WRITE_NOTE.noLore, { id: ref });
}

/**
 * The lore index as this view reads it (see the header): the user's own index entry's text when
 * Settings → Lore names one that is there, as written but for its marks (`entryText`); else every
 * entry of the index the view may read (under everyone's knowledge a secret's title, and what it
 * holds, each inside its secret mark), framed by the registry's texts. `book` keeps one book's line
 * (by its id or name); one no book read here goes by is answered with its note. Within `tokens` when
 * given: a role's prompt.
 */
export async function loreIndexText(view: ToolReadView, opts: { book?: string; tokens?: number } = {}): Promise<string | ToolOutcome> {
  const own = await view.routing?.own();
  if (own) {
    const written = view.entryText(own.content);
    const tokens = opts.tokens;
    if (tokens === undefined || tokensOf(written) <= tokens) return written;
    // Cut to whole lines, the note of how many are left out after them.
    const lines = written.split("\n");
    const cut = (kept: number): string => [...lines.slice(0, kept), view.text(LORE_INDEX_TEXT.cut, { count: String(lines.length - kept), what: nounFor(lines.length - kept, "line", "lines") })].join("\n");
    let kept = lines.length - 1;
    while (kept > 0 && tokensOf(cut(kept)) > tokens) kept--;
    return cut(kept);
  }
  const index = await view.loreIndex();
  const corpus = new Map((await readableLore(view)).map((r) => [r.entry.id, r]));
  let books = index?.books ?? [];
  const wanted = opts.book?.trim();
  if (wanted !== undefined && wanted !== "") {
    books = books.filter((b) => b.bookId === wanted || b.name.trim().toLowerCase() === wanted.toLowerCase());
    if (books.length === 0) return view.refuse(WRITE_NOTE.noBook, { book: wanted });
  }
  const shown = books.map((b) => ({
    name: b.name,
    entries: b.entries.flatMap((e) => {
      const r = corpus.get(e.lore);
      if (!r) return [];
      const secrecy = view.knowledge === "everyone" ? view.loreSecrecy(r.entry) : null;
      return [{ id: e.id, title: view.mark(e.title, secrecy), holds: e.holds === null ? null : view.mark(e.holds, secrecy) }];
    }),
  }));
  return renderIndex(view.texts, LORE_INDEX_TEXT.lead, shown, opts.tokens);
}

export const LORE_TOOLS: readonly ToolDefinition[] = [
  {
    name: "lore_index",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ book: text() }, []),
    async run(args, env) {
      const view = await env.reader.view();
      const book = textArg(args, "book");
      const index = await loreIndexText(view, book !== null ? { book } : {});
      return typeof index === "string" ? view.answer({ index }) : index;
    },
  },
  {
    name: "lore_search",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ query: text() }, ["query"]),
    async run(args, env) {
      const view = await env.reader.view();
      const query = needText(view, "lore_search", args, "query");
      if (typeof query !== "string") return query;
      const corpus = await readableLore(view);
      const byId = new Map(corpus.map((r) => [r.lore.id, r]));
      const world = { ...view.world, lore: Object.fromEntries(corpus.map((r) => [r.lore.id, r.entry])) };
      const named = await shownIds(view);
      // Read as the GM over only what the view may read; no snippet is answered, so none costs a token.
      const { hits } = view.read(() => loreSearch({ reg: view.registry, world, state: view.state, tokens: () => 0 }, { query, purpose: "gm", tokenBudget: 0 }));
      const results = hits.flatMap((hit): SearchResult[] => {
        const r = byId.get(hit.id);
        return r ? [{ id: named(hit.id), title: r.lore.title, why: hit.why, ...(view.knowledge !== "pov" && view.loreSecrecy(r.entry) !== null ? { secret: true as const } : {}) }] : [];
      });
      return view.answer({ results });
    },
  },
  {
    name: "lore_grep",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ text: text() }, ["text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const needle = needText(view, "lore_grep", args, "text");
      if (typeof needle !== "string") return needle;
      const lower = needle.toLowerCase();
      const named = await shownIds(view);
      const matches: GrepMatch[] = [];
      for (const { entry, lore } of await readableLore(view)) {
        // The player character's knowledge reads a restricted entry plainly: it carries no marker.
        const secret = view.knowledge !== "pov" && view.loreSecrecy(entry) !== null ? { secret: true as const } : {};
        lore.text.split("\n").forEach((line, i) => {
          if (line.toLowerCase().includes(lower)) matches.push({ id: named(lore.id), title: lore.title, line: i + 1, text: line, ...secret });
        });
      }
      return view.answer({ matches });
    },
  },
  {
    name: "lore_read",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ id: text() }, ["id"]),
    async run(args, env) {
      const view = await env.reader.view();
      const found = await namedLore(view, "lore_read", args);
      return "lore" in found ? view.answer({ ...found.lore, id: found.id }) : found;
    },
  },
  {
    name: "lore_load",
    family: "lore",
    tier: "read",
    turn: true,
    parameters: () => objectSchema({ id: text() }, ["id"]),
    async run(args, env) {
      const view = await env.reader.view();
      const found = await namedLore(view, "lore_load", args);
      if (!("lore" in found)) return found;
      // Recorded with the turn's scene lore by its lore id, which delivery reads as the narrator may (DESIGN §4.6).
      if (!env.loads?.add(found.entry.id)) return view.refuse(WRITE_NOTE.loreLate, { id: found.id });
      return view.answer({ loaded: { id: found.id, title: found.lore.title } });
    },
  },
  {
    name: "lore_save",
    family: "lore",
    tier: "gm",
    parameters: () => objectSchema({ id: text(), path: text() }, ["id"]),
    async run(args, env) {
      const view = await env.reader.view();
      const found = await namedLore(view, "lore_save", args);
      if (!("lore" in found)) return found;
      const path = textArg(args, "path") ?? `lore/${found.id.replace(NOT_IN_NAME, "_")}.md`;
      return propose(view, env.writer, { kind: "ws_write", path, text: found.lore.text });
    },
  },
  {
    name: "lore_draft",
    family: "lore",
    tier: "gm",
    parameters: () => objectSchema({ id: text(), text: text(), path: text() }, ["id", "text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const ref = needText(view, "lore_draft", args, "id");
      if (typeof ref !== "string") return ref;
      const draft = needText(view, "lore_draft", args, "text");
      if (typeof draft !== "string") return draft;
      // A draft of an entry the view can't read is a draft of a new one: it goes by the id given, and its title tells nothing.
      const found = await namedLore(view, "lore_draft", args);
      const id = "lore" in found ? found.id : ref;
      const path = textArg(args, "path") ?? `${DRAFTS}${id.replace(NOT_IN_NAME, "_")}.md`;
      if (!path.startsWith(DRAFTS)) return view.refuse(WRITE_NOTE.draftPath, { path });
      const title = "lore" in found ? found.lore.title : id;
      return propose(view, env.writer, { kind: "ws_write", path, text: `---\nlore: ${id}\ntitle: ${title}\n---\n${draft}` });
    },
  },
];
