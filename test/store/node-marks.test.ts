// What names a turn's state (`foldKey`) and what the store holds for it, as writes come: a write of one turn's changes or starting
// state renews the marks of that turn's nodes and every node after them, and of no node before; any other write that changes folds
// renews every node's; a write the database takes back leaves no key or held state naming what it wrote; a store opened again keeps
// what its first write did not change; and what a thread folds is held here under the node's mark. Each key is checked against the
// state read afresh, so a key kept past a change it should have followed shows as a state that differs.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashJson } from "../../src/shared/hash";
import type { StoreAway } from "../../src/store/away";
import { foldAway } from "../../src/store/away-thread";
import { migrateStore, storedWorlds } from "../../src/store";
import { openStore, type UserStore } from "../../src/store/store";
import type { TurnRow } from "../../src/store/types";
import { engine, goTo, hashOf, inventedWorld, make, play, POV, registry, shown, testStore, tick, USER } from "./fixtures";
import type { SeenMessage } from "../../src/store";
import { STORY_STORE_AREA } from "../../src/story";

/** Every turn's key and state as read now, by turn. */
function readings(s: UserStore, turns: readonly TurnRow[]): Map<string, { key: string; state: unknown }> {
  return new Map(turns.map((t) => [t.id, { key: s.foldKey(t.id), state: s.stateAt(t.id) }]));
}

/** Which turns' keys moved from `before` to `after`. */
function moved(before: Map<string, { key: string }>, after: Map<string, { key: string }>): string[] {
  return [...after].filter(([id, r]) => before.get(id)?.key !== r.key).map(([id]) => id);
}

/** Each turn's state as a store with nothing held folds it: the same, part for part, as `s` gives it. */
function sameAsAfresh(s: UserStore, db: Parameters<typeof openStore>[0]["db"], turns: readonly TurnRow[], worlds: (r: string) => unknown): void {
  const fresh = openStore({ areas: [STORY_STORE_AREA], db, registry: registry(), worlds: worlds as never }).user(USER);
  for (const t of turns) expect(JSON.parse(JSON.stringify(s.stateAt(t.id).state))).toEqual(JSON.parse(JSON.stringify(fresh.stateAt(t.id).state)));
}

/** The chat's own reading of its head, as a store with nothing held reads it: the same as `s` gives it. */
function headAsAfresh(s: UserStore, db: Parameters<typeof openStore>[0]["db"], worlds: (r: string) => unknown): void {
  const fresh = openStore({ areas: [STORY_STORE_AREA], db, registry: registry(), worlds: worlds as never }).user(USER);
  expect(JSON.parse(JSON.stringify(s.headState("c").state))).toEqual(JSON.parse(JSON.stringify(fresh.headState("c").state)));
}

function fourTurns(): { s: UserStore; store: ReturnType<typeof testStore>["store"]; turns: TurnRow[]; worlds: ReturnType<typeof testStore>["worlds"] } {
  let at = 0;
  const { s, store, revision, worlds } = testStore({ now: () => ++at });
  s.createChat({ id: "c", revision });
  const turns = [play(s, "c", "m1", "Morning.", 1, engine(tick(10))), play(s, "c", "m2", "To the cellar.", 2, engine(goTo(POV, "cellar"))), play(s, "c", "m3", "A lamp.", 3, engine(make("lamp", "Lamp", POV))), play(s, "c", "m4", "Later.", 4, engine(tick(5)))];
  return { s, store, turns, worlds };
}

