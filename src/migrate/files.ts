// Reading files on the disk without changing them: a file's bytes or text, and SHA-256. Only reads:
// no folder is made, no time is touched. Folders are walked by the application's own walk
// (`src/app/archive.ts`).

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FoundFile } from "../app/archive";

/** Whether a call failed for want of the file or folder. */
export function missing(error: unknown): boolean {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
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

/**
 * The files of a folder that have exactly these paths, and no other: the folder's other entries are
 * not looked at, so a folder shared with other users' files shows none of them. A path that is no file
 * of the folder is not in the answer.
 */
export async function namedFiles(root: string, paths: readonly string[]): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  for (const path of [...paths].sort()) {
    try {
      const info = await lstat(join(root, path));
      if (info.isFile() || info.isSymbolicLink()) out.push({ path, bytes: info.size, mode: info.mode, mtimeMs: info.mtimeMs, link: info.isSymbolicLink() });
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  return out;
}
