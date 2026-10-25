// The tools for lore around a world (DESIGN §4.2, §24.5): the user's World Info books and their
// entries a pin may name, the pins of a world as they read now, the drift of entries indexed from
// a book, and Save to lore from a chat. A world's own lore entries and pins are its document's
// (`/lore`, `/lorePins`), written with lre_edit like the rest of it.

import type { JsonObject } from "../shared/json";
import type { BookLoreFields } from "../shared/lore";
import type { Args } from "./args";
import { boolArg, intArg, neededText, textArg, ToolError } from "./args";
import { readAt } from "./read";
import type { ToolResult } from "./report";
import { json } from "./report";
import type { ToolModule } from "./tool-module";
import { object } from "./tool-module";
import type { ToolContext } from "./tools";

const OFFSET: JsonObject = { type: "integer", minimum: 0, description: "Read the answer's JSON text from this character instead of outlining it; each page says where the next begins." };

/** A read that may be large, as one answer: whole, outlined, or a page from `offset`. */
function answer(value: unknown, what: string, args: Args): ToolResult {
  const read = readAt(value, { what, offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

async function pinsRead(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const worldId = textArg(args, "worldId");
  const chatId = textArg(args, "chatId");
  if ((worldId === undefined) === (chatId === undefined)) throw new ToolError("Give worldId (the pins of a world's draft, as Build shows them) or chatId (the pins of the revision a chat plays), one of them.");
  // A chat's pins are the GM view's: a pin's entry can be a secret one, or one about someone the player hasn't met.
  if (chatId !== undefined && !boolArg(args, "spoilers")) throw new ToolError("A chat's pins are GM-level (an entry can be secret, or about someone the player hasn't met): pass spoilers: true to read them. A world's pins (worldId) are its author's.");
  const body = await ctx.live().conn.request("lre.lore", worldId !== undefined ? { op: "pins", worldId } : { op: "pins", chatId: chatId ?? "" });
  return answer(body.pins ?? { characters: {}, places: {}, steps: {} }, worldId !== undefined ? `the lore pins of the draft of ${worldId}` : `the lore pins of chat ${chatId ?? ""}`, args);
}

async function saveTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = neededText(args, "chatId", "the chat's id (lre_chats lists them)");
  const text = textArg(args, "text");
  const live = ctx.live();
  const saved = await live.conn.request("lre.lore", text === undefined ? { op: "save", chatId } : { op: "save", chatId, text });
  if (saved.worldId === undefined || saved.id === undefined) throw new ToolError("LumiRPEngine saved the entry but didn't say where; lre_draft of the chat's world shows it.");
  const draft = await live.draft(saved.worldId);
  return { text: json({ worldId: saved.worldId, id: saved.id, version: draft.version, entry: draft.draft.lore[saved.id] ?? null, next: "It is in the world's draft (Build's too): change it with lre_edit at /lore/<id>, then lre_commit." }) };
}

export const LORE_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_lore_books",
    description: "Your Lumiverse World Info books a lore pin may name, whole or by an entry (DESIGN §24.5), with chatId those attached to that chat first and marked attached. The engine's own books (\"LumiRPEngine · <world>\") are left out: a world's lore is its document's. Two books may share a name, since a character's card brings its own copy of each book it carries: `character` marks such a copy and `added` says when each was made (Unix seconds).",
    inputSchema: object({ chatId: { type: "string", description: "Mark and list first the books attached to this chat." } }),
    write: false,
    run: async (args, ctx) => {
      const chatId = textArg(args, "chatId");
      return { text: json({ books: (await ctx.live().conn.request("lre.lore", chatId === undefined ? { op: "books" } : { op: "books", chatId })).books ?? [] }) };
    },
    cli: { command: "lore-books", section: "Lore", usage: "lore-books [<chatId>]", summary: "Your World Info books a pin may name", positionals: ["chatId"] },
  },
  {
    name: "lre_lore_entries",
    description: 'One World Info book\'s entries (lre_lore_books lists the books): id, title, whether it is switched off in its book (a pin of that entry still reads it), and its length; "twins", the entries of the same text (spacing aside) in any of your books, which its secrecy keeps off with it; and "copyOf" on a twin kept secret with another entry ("kept" while a secret of its text holds it). A pin names one as {"book": "<bookId>", "entry": "<entryId>"} in a world\'s /lorePins, and the whole book as {"book": "<bookId>"}: its switched-on entries, read in the book\'s order whenever a call reads it, so entries added later are read too.',
    inputSchema: object({ bookId: { type: "string", description: "The book's id." }, offset: OFFSET }, ["bookId"]),
    write: false,
    run: async (args, ctx) => {
      const bookId = neededText(args, "bookId", "the book's id (lre_lore_books lists them)");
      return answer({ bookId, entries: (await ctx.live().conn.request("lre.lore", { op: "entries", bookId })).entries ?? [] }, `the entries of book ${bookId}`, args);
    },
    cli: { command: "lore-entries", section: "Lore", usage: "lore-entries <bookId> [--offset <n>]", summary: "One book's entries, for a pin", positionals: ["bookId"], needs: 1, options: { "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_lore_pins",
    description:
      "Every lore pin of a world's draft (worldId, as Build shows them) or of the revision a chat plays (chatId, as GM → Minds shows them, behind spoilers: true), by character, by place and by step (/lorePins/steps/<step>: every call of that step reads them first, whatever its lore policy; the mind step's, every mind), each read now: its entry's or whole book's title, where it comes from (the world's lore, or a book by name; a whole book says how many entries it has switched on), and its status: ok, missing (no such entry or book, or gone from its book), pending (an AI-written entry not reviewed yet, which nothing reads) or off (switched off in its book, which a pin of that entry still reads); secret marks a secret world entry. Pins themselves are written with lre_edit at /lorePins.",
    inputSchema: object({ worldId: { type: "string", description: "The world whose draft's pins to read." }, chatId: { type: "string", description: "Or the chat whose revision's pins to read." }, spoilers: { type: "boolean", description: "Needed with chatId: a chat's pins are GM-level." }, offset: OFFSET }),
    write: false,
    run: pinsRead,
    cli: { command: "lore-pins", section: "Lore", usage: "lore-pins (--world <id> | --chat <id> --spoilers) [--offset <n>]", summary: "A world's or a chat's lore pins, read now", options: { "--world": { arg: "worldId", as: "text" }, "--chat": { arg: "chatId", as: "text" }, "--spoilers": { arg: "spoilers", as: "flag" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_lore_drift",
    description: "The lore entries of a world's draft indexed from a World Info book whose book entry changed since (with its text and hash now) or is gone, by lore id; an entry still as it was is left out. id asks about one entry. To take a book's new text, write it into the entry with lre_edit (its content, and source.hash).",
    inputSchema: object({ worldId: { type: "string", description: "The world's id (w_…)." }, id: { type: "string", description: "Only this lore entry." }, offset: OFFSET }, ["worldId"]),
    write: false,
    run: async (args, ctx) => {
      const worldId = neededText(args, "worldId", "the world's id (lre_worlds lists them)");
      const id = textArg(args, "id");
      const body = await ctx.live().conn.request("lre.lore", id === undefined ? { op: "drift", worldId } : { op: "drift", worldId, id });
      return answer({ worldId, drift: body.drift ?? {} }, `the book drift of the draft of ${worldId}`, args);
    },
    cli: { command: "lore-drift", section: "Lore", usage: "lore-drift <worldId> [--id <loreId>] [--offset <n>]", summary: "Book-sourced entries whose book entry changed", positionals: ["worldId"], needs: 1, options: { "--id": { arg: "id", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_lore_save",
    description: "Save to lore, as the chat's ⋯ menu does: the chat's latest reply (without its JSON block), or text (an excerpt of a message in the chat), becomes a new lore entry in the draft of the chat's world, its source the message it came from. The draft is the user's Build draft too: review the entry, then commit it with lre_commit or drop it with lre_edit. Answers the world, the entry's id and the entry.",
    inputSchema: object({ chatId: { type: "string", description: "The chat's id (lre_chats lists them)." }, text: { type: "string", description: "An excerpt of one of the chat's messages to save instead of the latest reply." } }, ["chatId"]),
    write: { destructive: false, idempotent: false },
    run: saveTool,
    cli: { command: "lore-save", section: "Lore", usage: "lore-save <chatId> [--text <excerpt>]", summary: "The latest reply (or an excerpt) becomes lore", positionals: ["chatId"], needs: 1, options: { "--text": { arg: "text", as: "text" } } },
  },
  {
    name: "lre_lore_fields",
    description:
      'Set LumiRPEngine\'s fields on one of your World Info entries, as Build → Lore → World Info does (DESIGN §4.2): {"secret": true, "gate": "<formula>"} keeps the entry secret (stored switched off; the engine switches it on for a prompt, and its helpers read it, only once the gate holds), "audience" names the helpers that may read it before then, "visibility": "known_by" with "links" shows it once the player knows them, and "aliases" and "holders" are as on a world entry. fields: null takes them off; a secret made public is switched back on. Its twins (entries of the same text, spacing aside, in any of your books, such as the copy a character\'s card brings) go with it: kept secret and switched off with it, and put back as they stood once no secret holds their text; a twin kept secret that way is refused here, since it follows the secret. The entry\'s book is read as lore when it is attached to the chat, global, or in the world\'s /loreBooks. Answers the book\'s entries with their fields.',
    inputSchema: object({ bookId: { type: "string", description: "The entry's book (lre_lore_books lists them)." }, entryId: { type: "string", description: "The entry (lre_lore_entries lists them)." }, fields: { type: ["object", "null"], description: "The fields, or null to take them off." } }, ["bookId", "entryId", "fields"]),
    write: { destructive: false, idempotent: true },
    run: async (args, ctx) => {
      const bookId = neededText(args, "bookId", "the book's id (lre_lore_books lists them)");
      const entryId = neededText(args, "entryId", "the entry's id (lre_lore_entries lists them)");
      const fields = args.fields;
      if (fields !== null && (typeof fields !== "object" || Array.isArray(fields))) throw new ToolError("Give fields as an object, or null to take them off.");
      const body = await ctx.live().conn.request("lre.lore", { op: "fields", bookId, entryId, fields: fields as BookLoreFields | null });
      return { text: json({ bookId, entries: body.entries ?? [] }) };
    },
    cli: { command: "lore-fields", section: "Lore", usage: "lore-fields <bookId> <entryId> --fields <json|null>", summary: "Set LumiRPEngine's fields on a World Info entry", positionals: ["bookId", "entryId"], needs: 2, options: { "--fields": { arg: "fields", as: "json" } } },
  },
];
