// What the Storage page shows of the tree (plan §5.1, §5.5, §14): what each chat's folder takes, by area
// (its notes, its turn folders, its sessions' own files, and the rest of the chat's files), what the
// user's level and the shipped level take, and the database's file; and, of a chat's notes, the files
// that are largest and those agents rewrote most often, so the user can see where agents lean on notes
// because a system is missing. It measures; it decides nothing.

import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "./files";
import { NOTES_FOLDER, SESSIONS_FOLDER, TURNS_FOLDER } from "./layout";
import { type ChatLocation, type Located, locate } from "./view";

export interface ChatStorage {
  chat: string;
  /** Its folder below the tree's `chats/`. */
  folder: string;
  bytes: number;
  areas: { notes: number; turns: number; sessions: number; files: number };
}

export interface TreeStorage {
  chats: ChatStorage[];
  /** The user's own level, the chats' folders and the shipped level apart. */
  global: number;
  shipped: number;
  /** RPE's database file, with its write-ahead log. */
  database: number;
}

export interface NoteFile {
  /** Its path in the chat's view. */
  path: string;
  /** Its size now; 0 for a file no longer there. */
  bytes: number;
  /** How many times agents wrote it in turns. */
  writes: number;
}

export interface NoteFiles {
  largest: NoteFile[];
  rewritten: NoteFile[];
}

export interface StorageDeps {
  files: string;
  db: Database;
}

async function sizeOf(path: string): Promise<number> {
  return await stat(path).then(
    (s) => s.size,
    () => 0,
  );
}

/** Each file below a level's folder (as the view shows it: no links, a mounted level's hidden folders left out), with its size. */
async function* sized(loc: ChatLocation, at: Located): AsyncGenerator<{ rest: string[]; bytes: number }> {
  if (at.is !== "folder" || at.disk === null) return;
  for await (const e of walk(loc, at.level, at.rest, at.disk, Number.POSITIVE_INFINITY)) if (!e.folder) yield { rest: e.rest, bytes: await sizeOf(e.disk) };
}

async function levelBytes(loc: ChatLocation, path: string): Promise<number> {
  const lookup = await locate(loc, path);
  if (!lookup.ok) return 0;
  let bytes = 0;
  for await (const f of sized(loc, lookup.at)) bytes += f.bytes;
  return bytes;
}

/** What the tree and the database take, chat by chat and area by area. */
export async function treeStorage(deps: StorageDeps, user: string): Promise<TreeStorage> {
  const none: ChatLocation = { files: deps.files, character: null, chat: null };
  const chats: ChatStorage[] = [];
  for (const row of deps.db.query<{ chat: string; character: string; folder: string }, [string]>("SELECT chat, character, folder FROM tree_chat WHERE user = ? ORDER BY chat").all(user)) {
    const loc: ChatLocation = { files: deps.files, character: row.character, chat: row.folder };
    const areas = { notes: 0, turns: 0, sessions: 0, files: 0 };
    const top = await locate(loc, "");
    if (top.ok) {
      for await (const f of sized(loc, top.at)) {
        const area = f.rest[0] === NOTES_FOLDER ? "notes" : f.rest[0] === SESSIONS_FOLDER ? (f.rest[2] === TURNS_FOLDER ? "turns" : "sessions") : "files";
        areas[area] += f.bytes;
      }
    }
    chats.push({ chat: row.chat, folder: join(row.character, row.folder), bytes: areas.notes + areas.turns + areas.sessions + areas.files, areas });
  }
  const database = deps.db.filename === "" || deps.db.filename === ":memory:" ? 0 : (await sizeOf(deps.db.filename)) + (await sizeOf(`${deps.db.filename}-wal`));
  return { chats, global: await levelBytes(none, "@global/"), shipped: await levelBytes(none, "@shipped/"), database };
}

/** A chat's note files: the largest now, and those agents wrote most often in turns; `limit` of each. */
export async function noteFiles(deps: StorageDeps, loc: ChatLocation, user: string, chat: string, limit: number): Promise<NoteFiles> {
  const sizes = new Map<string, number>();
  const notes = await locate(loc, NOTES_FOLDER);
  if (notes.ok) for await (const f of sized(loc, notes.at)) sizes.set(f.rest.join("/"), f.bytes);
  const counts = new Map(deps.db.query<{ path: string; writes: number }, [string, string]>("SELECT path, count(*) AS writes FROM note_version WHERE user = ? AND chat = ? GROUP BY path").all(user, chat).map((r) => [r.path, r.writes]));
  const largest = [...sizes]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([path, bytes]) => ({ path, bytes, writes: counts.get(path) ?? 0 }));
  const rewritten = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([path, writes]) => ({ path, bytes: sizes.get(path) ?? 0, writes }));
  return { largest, rewritten };
}
