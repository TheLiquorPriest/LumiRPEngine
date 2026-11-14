// The turn tree (plan §6.3): swipes are siblings, the path is the chain of showing swipes, a swipe is
// known by its date and saved hash and never by its position, messages gone take their turns off the
// path, and a branch shares its source's turns through the chat application's old-to-new id map.

import { describe, expect, test } from "bun:test";
import { castAt } from "../../src/cast/path";
import { swipeIndex } from "../../src/store/path";
import type { UserStore } from "../../src/store/store";
import { StoreInputError } from "../../src/store/types";
import { storyAt } from "../../src/story/path";
import { carried, engine, goTo, hashOf, make, play, POV, shown, testStore, tick } from "./fixtures";

const placeOf = (s: UserStore, chat: string): unknown => s.headState(chat).state.world.entities[POV]?.fields.place;

describe("the turn tree", () => {
  test("swipes of a reply are siblings under one parent, and the path follows the swipe showing", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "They meet.", 1, engine(tick(10)));
    const a = play(s, "c", "m2", "She goes down to the cellar.", 2, engine(goTo(POV, "cellar")));
    const b = play(s, "c", "m2", "She steps out to the market.", 3, engine(goTo(POV, "market_square")), { target: "m2" });
    expect([a.parent, b.parent]).toEqual([t1.id, t1.id]);
    expect(s.swipes("c", "m2").map((t) => t.id)).toEqual([a.id, b.id]);
    // The newest swipe joined the path when it was tied; showing the first swipe again swaps it back.
    expect(placeOf(s, "c")).toBe("market_square");
    const report = s.sync("c", shown(["u1", "hello"], ["m1", "They meet.", 1], ["u2", "where now"], ["m2", "She goes down to the cellar.", 2]));
    expect(report.swiped).toEqual({ message: "m2", from: b.id, to: a.id });
    expect(report.flipped).toEqual([]);
    expect(s.path("c").filter((e) => e.turn !== null).map((e) => e.turn)).toEqual([t1.id, a.id]);
    expect(placeOf(s, "c")).toBe("cellar");
  });

  test("a deleted swipe moves nothing: the turn showing is found by its date and saved hash, not its position", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Morning.", 1, []);
    const texts = ["To the cellar.", "To the market.", "Onto the far road."];
    const places = ["cellar", "market_square", "far_road"];
    const swipes = texts.map((text, i) => play(s, "c", "m2", text, 10 + i, engine(goTo(POV, places[i] ?? "")), i === 0 ? {} : { target: "m2" }));
    // The chat application deletes the first swipe: the third is now at position 1, and it is the one showing.
    const now = [
      { hash: hashOf(texts[1] ?? ""), date: 11 },
      { hash: hashOf(texts[2] ?? ""), date: 12 },
    ];
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", texts[2] ?? "", 12]));
    expect(placeOf(s, "c")).toBe("far_road");
    const third = swipes[2];
    if (!third) throw new Error("no third swipe");
    expect(swipeIndex(third, now)).toBe(1);
    // Showing what is now at position 0 is the second swipe, with its own state.
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", texts[1] ?? "", 11]));
    expect(placeOf(s, "c")).toBe("market_square");
  });

  test("editing a reply whose swipes share one date keeps the turn showing there, flagged edited", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Morning.", 1, []);
    // Lumiverse's own migration gave every swipe of an older message the message's date.
    const a = play(s, "c", "m2", "To the cellar.", 7, engine(goTo(POV, "cellar")));
    const b = play(s, "c", "m2", "To the market.", 7, engine(goTo(POV, "market_square")), { target: "m2" });
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", "To the market.", 7]));
    expect(placeOf(s, "c")).toBe("market_square");
    const report = s.sync("c", shown(["m1", "Morning.", 1], ["m2", "To the market, the long way round.", 7]));
    expect(report.edited).toEqual([{ turn: b.id, message: "m2", saved: hashOf("To the market."), now: hashOf("To the market, the long way round.") }]);
    expect(report.unplayed).toEqual([]);
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(b.id);
    expect(s.turn(b.id)?.edited).toBe(hashOf("To the market, the long way round."));
    expect(placeOf(s, "c")).toBe("market_square");
    // The other swipe is still told apart by its own text.
    s.sync("c", shown(["m1", "Morning.", 1], ["m2", "To the cellar.", 7]));
    expect(s.path("c").find((e) => e.message === "m2")?.turn).toBe(a.id);
    expect(placeOf(s, "c")).toBe("cellar");
  });

  test("a path is extended only from a node there is, with a turn there is, and a refusal writes nothing", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Morning.", 1, []);
    const t2 = play(s, "c", "m2", "Noon.", 2, []);
    const nodes = () => store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM path_node").get()?.n;
    const before = nodes();
    expect(() => s.extendPath("no-such-node", t2.id)).toThrow(StoreInputError);
    expect(() => s.extendPath(t1.node, "no-such-turn")).toThrow(StoreInputError);
    expect(nodes()).toBe(before);
    // From a node that is there, one deeper: here, the node the second turn was made on.
    expect(s.extendPath(t1.node, t2.id)).toBe(t2.node);
    expect(store.db.query<{ depth: number }, [string]>("SELECT depth FROM path_node WHERE key = ?").get(t2.node)?.depth).toBe(1);
    expect(nodes()).toBe(before);
  });

  test("messages gone leave the path and the state rewinds by itself", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "One.", 1, engine(tick(5), goTo(POV, "cellar")));
    const t2 = play(s, "c", "m2", "Two.", 2, engine(tick(7), make("lamp", "Lamp", POV)));
    const t3 = play(s, "c", "m3", "Three.", 3, engine(tick(9), goTo(POV, "far_road")));
    s.sync("c", shown(["u1", "a"], ["m1", "One.", 1], ["u2", "b"], ["m2", "Two.", 2], ["u3", "c"], ["m3", "Three.", 3]));
    const before = s.stateAt(t1.id).state.world;
    const report = s.sync("c", shown(["u1", "a"], ["m1", "One.", 1]));
    expect(report.gone).toEqual([
      { message: "u2", turn: null },
      { message: "m2", turn: t2.id },
      { message: "u3", turn: null },
      { message: "m3", turn: t3.id },
    ]);
    const head = s.headState("c").state.world;
    expect([head.clock, head.entities[POV]?.fields.place, carried(head, POV)]).toEqual([before.clock, before.entities[POV]?.fields.place, carried(before, POV)]);
    expect(carried(head, POV)).not.toContain("lamp");
  });

  test("comparing paths finds an edited reply once, and the replies no turn played after the first that one did", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const first = s.beginTurn({ chat: "c", kind: "normal" });
    s.tieTurn(first.id, { message: "m1", hash: hashOf("The first reply."), date: 2 });
    const base = shown(["m0", "A greeting from before.", 0], ["u1", "go"], ["m1", "The first reply.", 2], ["u2", "on"], ["m2", "Written elsewhere.", 3], ["u3", "more"], ["m3", "Also elsewhere.", 4]);
    const report = s.sync("c", base);
    expect(report.unplayed).toEqual([{ from: "m2", to: "m3", count: 2 }]);
    expect(report.edited).toEqual([]);
    // The user edits the first reply: same swipe date, different text.
    const edited = base.map((m) => (m.id === "m1" ? { ...m, hash: hashOf("The first reply, edited.") } : m));
    const again = s.sync("c", edited);
    expect(again.edited).toEqual([{ turn: first.id, message: "m1", saved: hashOf("The first reply."), now: hashOf("The first reply, edited.") }]);
    expect(s.turn(first.id)?.edited).toBe(hashOf("The first reply, edited."));
    expect(s.path("c").find((e) => e.message === "m1")?.turn).toBe(first.id);
    expect(s.sync("c", edited).edited).toEqual([]);
  });

  test("a branch made from the fork's old-to-new map shares the source's turns, and each chat goes its own way after", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "source", revision });
    const t1 = play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar"), make("lamp", "Lamp", POV)));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    const report = s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", "Down the stairs.", 2]));
    expect(report.branched).toEqual({ from: "source", at: "m2" });
    expect(s.path("branch").filter((e) => e.turn !== null)[0]?.turn).toBe(t1.id);
    const shared = (chat: string) => {
      const w = s.headState(chat).state.world;
      return [w.clock, w.entities[POV]?.fields.place, carried(w, POV)];
    };
    expect(shared("branch")).toEqual(shared("source"));
    // One more turn in each: the branch walks out to the market, the source rests a while.
    play(s, "branch", "b-m3", "Out to the market.", 3, engine(goTo(POV, "market_square")));
    play(s, "source", "m3", "A long rest.", 4, engine(tick(120)));
    const branch = s.headState("branch").state.world;
    const source = s.headState("source").state.world;
    expect(branch.entities[POV]?.fields.place).toBe("market_square");
    expect(source.entities[POV]?.fields.place).toBe("cellar");
    expect(source.clock - branch.clock).toBe(120);
    expect(carried(branch, POV)).toEqual(carried(source, POV));
  });

  test("a branch's turn begun after a reply it shares takes that reply's place on the branch's path with a node of its own: the shared turn's changes stay on the branch's path, and the source's path is untouched", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const shared = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar")));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    const sourcePath = s.path("source");
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    const branchShown = (last: string) => shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", last, 2]);
    s.sync("branch", branchShown("Down the stairs."));

    // The branch's copy of the shared reply goes on in a turn of the branch's own, after the shared one, tied to the longer text.
    const on = s.path("branch").find((e) => e.message === "b-m2")?.node ?? null;
    const own = play(s, "branch", "b-m2", "Down the stairs. The lamp gutters.", 2, engine(tick(30)), { on, kind: "continue" });
    expect(own.parent).toBe(shared.id);
    expect(s.path("branch").find((e) => e.message === "b-m2")).toMatchObject({ turn: own.id, node: own.node, own: true, hash: hashOf("Down the stairs. The lamp gutters.") });
    // The branch's state holds the shared turn's changes, then its own.
    const branch = s.headState("branch").state.world;
    expect(branch.entities[POV]?.fields.place).toBe("cellar");
    expect(branch.clock - s.headState("source").state.world.clock).toBe(30);
    // The source keeps its path, and its turn keeps its message and text.
    expect(s.path("source")).toEqual(sourcePath);
    expect(s.turn(shared.id)).toMatchObject({ message: "m2", hash: hashOf("Down the stairs.") });

    // The branch compared again as it now shows finds nothing, and its next turn follows its own.
    expect(s.sync("branch", branchShown("Down the stairs. The lamp gutters."))).toMatchObject({ gone: [], swiped: null, flipped: [], rebased: null, unplayed: [] });
    expect(s.path("branch").find((e) => e.message === "b-m2")).toMatchObject({ turn: own.id, node: own.node, own: true });
    expect(play(s, "branch", "b-m3", "Out to the market.", 3, engine(goTo(POV, "market_square"))).parent).toBe(own.id);
    expect(s.headState("branch").state.world.entities[POV]?.fields.place).toBe("market_square");
    expect(s.headState("source").state.world.entities[POV]?.fields.place).toBe("cellar");
  });

  test("a branch's continue of a reply it shares keeps the shared turn on the branch's line, for every reader of it and through a comparison that rebuilds the path; the source is untouched", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "source", revision });
    const first = play(s, "source", "m1", "Into the inn.", 1, engine(tick(15)));
    const shared = play(s, "source", "m2", "Down the stairs.", 2, engine(goTo(POV, "cellar")));
    s.sync("source", shown(["u1", "in"], ["m1", "Into the inn.", 1], ["u2", "down"], ["m2", "Down the stairs.", 2]));
    const sourcePath = s.path("source");
    s.branchChat({ id: "branch", from: "source", map: { u1: "b-u1", m1: "b-m1", u2: "b-u2", m2: "b-m2" }, at: "m2" });
    s.sync("branch", shown(["b-u1", "in"], ["b-m1", "Into the inn.", 1], ["b-u2", "down"], ["b-m2", "Down the stairs.", 2]));
    const on = s.path("branch").find((e) => e.message === "b-m2")?.node ?? null;
    const own = play(s, "branch", "b-m2", "Down the stairs. The lamp gutters.", 2, engine(tick(30)), { on, kind: "continue" });

    // The shared turn stands on the branch's line just before the branch's own, at the same reply, for the story's and the cast's
    // readings, at the head and at the branch's turn.
    const line = [first.id, shared.id, own.id];
    expect(s.line("branch").map((l) => l.turn)).toEqual(line);
    expect(storyAt(s, "branch", null).turns).toEqual(line);
    expect(storyAt(s, "branch", own.id).replyOf(shared.id)).toBe(3);
    expect(castAt(s, "branch", null).turns).toEqual(line);
    expect(castAt(s, "branch", own.id).turns).toEqual(line);

    // The branch deletes its first reply: the comparison rebuilds its path, and the shared turn's move is still there, then the branch's own.
    s.sync("branch", shown(["b-u1", "in"], ["b-u2", "down"], ["b-m2", "Down the stairs. The lamp gutters.", 2]));
    expect(s.line("branch").map((l) => l.turn)).toEqual([shared.id, own.id]);
    expect(storyAt(s, "branch", null).turns).toEqual([shared.id, own.id]);
    expect(placeOf(s, "branch")).toBe("cellar");
    expect(s.headState("branch").state.world.clock - s.headState("source").state.world.clock).toBe(30 - 15);
    // The branch compared again as it shows finds nothing, and keeps the same line.
    expect(s.sync("branch", shown(["b-u1", "in"], ["b-u2", "down"], ["b-m2", "Down the stairs. The lamp gutters.", 2]))).toMatchObject({ gone: [], swiped: null, flipped: [], unplayed: [] });
    expect(s.line("branch").map((l) => l.turn)).toEqual([shared.id, own.id]);

    // The source keeps its path, its line and its state throughout.
    expect(s.path("source")).toEqual(sourcePath);
    expect(s.line("source").map((l) => l.turn)).toEqual([first.id, shared.id]);
    expect(placeOf(s, "source")).toBe("cellar");
  });

  test("deleting a chat keeps the turns a branch still shares, and removes them once nothing does", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(goTo(POV, "cellar")));
    s.branchChat({ id: "branch", from: "source", map: { m1: "b-m1" } });
    s.sync("branch", shown(["b-m1", "Into the inn.", 1]));
    expect(s.deleteChat("source")).toEqual({ kept: true });
    expect(s.headState("branch").state.world.entities[POV]?.fields.place).toBe("cellar");
    expect(s.deleteChat("branch")).toEqual({ kept: false });
    const left = (table: string) => store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    for (const table of ["message_link", "chat", "turn", "change", "path_node"]) expect([table, left(table)]).toEqual([table, 0]);
  });

  test("a user's chats are listed oldest first: not a chat deleted while a branch still shares its turns, nor another user's", () => {
    const { s, store, revision } = testStore();
    s.createChat({ id: "source", revision });
    play(s, "source", "m1", "Into the inn.", 1, engine(goTo(POV, "cellar")));
    s.createChat({ id: "plain" });
    s.branchChat({ id: "branch", from: "source", map: { m1: "b-m1" } });
    store.user("user-b").createChat({ id: "theirs" });
    expect(s.chats().map((c) => [c.id, c.revision])).toEqual([
      ["source", revision],
      ["plain", null],
      ["branch", revision],
    ]);
    expect(s.deleteChat("source")).toEqual({ kept: true });
    expect(s.chats().map((c) => c.id)).toEqual(["plain", "branch"]);
  });
});
