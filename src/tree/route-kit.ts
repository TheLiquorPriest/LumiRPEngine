// What the tree's route groups share (plan §14, the Files and Storage pages): the dependencies the area hands
// them, the chat's view of the tree for a user, and the checks every route puts on what a page names: a
// path of the view, a chat, a level.

import type { Database } from "bun:sqlite";
import type { JsonObject, LayerLevel, PartPreview, StackPart } from "rp-harness/contract";
import { RouteError } from "../app";
import { entryAt, listingContext, type TreeFileEntry, treeListing } from "./catalog";
import type { ChatFolders, TreeChats, TreeWrites } from "./chats";
import { defaultStanding } from "./defaults";
import { OwnFiles } from "./own-files";
import type { ChatMeasurer } from "./storage";
import type { GuidanceReads } from "./standing";
import type { TreeSuggestions } from "./suggestions";
import { type ChatLocation, locate } from "./view";

/** An owner's means of letting go of a living chat's derived rows (its snapshots, search vectors, caches): what it keeps and its own way of dropping it, to be made again when next needed. */
export interface DerivedMeans {
  /** What the Storage page calls it. */
  name: string;
  /** The tables of RPE's database it keeps, which the dry run counts. */
  keeps: readonly string[];
  /** What it keeps outside RPE's database (the vectors of search by meaning are in the index file), which the dry run counts with the tables'. */
  held?(user: string, chat: string): Promise<{ rows: number; bytes: number }>;
  /** Drops the chat's, its own way; nothing it is is lost, and every answer after is the same. */
  drop(user: string, chat: string): Promise<void>;
}

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
  /** The exact stack an agent gets in the chat and where each part comes from, as the harness's definitions give it (§5.2); with no chat, the one the shipped and global levels give. */
  stack(user: string, chat: string | null, agent: string): Promise<StackPart[]>;
  /**
   * A prompt part or a tool's description as RPH renders it for the chat (`Harness.parts`): the one in force, or `text` as drafted, filled
   * with the values of its last use in the chat; with those values (null before it was ever used there). Nothing is written.
   */
  preview(user: string, chat: string | null, kind: "prompt" | "tool", name: string, text?: string): Promise<{ part: PartPreview; values: JsonObject | null }>;
  /** "Apply now" (R-119): starts the open session's opening block afresh from the files as they stand; says which session that was, none when the chat has no session open. */
  apply(user: string, chat: string): Promise<{ session: string | null }>;
  /** Places a chat RPE has not played yet, by Lumiverse's own names for it and its character, as its first turn places it; absent where RPE cannot. */
  place?(user: string, chat: string): Promise<ChatFolders>;
  /** What RPH makes of the files of the chat's view: what it holds out, what it found wrong, whose stacks they join; with no chat, of the shipped and global levels. */
  guidance(user: string, chat: string | null): GuidanceReads;
  /** The data folder's backups: the migration's, the copies of the database taken before migrations, the archives `rpe backup` made. */
  backups: string;
  /** How many of those copies are kept (`database.copiesKept`). */
  copiesKept: number;
  /** The ids of the chat's sessions that are open now: a prune leaves their files. */
  openSessions(user: string, chat: string): Promise<string[]>;
  /** The owners' means of dropping a living chat's derived rows; none given, there is nothing to drop. */
  derived?: readonly DerivedMeans[];
  /** The store's own removal of a deleted chat's turns, changes and snapshots (which keeps them while a branch reads them: `kept`), before the rest of its rows go. */
  dropStored?(user: string, chat: string): Promise<{ kept: boolean }>;
  /** Told once after each file of the user's lands through a Files route (a save, a reset, a delete, a rename, a move, a copy, a switch-off, a pin, a suggestion accepted): the chat (none for the shared levels), its path and the level; never for a refused write. */
  written?(saved: { user: string; chat: string | null; path: string; level: LayerLevel }): Promise<void> | void;
  /** Measures chats' folders in the background and keeps what it finds: asked again for a chat after a prune. */
  measurer: ChatMeasurer;
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
  /** Tells `deps.written` that a file of the user's landed: called once by each route that writes, after the write, never for a refused one. */
  written(user: string, chat: string | null, path: string, level: LayerLevel): Promise<void>;
}

export function routeKit(deps: TreeRoutesDeps): RouteKit {
  const own = new OwnFiles({ files: deps.files, chats: deps.chats, writes: deps.writes, now: deps.now, ...(deps.place === undefined ? {} : { place: deps.place }) });
  const listingOf = (user: string, loc: ChatLocation): Promise<TreeFileEntry[]> => treeListing(loc, defaultStanding(deps.db, user));
  const entryOf = async (user: string, loc: ChatLocation, path: string): Promise<TreeFileEntry | null> => {
    const lookup = await locate(loc, path);
    if (!lookup.ok || lookup.at.is !== "file" || lookup.at.disk === null) return null;
    return await entryAt(await listingContext(loc, defaultStanding(deps.db, user)), lookup.at.level, lookup.at.rest, lookup.at.disk);
  };
  const written = async (user: string, chat: string | null, path: string, level: LayerLevel): Promise<void> => void (await deps.written?.({ user, chat, path, level }));
  return { deps, own, listingOf, entryOf, written };
}
