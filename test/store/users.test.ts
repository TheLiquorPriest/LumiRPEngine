// Two users over one database (plan §4.4, Appendix B: every table carries the user). With chats and
// messages of the same ids, neither sees, folds or changes the other's rows through any call of the
// store's API: a call given the other's id refuses it as it would an id that is not there.

import { describe, expect, test } from "bun:test";
import type { WorldState } from "../../src/engine/state";
import { hashJson } from "../../src/shared/hash";
import { STORE_TABLES } from "../../src/store/schema";
import type { SessionRow, Store, UserStore } from "../../src/store/store";
import { StoreInputError, type TurnRow } from "../../src/store/types";
import { engine, goTo, hashOf, play, POV, shown, testStore, tick } from "./fixtures";

interface Played {
  t1: TurnRow;
  t2: TurnRow;
  t3: TurnRow;
  /** A turn begun and not tied, with a staged change. */
  open: TurnRow;
  session: SessionRow;
}

/** A chat "c" of three replies m1 to m3 (the second moving Wren to `place`), and an imported chat "imp". */
function playAs(s: UserStore, revision: string, place: string): Played {
  s.createChat({ id: "c", revision });
  const t1 = play(s, "c", "m1", "Morning.", 1, engine(tick(10)));
  const t2 = play(s, "c", "m2", "Off she goes.", 2, engine(goTo(POV, place)));
  const t3 = play(s, "c", "m3", "Evening.", 3, engine(tick(60)));
  const open = s.beginTurn({ chat: "c", kind: "normal" });
  s.addChanges(open.id, engine(tick(5)));
  const session = s.openSession({ chat: "c", scene: "evening", turn: t3.id });
  s.createChat({ id: "imp", revision });
  const imported = s.beginTurn({ chat: "imp", kind: "normal", imported: true });
  s.tieTurn(imported.id, { message: "i1", hash: hashOf("Imported."), date: 1 });
  s.addChanges(imported.id, engine(tick(1)).map((c) => ({ ...c, by: "import", source: "import" as const })));
  return { t1, t2, t3, open, session };
}

/** Every row of `user`'s, table by table, as stored. */
const rowsOf = (store: Store, user: string): string => JSON.stringify(STORE_TABLES.map((table) => store.db.query(`SELECT * FROM ${table} WHERE user = ? ORDER BY rowid`).all(user)));

const placeOf = (s: UserStore, chat: string): unknown => s.headState(chat).state.world.entities[POV]?.fields.place;