describe("node marks", () => {
  test("a new turn renews no earlier turn's key, and the earlier states held are the same objects; its own key moves with each change it records", () => {
    const { s, store, turns, worlds } = fourTurns();
    const before = readings(s, turns);
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    const begun = s.foldKey(next.id);
    expect(s.stateAt(next.id).state.world.clock).toBe(s.stateAt(turns[3]!.id).state.world.clock);
    s.addChanges(next.id, engine(tick(60)));
    const recorded = s.foldKey(next.id);
    expect(recorded).not.toBe(begun);
    s.tieTurn(next.id, { message: "m5", hash: "hash-m5", date: 5 });
    expect(s.foldKey(next.id)).toBe(recorded);
    const after = readings(s, turns);
    expect(moved(before, after)).toEqual([]);
    for (const t of turns.slice(-2)) expect(after.get(t.id)?.state).toBe(before.get(t.id)?.state);
    expect(s.stateAt(next.id).state.world.clock).toBe(s.stateAt(turns[3]!.id).state.world.clock + 60);
    sameAsAfresh(s, store.db, [...turns, next], (r) => worlds.get(r));
  });

  test("changes added to an earlier turn renew its key and every later one's, none before it, and each state read after holds them", () => {
    const { s, store, turns, worlds } = fourTurns();
    const [t1, t2, t3, t4] = turns as [TurnRow, TurnRow, TurnRow, TurnRow];
    const before = readings(s, turns);
    s.addChanges(t2.id, engine(make("coin", "Coin", POV)));
    const after = readings(s, turns);
    expect(moved(before, after)).toEqual([t2.id, t3.id, t4.id]);
    expect(after.get(t1.id)?.state).toBe(before.get(t1.id)?.state);
    for (const t of [t2, t3, t4]) expect(s.stateAt(t.id).state.world.entities.coin).toBeDefined();
    expect(s.stateAt(t1.id).state.world.entities.coin).toBeUndefined();
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
  });

  test("taking back a turn's changes and setting a turn's starting state renew that turn's key and every later one's only", () => {
    const { s, store, turns, worlds } = fourTurns();
    const [t1, t2, t3, t4] = turns as [TurnRow, TurnRow, TurnRow, TurnRow];
    let before = readings(s, turns);
    expect(s.takeBack(t3.id, -1)).toBe(1);
    let after = readings(s, turns);
    expect(moved(before, after)).toEqual([t3.id, t4.id]);
    expect(s.stateAt(t4.id).state.world.entities.lamp).toBeUndefined();
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
    before = after;
    const start = s.stateAt(t2.id).state.world;
    s.setBase(t2.id, { ...start, clock: start.clock + 1000 });
    after = readings(s, turns);
    expect(moved(before, after)).toEqual([t2.id, t3.id, t4.id]);
    expect(after.get(t1.id)?.state).toBe(before.get(t1.id)?.state);
    expect(s.stateAt(t4.id).state.world.clock).toBe(start.clock + 1000 + 5);
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
  });

  test("a staged change taken back from an open turn renews only that turn's key", () => {
    const { s, turns } = fourTurns();
    const open = s.beginTurn({ chat: "c", kind: "normal" });
    s.addChanges(open.id, engine(make("rope", "Rope", POV)));
    const all = [...turns, open];
    const before = readings(s, all);
    expect(s.dropStaged(open.id)).toBe(1);
    const after = readings(s, all);
    expect(moved(before, after)).toEqual([open.id]);
    expect(s.stateAt(open.id).state.world.entities.rope).toBeUndefined();
  });

  test("a change of his own and an Undo renew no turn's key: the head's own reading has them, and every turn begun after them", () => {
    const { s, store, turns, worlds } = fourTurns();
    let before = readings(s, turns);
    s.addOwnerChanges("c", engine(goTo(POV, "market")));
    let after = readings(s, turns);
    expect(moved(before, after)).toEqual([]);
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("market");
    before = after;
    const lamp = s.changes((turns[2] as TurnRow).id)[0]!.id;
    s.undo(lamp);
    after = readings(s, turns);
    expect(moved(before, after)).toEqual([]);
    expect(s.headState("c").state.world.entities.lamp?.fields.gone).toBe(true);
    const next = play(s, "c", "m5", "Night.", 5, engine(tick(60)));
    expect(s.stateAt(next.id).state.world.entities[POV]?.fields.place).toBe("market");
    sameAsAfresh(s, store.db, [...turns, next], (r) => worlds.get(r));
    headAsAfresh(s, store.db, (r) => worlds.get(r));
  });

  test("a change of his own where a turn was begun at its moment or after (a clock set back) renews every turn's key", () => {
    let at = 1000;
    const { s, store, revision, worlds } = testStore({ now: () => at++ });
    s.createChat({ id: "c", revision });
    const turns = [play(s, "c", "m1", "Morning.", 1, engine(tick(10))), play(s, "c", "m2", "To the cellar.", 2, engine(goTo(POV, "cellar")))];
    const before = readings(s, turns);
    // The clock is set back past the turns' beginnings: his change now stands before them on the path.
    at = 10;
    s.addOwnerChanges("c", engine(goTo(POV, "market")));
    // Each turn's state holds it as a fresh store's does, and each turn's key moved with it.
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
    headAsAfresh(s, store.db, (r) => worlds.get(r));
    expect(moved(before, readings(s, turns))).toEqual(turns.map((t) => t.id));
  });

  test("a job's end renews every turn's key", () => {
    const { s, store, turns, worlds } = fourTurns();
    s.addChanges((turns[3] as TurnRow).id, engine(make("note", "Note", POV)).map((c) => ({ ...c, job: "job-1" })));
    const before = readings(s, turns);
    s.endJob("job-1");
    expect(moved(before, readings(s, turns))).toEqual(turns.map((t) => t.id));
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
  });

  test("a job's changes placed before a later turn, and his own changes placed among them: each turn's state and the head's are a fresh store's", () => {
    const { s, store, turns, worlds } = fourTurns();
    s.addChanges((turns[3] as TurnRow).id, engine(make("note", "Note", POV)).map((c) => ({ ...c, job: "job-1" })));
    s.endJob("job-1");
    s.addOwnerChanges("c", engine(goTo(POV, "market")));
    const t5 = play(s, "c", "m5", "Night.", 5, engine(tick(60)));
    s.addOwnerChanges("c", engine(make("map", "Folded map", POV)));
    const t6 = play(s, "c", "m6", "Dawn.", 6, engine(tick(30)));
    const all = [...turns, t5, t6];
    const before = readings(s, all);
    s.addOwnerChanges("c", engine(goTo(POV, "cellar")));
    expect(moved(before, readings(s, all))).toEqual([]);
    // The job's change and his first stand before the fifth turn, his second before the sixth, his third at the head.
    expect(s.stateAt(t5.id).state.world.entities.note).toBeDefined();
    expect(s.stateAt(t5.id).state.world.entities[POV]?.fields.place).toBe("market");
    expect(s.stateAt(t5.id).state.world.entities.map).toBeUndefined();
    expect(s.stateAt(t6.id).state.world.entities.map).toBeDefined();
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("cellar");
    sameAsAfresh(s, store.db, all, (r) => worlds.get(r));
    headAsAfresh(s, store.db, (r) => worlds.get(r));
  });

  test("a write the database takes back leaves no key or held state naming what it wrote", () => {
    const { s, store, turns, worlds } = fourTurns();
    const [, t2, , t4] = turns as [TurnRow, TurnRow, TurnRow, TurnRow];
    const before = readings(s, turns);
    expect(() =>
      store.db.transaction(() => {
        s.addChanges(t2.id, engine(make("ghost", "Ghost", POV)));
        // Read inside the write: the state holds the change the database is about to take back.
        expect(s.stateAt(t4.id).state.world.entities.ghost).toBeDefined();
        throw new Error("taken back");
      })(),
    ).toThrow("taken back");
    const after = readings(s, turns);
    for (const t of turns) expect(s.stateAt(t.id).state.world.entities.ghost).toBeUndefined();
    // What was held from inside the write is never named again: each key now is another than every key given inside it.
    expect(after.get(t4.id)?.key).not.toBe(undefined);
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
    // The next write starts again from the database's marks, and folds as a fresh store does.
    s.addChanges(t4.id, engine(make("bell", "Bell", POV)));
    expect(s.stateAt(t4.id).state.world.entities.bell).toBeDefined();
    expect(moved(before, readings(s, turns)).length).toBeGreaterThan(0);
    sameAsAfresh(s, store.db, turns, (r) => worlds.get(r));
  });

  test("a store opened again on the database names the turns its first write does not reach as it did before it", () => {
    const { store, turns, worlds } = fourTurns();
    const again = openStore({ areas: [STORY_STORE_AREA], db: store.db, registry: registry(), worlds: (r) => worlds.get(r) }).user(USER);
    const before = readings(again, turns);
    const next = play(again, "c", "m5", "Night.", 5, engine(tick(60)));
    expect(moved(before, readings(again, turns))).toEqual([]);
    sameAsAfresh(again, store.db, [...turns, next], (r) => worlds.get(r));
  });
});

