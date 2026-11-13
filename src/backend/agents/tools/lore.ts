// The lore family's tools (AGENT-LOOP-PLAN §6; INC1-SPEC R3b; DESIGN §4.2): the world's lore and the
// World Info books the chat reads, every entry of them, a secret marked as the view marks it. Index, search, grep and
// read read; load puts an entry into the prompt of the reply a turn is writing; save and draft
// propose a workspace file (`propose`). Nothing here writes a book, the world's lore or any host
// store: a draft is applied in Build, on the game master's own press.
//
// On the harness engine a file these tools keep is the harness's workspace's, which the agents'
// own files and each mind's are in too (`tools/harness.ts` writes it there, under the mode of
// workspace notes). So there a saved entry stays under `lore/` and a draft under `lore-drafts/`,
// and a new entry's id is held to the form the engine mints its own ids in. The old engines take
// the paths and ids they always took.
//
// The corpus is the view's live lore (`ToolReadView.lore`, `liveLore`), each entry as the view gives
// it (`loreEntry`); one the view gives nothing of reads as one that doesn't exist. Live lore reads a
// book entry's text with its marks left out (`publicText`), each mark an entry of its own beside it
// (`bookMarkLores`), so an entry whose live text is its book entry's public text is read from the book
// entry as written instead: its marks then go through `applyMarks` for this view, in place, every
// one marked. A whole-entry secret's live text is the mark's own text already, and stays so.
//
// The lore index (`lore_index`, `ToolReadView.loreIndex`) names each World Info entry by its short
// id, and every tool here gives a book entry by it (a mark of it as the id, then `#` and its number);
// each takes it, an entry's `bookId/entryId`, or a lore id as it stands. The user's own index entry
// (Settings → Lore) is given instead of the index, its text as written, its marks as the view reads.

import { LOOP_DEFS } from "../../../shared/agent-settings";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { SURFACE_NOTE } from "../../../shared/harness-texts-surfaces";
import type { JsonObject } from "../../../shared/json";
import { loreSourceOf } from "../../../shared/lore";
import { LORE_INDEX_TEXT } from "../../../shared/lore-routing";
import { publicText, wholeEntrySecret } from "../../../shared/secret-marks";
import type { UserSettings } from "../../../shared/settings";
import { nounFor } from "../../../shared/words";
import type { LoreEntryDef } from "../../../shared/world";
import { loreSearch } from "../../../engine/lore";
import { slug } from "../../../engine/places-in-play";
import { bookLoreId } from "../../book-lore";
import { tokensOf } from "../../book";
import { renderIndex } from "../../lore-routing";
import type { ToolOutcome } from "../runtime";
import { propose } from "./propose";
import type { ToolReadView, ViewLore } from "./read-view";
import type { ToolDefinition, ToolEnv } from "./registry";
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
  /** A line too long for an answer of its own: what was left out of it, and how to read it. */
  cut?: string;
}

/** Where a lore draft goes: never a book, nor the world's lore (see the header). */
const DRAFTS = "lore-drafts/";

/** Where a saved entry goes when the call names no file, and on the harness the only folder one goes to. */
const SAVED = "lore/";

/** Whether the call is a harness chat's: only the harness gives a call its turn or its workspace (see the header). */
const onHarness = (env: ToolEnv): boolean => env.turn !== undefined || (env.files ?? null) !== null;

/** A front matter value that can be written as it is: one line that starts with a letter or a digit and ends in neither a space nor a colon. */
const PLAIN_VALUE = /^[\p{L}\p{N}](?:[^\p{C}\p{Zl}\p{Zp}]*[^\p{C}\p{Z}:])?$/u;

/** What starts a field or a comment inside a plain value: a colon before a space, a `#` after one. */
const FIELD_OR_COMMENT = /: | #/;

/**
 * A file's text with its front matter: each field on one line, then `body`. The one place a front
 * matter is written, so that whatever a value holds stays that field's value: a plain one is
 * written as it is, and any other (a line break, a `---`, a colon that would start a field, a
 * quote, a space at either end) as a JSON string, which a front matter reads as one string too.
 * No value adds a field, and none ends the front matter.
 */