/** Every call of the API, made by `me`: on the chats both have by the same ids, and on `theirs`'s ids wherever a call takes one. */
function exercise(store: Store, me: UserStore, mine: Played, theirs: Played): void {
  // Reads see only `me`'s rows.
  expect(me.turn(theirs.t2.id)).toBeNull();
  expect(me.changes(theirs.t2.id)).toEqual([]);
  expect(me.session(theirs.session.id)).toBeNull();
  expect(me.swipes("c", "m2").map((t) => t.id)).toEqual([mine.t2.id]);
  expect(me.path("c").flatMap((e) => (e.turn === null ? [] : [e.turn]))).toEqual([mine.t1.id, mine.t2.id, mine.t3.id]);
  expect(me.sessions("c").map((x) => x.id)).toEqual([mine.session.id]);
  expect(me.isPlayed("c")).toBe(true);
  expect(me.isPlayed("imp")).toBe(false);
  me.view("c").query(POV, "full");
  me.viewAt(mine.t2.id).query(POV, "full");
  // Every call given one of their ids refuses it, as it would an id that is not there.
  const world: WorldState = structuredClone(me.stateAt(mine.t3.id).state.world);
  const refused: [string, () => unknown][] = [
    ["stateAt", () => me.stateAt(theirs.t2.id)],
    ["viewAt", () => me.viewAt(theirs.t2.id)],
    ["addChanges", () => me.addChanges(theirs.t2.id, engine(tick(1)))],
    ["tieTurn", () => me.tieTurn(theirs.open.id, { message: "m4", hash: hashOf("Night."), date: 4 })],
    ["dropTurn", () => me.dropTurn(theirs.open.id)],
    ["dropStaged", () => me.dropStaged(theirs.open.id)],
    ["updateTurn", () => me.updateTurn(theirs.t3.id, { intent: "theirs" })],
    ["setBase", () => me.setBase(theirs.t3.id, world)],
    ["extendPath from their node", () => me.extendPath(theirs.t1.node, mine.t2.id)],
    ["extendPath with their turn", () => me.extendPath(null, theirs.t2.id)],
    ["beginTurn on their node", () => me.beginTurn({ chat: "c", kind: "normal", on: theirs.t3.node })],
    ["openSession by their turn", () => me.openSession({ chat: "c", scene: "theirs", turn: theirs.t1.id })],
    ["closeSession of theirs", () => me.closeSession(theirs.session.id, mine.t3.id)],
  ];
  for (const [name, call] of refused) {
    let error: unknown = null;
    try {
      call();
    } catch (caught) {
      error = caught;
    }
    expect([name, error instanceof StoreInputError]).toEqual([name, true]);
  }
  // Writes on the chats both have by the same ids change only `me`'s.
  const edit = me.sync("c", shown(["m1", "Morning.", 1], ["m2", "Off she goes, quickly.", 2], ["m3", "Evening.", 3]));
  expect(edit.edited.map((e) => e.turn)).toEqual([mine.t2.id]);
  const max = (): number | null => store.db.query<{ n: number | null }, [string]>("SELECT max(id) AS n FROM change WHERE user = ?").get(me.id)?.n ?? null;
  const newest = max();
  me.setBase(mine.t3.id, world);
  // The starting state stands within this user's changes, whatever the other has recorded since.
  expect(store.db.query<{ upto: number }, [string, string]>("SELECT upto FROM snapshot WHERE user = ? AND node = ? AND kind = 'base'").get(me.id, mine.t3.node)?.upto).toBe(newest ?? 0);
  me.addChanges(mine.t3.id, engine(goTo(POV, "common_room")));
  expect(placeOf(me, "c")).toBe("common_room");
  me.updateTurn(mine.t3.id, { intent: "mine" });
  me.closeSession(mine.session.id, mine.t3.id);
  me.openSession({ chat: "c", scene: "night", turn: mine.t3.id });
  me.branchChat({ id: "b", from: "c", map: { m1: "b1", m2: "b2", m3: "b3" } });
  me.sync("b", shown(["b1", "Morning.", 1], ["b2", "Off she goes, quickly.", 2], ["b3", "Evening.", 3]));
  expect(placeOf(me, "b")).toBe("common_room");
  // A turn of the branch set on another path of its own, as an importer rebuilding one does.
  const step = me.beginTurn({ chat: "b", kind: "normal" });
  expect(me.extendPath(mine.t2.node, step.id)).not.toBe(step.node);
  me.dropTurn(step.id);
  expect(me.forgetImport("imp")).toEqual({ removed: ["imp"], played: [] });
}

describe("two users over one database", () => {
  test("with chats and messages of the same ids, neither sees, folds or changes the other's rows through any call", () => {
    const { store, revision } = testStore({ snapshotEvery: 2 });
    const ann = store.user("ann");
    const bob = store.user("bob");
    const a = playAs(ann, revision, "cellar");
    const b = playAs(bob, revision, "far_road");
    expect([placeOf(ann, "c"), placeOf(bob, "c")]).toEqual(["cellar", "far_road"]);
    for (const [me, mine, other, theirs] of [
      [ann, a, bob, b],
      [bob, b, ann, a],
    ] as const) {
      const rows = rowsOf(store, other.id);
      const state = hashJson(other.headState("c").state);
      exercise(store, me, mine, theirs);
      expect(rowsOf(store, other.id)).toBe(rows);
      expect(hashJson(other.headState("c").state)).toBe(state);
    }
    // Deleting a chat, and taking back staged changes, by the same ids: the other's stay whole.
    const bobs = rowsOf(store, "bob");
    expect(ann.dropStaged(a.open.id)).toBe(1);
    ann.deleteChat("b");
    ann.deleteChat("c");
    expect(ann.chat("c")).toBeNull();
    expect(rowsOf(store, "bob")).toBe(bobs);
    expect(placeOf(bob, "c")).toBe("common_room");
    expect(bob.swipes("c", "m2").map((t) => t.id)).toEqual([b.t2.id]);
  });
});
