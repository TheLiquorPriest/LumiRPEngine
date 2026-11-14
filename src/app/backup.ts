// `rpe backup` (plan §4.5): one archive of the database and the file tree, made while RPE runs. SQLite
// copies the database itself, whole and consistent with the log's committed pages, and the copy and
// every file of the tree go into one plain tar (the migration's own format, `src/migrate/tar.ts`),
// which `tar -xf` restores on any machine. The archive is readable by its owner alone and is never
// written over.

import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "../migrate/files";
import { TarWriter } from "../migrate/tar";
import type { DataPaths } from "./config";
import { DATABASE_FILE, FILES_FOLDER } from "./config";
import { OWNER_ONLY_FILE, ownerOnlyFolder } from "./disk";

export interface BackupMade {
  path: string;
  bytes: number;
  sha256: string;
  /** Files of the tree in it. */
  files: number;
  /** Links in the tree, which are left out: a backup holds what is in the folder, not what a link points to. */
  skipped: string[];
}

/** The archive's name for a time: `rpe-backup-20261113T120000Z.tar`. */
export function backupName(at: number): string {
  return `rpe-backup-${new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.tar`;
}

/** Makes the archive at `out`, or in the backups folder under a name from the time. */
export async function makeBackup(paths: DataPaths, now: number, out?: string): Promise<BackupMade> {
  if (!existsSync(paths.database)) throw new Error(`There is no database at ${paths.database}: RPE has not run on this data folder yet.`);
  await ownerOnlyFolder(paths.backups);
  const path = out ?? join(paths.backups, backupName(now));
  // Made first, empty and private: the archive is never another's to read, and never written over one.
  const made = await open(path, "wx", OWNER_ONLY_FILE);
  await made.close();
  const copy = join(paths.backups, `.copy-${randomBytes(6).toString("hex")}.db`);
  try {
    const db = new Database(paths.database, { readonly: true });
    try {
      db.run("VACUUM INTO ?", [copy]);
    } finally {
      db.close();
    }
    const tar = TarWriter.open(path);
    await tar.add(DATABASE_FILE, await Bun.file(copy).bytes(), (await stat(copy)).mtimeMs / 1000, OWNER_ONLY_FILE);
    let files = 0;
    const skipped: string[] = [];
    for (const found of await walk(paths.files)) {
      const name = `${FILES_FOLDER}/${found.path}`;
      if (found.link) {
        skipped.push(name);
        continue;
      }
      await tar.add(name, await Bun.file(join(paths.files, found.path)).bytes(), found.mtimeMs / 1000, found.mode);
      files++;
    }
    const closed = await tar.close();
    await chmod(path, OWNER_ONLY_FILE);
    return { path, bytes: closed.bytes, sha256: closed.sha256, files, skipped };
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    await rm(copy, { force: true });
  }
}
