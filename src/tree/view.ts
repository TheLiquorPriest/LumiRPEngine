// The agents' view of RPE's tree (plan §5, §5.1): a chat's folder as the root, the shipped, global and
// character levels mounted read-only, the three kinds of file, and where each writer may write. Every
// path is normalized here before anything acts on it; one that leaves the view or passes through a
// link is refused.
//
// What a mounted level leaves out of the view (the global level's `chats/` and `defaults/`; a character
// level's chats) is told by what a folder is on disk, never by how a path spells it: on a disk that
// folds case or Unicode, `@global/CHATS` or a name with a letter that folds to `s` reaches the same
// folder as `chats`, so the first folder below a mount is compared with the hidden ones by its device
// and inode.

import { lstat, readdir } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { join } from "node:path";
import type { FileKind, Layer, LayerLevel, Places, RefusalReason, Scope, Writer } from "rp-harness/contract";
import { CHARACTER_FOLDERS, CHAT_CONFIG, CHAT_FOLDERS, CHATS_FOLDER, GENERATED_FILES, GLOBAL_CONFIG, GLOBAL_FOLDERS, MOUNTS, NOTES_FOLDER, SESSIONS_FOLDER, SHIPPED_FOLDER, TURN_WRITABLE, TURNS_FOLDER } from "./layout";

/** The levels, farthest first, as every chat has them. */
export function treeLayers(): Layer[] {
  return [
    { level: "shipped", mount: MOUNTS.shipped, folders: { ...GLOBAL_FOLDERS }, config: GLOBAL_CONFIG },
    { level: "global", mount: MOUNTS.global, folders: { ...GLOBAL_FOLDERS }, config: GLOBAL_CONFIG },
    { level: "character", mount: MOUNTS.character, folders: { ...CHARACTER_FOLDERS } },
    { level: "chat", mount: "", folders: { ...CHAT_FOLDERS }, config: CHAT_CONFIG },
  ];
}

/** An id that names a folder (a session's, a turn's): letters, digits, `_` and `-`, so it can reach nowhere else. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function safeId(what: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`A ${what} id must be letters, digits, "_" and "-", at most 128: ${JSON.stringify(id)}.`);
  return id;
}

/** A scope's places, its turn's folder named `turnFolder`. */
export function placesOf(scope: Scope, turnFolder: string | null): Places {
  const notes = `${NOTES_FOLDER}/`;
  const session = `${SESSIONS_FOLDER}/${safeId("session", scope.session)}/`;
  if (scope.turn === undefined || turnFolder === null) return { notes, session, writable: [notes] };
  const turn = `${session}${TURNS_FOLDER}/${turnFolder}/`;
  return { notes, session, turn, writable: [notes, ...TURN_WRITABLE.map((f) => `${turn}${f}/`)] };
}

/** Where a writer may write: its places, and for RPH itself the session's folder too (`Writer`). */
export function writableFor(places: Places, writer: Writer): string[] {
  return writer === "harness" ? [...places.writable, places.session] : places.writable;
}

/** Where a chat's levels are on disk: the tree's folder, and the chat's character folder and its own folder; null for a chat not placed yet, whose two levels hold nothing. */
export interface ChatLocation {
  files: string;
  character: string | null;
  chat: string | null;
}

/** A path in the view, found. */
export interface Located {
  /** The path as normalized, in the agents' view. */
  path: string;
  level: LayerLevel;
  /** Its segments below its level's folder. */
  rest: string[];
  /** Where it is on disk; null for a level of a chat not placed yet. */
  disk: string | null;
  kind: FileKind;
  is: "file" | "folder" | "none";
}

export type Lookup = { ok: true; at: Located } | { ok: false; path: string; reason: RefusalReason };

/** A file's kind by its level and its segments below the level's folder (plan §5.1). */
export function kindOf(level: LayerLevel, rest: readonly string[]): FileKind {
  if (level !== "chat") return "yours";
  if (rest[0] === NOTES_FOLDER) return "notes";
  if (rest[0] === SESSIONS_FOLDER) return "generated";
  if (rest.length === 1 && rest[0] !== undefined && GENERATED_FILES.includes(rest[0])) return "generated";
  return "yours";
}

export function viewPath(level: LayerLevel, rest: readonly string[]): string {
  return level === "chat" ? rest.join("/") : `${MOUNTS[level]}${rest.join("/")}`;
}

