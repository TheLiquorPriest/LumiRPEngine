// What Build's tests share: a temporary database with the store's, the migration's and Build's
// tables, the application's write queue over it, RPE's store, and a log the test can read. Every
// world, chat and user here is invented.

import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonValue, Log } from "rp-harness/contract";
import { WriteQueue } from "../../src/app";
import type { Migration } from "../../src/app/migrations";
import { BUILD_MIGRATIONS } from "../../src/build/schema";
import { type BuildAnswer, buildRoutes, BuildService } from "../../src/build/index";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { MIGRATE_TABLES } from "../../src/migrate/tables";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { ErrorMessage, ResultBodies, ResultMessage } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { migrateStore, openStore, readPart, type Store, storedWorlds } from "../../src/store";

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
    else m.up(db);
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

/** The repository's shipped guidance, where Build's words are. */
export const GUIDANCE = resolve(import.meta.dir, "../../guidance");

/** A line of Build's words as the shipped file has it, filled with `fields`. */
export function words(name: string, fields: Record<string, unknown> = {}): string {
  const part = readPart(readFileSync(join(GUIDANCE, ".prompts", "build-answers.md"), "utf8"));
  const template = part.lines.get(name);
  if (template === undefined) throw new Error(`no line ${name}`);
  return template.render(part.header, fields);
}

/** The body of an `lre.result` answering `request`, checked to be one. */
export function body<K extends keyof ResultBodies>(answer: BuildAnswer, request: K): ResultBodies[K] {
  const result = answer.result as ResultMessage;
  expect({ type: result.type, request: result.request, lre: result.lre }).toEqual({ type: "lre.result", request, lre: 1 });
  return result.body as ResultBodies[K];
}

/** The `lre.error` an answer is, checked to be one. */
export function refusal(answer: BuildAnswer): ErrorMessage {
  expect(answer.result.type).toBe("lre.error");
  return answer.result as ErrorMessage;
}

/** A page of the owner's, sending today's messages to Build's route. */
export interface Page {
  service: BuildService;
  /** Sends one message (its `lre` and `reqId` added) as `user`, through the route's own reader and handler. */
  send(message: Record<string, unknown>, user?: string): Promise<BuildAnswer>;
}

let asked = 0;

export function makePage(bed: Bed, service = new BuildService({ db: bed.db, writes: bed.writes, store: bed.store, log: bed.log, guidance: GUIDANCE })): Page {
  const [post] = buildRoutes(service);
  return {
    service,
    async send(message, user = USER) {
      if (post.body === undefined) throw new Error("Build's route reads no body");
      const body = post.body({ lre: 1, reqId: `req-${++asked}`, ...message });
      return post.handle({ params: {}, query: new URLSearchParams(), body, user, request: new Request("http://rpe.test/api/v1/build", { method: "POST" }), signal: new AbortController().signal });
    },
  };
}
