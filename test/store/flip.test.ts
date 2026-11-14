// A swipe flipped on an earlier message (plan §6.3, scenario 67): the later turns were made on top of
// the swipe that showed then; their changes are applied again on the swipe now showing, what no
// longer applies there is listed, and flipping back restores the earlier state exactly.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { carried, engine, goTo, hand, make, play, POV, shown, testStore, tick } from "./fixtures";

/** Six turns: the second reply has two swipes; the later ones were played on its first. */
function sixTurns() {
  const ts = testStore();
  const { s, revision } = ts;
  s.createChat({ id: "c", revision });
  const t1 = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
  const lantern = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV), tick(5)));
  const t3 = play(s, "c", "m3", "She takes it down to the cellar.", 3, engine(goTo(POV, "cellar"), ...hand("lantern", POV, "cask")));
  const t4 = play(s, "c", "m4", "Odile and she talk an hour.", 4, engine(tick(60)));
  const t5 = play(s, "c", "m5", "She leaves the knife with Odile.", 5, engine(...hand("knife", "satchel", "odile")));
  const t6 = play(s, "c", "m6", "Back up the stairs.", 6, engine(goTo(POV, "common_room"), tick(2)));
  // The other swipe of the second reply, made later: no lantern, a longer wait.
  const candle = s.beginTurn({ chat: "c", kind: "swipe", on: t1.node });
  s.addChanges(candle.id, engine(make("candle", "Candle", POV), tick(15)));
  s.tieTurn(candle.id, { message: "m2", hash: "h-candle", date: 22 });
  return { ...ts, t1, lantern, t3, t4, t5, t6, candle };
}

const chat = (second: [string, string, number]) =>
  shown(["u1", "in"], ["m1", "Wren comes in from the rain.", 1], ["u2", "light"], second, ["u3", "down"], ["m3", "She takes it down to the cellar.", 3], ["u4", "talk"], ["m4", "Odile and she talk an hour.", 4], ["u5", "give"], ["m5", "She leaves the knife with Odile.", 5], ["u6", "up"], ["m6", "Back up the stairs.", 6]);
const withLantern = chat(["m2", "Bram lends her a lantern.", 2]);

describe("a swipe flipped on an earlier message", () => {
  test("the later turns' changes are applied again on the swipe now showing, and what no longer applies is listed", () => {
    const { s, t3, t4, t5, t6, lantern, candle } = sixTurns();
    s.sync("c", withLantern);
    const before = s.headState("c").state.world;
    expect(carried(before, "cask")).toEqual(["lantern"]);
    // The candle swipe's text is shown by its own hash.
    const flipped = s.sync("c", chat(["m2", "", 22]).map((m) => (m.id === "m2" ? { ...m, hash: "h-candle" } : m)));
    expect(flipped.flipped).toEqual([{ message: "m2", from: lantern.id, to: candle.id }]);
    expect(flipped.swiped).toBeNull();
    expect(flipped.rebased).toEqual({ from: "m3", to: "m6", turns: [t3.id, t4.id, t5.id, t6.id] });
    // The lantern was never made on this swipe: handing it over no longer applies, and says why.
    expect(flipped.notApplied.map((n) => [n.turn, n.op, n.reason])).toEqual([
      [t3.id, "unlink", "no in from lantern to wren"],
      [t3.id, "link", "no in from lantern to wren"],
    ]);
    const after = s.headState("c").state.world;
    // Everything else the later turns did still happened, in order, on top of the candle.
    expect(after.clock - before.clock).toBe(15 - 5);
    expect(after.entities[POV]?.fields.place).toBe("common_room");
    expect(carried(after, "odile")).toEqual(["knife"]);
    expect(carried(after, POV)).toContain("candle");
    expect(after.entities.lantern).toBeUndefined();
  });

  test("flipping back restores the earlier state exactly", () => {
    const { s } = sixTurns();
    s.sync("c", withLantern);
    const before = hashJson(s.headState("c").state);
    s.sync("c", chat(["m2", "", 22]).map((m) => (m.id === "m2" ? { ...m, hash: "h-candle" } : m)));
    expect(hashJson(s.headState("c").state)).not.toBe(before);
    const back = s.sync("c", withLantern);
    expect(back.rebased).toBeNull();
    expect(back.notApplied).toEqual([]);
    expect(hashJson(s.headState("c").state)).toBe(before);
  });

  test("a turn played while the flipped swipe showed stands rebased once the flip is undone, and keeps its own state where it was made", () => {
    const { s } = sixTurns();
    const candleChat = chat(["m2", "", 22]).map((m) => (m.id === "m2" ? { ...m, hash: "h-candle" } : m));
    s.sync("c", candleChat);
    // A seventh reply, played on the candle's path: she lights the candle in the cellar's niche.
    const t7 = play(s, "c", "m7", "She sets the candle in a niche.", 7, engine(...hand("candle", POV, "cask")));
    expect(carried(s.headState("c").state.world, "cask")).toEqual(["candle"]);
    const back = s.sync("c", [...withLantern, ...shown(["u7", "set it down"], ["m7", "She sets the candle in a niche.", 7])]);
    expect(back.rebased?.turns).toEqual([t7.id]);
    expect(back.notApplied.map((n) => [n.turn, n.op])).toEqual([
      [t7.id, "unlink"],
      [t7.id, "link"],
    ]);
    expect(carried(s.headState("c").state.world, "cask")).toEqual(["lantern"]);
    // Along the path it was made on, the seventh turn's state is as it was.
    expect(carried(s.stateAt(t7.id).state.world, "cask")).toEqual(["candle"]);
  });
});