describe("branches that share history", () => {
  /** A source chat of three turns and a branch of it made at the second reply, each shown as the chat application shows it. */
  function forked() {
    let at = 0;
    const { s, store, revision, worlds } = testStore({ now: () => ++at });
    s.createChat({ id: "source", revision });
    const t1 = play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const t2 = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar")));
    const t3 = play(s, "source", "m3", "A long rest.", 3, engine(tick(120)));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2], ["u3", "rest"], ["m3", "A long rest.", 3]));
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" } });
    return { s, store, worlds, t1, t2, t3 };
  }

  test("a change landed on a shared turn renews a branch's turn made after it that now stands rebased off it", () => {
    const { s, store, worlds, t2 } = forked();
    // The branch plays its own turn after the shared second reply, then the second reply is deleted from the branch: its turn stands rebased.
    const u3 = play(s, "branch", "b-m3", "Up to the roof.", 4, engine(make("rope", "Rope", POV)));
    s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", "Down the stairs.", 2], ["b-u3", "up"], ["b-m3", "Up to the roof.", 4]));
    s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u3", "up"], ["b-m3", "Up to the roof.", 4]));
    expect(s.path("branch").some((e) => e.turn === t2.id)).toBe(false);
    const key = s.foldKey(u3.id);
    expect(s.stateAt(u3.id).state.world.entities.coin).toBeUndefined();
    // A change lands on the shared second reply: the branch's turn was made on a path through it.
    s.addEarlier(t2.id, engine(make("coin", "Coin", POV)));
    expect(s.foldKey(u3.id)).not.toBe(key);
    expect(s.stateAt(u3.id).state.world.entities.coin).toBeDefined();
    sameAsAfresh(s, store.db, [u3, t2], (r) => worlds.get(r));
  });

  test("a job of a shared turn that ends renews the branch's own reading, which holds a change of his", () => {
    const { s, store, worlds, t2 } = forked();
    s.addChanges(t2.id, engine(make("note", "Note", POV)).map((c) => ({ ...c, job: "job-1" })));
    s.addOwnerChanges("branch", engine(goTo(POV, "market")));
    // The branch's path as the chat application gives a prompt it (`SeenMessage`): its reply's swipe, no dates.
    const lines: SeenMessage[] = [["b-u1", "in"], ["b-m1", "Into the inn."], ["b-u2", "down"], ["b-m2", "Down the stairs."]].map(([id, text], index) => ({ id: id as string, user: index % 2 === 0, index, swipe: 0, hash: hashOf(text as string) }));
    // The branch's next question, answered before the job of the shared second turn ends and after: after, it has what the job changed.
    const ask = () => s.turnStart("branch", lines, { follows: "b-m2" });
    const before = ask();
    expect(before.state.world.entities.note).toBeUndefined();
    s.endJob("job-1");
    const after = ask();
    expect(after.state.world.entities.note).toBeDefined();
    const fresh = openStore({ areas: [STORY_STORE_AREA], db: store.db, registry: registry(), worlds: (r) => worlds.get(r) }).user(USER);
    const afresh = fresh.turnStart("branch", lines, { follows: "b-m2" });
    expect(JSON.parse(JSON.stringify(after.state))).toEqual(JSON.parse(JSON.stringify(afresh.state)));
  });
});

