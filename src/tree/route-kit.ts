// What the tree's route groups share (plan §14, the Files and Storage pages): the dependencies the area hands
// them, the chat's view of the tree for a user, and the checks every route puts on what a page names: a
// path of the view, a chat, a level.

import type { Database } from "bun:sqlite";
import type { LayerLevel, StackPart } from "rp-harness/contract";
import { RouteError } from "../app";
import { type TreeFileEntry, treeListing } from "./catalog";
import type { TreeChats, TreeWrites } from "./chats";
import { defaultStanding } from "./defaults";
import { type FoundFile, OwnFiles } from "./own-files";
import type { TreeSuggestions } from "./suggestions";
import type { ChatLocation } from "./view";

export interface TreeRoutesDeps {
  /** The tree's folder: the global level. */
  files: string;
  chats: TreeChats;
  /** RPE's database: what updates changed of the shipped files, what agents wrote, and its own size. */
  db: Database;
  /** How RPE's database takes a write: the application's write queue. */
  writes: TreeWrites;
  now(): number;
  suggestions: TreeSuggestions;
  /** Whether a turn of the chat is going on now: its turn folders are not pruned while one is. */
  turning(user: string, chat: string): boolean;
  /** The exact stack an agent gets in the chat and where each part comes from, as the harness's definitions give it (§5.2). */
  stack(user: string, chat: string, agent: string): Promise<StackPart[]>;
}

/** The levels a file may be written at (plan §5): every level but the shipped one's is the user's. */
export const LEVELS: readonly LayerLevel[] = ["shipped", "global", "character", "chat"];

/** The path in the chat's view that a file route names, its segments as the server decoded them: none may be empty, `.` or `..`, or hold a backslash. */
export function viewPathOf(rest: string): string {
  const names = rest.split("/");
  if (names.length === 0 || names.some((n) => n === "" || n === "." || n === ".." || n.includes("\\"))) throw new RouteError(400, "A file is named by its path in the tree, and no path leaves it.");
  return names.join("/");
}

export function chatOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new RouteError(400, "`chat`, where given, is a chat's id.");
  return value;
}

export function levelOf(value: unknown, allowed: readonly LayerLevel[], chat: string | null): LayerLevel {
  const level = allowed.find((l) => l === value);
  if (level === undefined) throw new RouteError(400, `\`level\` is one of ${allowed.join(", ")}.`);
  if ((level === "character" || level === "chat") && chat === null) throw new RouteError(400, `A file at the ${level} level is a chat's: name the chat as \`chat\`.`);
  return level;
}

/** What each route group reads and writes through: the user's own files (which find a path of a chat's view and write at a level), and the listing of a chat's view. */
export interface RouteKit {
  deps: TreeRoutesDeps;
  own: OwnFiles;
  /** The listing of a chat's view, with what updates changed of the shipped files and when the user wrote their own, as kept for `user`. */
  listingOf(user: string, loc: ChatLocation): Promise<TreeFileEntry[]>;
  /** The listing's entry of one path, as it stands. */
  entryOf(user: string, loc: ChatLocation, path: string): Promise<TreeFileEntry | null>;
}

export function routeKit(deps: TreeRoutesDeps): RouteKit {
  const own = new OwnFiles({ files: deps.files, chats: deps.chats, writes: deps.writes, now: deps.now });
  const listingOf = (user: string, loc: ChatLocation): Promise<TreeFileEntry[]> => treeListing(loc, defaultStanding(deps.db, user));
  return { deps, own, listingOf, entryOf: async (user, loc, path) => (await listingOf(user, loc)).find((f) => f.path === path) ?? null };
}
