// Snapshots (plan §6.3): every N turns along a path, N a setting, a cold start begins at the nearest
// one; a change added before a snapshot drops it; a stored starting state stands for a turn's state.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { openStore, type Store } from "../../src/store/store";
import { carried, engine, goTo, hand, play, POV, registry, testStore, tick, USER, type TestStore } from "./fixtures";

const places = ["cellar", "market_square", "far_road", "common_room"];

/** `n` played turns, each passing time and moving Wren on. */
function playMany(every: number, n: number) {
  let at = 0;
  const ts = testStore({ snapshotEvery: every, now: () => ++at });
  ts.s.createChat({ id: "c", revision: ts.revision });
  const turns = Array.from({ length: n }, (_, i) => play(ts.s, "c", `m${i + 1}`, `Reply ${i + 1}.`, i + 1, engine(tick(i + 1), goTo(POV, places[i % places.length] ?? "cellar"))));
  return { ...ts, turns };
}

/** Another store over the same database: nothing held in memory, as after a restart. */
function reopened(ts: TestStore, fingerprint?: string): Store {
  return openStore({ db: ts.store.db, registry: registry(), worlds: (r) => ts.worlds.get(r), ...(fingerprint ? { fingerprint } : {}) });
}

const snapshotDepths = (store: Store): number[] =>
  store.db
    .query<{ depth: number }, []>("SELECT n.depth FROM snapshot s JOIN path_node n ON n.user = s.user AND n.key = s.node WHERE s.kind = 'cache' ORDER BY n.depth")
    .all()
    .map((r) => r.depth + 1);

describe("snapshots", () => {
  test("one is kept every N turns along a path, N being the store's setting", () => {
    const four = playMany(4, 10);
    four.s.headState("c");
    expect(snapshotDepths(four.store)).toEqual([4, 8]);
    const three = playMany(3, 10);
    three.s.headState("c");
    expect(snapshotDepths(three.store)).toEqual([3, 6, 9]);
  });

  test("a cold start begins at the nearest snapshot and ends where a fold from the start ends", () => {
    const ts = playMany(4, 10);
    const warm = hashJson(ts.s.headState("c").state);
    const cold = reopened(ts).user(USER);
    expect(hashJson(cold.headState("c").state)).toBe(warm);
    // Code with another fingerprint uses no snapshot and folds from the world's start: the same state.
    expect(hashJson(reopened(ts, "other-build").user(USER).headState("c").state)).toBe(warm);
    // What a cold start builds on is the snapshot: a state stored there is what it continues from.
    const at8 = ts.store.db.query<{ node: string; state: string }, []>("SELECT s.node, s.state FROM snapshot s JOIN path_node n ON n.user = s.user AND n.key = s.node WHERE n.depth = 7").get();
    if (!at8) throw new Error("no snapshot at turn 8");
    const doc = JSON.parse(at8.state) as { state: { world: { clock: number } } };
    doc.state.world.clock += 1000;
    ts.store.db.run("UPDATE snapshot SET state = ? WHERE node = ?", [JSON.stringify(doc), at8.node]);
    expect(reopened(ts).user(USER).headState("c").state.world.clock - cold.headState("c").state.world.clock).toBe(1000);
  });

  test("a job's change on an earlier turn drops the snapshots after it, changes no turn played, and once the job ends the next turn starts with it, cold or warm", () => {
    const ts = playMany(4, 10);
    ts.s.headState("c");
    expect(snapshotDepths(ts.store)).toEqual([4, 8]);
    const second = ts.turns[1];
    if (!second) throw new Error("no second turn");
    const head = hashJson(ts.s.headState("c").state.world);
    ts.s.addChanges(second.id, engine(...hand("knife", "satchel", "odile")).map((c) => ({ ...c, job: "late-job" })));
    expect(snapshotDepths(ts.store)).toEqual([]);
    ts.s.endJob("late-job");
    expect(hashJson(reopened(ts).user(USER).headState("c").state.world)).toBe(head);
    const next = ts.s.beginTurn({ chat: "c", kind: "normal" });
    const cold = reopened(ts).user(USER).stateAt(next.id).state.world;
    expect(carried(cold, "odile")).toEqual(["knife"]);
    expect(hashJson(cold)).toBe(hashJson(ts.s.stateAt(next.id).state.world));
  });

  test("a read writes nothing: the snapshots its fold finds are stored by the user's next write", () => {
    const ts = playMany(4, 10);
    const second = ts.turns[1];
    if (!second) throw new Error("no second turn");
    ts.s.addChanges(second.id, engine(tick(1)));
    expect(snapshotDepths(ts.store)).toEqual([]);
    const made = (): number | undefined => ts.store.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n;
    const before = made();
    ts.s.headState("c");
    ts.s.view("c");
    expect(made()).toBe(before);
    expect(snapshotDepths(ts.store)).toEqual([]);
    ts.s.updateTurn(second.id, { intent: "noted" });
    expect(snapshotDepths(ts.store)).toEqual([4, 8]);
    expect(hashJson(reopened(ts).user(USER).headState("c").state)).toBe(hashJson(ts.s.headState("c").state));
  });

  test("a stored starting state stands for a turn's state on its own path, whatever the turns before it hold", () => {
    const ts = playMany(25, 6);
    const third = ts.turns[2];
    const fifth = ts.turns[4];
    if (!third || !fifth) throw new Error("missing turns");
    // Today's state there, as a migration would store it where the two folds differ.
    const base = structuredClone(ts.s.stateAt(third.id).state.world);
    const pov = base.entities[POV];
    if (!pov) throw new Error("no POV");
    pov.fields.mood = "wary";
    ts.s.setBase(third.id, base);
    expect(ts.s.stateAt(third.id).state.world.entities[POV]?.fields.mood).toBe("wary");
    const later = ts.s.stateAt(fifth.id).state.world;
    expect(later.entities[POV]?.fields.mood).toBe("wary");
    expect(later.clock - base.clock).toBe(4 + 5);
  });

  test("a change recorded on a turn after its starting state was set is folded on top of it, after a restart too", () => {
    const ts = playMany(25, 3);
    const head = ts.turns[2];
    if (!head) throw new Error("no third turn");
    expect(ts.s.headState("c").state.world.entities[POV]?.fields.place).toBe("far_road");
    ts.s.setBase(head.id, structuredClone(ts.s.stateAt(head.id).state.world));
    // The player corrects where Wren is, on the newest reply of a migrated chat.
    ts.s.addChanges(head.id, engine(goTo(POV, "cellar")).map((c) => ({ ...c, by: "player", source: "player" as const })));
    expect(ts.s.headState("c").state.world.entities[POV]?.fields.place).toBe("cellar");
    expect(reopened(ts).user(USER).headState("c").state.world.entities[POV]?.fields.place).toBe("cellar");
    // A second, on top of the first: both stand, in order, warm and cold.
    ts.s.addChanges(head.id, engine(tick(30)));
    const warm = ts.s.headState("c").state.world;
    expect(warm.clock - ts.s.stateAt(ts.turns[1]?.id ?? "").state.world.clock).toBe(3 + 30);
    expect(hashJson(reopened(ts).user(USER).headState("c").state.world)).toBe(hashJson(warm));
  });
});
