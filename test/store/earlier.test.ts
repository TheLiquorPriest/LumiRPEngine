// History written after it was played (plan §6.3, §10.10; R-54, R-130, E-58): held changes landed on their own earlier turn with the later
// turns applied again on top, a comparison made between turns told once at the next turn's start, and one chat's snapshots dropped.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { carried, engine, goTo, hand, hashOf, make, play, POV, shown, testStore, tick, USER } from "./fixtures";

const chat3 = shown(["u1", "in"], ["m1", "Wren comes in.", 1], ["u2", "on"], ["m2", "She sits down.", 2], ["u3", "then"], ["m3", "She goes out to the market.", 3]);

describe("history written after it was played", () => {
  test("held changes added on their own turn: a later value stands, what no longer applies is listed, the stretch is reported once", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in.", 1, engine(tick(10)));
    const t2 = play(s, "c", "m2", "She sits down.", 2, engine(tick(5)));
    const t3 = play(s, "c", "m3", "She goes out to the market.", 3, engine(goTo(POV, "market_square"), ...hand("knife", "satchel", "odile")));
    s.sync("c", chat3);
    const clock = s.headState("c").state.world.clock;
    // The answer lands the held turn's changes where they were made: she had gone to the cellar, waited a while and made a lantern.
    const { changes, landed } = s.addEarlier(t2.id, engine(goTo(POV, "cellar"), tick(7), make("lantern", "Lantern", POV)));
    expect(changes.map((c) => [c.turn, c.applied, c.reports.map((r) => r.code)])).toEqual([
      [t2.id, false, ["later_value"]],
      [t2.id, true, []],
      [t2.id, true, []],
    ]);
    expect(changes[0]?.reports[0]?.values).toEqual({ turn: 3 });
    // The later value stands; the rest of the held turn is in the state, under the later turn's.
    const head = s.headState("c").state.world;
    expect(head.entities[POV]?.fields.place).toBe("market_square");
    expect(head.clock).toBe(clock + 7);
    expect(carried(head, POV)).toContain("lantern");
    expect(carried(head, "odile")).toContain("knife");
    expect(s.stateAt(t2.id).state.world.entities.lantern).toBeDefined();
    // The stretch from the turn to the head is the one to look over, and nothing of it stopped applying.
    expect(landed.map((l) => [l.chat, l.rebased, l.notApplied])).toEqual([["c", { from: "m3", to: "m3", turns: [t3.id] }, []]]);
    // The next turn's start tells the stretch once.
    const told = s.sync("c", chat3);
    expect(told.rebased).toEqual({ from: "m3", to: "m3", turns: [t3.id] });
    expect(s.sync("c", chat3).rebased).toBeNull();
  });


  test("a swipe compared between turns is told at the next turn's start, once", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Wren comes in.", 1, engine(tick(10)));
    const lantern = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV)));
    play(s, "c", "m3", "She goes down.", 3, engine(...hand("lantern", POV, "cask")));
    const candle = s.beginTurn({ chat: "c", kind: "swipe", on: t1.node });
    s.addChanges(candle.id, engine(make("candle", "Candle", POV)));
    s.tieTurn(candle.id, { message: "m2", hash: hashOf("Bram lends her a candle."), date: 22 });
    const lit = shown(["u1", "in"], ["m1", "Wren comes in.", 1], ["u2", "light"], ["m2", "Bram lends her a lantern.", 2], ["u3", "down"], ["m3", "She goes down.", 3]);
    const flipped = shown(["u1", "in"], ["m1", "Wren comes in.", 1], ["u2", "light"], ["m2", "Bram lends her a candle.", 22], ["u3", "down"], ["m3", "She goes down.", 3]);
    s.sync("c", lit);
    // Asked between turns, the comparison tells what it found and keeps it.
    const between = s.sync("c", flipped, undefined, undefined, { keep: true });
    expect(between.flipped).toEqual([{ message: "m2", from: lantern.id, to: candle.id }]);
    // At the next turn's start the comparison finds nothing new, and tells what was kept, once.
    const start = s.sync("c", flipped);
    expect(start.flipped).toEqual([{ message: "m2", from: lantern.id, to: candle.id }]);
    expect(start.rebased?.from).toBe("m3");
    expect(start.notApplied.length).toBeGreaterThan(0);
    const next = s.sync("c", flipped);
    expect(next.flipped).toEqual([]);
  });

  test("a chat's snapshots dropped: every state read after is the same, and snapshots come back when due", () => {
    const ts = testStore({ snapshotEvery: 2, turnStatesKept: 0 });
    const { s, store, revision } = ts;
    s.createChat({ id: "c", revision });
    const turns = [1, 2, 3, 4, 5, 6, 7].map((n) => play(s, "c", `m${n}`, `Reply ${n}.`, n, engine(tick(n))));
    const other = s.createChat({ id: "o", revision });
    play(s, "o", "p1", "Elsewhere.", 1, engine(tick(1)));
    play(s, "o", "p2", "Again.", 2, engine(tick(1)));
    // What the turns' ends held is stored by a write of its own (`storeHeld`), as the app stores it soon after each turn ends.
    s.storeHeld();
    const snapshots = (chat: string): number => store.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM snapshot s JOIN path_node n ON n.user = s.user AND n.key = s.node JOIN turn t ON t.user = n.user AND t.id = n.turn WHERE s.user = ? AND t.chat = ?").get(USER, chat)?.n ?? 0;
    const answers = (): string[] => [hashJson(s.headState("c").state), ...turns.map((t) => hashJson(s.stateAt(t.id).state))];
    const before = answers();
    expect(snapshots("c")).toBeGreaterThan(0);
    const othersBefore = snapshots(other.id);
    expect(s.dropSnapshots("c")).toBeGreaterThan(0);
    expect(snapshots("c")).toBe(0);
    expect(snapshots(other.id)).toBe(othersBefore);
    // Cold, from the start: the same answers.
    store.dropCaches();
    expect(answers()).toEqual(before);
    // The next write stores the snapshots the reads found due.
    play(s, "c", "m8", "Reply 8.", 8, engine(tick(8)));
    expect(snapshots("c")).toBeGreaterThan(0);
  });
});
