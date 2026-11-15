// RPH's state as RPE keeps it (`kvStore`; plan Appendix B, `kv`): every call is kept under the user its scope
// names, whoever this RPE serves, so two users' values under one key stay apart, a change to one user's key
// sees only his value, and a list gives a user his own keys alone. Every name is invented.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobState, JobView, JsonValue } from "rp-harness/contract";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import { STORE_MIGRATIONS } from "../../src/store";
import { HARNESS_MIGRATIONS, kvStore } from "../../src/turn";
import { storeUsers } from "../../src/turn/kv";

const KEY = "jobs/kept/job-ledger";
const DAY = "usage/days/2026-11-15";

test("the store port takes the user from the scope", async () => {
  const place = await mkdtemp(join(tmpdir(), "rpe-kv-"));
  const db = openDatabase(join(place, "rpe.db"), 2_000);
  // The harness's tables, which stand on the store's.
  const migrations = new Migrations();
  migrations.add("store", STORE_MIGRATIONS);
  migrations.add("harness", HARNESS_MIGRATIONS);
  migrate(db, migrations, { user: "user-ada", version: "kv-test", backups: join(place, "backups"), now: () => 0 });
  const writes = new WriteQueue(db, 50);
  try {
    const store = kvStore(db, writes);
    // One user's alone, as RPH gives it for his day's counts; the other's a chat's, as RPH gives it for a run.
    const ada = { user: "user-ada" };
    const bo = { user: "user-bo", chat: "chat-harbor", session: "session-1", turn: "turn-1" };
    const add = (n: number) => (current: JsonValue | undefined): JsonValue => (typeof current === "number" ? current : 0) + n;
    await store.set(ada, KEY, { brief: "Tally the casks." });
    await store.set(bo, KEY, { brief: "Count the nets." });
    await Promise.all([store.update(ada, DAY, add(2)), store.update(bo, DAY, add(7)), store.update(ada, DAY, add(3))]);
    expect(await Promise.all([store.get(ada, KEY), store.get(bo, KEY), store.get(ada, DAY), store.get(bo, DAY)])).toEqual([{ brief: "Tally the casks." }, { brief: "Count the nets." }, 5, 7]);
    expect((await store.list(ada, "")).sort()).toEqual([KEY, DAY].sort());
    expect(await store.list(bo, "jobs/")).toEqual([KEY]);

    await store.delete(bo, KEY);
    expect([await store.get(ada, KEY), await store.get(bo, KEY)]).toEqual([{ brief: "Tally the casks." }, undefined]);
    // A user with nothing kept reads and lists nothing of anyone's.
    expect([await store.get({ user: "user-cy" }, KEY), await store.list({ user: "user-cy" }, "")]).toEqual([undefined, []]);
  } finally {
    await writes.close();
    db.close();
    await rm(place, { recursive: true, force: true });
  }
});

test("the job records RPH kept as plain keys move to their own table, each under its user, and the users it holds are whose jobs a restart may have cut off", async () => {
  const place = await mkdtemp(join(tmpdir(), "rpe-kv-jobs-"));
  const db = openDatabase(join(place, "rpe.db"), 2_000);
  const options = (version: string) => ({ user: "user-ada", version, backups: join(place, "backups"), now: () => 0 });
  const before = new Migrations();
  before.add("store", STORE_MIGRATIONS);
  before.add("harness", HARNESS_MIGRATIONS.filter((step) => step.version < 13));
  migrate(db, before, options("before"));
  const usage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const job = (user: string, id: string, started: number, state: JobState): JobView => ({ id, agent: "historian", brief: "Tally the casks.", state, scope: { user, chat: "chat-harbor", session: "session-1" }, startedBy: "user", started, usage });
  const old = [job("user-ada", "job-cask", 1_000, "done"), job("user-ada", "job-net", 2_000, "running"), job("user-bo", "job-cask", 1_500, "failed")];
  for (const j of old) db.run("INSERT INTO kv (user, key, value) VALUES (?, ?, ?)", [j.scope.user, `jobs/all/${j.id}`, JSON.stringify(j)]);
  db.run("INSERT INTO kv (user, key, value) VALUES (?, ?, ?)", ["user-ada", "jobs/switches", JSON.stringify({ off: false, held: false })]);
  const now = new Migrations();
  now.add("store", STORE_MIGRATIONS);
  now.add("harness", HARNESS_MIGRATIONS);
  migrate(db, now, options("after"));
  const writes = new WriteQueue(db, 50);
  try {
    const store = kvStore(db, writes);
    const ada = { user: "user-ada" };
    expect((await store.jobs.list(ada, {})).jobs).toEqual([old[1], old[0]]);
    expect(await store.jobs.get({ user: "user-bo" }, "job-cask")).toEqual(old[2]);
    expect(await store.list(ada, "jobs/")).toEqual(["jobs/switches"]);
    // A page and the one after it, and the states asked for.
    const first = await store.jobs.list(ada, { limit: 1 });
    expect([first.jobs.map((j) => j.id), (await store.jobs.list(ada, { limit: 1, cursor: first.next! })).jobs.map((j) => j.id)]).toEqual([["job-net"], ["job-cask"]]);
    expect((await store.jobs.list(ada, { states: ["done"] })).jobs.map((j) => j.id)).toEqual(["job-cask"]);
    // A user whose only record is a job's is still one the store holds.
    await store.jobs.set({ user: "user-cy" }, job("user-cy", "job-cask", 3_000, "queued"));
    expect(storeUsers(db)).toEqual(["user-ada", "user-bo", "user-cy"]);
  } finally {
    await writes.close();
    db.close();
    await rm(place, { recursive: true, force: true });
  }
});
