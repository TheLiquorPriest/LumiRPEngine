// The file tree as the migration's tests need it: its layout as `rpe migrate` gives it to the
// migration (`src/app/cli.ts`), with where a chat's folders are, placed in RPE's database as the tree
// places a chat; and what a chat's agents can read in the tree, through the tree's own view.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LayerLevel } from "rp-harness/contract";
import type { TreeLayout } from "../../src/migrate/own-files";
import { TREE_MIGRATIONS, TreeChats } from "../../src/tree";
import { CHATS_FOLDER, GLOBAL_FOLDERS, NOTES_FOLDER } from "../../src/tree/layout";
import { entriesOf, locate, viewPath, type ChatLocation } from "../../src/tree/view";

export const TREE: TreeLayout = {
  agents: GLOBAL_FOLDERS.agents,
  skills: GLOBAL_FOLDERS.skills,
  prompts: GLOBAL_FOLDERS.prompts,
  notes: NOTES_FOLDER,
  tables: { area: "files", migrations: TREE_MIGRATIONS },
  chatFolder: async (db, files, user, chat, names) => {
    const at = await new TreeChats(db, { run: async (write) => write(db) }, files).place(user, chat, names);
    return join(CHATS_FOLDER, at.character, at.chat);
  },
};

/** Every file the agents of the chat at `loc` read, by its path in their view, with its text: the user's level, the chat's character level and its own. */
export async function readable(loc: ChatLocation): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const visit = async (level: LayerLevel, rest: string[]): Promise<void> => {
    const found = await locate(loc, viewPath(level, rest));
    if (!found.ok || found.at.disk === null || found.at.is !== "folder") return;
    for (const entry of await entriesOf(loc, level, rest, found.at.disk)) {
      if (entry.folder) await visit(level, [...rest, entry.name]);
      else out.set(viewPath(level, [...rest, entry.name]), await readFile(join(found.at.disk, entry.name), "utf8"));
    }
  };
  for (const level of ["global", "character", "chat"] as const) await visit(level, []);
  return out;
}
