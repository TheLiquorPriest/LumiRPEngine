// The Files page's routes (plan §5.1, §5.2, §5.4, §14): the tree's listing for a chat, or with no chat
// its shipped and global levels; one file read; the difference of a file from the shipped default of its
// name, and from the default before an update changed it to the default now; a file written as the
// user at a level, which for a file of another level is the user's own file of that name there, taken
// in place of the farther one; a file of the user's removed, which for one in place of a default is
// resetting to the default; a name switched off or on again in a level's config (`off:`), which is
// what "Delete" on a shipped file does; the agents' suggestions, each accepted as it is or edited
// (written as the user) or dismissed; a chat's turn folders pruned on request (`retention.ts`), never
// while one of its turns is going on; and for the Storage page, what the tree takes chat by chat and
// area by area, a chat's largest and most rewritten notes, and any agent's stack with where each part
// comes from. Every route is a page's: an agent has no way to them, and
// reaches the tree only through the file port, held to where it may write. Every path is a path of the
// chat's view, normalized and held inside the tree by the view (`locate`), links refused.
//
// The page's shape asked for switching off at `/api/v1/files/*/off`; the route table takes a `*` only as
// a path's last part, so it is `/api/v1/files-off/*`, and the difference is `/api/v1/files-diff/*`.
// Each route is declared in the route form with the shapes of `./shapes.ts`.

import type { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Layer, LayerLevel, StackPart } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import { readText, writeWhole } from "../app/disk";
import { withTopLevelKey, yamlMapping } from "../app/yaml";
import { kindAt, nameList, OFF_KEY, type TreeFileEntry, treeListing, userMayWrite, writtenItem } from "./catalog";
import type { TreeChats } from "./chats";
import { defaultChanges, lineDiff } from "./defaults";
import { oneFileAtATime } from "./files";
import { pruneChat } from "./retention";
import { treeSettingsOf } from "./settings";
import { noteFiles, treeStorage } from "./storage";
import { chatQuery, fileRemovedReply, fileSwitchBody, fileWriteBody, fileWrittenReply, notesReply, pruneBody, pruneReply, stackReply, storageReply, suggestionAcceptBody, suggestionAcceptedReply, suggestionDismissedReply, suggestionState, suggestionsReply, treeDiffReply, treeFileReply, treeListingReply, type TreeFileDiff, type TreeFileText, type TreeSuggestionView } from "./shapes";
import type { TreeSuggestion, TreeSuggestions } from "./suggestions";
import { type ChatLocation, type Located, locate, treeLayers, viewPath } from "./view";

export interface TreeRoutesDeps {
  /** The tree's folder: the global level. */
  files: string;
  chats: TreeChats;
  /** RPE's database: what updates changed of the shipped files, what agents wrote, and its own size. */
  db: Database;
  suggestions: TreeSuggestions;
  /** Whether a turn of the chat is going on now: its turn folders are not pruned while one is. */
  turning(user: string, chat: string): boolean;
  /** The exact stack an agent gets in the chat and where each part comes from, as the harness's definitions give it (§5.2). */
  stack(user: string, chat: string, agent: string): Promise<StackPart[]>;
}

/** The routes that name a file: its path in the chat's view follows the route's own segments. */
const FILE_PATH = "/api/v1/files/*";
const OFF_PATH = "/api/v1/files-off/*";
const DIFF_PATH = "/api/v1/files-diff/*";

/** The levels a config's `off:` list is written at (plan §5.2: `RPE-global.yml` or the chat's `RPE.yml`). */
const OFF_LEVELS: readonly LayerLevel[] = ["global", "chat"];
const LEVELS: readonly LayerLevel[] = ["shipped", "global", "character", "chat"];

/** The path in the chat's view that a file route names, its segments as the server decoded them: none may be empty, `.` or `..`, or hold a backslash. */
function viewPathOf(rest: string): string {
  const names = rest.split("/");
  if (names.length === 0 || names.some((n) => n === "" || n === "." || n === ".." || n.includes("\\"))) throw new RouteError(400, "A file is named by its path in the tree, and no path leaves it.");
  return names.join("/");
}

function chatOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new RouteError(400, "`chat`, where given, is a chat's id.");
  return value;
}

function levelOf(value: unknown, allowed: readonly LayerLevel[], chat: string | null): LayerLevel {
  const level = allowed.find((l) => l === value);
  if (level === undefined) throw new RouteError(400, `\`level\` is one of ${allowed.join(", ")}.`);
  if ((level === "character" || level === "chat") && chat === null) throw new RouteError(400, `A file at the ${level} level is a chat's: name the chat as \`chat\`.`);
  return level;
}

function layerOf(level: LayerLevel): Layer {
  const layer = treeLayers().find((l) => l.level === level);
  if (layer === undefined) throw new Error(`The tree has no ${level} level.`);
  return layer;
}

/**
 * Where a file found at one level goes at another, by what it is there: a level's config is the other
 * level's config, a file in a folder of guidance goes in that level's folder of the same kind, a file at
 * a level's top goes at the other's top. Anything else is its own level's alone. Null: the other level
 * has no such place.
 */
function placeAt(from: Located, to: LayerLevel): string[] | null {
  if (from.level === to) return from.rest;
  const [first, ...below] = from.rest;
  const source = layerOf(from.level);
  const target = layerOf(to);
  if (from.rest.length === 1 && first === source.config) return target.config === undefined ? null : [target.config];
  const kind = kindAt(source, first);
  if (kind !== undefined && below.length > 0) {
    const folder = target.folders[kind];
    return folder === undefined ? null : [folder, ...below];
  }
  return from.rest.length === 1 ? from.rest : null;
}

