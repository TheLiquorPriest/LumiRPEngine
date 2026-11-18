// The world service: his worlds kept once, in the store's table, behind one service every writer of a draft goes through.

import { describe, expect, test } from "bun:test";
import { WORLD_LIMIT_DEFAULTS } from "../../src/worlds/limits";
import { DraftMoved } from "../../src/worlds/worlds";
import { WorldService } from "../../src/worlds/service";
import { makeBed, OTHER, starter, USER } from "../build-mode/bed";

function serviceOn(limits?: () => Partial<import("../../src/worlds/limits").WorldLimits>) {
  const bed = makeBed();
  const base = WORLD_LIMIT_DEFAULTS;
  return { bed, service: new WorldService({ store: bed.store, writes: bed.writes, log: bed.log, ...(limits ? { limits: () => ({ ...base, ...limits() }) } : {}) }) };
}

describe("the world service", () => {
  test("a world made from a starter is edited part by part, committed, exported and imported again through the service alone", async () => {
    const { bed, service } = serviceOn();
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    const id = made.world.id;
    const set = await service.draft(USER, id, { op: "set", part: "meta", value: { genre: "fantasy" } });
    expect(set).toMatchObject({ stored: true, version: 1 });
    const put = await service.draft(USER, id, { op: "put", collection: "kinds", id: "lamplighter", value: { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} } }, { base: made.revision, version: 1 });
    expect(put.version).toBe(2);
    const committed = await service.commit(USER, id, { base: made.revision, source: "build", note: "a lamplighter", version: 2 });
    expect((await service.read(USER, id)).history.map((h) => h.note)).toEqual([undefined, "a lamplighter"]);
    expect((await service.read(USER, id, committed.revision)).world.kinds.lamplighter?.label).toBe("Lamplighter");
    const file = await service.exportFile(USER, id);
    const again = await service.importFile(USER, file);
    expect(again.world.name).toBe("Fernwick");
    expect((await service.list(USER)).length).toBe(2);
    expect(await service.list(OTHER)).toEqual([]);
    // Kept once: the store's own reader gives each revision, and Build has no table of worlds of its own.
    expect(bed.store.user(USER).worldRevisions(id).map((r) => r.revision)).toEqual([made.revision, committed.revision]);
    expect(bed.db.query("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('build_file', 'build_seed')").get()).toEqual({ n: 0 });
    expect(await service.remove(USER, id)).toHaveLength(1);
  });

  test("two writers on one draft version: the second gets the current draft and nothing of it is written", async () => {
    const { bed, service } = serviceOn();
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    const id = made.world.id;
    await service.draft(USER, id, { op: "set", part: "meta", value: { genre: "one" } });
    // A tool (here: the store's own draft write, as a map kept in the world makes it) writes on version 1 first.
    const read = bed.store.user(USER).worlds.draft(id);
    const doc = JSON.parse(new TextDecoder().decode(read.bytes ?? new Uint8Array()));
    const landed = await bed.writes.run(() => bed.store.user(USER).worlds.writeDraft(id, JSON.stringify({ ...doc, version: 2 }), 1), "a tool's write");
    expect(landed).toEqual({ done: true, version: 2 });
    const error = await service.draft(USER, id, { op: "set", part: "meta", value: { genre: "two" } }, { version: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DraftMoved);
    expect((error as DraftMoved).current.version).toBe(2);
    // Without naming a version the write is still made on the version it read: here it was read after the tool's, so it lands on 3.
    expect((await service.draft(USER, id, { op: "set", part: "meta", value: { genre: "three" } })).version).toBe(3);
  });

  test("a patch over the set count is refused naming the setting; raised, it goes through", async () => {
    let ops = 2;
    const { service } = serviceOn(() => ({ patchOps: ops }));
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    const patch = [1, 2, 3].map((n) => ({ op: "add" as const, path: `/kinds/k${n}`, value: { id: `k${n}`, label: `K${n}`, extends: "person", fields: {} } }));
    const refused = await service.draft(USER, made.world.id, { op: "patch", ops: patch }).catch((e: unknown) => e);
    expect((refused as Error).message).toContain("worlds.maxPatchOps");
    ops = 5;
    expect((await service.draft(USER, made.world.id, { op: "patch", ops: patch })).stored).toBe(true);
  });

  test("a world's history is read newest first a page at a time, each revision with its note and how much it changed, and the draft is set against the head part by part", async () => {
    const { service } = serviceOn();
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    const id = made.world.id;
    const kind = (name: string) => ({ id: name, label: name, extends: "person", fields: {} });
    await service.draft(USER, id, { op: "put", collection: "kinds", id: "lamplighter", value: kind("lamplighter") });
    const first = await service.commit(USER, id, { base: made.revision, source: "build", note: "a lamplighter" });
    await service.draft(USER, id, { op: "put", collection: "kinds", id: "ropewalker", value: kind("ropewalker") }, { base: first.revision });
    await service.draft(USER, id, { op: "remove", collection: "kinds", id: "lamplighter" }, { base: first.revision });
    const drafted = await service.changes(USER, id);
    expect(drafted).toMatchObject({ from: first.revision, to: null, total: 2 });
    expect(drafted.parts).toMatchObject([{ part: "kinds", added: 1, changed: 0, removed: 1 }]);
    const second = await service.commit(USER, id, { base: first.revision, source: "build", note: "swapped" });
    const page = await service.revisions(USER, id, { limit: 2 });
    expect(page.items.map((r) => [r.note, r.changed])).toEqual([["swapped", 2], ["a lamplighter", 1]]);
    expect(page.items[0]).toMatchObject({ revision: second.revision, before: first.revision, head: true, source: "build", chats: [] });
    const rest = await service.revisions(USER, id, { limit: 2, after: page.next ?? "" });
    expect(rest.items.map((r) => [r.revision, r.changed])).toEqual([[made.revision, null]]);
    expect(rest.next).toBeNull();
    expect((await service.changes(USER, id, made.revision, second.revision)).parts).toMatchObject([{ part: "kinds", added: 1, removed: 0 }]);
  });
});
