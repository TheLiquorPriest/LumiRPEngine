// `migrate` (STANDALONE-PLAN §15.3 items 4 to 9): the real run, or the rehearsal, in one call. It reads
// today's data once, whole, and makes the report. The gate comes first: a file no row names, a row
// whose sums don't hold, an unknown user, an RPE that is another user's, or too little disk stops the
// run before it writes anything, even its own folder. Then the backup, then each chat into RPE's
// store, then the report kept in RPE's database, where the next run finds it and says what changed
// since. Everything it writes is in RPE's data folder; today's data is only read, its own readers'
// writes kept in memory.
//
// Each run is a full read: a chat not yet played on RPE is replaced by what today's side holds now, a
// chat played on RPE is left as it is (`import-chats.ts`). Run it while RPE's own server is not
// running on that data folder.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dataPaths, type Env, loadConfig, prepareDataFolder } from "../app/config";
import { openDatabase } from "../app/database";
import { migrate as migrateTables, Migrations } from "../app/migrations";
import { CAST_MIGRATIONS } from "../cast";
import { createRegistry } from "../engine/registry-impl";
import { ALL_PACKS } from "../packs/index";
import type { WorldDoc } from "../shared/world";
import { openStore, STORE_MIGRATIONS } from "../store";
import { STORY_MIGRATIONS } from "../story";
import { chatCarried } from "./briefing";
import { carry } from "./carry";
import { chatsToImport, importChats } from "./import-chats";
import { type ChatNames, IMPORTED, type TreeLayout } from "./own-files";
import { backupOf, reportOf } from "./rehearse";
import { BACKUP_ONLY, type MigrationReport } from "./report";
import { NO_PLACE_YET } from "./rows";
import { importedChats, keepCarried, keepRun, lastReport, MIGRATE_TABLES, runUsers } from "./tables";
import { openToday, type Sources } from "./today";

export interface MigrateOptions {
  /** RPE's data folder: the only place the run writes. */
  data: string;
  /** Read and report only, writing nothing anywhere. */
  rehearse?: boolean;
  /** This build's id: RPE's database is copied before the first migration of its tables a new build brings. */
  version?: string;
  now?: () => Date;
  /** The environment, whose values RPE's config takes over its file's: here, which Lumiverse user this RPE belongs to. */
  env?: Env;
  /**
   * The file tree as its layout gives it (`src/tree`), which the migration may not import: the folder
   * names of the user's own files, the tree's tables, and where a chat's own folder is. Absent: the
   * user's own files stay in the backup only, and the report says so.
   */
  tree?: TreeLayout;
}

export interface MigrateResult {
  report: MigrationReport;
  /** Whether the real run went through: false for a rehearsal, and for a run the gate stopped (`report.refusals`). */
  ran: boolean;
}

/**
 * What RPE's database at `file` says of earlier runs, read without changing it: the report of the
 * user's last real run, and every user an earlier run carried. Read under SQLite's locks, or as an
 * unchanging file where no log is there (a read-only open of a database in write-ahead mode would
 * otherwise make its index file beside it).
 */
export function earlierRuns(file: string, user: string): { previous: MigrationReport | null; users: string[] } {
  if (!existsSync(file)) return { previous: null, users: [] };
  const quiet = !existsSync(`${file}-wal`) && !existsSync(`${file}-shm`);
  const db = quiet ? new Database(`file:${encodeURI(file)}?immutable=1`, { readonly: true }) : new Database(file, { readonly: true });
  try {
    return { previous: lastReport(db, user), users: runUsers(db) };
  } finally {
    db.close();
  }
}

export async function migrate(sources: Sources, options: MigrateOptions): Promise<MigrateResult> {
  const now = options.now ?? (() => new Date());
  const paths = dataPaths(options.data);
  // Whose RPE this is, read before anything is written: the user its config names, and the users earlier runs carried.
  const config = await loadConfig(paths, options.env ?? {});
  const { previous, users } = earlierRuns(paths.database, sources.userId);
  const today = await openToday(sources);
  try {
    const report = await reportOf(today, { mode: options.rehearse ? "rehearsal" : "real run", target: options.data, now, rpe: { owner: config.lumiverse.user, earlier: users }, tree: options.tree !== undefined, ...(previous ? { previous } : {}) });
    if (options.rehearse || report.refusals.length > 0) return { report, ran: false };

    await prepareDataFolder(paths);
    const backup = await backupOf(today, paths.backups, now);
    report.backup = { path: backup.path, bytes: backup.bytes, sha256: backup.sha256 };

    const db = openDatabase(paths.database, config.database.busyMs);
    try {
      const migrations = new Migrations();
      migrations.add("store", STORE_MIGRATIONS);
      // The cast and the story record take what today's build recorded beside each turn: the mind files, the beats, the castings and the drafts.
      migrations.add("cast", CAST_MIGRATIONS);
      migrations.add("story", STORY_MIGRATIONS);
      migrations.add("migrate", MIGRATE_TABLES);
      // A chat's folders are chosen once and kept in the tree's tables, which the server reads as well.
      if (options.tree) migrations.add(options.tree.tables.area, options.tree.tables.migrations);
      migrateTables(db, migrations, { version: options.version ?? "dev", backups: paths.backups, now: () => now().getTime() });
      const registry = createRegistry(ALL_PACKS);
      const { chats, notOpened } = await chatsToImport(today);
      const worlds = new Map<string, WorldDoc>();
      for (const c of chats) {
        for (const r of c.revisions) {
          const doc = c.input.worlds(r);
          if (doc) worlds.set(r, doc);
        }
      }
      const store = openStore({ db, registry, worlds: (r) => worlds.get(r) });
      const s = store.user(sources.userId);
      const run = crypto.randomUUID();
      report.imports = importChats({ store, s, db, registry, chats, notOpened, present: new Set(today.chats.map((c) => c.id)), earlier: importedChats(db, sources.userId), run });
      const layout = options.tree;
      const tree = layout ? { root: paths.files, agents: layout.agents, skills: layout.skills, prompts: layout.prompts, notes: layout.notes, chat: (chat: string, names: ChatNames) => layout.chatFolder(db, paths.files, sources.userId, chat, names), played: (chat: string) => s.chat(chat) !== null && s.isPlayed(chat) } : null;
      const carried = await carry({ today, report, paths, db, store, s, run, now: now().getTime(), tree });
      report.landed = carried.landed;
      report.carried = carried.carried;
      // What it carried of each chat it imported, for the chat's first briefing on RPE and the Migration page.
      const notes = layout ? `${layout.notes}/${IMPORTED}` : null;
      for (const c of report.imports) if (c.outcome === "imported" || c.outcome === "replaced") keepCarried(db, sources.userId, c.chatId, chatCarried(report, c.chatId, notes));
      // The store keeps the world revisions the run carried (its `world_file` table, left as it is), so a migrated chat's world can be read and written to.
      const kept = s.copyMigratedWorlds();
      report.worldsInStore = { added: kept.added, held: kept.held, unreadable: kept.unreadable.length };
      for (const u of kept.unreadable) report.unreadable.push({ path: `RPE's database: world_file ${u.world}/rev/${u.revision}.json`, why: "a world revision the run carried that doesn't read as a world document, so RPE's store doesn't keep it" });
      keepRun(db, sources.userId, run, report, (row) => report.landed?.[row as keyof typeof report.landed] ?? (Object.hasOwn(NO_PLACE_YET, row) ? BACKUP_ONLY : ""));
    } finally {
      db.close();
    }
    return { report, ran: true };
  } finally {
    today.close();
  }
}
