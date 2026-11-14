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

import type { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Layer, LayerLevel, StackPart } from "rp-harness/contract";
import { rawRoute, route, RouteError } from "../app";
import { readText, writeWhole } from "../app/disk";
import { withTopLevelKey, yamlMapping } from "../app/yaml";
import { isRecord } from "../shared/json";
import { kindAt, nameList, OFF_KEY, type TreeFileEntry, treeListing, userMayWrite, writtenItem } from "./catalog";
import type { TreeChats } from "./chats";
import { defaultChanges, type DiffLine, lineDiff } from "./defaults";
import { oneFileAtATime } from "./files";
import { pruneChat } from "./retention";
import { NOTE_LIST, noteFiles, treeStorage } from "./storage";
import { SUGGESTION_STATES, type TreeSuggestion, type TreeSuggestions } from "./suggestions";
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

/** A file the Files page reads. */
export interface TreeFileText {
  path: string;
  level: LayerLevel;
  kind: TreeFileEntry["kind"];
  bytes: number;
  editable: boolean;
  text: string;
}

/** A file's differences (plan §5.4 "Defaults"). */
export interface TreeFileDiff {
  path: string;
  /** The shipped file of the same name; null when there is none, or the file is the shipped one. */
  shipped: string | null;
  /** From the shipped file to this one, line by line; none without a shipped file. */
  lines: DiffLine[];
  /** The update that changed the shipped file since this one was last written: when, and from the shipped file before it to the shipped file now. */
  update: { at: number; lines: DiffLine[] } | null;
}

/** An agent's suggestion as the Files page shows it: with the difference from its file as it is now to the text proposed. */
export interface TreeSuggestionView extends TreeSuggestion {
  lines: DiffLine[];
}

