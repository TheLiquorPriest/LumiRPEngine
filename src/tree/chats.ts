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
];

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
   * The chat's folders, chosen and made the first time it is placed. A chat with no character sits in a
   * level of its own, named for the chat. Two chats whose names and ids' first letters agree are told
   * apart by the whole id.
   */
  async place(user: string, chat: string, names: ChatNames): Promise<ChatFolders> {
    const known = this.folders(user, chat);
    if (known !== null) {
      await mkdir(join(this.files, CHATS_FOLDER, known.character, known.chat), { recursive: true });
      return known;
    }
    const character = names.character === null ? folderFor(names.chat.name, chat) : folderFor(names.character.name, names.character.id);
    const chosen = await this.writes.run((db) => {
      const again = db.query<{ character: string; folder: string }, [string, string]>("SELECT character, folder FROM tree_chat WHERE user = ? AND chat = ?").get(user, chat);
      if (again !== null) return { character: again.character, chat: again.folder };
      const taken = (folder: string): boolean => db.query<{ n: number }, [string, string, string]>("SELECT count(*) AS n FROM tree_chat WHERE user = ? AND character = ? AND folder = ?").get(user, character, folder)?.n !== 0;
      const short = folderFor(names.chat.name, chat);
      const folder = taken(short) ? `${short}-${chat.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}` : short;
      db.run("INSERT INTO tree_chat (user, chat, character, folder) VALUES (?, ?, ?, ?)", [user, chat, character, folder]);
      return { character, chat: folder };
    }, "placing a chat's folders");
    await mkdir(join(this.files, CHATS_FOLDER, chosen.character, chosen.chat), { recursive: true });
    return chosen;
  }
}
