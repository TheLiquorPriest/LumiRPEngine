// What the Storage page shows of the tree (plan §5.1, §5.5, §14): what each chat's folder takes, by area
// (its notes, its turn folders, its sessions' own files, and the rest of the chat's files) and what its rows
// take of the database, what the user's level and the shipped level take, and the database's file; and, of a
// chat's notes, the files that are largest and those agents rewrote most often, so the user can see where
// agents lean on notes because a system is missing. It measures; it decides nothing.
//
// A chat's sizes are kept (`tree_size`), not walked at each load: they follow every file the port writes,
// are made again after a prune, and are checked against the disk in the background (an edit made in his own
// editor included) every `storage.recheckHours`. The Storage route answers from what is kept, a page of chats
// at a time, and has any chat that is not kept, or whose check is old, measured in the background.

import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { TreeChats } from "./chats";
import { walk } from "./files";
import { areaOf, NOTES_FOLDER, type StorageArea } from "./layout";
import { rowShares } from "./rows";
import { type ChatLocation, type Located, locate } from "./view";

export interface ChatStorage {
  chat: string;
  /** Its folder below the tree's `chats/`. */
  folder: string;
  bytes: number;
  areas: { notes: number; turns: number; sessions: number; files: number };
  /** When RPE heard that Lumiverse deleted the chat; its session files are gone and its other files stay until the user prunes them. Null while the chat is not deleted. */
  deleted?: number | null;
  /** What the chat's rows take of the database, by the length of its rows in every table that carries it. */
  rows?: number;
  /** When the sizes were last checked against the disk; null for a chat not measured yet (the sizes are then none). */
  measured?: number | null;
}

export interface TreeStorage {
  chats: ChatStorage[];
  /** Where the next page of chats starts after (send it as `after`); null at the end. */
  next?: string | null;
  /** The user's own level, the chats' folders, the shipped level and its notes apart. */
  global: number;
  /** The global level's notes (R-175), which every chat's agents read. */
  globalNotes: number;
  shipped: number;
  /** RPE's database file, with its write-ahead log. */
  database: number;
  /** What the database takes beyond the chats' rows: the installation's own tables, and what no chat owns. The chats' rows and this add up to `database`. */
  rest?: number;
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

/** What a chat's folder takes on the disk now, by area. */
export async function measureFolder(loc: ChatLocation): Promise<Record<StorageArea, number>> {
  const areas = { notes: 0, turns: 0, sessions: 0, files: 0 };
  const top = await locate(loc, "");
  if (top.ok) for await (const f of sized(loc, top.at)) areas[areaOf(f.rest)] += f.bytes;
  return areas;
}

export interface MeasurerDeps {
  files: string;
  chats: TreeChats;
  now(): number;
  /** Told of a chat whose measuring failed: the sizes kept for it stay as they were. */
  failed?(chat: string, error: unknown): void;
}

/**
 * Measures chats' folders on the disk one at a time in the background and keeps what it finds. A chat asked for twice while it waits
 * is measured once.
 */
export class ChatMeasurer {
  readonly #d: MeasurerDeps;
  readonly #waiting = new Map<string, string>();
  #running: Promise<void> | null = null;

  constructor(deps: MeasurerDeps) {
    this.#d = deps;
  }

  /** Has the chat's folder measured, soon. */
  request(user: string, chat: string): void {
    this.#waiting.set(`${user}\0${chat}`, chat);
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
  }

