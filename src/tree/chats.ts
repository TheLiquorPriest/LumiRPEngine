// Which folders a chat's levels are (plan §5): chosen once, the first time RPE meets the chat, from its
// character's name and its own, and kept in RPE's database, so a rename in Lumiverse moves nothing.
// And the tree's tables (the application's migration area `files`): those folders; every version of a
// note an agent wrote in a turn (`note_version`, Appendix B), with what the file held before and after;
// which of those versions stand in each chat's notes folder; the turn each chat's notes were last put at
// (plan §5.1, `notes.ts`); the shipped defaults an update changed; and agents' suggestions.

import type { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AreaTables } from "../app/app";
import type { Migration } from "../app/migrations";
import { CHARACTER_FOLDERS, CHAT_FOLDERS, CHATS_FOLDER, folderFor, id8, NOTE_FOLDERS, NOTES_FOLDER, SESSIONS_FOLDER } from "./layout";

/** How RPE's database takes a write: the application's write queue. */
export interface TreeWrites {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

export const TREE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "chat folders and agents' writes",
    sql: `
CREATE TABLE tree_chat (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  character TEXT NOT NULL,
  folder TEXT NOT NULL,
  PRIMARY KEY (user, chat),
  UNIQUE (user, character, folder)
);
CREATE TABLE tree_write (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT NOT NULL,
  agent TEXT NOT NULL,
  path TEXT NOT NULL,
  before TEXT,
  after TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX tree_write_turn ON tree_write (user, turn);
`,
  },
  {
    version: 2,
    name: "whose level a chat's character folder is",
    // Null for a chat placed before: it neither keeps a folder for its owner nor keeps another owner out.
    sql: `
ALTER TABLE tree_chat ADD COLUMN owner TEXT;
CREATE INDEX tree_chat_owner ON tree_chat (user, owner);
`,
  },
  {
    version: 3,
    name: "notes that follow the turn",
    // A write's text after it (`text`, null for a delete and for a write recorded before this), and whether the lead dropped it. Which
    // writes stand in each chat's notes folder (`tree_applied`): every note write recorded so far stood there when it was made. The
    // turn each chat's notes were last put at (`tree_notes`): a chat with none has not been put at a turn yet, so a branch is started.
    sql: `
ALTER TABLE tree_write ADD COLUMN text TEXT;
ALTER TABLE tree_write ADD COLUMN dropped INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tree_write_path ON tree_write (user, path);
CREATE TABLE tree_applied (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  write_id INTEGER NOT NULL,
  PRIMARY KEY (user, chat, write_id)
);
INSERT INTO tree_applied (user, chat, write_id) SELECT user, chat, id FROM tree_write WHERE path LIKE 'persistent-workspace/%';
CREATE TABLE tree_notes (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT,
  PRIMARY KEY (user, chat)
);
`,
  },
  {
    version: 4,
    name: "shipped defaults an update changed",
    // By the file's path below the shipped level: its text before the update that last changed it, and when that update was laid out.
    sql: `
CREATE TABLE tree_default (
  path TEXT PRIMARY KEY,
  before TEXT NOT NULL,
  at INTEGER NOT NULL
);
`,
  },
  {
    version: 5,
    name: "agents' suggestions",
    sql: `
CREATE TABLE tree_suggestion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT,
  agent TEXT NOT NULL,
  path TEXT NOT NULL,
  text TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  decided INTEGER
);
CREATE INDEX tree_suggestion_chat ON tree_suggestion (user, chat, state);
`,
  },
  {
    version: 6,
    name: "shipped defaults an update changed carry the user",
    // The rows already there are the install's user's, given him in this same step (R-179).
    up: (db, user) => {
      db.run(`
CREATE TABLE tree_default_user (
  user TEXT NOT NULL,
  path TEXT NOT NULL,
  before TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user, path)
);`);
      db.run("INSERT INTO tree_default_user (user, path, before, at) SELECT ?, path, before, at FROM tree_default", [user]);
      db.run("DROP TABLE tree_default; ALTER TABLE tree_default_user RENAME TO tree_default;");
    },
  },
  {
    version: 7,
    name: "Appendix B's names: note_version and suggestion",
    sql: `
ALTER TABLE tree_write RENAME TO note_version;
DROP INDEX tree_write_turn;
DROP INDEX tree_write_path;
CREATE INDEX note_version_turn ON note_version (user, turn);
CREATE INDEX note_version_path ON note_version (user, path);
ALTER TABLE tree_suggestion RENAME TO suggestion;
DROP INDEX tree_suggestion_chat;
CREATE INDEX suggestion_chat ON suggestion (user, chat, state);
`,
  },
  {
    version: 8,
    name: "every change an update made to a default, and when the user wrote their own files",
    // `tree_default` becomes one row for each file an update changed or took away (`removed`), numbered in the order updates came (`seq`),
    // where it kept only the last change of each file. `tree_written`: when the user wrote one of their files through RPE (by its place below
    // the tree's folder), and the last `seq` there had been then, which is what says which updates came after.
    sql: `
CREATE TABLE tree_default_updates (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  path TEXT NOT NULL,
  before TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
INSERT INTO tree_default_updates (user, path, before, removed, at) SELECT user, path, before, 0, at FROM tree_default ORDER BY at;
DROP TABLE tree_default;
ALTER TABLE tree_default_updates RENAME TO tree_default;
CREATE INDEX tree_default_path ON tree_default (user, path);
CREATE TABLE tree_written (
  user TEXT NOT NULL,
  file TEXT NOT NULL,
  seen INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user, file)
);
`,
  },
  {
    version: 9,
    name: "chats Lumiverse deleted, and when the user last pruned",
    // `tree_chat.deleted`: when RPE heard Lumiverse delete the chat. `tree_prune`: when the user last pruned anything the Storage page offers.
    sql: `
ALTER TABLE tree_chat ADD COLUMN deleted INTEGER;
CREATE TABLE tree_prune (
  user TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`,
  },
];

