// RPE's agent file tree laid over a test's folder: its database with the tree's tables, the shipped
// level laid out from two shipped folders (one standing for RPH's, one for RPE's; invented, or the
// real ones), and the kit's seed placed at each level as RPE keeps its chats. Every name and text
// here is made up.

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LayerLevel, Scope } from "rp-harness/contract";
import type { KitFile, KitSeed } from "rp-harness/testing/kit";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import { CHATS_FOLDER, type ChatFolders, layShipped, SHIPPED_FOLDER, TREE_MIGRATIONS, TreeChats, type TreeFiles, treeFiles, turnFolderName } from "../../src/tree/index";

/** The invented names the seed's chat and its character are placed under. */
export const KIT_NAMES = { character: { id: "kit-wren", name: "Wren Alder" }, chat: { name: "The Drowned Bell" } } as const;

export interface LaidTree {
  /** The tree's folder: the global level. */
  files: string;
  /** Where the shipped level's new copy is made before it moves in. */
  scratch: string;
  /** The shipped folders the level is laid out from. */
  sources: { rph: string; rpe: string };
  folders: ChatFolders;
  chats: TreeChats;
  port: TreeFiles;
  /** A level's folder on disk. */
  levelDir(level: LayerLevel): string;
  close(): Promise<void>;
}

async function put(folder: string, path: string, text: string): Promise<void> {
  const at = join(folder, path);
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, text);
}

/**
 * Makes RPE's tree under `place` for `seed.scope.user`, the seed's files at their levels. The shipped
 * level is laid out from `sources` when given (the real shipped folders); otherwise from two folders
 * under `place`, made at the first opening: RPH's holding the seed's shipped files, RPE's holding
 * `rpe`. Opening the same place again keeps what is there (the chat's folders, every file, the
 * shipped folders as a test left them) and lays the shipped level out again.
 */
export async function layTree(seed: KitSeed, place: string, options: { rpe?: readonly KitFile[]; sources?: { rph: string; rpe: string } } = {}): Promise<LaidTree> {
  const files = join(place, "files");
  const scratch = join(place, "scratch");
  const own = { rph: join(place, "shipped-rph"), rpe: join(place, "shipped-rpe") };
  const sources = options.sources ?? own;
  if (options.sources === undefined && !(await stat(own.rph).then(() => true, () => false))) {
    for (const folder of [own.rph, own.rpe]) await mkdir(folder, { recursive: true });
    for (const f of seed.files.filter((f) => f.level === "shipped")) await put(own.rph, f.path, f.text);
    for (const f of options.rpe ?? []) await put(own.rpe, f.path, f.text);
  }

  const db = openDatabase(join(place, "rpe.db"), 2_000);
  const migrations = new Migrations();
  migrations.add("files", TREE_MIGRATIONS);
  migrate(db, migrations, { version: "tree-test", backups: join(place, "backups"), now: () => 0 });
  const writes = new WriteQueue(db, 50);

  await layShipped(files, scratch, sources);
  const chats = new TreeChats(db, writes, files);
  const known = chats.folders(seed.scope.user, seed.scope.chat);
  const folders = await chats.place(seed.scope.user, seed.scope.chat, KIT_NAMES);
  const levelDir = (level: LayerLevel): string =>
    level === "shipped" ? join(files, SHIPPED_FOLDER) : level === "global" ? files : level === "character" ? join(files, CHATS_FOLDER, folders.character) : join(files, CHATS_FOLDER, folders.character, folders.chat);
  if (known === null) for (const f of seed.files.filter((f) => f.level !== "shipped")) await put(levelDir(f.level), f.path, f.text);

  let clock = 0;
  const port = treeFiles({
    files,
    user: seed.scope.user,
    chats,
    turnFolder: async (scope: Scope) => (scope.turn === undefined ? null : turnFolderName(1, scope.turn)),
    writes,
    now: () => ++clock,
  });
  return {
    files,
    scratch,
    sources,
    folders,
    chats,
    port,
    levelDir,
    async close() {
      await writes.close();
      db.close();
    },
  };
}
