// What the old engines recorded, kept in the store (plan §15.2): today's state at any swipe, the text a turn was played on and the
// mark that it was edited, the chat's own record, and why a reply stands with no turn.

import { describe, expect, test } from "bun:test";
import { carried, engine, goTo, hand, hashOf, make, play, POV, shown, testStore, tick } from "./fixtures";

/** Three replies; the second has another swipe, made later, which stands off the head's path. */
function swiped() {
  const ts = testStore();
  const { s, revision } = ts;
  s.createChat({ id: "c", revision });
  const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
  const lantern = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV), tick(5)));
  const t3 = play(s, "c", "m3", "She takes it down to the cellar.", 3, engine(goTo(POV, "cellar"), ...hand("lantern", POV, "cask")));
  const candle = s.beginTurn({ chat: "c", kind: "swipe", on: t1.node });
  s.addChanges(candle.id, engine(make("candle", "Candle", POV), tick(15)));
  s.tieTurn(candle.id, { message: "m2", hash: hashOf("Bram lends her a candle."), date: 22 });
  return { ...ts, t1, lantern, t3, candle };
}

const withLantern = shown(["u1", "in"], ["m1", "Wren comes in from the rain.", 1], ["u2", "light"], ["m2", "Bram lends her a lantern.", 2], ["u3", "down"], ["m3", "She takes it down to the cellar.", 3]);
const withCandle = shown(["u1", "in"], ["m1", "Wren comes in from the rain.", 1], ["u2", "light"], ["m2", "Bram lends her a candle.", 22], ["u3", "down"], ["m3", "She takes it down to the cellar.", 3]);

describe("a carried chat's states, texts and record", () => {
  test("a swipe off the head's path keeps the starting state set on it, and a flip to it gives that state", () => {
    const { s, candle, t3 } = swiped();
    s.sync("c", withLantern);
    const own = s.stateAt(candle.id).state.world;
    s.setBase(candle.id, { ...own, clock: own.clock + 1000 });
    expect(s.stateAt(candle.id).state.world.clock).toBe(own.clock + 1000);
    const before = s.headState("c").state.world.clock;
    // The head is not on the candle's path: nothing there changed.
    expect(s.headState("c").state.world.clock).toBe(before);
    s.sync("c", withCandle);
    // The later turn stands on the candle now, applied on top of the state the candle starts from.
    const flipped = s.headState("c").state.world;
    expect(flipped.clock).toBe(own.clock + 1000);
    expect(carried(flipped, POV)).toContain("candle");
    // The head of the rebased chat takes a starting state of its own, at the node it stands at; the turn's own path is left as it was.
    const head = s.path("c").findLast((e) => e.turn === t3.id);
    expect(head?.own).toBe(false);
    s.setBase(t3.id, { ...flipped, clock: 7777 }, head?.node ?? "");
    expect(s.headState("c").state.world.clock).toBe(7777);
    expect(() => s.setBase(t3.id, flipped, "not-a-node-of-it")).toThrow("not a path node");
  });

  test("a carried turn marked edited is reported as an edit at the first comparison, with the text it was played on", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const turn = s.beginTurn({ chat: "c", kind: "normal", imported: true });
    s.tieTurn(turn.id, { message: "m1", hash: hashOf("She waits."), date: 1, text: "She waits." });
    // The import's own comparison finds it, and marks it; the import then lets the Author's comparison find it again.
    expect(s.sync("c", shown(["u1", "go"], ["m1", "She waits a long while.", 1])).edited).toEqual([{ turn: turn.id, message: "m1", saved: hashOf("She waits."), now: hashOf("She waits a long while."), text: "She waits." }]);
    expect(s.forgetEdits("c")).toBe(1);
    const first = s.sync("c", shown(["u1", "go"], ["m1", "She waits a long while.", 1]));
    expect(first.edited.map((e) => [e.turn, e.text])).toEqual([[turn.id, "She waits."]]);
    expect(s.sync("c", shown(["u1", "go"], ["m1", "She waits a long while.", 1])).edited).toEqual([]);
    expect(s.turn(turn.id)?.text).toBe("She waits.");
  });

  test("a carried chat's record holds its seed, start, whether it was on and which engine played it", () => {
    const { s, revision } = testStore();
    const carriedChat = s.createChat({ id: "old", revision, seed: "run-seed-1", started: 1700000000000, wasOn: true, engine: "agents" });
    expect([carriedChat.seed, carriedChat.started, carriedChat.wasOn, carriedChat.engine]).toEqual(["run-seed-1", 1700000000000, true, "agents"]);
    expect(s.chat("old")).toEqual(carriedChat);
    const own = s.createChat({ id: "new", revision });
    expect(own.seed).not.toBe("");
    expect(own.started).toBe(own.created);
    expect([own.wasOn, own.engine]).toEqual([null, null]);
    expect(s.createChat({ id: "other", revision }).seed).not.toBe(own.seed);
    // A carried branch takes its own record as any chat does; one made on RPE gets its own seed and start.
    play(s, "old", "m1", "Wren comes in.", 1, engine(tick(1)));
    const branch = s.branchChat({ id: "br", from: "old", map: { m1: "bm1" }, seed: "branch-seed", started: 1700000005000, wasOn: false, engine: "classic" });
    expect([branch.seed, branch.started, branch.wasOn, branch.engine]).toEqual(["branch-seed", 1700000005000, false, "classic"]);
    const made = s.branchChat({ id: "br2", from: "old", map: { m1: "b2m1" } });
    expect([made.seed === "" || made.seed === "branch-seed", made.started, made.wasOn, made.engine]).toEqual([false, made.created, null, null]);
  });

  test("a carried reply that stood with no turn is in its stretch with its reason", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    play(s, "c", "m1", "Wren comes in.", 1, engine(tick(10)));
    s.setReason("c", "m2", "stopped");
    s.setReason("c", "m3", "failed");
    const report = s.sync("c", shown(["u1", "in"], ["m1", "Wren comes in.", 1], ["u2", "on"], ["m2", "Half a reply", 2], ["u3", "again"], ["m3", "", 3]));
    expect(report.unplayed).toEqual([{ from: "m2", to: "m3", count: 2, why: [{ message: "m2", why: "stopped" }, { message: "m3", why: "failed" }] }]);
    s.setReason("c", "m3", null);
    expect(s.sync("c", shown(["u1", "in"], ["m1", "Wren comes in.", 1], ["u2", "on"], ["m2", "Half a reply", 2], ["u3", "again"], ["m3", "", 3])).unplayed[0]?.why).toEqual([{ message: "m2", why: "stopped" }]);
  });

  test("two replies made after the last carried turn are one unplayed stretch at the first turn on RPE", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const carriedTurn = s.beginTurn({ chat: "c", kind: "normal", imported: true });
    s.tieTurn(carriedTurn.id, { message: "m1", hash: hashOf("Wren comes in."), date: 1 });
    s.sync("c", shown(["u1", "in"], ["m1", "Wren comes in.", 1]));
    // Replies made meanwhile, in the chat application, by the old engine or by hand.
    const report = s.sync("c", shown(["u1", "in"], ["m1", "Wren comes in.", 1], ["u2", "on"], ["m2", "She sits.", 2], ["u3", "then"], ["m3", "She stands.", 3]));
    expect(report.unplayed).toEqual([{ from: "m2", to: "m3", count: 2 }]);
  });
});