/** The tree's tables, under its one name among the migration areas: the application and the command line open them by this. */
export const TREE_TABLES = { area: "files", migrations: TREE_MIGRATIONS } as const satisfies AreaTables;

/** Lays every folder plan §5 draws at a chat's two levels: the character's guidance folders, and the chat's own, its sessions' and its notes' four. No file. */
async function layLevels(files: string, at: ChatFolders): Promise<void> {
  const character = join(files, CHATS_FOLDER, at.character);
  const chat = join(character, at.chat);
  const folders = [...Object.values(CHARACTER_FOLDERS).map((f) => join(character, f)), ...Object.values(CHAT_FOLDERS).map((f) => join(chat, f)), join(chat, SESSIONS_FOLDER), ...NOTE_FOLDERS.map((f) => join(chat, NOTES_FOLDER, f))];
  await Promise.all(folders.map((folder) => mkdir(folder, { recursive: true })));
}

/** An id as a folder name keeps it whole: its letters and digits, lower case. */
function wholeId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/** The first of `short`, `long`, `long-2`, `long-3` … that `taken` does not hold. */
function firstFree(short: string, long: string, taken: (folder: string) => boolean): string {
  if (!taken(short)) return short;
  if (!taken(long)) return long;
  let n = 2;
  while (taken(`${long}-${n}`)) n++;
  return `${long}-${n}`;
}

/** What a chat's folders are named for: its character (or group), and the chat itself. */
export interface ChatNames {
  /** The character or group whose level the chat sits in, by its id and name; null for a chat with none (Lumiverse's temporary chat). */
  character: { id: string; name: string } | null;
  chat: { name: string };
}

/** A chat's two folder names, under the tree's `chats/`. */
export interface ChatFolders {
  character: string;
  chat: string;
}

export class TreeChats {
  constructor(
    private readonly db: Database,
    private readonly writes: TreeWrites,
    private readonly files: string,
  ) {}

  /** The chat's folders; null for a chat not placed yet. */
  folders(user: string, chat: string): ChatFolders | null {
    const row = this.db.query<{ character: string; folder: string }, [string, string]>("SELECT character, folder FROM tree_chat WHERE user = ? AND chat = ?").get(user, chat);
    return row === null ? null : { character: row.character, chat: row.folder };
  }

