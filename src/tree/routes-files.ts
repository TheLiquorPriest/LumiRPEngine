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
import { listingContext, namesInForce, userMayWrite, writtenKey } from "./catalog";
import { defaultStanding, defaultUpdateTexts, lineDiff, updatesSince } from "./defaults";
import { listFolder, searchTree } from "./listing";
import { OFF_LEVELS } from "./own-files";
import { readBytes, readLines } from "./ranged";
import { chatOf, LEVELS, levelOf, type RouteKit, viewPathOf } from "./route-kit";
import { treeSettingsOf } from "./settings";
import { locate } from "./view";
import { rphStanding, withStanding } from "./standing";
import { applyBody, applyReply, chatQuery, fileMoveBody, fileMovedReply, fileRemovedReply, filePinBody, fileSwitchBody, fileWriteBody, fileWrittenReply, folderBody, folderMadeReply, pinsReply, stackReply, treeDiffReply, treeFileReply, treeListedReply, treeListingReply, type TreeFileDiff } from "./shapes";

/** The routes that name a file: its path in the chat's view follows the route's own segments. */
const FILE_PATH = "/api/v1/files/*";
const OFF_PATH = "/api/v1/files-off/*";
const PIN_PATH = "/api/v1/files-pin/*";
const DIFF_PATH = "/api/v1/files-diff/*";

