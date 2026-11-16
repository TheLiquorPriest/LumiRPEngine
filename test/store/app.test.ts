// The store on RPE's database (plan §4.5): the application makes the store's tables with every other
// area's migrations, and its connection takes writes only inside its write queue. A store handed
// that database writes nothing on opening; every write it makes runs inside the caller's queued
// write; a read made outside the queue writes nothing (the connection would refuse it); and a queued
// write the caller rolls back leaves no folded state behind.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataPaths, lineLog, openApp, type App } from "../../src/app";
import { configOf } from "../../src/app/config";
import { hashJson } from "../../src/shared/hash";
import { migrateStore, STORE_MIGRATIONS } from "../../src/store/schema";
import { openStore, type Store, type UserStore } from "../../src/store/store";
import { StoreSchemaError, type TurnRow } from "../../src/store/types";
import { engine, goTo, hashOf, inventedWorld, POV, registry, shown, tick, USER } from "./fixtures";

const world = inventedWorld();
const revision = hashJson(world);
const worlds = (r: string) => (r === revision ? world : undefined);

/** How to make a write: through the app's queue, or straight on a store's own database. */
type Run = <T>(write: () => T) => Promise<T>;

const PLACES = ["cellar", "market_square", "far_road", "common_room"];

/**
 * A chat played through every write call there is, with reads between the writes made outside
 * them: four replies, a starting state and a correction on the newest, a session, a second swipe of
 * the second reply shown (the two after it rebased), and a branch.
 */
async function script(s: UserStore, run: Run): Promise<TurnRow[]> {
  await run(() => s.createChat({ id: "c", revision }));
  const turns: TurnRow[] = [];
  for (const [i, place] of PLACES.entries()) {
    const t = await run(() => s.beginTurn({ chat: "c", kind: "normal" }));
    await run(() => s.addChanges(t.id, engine(tick(i + 1), goTo(POV, place))));
    s.stateAt(t.id);
    turns.push(await run(() => s.tieTurn(t.id, { message: `m${i + 1}`, hash: hashOf(`Reply ${i + 1}.`), date: i + 1 })));
    s.headState("c");
  }
  const head = turns[3];
  const second = turns[1];
  if (!head || !second) throw new Error("missing turns");
  const base = structuredClone(s.stateAt(head.id).state.world);
  await run(() => s.setBase(head.id, base));
  await run(() => s.addChanges(head.id, engine(goTo(POV, "cellar")).map((c) => ({ ...c, by: "player", source: "player" as const }))));
  const session = await run(() => s.openSession({ chat: "c", scene: "evening", turn: head.id }));
  await run(() => s.closeSession(session.id, head.id));
  await run(() => s.updateTurn(head.id, { intent: "rest", tokensIn: 10 }));
  const dropped = await run(() => s.beginTurn({ chat: "c", kind: "normal" }));
  await run(() => s.addChanges(dropped.id, engine(tick(99))));
  await run(() => s.dropStaged(dropped.id));
  await run(() => s.dropTurn(dropped.id));
  const swipe = await run(() => s.beginTurn({ chat: "c", kind: "swipe", target: "m2" }));
  await run(() => s.addChanges(swipe.id, engine(tick(7), goTo(POV, "far_road"))));
  await run(() => s.tieTurn(swipe.id, { message: "m2", hash: hashOf("Another second reply."), date: 9 }));
  const shownNow = [1, 2, 3, 4].map((n): [string, string, number] => (n === 2 ? ["m2", "Another second reply.", 9] : [`m${n}`, `Reply ${n}.`, n]));
  const report = await run(() => s.sync("c", shown(...shownNow)));
  expect(report.flipped.map((f) => f.to)).toEqual([swipe.id]);
  expect(report.rebased?.turns).toEqual([turns[2]?.id, head.id]);
  await run(() => s.branchChat({ id: "b", from: "c", map: { m1: "b1", m2: "b2", m3: "b3", m4: "b4" } }));
  await run(() => s.sync("b", shown(...shownNow.map(([id, text, date]): [string, string, number] => [id.replace("m", "b"), text, date]))));
  s.view("c").query(POV, "full");
  s.view("b").query("world", 2);
  s.swipes("c", "m2");
  s.isPlayed("c");
  return turns;
}

let root = "";
let app: App;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rpe-store-app-"));
  app = await openApp({
    paths: dataPaths(join(root, "data")),
    config: configOf({ port: 0, lumiverse: { url: "http://127.0.0.1:7860", user: "owner" } }, {}, "the test's config"),
    version: "1.0.0",
    areas: [{ name: "store", tables: [{ area: "store", migrations: STORE_MIGRATIONS }] }],
    log: lineLog(() => undefined),
  });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const queued: Run = (write) => app.writes.run(write);
