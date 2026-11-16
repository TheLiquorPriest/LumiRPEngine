// Retention (plan §5.5). The newest turn folders of each chat are kept whole; each older one keeps its
// record (`turn.json`), what it released (`output/`) and its transcripts (`transcripts/`), and drops the
// rest: the snapshots of the chat and the lore, which nothing reads as a source of truth and which can
// be made again. Session files are not pruned here: they stay until the chat is deleted or he prunes them
// (`prune.ts`). How many turn folders are kept whole is the setting `retention.turnFolders` (`settings.ts`).
// Pruning runs when asked for and after a turn, never during one: the folders of turns going on are left
// alone, however old. Newest is by when the turn was received, as its record says, or RPE's record of the
// turn its folder's name gives; never by file times, which a copy or a restore of the tree resets.
//
// What a prune takes is worked out first (`planTurnPrune`), so that he can be told before it goes, and
// then taken exactly as planned.

import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { TreeChats } from "./chats";
import { SESSIONS_FOLDER, TURNS_FOLDER } from "./layout";
import { type TreeSettings, treeSettingsOf } from "./settings";
import { receivedOf, TURN_RECORD } from "./turn-record";
import { type ChatLocation, locate } from "./view";

/** What an older turn folder keeps (plan §5.5): its record, what it released, and its transcripts. */
export const KEPT_IN_OLD_TURNS: readonly string[] = [TURN_RECORD, "output", "transcripts"];

export type RetentionSettings = Pick<TreeSettings, "turnFolders">;

/** What a prune took away. */
export interface Pruned {
  /** Turn folders it took parts of. */
  folders: number;
  files: number;
  bytes: number;
}

/** What a prune would take of one place: its path below the tree's folder, the files and bytes of what goes, and the paths on disk that go. */
export interface Planned {
  /** What goes: a turn folder's snapshots, a session, a chat's folder, a chat's decided suggestions or old note versions. */
  kind: "turn-folder" | "session" | "chat" | "suggestions" | "note-versions";
  /** The place it goes from, below the tree's folder, "/" between names; for what is kept in the database, what it is of. */
  path: string;
  files: number;
  bytes: number;
  /** The paths on disk removed, whole. */
  disks: string[];
  /** What takes it where it is not on disk. */
  run?: () => Promise<void>;
}

/** The chat's retention settings, as its levels' config files set them over the default. */
export async function retentionOf(loc: ChatLocation): Promise<RetentionSettings> {
  return { turnFolders: (await treeSettingsOf(loc)).turnFolders };
}

export async function folderNames(disk: string): Promise<string[]> {
  try {
    return (await readdir(disk, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink()).map((d) => d.name);
  } catch {
    return [];
  }
}

/** The files below a path, and what they hold, links not followed. */
export async function measure(disk: string): Promise<{ files: number; bytes: number }> {
  const info = await lstat(disk);
  if (!info.isDirectory()) return { files: 1, bytes: info.size };
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(disk)) {
    const below = await measure(join(disk, entry));
    files += below.files;
    bytes += below.bytes;
  }
  return { files, bytes };
}

/** A place on disk as the tree's folder names it: below it, "/" between names. */
export function below(files: string, disk: string): string {
  return relative(files, disk).split(sep).join("/");
}

/** The id letters a turn folder's name ends with (`turn-<n>-<id8>`, `turnFolderName`). */
const TURN_FOLDER = /^turn-\d+-([a-z0-9]+)$/;

/**
 * What pruning a chat's turn folders takes: all but the newest `settings.turnFolders` lose what plan §5.5 does not keep. Newest by
 * when each turn was received: its `turn.json`, or `begun` (RPE's record of each turn, by the id letters its folder's name gives)
 * for a folder without one; a folder neither says is the oldest. `spare`: the folder names of turns going on, left alone.
 */
export async function planTurnPrune(loc: ChatLocation, settings: RetentionSettings, spare: ReadonlySet<string> = new Set(), begun: ReadonlyMap<string, number> = new Map()): Promise<Planned[]> {
  const sessions = await locate(loc, SESSIONS_FOLDER);
  if (!sessions.ok || sessions.at.is !== "folder" || sessions.at.disk === null) return [];
  const folders: { name: string; disk: string; begun: number }[] = [];
  for (const session of await folderNames(sessions.at.disk)) {
    const turns = join(sessions.at.disk, session, TURNS_FOLDER);
    for (const name of await folderNames(turns)) {
      const disk = join(turns, name);
      const recorded = await readFile(join(disk, TURN_RECORD), "utf8").then(receivedOf, () => null);
      const letters = TURN_FOLDER.exec(name)?.[1];
      folders.push({ name, disk, begun: recorded ?? (letters === undefined ? undefined : begun.get(letters)) ?? 0 });
    }
  }
  folders.sort((a, b) => b.begun - a.begun);
  const planned: Planned[] = [];
  for (const folder of folders.slice(settings.turnFolders)) {
    if (spare.has(folder.name)) continue;
    const goes = (await readdir(folder.disk)).filter((entry) => !KEPT_IN_OLD_TURNS.includes(entry));
    if (goes.length === 0) continue;
    let files = 0;
    let bytes = 0;
    for (const entry of goes) {
      const taken = await measure(join(folder.disk, entry));
      files += taken.files;
      bytes += taken.bytes;
    }
    planned.push({ kind: "turn-folder", path: below(loc.files, folder.disk), files, bytes, disks: goes.map((entry) => join(folder.disk, entry)) });
  }
  return planned;
}

/** Takes what was planned, exactly. */
export async function takePlanned(planned: readonly Planned[]): Promise<Pruned> {
  const pruned: Pruned = { folders: 0, files: 0, bytes: 0 };
  for (const p of planned) {
    for (const disk of p.disks) await rm(disk, { recursive: true, force: true });
    await p.run?.();
    pruned.folders++;
    pruned.files += p.files;
    pruned.bytes += p.bytes;
  }
  return pruned;
}

/** Prunes a chat's turn folders as `planTurnPrune` plans. */
export async function pruneTurnFolders(loc: ChatLocation, settings: RetentionSettings, spare: ReadonlySet<string> = new Set(), begun: ReadonlyMap<string, number> = new Map()): Promise<Pruned> {
  return await takePlanned(await planTurnPrune(loc, settings, spare, begun));
}

/** Prunes a chat's turn folders by its own retention settings; nothing for a chat RPE has not placed. */
export async function pruneChat(deps: { files: string; chats: TreeChats }, user: string, chat: string, spare: ReadonlySet<string> = new Set()): Promise<Pruned> {
  const folders = deps.chats.folders(user, chat);
  if (folders === null) return { folders: 0, files: 0, bytes: 0 };
  const loc: ChatLocation = { files: deps.files, character: folders.character, chat: folders.chat };
  return await pruneTurnFolders(loc, await retentionOf(loc), spare, deps.chats.turnsBegun(user, chat));
}
