// Build's lore and secrecy tools on RPE's own typed routes (plan §4.4, §14; PlanChatUI-B3): his books and their entries, LRE's fields and Make
// secret written with the revision the page read the entry at, the pins read now, Save to lore, and the secrecy page's book-by-book move to secret
// marks. The documents are the page's (`LoreBookEntryView`, `LorePinsView`, `SecrecyBookPlan`), carried as the previous build's wire has them. Every
// route answers for the user this RPE belongs to; each write is the user's own press.

import { route, RouteError, shape } from "../../app";
import type { BookFieldsEdit } from "../../shared/lore";
import type { LoreMarkChange } from "../../shared/lore-views";
import type { IndexEntries } from "./index-entry";
import { markChangeOf } from "./marks";
import type { BuildLore } from "./service";
import { LoreError } from "./service";
import { SecrecyError } from "./secrecy";
import { WorldError } from "../../worlds/worlds";

const T = shape.text();
const field = shape.field;
const opt = shape.optional;

export const LORE_BOOKS_PATH = "/api/v1/build/lore/books";
export const LORE_PINS_PATH = "/api/v1/build/lore/pins";
export const LORE_SAVE_PATH = "/api/v1/chats/:chat/lore/save";
export const LORE_INDEX_PATH = "/api/v1/build/lore/index";
export const SECRECY_BOOKS_PATH = "/api/v1/build/secrecy/books";

const STATUS = { bad_request: 400, not_found: 404, conflict: 409, unavailable: 503 } as const;

async function guarded<A>(work: () => Promise<A>): Promise<A> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LoreError || error instanceof SecrecyError) throw new RouteError(STATUS[error.code], error.message);
    // A world the page names that is not there (the lore index reads its draft) is refused in RPE's words, not failed as the server.
    if (error instanceof WorldError) throw new RouteError(STATUS[error.code === "not_found" || error.code === "conflict" ? error.code : "bad_request"], error.message);
    throw error;
  }
}

const entries = shape.named("BookEntries", "A book's entries in its order: each with its title, whether it is switched off, its length, the revision a write must name, LRE's fields, its secret marks and what starts like one that can't be read.", shape.json());

