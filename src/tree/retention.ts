// Retention (plan §5.5). The newest turn folders of each chat are kept whole; each older one keeps its
// record (`turn.json`), what it released (`output/`) and its transcripts (`transcripts/`), and drops the
// rest: the snapshots of the chat and the lore, which nothing reads as a source of truth and which can
// be made again. Session files are not pruned here: they stay until the chat is deleted. How many turn
// folders are kept whole is the setting `retention.turnFolders` (`settings.ts`). Pruning runs when
// asked for and after a turn, never during one: the folders of turns going on are left alone, however
// old.

import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TreeChats } from "./chats";
import { SESSIONS_FOLDER, TURNS_FOLDER } from "./layout";
import { type TreeSettings, treeSettingsOf } from "./settings";
import { type ChatLocation, locate } from "./view";

/** What an older turn folder keeps (plan §5.5): its record, what it released, and its transcripts. */
export const KEPT_IN_OLD_TURNS: readonly string[] = ["turn.json", "output", "transcripts"];

export type RetentionSettings = Pick<TreeSettings, "turnFolders">;

/** What a prune took away. */
export interface Pruned {
  /** Turn folders it took parts of. */
  folders: number;
  files: number;
  bytes: number;
}

/** The chat's retention settings, as its levels' config files set them over the default. */
export async function retentionOf(loc: ChatLocation): Promise<RetentionSettings> {
  return { turnFolders: (await treeSettingsOf(loc)).turnFolders };
}

async function folderNames(disk: string): Promise<string[]> {
  try {
    return (await readdir(disk, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink()).map((d) => d.name);
  } catch {
    return [];
  }
}

/** The files below a path, and what they hold, links not followed. */
async function measure(disk: string): Promise<{ files: number; bytes: number }> {
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

/**
 * Prunes a chat's turn folders: all but the newest `settings.turnFolders` (newest by when each was
 * begun: its `turn.json`, or the folder itself without one) keep only what plan §5.5 keeps. `spare`:
 * the folder names of turns going on, left alone.
 */
export async function pruneTurnFolders(loc: ChatLocation, settings: RetentionSettings, spare: ReadonlySet<string> = new Set()): Promise<Pruned> {
  const pruned: Pruned = { folders: 0, files: 0, bytes: 0 };
  const sessions = await locate(loc, SESSIONS_FOLDER);
  if (!sessions.ok || sessions.at.is !== "folder" || sessions.at.disk === null) return pruned;
  const folders: { name: string; disk: string; begun: number }[] = [];
  for (const session of await folderNames(sessions.at.disk)) {
    const turns = join(sessions.at.disk, session, TURNS_FOLDER);
    for (const name of await folderNames(turns)) {
      const disk = join(turns, name);
      const begun = await stat(join(disk, "turn.json")).then(
        (s) => s.mtimeMs,
        async () => (await stat(disk)).mtimeMs,
      );
      folders.push({ name, disk, begun });
    }
  }
  folders.sort((a, b) => b.begun - a.begun);
  for (const folder of folders.slice(settings.turnFolders)) {
    if (spare.has(folder.name)) continue;
    let took = false;
    for (const entry of await readdir(folder.disk)) {
      if (KEPT_IN_OLD_TURNS.includes(entry)) continue;
      const at = join(folder.disk, entry);
      const gone = await measure(at);
      await rm(at, { recursive: true, force: true });
      pruned.files += gone.files;
      pruned.bytes += gone.bytes;
      took = true;
    }
    if (took) pruned.folders++;
  }
  return pruned;
}

/** Prunes a chat's turn folders by its own retention settings; nothing for a chat RPE has not placed. */
export async function pruneChat(deps: { files: string; chats: TreeChats }, user: string, chat: string, spare: ReadonlySet<string> = new Set()): Promise<Pruned> {
  const folders = deps.chats.folders(user, chat);
  if (folders === null) return { folders: 0, files: 0, bytes: 0 };
  const loc: ChatLocation = { files: deps.files, character: folders.character, chat: folders.chat };
  return await pruneTurnFolders(loc, await retentionOf(loc), spare);
}
