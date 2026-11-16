// The session's cache (plan §11, §5.1 "a session's cache/"): what an agent has already looked up in a scene stays in
// `sessions/<session>/cache/`, beside what RPH keeps there, and is read from it by the next turn of the scene instead
// of asked for again. RPE's own files in it are each on-stage character's base view and the drawn layer of the scene's
// map, each named by what it is drawn from (the character and the revision of its base; the map and the revision of its
// drawn layer). A file is written only where none of that name is, so a scene writes each once, and again only when
// the base or the layer changes (a new revision, a new name); a turn on any path, a swipe's included, finds the file
// that holds for it by its name, with nothing to put back. The cache is the session's, so a branch's fork of it is
// RPH's copy.
//
// Which files hold for a turn, and the text of each, is the caller's to say (the cast and the map are not the tree's);
// this writes them and lists them, for the host's briefing block that names them.

import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { oneFileAtATime, readText, writeWhole } from "../app/disk";
import type { TreeChats } from "./chats";
import { CHATS_FOLDER, SESSIONS_FOLDER } from "./layout";

/** What RPE keeps in the cache: a character's base view, the scene map's drawn layer. */
export type CacheKind = "base" | "map";

export interface SessionCacheDeps {
  /** The tree's folder: the global level. */
  files: string;
  chats: TreeChats;
}

/** What keeping a file came to: written now, there already, or no folder for the chat yet. */
export type CacheKept = "written" | "present" | "unplaced";

const CACHE_FOLDER = "cache";
const KINDS: readonly CacheKind[] = ["base", "map"];

/** A name's part safe to put in a file name: letters, digits, dot, dash and underline, the rest a dash. */
const part = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";

/** The file a view or layer is kept in: its kind, what it is drawn from (a character's id, the map's id) and the revision of that. */
export function cacheFileName(kind: CacheKind, of: string, revision: string): string {
  return `${kind}-${part(of)}-${part(revision)}.md`;
}

export class SessionCache {
  readonly #d: SessionCacheDeps;

  constructor(deps: SessionCacheDeps) {
    this.#d = deps;
  }

  #folder(user: string, chat: string, session: string): string | null {
    const folders = this.#d.chats.folders(user, chat);
    return folders === null ? null : join(this.#d.files, CHATS_FOLDER, folders.character, folders.chat, SESSIONS_FOLDER, session, CACHE_FOLDER);
  }

  /** Keeps `text` in the session's cache as `name`, unless a file of that name is there: the name says what it is drawn from, so one there holds. */
  async keep(user: string, chat: string, session: string, name: string, text: string): Promise<CacheKept> {
    const folder = this.#folder(user, chat, session);
    if (folder === null) return "unplaced";
    const disk = join(folder, name);
    return await oneFileAtATime(disk, async () => {
      if ((await readText(disk)) !== null) return "present";
      await mkdir(dirname(disk), { recursive: true });
      await writeWhole(disk, text);
      return "written";
    });
  }

  /** The files of RPE's the session's cache holds, by name, as `kind` is when given. */
  async held(user: string, chat: string, session: string, kind?: CacheKind): Promise<string[]> {
    const folder = this.#folder(user, chat, session);
    if (folder === null) return [];
    const names = await readdir(folder).catch(() => [] as string[]);
    return names.filter((n) => (kind === undefined ? KINDS : [kind]).some((k) => n.startsWith(`${k}-`)) && n.endsWith(".md")).sort();
  }
}
