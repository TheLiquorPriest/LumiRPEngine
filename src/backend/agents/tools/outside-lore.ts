// The lore tools LumiRPEngine serves outside clients (DESIGN §4.2, §23, §24.5; INC3-SPEC D4): the
// user's World Info books and their entries a pin may name, the pins of a world as they read now, the
// lore index of a world's books, Save to lore from a chat, and Build's own edit of a World Info
// entry's LRE fields. Each sends the requests Build sends, as the caller's session, answered in
// process (`OutsideContext`): an MCP server ran these in the client until they moved here, and they
// answer as they did. A world's own lore entries and pins are its document's (`/lore`, `/lorePins`),
// written with lre_edit like the rest of it; World Info is read as lore live, never copied.

import type { JsonObject } from "../../../shared/json";
import type { BookFieldsEdit } from "../../../shared/lore";
import type { Args } from "../../../shared/tool-args";
import { boolArg, intArg, neededText, textArg, ToolError } from "../../../shared/tool-args";
import { readAt } from "../../../shared/tool-read";
import type { ToolResult } from "../../../shared/tool-answer";
import { json } from "../../../shared/tool-answer";
import { objectSchema as object } from "./schema";
import type { OutsideContext, OutsideToolDef } from "./outside-tool";

const OFFSET: JsonObject = { type: "integer", minimum: 0, description: "Read the answer's JSON text from this character instead of outlining it; each page says where the next begins." };

