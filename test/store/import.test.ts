// What a migration's importer needs of the store (plan §15.3): to tell a chat played on RPE from one
// only imported, and to remove everything an import wrote for an unplayed chat, its branches too, so
// the next run imports it afresh.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { UserStore } from "../../src/store/store";
import { engine, goTo, hashOf, make, play, POV, shown, testStore, tick, type TestStore } from "./fixtures";

/** Imports a reply as the importer does: an imported turn, tied to its message, with the changes today's fold applied there. */
function imported(s: UserStore, chat: string, message: string, date: number, events: LedgerEvent[], on?: string | null): string {
  const t = s.beginTurn({ chat, kind: "normal", imported: true, ...(on !== undefined ? { on } : {}) });
  s.tieTurn(t.id, { message, hash: hashOf(message), date });
  s.addChanges(t.id, engine(...events).map((c) => ({ ...c, by: "import", source: "import" as const })));
  return t.id;
}

const count = (ts: TestStore, table: string): number => ts.store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;

describe("importing", () => {
  test("a chat only imported is told apart from one played on RPE, by a turn or by a change", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const last = imported(s, "c", "m1", 1, [tick(10), goTo(POV, "cellar")]);
    expect(s.isPlayed("c")).toBe(false);
    // The player corrects where Wren is, on RPE: a change of RPE's own on an imported turn.
    s.addChanges(last, engine(goTo(POV, "far_road")).map((c) => ({ ...c, by: "player", source: "player" as const })));
    expect(s.isPlayed("c")).toBe(true);
    s.createChat({ id: "d", revision });
    imported(s, "d", "d1", 1, [tick(5)]);
    play(s, "d", "d2", "A reply played on RPE.", 2, engine(tick(1)));
    expect(s.isPlayed("d")).toBe(true);
  });

  test("forgetting an unplayed import removes everything it wrote, its branches too, and the chat imports afresh", () => {
    const ts = testStore({ snapshotEvery: 1 });
    const { s, revision } = ts;
    s.createChat({ id: "c", revision });
    const first = imported(s, "c", "m1", 1, [tick(10), make("lamp", "Lamp", POV)]);
    imported(s, "c", "m2", 2, [goTo(POV, "cellar")]);
    s.setBase(first, s.stateAt(first).state.world);
    s.branchChat({ id: "b", from: "c", map: { m1: "b1", m2: "b2" } });
    s.sync("b", shown(["b1", "m1", 1], ["b2", "m2", 2]));
    imported(s, "b", "b3", 3, [tick(1)]);
    expect(count(ts, "snapshot")).toBeGreaterThan(0);
    expect(s.forgetImport("c")).toEqual({ removed: ["c", "b"], played: [] });
    for (const table of ["chat", "turn", "change", "snapshot", "path_node", "message_link"]) expect([table, count(ts, table)]).toEqual([table, 0]);
    // The next run imports it again from scratch.
    s.createChat({ id: "c", revision });
    imported(s, "c", "m1", 1, [tick(10)]);
    expect(s.headState("c").state.world.entities.lamp).toBeUndefined();
  });

  test("forgetting an unplayed branch leaves its source whole", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    imported(s, "c", "m1", 1, [tick(10), goTo(POV, "cellar")]);
    s.branchChat({ id: "b", from: "c", map: { m1: "b1" } });
    s.sync("b", shown(["b1", "m1", 1]));
    imported(s, "b", "b2", 2, [goTo(POV, "far_road")]);
    expect(s.forgetImport("b")).toEqual({ removed: ["b"], played: [] });
    expect(s.chat("b")).toBeNull();
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("cellar");
  });

  test("a played chat, or an import a played branch builds on, is left alone and named", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    imported(s, "c", "m1", 1, [tick(10), goTo(POV, "cellar")]);
    s.branchChat({ id: "b", from: "c", map: { m1: "b1" } });
    s.sync("b", shown(["b1", "m1", 1]));
    play(s, "b", "b2", "Played on RPE in the branch.", 2, engine(goTo(POV, "far_road")));
    expect(s.forgetImport("c")).toEqual({ removed: [], played: ["b"] });
    expect(s.forgetImport("b")).toEqual({ removed: [], played: ["b"] });
    expect(s.headState("b").state.world.entities[POV]?.fields.place).toBe("far_road");
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("cellar");
  });
});
