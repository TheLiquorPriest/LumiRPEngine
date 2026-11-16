// The Storage page's routes (plan §5.5, §14): what the tree takes chat by chat and area by area, a chat's
// largest and most rewritten notes, and a chat's old turn folders pruned on request (`retention.ts`),
// never while one of its turns is going on.

import { route, RouteError, shape } from "../app";
import { pruneChat } from "./retention";
import type { RouteKit } from "./route-kit";
import { treeSettingsOf } from "./settings";
import { noteFiles, treeStorage } from "./storage";
import { notesReply, pruneBody, pruneReply, storageReply } from "./shapes";

export function storageRoutes(kit: RouteKit) {
  const { deps, own } = kit;
  return [
    route({
      method: "GET",
      path: "/api/v1/storage",
      access: "page",
      group: "files",
      does: "What the tree takes: each chat's folder by area, the user's own level, the shipped level, and RPE's database file.",
      reply: storageReply,
      handle: ({ user }) => treeStorage(deps, user),
    }),
    route({
      method: "GET",
      path: "/api/v1/storage/notes",
      access: "page",
      group: "files",
      does: "A chat's largest notes, and those agents rewrote most.",
      query: { chat: shape.field(shape.text({ blank: false }), "The chat whose notes are listed."), limit: shape.optional(shape.whole({ least: 0 }), "How many of each; the Storage page's setting when left out, and at most its largest.") },
      reply: notesReply,
      handle: async ({ user, query }) => {
        const loc = own.locationOf(user, query.chat);
        const { notesListed, notesMost } = await treeSettingsOf(loc);
        return await noteFiles(deps, loc, user, query.chat, Math.min(query.limit ?? notesListed, notesMost));
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/files-prune",
      access: "page",
      group: "files",
      does: "Prunes a chat's old turn folders as the chat's retention setting says, never while a turn of it is going on; says what it took away.",
      body: pruneBody,
      reply: pruneReply,
      handle: async ({ user, body }) => {
        if (deps.turning(user, body.chat)) throw new RouteError(409, "A turn of this chat is going on: prune once it is over.");
        return { pruned: await pruneChat(deps, user, body.chat) };
      },
    }),
  ] as const;
}
