// `migrate` (STANDALONE-PLAN §15.3 items 4 to 9): the real run, or the rehearsal, in one call. It reads
// today's data once, whole, and makes the report. The gate comes first: a file no row names, a row
// whose sums don't hold, an unknown user or too little disk stops the run before it writes anything,
// even its own folder. Then the backup, then each chat into RPE's store, then the report kept in
// RPE's database, where the next run finds it and says what changed since. Everything it writes is in
// RPE's data folder; today's data is only read, its own readers' writes kept in memory.
//
// Each run is a full read: a chat not yet played on RPE is replaced by what today's side holds now, a
// chat played on RPE is left as it is (`import-chats.ts`). Run it while RPE's own server is not
// running on that data folder.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dataPaths, loadConfig, prepareDataFolder } from "../app/config";
import { openDatabase } from "../app/database";
import { migrate as migrateTables, Migrations } from "../app/migrations";
import { createRegistry } from "../engine/registry-impl";
import { ALL_PACKS } from "../packs/index";
import type { WorldDoc } from "../shared/world";
import { openStore, STORE_MIGRATIONS } from "../store";
import { carry } from "./carry";
import { chatsToImport, importChats } from "./import-chats";
import type { TreePlaces } from "./own-files";
import { backupOf, reportOf } from "./rehearse";
import type { MigrationReport } from "./report";
import { importedChats, keepRun, lastReport, MIGRATE_TABLES } from "./tables";
import { openToday, type Sources } from "./today";

export interface MigrateOptions {
  /** RPE's data folder: the only place the run writes. */
  data: string;
  /** Read and report only, writing nothing anywhere. */
  rehearse?: boolean;
  /** This build's id: RPE's database is copied before the first migration of its tables a new build brings. */
  version?: string;
  now?: () => Date;
  /**
   * The folder names the file tree's layout gives the user's own files (`src/tree/layout.ts`: the
   * level's agents, skills and texts, a chat's notes), which the migration may not import. Absent: the
   * user's own files stay in the backup only, and the report says so.
   */
  tree?: Omit<TreePlaces, "root">;
}

export interface MigrateResult {
  report: MigrationReport;
  /** Whether the real run went through: false for a rehearsal, and for a run the gate stopped (`report.refusals`). */
  ran: boolean;
}

/**
 * The report of the user's last real run in RPE's database at `file`, read without changing it: under
 * SQLite's locks, or as an unchanging file where no log is there (a read-only open of a database in
 * write-ahead mode would otherwise make its index file beside it).
 */
function previousReport(file: string, user: string): MigrationReport | null {
  if (!existsSync(file)) return null;
  const quiet = !existsSync(`${file}-wal`) && !existsSync(`${file}-shm`);
  const db = quiet ? new Database(`file:${encodeURI(file)}?immutable=1`, { readonly: true }) : new Database(file, { readonly: true });
  try {
    return lastReport(db, user);
  } finally {
    db.close();
  }
}

export async function migrate(sources: Sources, options: MigrateOptions): Promise<MigrateResult> {
  const now = options.now ?? (() => new Date());
  const paths = dataPaths(options.data);
  const previous = previousReport(paths.database, sources.userId);
  const today = await openToday(sources);
  try {
    const report = await reportOf(today, { mode: options.rehearse ? "rehearsal" : "real run", target: options.data, now, ...(previous ? { previous } : {}) });
    if (options.rehearse || report.refusals.length > 0) return { report, ran: false };

    await prepareDataFolder(paths);
    const backup = await backupOf(today, paths.backups, now);
    report.backup = { path: backup.path, bytes: backup.bytes, sha256: backup.sha256 };

    const config = await loadConfig(paths, {});
    const db = openDatabase(paths.database, config.database.busyMs);
    try {
      const migrations = new Migrations();
      migrations.add("store", STORE_MIGRATIONS);
      migrations.add("migrate", MIGRATE_TABLES);
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
      const blank = { turns: 0, placed: { own: 0, shown: 0, lost: 0, head: 0 }, shares: null, placedAsShown: false, matched: { head: true, swipes: 0, of: 0 }, differences: [], dropped: 0, violations: 0 };
      report.imports = [...importChats({ store, s, db, registry, chats, earlier: importedChats(db, sources.userId), run }), ...notOpened.map((n) => ({ chatId: n.chatId, outcome: "not imported" as const, why: n.why, ...blank }))];
      const carried = await carry({ today, report, paths, db, run, tree: options.tree ? { root: paths.files, ...options.tree } : null });
      report.landed = carried.landed;
      report.carried = carried.carried;
      keepRun(db, sources.userId, run, report, (row) => report.landed?.[row as keyof typeof report.landed] ?? "");
    } finally {
      db.close();
    }
    return { report, ran: true };
  } finally {
    today.close();
  }
}
