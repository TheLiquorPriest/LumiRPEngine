// Reading a database nobody is writing, leaving nothing beside it.
//
// A database in write-ahead mode that is opened for reading the plain way gets its index file made
// beside it, and the migration must write nothing into today's folders. SQLite reads such a file as
// unchanging through a `file:` address with `immutable=1`. Bun's SQLite on Linux takes no `file:`
// address at all ("unable to open database file"), so there a private copy is read instead and
// removed at close: with no log beside it, the file alone is the whole database.

import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface QuietDb {
  db: Database;
  /** Closes the database and removes the private copy, where one was made. */
  close(): void;
}

/** Opens the database at `path`, which has no log or index beside it, for reading only. */
export function openQuiet(path: string): QuietDb {
  try {
    const db = new Database(`file:${encodeURI(path)}?immutable=1`, { readonly: true });
    return { db, close: () => db.close() };
  } catch {
    return openCopy(path);
  }
}

/** Reads a private copy of the database, in a folder of its own that only this account can read. The copy is opened for writing, since reading a write-ahead database needs its index file made beside it: beside the copy, that harms nothing. */
export function openCopy(path: string): QuietDb {
  const folder = mkdtempSync(join(tmpdir(), "rpe-read-"));
  try {
    const copy = join(folder, "copy.db");
    copyFileSync(path, copy);
    const db = new Database(copy);
    return {
      db,
      close: () => {
        db.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
