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

import type { Setting } from "../app/setting-list";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { NO_OWNER } from "../app/auth";
import { type DataPaths, dataPaths, type Env, loadConfig, prepareDataFolder } from "../app/config";
import { openDatabase } from "../app/database";
import { migrate as migrateTables, Migrations } from "../app/migrations";
import { diskTexts, readConfig } from "../app/config-read";
import { BUILD_MIGRATIONS } from "../build/schema";
import { CAST_MIGRATIONS, CAST_STORE_AREA } from "../cast";
import { createRegistry } from "../engine/registry-impl";
import { LORE_MIGRATIONS } from "../lore";
import { ALL_PACKS } from "../packs/index";
import type { WorldDoc } from "../shared/world";
import { openStore, STORE_MIGRATIONS } from "../store";
import { STORY_MIGRATIONS, STORY_STORE_AREA } from "../story";
import { chatCarried } from "./briefing";
import { carry, placesOf } from "./carry";
import { checkConnectionsSteady } from "./connections";
import { type CarriedRuns, chatsToImport, importChats } from "./import-chats";
import { type ChatNames, type TreeLayout } from "./own-files";
import { openQuiet } from "./quiet-db";
import { backupOf, reportOf } from "./rehearse";
import { BACKUP_ONLY, chatEndOf, insideEnds, type MigrationReport, recountRows, refusalsOf } from "./report";
import { MIGRATE_SETTINGS, type OwnerRow, ownerRowsOf } from "./setting-list";
import { NO_PLACE_YET } from "./rows";
import { followWorlds } from "./worlds";
import { answersOf, importedChats, keepCarried, keepRun, lastReport, MIGRATE_TABLES, runUsers } from "./tables";
import type { PauseAnswer } from "./answers";
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
  /** Every setting RPE's areas and RPH declare (the app's one registry), which takes each value the run carries as its own reader takes it. Absent: RPH's own and the update's only are known, and another key is written as it is. */
  settings?: readonly Setting[];
  /** The turn lane's writer of a carried turn's run record (`keepCarriedRun`) and its tables, which the migration may not import: each imported turn's reply as released and its departures. Absent: no run record is kept. */
  runs?: CarriedRuns;
}

export interface MigrateResult {
  report: MigrationReport;
  /** Whether the real run went through: false for a rehearsal, and for a run the gate stopped (`report.refusals`). */
  ran: boolean;
}

/**
 * What RPE's database at `file` says of earlier runs, read without changing it: the report of the
 * user's last real run, every user an earlier run carried, and his answers to the questions today's
 * build left chats paused on. Read under SQLite's locks, or as an unchanging file where no log is
 * there (a read-only open of a database in write-ahead mode would otherwise make its index file beside it).
 */
export function earlierRuns(file: string, user: string): { previous: MigrationReport | null; users: string[]; answers: PauseAnswer[] } {
  if (!existsSync(file)) return { previous: null, users: [], answers: [] };
  const quiet = !existsSync(`${file}-wal`) && !existsSync(`${file}-shm`);
  const locked = quiet ? null : new Database(file, { readonly: true });
  const opened = locked === null ? openQuiet(file) : { db: locked, close: () => locked.close() };
  try {
    return { previous: lastReport(opened.db, user), users: runUsers(opened.db), answers: answersOf(opened.db, user) };
  } finally {
    opened.close();
  }
}

/** The rows he gave (`migration.rows` in his `RPE-global.yml`), read without changing anything; none where there is no file or none given. */
export async function rowsGiven(paths: Pick<DataPaths, "globalConfig">): Promise<OwnerRow[]> {
  const read = readConfig(await diskTexts([{ level: "global", file: paths.globalConfig, disk: paths.globalConfig }]), null, MIGRATE_SETTINGS);
  return MIGRATE_SETTINGS.flatMap((def) => ownerRowsOf(read.read(def).value));
}

/**
 * A real run that failed after the gate let it write. Today's data was only read; whatever it wrote is RPE's own, and the backup
 * it took stands. Each chat's import is one transaction and every run reads today's data whole, so the next run finishes the work
 * and writes nothing twice.
 */
export class MigrationStopped extends Error {
  constructor(
    readonly step: string,
    cause: unknown,
  ) {
    super(`while ${step}: ${cause instanceof Error ? cause.message : String(cause)}. The previous build's data is as it was and the backup it took is kept; run again, and the run finishes what this one left, with nothing duplicated`, { cause });
    this.name = "MigrationStopped";
  }
}

