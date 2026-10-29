// The lore family's tools (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): the world's lore and the World Info
// books the chat reads, as the agent's knowledge may read them. Search, grep and read read; save and
// draft propose a workspace file (`propose`), and nothing here writes a book, the world's lore or any
// host store: a draft is applied in Build, on the game master's own press.
//
// The corpus is the view's live lore (`ToolReadView.lore`, `liveLore`), each entry as the view gives
// it (`loreEntry`); one the view gives nothing of reads as one that doesn't exist. Live lore reads a
// book entry's text with its marks left out (`publicText`), each mark an entry of its own beside it
// (`bookMarkLores`), so an entry whose live text is its book entry's public text is read from the book
// entry as written instead: its marks then go through `applyMarks` for this view, in place (under the
// player character's knowledge only those it holds, marked; under everyone's and the GM's every one,
// marked). A whole-entry secret's live text is the mark's own text already, and stays so.

import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import type { JsonObject } from "../../../shared/json";
import { loreSourceOf } from "../../../shared/lore";
import { publicText, wholeEntrySecret } from "../../../shared/secret-marks";
import type { LoreEntryDef } from "../../../shared/world";
import { loreSearch } from "../../../engine/lore";
import { bookLoreId } from "../../book-lore";
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

/** The readable entry the call's `id` names, or the note that there is none, a hidden one alike. */
async function namedLore(view: ToolReadView, tool: string, args: JsonObject): Promise<ReadableLore | ToolOutcome> {
  const id = needText(view, tool, args, "id");
  if (typeof id !== "string") return id;
  return (await readableLore(view)).find((r) => r.lore.id === id) ?? view.refuse(WRITE_NOTE.noLore, { id });
}

export const LORE_TOOLS: readonly ToolDefinition[] = [
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
      // Read as the GM over only what the view may read; no snippet is answered, so none costs a token.
      const { hits } = view.read(() => loreSearch({ reg: view.registry, world, state: view.state, tokens: () => 0 }, { query, purpose: "gm", tokenBudget: 0 }));
      const results = hits.flatMap((hit): SearchResult[] => {
        const r = byId.get(hit.id);
        return r ? [{ id: hit.id, title: r.lore.title, why: hit.why, ...(view.knowledge !== "pov" && view.loreSecrecy(r.entry) !== null ? { secret: true as const } : {}) }] : [];
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
      const matches: GrepMatch[] = [];
      for (const { entry, lore } of await readableLore(view)) {
        // The player character's knowledge reads a restricted entry plainly: it carries no marker.
        const secret = view.knowledge !== "pov" && view.loreSecrecy(entry) !== null ? { secret: true as const } : {};
        lore.text.split("\n").forEach((line, i) => {
          if (line.toLowerCase().includes(lower)) matches.push({ id: lore.id, title: lore.title, line: i + 1, text: line, ...secret });
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
      return "lore" in found ? view.answer(found.lore) : found;
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
      const path = textArg(args, "path") ?? `lore/${found.lore.id.replace(NOT_IN_NAME, "_")}.md`;
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
      const id = needText(view, "lore_draft", args, "id");
      if (typeof id !== "string") return id;
      const draft = needText(view, "lore_draft", args, "text");
      if (typeof draft !== "string") return draft;
      const path = textArg(args, "path") ?? `${DRAFTS}${id.replace(NOT_IN_NAME, "_")}.md`;
      if (!path.startsWith(DRAFTS)) return view.refuse(WRITE_NOTE.draftPath, { path });
      // A draft of an entry the view can't read is a draft of a new one: its title tells nothing.
      const title = (await readableLore(view)).find((r) => r.lore.id === id)?.lore.title ?? id;
      return propose(view, env.writer, { kind: "ws_write", path, text: `---\nlore: ${id}\ntitle: ${title}\n---\n${draft}` });
    },
  },
];
