// World documents by revision: a chat that plays a real world folds over the document the store keeps
// for its revision, whether it was put through the store or carried over by the migration.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { BUILD_MIGRATIONS } from "../../src/build/schema";
import { hashJson } from "../../src/shared/hash";
import { MIGRATE_TABLES } from "../../src/migrate/tables";
import { migrateStore } from "../../src/store/schema";
import { openStore } from "../../src/store/store";
import { sha256Of, storedWorlds, type WorldChange } from "../../src/store/worlds";
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
      else m.up(db, USER);
    }
    const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
    const put = db.query("INSERT INTO world_file (user, world, file, bytes, sha256, run) VALUES (?1, ?2, ?3, ?4, ?5, 'run-1')");
    const carry = (user: string, world: string, file: string, data: Uint8Array): unknown => put.run(user, world, file, data, sha256Of(data));
    carry(USER, world.id, `rev/${revision}.json`, bytes(world));
    carry(USER, world.id, "index.json", bytes({ id: world.id, head: revision, revisions: [revision] }));
    carry(USER, world.id, `rev/${"0".repeat(32)}.json`, new TextEncoder().encode("{ not json"));
    carry("user-b", "w_other", `rev/${"1".repeat(32)}.json`, bytes({ ...world, id: "w_other" }));

    const store = openStore({ db, registry: registry(), worlds: storedWorlds(db) });
    const s = store.user(USER);
    expect(s.copyMigratedWorlds()).toEqual({ added: 1, held: 0, unreadable: [{ world: world.id, revision: "0".repeat(32) }] });
    expect(s.copyMigratedWorlds()).toEqual({ added: 0, held: 1, unreadable: [{ world: world.id, revision: "0".repeat(32) }] });
    expect(s.worldRevisions(world.id).map((r) => r.revision).sort()).toEqual([revision, "0".repeat(32)].sort());
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

  test("a revision's bytes come back as received; its id is their hash", () => {
    const db = storeDb();
    const s = openStore({ db, registry: registry(), worlds: storedWorlds(db) }).user(USER);
    const bytes = new TextEncoder().encode(JSON.stringify(world, null, 4));
    const kept = s.worlds.putRevision(world.id, bytes);
    expect(kept).toEqual({ revision, added: true });
    expect(s.worlds.revisionBytes(revision)).toEqual(bytes);
    expect(s.worlds.part(world.id, `rev/${revision}.json`)?.sha256).toBe(sha256Of(bytes));
    expect(s.worlds.putRevision(world.id, JSON.stringify(world)).added).toBe(false);
    expect(s.worlds.revisionBytes(revision)).toEqual(bytes);
  });

  test("past worldsKept the oldest revision is read again", () => {
    const db = storeDb();
    const s = openStore({ db, registry: registry(), worlds: storedWorlds(db) }).user(USER);
    const read = storedWorlds(db, { kept: 2 });
    const ids = ["A", "B", "C"].map((name) => s.worlds.putRevision(world.id, JSON.stringify({ ...world, name })).revision);
    for (const id of ids) read(id);
    const rename = (id: string, name: string): void => void db.run("UPDATE world_part SET bytes = ? WHERE file = ?", [new TextEncoder().encode(JSON.stringify({ ...world, name })), `rev/${id}.json`]);
    rename(ids[0] ?? "", "A again");
    rename(ids[2] ?? "", "C again");
    expect(read(ids[2] ?? "")?.name).toBe("C");
    expect(read(ids[0] ?? "")?.name).toBe("A again");
  });

  test("a draft write on an older version gets the current draft back", () => {
    const db = storeDb();
    const w = openStore({ db, registry: registry(), worlds: storedWorlds(db) }).user(USER).worlds;
    w.putIndex(world.id, JSON.stringify({ id: world.id, name: world.name, head: revision, loreBookId: null, revisions: [revision] }));
    expect(w.draft(world.id)).toEqual({ bytes: null, version: 0, stored: false });
    expect(w.writeDraft(world.id, '{"v":1}', 0)).toEqual({ done: true, version: 1 });
    expect(w.writeDraft(world.id, '{"v":2}', 1)).toEqual({ done: true, version: 2 });
    const refused = w.writeDraft(world.id, '{"v":"stale"}', 1);
    expect(refused.done).toBe(false);
    if (!refused.done) expect([new TextDecoder().decode(refused.current.bytes ?? new Uint8Array()), refused.current.version]).toEqual(['{"v":2}', 2]);
    expect(new TextDecoder().decode(w.draft(world.id).bytes ?? new Uint8Array())).toBe('{"v":2}');
    expect(w.dropDraft(world.id, 1).done).toBe(false);
    expect(w.dropDraft(world.id, 2)).toEqual({ done: true, version: 3 });
    expect(w.draft(world.id)).toEqual({ bytes: null, version: 3, stored: false });
  });

  test("a draft write calls the change notice", () => {
    const db = storeDb();
    const told: WorldChange[] = [];
    const w = openStore({ db, registry: registry(), worlds: storedWorlds(db), worldChanged: (c) => told.push(c) }).user(USER).worlds;
    w.putRevision(world.id, JSON.stringify(world));
    w.putIndex(world.id, "{}");
    w.writeDraft(world.id, "{}", 0);
    w.writeDraft(world.id, "{}", 0);
    w.appendHistory(world.id, { revision, at: 5, source: "create" });
    expect(told.map((c) => [c.user, c.world, c.part, c.version])).toEqual([
      [USER, world.id, "revision", undefined],
      [USER, world.id, "index", undefined],
      [USER, world.id, "draft", 1],
      [USER, world.id, "history", undefined],
    ]);
    expect(w.history(world.id)).toEqual([{ revision, at: 5, source: "create" }]);
  });

  test("a listener added to the store hears each world change after the store's own notice, and one that throws stops no other", () => {
    const db = storeDb();
    const order: string[] = [];
    const store = openStore({ db, registry: registry(), worlds: storedWorlds(db), worldChanged: (c) => order.push(`own ${c.part}`), log: () => undefined });
    store.onWorld(() => {
      throw new Error("a listener that fails");
    });
    const stop = store.onWorld((c) => order.push(`heard ${c.part}`));
    const w = store.user(USER).worlds;
    w.putIndex(world.id, "{}");
    stop();
    w.writeDraft(world.id, "{}", 0);
    expect(order).toEqual(["own index", "heard index", "own draft"]);
  });

  test("carried and Build's world files move in byte for byte, checksums equal", () => {
    const db = new Database(":memory:");
    for (const m of [...MIGRATE_TABLES].sort((a, b) => a.version - b.version)) if ("sql" in m) db.run(m.sql);
    // Build's tables as an earlier build kept them, before its step 5 dropped them.
    for (const m of BUILD_MIGRATIONS.filter((step) => step.version === 1)) if ("sql" in m) db.run(m.sql);
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
    const carried = db.query("INSERT INTO world_file (user, world, file, bytes, sha256, run) VALUES (?, ?, ?, ?, ?, 'run-1')");
    const text = JSON.stringify(world, null, 2);
    const index = JSON.stringify({ id: world.id, head: revision, revisions: [revision] });
    carried.run(USER, world.id, `rev/${revision}.json`, bytes(text), sha256Of(bytes(text)));
    carried.run(USER, world.id, "index.json", bytes(index), sha256Of(bytes(index)));
    carried.run(USER, world.id, "draft.json", bytes('{"base":null,"doc":{},"version":4}'), "x");
    // Build's copy of the same world has moved on: its own index wins.
    const built = JSON.stringify({ id: world.id, head: revision, revisions: [revision], draftVersion: 6 });
    db.run("INSERT INTO build_file (user, path, body) VALUES (?, ?, ?)", [USER, `worlds/${world.id}/index.json`, built]);
    db.run("INSERT INTO build_file (user, path, body) VALUES (?, ?, ?)", [USER, `worlds/${world.id}/index.json.tmp`, "{}"]);
    db.run("INSERT INTO build_file (user, path, body) VALUES (?, ?, ?)", [USER, "worlds/w_only/index.json", "{}"]);
    db.run("INSERT INTO build_seed (user, world, files, run) VALUES (?, ?, 'f', 'r')", [USER, "w_gone"]);
    carried.run(USER, "w_gone", "index.json", bytes("{}"), sha256Of(bytes("{}")));
    expect(() => migrateStore(db)).toThrow(/checksum/);
    db.run("UPDATE world_file SET sha256 = ? WHERE file = 'draft.json'", [sha256Of(bytes('{"base":null,"doc":{},"version":4}'))]);
    migrateStore(db);
    const w = openStore({ db, registry: registry(), worlds: storedWorlds(db) }).user(USER).worlds;
    expect(w.revisionBytes(revision)).toEqual(bytes(text));
    expect(w.part(world.id, `rev/${revision}.json`)?.sha256).toBe(sha256Of(bytes(text)));
    expect(w.index(world.id)).toEqual(bytes(built));
    expect(w.draft(world.id)).toMatchObject({ stored: false, version: 6 });
    expect(w.worlds()).toEqual(["w_only", world.id]);
    expect(db.query("SELECT count(*) AS n FROM world_file").get()).toEqual({ n: 4 });
    expect(db.query("SELECT count(*) AS n FROM sqlite_master WHERE name = 'world_revision'").get()).toEqual({ n: 0 });
  });
});