/**
 * A rehearsal for RPE's own Migration page (R-180): the read `rpe migrate --rehearse` makes, with the real run's gate, writing
 * nothing anywhere, RPE's database included, which it reads through the running RPE's own connection (`db`). `owner` is the
 * Lumiverse user RPE's config names. It gives the chats' names as Lumiverse holds them besides, which the page shows and the
 * report never holds.
 */
export async function rehearsal(sources: Sources, options: { data: string; db: Database; owner: string | null; now?: () => Date }): Promise<{ report: MigrationReport; names: Map<string, string> }> {
  const paths = dataPaths(options.data);
  const previous = lastReport(options.db, sources.userId);
  const today = await openToday(sources);
  try {
    today.reader.useAnswers(answersOf(options.db, sources.userId));
    const report = await reportOf(today, { mode: "rehearsal", target: options.data, ...(options.now ? { now: options.now } : {}), rpe: { owner: options.owner, earlier: runUsers(options.db) }, tree: true, jobs: true, given: await rowsGiven(paths), ...(previous ? { previous } : {}) });
    return { report, names: new Map(today.chats.map((c) => [c.id, c.name])) };
  } finally {
    today.close();
  }
}

export async function migrate(sources: Sources, options: MigrateOptions): Promise<MigrateResult> {
  const now = options.now ?? (() => new Date());
  const paths = dataPaths(options.data);
  // Whose RPE this is, read before anything is written: the user its config names, and the users earlier runs carried.
  const config = await loadConfig(paths, options.env ?? {});
  const { previous, users, answers } = earlierRuns(paths.database, sources.userId);
  // Where a failed run stopped, once the gate has let it write: null before that, where a failure leaves nothing written.
  let step: string | null = null;
  const today = await openToday(sources);
  try {
    // His answers given in RPE to the questions chats were paused on, written as today's build writes them over the stand-in.
    today.reader.useAnswers(answers);
    const report = await reportOf(today, { mode: options.rehearse ? "rehearsal" : "real run", target: options.data, now, rpe: { owner: config.lumiverse.user, earlier: users }, tree: options.tree !== undefined, jobs: options.runs?.keepJob !== undefined, given: await rowsGiven(paths), ...(previous ? { previous } : {}) });
    if (options.rehearse || report.refusals.length > 0) return { report, ran: false };
    // No row is written without its user (R-179): with none named, nothing is, the data folder, the backup and the config included.
    const owner = config.lumiverse.user;
    if (owner === null || owner === "") throw new Error(NO_OWNER);
    // The runtime's connections and secrets files are read once more as the carry will read them: one changed since the run counted it stops the run now, with nothing written.
    const taking = today.runtime.runtimes[0]?.name;
    if (taking !== undefined) await checkConnectionsSteady(taking, today.runtime.files);

    step = "preparing RPE's data folder";
    await prepareDataFolder(paths);
    step = "taking the backup";
    const backup = await backupOf(today, paths.backups, config.database.pieceBytes, now);
    report.backup = { path: backup.path, bytes: backup.bytes, sha256: backup.sha256 };

    step = "opening RPE's database";
    const db = openDatabase(paths.database, config.database.busyMs);
    try {
      const migrations = new Migrations();
      migrations.add("store", STORE_MIGRATIONS);
      // The cast and the story record take what today's build recorded beside each turn: the mind files, the beats, the castings and the drafts.
      migrations.add("cast", CAST_MIGRATIONS);
      migrations.add("story", STORY_MIGRATIONS);
      migrations.add("lore", LORE_MIGRATIONS);
      migrations.add("migrate", MIGRATE_TABLES);
      // Build keeps the worlds as it edits them in a table of its own, which a run fills with what it carried.
      migrations.add("build", BUILD_MIGRATIONS);
      // A chat's folders are chosen once and kept in the tree's tables, which the server reads as well.
      if (options.tree) migrations.add(options.tree.tables.area, options.tree.tables.migrations);
      // Each carried turn's run record goes in the turn lane's table, which the server reads as well.
      if (options.runs) migrations.add(options.runs.tables.area, options.runs.tables.migrations);
      migrateTables(db, migrations, { user: owner, version: options.version ?? "dev", backups: paths.backups, now: () => now().getTime() });
      step = "reading the chats as the previous build does";
      const registry = createRegistry(ALL_PACKS);
      const { chats, notOpened } = await chatsToImport(today);
      const worlds = new Map<string, WorldDoc>();
      for (const c of chats) {
        for (const r of c.revisions) {
          const doc = c.input.worlds(r);
          if (doc) worlds.set(r, doc);
        }
      }
      const store = openStore({ db, registry, worlds: (r) => worlds.get(r), areas: [CAST_STORE_AREA, STORY_STORE_AREA] });
      step = "importing the chats";
      const s = store.user(sources.userId);
      const run = crypto.randomUUID();
      report.imports = importChats({ store, s, db, registry, chats, notOpened, present: new Set(today.chats.map((c) => c.id)), earlier: importedChats(db, sources.userId), run, ...(options.runs ? { keepRun: options.runs.keep } : {}) });
      step = "carrying the worlds, files, settings and connections";
      const layout = options.tree;
      const tree = layout
        ? {
            root: paths.files,
            agents: layout.agents,
            skills: layout.skills,
            prompts: layout.prompts,
            notes: layout.notes,
            chat: (chat: string, names: ChatNames) => layout.chatFolder(db, paths.files, sources.userId, chat, names),
            played: (chat: string) => s.chat(chat) !== null && s.isPlayed(chat),
            recordVersion: (chat: string, turn: string, path: string, before: string | null, after: string | null, definition: string, at: number, stands: boolean) => layout.recordVersion(db, paths.files, sources.userId, chat, turn, path, before, after, { id: "carried", definition }, at, stands),
            forgetVersions: (chat: string) => layout.forgetVersions(db, paths.files, sources.userId, chat),
            ...(layout.toolNames === undefined ? {} : { toolNames: layout.toolNames.bind(layout, paths.files) }),
          }
        : null;
      const carried = await carry({ today, report, paths, db, store, s, run, now: now().getTime(), tree, plays: new Set(worlds.keys()), ...(options.settings ? { settings: options.settings } : {}), ...(options.runs?.keepJob ? { keepJob: options.runs.keepJob } : {}) });
      report.landed = carried.landed;
      report.carried = carried.carried;
      // What it carried of each chat it imported, over the chat's whole path, for the chat's first briefing on RPE and the Migration page.
      step = "keeping what was carried of each chat";
      const notes = layout ? layout.notes : null;
      for (const c of report.imports) if (c.outcome === "imported" || c.outcome === "replaced") keepCarried(db, sources.userId, c.chatId, chatCarried({ report, db, s, chat: c.chatId, notes }));
      // The store keeps the worlds the run carried, which Build and play read: what today's side changed since a run put it is followed where RPE's copy is still the run's, and what he changed or removed in RPE stays (R-79).
      step = "keeping the worlds the chats play";
      const kept = followWorlds(db, s.worlds, sources.userId);
      report.worldsInStore = { added: kept.added, held: kept.held, unreadable: kept.unreadable.length, copied: kept.copied, followed: kept.followed, kept: kept.kept, removed: kept.removed };
      for (const u of kept.unreadable) report.unreadable.push({ path: `RPE's database: world_file ${u.world}/rev/${u.revision}.json`, why: "a world revision the run carried that doesn't read as a world document, so RPE's store doesn't keep it" });
      // Each row counted again from what the run did (R-320, R-321): what of a chat it did not carry is not carried, and is named; what then does not balance is said, and the swap reads it.
      step = "counting what the run did";
      const placeOf = await placesOf(today, report.items, layout !== undefined, options.runs?.keepJob !== undefined);
      const end = chatEndOf(report, (chat) => s.chat(chat) !== null);
      recountRows(report, (i) => (i.fate === "carried" || i.fate === "attached" ? placeOf(i) : undefined), end);
      insideEnds(report, end, layout !== undefined);
      report.refusals = refusalsOf(report, { user: sources.userId, known: true, owner: null, earlier: [] }, { missing: null, undecided: null });
      step = "recording the run";
      keepRun(db, sources.userId, run, report, (row) => report.landed?.[row as keyof typeof report.landed] ?? (Object.hasOwn(NO_PLACE_YET, row) ? BACKUP_ONLY : ""));
    } finally {
      db.close();
    }
    return { report, ran: true };
  } catch (error) {
    // A failure once the run was writing says where it stopped: today's data is untouched, the backup stays, and the next run takes everything again from the start.
    if (step === null) throw error;
    throw new MigrationStopped(step, error);
  } finally {
    today.close();
  }
}
