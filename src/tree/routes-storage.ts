// The Storage page's routes (plan §5.5, §14): what the tree takes chat by chat and area by area, each kind RPE
// keeps with its count, size, oldest and how long it is kept, a chat's largest and most rewritten notes, and
// what is pruned on request: always asked first, so the page says what goes before it goes, and then taken
// exactly as asked. Pruning a chat's old turn folders in one step (`files-prune`) is the page's old way, kept
// until the page asks first.

import { route, RouteError, shape } from "../app";
import { storageKinds } from "./kinds";
import { planPrune } from "./prune";
import { pruneChat } from "./retention";
import type { RouteKit } from "./route-kit";
import { treeSettingsOf } from "./settings";
import { noteFiles, treeStorage } from "./storage";
import { notesReply, pruneBody, pruneReply, storageKindsReply, storagePruneBody, storagePruneReply, storageReply } from "./shapes";

export function storageRoutes(kit: RouteKit) {
  const { deps, own } = kit;
  return [
    route({
      method: "GET",
      path: "/api/v1/storage",
      access: "page",
      group: "files",
      does: "What the tree takes, a page of chats at a time from the sizes RPE keeps (a chat not measured yet is measured meanwhile and shows its sizes at the next read): each chat's folder by area and its rows of the database, the user's own level, the shipped level, and RPE's database file with what no chat's rows take of it.",
      query: { limit: shape.optional(shape.whole({ least: 1 }), "How many chats a page holds; the `storage.page` setting's when left out, and at most `files.list.maxPage`."), after: shape.optional(shape.text(), "The chat after which the page starts: the `next` of the page before.") },
      reply: storageReply,
      handle: async ({ user, query }) => {
        const s = await treeSettingsOf(own.locationOf(user, null));
        return await treeStorage(deps, user, { limit: Math.min(query.limit ?? s.chatsListed, s.listMost), after: query.after, staleMs: s.recheckHours * 3_600_000 });
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/storage/kinds",
      access: "page",
      group: "files",
      does: "Each kind RPE keeps (notes, versions of notes, suggestions, turn folders kept whole and pruned, session files, the user's files, the shipped level, the database, the migration's backups, copies of the database, archives) with how many, how big, the oldest, how long it is kept and by which setting, and when the user last pruned.",
      reply: storageKindsReply,
      handle: ({ user }) => storageKinds(deps, user),
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
      path: "/api/v1/storage-prune",
      access: "page",
      group: "files",
      does: "Prunes on request, asked first: without `plan` it answers which places would go (a chat's old turn folders, its closed sessions' files, a deleted chat's other files, or the backup or copy of the database named), how many files and bytes, and a plan standing for exactly that; with the plan it takes exactly that, or nothing if the tree has changed since. Never a turn going on, never an open session's files.",
      body: storagePruneBody,
      reply: storagePruneReply,
      handle: async ({ user, body }) => {
        const planned = await planPrune(deps, user, body);
        const { plan, items, files, bytes } = planned;
        if (body.plan === undefined) return { plan, removed: false, files, bytes, items };
        if (body.plan !== plan) throw new RouteError(409, "What there is to prune has changed since you asked: ask again, and prune what that says.");
        await planned.take();
        if (body.what !== "backup" && typeof body.chat === "string") deps.measurer.request(user, body.chat);
        return { plan, removed: true, files, bytes, items };
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
        const pruned = await pruneChat(deps, user, body.chat);
        deps.measurer.request(user, body.chat);
        return { pruned };
      },
    }),
  ] as const;
}
