// What Build's tests share: a temporary database with the store's, the migration's and Build's
// tables, the application's write queue over it, RPE's store, and a log the test can read. Every
// world, chat and user here is invented.

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import type { JsonValue, Log } from "rp-harness/contract";
import { LiveHub, WriteQueue } from "../../src/app";
import type { Migration } from "../../src/app/migrations";
import { BUILD_MIGRATIONS } from "../../src/build/schema";
import { JobHome } from "../../src/build/jobs/home";
import { labRunners } from "../../src/build/jobs/lab";
import { JOB_LIMIT_DEFAULTS } from "../../src/build/jobs/limits";
import * as lane from "../../src/worker/background-lane";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { MIGRATE_TABLES } from "../../src/migrate/tables";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { JobSummary } from "../../src/shared/jobs";
import type { WorldDoc } from "../../src/shared/world";
import { migrateStore, openStore, type Store, storedWorlds } from "../../src/store";
import { WorldService } from "../../src/worlds/service";

export const USER = "user-ash";
export const OTHER = "user-birch";

let shared: Registry | null = null;
/** The shipped packs' registry, built once per test file. */
export function registry(): Registry {
  shared ??= createRegistry(ALL_PACKS);
  return shared;
}

/** A starter world as `lre.world create` makes one from its template. */
export function starter(template: string, name: string): WorldDoc {
  const make = STARTER_WORLDS[template];
  if (make === undefined) throw new Error(`no starter world ${template}`);
  return make("", name);
}

export interface Bed {
  db: Database;
  writes: WriteQueue;
  store: Store;
  logs: { level: string; message: string; fields?: Record<string, JsonValue> }[];
  log: Log;
}

function run(db: Database, migrations: readonly Migration[]): void {
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if ("sql" in m) db.run(m.sql);
    else m.up(db, USER);
  }
}

export function makeBed(): Bed {
  const db = new Database(":memory:");
  migrateStore(db);
  run(db, MIGRATE_TABLES);
  run(db, BUILD_MIGRATIONS);
  const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
  // Made last: from here on the database takes writes only through the queue, as in the application.
  const writes = new WriteQueue(db, 10);
  const logs: Bed["logs"] = [];
  const line =
    (level: string) =>
    (message: string, fields?: Record<string, JsonValue>): void =>
      void logs.push({ level, message, ...(fields === undefined ? {} : { fields }) });
  return { db, writes, store, logs, log: { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") } };
}

/** The repository's shipped guidance. */
export const GUIDANCE = resolve(import.meta.dir, "../../guidance");

/** The world service over a bed's store, with the chats it plays told to no page. */
export function worldsOn(bed: Bed): WorldService {
  const chats = { live: new LiveHub({ queueEvents: 16, now: () => 0 }), turning: () => false, name: async () => null };
  return new WorldService({ store: bed.store, writes: bed.writes, log: bed.log, chats });
}

/** Build's job home over a bed, with the kept worker's steps run in this process (a test of the page needs no thread): `told` hears each change of a job. */
export function jobHomeOn(bed: Bed, worlds: WorldService, told: (job: JobSummary) => void = () => undefined): JobHome {
  const workers = { run: async (task: "labStep" | "labLint", input: never) => (task === "labStep" ? lane.labStep(input) : lane.labLint(input)) } as never;
  return new JobHome({ db: bed.db, writes: bed.writes, log: bed.log, limits: async () => JOB_LIMIT_DEFAULTS, runners: labRunners({ worlds, store: bed.store, workers }), told: (_user, job) => told(job) });
}
