// Reading files on the disk without changing them: a file's bytes or text, and SHA-256. Only reads:
// no folder is made, no time is touched. Folders are walked by the application's own walk
// (`src/app/archive.ts`).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

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
