// Today's data, opened for one read (STANDALONE-PLAN §15.3 items 2 and 3): Lumiverse's database,
// read-only and limited to one user's rows; the extension's storage folders in either layout; the
// runtime's own folders, its working copy's unsent writes laid over the user's storage as today's
// runtime would send them; and today's own readers over the read-only stand-in, which keeps every
// write they try in memory. The rehearsal, the backup and the real run each start from one of these.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readText } from "./files";
import { LumiverseDb, type ChatRow, type Install } from "./lumiverse-db";
import { ChatReader } from "./chats";
import { readRuntimeFolders, type RuntimeFolders, type RuntimeRead } from "./runtime-folders";
import { StandIn, StorageView, type AttemptedWrite } from "./stand-in";

/** Where today's data is: Lumiverse's data folder, the extension's identifier there, the one user whose data migrates, and the runtime's folders (null: the server runs none). */
export interface Sources {
  lumiverse: string;
  identifier: string;
  userId: string;
  runtime: RuntimeFolders | null;
}

/**
 * The extension's two storage folders in Lumiverse's data folder (`src/auth/provision.ts:47-50`,
 * `src/spindle/manager.service.ts:719-721`): the user's own, which is also the extension's storage
 * when it is installed for one user, and the extension's, when it is installed for everyone.
 */
export function storageFolders(sources: Pick<Sources, "lumiverse" | "identifier" | "userId">): { user: string; extension: string } {
  return { user: join(sources.lumiverse, "users", sources.userId, "extensions", sources.identifier), extension: join(sources.lumiverse, "extensions", sources.identifier, "storage") };
}

const EMPTY_RUNTIME: RuntimeRead = { runtimes: [], files: [], unreadable: [], unsent: [] };

export interface Today {
  sources: Sources;
  db: LumiverseDb;
  /** The user's name in Lumiverse; null when the database has no such user. */
  username: string | null;
  install: Install | null;
  /** The user's storage folder and the extension's own, where they exist. */
  user: string | null;
  extension: string | null;
  runtime: RuntimeRead;
  /** The runtime's folders the run was given, where neither is there: a runtime expected and not found. Null where one is, or where the server runs none. */
  runtimeMissing: RuntimeFolders | null;
  /** What the runtime's working copy hasn't sent and today's runtime would send, by user-storage path: a text, or a removal (null). */
  pending: Map<string, string | null>;
  /** Every write today's readers tried, kept in memory. */
  writes: AttemptedWrite[];
  userView: StorageView;
  extensionView: StorageView;
  standIn: StandIn;
  reader: ChatReader;
  /** The user's chats, the most recently updated first. */
  chats: ChatRow[];
  close(): void;
}

/** Opens today's data for one read. Close it when done: it holds Lumiverse's database open, read-only. */
export async function openToday(sources: Sources): Promise<Today> {
  const db = LumiverseDb.open(sources.lumiverse);
  try {
    const username = db.username(sources.userId);
    const install = db.install(sources.identifier);
    const folders = storageFolders(sources);
    const user = existsSync(folders.user) ? folders.user : null;
    const extension = existsSync(folders.extension) ? folders.extension : null;
    const mark = user === null ? null : await readText(join(user, "harness", "docs", "mirror.json"));
    const runtime = sources.runtime === null ? EMPTY_RUNTIME : await readRuntimeFolders(sources.runtime, sources.identifier, username, mark);
    const pending = new Map<string, string | null>();
    for (const u of runtime.unsent) if (u.kept) for (const [path, text] of u.files) pending.set(path, text);
    // Today's own readers run over the stand-in: what they write stays in memory, listed in `writes`.
    const writes: AttemptedWrite[] = [];
    const userView = new StorageView("user storage", user, writes, pending);
    const oneFolder = install?.scope === "user" && install.owner === sources.userId;
    const extensionView = oneFolder ? userView : new StorageView("extension storage", extension, writes);
    const standIn = new StandIn({ userId: sources.userId, user: userView, extension: extensionView, db }, writes);
    return {
      sources,
      db,
      username,
      install,
      user,
      extension,
      runtime,
      runtimeMissing: sources.runtime !== null && !existsSync(sources.runtime.configDir) && !existsSync(sources.runtime.dataDir) ? sources.runtime : null,
      pending,
      writes,
      userView,
      extensionView,
      standIn,
      reader: new ChatReader(standIn.host),
      chats: db.chats(sources.userId),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