/** The segments from the tree's folder down to a level's own folder; null for a level of a chat not placed. */
export function levelBase(loc: ChatLocation, level: LayerLevel): string[] | null {
  if (level === "shipped") return [SHIPPED_FOLDER];
  if (level === "global") return [];
  if (loc.character === null) return null;
  if (level === "character") return [CHATS_FOLDER, loc.character];
  return loc.chat === null ? null : [CHATS_FOLDER, loc.character, loc.chat];
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

async function stat(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * What decides whether an entry right under a mounted level's folder is in the view, by what it is on
 * disk: the global level hides the folder of the chats and the shipped level's; a character level shows
 * its files and its three guidance folders, never its chats. Null: everything there is in the view.
 */
export async function topRule(loc: ChatLocation, level: LayerLevel): Promise<((entry: BigIntStats) => boolean) | null> {
  if (level === "global") {
    const hidden = (await Promise.all([stat(join(loc.files, CHATS_FOLDER)), stat(join(loc.files, SHIPPED_FOLDER))])).filter((s): s is BigIntStats => s !== null);
    return (entry) => !hidden.some((h) => same(h, entry));
  }
  if (level === "character") {
    const base = levelBase(loc, level);
    if (base === null) return () => false;
    const folder = join(loc.files, ...base);
    const shown = (await Promise.all(Object.values(CHARACTER_FOLDERS).map((name) => stat(join(folder, name))))).filter((s): s is BigIntStats => s !== null && s.isDirectory());
    return (entry) => !entry.isDirectory() || shown.some((s) => same(s, entry));
  }
  return null;
}

/**
 * Finds a path of the view. Refused: `invalid` (a NUL, a backslash), `outside` (above the root, or into
 * what a mounted level leaves out), `link` (any part of it on disk, from the tree's folder down, is a
 * link).
 */
export async function locate(loc: ChatLocation, path: string): Promise<Lookup> {
  if (path.includes("\0") || path.includes("\\")) return { ok: false, path, reason: "invalid" };
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.pop() === undefined) return { ok: false, path, reason: "outside" };
      continue;
    }
    segments.push(part);
  }
  const first = segments[0];
  const level: LayerLevel = first === "@global" ? "global" : first === "@character" ? "character" : first === "@shipped" ? "shipped" : "chat";
  const rest = level === "chat" ? segments : segments.slice(1);
  const normalized = viewPath(level, rest);
  const kind = kindOf(level, rest);
  const base = levelBase(loc, level);
  if (base === null) return { ok: true, at: { path: normalized, level, rest, disk: null, kind, is: "none" } };
  const disk = join(loc.files, ...base, ...rest);

  // Links are not followed (§5.1): every part that exists, from the tree's folder down, is looked at itself.
  let is: Located["is"] = "folder";
  const top = rest.length > 0 ? await topRule(loc, level) : null;
  const parts = [...base, ...rest];
  for (let i = 1; i <= parts.length; i++) {
    const found = await stat(join(loc.files, ...parts.slice(0, i)));
    if (found === null) {
      is = "none";
      break;
    }
    if (found.isSymbolicLink()) return { ok: false, path: normalized, reason: "link" };
    if (i === base.length + 1 && top !== null && !top(found)) return { ok: false, path: normalized, reason: "outside" };
    if (!found.isDirectory()) {
      is = i === parts.length && found.isFile() ? "file" : "none";
      break;
    }
  }
  return { ok: true, at: { path: normalized, level, rest, disk, kind, is } };
}

/** The entries of a folder in the view, by name, links and anything but files and folders left out; at a mounted level's top, only what is part of the view. */
export async function entriesOf(loc: ChatLocation, level: LayerLevel, rest: readonly string[], disk: string): Promise<{ name: string; folder: boolean }[]> {
  let found;
  try {
    found = await readdir(disk, { withFileTypes: true });
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
  const plain = found.filter((d) => !d.isSymbolicLink() && (d.isDirectory() || d.isFile()));
  const top = rest.length === 0 ? await topRule(loc, level) : null;
  if (top === null) return plain.map((d) => ({ name: d.name, folder: d.isDirectory() }));
  const kept: { name: string; folder: boolean }[] = [];
  for (const d of plain) {
    const entry = await stat(join(disk, d.name));
    if (entry !== null && !entry.isSymbolicLink() && top(entry)) kept.push({ name: d.name, folder: d.isDirectory() });
  }
  return kept;
}

/**
 * Why a writer may not write at a path, or undefined when it may: only inside one of its writable
 * folders (§5.1). A mounted level is no one's to write through the port; a generated file outside the
 * writer's folders is refused as generated; everything else outside them is the user's.
 */
export function refusalFor(at: Located, writable: readonly string[]): RefusalReason | undefined {
  if (at.level !== "chat") return "mounted";
  if (writable.some((w) => at.path.startsWith(w) && at.path.length > w.length)) return undefined;
  return at.kind === "generated" ? "generated" : "yours";
}