/** A read that may be large, as one answer: whole, outlined, or a page from `offset`. */
function answer(value: unknown, what: string, args: Args): ToolResult {
  const read = readAt(value, { what, offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

async function pinsRead(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const worldId = textArg(args, "worldId");
  const chatId = textArg(args, "chatId");
  if ((worldId === undefined) === (chatId === undefined)) throw new ToolError("Give worldId (the pins of a world's draft, as Build shows them) or chatId (the pins of the revision a chat plays), one of them.");
  // A chat's pins are the GM view's: a pin's entry can be a secret one, or one about someone the player hasn't met.
  if (chatId !== undefined && !boolArg(args, "spoilers")) throw new ToolError("A chat's pins are GM-level (an entry can be secret, or about someone the player hasn't met): pass spoilers: true to read them. A world's pins (worldId) are its author's.");
  const body = await ctx.request("lre.lore", worldId !== undefined ? { op: "pins", worldId } : { op: "pins", chatId: chatId ?? "" });
  return answer(body.pins ?? { characters: {}, places: {}, steps: {} }, worldId !== undefined ? `the lore pins of the draft of ${worldId}` : `the lore pins of chat ${chatId ?? ""}`, args);
}

async function saveTool(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = neededText(args, "chatId", "the chat's id (lre_chats lists them)");
  const text = textArg(args, "text");
  const saved = await ctx.request("lre.lore", text === undefined ? { op: "save", chatId } : { op: "save", chatId, text });
  if (saved.worldId === undefined || saved.id === undefined) throw new ToolError("LumiRPEngine saved the entry but didn't say where; lre_draft of the chat's world shows it.");
  const draft = await ctx.request("lre.editor", { op: "get", worldId: saved.worldId, base: null });
  return { text: json({ worldId: saved.worldId, id: saved.id, version: draft.version, entry: draft.draft.lore[saved.id] ?? null, next: "It is in the world's draft (Build's too): change it with lre_edit at /lore/<id>, then lre_commit." }) };
}

export const OUTSIDE_LORE_TOOLS: readonly OutsideToolDef[] = [
  {
    name: "lre_lore_books",
    inputSchema: object({ chatId: { type: "string", description: "Mark and list first the books attached to this chat." } }),
    write: false,
    run: async (args, ctx) => {
      const chatId = textArg(args, "chatId");
      return { text: json({ books: (await ctx.request("lre.lore", chatId === undefined ? { op: "books" } : { op: "books", chatId })).books ?? [] }) };
    },
    cli: { command: "lore-books", section: "Lore", usage: "lore-books [<chatId>]", summary: "Your World Info books a pin may name", positionals: ["chatId"] },
  },
  {
    name: "lre_lore_entries",
    inputSchema: object({ bookId: { type: "string", description: "The book's id." }, offset: OFFSET }, ["bookId"]),
    write: false,
    run: async (args, ctx) => {
      const bookId = neededText(args, "bookId", "the book's id (lre_lore_books lists them)");
      return answer({ bookId, entries: (await ctx.request("lre.lore", { op: "entries", bookId })).entries ?? [] }, `the entries of book ${bookId}`, args);
    },
    cli: { command: "lore-entries", section: "Lore", usage: "lore-entries <bookId> [--offset <n>]", summary: "One book's entries, for a pin", positionals: ["bookId"], needs: 1, options: { "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_lore_index",
    inputSchema: object({ worldId: { type: "string", description: "The world (lre_worlds lists them)." } }, ["worldId"]),
    write: false,
    run: async (args, ctx) => {
      const worldId = neededText(args, "worldId", "the world's id (lre_worlds lists them)");
      return { text: json({ worldId, index: (await ctx.request("lre.lore", { op: "index", worldId })).index ?? null }) };
    },
    cli: { command: "lore-index", section: "Lore", usage: "lore-index <worldId>", summary: "A world's lore index, as Build shows it", positionals: ["worldId"], needs: 1 },
  },
  {
    name: "lre_lore_pins",
    inputSchema: object({ worldId: { type: "string", description: "The world whose draft's pins to read." }, chatId: { type: "string", description: "Or the chat whose revision's pins to read." }, spoilers: { type: "boolean", description: "Needed with chatId: a chat's pins are GM-level." }, offset: OFFSET }),
    write: false,
    run: pinsRead,
    cli: { command: "lore-pins", section: "Lore", usage: "lore-pins (--world <id> | --chat <id> --spoilers) [--offset <n>]", summary: "A world's or a chat's lore pins, read now", options: { "--world": { arg: "worldId", as: "text" }, "--chat": { arg: "chatId", as: "text" }, "--spoilers": { arg: "spoilers", as: "flag" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_lore_save",
    inputSchema: object({ chatId: { type: "string", description: "The chat's id (lre_chats lists them)." }, text: { type: "string", description: "An excerpt of one of the chat's messages to save instead of the latest reply." } }, ["chatId"]),
    write: { destructive: false, idempotent: false },
    run: saveTool,
    cli: { command: "lore-save", section: "Lore", usage: "lore-save <chatId> [--text <excerpt>]", summary: "The latest reply (or an excerpt) becomes lore", positionals: ["chatId"], needs: 1, options: { "--text": { arg: "text", as: "text" } } },
  },
  {
    name: "lre_lore_fields",
    inputSchema: object({ bookId: { type: "string", description: "The entry's book (lre_lore_books lists them)." }, entryId: { type: "string", description: "The entry (lre_lore_entries lists them)." }, fields: { type: ["object", "null"], description: "The fields, or null to take them off." } }, ["bookId", "entryId", "fields"]),
    write: { destructive: false, idempotent: true },
    run: async (args, ctx) => {
      const bookId = neededText(args, "bookId", "the book's id (lre_lore_books lists them)");
      const entryId = neededText(args, "entryId", "the entry's id (lre_lore_entries lists them)");
      const fields = args.fields;
      if (fields !== null && (typeof fields !== "object" || Array.isArray(fields))) throw new ToolError("Give fields as an object, or null to take them off.");
      const body = await ctx.request("lre.lore", { op: "fields", bookId, entryId, fields: fields as BookFieldsEdit | null });
      return { text: json({ bookId, entries: body.entries ?? [] }) };
    },
    cli: { command: "lore-fields", section: "Lore", usage: "lore-fields <bookId> <entryId> --fields <json|null>", summary: "Set LumiRPEngine's fields on a World Info entry", positionals: ["bookId", "entryId"], needs: 2, options: { "--fields": { arg: "fields", as: "json" } } },
  },
];