function withFrontMatter(fields: readonly (readonly [string, string])[], body: string): string {
  const lines = fields.map(([key, value]) => {
    if (PLAIN_VALUE.test(value) && !FIELD_OR_COMMENT.test(value)) return `${key}: ${value}`;
    // JSON leaves the line breaks of other scripts as they are: written as their codes, so no editor shows part of a value as a line of its own.
    return `${key}: ${JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

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

// Paging, as LumiAH's own tools page their answers (`lumi-ah` core/tools/paging.ts):
// an answer longer than one tool result may be is given a page at a time, each page ending with
// what it gives and the cursor that reads on; the same call with that cursor gives the next page,
// so a whole entry, index or list is read across pages with nothing left out or given twice. One
// that fits one answer is given as ever, with no cursor.

/** A cursor as these reads write one, as LumiAH's own tools write theirs: one whole number, where the next page starts (a place in a text, or an item of a list). At most 15 digits, which a JavaScript number holds exactly. */
const CURSOR = /^\d{1,15}$/;

/** Where the call's page starts, by its `cursor` (none: the beginning); or the answer that says it isn't one. */
function cursorOf(view: ToolReadView, tool: string, args: JsonObject): number | ToolOutcome {
  const raw = args.cursor;
  if (raw === undefined || raw === null || raw === "") return 0;
  const said = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  return CURSOR.test(said) ? Number(said) : view.refuse(WRITE_NOTE.badCursor, { cursor: (typeof raw === "string" ? raw : JSON.stringify(raw)).slice(0, 64), tool });
}

/**
 * The most one answer of these reads holds, in characters: the engine's own size for one tool
 * result (`agents.clipChars`), which the harness states as their whole (`wholePage`), so a page
 * reaches the agent whole. Only a harness call carries the player's settings (its turn); elsewhere
 * an answer goes whole, and the old engines' runtime clips it at that same setting itself.
 */
function pageOf(env: ToolEnv): number | null {
  return env.turn?.settings.agents.clipChars ?? null;
}

/** What the harness gives whole of each of these reads: one page. */
const wholePage = (settings: UserSettings): number => settings.agents.clipChars;

/** Where a page of `room` characters, as JSON writes them, that starts at `from` ends in `text`: never inside a character, and at least one character on, so a page always moves. */
function pageEnd(text: string, from: number, room: number): number {
  let end = from;
  let used = 0;
  while (end < text.length) {
    const step = (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
    const width = JSON.stringify(text.slice(end, end + step)).length - 2;
    if (used + width > room && end > from) break;
    used += width;
    end += step;
  }
  return end;
}

/** The note that ends a page from `from` (counted from 0) to `to` of `total` `what`, and its longest form for those `total`, which a page's room is measured with. */
function pageNotes(view: ToolReadView, page: number | null, total: number, what: string): { note: (from: number, to: number) => string; longest: string } {
  const note = (from: number, to: number): string => {
    const at = { from: String(from + 1), to: String(to), total: String(total), what };
    return to < total ? view.text(WRITE_NOTE.pageMore, { ...at, chars: String(page ?? total), setting: LOOP_DEFS.clipChars.label, cursor: String(to) }) : view.text(WRITE_NOTE.pageEnd, at);
  };
  // Every figure as long as the longest it can be: the room left for a page is never too much.
  const longest = [note(total - 1, total - 1), note(total - 1, total)].reduce((a, b) => (b.length > a.length ? b : a));
  return { note, longest };
}

/**
 * One page of `text` from `from`, in the answer `frame` makes of a part of it and the note that
 * ends the page. The whole, as ever, where it fits one answer (`page`) and no cursor moved it.
 */
function textPage(view: ToolReadView, tool: string, page: number | null, text: string, from: number, what: string, frame: (part: string, note?: string) => object): ToolOutcome {
  if (from > text.length) return view.refuse(WRITE_NOTE.badCursor, { cursor: String(from), tool });
  if (from === 0 && (page === null || JSON.stringify(frame(text)).length <= page)) return view.answer(frame(text));
  const { note, longest } = pageNotes(view, page, text.length, what);
  const to = page === null ? text.length : pageEnd(text, from, page - JSON.stringify(frame("", longest)).length);
  return view.answer(frame(text.slice(from, to), note(from, to)));
}

/**
 * One page of `items` from `from`, in the answer `frame` makes of some of them and the note that
 * ends the page: as many whole items as fit, and an item too long for a page of its own as `fit`
 * cuts it to the room there is, so the list moves on. The whole, as ever, where it fits one answer
 * (`page`) and no cursor moved it.
 */
function listPage<T>(view: ToolReadView, tool: string, page: number | null, items: readonly T[], from: number, what: string, frame: (shown: T[], note?: string) => object, fit: (item: T, room: number) => T = (item) => item): ToolOutcome {
  if (from > 0 && from >= items.length) return view.refuse(WRITE_NOTE.badCursor, { cursor: String(from), tool });
  if (from === 0 && (page === null || JSON.stringify(frame([...items])).length <= page)) return view.answer(frame([...items]));
  const { note, longest } = pageNotes(view, page, items.length, what);
  const room = page === null ? Number.POSITIVE_INFINITY : page - JSON.stringify(frame([], longest)).length;
  const shown: T[] = [];
  let used = 0;
  let at = from;
  for (; at < items.length; at++) {
    const item = items[at] as T;
    const size = JSON.stringify(item).length + (shown.length > 0 ? 1 : 0);
    if (used + size > room) {
      if (shown.length > 0) break;
      shown.push(fit(item, room));
      at++;
      break;
    }
    shown.push(item);
    used += size;
  }
  return view.answer(frame(shown, note(from, at)));
}

/** A page's note, where the answer has one, as the answer's last part. */
const paged = (note: string | undefined): { page?: string } => (note !== undefined ? { page: note } : {});

/** The entry `ref` names (any id the lore tools take), as the view gives it, with the id the tools name it by; null for none. The condense tool reads a lore source by it. */
export async function loreText(view: ToolReadView, ref: string): Promise<{ id: string; title: string; text: string } | null> {
  const corpus = await readableLore(view);
  const loreId = await loreIdOf(view, (id) => corpus.some((r) => r.entry.id === id), ref);
  const found = corpus.find((r) => r.lore.id === loreId);
  return found ? { id: (await shownIds(view))(found.lore.id), title: found.lore.title, text: found.lore.text } : null;
}

/**
 * The lore index as this view reads it (see the header): the user's own index entry's text when
 * Settings → Lore names one that is there, as written but for its marks (`entryText`); else every
 * entry of the index (under everyone's knowledge a secret's title, and what it holds, each inside its
 * secret mark), framed by the registry's texts. `book` keeps one book's line (by its id or name); one
 * no book read here goes by is answered with its note. Within `tokens` when given: a role's prompt.
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
      const secrecy = view.marked ? view.loreSecrecy(r.entry) : null;
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
    parameters: () => objectSchema({ book: text(), cursor: text() }, []),
    wholeChars: wholePage,
    async run(args, env) {
      const view = await env.reader.view();
      const from = cursorOf(view, "lore_index", args);
      if (typeof from !== "number") return from;
      const book = textArg(args, "book");
      const index = await loreIndexText(view, book !== null ? { book } : {});
      return typeof index === "string" ? textPage(view, "lore_index", pageOf(env), index, from, "characters", (part, note) => ({ index: part, ...paged(note) })) : index;
    },
  },
  {
    name: "lore_search",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ query: text(), cursor: text() }, ["query"]),
    wholeChars: wholePage,
    async run(args, env) {
      const view = await env.reader.view();
      const query = needText(view, "lore_search", args, "query");
      if (typeof query !== "string") return query;
      const from = cursorOf(view, "lore_search", args);
      if (typeof from !== "number") return from;
      const corpus = await readableLore(view);
      const byId = new Map(corpus.map((r) => [r.lore.id, r]));
      const world = { ...view.world, lore: Object.fromEntries(corpus.map((r) => [r.lore.id, r.entry])) };
      const named = await shownIds(view);
      // Read as the GM over only what the view may read; no snippet is answered, so none costs a token.
      const { hits } = view.read(() => loreSearch({ reg: view.registry, world, state: view.state, tokens: () => 0 }, { query, purpose: "gm", tokenBudget: 0 }));
      const results = hits.flatMap((hit): SearchResult[] => {
        const r = byId.get(hit.id);
        return r ? [{ id: named(hit.id), title: r.lore.title, why: hit.why, ...(view.loreSecrecy(r.entry) !== null ? { secret: true as const } : {}) }] : [];
      });
      return listPage(view, "lore_search", pageOf(env), results, from, "results", (shown, note) => ({ results: shown, ...paged(note) }));
    },
  },
  {
    name: "lore_grep",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ text: text(), cursor: text() }, ["text"]),
    wholeChars: wholePage,
    async run(args, env) {
      const view = await env.reader.view();
      const needle = needText(view, "lore_grep", args, "text");
      if (typeof needle !== "string") return needle;
      const from = cursorOf(view, "lore_grep", args);
      if (typeof from !== "number") return from;
      const lower = needle.toLowerCase();
      const named = await shownIds(view);
      const matches: GrepMatch[] = [];
      for (const { entry, lore } of await readableLore(view)) {
        const secret = view.loreSecrecy(entry) !== null ? { secret: true as const } : {};
        lore.text.split("\n").forEach((line, i) => {
          if (line.toLowerCase().includes(lower)) matches.push({ id: named(lore.id), title: lore.title, line: i + 1, text: line, ...secret });
        });
      }
      // A line too long for an answer of its own gives its start, and says what is left out and where it is read whole.
      const fit = (m: GrepMatch, room: number): GrepMatch => {
        const cut = (shown: number): string => view.text(WRITE_NOTE.lineCut, { size: String(m.text.length), shown: String(shown), setting: LOOP_DEFS.clipChars.label, id: m.id });
        const end = pageEnd(m.text, 0, room - JSON.stringify({ ...m, text: "", cut: cut(m.text.length) }).length);
        return { ...m, text: m.text.slice(0, end), cut: cut(end) };
      };
      return listPage(view, "lore_grep", pageOf(env), matches, from, "matches", (shown, note) => ({ matches: shown, ...paged(note) }), fit);
    },
  },
  {
    name: "lore_read",
    family: "lore",
    tier: "read",
    parameters: () => objectSchema({ id: text(), cursor: text() }, ["id"]),
    wholeChars: wholePage,
    async run(args, env) {
      const view = await env.reader.view();
      const found = await namedLore(view, "lore_read", args);
      if (!("lore" in found)) return found;
      const from = cursorOf(view, "lore_read", args);
      if (typeof from !== "number") return from;
      return textPage(view, "lore_read", pageOf(env), found.lore.text, from, "characters", (part, note) => ({ ...found.lore, id: found.id, text: part, ...paged(note) }));
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
      const path = textArg(args, "path") ?? `${SAVED}${found.id.replace(NOT_IN_NAME, "_")}.md`;
      // The harness's workspace holds each mind's files and the agents' own: a saved entry stays in its folder, so this tool writes over nothing of theirs.
      if (onHarness(env) && !path.startsWith(SAVED)) return view.refuse(SURFACE_NOTE.lorePath, { path });
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
      // On the harness a new entry's id is one the engine could have minted, as every id an agent makes there is. An entry the view may not read is answered the same, so the answer tells nothing of one.
      if (!("lore" in found) && onHarness(env) && ref !== slug(ref)) return view.refuse(SURFACE_NOTE.loreId, { id: ref });
      const id = "lore" in found ? found.id : ref;
      const path = textArg(args, "path") ?? `${DRAFTS}${id.replace(NOT_IN_NAME, "_")}.md`;
      if (!path.startsWith(DRAFTS)) return view.refuse(WRITE_NOTE.draftPath, { path });
      const title = "lore" in found ? found.lore.title : id;
      return propose(view, env.writer, { kind: "ws_write", path, text: withFrontMatter([["lore", id], ["title", title]], draft) });
    },
  },
];