export function loreRoutes(lore: BuildLore, index: IndexEntries) {
  const step = (name: "apply" | "confirm" | "restore", does: string) =>
    route({
      method: "POST",
      path: `${SECRECY_BOOKS_PATH}/:book/${name}`,
      access: "page",
      group: "lore",
      does,
      body: shape.object({ version: field(T, "The version the page read the book at (`SecrecyBookPlan.version`): a book or move that changed since is refused as a conflict.") }),
      reply: shape.object({ book: field(shape.json(), "The book's move as it stands after.") }),
      handle: ({ params, body, user }) => guarded(async () => ({ book: (await lore.secrecy[name](params.book, body.version, user)) as never })),
    });
  return [
    route({
      method: "GET",
      path: LORE_BOOKS_PATH,
      access: "page",
      group: "lore",
      does: "His World Info books a pin may name an entry of, the engine's own left out: those the chat has first, then by name, each with whether a character brought it and when it was made, which tells books of one name apart.",
      query: { chat: opt(T, "The chat whose books come first.") },
      reply: shape.object({ books: field(shape.json(), "The books.") }),
      handle: ({ query, user }) => guarded(async () => ({ books: (await lore.books(user, query.chat ?? null)) as never })),
    }),
    route({
      method: "GET",
      path: `${LORE_BOOKS_PATH}/:book/entries`,
      access: "page",
      group: "lore",
      does: "One of his books' entries, for the pin picker and the lore editor: in the book's order, each with its LRE fields, its secret marks and the revision a write must name.",
      reply: shape.object({ entries: field(entries, "The entries.") }),
      handle: ({ params, user }) => guarded(async () => ({ entries: (await lore.entries(user, params.book)) as never })),
    }),
    route({
      method: "POST",
      path: `${LORE_BOOKS_PATH}/:book/entries/:entry/fields`,
      access: "page",
      group: "lore",
      does: "Sets one entry's own LRE fields (its visibility, links and aliases; null takes them off) on his press, checked against the revision the page read: the rest of its extension data and an earlier build's secrecy fields stay as they are, and nothing else of the entry is written. A write on an entry that changed since is refused as a conflict. Kept with the entry before and after, so it can be put back.",
      body: shape.object({ fields: field(shape.json(), "The fields as an object, or null to take them off."), revision: field(shape.whole({ least: 0 }), "The revision the page read the entry at.") }),
      reply: shape.object({ entries: field(entries, "The book's entries as read after.") }),
      handle: ({ params, body, user }) => guarded(async () => ({ entries: (await lore.fields(user, params.book, params.entry, body.fields as BookFieldsEdit | null, body.revision)) as never })),
    }),
    route({
      method: "POST",
      path: `${LORE_BOOKS_PATH}/:book/entries/:entry/mark`,
      access: "page",
      group: "lore",
      does: "Make secret and Make public on one entry, on his press, checked against the revision the page read: the change is written as secret marks into the entry's text and nothing else of it. A write on an entry that changed since is refused as a conflict. Kept with the entry before and after, so it can be put back.",
      body: shape.object({ change: field(shape.json(), "The change: secret, add, names or public, with the names it gives."), revision: field(shape.whole({ least: 0 }), "The revision the page read the entry at.") }),
      reply: shape.object({ entries: field(entries, "The book's entries as read after.") }),
      handle: ({ params, body, user }) =>
        guarded(async () => {
          const change = markChangeOf(body.change);
          if (change === null) throw new LoreError("bad_request", 'give the change: {"kind": "secret" | "add" | "names" | "public", …}');
          return { entries: (await lore.mark(user, params.book, params.entry, change as LoreMarkChange, body.revision)) as never };
        }),
    }),
    route({
      method: "GET",
      path: LORE_PINS_PATH,
      access: "page",
      group: "lore",
      does: "Every pin of a world's draft (with `world`) or of the revision a chat plays (with `chat`), read now: by character, by place and by step, each with its entry's or book's title, where it comes from and whether it reads.",
      query: { world: opt(T, "A world: its draft's pins."), chat: opt(T, "A chat: the pins of the revision it plays.") },
      reply: shape.object({ pins: field(shape.json(), "The pins.") }),
      handle: ({ query, user }) =>
        guarded(async () => {
          if (query.world === undefined && query.chat === undefined) throw new LoreError("bad_request", "name the world or the chat");
          return { pins: (await lore.pins(user, query.world !== undefined ? { world: query.world } : { chat: query.chat ?? "" })) as never };
        }),
    }),
    route({
      method: "GET",
      path: LORE_INDEX_PATH,
      access: "page",
      group: "lore",
      does: "The lore index of the books a world reads, as its draft names them: the text an index entry holds, each book with how many entries it lists, and the entry written of it, if one is, with whether the index has changed since.",
      query: { world: field(T, "The world.") },
      reply: shape.object({ index: field(shape.json(), "The index.") }),
      handle: ({ query, user }) => guarded(async () => ({ index: (await index.view(user, query.world)) as never })),
    }),
    route({
      method: "POST",
      path: LORE_INDEX_PATH,
      access: "page",
      group: "lore",
      does: "Writes the world's lore index as an entry, on his press: the entry written before, where it is still at the revision Build left it at (one changed in Lumiverse since is refused as a conflict), else a new entry of the book named.",
      body: shape.object({ world: field(T, "The world."), book: opt(T, "The book a new entry goes into.") }),
      reply: shape.object({ index: field(shape.json(), "The index as it stands after.") }),
      handle: ({ body, user }) => guarded(async () => ({ index: (await index.write(user, body.world, body.book ?? "")) as never })),
    }),
    route({
      method: "POST",
      path: LORE_SAVE_PATH,
      access: "page",
      group: "lore",
      does: "Saves the chat's latest reply, or an excerpt of its messages (found whatever its spacing and case; text it does not hold word for word is saved at its latest reply), as a draft lore entry of the world the chat plays, with the message it came from. The title is its first words; nothing is committed; the same title twice gets a fresh id. A chat that plays no world is refused.",
      body: shape.object({ text: opt(T, "An excerpt of the chat's messages; the latest reply when left out.") }),
      reply: shape.object({ world: field(T, "The world whose draft took the entry."), id: field(T, "The entry's id in the world's lore.") }),
      // What it keeps is the world's draft's, not the chat's, and only a chat RPE holds plays a world: a chat RPE does not hold is not taken on.
      takesChat: false,
      handle: ({ params, body, user }) => guarded(async () => {
        const saved = await lore.save(user, params.chat, body.text);
        return { world: saved.worldId, id: saved.id };
      }),
    }),
    route({
      method: "GET",
      path: SECRECY_BOOKS_PATH,
      access: "page",
      group: "lore",
      does: "His books (the engine's own left out) and where each one's move from LRE's old secrecy fields to secret marks stands: never moved or put back, moved and waiting for his check, confirmed, or put back in part.",
      reply: shape.object({ books: field(shape.json(), "The books.") }),
      handle: ({ user }) => guarded(async () => ({ books: (await lore.secrecy.books(user)) as never })),
    }),
    route({
      method: "GET",
      path: `${SECRECY_BOOKS_PATH}/:book`,
      access: "page",
      group: "lore",
      does: "One book read now, with what moving it to secret marks would do, entry by entry, or what its move did; writes nothing.",
      reply: shape.object({ book: field(shape.json(), "The book's move.") }),
      handle: ({ params, user }) => guarded(async () => ({ book: (await lore.secrecy.preview(params.book, user)) as never })),
    }),
    step("apply", "Apply: the undo copy of every entry the move lists is kept first, then each secret and each twin of one is written as its mark, with the old fields left on; each write is checked against the revision read. Refused as a conflict once the book or its move changed since the page read it, and while a move is under way."),
    step("confirm", "Confirm: once the book reads right, LRE's old secrecy fields come off every moved entry; the undo copy stays."),
    step("restore", "Restore secrecy as it was: every entry in the undo copy goes back as it stood before the move, byte for byte, after what he changed since is kept in the copy."),
  ];
}
