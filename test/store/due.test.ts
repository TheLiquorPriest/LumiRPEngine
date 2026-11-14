// What time brings due (plan §6.4, §6.1): for a span and a part of the tree, the slots today's
// engine's schedules start in it, a person's routine and the world's own weather alike. A list only:
// listing it changes nothing, and a slot left to chance is named by its schedule, never drawn.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { timeDue } from "../../src/store/due";
import { worldState } from "../../src/store/world-state";
import { inventedWorld, play, SHIPPED_LAYOUT, testStore } from "./fixtures";

/** Tam keeps the market from nine to five and the common room after; the vale's weather turns at six and at noon. */
function scheduled() {
  const world = inventedWorld();
  world.schedules = {
    tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }, { start: "17:00", end: "22:00", value: "common_room" }] },
    vale_weather: {
      id: "vale_weather",
      target: "weather",
      recurrence: { every: "day" },
      slots: [
        { start: "06:00", end: "12:00", weighted: [{ value: "rain", weight: 1 }, { value: "sun", weight: 1 }] },
        { start: "12:00", end: "18:00", weighted: [{ value: "rain", weight: 1 }, { value: "sun", weight: 1 }] },
      ],
    },
  };
  const ts = testStore({ world });
  ts.s.createChat({ id: "c", revision: ts.revision });
  play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
  return ts;
}

describe("what time brings due", () => {
  test("passing six hours lists the slots that start in it, for the part of the tree asked about, and changes nothing", () => {
    const { s, store } = scheduled();
    const due = timeDue(store);
    const folded = s.headState("c");
    const before = hashJson(folded.state);
    const from = folded.state.world.clock;
    const span = { from, to: from + 360 };
    expect(due.due(folded.state, span, null)).toEqual([
      { at: from + 60, kind: "place", where: "place:market_square", who: ["tam"], what: "tam_day" },
      { at: from + 240, kind: "weather", what: "vale_weather" },
    ]);
    // In the common room, Tam's day at the market is no business of the scene's; the weather is everyone's.
    expect(due.due(folded.state, span, "common_room").map((d) => d.what)).toEqual(["vale_weather"]);
    expect(due.due(folded.state, span, "thornbury").map((d) => d.what)).toEqual(["tam_day", "vale_weather"]);
    // Nothing was applied: the state, the turn's changes and the head are as they were.
    expect(hashJson(s.headState("c").state)).toBe(before);
    expect(hashJson(folded.state)).toBe(before);
  });

  test("the world state's due section lists them, worded by the layout", () => {
    const { s, store } = scheduled();
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const lines = worldState(s, { chat: "c", turn: t.id, layout: SHIPPED_LAYOUT, due: timeDue(store) }).text.split("\n");
    expect(lines).toContain("Sat 1 Mar 2031, 9:00 AM: place at Market Square, Tam (tam_day)");
    expect(lines).toContain("Sat 1 Mar 2031, 12:00 PM: weather (vale_weather)");
  });
});
