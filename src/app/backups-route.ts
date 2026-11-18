// What the backups folder holds (plan §4.5, §15.6): every copy of the database taken before a new version's migrations, every
// archive `rpe backup` made there, and every backup the migration took of today's data, each with its kind, size and date, so
// he sees what the data folder holds. RPE lists them and removes none of the archives or the migration's backups: going back
// needs them. Only the copies are kept to a number, by `database.copiesKept` (`pruneCopies`).

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { walk } from "./archive";
import { backupName, makeBackup } from "./backup";
import { type DataPaths, FILES_FOLDER } from "./config";
import { COPY_PREFIX, stampOf } from "./migrations";
import { type Infer, route, RouteError, shape } from "./routes";

export const BACKUPS_PATH = "/api/v1/backups";
export const BACKUP_PLAN_PATH = "/api/v1/backups/next";

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

const backupPlan = shape.named(
  "BackupPlan",
  "What a backup made now would hold, said before it is made: the name it would have, the database's size as its file stands now, how many files of the tree and how many bytes they take, and the links in the tree it leaves out (a backup holds what is in the folder, not what a link points to).",
  shape.object({ name: shape.text(), database: shape.number(), files: shape.number(), bytes: shape.number(), skipped: shape.list(shape.text()) }),
);
const backupMade = shape.named(
  "BackupMadeReply",
  "A backup made: its name in the backups folder, its size, how many files of the tree it holds beside the database, its sha256 and the links in the tree it left out.",
  shape.object({ name: shape.text(), bytes: shape.number(), files: shape.number(), sha256: shape.text(), skipped: shape.list(shape.text()) }),
);

/** What `rpe backup` would put in an archive now: the database as its file stands, and every file of the tree but the links. */
async function planBackup(paths: DataPaths, now: number): Promise<Infer<typeof backupPlan>> {
  const found = await walk(paths.files);
  const held = found.filter((f) => !f.link);
  const database = (await stat(paths.database).then((s) => s.size, () => 0)) + (await stat(`${paths.database}-wal`).then((s) => s.size, () => 0));
  return { name: backupName(now), database, files: held.length, bytes: held.reduce((n, f) => n + f.bytes, 0), skipped: found.filter((f) => f.link).map((f) => `${FILES_FOLDER}/${f.path}`) };
}

/** The routes of the backups folder: what is in it, what a backup made now would hold, and making one (the same archive `rpe backup` makes). */
export function backupsRoutes(paths: DataPaths, now: () => number) {
  return [
    route({
      method: "GET",
      path: BACKUPS_PATH,
      access: "page",
      group: "service",
      does: "Every copy of the database taken before a migration, every archive rpe backup made in the data folder, and every backup the migration took, with its kind, size and date; RPE removes none but the copies past database.copiesKept.",
      reply: shape.named("BackupsReply", "The backups folder's files, newest first, and where the folder is.", shape.object({ folder: shape.text(), items: shape.list(backupShown) })),
      handle: async () => ({ folder: paths.backups, items: await listBackups(paths.backups) }),
    }),
    route({
      method: "GET",
      path: BACKUP_PLAN_PATH,
      access: "page",
      group: "service",
      does: "What a backup made now would hold, said first: its name, the database's size, how many files of the tree and how many bytes, and the links it leaves out.",
      reply: backupPlan,
      handle: () => planBackup(paths, now()),
    }),
    route({
      method: "POST",
      path: BACKUPS_PATH,
      access: "page",
      group: "service",
      does: "Makes a backup now: the archive `rpe backup` makes, of the database (copied whole by SQLite while RPE runs) and the file tree, in the backups folder, readable by you alone and never written over another. Refused where the database is not there yet, or an archive of that second exists.",
      reply: backupMade,
      handle: async () => {
        try {
          const made = await makeBackup(paths, now());
          return { name: basename(made.path), bytes: made.bytes, files: made.files, sha256: made.sha256, skipped: made.skipped };
        } catch (error) {
          throw new RouteError(409, error instanceof Error && "code" in error && error.code === "EEXIST" ? "A backup was made this second already: wait a moment and make it again." : error instanceof Error ? error.message : String(error));
        }
      },
    }),
  ] as const;
}
