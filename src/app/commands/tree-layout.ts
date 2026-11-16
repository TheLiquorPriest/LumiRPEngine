// The file tree's layout as the migration takes it.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { SHIPPED_GUIDANCE } from "rp-harness/helpers";
import type { TreeLayout } from "../../migrate/own-files";
import { TREE_TABLES, TreeChats } from "../../tree/chats";
import { CHATS_FOLDER, GLOBAL_FOLDERS, NOTES_FOLDER } from "../../tree/layout";
import { TreeNotes } from "../../tree/notes";
import { RPE_GUIDANCE } from "../../tree/shipped";

/** The tools a folder of tools' files names: each file's name without `.md` or `.json`; none where the folder is not there. */
async function toolsIn(folder: string): Promise<string[]> {
  const names = await readdir(folder).catch(() => [] as string[]);
  return names.flatMap((name) => (/\.(md|json)$/.test(name) ? [name.replace(/\.(md|json)$/, "")] : []));
}

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
    // Every tool a file names at the shipped levels (RPH's and RPE's) and among his own: a tool a carried agent names outside them is gone.
    toolNames: async (files) => [...new Set((await Promise.all([SHIPPED_GUIDANCE, RPE_GUIDANCE, files].map((root) => toolsIn(join(root, GLOBAL_FOLDERS.tools))))).flat())],
  };
}
