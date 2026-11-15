// Files RPE keeps for itself (plan §4.5, §16). A file is written beside itself under a name of its
// own and renamed over the old one, which the file system does in one step, so a reader never
// meets half of it and a crash leaves the old file whole. Folders that hold secrets are made, and
// kept, enterable by their owner alone; a file is readable by its owner alone unless a caller asks
// otherwise.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

export const OWNER_ONLY_FILE = 0o600;
export const OWNER_ONLY_FOLDER = 0o700;

/** Whether a call failed for want of the file or folder. */
export function isMissing(error: unknown): boolean {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Makes `path` (and the folders above it that are missing) enterable by its owner alone. */
export async function ownerOnlyFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: OWNER_ONLY_FOLDER });
  // mkdir's mode passes through the umask, and a folder that was there keeps its own: set it outright.
  await chmod(path, OWNER_ONLY_FOLDER);
}

/** A file's text; null when there is no such file. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Writes `data` to `path` whole, in one step, with `mode` (readable by its owner alone unless said). */
export async function writeWhole(path: string, data: string | Uint8Array, mode: number = OWNER_ONLY_FILE): Promise<void> {
  const beside = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(beside, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(beside, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await chmod(beside, mode);
    await rename(beside, path);
  } catch (error) {
    await rm(beside, { force: true });
    throw error;
  }
}

/** Runs tasks one after another in the order given; one that fails does not stop the next. */
export class OneAtATime {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** The changes asked for each file, by its place on disk, the last one first. */
const FILE_TAILS = new Map<string, Promise<unknown>>();

/**
 * Runs `task`, a change to the file at `path`, after every change to it asked for before, whichever
 * part of RPE asks: a setting written from the Settings page, the model layer's connections, the Files
 * page's switch or a file it writes whole, an agent's note, the notes put back for a turn. One lock
 * per file, so two changes to it both land. A task never asks for the lock of its own file again.
 */
export function oneFileAtATime<T>(path: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(path);
  const next = (FILE_TAILS.get(key) ?? Promise.resolve()).then(task, task);
  const tail = next.catch(() => undefined);
  FILE_TAILS.set(key, tail);
  void tail.then(() => {
    if (FILE_TAILS.get(key) === tail) FILE_TAILS.delete(key);
  });
  return next;
}