describe("a thread's fold", () => {
  test("is held here under the node's mark after later turns, so a long read hands its fold to the thread once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rpe-node-marks-"));
    try {
      const path = join(dir, "rpe.db");
      const db = new Database(path);
      migrateStore(db);
      let runs = 0;
      const away: StoreAway = {
        path,
        run: async (brief, job) => {
          runs++;
          return foldAway({ brief, job }, [STORY_STORE_AREA]);
        },
      };
      let at = 0;
      const store = openStore({ db, registry: registry(), worlds: storedWorlds(db), areas: [STORY_STORE_AREA], away, workerFoldAt: 1, now: () => ++at });
      const s = store.user(USER);
      const world = inventedWorld();
      const revision = hashJson(world);
      s.putWorld(revision, world);
      s.createChat({ id: "c", revision });
      const turns = [play(s, "c", "m1", "Morning.", 1, engine(tick(10), goTo(POV, "cellar"))), play(s, "c", "m2", "A lamp.", 2, engine(make("lamp", "Lamp", POV), tick(5))), play(s, "c", "m3", "Later.", 3, engine(tick(5), tick(5)))];
      const t2 = turns[1] as TurnRow;
      const key = s.foldKey(t2.id);
      // Nothing held: the read of the second turn's state folds over more changes than run here.
      store.dropCaches();
      const read = await store.afar(() => s.stateAt(t2.id));
      expect(runs).toBe(1);
      expect(s.stateAt(t2.id)).toBe(read);
      expect(s.foldKey(t2.id)).toBe(key);
      expect(read.state.world.entities.lamp).toBeDefined();
      store.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
