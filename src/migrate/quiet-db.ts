// Reading a database nobody is writing, leaving nothing beside it.
//
// A database in write-ahead mode that is opened for reading the plain way gets its index file made
// beside it, and the migration must write nothing into today's folders. SQLite reads such a file as
// unchanging through a `file:` address with `immutable=1`. Bun's SQLite on Linux takes no `file:`
// address at all ("unable to open database file"), so there the file's bytes are read into a copy in
// memory, which is the whole database where no log is beside it. The copy lives in memory only: no
// file of it is ever made, so no path out of a read, a failing caller's included, can leave one in a
// temporary folder.

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

export interface QuietDb {
  db: Database;
  /** Closes the database; a copy in memory goes with it. */
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

/**
 * Reads the database as a private copy in memory. The file header says write-ahead log (bytes 18 and
 * 19 are 2), and a copy in memory can't keep a log, so the copy is read as an ordinary file: there is
 * no log beside the original, so its pages are all there is.
 */
export function openCopy(path: string): QuietDb {
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length > 19 && bytes[18] === 2 && bytes[19] === 2) {
    bytes[18] = 1;
    bytes[19] = 1;
  }
  const db = Database.deserialize(bytes, true);
  return { db, close: () => db.close() };
}
