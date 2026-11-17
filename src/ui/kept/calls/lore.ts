// Build's lore and secrecy tools on RPE's typed routes (plan §4.4, §14; PlanChatUI-B3 item 6): today's `lre.lore` (his books and their entries, pins,
// LRE's fields and Make secret, Save to lore, the world's lore index and its entry) and `lre.secrecy` (his books and where each move stands, its
// preview, Apply, Confirm and Restore) go to the lore routes, and the answer comes back as today's result body. A write names the revision the page
// read the entry at; one on an entry that changed since is the `conflict` a refusal is, and the page reads the book again. The index is the lore's
// of the books the world reads, and its entry is written only on his press; the view carries whether the index changed since (`built.current`).

import type { RequestBody } from "../../../frontend/registry";
import type { JsonValue } from "../../../shared/json";
import type { BookFieldsEdit } from "../../../shared/lore";
import type { LoreBookEntryView, LoreBookView, LoreIndexView, LorePinsView, SecrecyBookPlan, SecrecyBookView } from "../../../shared/lore-views";
import type { ResultBodies } from "../../../shared/protocol";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type Of<T extends RequestBody["type"]> = Extract<RequestBody, { type: T }>;

/** What the lore index's requests say where they name no world. */
const NO_WORLD = "The lore index is a world's: name the world.";

/** What a write that names no revision says: a write is checked against the revision the page read. */
const NO_REVISION = "A write to a book's entry names the revision it read the entry at.";

async function lore(request: Of<"lre.lore">, ctx: CallContext): Promise<ResultBodies["lre.lore"]> {
  const call = ctx.client.call;
  switch (request.op) {
    case "save": {
      const saved = await call("POST /api/v1/chats/:chat/lore/save", { chat: request.chatId }, { body: request.text === undefined ? {} : { text: request.text } });
      return { worldId: saved.world, id: saved.id };
    }
    case "books":
      return { books: (await call("GET /api/v1/build/lore/books", {}, { query: request.chatId === undefined ? {} : { chat: request.chatId } })).books as unknown as LoreBookView[] };
    case "entries":
      return { entries: (await call("GET /api/v1/build/lore/books/:book/entries", { book: request.bookId })).entries as unknown as LoreBookEntryView[] };
    case "pins":
      return { pins: (await call("GET /api/v1/build/lore/pins", {}, { query: request.worldId !== undefined ? { world: request.worldId } : request.chatId !== undefined ? { chat: request.chatId } : {} })).pins as unknown as LorePinsView };
    case "fields": {
      if (request.revision === undefined) throw new Refusal("bad_request", NO_REVISION);
      const body = { fields: request.fields as unknown as JsonValue as BookFieldsEdit | null as never, revision: request.revision };
      return { entries: (await call("POST /api/v1/build/lore/books/:book/entries/:entry/fields", { book: request.bookId, entry: request.entryId }, { body })).entries as unknown as LoreBookEntryView[] };
    }
    case "mark": {
      if (request.revision === undefined) throw new Refusal("bad_request", NO_REVISION);
      return { entries: (await call("POST /api/v1/build/lore/books/:book/entries/:entry/mark", { book: request.bookId, entry: request.entryId }, { body: { change: request.change as unknown as JsonValue, revision: request.revision } })).entries as unknown as LoreBookEntryView[] };
    }
    case "index":
      if (request.worldId === undefined) throw new Refusal("bad_request", NO_WORLD);
      return { index: (await call("GET /api/v1/build/lore/index", {}, { query: { world: request.worldId } })).index as unknown as LoreIndexView };
    case "build":
      if (request.worldId === undefined) throw new Refusal("bad_request", NO_WORLD);
      return { index: (await call("POST /api/v1/build/lore/index", {}, { body: { world: request.worldId, ...(request.bookId === undefined ? {} : { book: request.bookId }) } })).index as unknown as LoreIndexView };
    default:
      throw new Refusal("bad_request", "no such lore request");
  }
}

async function secrecy(request: Of<"lre.secrecy">, ctx: CallContext): Promise<ResultBodies["lre.secrecy"]> {
  const call = ctx.client.call;
  switch (request.op) {
    case "books":
      return { books: (await call("GET /api/v1/build/secrecy/books", {})).books as unknown as SecrecyBookView[] };
    case "preview":
      return { book: (await call("GET /api/v1/build/secrecy/books/:book", { book: request.bookId })).book as unknown as SecrecyBookPlan };
    case "apply":
      return { book: (await call("POST /api/v1/build/secrecy/books/:book/apply", { book: request.bookId }, { body: { version: request.version } })).book as unknown as SecrecyBookPlan };
    case "confirm":
      return { book: (await call("POST /api/v1/build/secrecy/books/:book/confirm", { book: request.bookId }, { body: { version: request.version } })).book as unknown as SecrecyBookPlan };
    case "restore":
      return { book: (await call("POST /api/v1/build/secrecy/books/:book/restore", { book: request.bookId }, { body: { version: request.version } })).book as unknown as SecrecyBookPlan };
    default:
      throw new Refusal("bad_request", "not a step of a book's move");
  }
}

export const calls: CallFile = {
  name: "lore",
  takes: (request) => request.type === "lre.lore" || request.type === "lre.secrecy",
  async serve(request, ctx): Promise<ServedBody> {
    if (request.type === "lre.lore") return await lore(request, ctx);
    if (request.type === "lre.secrecy") return await secrecy(request, ctx);
    throw new Refusal("internal", `The lore calls do not take ${request.type}.`);
  },
};
