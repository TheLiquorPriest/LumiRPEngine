// RPH's small durable state (`StorePort` in `rp-harness/contract`; plan Appendix B, `kv`): JSON values
// by key, each read and written whole, in RPE's database, each one a user's: every call names the user
// in its scope, and one user's values are never read, listed or changed for another. Reads go straight
// to the database; every change goes through the application's write queue, so changes to one user's
// key run one at a time, each seeing the last one's result, and counts kept by agents running at once
// add up. Its typed part, RPH's job records, is a table of its own (`job`).

import type { Database } from "bun:sqlite";
import type { JobPage, JobQuery, JobRecords, JobView, JsonValue, StorePort, UserScope } from "rp-harness/contract";

/** How RPE's database takes a write: the application's write queue. */
export interface Writes {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function checked(key: string): string {
  const segments = key.split("/");
  if (!segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) throw new Error(`A store key is segments of letters, digits, ".", "_" and "-" joined by "/": ${JSON.stringify(key)}.`);
  return key;
}

/** The user this RPE serves, read when asked: none yet (null or empty) refuses the call, as the file port does. */
export function servedUser(owner: () => string | null): string {
  const user = owner();
  if (user === null || user === "") throw new Error("This RPE belongs to no Lumiverse user yet: set lumiverse.user in its config.json.");
  return user;
}

/** The user a call's scope names: a scope that names none keeps and gives nothing (READINGS R-179: no row is written without a user). */
function userOf(scope: UserScope): string {
  if (scope.user === "") throw new Error("A store call's scope names no user, so nothing is kept or read for it.");
  return scope.user;
}

/** The users RPH's state holds values or job records of, each once: whose jobs a restart may have cut off. */
export function storeUsers(db: Database): string[] {
  return db
    .query<{ user: string }, []>("SELECT user FROM kv UNION SELECT user FROM job ORDER BY user")
    .all()
    .map((r) => r.user);
}

/** Where a job's record stands in a page's order, the latest started first: what a page's `next` names, its last record's. */
function placeOf(job: Pick<JobView, "started" | "id">): string {
  return `${job.started}~${job.id}`;
}

function placeIn(cursor: string): { started: number; id: string } {
  const at = cursor.indexOf("~");
  const started = at < 0 ? Number.NaN : Number(cursor.slice(0, at));
  if (Number.isNaN(started)) throw new Error(`${JSON.stringify(cursor)} is not where a page of jobs begins: a cursor is the next of the page before.`);
  return { started, id: cursor.slice(at + 1) };
}

/**
 * The store's typed part for RPH's job records (Appendix B, the `job` table): each record whole, under its user and id, with its
 * start, chat and state beside it so a page is chosen and ordered in the database and only that page is read.
 */
function jobRecords(db: Database, writes: Writes): JobRecords {
  return {
    async get(scope, id) {
      const row = db.query<{ value: string }, [string, string]>("SELECT value FROM job WHERE user = ? AND id = ?").get(userOf(scope), id);
      return row === null ? undefined : (JSON.parse(row.value) as JobView);
    },
    async set(scope, job) {
      const user = userOf(scope);
      const row = [user, job.id, job.started, job.scope.chat, job.state, JSON.stringify(job)];
      await writes.run(
        (into) =>
          into.run(
            "INSERT INTO job (user, id, started, chat, state, value) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user, id) DO UPDATE SET started = excluded.started, chat = excluded.chat, state = excluded.state, value = excluded.value",
            row,
          ),
        "keeping a job's record",
      );
    },
    async list(scope, query: JobQuery): Promise<JobPage> {
      // A scope that names no user holds nothing: there is nothing to list.
      if (scope.user === "" || query.states?.length === 0) return { jobs: [] };
      const where = ["user = ?"];
      const args: (string | number)[] = [scope.user];
      if (query.chat !== undefined) {
        where.push("chat = ?");
        args.push(query.chat);
      }
      if (query.states !== undefined) {
        where.push(`state IN (${query.states.map(() => "?").join(", ")})`);
        args.push(...query.states);
      }
      if (query.cursor !== undefined) {
        const from = placeIn(query.cursor);
        where.push("(started < ? OR (started = ? AND id < ?))");
        args.push(from.started, from.started, from.id);
      }
      // One past the page is read, to know whether another page follows.
      args.push(query.limit === undefined ? -1 : query.limit + 1);
      const jobs = db
        .query<{ value: string }, (string | number)[]>(`SELECT value FROM job WHERE ${where.join(" AND ")} ORDER BY started DESC, id DESC LIMIT ?`)
        .all(...args)
        .map((r) => JSON.parse(r.value) as JobView);
      if (query.limit === undefined || jobs.length <= query.limit) return { jobs };
      const page = jobs.slice(0, query.limit);
      return { jobs: page, next: placeOf(page[page.length - 1] as JobView) };
    },
    async prune(scope, before) {
      const user = userOf(scope);
      return await writes.run((into) => into.run("DELETE FROM job WHERE user = ? AND started < ?", [user, before]).changes, "removing old job records");
    },
  };
}

/** The store port: each call kept under the user its scope names, never under the one this RPE serves by itself. */
export function kvStore(db: Database, writes: Writes): StorePort {
  const read = (from: Database, user: string, key: string): JsonValue | undefined => {
    const row = from.query<{ value: string }, [string, string]>("SELECT value FROM kv WHERE user = ? AND key = ?").get(user, key);
    return row === null ? undefined : (JSON.parse(row.value) as JsonValue);
  };
  const put = (into: Database, user: string, key: string, value: JsonValue | undefined): void => {
    if (value === undefined) into.run("DELETE FROM kv WHERE user = ? AND key = ?", [user, key]);
    else into.run("INSERT INTO kv (user, key, value) VALUES (?, ?, ?) ON CONFLICT (user, key) DO UPDATE SET value = excluded.value", [user, key, JSON.stringify(value)]);
  };
  return {
    async get(scope, key) {
      return read(db, userOf(scope), checked(key));
    },
    async set(scope, key, value) {
      const user = userOf(scope);
      checked(key);
      await writes.run((into) => put(into, user, key, value), "keeping the harness's state");
    },
    async update(scope, key, change) {
      const user = userOf(scope);
      checked(key);
      return await writes.run((into) => {
        const next = change(read(into, user, key));
        put(into, user, key, next);
        return next;
      }, "changing the harness's state");
    },
    async delete(scope, key) {
      const user = userOf(scope);
      checked(key);
      await writes.run((into) => put(into, user, key, undefined), "removing the harness's state");
    },
    async list(scope, prefix) {
      // A scope that names no user holds nothing: there is nothing to list.
      if (scope.user === "") return [];
      return db
        .query<{ key: string }, [string, number, string]>("SELECT key FROM kv WHERE user = ? AND substr(key, 1, ?) = ?")
        .all(scope.user, prefix.length, prefix)
        .map((r) => r.key);
    },
    jobs: jobRecords(db, writes),
  };
}
