// Which folders a chat's levels are (plan §5): chosen once, the first time RPE meets the chat, from its
// character's name and its own, and kept in RPE's database, so a rename in Lumiverse moves nothing.
// And the tree's tables (the application's migration area `files`): those folders, and every write an
// agent made in a turn, so a swipe or a delete can put the turn's notes back (plan §5.1).

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CHATS_FOLDER, folderFor } from "./layout";

/** How RPE's database takes a write: the application's write queue. */
export interface TreeWrites {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

export const TREE_MIGRATIONS: readonly { readonly version: number; readonly name: string; readonly sql: string }[] = [
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
];

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

  /**
   * The chat's folders, chosen and made the first time it is placed. A character's level is chosen
   * once and kept, so its chats sit together after a rename; a chat with no character sits in a level
   * of its own, named for the chat. Two characters, or two chats of a character, whose names and ids'
   * first letters agree are told apart by the whole id.
   */
  async place(user: string, chat: string, names: ChatNames): Promise<ChatFolders> {
    const known = this.folders(user, chat);
    if (known !== null) {
      await mkdir(join(this.files, CHATS_FOLDER, known.character, known.chat), { recursive: true });
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
    await mkdir(join(this.files, CHATS_FOLDER, chosen.character, chosen.chat), { recursive: true });
    return chosen;
  }
}
