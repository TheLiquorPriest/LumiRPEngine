// The Files page's routes over files (plan §5.1, §5.2, §5.4, §14): the tree's listing for a chat, or with no
// chat its shipped and global levels; one file read; the difference of a file from the shipped default of
// its name, and from the default as it stood before every update since the user wrote theirs; a file
// written as the user at a level, which for a file of another level is the user's own file of that name
// there, taken in place of the farther one; a file of the user's removed, which for one in place of a
// default is resetting to the default, and for a shipped file is switching its name off in the `off:`
// list of the level it is deleted at (§5.2: "Delete" on a shipped file does exactly that); a name
// switched off or on again in a level's config; and any agent's stack with where each part comes from.
// Every route is a page's: an agent has no way to them, and reaches the tree only through the file
// port, held to where it may write.
//
// The page's shape asked for switching off at `/api/v1/files/*/off`; the route table takes a `*` only as
// a path's last part, so it is `/api/v1/files-off/*`, and the difference is `/api/v1/files-diff/*`.

import { stat } from "node:fs/promises";
import { route, RouteError, shape } from "../app";
import { readText } from "../app/disk";
import { userMayWrite, writtenKey } from "./catalog";
import { defaultStanding, defaultUpdateTexts, lineDiff, updatesSince } from "./defaults";
import { chatOf, LEVELS, levelOf, type RouteKit, viewPathOf } from "./route-kit";
import { OFF_LEVELS } from "./own-files";
import { treeSettingsOf } from "./settings";
import { chatQuery, fileRemovedReply, fileSwitchBody, fileWriteBody, fileWrittenReply, stackReply, treeDiffReply, treeFileReply, treeListingReply, type TreeFileDiff, type TreeFileText } from "./shapes";

/** The routes that name a file: its path in the chat's view follows the route's own segments. */
const FILE_PATH = "/api/v1/files/*";
const OFF_PATH = "/api/v1/files-off/*";
const DIFF_PATH = "/api/v1/files-diff/*";