const straight: Run = async (write) => write();
/** Rows written on the app's connection since it opened. */
const written = (): number => app.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n ?? -1;
const snapshots = (): number => app.db.query<{ n: number }, []>("SELECT count(*) AS n FROM snapshot").get()?.n ?? -1;
const onApp = (fingerprint?: string): Store => openStore({ db: app.db, registry: registry(), worlds, snapshotEvery: 2, ...(fingerprint ? { fingerprint } : {}) });

describe("the store on RPE's database", () => {
  test("opens without writing, plays a chat with every write in the queue, and comes to what a store of its own does", async () => {
    const before = written();
    const store = onApp();
    expect(written()).toBe(before);
    const own = openStore({ db: ":memory:", registry: registry(), worlds, snapshotEvery: 2 });
    await script(store.user(USER), queued);
    await script(own.user(USER), straight);
    for (const chat of ["c", "b"]) {
      expect(hashJson(store.user(USER).headState(chat).state.world)).toBe(hashJson(own.user(USER).headState(chat).state.world));
      // After a restart too, from the snapshots stored on each.
      expect(hashJson(onApp().user(USER).headState(chat).state.world)).toBe(hashJson(own.user(USER).headState(chat).state.world));
    }
    expect(store.user(USER).headState("c").state.world.entities[POV]?.fields.place).toBe("cellar");
    // A write made outside the queue fails where it is made: the store wrote nowhere else.
    expect(() => store.user(USER).createChat({ id: "outside", revision })).toThrow("readonly");
    own.close();
    store.close();
    // A store handed a database leaves it open: it is its owner's.
    expect(app.db.query<{ one: number }, []>("SELECT 1 AS one").get()).toEqual({ one: 1 });
  });

  test("a read outside the queue writes nothing, and the snapshots its fold finds are stored by the next queued write", async () => {
    const s = onApp().user(USER);
    const turns = await script(s, queued);
    const first = turns[0];
    if (!first) throw new Error("no first turn");
    // A correction on the first reply drops the snapshots after it.
    await queued(() => s.addChanges(first.id, engine(tick(1))));
    const stored = snapshots();
    const made = written();
    const cold = onApp().user(USER);
    for (const reader of [s, cold]) {
      reader.headState("c");
      reader.headState("b");
      reader.stateAt(first.id);
      reader.view("c").query(POV, "full");
    }
    expect(written()).toBe(made);
    expect(snapshots()).toBe(stored);
    await queued(() => s.updateTurn(first.id, { intent: "noted" }));
    expect(snapshots()).toBeGreaterThan(stored);
    expect(hashJson(onApp().user(USER).headState("c").state.world)).toBe(hashJson(s.headState("c").state.world));
  });

  test("a queued write the caller rolls back leaves no folded state behind, held or stored", async () => {
    const s = onApp().user(USER);
    const turns = await script(s, queued);
    const [first, , , head] = turns;
    if (!first || !head) throw new Error("missing turns");
    // The head, and the two turns the failed write records changes on.
    const states = (u: UserStore): string[] => [u.headState("c"), u.stateAt(head.id), u.stateAt(first.id)].map((f) => hashJson(f.state.world));
    const before = states(s);
    const count = s.changes(head.id).length;
    const failed = app.writes.run(() => {
      s.addChanges(head.id, engine(goTo(POV, "market_square"), tick(45)));
      s.addChanges(first.id, engine(tick(3)));
      expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("market_square");
      throw new Error("the caller's next step failed");
    });
    await expect(failed).rejects.toThrow("the caller's next step failed");
    expect(s.changes(head.id)).toHaveLength(count);
    expect(states(s)).toEqual(before);
    // The next write stores only what still holds: a store started afresh, and one folding from the start, agree.
    await queued(() => s.updateTurn(head.id, { intent: "after" }));
    expect(states(onApp().user(USER))).toEqual(before);
    expect(states(onApp("another build").user(USER))).toEqual(before);
  });

  test("a database without the store's tables is refused plainly, and the store's own runner leaves RPE's alone", () => {
    const bare = new Database(":memory:");
    try {
      expect(() => openStore({ db: bare, registry: registry(), worlds })).toThrow(StoreSchemaError);
      expect(() => openStore({ db: bare, registry: registry(), worlds })).toThrow("chat, message_link, session, turn, path_node, change, snapshot, fold_mark, world_part, job_end, snapshot_part missing");
      expect(migrateStore(bare)).toBe(STORE_MIGRATIONS.length);
      expect(migrateStore(bare)).toBe(STORE_MIGRATIONS.length);
      expect(() => openStore({ db: bare, registry: registry(), worlds })).not.toThrow();
    } finally {
      bare.close();
    }
    const made = written();
    expect(() => migrateStore(app.db)).toThrow(StoreSchemaError);
    expect(written()).toBe(made);
  });
});