export function fileRoutes(kit: RouteKit) {
  const { deps, own } = kit;
  return [
    route({
      method: "GET",
      path: "/api/v1/files-stack",
      access: "page",
      group: "files",
      does: "The exact stack an agent gets in a chat, part by part, each with the file it comes from and its text, and the briefing's parts with the situations that add them; with no chat, the stack the shipped and global levels give.",
      query: { chat: shape.optional(shape.text({ blank: false }), "The chat the agent runs in; left out, the shipped and global levels alone."), agent: shape.field(shape.text({ blank: false }), "The agent's definition.") },
      reply: stackReply,
      handle: async ({ user, query }) => ({ agent: query.agent, parts: await deps.stack(user, query.chat ?? null, query.agent) }),
    }),
    route({
      method: "GET",
      path: "/api/v1/files",
      access: "page",
      group: "files",
      does: "Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own.",
      query: { chat: chatQuery },
      reply: treeListingReply,
      handle: async ({ user, query }) => {
        const chat = chatOf(query.chat);
        // A chat RPE has not played yet is placed as its first turn places it, so its levels have folders; where RPE cannot (Lumiverse is out of reach), its view is the shipped and global levels' alone.
        const loc = await own.locationFor(user, chat).catch(() => own.locationOf(user, chat));
        return { files: await kit.listingOf(user, loc) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/files-list",
      access: "page",
      group: "files",
      does: "The chat's view of the tree read like a filesystem: one folder's files and folders a page at a time (the chat's own top, with the other levels' folders, when none is named), or a search by name and by text across every level, each file with whether RPH takes it and why not; with no chat, the shipped and global levels.",
      query: {
        chat: chatQuery,
        folder: shape.optional(shape.text(), "The folder to list, by its path in the view; the chat's own top when left out."),
        search: shape.optional(shape.text(), "Search every level for files whose path or text holds this, instead of listing a folder."),
        limit: shape.optional(shape.whole({ least: 1 }), "How many entries a page holds; the `files.listPage` setting's when left out, and at most `files.listMost`."),
        after: shape.optional(shape.text(), "Where the page starts after: the `next` of the page before."),
      },
      reply: treeListedReply,
      handle: async ({ user, query }) => {
        const chat = chatOf(query.chat);
        const loc = await own.locationFor(user, chat).catch(() => own.locationOf(user, chat));
        const settings = await treeSettingsOf(loc);
        const ask = { limit: Math.min(query.limit ?? settings.listPage, settings.listMost), after: query.after };
        const ctx = await listingContext(loc, defaultStanding(deps.db, user));
        const wanted = query.search?.trim() ?? "";
        const page = wanted === "" ? await listFolder(ctx, query.folder ?? "", ask) : await searchTree(ctx, wanted, ask, { grepBytes: settings.grepBytes, grepMs: settings.grepMs });
        // RPH's own standing of the guidance files on the page: what it holds out and why, what it found wrong, whose stacks they join.
        if (!page.items.some((i) => i.entry?.item !== null && i.entry !== null)) return page;
        const standing = await rphStanding(deps.guidance(user, chat));
        return { ...page, items: page.items.map((i) => (i.entry === null ? i : { ...i, entry: withStanding(i.entry, standing) })) };
      },
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
      does: "One file of the tree, as text: a short file whole, a long one the lines (`line`, `lines`) or the bytes (`offset`, `length`) asked for, `files.readLines` lines when it asks for none; with the file's size and its count of lines, and whether it goes on.",
      query: {
        chat: chatQuery,
        line: shape.optional(shape.whole({ least: 1 }), "The first line to read, from 1."),
        lines: shape.optional(shape.whole({ least: 0 }), "How many lines to read; the `files.readLines` setting's when left out."),
        offset: shape.optional(shape.whole({ least: 0 }), "Read bytes instead of lines: the first byte, with `length`."),
        length: shape.optional(shape.whole({ least: 0 }), "How many bytes to read from `offset`."),
      },
      reply: treeFileReply,
      handle: async ({ user, params, query }) => {
        const loc = own.locationOf(user, chatOf(query.chat));
        const at = await own.found(loc, viewPathOf(params["*"]));
        if (at.is !== "file") throw new RouteError(404, `The tree has no file ${at.path}.`);
        const file = { path: at.path, level: at.level, kind: at.kind, editable: userMayWrite(at.level, at.rest, at.kind) };
        if (query.offset !== undefined) {
          if (query.length === undefined) throw new RouteError(400, "A read by bytes names `offset` and `length`.");
          const part = await readBytes(at.disk, query.offset, query.length);
          return { ...file, bytes: part.bytes, text: part.text, lines: part.lines, from: part.offset, to: part.offset + part.length, more: part.offset + part.length < part.bytes };
        }
        const part = await readLines(at.disk, query.line ?? 1, query.lines ?? (await treeSettingsOf(loc)).readLines);
        return { ...file, bytes: part.bytes, text: part.text, lines: part.lines, from: part.from, to: part.to, more: part.to < part.lines };
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
        const loc = await own.locationFor(user, chat);
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
        const loc = await own.locationFor(user, chat);
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
        const loc = await own.locationFor(user, chat);
        const path = viewPathOf(params["*"]);
        const listed = await kit.entryOf(user, loc, (await own.found(loc, path)).path);
        if (listed === null) throw new RouteError(404, `The tree has no file ${path}.`);
        if (listed.item === null) throw new RouteError(400, `${listed.path} is not a file RPH takes by its name, so no \`off:\` list can name it.`);
        await own.switchOff(loc, level, listed.item, body.off);
        return { file: await kit.entryOf(user, loc, listed.path) };
      },
    }),
    route({
      method: "PUT",
      path: PIN_PATH,
      access: "page",
      group: "files",
      does: "Pins a file for an agent, or takes the pin away, in the `pins:` list of a level's config (the global level's, or a chat's): the agent is handed the file whole at the start of each of its runs. A path the view does not hold is refused; says the file as the listing now shows it.",
      body: filePinBody,
      reply: fileWrittenReply,
      handle: async ({ user, params, body }) => {
        const chat = chatOf(body.chat);
        const level = levelOf(body.level, OFF_LEVELS, chat);
        const loc = await own.locationFor(user, chat);
        const path = await own.pin(loc, level, viewPathOf(params["*"]), body.agent, body.pinned);
        return { file: await kit.entryOf(user, loc, path) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/files-pins",
      access: "page",
      group: "files",
      does: "Every pin the levels' configs hold for a chat (with no chat, the global level's), with whether its file is in the view and whether a definition names its agent: a pin of a file that is gone or of an agent no definition names is listed as such, never dropped.",
      query: { chat: chatQuery },
      reply: pinsReply,
      handle: async ({ user, query }) => {
        const chat = chatOf(query.chat);
        const loc = own.locationOf(user, chat);
        const [names, definitions] = await Promise.all([namesInForce(loc), deps.guidance(user, chat).definitions()]);
        const named = new Set(definitions.map((d) => d.name));
        return {
          pins: await Promise.all(
            names.pins.map(async (p) => {
              const found = await locate(loc, p.file);
              return { file: p.file, agent: p.agent, level: p.level, fileFound: found.ok && found.at.is === "file", agentNamed: named.has(p.agent) };
            }),
          ),
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/files-apply",
      access: "page",
      group: "files",
      does: "\"Apply now\": starts the opening block of the chat's open session afresh from the files as they stand, there and then (the next run of each agent makes it); says which session, or that none is open and the next one opens with the files as they stand. Nothing else carries it.",
      body: applyBody,
      reply: applyReply,
      handle: async ({ user, body }) => {
        const { session } = await deps.apply(user, body.chat);
        return { session, note: session === null ? "No session of this chat is open, so the next one opens with the files as they stand." : `The opening block of session ${session} starts afresh with the next run of each agent, from the files as they stand.` };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/files-folder",
      access: "page",
      group: "files",
      does: "Makes a folder of the user's, and the folders above it, at a path of a chat's view (a never-played chat is placed first); never a shipped one, or one RPE makes again.",
      body: folderBody,
      reply: folderMadeReply,
      handle: async ({ user, body }) => {
        const loc = await own.locationFor(user, chatOf(body.chat));
        return { path: (await own.makeFolder(loc, viewPathOf(body.path))).path };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/files-move",
      access: "page",
      group: "files",
      does: "Renames or moves a file or folder of the user's to a path nothing stands at; a file moved into a folder of guidance is a file of that kind, which the answer says. Never a shipped file or one RPE makes again.",
      body: fileMoveBody,
      reply: fileMovedReply,
      handle: async ({ user, body }) => {
        const loc = await own.locationFor(user, chatOf(body.chat));
        const { at, guidance } = await own.relocate(user, loc, viewPathOf(body.from), viewPathOf(body.to), false);
        return { path: at.path, file: await kit.entryOf(user, loc, at.path), guidance };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/files-copy",
      access: "page",
      group: "files",
      does: "Copies a file or folder of the user's to a path nothing stands at (the copy of a folder leaves its links out); a file copied into a folder of guidance is a file of that kind, which the answer says. Never a shipped file or one RPE makes again.",
      body: fileMoveBody,
      reply: fileMovedReply,
      handle: async ({ user, body }) => {
        const loc = await own.locationFor(user, chatOf(body.chat));
        const { at, guidance } = await own.relocate(user, loc, viewPathOf(body.from), viewPathOf(body.to), true);
        return { path: at.path, file: await kit.entryOf(user, loc, at.path), guidance };
      },
    }),
  ] as const;
}
