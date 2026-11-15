// What the data folder holds besides RPE's own data, so that one process writes it at a time (plan
// §4.1 "One writer"): its lock and the socket the running server answers the command line on.
//
// The lock is held by whoever writes: the running server for as long as it runs, and a command that
// changes something for as long as it writes, while RPE is stopped. It is a file of SQLite's own
// (`BEGIN EXCLUSIVE` on a database nobody else uses), so the system lets it go when the process that
// holds it ends however it ends, and no stale lock is left behind; a file beside it says who holds it,
// for the words a waiter prints. Waiting is polled, never blocking the process.

import { Database } from "bun:sqlite";
import { chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../shared/json";
import { OWNER_ONLY_FILE, ownerOnlyFolder, readText, writeWhole } from "./disk";

export const LOCK_FILE = "lock.db";
export const LOCK_HOLDER_FILE = "lock.holder";
export const COMMAND_SOCKET_FILE = "command.sock";

/** The Unix socket the running server answers the command line on: in the data folder, openable by its owner alone. */
export function commandSocketPath(root: string): string {
  return join(root, COMMAND_SOCKET_FILE);
}

/** Who holds the lock, as the holder wrote it. */
export interface LockHolder {
  pid: number;
  /** What the holder is doing, in the words a waiter prints: `rpe serve`, `rpe key`. */
  what: string;
  /** When it took the lock, epoch milliseconds. */
  since: number;
}

/** The lock stayed with another process for the whole wait. */
export class DataFolderBusy extends Error {
  override name = "DataFolderBusy";
  constructor(
    readonly root: string,
    readonly holder: LockHolder | null,
    readonly waitedMs: number,
  ) {
    super(`The data folder ${root} is held by ${holder === null ? "another rpe process" : `${holder.what} (process ${holder.pid})`}, which did not let go in ${waitedMs < 1000 ? `${waitedMs} ms` : `${waitedMs / 1000} s`}: run this again once it has finished.`);
  }
}

/** A lock taken; `release` lets it go (a second call does nothing). */
export interface FolderLock {
  readonly what: string;
  release(): void;
}

export interface LockOptions {
  /** How long to wait for the holder, in milliseconds (`commandLine.waitMs`); 0 tries once. */
  waitMs: number;
  /** How often to try again while waiting; 25 ms where not given. */
  pollMs?: number;
  /** The moment written as the holder's own `since`; the real clock where not given. The wait itself is always real time. */
  now?: () => number;
  /** Called once, when the lock is held by another, with who holds it: the words that say why the process waits. */
  onWait?: (holder: LockHolder | null) => void;
}

/** The holder as its file says; null where there is none or it cannot be read. */
export async function lockHolder(root: string): Promise<LockHolder | null> {
  try {
    const text = await readText(join(root, LOCK_HOLDER_FILE));
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    return isRecord(value) && typeof value.pid === "number" && typeof value.what === "string" && typeof value.since === "number" ? { pid: value.pid, what: value.what, since: value.since } : null;
  } catch {
    return null;
  }
}

const busy = (error: unknown): boolean => error instanceof Error && (("code" in error && error.code === "SQLITE_BUSY") || /database is locked/i.test(error.message));

/**
 * Takes the data folder's lock for `what`, waiting up to `options.waitMs` for another holder; throws
 * `DataFolderBusy` when it is still held then. The folder is made (readable by its owner alone) where
 * it is not there yet.
 */
export async function takeFolderLock(root: string, what: string, options: LockOptions): Promise<FolderLock> {
  await ownerOnlyFolder(root);
  const db = new Database(join(root, LOCK_FILE), { create: true });
  try {
    chmodSync(join(root, LOCK_FILE), OWNER_ONLY_FILE);
    // Waiting is this function's own, so that it can say why.
    db.run("PRAGMA busy_timeout = 0");
  } catch (error) {
    db.close();
    throw error;
  }
  const poll = options.pollMs ?? 25;
  const began = performance.now();
  let said = false;
  for (;;) {
    try {
      db.run("BEGIN EXCLUSIVE");
      break;
    } catch (error) {
      if (!busy(error)) {
        db.close();
        throw error;
      }
    }
    const holder = await lockHolder(root);
    if (!said) {
      said = true;
      options.onWait?.(holder);
    }
    const waited = performance.now() - began;
    if (waited >= options.waitMs) {
      db.close();
      throw new DataFolderBusy(root, holder, options.waitMs);
    }
    await Bun.sleep(Math.min(poll, Math.max(1, options.waitMs - waited)));
  }
  const holderFile = join(root, LOCK_HOLDER_FILE);
  try {
    await writeWhole(holderFile, `${JSON.stringify({ pid: process.pid, what, since: (options.now ?? Date.now)() } satisfies LockHolder)}\n`);
  } catch (error) {
    db.run("ROLLBACK");
    db.close();
    throw error;
  }
  let held = true;
  return {
    what,
    release() {
      if (!held) return;
      held = false;
      // The name goes while the lock is still ours: no waiter reads a holder that has let go.
      rmSync(holderFile, { force: true });
      db.run("ROLLBACK");
      db.close();
    },
  };
}