export function treeRoutes(deps: TreeRoutesDeps) {
  /** The chat's view of the tree, for the user; with no chat, the shipped and global levels alone. */
  const locationOf = (user: string, chat: string | null): ChatLocation => {
    const folders = chat === null ? null : deps.chats.folders(user, chat);
    return { files: deps.files, character: folders?.character ?? null, chat: folders?.chat ?? null };
  };

  /** A path of the view, found; a 400 for one that is not a path, a 404 for one the view does not hold. */
  const found = async (loc: ChatLocation, path: string): Promise<Located & { disk: string }> => {
    const lookup = await locate(loc, path);
    if (!lookup.ok) throw new RouteError(lookup.reason === "invalid" ? 400 : 404, `The tree has no file ${path} that a page can reach.`);
    if (lookup.at.disk === null) throw new RouteError(404, `RPE has not played this chat yet, so it has no folder for ${lookup.at.path}.`);
    return { ...lookup.at, disk: lookup.at.disk };
  };

  /** The listing of a chat's view, with what updates changed of the shipped files, as kept for `user`. */
  const listingOf = (user: string, loc: ChatLocation): Promise<TreeFileEntry[]> => treeListing(loc, defaultChanges(deps.db, user));

  /** The listing's entry of one path, as it stands. */
  const entryOf = async (user: string, loc: ChatLocation, path: string): Promise<TreeFileEntry | null> => (await listingOf(user, loc)).find((f) => f.path === path) ?? null;

  /** Writes `text` as the user at `level`, for the file at `path`: there itself, or the user's own file of its name at that level. The path written. */
  const writeAsUser = async (loc: ChatLocation, path: string, level: LayerLevel, text: string): Promise<string> => {
    const from = await found(loc, path);
    const place = placeAt(from, level);
    if (place === null) throw new RouteError(400, `The ${level} level has no place for ${from.path}.`);
    const at = await found(loc, viewPath(level, place));
    if (at.is === "folder") throw new RouteError(409, `${at.path} is a folder.`);
    if (!userMayWrite(at.level, at.rest, at.kind)) throw new RouteError(403, at.level === "shipped" ? "The shipped files are read-only: write your own at the global, character or chat level." : `${at.path} is not a file you write: RPE makes it again.`);
    await oneFileAtATime(at.disk, async () => {
      await mkdir(dirname(at.disk), { recursive: true });
      await writeWhole(at.disk, text);
    });
    return at.path;
  };

  /** A suggestion of the user's, as the page shows it: with the difference from its file as it is now to the text proposed. */
  const shownSuggestion = async (user: string, s: TreeSuggestion): Promise<TreeSuggestionView> => {
    const loc = locationOf(user, s.chat);
    const lookup = await locate(loc, s.path);
    const now = lookup.ok && lookup.at.is === "file" && lookup.at.disk !== null ? await readText(lookup.at.disk) : null;
    return { ...s, lines: lineDiff(now ?? "", s.text, (await treeSettingsOf(loc)).diffCells) };
  };

  /** An open suggestion of the user's; a 404 for none, a 409 for one decided already. */
  const openSuggestion = (user: string, id: string): TreeSuggestion => {
    const s = /^\d+$/.test(id) ? deps.suggestions.one(user, Number(id)) : null;
    if (s === null) throw new RouteError(404, `There is no suggestion ${id}.`);
    if (s.state !== "open") throw new RouteError(409, `Suggestion ${id} was ${s.state} already.`);
    return s;
  };

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
        const loc = locationOf(user, query.chat);
        const { notesListed, notesMost } = await treeSettingsOf(loc);
        return await noteFiles(deps, loc, user, query.chat, Math.min(query.limit ?? notesListed, notesMost));
      },
    }),
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
    route({
      method: "GET",
      path: "/api/v1/suggestions",
      access: "page",
      group: "files",
      does: "A chat's suggestions from the agents (every chat's when none is named), newest first, each with what it would change.",
      query: { chat: chatQuery, state: shape.optional(suggestionState, "Only the suggestions in this state.") },
      reply: suggestionsReply,
      handle: async ({ user, query }) => {
        const listed = deps.suggestions.list(user, chatOf(query.chat), query.state);
        return { suggestions: await Promise.all(listed.map((s) => shownSuggestion(user, s))) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/suggestions/:id/accept",
      access: "page",
      group: "files",
      does: "Accepts a suggestion as it is or edited, writing it as the user at a level; says the suggestion as it now stands and the file.",
      body: suggestionAcceptBody,
      reply: suggestionAcceptedReply,
      handle: async ({ user, params, body }) => {
        const s = openSuggestion(user, params.id);
        const loc = locationOf(user, s.chat);
        const own = (await found(loc, s.path)).level;
        if (body.level === undefined && own === "shipped") throw new RouteError(400, `${s.path} is a shipped file: name the level your own is written at, as \`level\`.`);
        const level = body.level === undefined ? own : levelOf(body.level, LEVELS, s.chat);
        if (!(await deps.suggestions.decide(user, s.id, "accepted"))) throw new RouteError(409, `Suggestion ${s.id} was decided already.`);
        let written: string;
        try {
          written = await writeAsUser(loc, s.path, level, body.text ?? s.text);
        } catch (error) {
          await deps.suggestions.reopen(user, s.id);
          throw error;
        }
        return { suggestion: deps.suggestions.one(user, s.id), file: await entryOf(user, loc, written) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/suggestions/:id/dismiss",
      access: "page",
      group: "files",
      does: "Dismisses a suggestion; says the suggestion as it now stands.",
      reply: suggestionDismissedReply,
      handle: async ({ user, params }) => {
        const s = openSuggestion(user, params.id);
        if (!(await deps.suggestions.decide(user, s.id, "dismissed"))) throw new RouteError(409, `Suggestion ${s.id} was decided already.`);
        return { suggestion: deps.suggestions.one(user, s.id) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/files",
      access: "page",
      group: "files",
      does: "Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own.",
      query: { chat: chatQuery },
      reply: treeListingReply,
      handle: async ({ user, query }) => ({ files: await listingOf(user, locationOf(user, chatOf(query.chat))) }),
    }),
    route({
      method: "GET",
      path: DIFF_PATH,
      access: "page",
      group: "files",
      does: "A file's difference from the shipped file of its name, and what the update that changed the shipped file since it was written changed of it.",
      query: { chat: chatQuery },
      reply: treeDiffReply,
      handle: async ({ user, params, query }) => {
        const loc = locationOf(user, chatOf(query.chat));
        const at = await found(loc, viewPathOf(params["*"]));
        const entry = await entryOf(user, loc, at.path);
        const text = entry === null ? null : await readText(at.disk);
        if (entry === null || text === null) throw new RouteError(404, `The tree has no file ${at.path}.`);
        const shipped = entry.shipped === null ? null : await readText((await found(loc, entry.shipped)).disk);
        const change = entry.shipped === null || entry.defaultChanged === null ? undefined : defaultChanges(deps.db, user).get(entry.shipped);
        const { diffCells } = await treeSettingsOf(loc);
        const diff: TreeFileDiff = {
          path: entry.path,
          shipped: entry.shipped,
          lines: shipped === null ? [] : lineDiff(shipped, text, diffCells),
          update: change === undefined || shipped === null ? null : { at: change.at, lines: lineDiff(change.before, shipped, diffCells) },
        };
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
        const loc = locationOf(user, chatOf(query.chat));
        const at = await found(loc, viewPathOf(params["*"]));
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
        const loc = locationOf(user, chat);
        const written = await writeAsUser(loc, viewPathOf(params["*"]), levelOf(body.level, LEVELS, chat), body.text);
        return { file: await entryOf(user, loc, written) };
      },
    }),
    route({
      method: "DELETE",
      path: FILE_PATH,
      access: "page",
      group: "files",
      does: "Removes a file of the user's; for one in place of a default, that is resetting to the default.",
      query: { chat: chatQuery },
      reply: fileRemovedReply,
      handle: async ({ user, params, query }) => {
        const loc = locationOf(user, chatOf(query.chat));
        const at = await found(loc, viewPathOf(params["*"]));
        if (at.is !== "file") throw new RouteError(404, `The tree has no file ${at.path}.`);
        if (!userMayWrite(at.level, at.rest, at.kind)) throw new RouteError(403, at.level === "shipped" ? "A shipped file is not removed: switch it off instead." : `${at.path} is not a file you remove: RPE makes it again.`);
        await oneFileAtATime(at.disk, () => rm(at.disk, { force: true }));
        return { removed: at.path };
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
        const off = body.off;
        const chat = chatOf(body.chat);
        const level = levelOf(body.level, OFF_LEVELS, chat);
        const loc = locationOf(user, chat);
        const path = viewPathOf(params["*"]);
        const listed = await entryOf(user, loc, (await found(loc, path)).path);
        if (listed === null) throw new RouteError(404, `The tree has no file ${path}.`);
        if (listed.item === null) throw new RouteError(400, `${listed.path} is not a file RPH takes by its name, so no \`off:\` list can name it.`);
        const item = listed.item;
        const layers = treeLayers();
        const config = await found(loc, viewPath(level, [layerOf(level).config ?? ""]));
        if (config.is === "folder") throw new RouteError(409, `${config.path} is a folder.`);
        await oneFileAtATime(config.disk, async () => {
          const text = (await readText(config.disk)) ?? "";
          let read: string[] | undefined;
          try {
            read = nameList(yamlMapping(text, config.path)[OFF_KEY]);
          } catch (error) {
            throw new RouteError(409, error instanceof Error ? error.message : String(error));
          }
          if (read === undefined) throw new RouteError(409, `\`${OFF_KEY}:\` in ${config.path} is not a list of names: make it one, then try again.`);
          const names = read;
          const kept = names.filter((n) => writtenItem(n, layers) !== item);
          const next = off ? [...kept, item] : kept;
          if (next.length === names.length && next.every((n, i) => n === names[i])) return;
          await mkdir(dirname(config.disk), { recursive: true });
          await writeWhole(config.disk, withTopLevelKey(text, OFF_KEY, next, config.path));
        });
        return { file: await entryOf(user, loc, listed.path) };
      },
    }),
  ] as const;
}
