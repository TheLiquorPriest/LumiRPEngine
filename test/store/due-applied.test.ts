// What the clock's passing applies is not listed as due: a schedule that sets an owner's own value (a business's hours)
// happens as the clock passes it (`standingRun`), so it is neither listed nor counted; a person's routine is still a thing
// for the Author to decide, and is listed.

import { describe, expect, test } from "bun:test";
import { timeDue } from "../../src/store/due";
import type { ScheduleDef } from "../../src/shared/world";
import { inventedWorld, play, testStore } from "./fixtures";

const HOUR = 60;

/** Tam's day is a routine of twelve blocks of an hour, and Bram's mood is his own schedule's: nine to five, cheerful. */
function routine() {
  const world = inventedWorld();
  const slots = Array.from({ length: 12 }, (_, i) => ({ start: `${String(6 + i).padStart(2, "0")}:00`, end: `${String(7 + i).padStart(2, "0")}:00`, value: i % 2 === 0 ? "market_square" : "common_room" }));
  const tamDay: ScheduleDef = { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots };
  const mood: ScheduleDef = { id: "bram_mood", owner: "bram", target: "mood", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "cheerful" }] };
  world.schedules = { tam_day: tamDay, bram_mood: mood };
  const ts = testStore({ world });
  ts.s.createChat({ id: "c", revision: ts.revision });
  play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
  return ts;
}

describe("what the clock's passing applies", () => {
  test("a schedule that sets an owner's own value is neither listed nor counted, and a person's routine is both", () => {
    const ts = routine();
    const due = timeDue(ts.store);
    const state = ts.s.headState("c").state;
    const from = state.world.clock;
    const span = { from, to: from + 24 * HOUR };
    const listed = due.due(state, span, null, Number.POSITIVE_INFINITY).items;
    expect(listed.some((i) => i.kind === "mood")).toBe(false);
    expect(listed.some((i) => i.kind === "place")).toBe(true);
    const under = due.under?.(state, span)("world");
    expect(under?.n).toBe(listed.length);
  });
});