export function fileRoutes(kit: RouteKit) {
  const { deps, own } = kit;
  return [
    route({
      method: "GET",
      path: "/api/v1/files-stack",
      access: "page",
      group: "files",
      does: "The exact stack an agent gets in a chat, part by part, with the file each comes from.",
      query: { chat: shape.field(shape.text({ blank: false }), "The chat the agent runs in."), agent: shape.field(shape.text({ blank: false }), "The agent's definition.") },
      reply: stackReply,
      handle: async ({ user, query }) => ({ agent: query.agent, parts: await deps.stack(user, query.chat, query.agent) }),
    }),
    route({
      method: "GET",
      path: "/api/v1/files",
      access: "page",
      group: "files",
      does: "Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own.",
      query: { chat: chatQuery },
      reply: treeListingReply,
      handle: async ({ user, query }) => ({ files: await kit.listingOf(user, own.locationOf(user, chatOf(query.chat))) }),
    }),
    route({
      method: "GET",
      path: DIFF_PATH,
      access: "page",
      group: "files",
      does: "A file's difference from the shipped file of its name, and what the updates that changed the shipped file since it was written changed of it, together and one by one.",
      query: { chat: chatQuery },
      reply: treeDiffReply,
      handle: async ({ user, params, query }) => {
        const loc = own.locationOf(user, chatOf(query.chat));
        const at = await own.found(loc, viewPathOf(params["*"]));
        const entry = await kit.entryOf(user, loc, at.path);
        const text = entry === null ? null : await readText(at.disk);
        if (entry === null || text === null) throw new RouteError(404, `The tree has no file ${at.path}.`);
        const shipped = entry.shipped === null ? null : await readText((await own.found(loc, entry.shipped)).disk);
        const { diffCells } = await treeSettingsOf(loc);
        const diff: TreeFileDiff = { path: entry.path, shipped: entry.shipped, lines: shipped === null ? [] : lineDiff(shipped, text, diffCells), update: null, updates: [] };
        if (entry.shipped === null || shipped === null) return diff;
        // Every change updates made to the default since the user wrote this file: each one's text before it is the text after the one before.
        const standing = defaultStanding(deps.db, user);
        const since = new Set(updatesSince(standing.updates.get(entry.shipped) ?? [], standing.written.get(writtenKey(deps.files, at.disk)), (await stat(at.disk)).mtimeMs).map((u) => u.seq));
        const texts = defaultUpdateTexts(deps.db, user, entry.shipped);
        const changes = texts.flatMap((u, i) => (since.has(u.seq) && !u.removed ? [{ at: u.at, before: u.before, after: texts[i + 1]?.before ?? shipped }] : []));
        const first = changes[0];
        const last = changes.at(-1);
        if (first !== undefined && last !== undefined) {
          diff.update = { at: last.at, lines: lineDiff(first.before, shipped, diffCells) };
          diff.updates = changes.map((c) => ({ at: c.at, lines: lineDiff(c.before, c.after, diffCells) }));
        }
        return diff;
      },
    }),
    route({
      method: "GET",
      path: FILE_PATH,
      access: "page",
      group: "files",
      does: "One file of the tree, as text.",
      query: { chat: chatQuery },
      reply: treeFileReply,
      handle: async ({ user, params, query }) => {
        const loc = own.locationOf(user, chatOf(query.chat));
        const at = await own.found(loc, viewPathOf(params["*"]));
        const text = at.is === "file" ? await readText(at.disk) : null;
        if (text === null) throw new RouteError(404, `The tree has no file ${at.path}.`);
        const file: TreeFileText = { path: at.path, level: at.level, kind: at.kind, bytes: Buffer.byteLength(text, "utf8"), editable: userMayWrite(at.level, at.rest, at.kind), text };
        return file;
      },
    }),
    route({
      method: "PUT",
      path: FILE_PATH,
      access: "page",
      group: "files",
      does: "Writes a file's whole text as the user at a level (for a file of another level, the user's own file of its name there); says the file as the listing now shows it.",
      body: fileWriteBody,
      reply: fileWrittenReply,
      handle: async ({ user, params, body }) => {
        const chat = chatOf(body.chat);
        const loc = own.locationOf(user, chat);
        const written = await own.writeAsUser(user, loc, viewPathOf(params["*"]), levelOf(body.level, LEVELS, chat), body.text);
        return { file: await kit.entryOf(user, loc, written) };
      },
    }),
    route({
      method: "DELETE",
      path: FILE_PATH,
      access: "page",
      group: "files",
      does: "Removes a file of the user's; for one in place of a default, that is resetting to the default. \"Delete\" on a shipped file writes its name in the `off:` list of the level named (the chat's when a chat is named, else the global level's), so the shipped file stays and is not in force.",
      query: { chat: chatQuery, level: shape.optional(shape.oneOf("global", "chat"), "For a shipped file, the level whose `off:` list takes its name; the chat's when a chat is named, else the global level's.") },
      reply: fileRemovedReply,
      handle: async ({ user, params, query }) => {
        const chat = chatOf(query.chat);
        const loc = own.locationOf(user, chat);
        const at = await own.found(loc, viewPathOf(params["*"]));
        if (at.is !== "file") throw new RouteError(404, `The tree has no file ${at.path}.`);
        if (at.level !== "shipped") {
          await own.remove(at);
          return { removed: at.path };
        }
        const level = levelOf(query.level ?? (chat === null ? "global" : "chat"), OFF_LEVELS, chat);
        const listed = await kit.entryOf(user, loc, at.path);
        if (listed?.item === null || listed === null) throw new RouteError(400, `${at.path} is not a file RPH takes by its name, so no \`off:\` list can name it.`);
        await own.switchOff(loc, level, listed.item, true);
        return { removed: at.path, switchedOff: level };
      },
    }),
    route({
      method: "PUT",
      path: OFF_PATH,
      access: "page",
      group: "files",
      does: "Switches a file's name off or on again in the `off:` list of a level's config, which is what \"Delete\" on a shipped file does; says the file as the listing now shows it.",
      body: fileSwitchBody,
      reply: fileWrittenReply,
      handle: async ({ user, params, body }) => {
        const chat = chatOf(body.chat);
        const level = levelOf(body.level, OFF_LEVELS, chat);
        const loc = own.locationOf(user, chat);
        const path = viewPathOf(params["*"]);
        const listed = await kit.entryOf(user, loc, (await own.found(loc, path)).path);
        if (listed === null) throw new RouteError(404, `The tree has no file ${path}.`);
        if (listed.item === null) throw new RouteError(400, `${listed.path} is not a file RPH takes by its name, so no \`off:\` list can name it.`);
        await own.switchOff(loc, level, listed.item, body.off);
        return { file: await kit.entryOf(user, loc, listed.path) };
      },
    }),
  ] as const;
}
