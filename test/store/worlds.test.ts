// World documents by revision: a chat that plays a real world folds over the document the store keeps
// for its revision, whether it was put through the store or carried over by the migration.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { hashJson } from "../../src/shared/hash";
import { MIGRATE_TABLES } from "../../src/migrate/tables";
import { migrateStore } from "../../src/store/schema";
import { openStore } from "../../src/store/store";
import { storedWorlds } from "../../src/store/worlds";
import { engine, goTo, inventedWorld, POV, registry, tick, USER } from "./fixtures";

const world = inventedWorld();
const revision = hashJson(world);

function storeDb(): Database {
  const db = new Database(":memory:");
  migrateStore(db);
  return db;
}

describe("world documents by revision", () => {
  test("a chat on a revision put through the store takes an engine change", () => {
    const db = storeDb();
    const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
    const s = store.user(USER);
    expect(s.putWorld(revision, world)).toBe(true);
    expect(s.putWorld(revision, { ...world, name: "Another name" })).toBe(false);
    expect(s.worldDoc(revision)?.name).toBe(world.name);
    expect(s.worldRevisions().map((r) => [r.revision, r.world])).toEqual([[revision, world.id]]);

    s.createChat({ id: "c1", world: world.id, revision });
    const start = s.headState("c1").state.world.clock;
    const t = s.beginTurn({ chat: "c1", kind: "normal" });
    const { changes, state } = s.addChanges(t.id, engine(goTo(POV, "market_square"), tick(30)));
    expect(changes.map((c) => [c.applied, c.reports])).toEqual([
      [true, []],
      [true, []],
    ]);
    expect(state.world.revision).toBe(revision);
    expect(state.world.clock).toBe(start + 30);
    expect(state.world.entities[POV]?.fields.place).toBe("market_square");
  });

  test("the revisions the migration carried are copied into the store's own, once", () => {
    const db = storeDb();
    for (const m of [...MIGRATE_TABLES].sort((a, b) => a.version - b.version)) {
      if ("sql" in m) db.run(m.sql);
      else m.up(db);
    }
    const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
    const put = db.query("INSERT INTO world_file (user, world, file, bytes, sha256, run) VALUES (?, ?, ?, ?, 'x', 'run-1')");
    put.run(USER, world.id, `rev/${revision}.json`, bytes(world));
    put.run(USER, world.id, "index.json", bytes({ id: world.id, head: revision, revisions: [revision] }));
    put.run(USER, world.id, `rev/${"0".repeat(32)}.json`, new TextEncoder().encode("{ not json"));
    put.run("user-b", "w_other", `rev/${"1".repeat(32)}.json`, bytes({ ...world, id: "w_other" }));

    const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
    const s = store.user(USER);
    expect(s.copyMigratedWorlds()).toEqual({ added: 1, held: 0, unreadable: [{ world: world.id, revision: "0".repeat(32) }] });
    expect(s.copyMigratedWorlds()).toEqual({ added: 0, held: 1, unreadable: [{ world: world.id, revision: "0".repeat(32) }] });
    expect(s.worldRevisions(world.id).map((r) => r.revision)).toEqual([revision]);
    expect(s.worldDoc("1".repeat(32))).toBeNull();

    s.createChat({ id: "c1", world: world.id, revision });
    const t = s.beginTurn({ chat: "c1", kind: "normal" });
    expect(s.addChanges(t.id, engine(tick(15))).changes[0]?.applied).toBe(true);
  });

  test("a chat on a revision nobody kept is refused plainly, as before", () => {
    const db = storeDb();
    const s = openStore({ db, registry: registry(), worlds: storedWorlds(db) }).user(USER);
    s.createChat({ id: "c1", world: world.id, revision });
    const t = s.beginTurn({ chat: "c1", kind: "normal" });
    expect(() => s.addChanges(t.id, engine(tick(15)))).toThrow(`the world revision ${revision} is not available`);
  });
});
