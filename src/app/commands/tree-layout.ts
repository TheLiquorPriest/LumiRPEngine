// The file tree's layout as the migration takes it.

import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { TreeLayout } from "../../migrate/own-files";
import { TREE_TABLES, TreeChats } from "../../tree/chats";
import { CHATS_FOLDER, GLOBAL_FOLDERS, NOTES_FOLDER } from "../../tree/layout";
import { TreeNotes } from "../../tree/notes";

/** The tree's notes over the run's own database: the run is the one writer of RPE's database while it runs, so the tree's writes go to it directly. */
function notesOf(db: Database, files: string): TreeNotes {
  const writes = { run: async <T>(write: (db: Database) => T): Promise<T> => write(db) };
  return new TreeNotes({ files, db, writes, chats: new TreeChats(db, writes, files) });
}

/** The file tree's layout as the migration takes it: the folders of the user's own files, the tree's tables, and each chat's own folder, placed as the tree places a chat. */
export function treeLayout(): TreeLayout {
  return {
    agents: GLOBAL_FOLDERS.agents,
    skills: GLOBAL_FOLDERS.skills,
    prompts: GLOBAL_FOLDERS.prompts,
    notes: NOTES_FOLDER,
    tables: TREE_TABLES,
    // The run is the one writer of RPE's database while it runs, so the tree's writes go to it directly.
    chatFolder: async (db, files, user, chat, names) => {
      const at = await new TreeChats(db, { run: async (write) => write(db) }, files).place(user, chat, names);
      return join(CHATS_FOLDER, at.character, at.chat);
    },
    recordVersion: (db, files, user, chat, turn, path, before, after, by, at, stands) => notesOf(db, files).recordVersion(user, chat, turn, path, before, after, by, at, stands),
    forgetVersions: (db, files, user, chat) => notesOf(db, files).forgetCarried(user, chat),
  };
}
