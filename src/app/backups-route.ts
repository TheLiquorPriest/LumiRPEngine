// What the backups folder holds (plan §4.5, §15.6): every copy of the database taken before a new version's migrations, every
// archive `rpe backup` made there, and every backup the migration took of today's data, each with its kind, size and date, so
// he sees what the data folder holds. RPE lists them and removes none of the archives or the migration's backups: going back
// needs them. Only the copies are kept to a number, by `database.copiesKept` (`pruneCopies`).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { COPY_PREFIX, stampOf } from "./migrations";
import { route, shape } from "./routes";

export const BACKUPS_PATH = "/api/v1/backups";

/** The kinds of file the backups folder holds, by how each name begins. */
const KINDS = [
  { kind: "copy", prefix: COPY_PREFIX },
  { kind: "migration", prefix: "rpe-migration-backup-" },
  { kind: "archive", prefix: "rpe-backup-" },
] as const;

type BackupKind = (typeof KINDS)[number]["kind"];

export interface BackupShown {
  name: string;
  kind: BackupKind;
  bytes: number;
  /** When it was made: as its name says, else its file's time (epoch milliseconds). */
  at: number;
}

const backupShown = shape.named(
  "BackupShown",
  "A file of the backups folder: its name, its kind (a copy of the database taken before a new version's migrations, an archive `rpe backup` made, or the migration's backup of today's data), its size and when it was made.",
  shape.object({ name: shape.text(), kind: shape.oneOf("copy", "migration", "archive"), bytes: shape.number(), at: shape.number() }),
);

/** Every copy and backup in `folder`, newest first. */
export async function listBackups(folder: string): Promise<BackupShown[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const shown: BackupShown[] = [];
  for (const name of names) {
    const kind = KINDS.find((k) => name.startsWith(k.prefix))?.kind;
    if (kind === undefined) continue;
    const info = await stat(join(folder, name)).catch(() => null);
    if (info === null || !info.isFile()) continue;
    shown.push({ name, kind, bytes: info.size, at: stampOf(name) ?? info.mtimeMs });
  }
  return shown.sort((a, b) => b.at - a.at);
}

/** The route that lists them. */
export function backupsRoute(folder: string) {
  return route({
    method: "GET",
    path: BACKUPS_PATH,
    access: "page",
    group: "service",
    does: "Every copy of the database taken before a migration, every archive rpe backup made in the data folder, and every backup the migration took, with its kind, size and date; RPE removes none but the copies past database.copiesKept.",
    reply: shape.named("BackupsReply", "The backups folder's files, newest first, and where the folder is.", shape.object({ folder: shape.text(), items: shape.list(backupShown) })),
    handle: async () => ({ folder, items: await listBackups(folder) }),
  });
}
