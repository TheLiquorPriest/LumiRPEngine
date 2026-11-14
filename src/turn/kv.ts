// RPH's small durable state (`StorePort` in `rp-harness/contract`; plan Appendix B, `kv`): JSON values
// by key, each read and written whole, in RPE's database. Reads go straight to the database; every
// change goes through the application's write queue, so changes to one key run one at a time, each
// seeing the last one's result, and counts kept by agents running at once add up.

import type { Database } from "bun:sqlite";
import type { JsonValue, StorePort } from "rp-harness/contract";

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

/** The store port for the one user this RPE serves, that user read at each call. */
export function kvStore(db: Database, writes: Writes, owner: () => string | null): StorePort {
  const read = (from: Database, user: string, key: string): JsonValue | undefined => {
    const row = from.query<{ value: string }, [string, string]>("SELECT value FROM kv WHERE user = ? AND key = ?").get(user, key);
    return row === null ? undefined : (JSON.parse(row.value) as JsonValue);
  };
  const put = (into: Database, user: string, key: string, value: JsonValue | undefined): void => {
    if (value === undefined) into.run("DELETE FROM kv WHERE user = ? AND key = ?", [user, key]);
    else into.run("INSERT INTO kv (user, key, value) VALUES (?, ?, ?) ON CONFLICT (user, key) DO UPDATE SET value = excluded.value", [user, key, JSON.stringify(value)]);
  };
  return {
    async get(key) {
      return read(db, servedUser(owner), checked(key));
    },
    async set(key, value) {
      const user = servedUser(owner);
      checked(key);
      await writes.run((into) => put(into, user, key, value), "keeping the harness's state");
    },
    async update(key, change) {
      const user = servedUser(owner);
      checked(key);
      return await writes.run((into) => {
        const next = change(read(into, user, key));
        put(into, user, key, next);
        return next;
      }, "changing the harness's state");
    },
    async delete(key) {
      const user = servedUser(owner);
      checked(key);
      await writes.run((into) => put(into, user, key, undefined), "removing the harness's state");
    },
    async list(prefix) {
      return db
        .query<{ key: string }, [string, number, string]>("SELECT key FROM kv WHERE user = ? AND substr(key, 1, ?) = ?")
        .all(servedUser(owner), prefix.length, prefix)
        .map((r) => r.key);
    },
  };
}