  /** When RPE's record of each of the chat's turns says it began, by the id's first letters a turn folder's name holds (`id8`); none where the store keeps no turns here. */
  turnsBegun(user: string, chat: string): Map<string, number> {
    const stored = this.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'turn'").get()?.n === 1;
    if (!stored) return new Map();
    return new Map(this.db.query<{ id: string; created: number }, [string, string]>("SELECT id, created FROM turn WHERE user = ? AND chat = ?").all(user, chat).map((t) => [id8(t.id), t.created]));
  }

  /** Every chat placed for the user, each with when RPE heard that Lumiverse deleted it (null while it has not). */
  placed(user: string): { chat: string; character: string; folder: string; deleted: number | null }[] {
    return this.db.query<{ chat: string; character: string; folder: string; deleted: number | null }, [string]>("SELECT chat, character, folder, deleted FROM tree_chat WHERE user = ? ORDER BY chat").all(user);
  }

  /**
   * Lumiverse deleted the chat (RPE heard it, or found it gone at its reconcile): its session files go, and it is marked deleted from
   * `at`. Its other files stay, listed on the Storage page as a deleted chat's, to be pruned when the user asks. A chat RPE never
   * placed has nothing here, and a chat already marked keeps its first mark.
   */
  async deleted(user: string, chat: string, at: number): Promise<void> {
    const folders = this.folders(user, chat);
    if (folders === null) return;
    await this.writes.run((db) => db.run("UPDATE tree_chat SET deleted = ? WHERE user = ? AND chat = ? AND deleted IS NULL", [at, user, chat]), "marking a deleted chat");
    await rm(join(this.files, CHATS_FOLDER, folders.character, folders.chat, SESSIONS_FOLDER), { recursive: true, force: true });
  }

  /**
   * The chat's folders, chosen the first time it is placed, and laid with every folder its levels hold (again at each placing,
   * should one have gone). A character's level is chosen once and kept, so its chats sit together after a rename; a chat with no
   * character sits in a level of its own, named for the chat. Two characters, or two chats of a character, whose names and ids'
   * first letters agree are told apart by the whole id.
   */
  async place(user: string, chat: string, names: ChatNames): Promise<ChatFolders> {
    const known = this.folders(user, chat);
    if (known !== null) {
      await layLevels(this.files, known);
      return known;
    }
    const level = names.character ?? { id: chat, name: names.chat.name };
    const owner = names.character === null ? `chat:${chat}` : `character:${names.character.id}`;
    const chosen = await this.writes.run((db) => {
      const again = db.query<{ character: string; folder: string }, [string, string]>("SELECT character, folder FROM tree_chat WHERE user = ? AND chat = ?").get(user, chat);
      if (again !== null) return { character: again.character, chat: again.folder };
      const kept = db.query<{ character: string }, [string, string]>("SELECT character FROM tree_chat WHERE user = ? AND owner = ? LIMIT 1").get(user, owner);
      const othersLevel = (folder: string): boolean => db.query<{ n: number }, [string, string, string]>("SELECT count(*) AS n FROM tree_chat WHERE user = ? AND character = ? AND owner IS NOT NULL AND owner <> ?").get(user, folder, owner)?.n !== 0;
      const character = kept?.character ?? firstFree(folderFor(level.name, level.id), `${folderFor(level.name, level.id)}-${wholeId(level.id)}`, othersLevel);
      const taken = (folder: string): boolean => db.query<{ n: number }, [string, string, string]>("SELECT count(*) AS n FROM tree_chat WHERE user = ? AND character = ? AND folder = ?").get(user, character, folder)?.n !== 0;
      const short = folderFor(names.chat.name, chat);
      const folder = firstFree(short, `${short}-${wholeId(chat)}`, taken);
      db.run("INSERT INTO tree_chat (user, chat, character, folder, owner) VALUES (?, ?, ?, ?, ?)", [user, chat, character, folder, owner]);
      return { character, chat: folder };
    }, "placing a chat's folders");
    await layLevels(this.files, chosen);
    return chosen;
  }
}
