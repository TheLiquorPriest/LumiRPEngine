// Reading folders on the disk without changing them: every file under a folder with its size, its
// time and its SHA-256. Only reads: no folder is made, no time is touched.

import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** A file found under a folder: its path there (with `/`), its size, its mode and when it was last changed. `link`: a symbolic link, which is never followed. */
export interface FoundFile {
  path: string;
  bytes: number;
  mode: number;
  mtimeMs: number;
  link: boolean;
}

/** Whether a call failed for want of the file or folder. */
export function missing(error: unknown): boolean {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Every file under `root`, at any depth, sorted by path; none when there is no such folder. A
 * folder's entries that can't be listed throw: a reader that can't see a folder must not report it
 * as empty.
 */
export async function walk(root: string): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (prefix === "" && missing(error)) return;
      throw error;
    }
    for (const name of names) {
      const full = join(dir, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const info = await lstat(full);
      if (info.isDirectory()) await visit(full, path);
      else out.push({ path, bytes: info.size, mode: info.mode, mtimeMs: info.mtimeMs, link: info.isSymbolicLink() });
    }
  };
  await visit(root, "");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A file's bytes; null when there is none. */
export async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

/** A file's text as UTF-8; null when there is none. */
export async function readText(path: string): Promise<string | null> {
  const bytes = await readBytes(path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
