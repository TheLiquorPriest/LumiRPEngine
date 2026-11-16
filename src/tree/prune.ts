// What the Storage page prunes on request (plan §5.5, §14): a chat's old turn folders, the files of a chat's
// closed sessions, the other files of a chat Lumiverse deleted, and a backup or a copy of the database he
// names. Each is asked first: the plan says which places go, of what kind, how many files and how many
// bytes, and a token that stands for exactly that; the prune is then asked with the token, and takes exactly
// the plan, or, if the tree has changed since it was asked, takes nothing and says so. Never a turn going on,
// never an open session's files, and a backup goes only when he names it.

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { RouteError } from "../app";
import { listBackups } from "../app/backups-route";
import type { TreeChats, TreeWrites } from "./chats";
import { CHATS_FOLDER, SESSIONS_FOLDER } from "./layout";
import { TreeNotes } from "./notes";
import { below, folderNames, measure, type Planned, planTurnPrune, retentionOf, takePlanned } from "./retention";
import { versionsKeptOf } from "./settings";
import type { TreeSuggestions } from "./suggestions";
import type { ChatLocation } from "./view";

export type PruneWhat = "turns" | "sessions" | "chat" | "backup" | "suggestions" | "versions";

export interface PruneDeps {
  /** The tree's folder. */
  files: string;
  chats: TreeChats;
  /** The data folder's backups: the migration's, the copies taken before migrations, the archives. */
  backups: string;
  writes: TreeWrites;
  now(): number;
  /** Whether a turn of the chat is going on: nothing of its files is pruned while one is. */
  turning(user: string, chat: string): boolean;
  /** The ids of the chat's sessions that are open now: their files are never pruned. */
  openSessions(user: string, chat: string): Promise<string[]>;
  /** RPE's database, read at any time. */
  db: Database;
  suggestions: TreeSuggestions;
}

/** What a page asks to prune: the chat for all but a backup, and the backup's name. */
export interface PruneAsk {
  what: PruneWhat;
  chat?: string | null | undefined;
  name?: string | null | undefined;
}

/** What a prune would take, or took. */
export interface PruneItem {
  kind: "turn-folder" | "session" | "chat" | "suggestions" | "note-versions" | "backup";
  /** Below the tree's folder, or for a backup its file's name. */
  path: string;
  files: number;
  bytes: number;
}

export interface PrunePlan {
  items: PruneItem[];
  files: number;
  bytes: number;
  /** Stands for exactly these items: asking the prune with it takes them and nothing else. */
  plan: string;
  /** Takes them. */
  take(): Promise<void>;
}

function chatFolder(deps: PruneDeps, user: string, chat: string): { loc: ChatLocation; disk: string } {
  const folders = deps.chats.folders(user, chat);
  if (folders === null) throw new RouteError(404, `RPE has no folder for chat ${chat}.`);
  return { loc: { files: deps.files, character: folders.character, chat: folders.chat }, disk: join(deps.files, CHATS_FOLDER, folders.character, folders.chat) };
}

function chatNamed(ask: PruneAsk): string {
  if (typeof ask.chat !== "string" || ask.chat === "") throw new RouteError(400, `Pruning ${ask.what} names the chat.`);
  return ask.chat;
}

/** The places `ask` would prune now. */
export async function planPrune(deps: PruneDeps, user: string, ask: PruneAsk): Promise<PrunePlan> {
  let planned: Planned[] = [];
  let backup: { name: string; bytes: number } | null = null;
  if (ask.what === "backup") {
    const name = ask.name;
    const found = (await listBackups(deps.backups)).find((b) => b.name === name);
    if (found === undefined) throw new RouteError(404, `The backups folder holds no ${String(name)}.`);
    backup = { name: found.name, bytes: found.bytes };
  } else {
    const chat = chatNamed(ask);
    if (deps.turning(user, chat)) throw new RouteError(409, "A turn of this chat is going on: prune once it is over.");
    const { loc, disk } = chatFolder(deps, user, chat);
    if (ask.what === "turns") planned = await planTurnPrune(loc, await retentionOf(loc), new Set(), deps.chats.turnsBegun(user, chat));
    else if (ask.what === "sessions") {
      const open = new Set(await deps.openSessions(user, chat));
      const sessions = join(disk, SESSIONS_FOLDER);
      for (const id of await folderNames(sessions)) {
        if (open.has(id)) continue;
        const taken = await measure(join(sessions, id));
        planned.push({ kind: "session", path: below(deps.files, join(sessions, id)), files: taken.files, bytes: taken.bytes, disks: [join(sessions, id)] });
      }
    } else if (ask.what === "suggestions") {
      const { decidedKept } = await deps.chats.suggestionLimits(user, chat);
      const past = deps.suggestions.decidedPast(user, chat, decidedKept);
      if (past.count > 0) planned.push({ kind: "suggestions", path: `suggestions of ${chat}`, files: past.count, bytes: past.bytes, disks: [], run: async () => void (await deps.suggestions.pruneDecided(user, chat, decidedKept)) });
    } else if (ask.what === "versions") {
      const kept = await versionsKeptOf(loc);
      const notes = new TreeNotes({ files: deps.files, db: deps.db, writes: deps.writes, chats: deps.chats });
      const past = kept === null ? { ids: [], bytes: 0 } : notes.foldable(user, chat, kept);
      if (kept !== null && past.ids.length > 0) planned.push({ kind: "note-versions", path: `note versions of ${chat}`, files: past.ids.length, bytes: past.bytes, disks: [], run: async () => void (await notes.fold(user, chat, kept)) });
    } else {
      if (deps.chats.placed(user).find((c) => c.chat === chat)?.deleted == null) throw new RouteError(409, `Lumiverse has not deleted chat ${chat}: only a deleted chat's files are pruned whole.`);
      const taken = await measure(disk);
      planned.push({ kind: "chat", path: below(deps.files, disk), files: taken.files, bytes: taken.bytes, disks: [disk] });
    }
  }
  const items: PruneItem[] = backup === null ? planned.map(({ kind, path, files, bytes }) => ({ kind, path, files, bytes })) : [{ kind: "backup", path: backup.name, files: 1, bytes: backup.bytes }];
  const plan = createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 24);
  return {
    items,
    files: items.reduce((n, i) => n + i.files, 0),
    bytes: items.reduce((n, i) => n + i.bytes, 0),
    plan,
    take: async () => {
      if (backup !== null) await rm(join(deps.backups, backup.name), { force: true });
      else await takePlanned(planned);
      await deps.writes.run((db) => db.run("INSERT INTO tree_prune (user, at) VALUES (?, ?) ON CONFLICT (user) DO UPDATE SET at = excluded.at", [user, deps.now()]), "keeping when the user last pruned");
    },
  };
}