  /** Has every chat of the user that has no kept sizes, or whose check is older than `staleMs`, measured. */
  requestStale(user: string, staleMs: number): void {
    const kept = this.#d.chats.sizesKept(user);
    for (const c of this.#d.chats.placed(user)) {
      const k = kept.get(c.chat);
      if (k === undefined || this.#d.now() - k.checked > staleMs) this.request(user, c.chat);
    }
  }

  /** Resolves once everything asked for so far is measured. */
  async idle(): Promise<void> {
    while (this.#running !== null) await this.#running;
  }

  async #run(): Promise<void> {
    while (this.#waiting.size > 0) {
      const [key, chat] = this.#waiting.entries().next().value as [string, string];
      this.#waiting.delete(key);
      const user = key.slice(0, key.indexOf("\0"));
      const folders = this.#d.chats.folders(user, chat);
      if (folders === null) continue;
      try {
        const areas = await measureFolder({ files: this.#d.files, character: folders.character, chat: folders.chat });
        await this.#d.chats.keepSizes(user, chat, areas, this.#d.now());
      } catch (error) {
        this.#d.failed?.(chat, error);
      }
    }
  }
}

/** How a Storage page asks for its chats: how many, and the chat after which the page starts. */
export interface StoragePage {
  limit: number;
  after?: string | undefined;
  /** How old a chat's check against the disk may be before it is measured again, in milliseconds. */
  staleMs: number;
}

/** What the tree and the database take, chat by chat and area by area, from the sizes kept; chats not measured, or not for long enough, are measured meanwhile. */
export async function treeStorage(deps: StorageDeps & { chats: TreeChats; now(): number; measurer: ChatMeasurer }, user: string, page: StoragePage): Promise<TreeStorage> {
  const none: ChatLocation = { files: deps.files, character: null, chat: null };
  const placed = deps.chats.placed(user);
  const from = page.after === undefined ? 0 : placed.findIndex((c) => c.chat > (page.after as string));
  const shown = from < 0 ? [] : placed.slice(from, from + page.limit);
  const next = from >= 0 && from + page.limit < placed.length ? (shown.at(-1)?.chat ?? null) : null;
  const kept = deps.chats.sizesKept(user);
  const database = deps.db.filename === "" || deps.db.filename === ":memory:" ? 0 : (await sizeOf(deps.db.filename)) + (await sizeOf(`${deps.db.filename}-wal`));
  const shares = rowShares(deps.db, user, database);
  const chats = shown.map((row): ChatStorage => {
    const k = kept.get(row.chat);
    if (k === undefined || deps.now() - k.checked > page.staleMs) deps.measurer.request(user, row.chat);
    const areas = k?.areas ?? { notes: 0, turns: 0, sessions: 0, files: 0 };
    return { chat: row.chat, folder: join(row.character, row.folder), bytes: areas.notes + areas.turns + areas.sessions + areas.files, areas, deleted: row.deleted, rows: shares.chats.get(row.chat) ?? 0, measured: k?.checked ?? null };
  });
  const globalNotes = await levelBytes(none, `@global/${NOTES_FOLDER}/`);
  return { chats, next, global: (await levelBytes(none, "@global/")) - globalNotes, globalNotes, shipped: await levelBytes(none, "@shipped/"), database, rest: shares.rest };
}

/** A chat's note files: the largest now, and those agents wrote most often in turns; `limit` of each. Each note has one key, its path in the chat's view, which the Files page opens. */
export async function noteFiles(deps: StorageDeps, loc: ChatLocation, user: string, chat: string, limit: number): Promise<NoteFiles> {
  const sizes = new Map<string, number>();
  const notes = await locate(loc, NOTES_FOLDER);
  if (notes.ok) for await (const f of sized(loc, notes.at)) sizes.set(f.rest.join("/"), f.bytes);
  // A version names its note below the notes folder or with it, as the agent wrote it: both are the one note's.
  const counts = new Map<string, number>();
  for (const r of deps.db.query<{ path: string; writes: number }, [string, string]>("SELECT path, count(*) AS writes FROM note_version WHERE user = ? AND chat = ? GROUP BY path").all(user, chat)) {
    const path = r.path.startsWith(`${NOTES_FOLDER}/`) ? r.path : `${NOTES_FOLDER}/${r.path}`;
    counts.set(path, (counts.get(path) ?? 0) + r.writes);
  }
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