/** The path in the chat's view that a file route names, its segments decoded: none may be empty, `.` or `..`, or hold a slash. */
function viewPathOf(request: Request, route: string): string {
  const before = route.split("/").length - 1;
  const names = new URL(request.url).pathname
    .split("/")
    .slice(before)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new RouteError(400, "A file's path is not written as a path.");
      }
    });
  if (names.length === 0 || names.some((n) => n === "" || n === "." || n === ".." || n.includes("/") || n.includes("\\"))) throw new RouteError(400, "A file is named by its path in the tree, and no path leaves it.");
  return names.join("/");
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    throw new RouteError(400, "The body is not JSON.");
  }
  if (!isRecord(body)) throw new RouteError(400, "The body is one JSON object.");
  return body;
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

  /** The listing of a chat's view, with what updates changed of the shipped files. */
  const listingOf = (loc: ChatLocation): Promise<TreeFileEntry[]> => treeListing(loc, defaultChanges(deps.db));

  /** The listing's entry of one path, as it stands. */
  const entryOf = async (loc: ChatLocation, path: string): Promise<TreeFileEntry | null> => (await listingOf(loc)).find((f) => f.path === path) ?? null;

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
    const lookup = await locate(locationOf(user, s.chat), s.path);
    const now = lookup.ok && lookup.at.is === "file" && lookup.at.disk !== null ? await readText(lookup.at.disk) : null;
    return { ...s, lines: lineDiff(now ?? "", s.text) };
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
      handle: ({ user }) => treeStorage(deps, user),
    }),
    route({
      method: "GET",
      path: "/api/v1/storage/notes",
      access: "page",
      handle: ({ user, query }) => {
        const chat = chatOf(query.get("chat"));
        if (chat === null) throw new RouteError(400, "Name the chat whose notes are listed, as `chat`.");
        const asked = query.get("limit");
        if (asked !== null && !/^\d+$/.test(asked)) throw new RouteError(400, "limit is a whole number.");
        return noteFiles(deps, locationOf(user, chat), user, chat, Math.min(asked === null ? NOTE_LIST.limit : Number(asked), NOTE_LIST.most));
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/files-stack",
      access: "page",
      handle: async ({ user, query }) => {
        const chat = chatOf(query.get("chat"));
        const agent = query.get("agent");
        if (chat === null || agent === null || agent === "") throw new RouteError(400, "Name the chat as `chat` and the agent's definition as `agent`.");
        return { agent, parts: await deps.stack(user, chat, agent) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/files-prune",
      access: "page",
      body: (value: unknown): { chat: string } => {
        const chat = isRecord(value) ? chatOf(value.chat) : null;
        if (chat === null) throw new RouteError(400, "Name the chat whose turn folders are pruned, as `chat`.");
        return { chat };
      },
      handle: async ({ user, body }) => {
        if (deps.turning(user, body.chat)) throw new RouteError(409, "A turn of this chat is going on: prune once it is over.");
        return { pruned: await pruneChat(deps, user, body.chat) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/suggestions",
      access: "page",
      handle: async ({ user, query }) => {
        const state = query.get("state");
        if (state !== null && !SUGGESTION_STATES.some((s) => s === state)) throw new RouteError(400, `state is one of ${SUGGESTION_STATES.join(", ")}.`);
        const listed = deps.suggestions.list(user, chatOf(query.get("chat")), SUGGESTION_STATES.find((s) => s === state));
        return { suggestions: await Promise.all(listed.map((s) => shownSuggestion(user, s))) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/suggestions/:id/accept",
      access: "page",
      body: (value: unknown): { text: string | null; level: unknown } => {
        if (!isRecord(value)) throw new RouteError(400, "The body is one JSON object: `{}` to accept the text as proposed.");
        if (value.text !== undefined && value.text !== null && typeof value.text !== "string") throw new RouteError(400, "`text`, where given, is the file's whole text as you accept it.");
        return { text: typeof value.text === "string" ? value.text : null, level: value.level };
      },
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
        return { suggestion: deps.suggestions.one(user, s.id), file: await entryOf(loc, written) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/suggestions/:id/dismiss",
      access: "page",
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
      handle: async ({ user, query }) => ({ files: await listingOf(locationOf(user, chatOf(query.get("chat")))) }),
    }),
    rawRoute({
      method: "GET",
      path: DIFF_PATH,
      access: "page",
      raw: async (request, { user }) => {
        const loc = locationOf(user, chatOf(new URL(request.url).searchParams.get("chat")));
        const at = await found(loc, viewPathOf(request, DIFF_PATH));
        const entry = await entryOf(loc, at.path);
        const text = entry === null ? null : await readText(at.disk);
        if (entry === null || text === null) throw new RouteError(404, `The tree has no file ${at.path}.`);
        const shipped = entry.shipped === null ? null : await readText((await found(loc, entry.shipped)).disk);
        const change = entry.shipped === null || entry.defaultChanged === null ? undefined : defaultChanges(deps.db).get(entry.shipped);
        const diff: TreeFileDiff = {
          path: entry.path,
          shipped: entry.shipped,
          lines: shipped === null ? [] : lineDiff(shipped, text),
          update: change === undefined || shipped === null ? null : { at: change.at, lines: lineDiff(change.before, shipped) },
        };
        return Response.json(diff, { headers: { "cache-control": "no-store" } });
      },
    }),
    rawRoute({
      method: "GET",
      path: FILE_PATH,
      access: "page",
      raw: async (request, { user }) => {
        const loc = locationOf(user, chatOf(new URL(request.url).searchParams.get("chat")));
        const at = await found(loc, viewPathOf(request, FILE_PATH));
        const text = at.is === "file" ? await readText(at.disk) : null;
        if (text === null) throw new RouteError(404, `The tree has no file ${at.path}.`);
        const file: TreeFileText = { path: at.path, level: at.level, kind: at.kind, bytes: Buffer.byteLength(text, "utf8"), editable: userMayWrite(at.level, at.rest, at.kind), text };
        return Response.json(file, { headers: { "cache-control": "no-store" } });
      },
    }),
    rawRoute({
      method: "PUT",
      path: FILE_PATH,
      access: "page",
      raw: async (request, { user }) => {
        const body = await bodyOf(request);
        if (typeof body.text !== "string") throw new RouteError(400, "`text` is the file's whole text.");
        const chat = chatOf(body.chat);
        const loc = locationOf(user, chat);
        const written = await writeAsUser(loc, viewPathOf(request, FILE_PATH), levelOf(body.level, LEVELS, chat), body.text);
        return Response.json({ file: await entryOf(loc, written) });
      },
    }),
    rawRoute({
      method: "DELETE",
      path: FILE_PATH,
      access: "page",
      raw: async (request, { user }) => {
        const loc = locationOf(user, chatOf(new URL(request.url).searchParams.get("chat")));
        const at = await found(loc, viewPathOf(request, FILE_PATH));
        if (at.is !== "file") throw new RouteError(404, `The tree has no file ${at.path}.`);
        if (!userMayWrite(at.level, at.rest, at.kind)) throw new RouteError(403, at.level === "shipped" ? "A shipped file is not removed: switch it off instead." : `${at.path} is not a file you remove: RPE makes it again.`);
        await oneFileAtATime(at.disk, () => rm(at.disk, { force: true }));
        return Response.json({ removed: at.path });
      },
    }),
    rawRoute({
      method: "PUT",
      path: OFF_PATH,
      access: "page",
      raw: async (request, { user }) => {
        const body = await bodyOf(request);
        if (typeof body.off !== "boolean") throw new RouteError(400, "`off` is true to switch the file off, false to switch it on again.");
        const off = body.off;
        const chat = chatOf(body.chat);
        const level = levelOf(body.level, OFF_LEVELS, chat);
        const loc = locationOf(user, chat);
        const path = viewPathOf(request, OFF_PATH);
        const listed = await entryOf(loc, (await found(loc, path)).path);
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
        return Response.json({ file: await entryOf(loc, listed.path) });
      },
    }),
  ] as const;
}
