// Where Lumiverse's data folder is, as far as an app file tells: Lumiverse keeps an extension in
// `<data folder>/extensions/<identifier>/repo`, builds its files in `dist/` there, and keeps its own
// database at `<data folder>/lumiverse.db` (its `src/db/connection.ts`).

import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The file of Lumiverse's database in its data folder. */
export const LUMIVERSE_DATABASE = "lumiverse.db";

/** What an app file's place says of Lumiverse. */
export interface LumiverseFolder {
  /** Lumiverse's data folder, the one the extension sits in. */
  data: string;
  /** The extension's identifier in Lumiverse. */
  identifier: string;
  /** Its database file there; null where there is none (a Lumiverse that keeps it elsewhere). */
  database: string | null;
}

/**
 * Lumiverse's data folder, where `appFile` is the extension's own `dist/` file in it; null where it
 * is anywhere else (a copy, a checkout, RPE's own installed copy), which the command line then asks
 * about.
 */
export function lumiverseFolderOf(appFile: string): LumiverseFolder | null {
  let real: string;
  try {
    real = realpathSync(appFile);
  } catch {
    return null;
  }
  const repo = dirname(dirname(real));
  const identifierFolder = dirname(repo);
  const extensions = dirname(identifierFolder);
  if (basename(dirname(real)) !== "dist" || basename(repo) !== "repo" || basename(extensions) !== "extensions") return null;
  const data = dirname(extensions);
  const database = join(data, LUMIVERSE_DATABASE);
  return { data, identifier: basename(identifierFolder), database: existsSync(database) && statSync(database).isFile() ? database : null };
}
