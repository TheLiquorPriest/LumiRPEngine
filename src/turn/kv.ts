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

/** The store port for the one user this RPE serves. */
export function kvStore(db: Database, writes: Writes, user: string): StorePort {
  const read = (from: Database, key: string): JsonValue | undefined => {
    const row = from.query<{ value: string }, [string, string]>("SELECT value FROM kv WHERE user = ? AND key = ?").get(user, key);
    return row === null ? undefined : (JSON.parse(row.value) as JsonValue);
  };
  const put = (into: Database, key: string, value: JsonValue | undefined): void => {
    if (value === undefined) into.run("DELETE FROM kv WHERE user = ? AND key = ?", [user, key]);
    else into.run("INSERT INTO kv (user, key, value) VALUES (?, ?, ?) ON CONFLICT (user, key) DO UPDATE SET value = excluded.value", [user, key, JSON.stringify(value)]);
  };
  return {
    async get(key) {
      return read(db, checked(key));
    },
    async set(key, value) {
      checked(key);
      await writes.run((into) => put(into, key, value), "keeping the harness's state");
    },
    async update(key, change) {
      checked(key);
      return await writes.run((into) => {
        const next = change(read(into, key));
        put(into, key, next);
        return next;
      }, "changing the harness's state");
    },
    async delete(key) {
      checked(key);
      await writes.run((into) => put(into, key, undefined), "removing the harness's state");
    },
    async list(prefix) {
      return db
        .query<{ key: string }, [string, number, string]>("SELECT key FROM kv WHERE user = ? AND substr(key, 1, ?) = ?")
        .all(user, prefix.length, prefix)
        .map((r) => r.key);
    },
  };
}
