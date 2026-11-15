// RPH's small durable state (`StorePort` in `rp-harness/contract`; plan Appendix B, `kv`): JSON values
// by key, each read and written whole, in RPE's database, each one a user's: every call names the user
// in its scope, and one user's values are never read, listed or changed for another. Reads go straight
// to the database; every change goes through the application's write queue, so changes to one user's
// key run one at a time, each seeing the last one's result, and counts kept by agents running at once
// add up.

import type { Database } from "bun:sqlite";
import type { JsonValue, StorePort, UserScope } from "rp-harness/contract";

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

/** The users RPH's state holds values of, each once: whose jobs a restart may have cut off. */
export function storeUsers(db: Database): string[] {
  return db
    .query<{ user: string }, []>("SELECT DISTINCT user FROM kv ORDER BY user")
    .all()
    .map((r) => r.user);
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
  };
}
