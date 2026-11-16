// The projection book's switch (plan §9.5, §14), for the Lore page: whether the chat has it on (the setting `lore.projection`, which the Settings
// page writes at the chat's level) and its book; and his press that applies the setting now, rather than at the next scene's end: on, the book is
// made or rewritten; off, the book made while it was on is taken away. Declared in the route form (`src/app/routes.ts`); they answer only for the user
// this RPE belongs to. The book is his own to turn on: nothing here turns it on.

import { route, shape } from "../app";
import type { LoreProjection } from "./projection";

const T = shape.text();
const field = shape.field;

export const LORE_PROJECTION_PATH = "/api/v1/chats/:chat/lore/projection";
export const LORE_PROJECTION_REFRESH_PATH = "/api/v1/chats/:chat/lore/projection/refresh";

const stateReply = shape.named(
  "LoreProjectionState",
  "Whether a chat has the projection book on, and the book RPE made for it where it has.",
  shape.object({ on: field(shape.yesNo(), "Whether the chat's setting `lore.projection` has it on."), book: field(shape.nullable(T), "Lumiverse's id of the chat's book; null where none is made.") }),
);

const refreshedReply = shape.named(
  "LoreProjectionRefreshed",
  "What applying the setting did: the book as it now stands and whether it was rewritten, or, with the setting off, the book that was taken away.",
  shape.object({
    on: field(shape.yesNo(), "Whether the chat's setting has it on."),
    book: field(shape.nullable(T), "Lumiverse's id of the chat's book after the press; null where there is none."),
    written: field(shape.yesNo(), "Whether the book was rewritten (false where it already held what the path says)."),
    removed: field(shape.nullable(T), "The book taken away because the setting is off; null where none was."),
  }),
);

export function projectionRoutes(projection: LoreProjection) {
  return [
    route({
      method: "GET",
      path: LORE_PROJECTION_PATH,
      access: "page",
      group: "lore",
      does: "Whether the chat has the projection book on (the setting `lore.projection`, off unless he turns it on) and the book RPE made for it, which only that chat has attached.",
      reply: stateReply,
      handle: async ({ user, params }) => ({ on: await projection.on(user, params.chat), book: projection.book(user, params.chat) }),
    }),
    route({
      method: "POST",
      path: LORE_PROJECTION_REFRESH_PATH,
      access: "page",
      group: "lore",
      does: "Applies the chat's `lore.projection` setting now: on, the chat's own book of what the story changed and made is made or rewritten from the path as it stands; off, a book made while it was on is taken away. His own books are never touched.",
      reply: refreshedReply,
      handle: async ({ user, params }) => {
        const done = await projection.refresh(user, params.chat);
        return "off" in done ? { on: false, book: null, written: false, removed: done.removed } : { on: true, book: done.book, written: done.written, removed: null };
      },
    }),
  ] as const;
}
