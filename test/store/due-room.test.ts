// What a cut list keeps: a day of routine never hides a need crossing its line (a long skip's hunger and fatigue are told to
// the Author, not crowded out by the first day's starts), and what is listed and what is counted as left are the whole span,
// however it is cut.

import { describe, expect, test } from "bun:test";
import { timeDue } from "../../src/store/due";
import type { ScheduleDef } from "../../src/shared/world";
import { inventedWorld, play, testStore } from "./fixtures";

const HOUR = 60;

/** Tam's day is a routine of twelve blocks of an hour. */
function routine() {
  const world = inventedWorld();
  const slots = Array.from({ length: 12 }, (_, i) => ({ start: `${String(6 + i).padStart(2, "0")}:00`, end: `${String(7 + i).padStart(2, "0")}:00`, value: i % 2 === 0 ? "market_square" : "common_room" }));
  const tamDay: ScheduleDef = { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots };
  world.schedules = { tam_day: tamDay };
  const ts = testStore({ world });
  ts.s.createChat({ id: "c", revision: ts.revision });
  play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
  return ts;
}

describe("a list cut short", () => {
  test("a need that crosses its line late in the span is listed though the routine's starts before it fill the room, and the list and what is left make the whole span", () => {
    const ts = routine();
    const due = timeDue(ts.store);
    const state = ts.s.headState("c").state;
    const from = state.world.clock;
    const span = { from, to: from + 16 * HOUR };
    const all = due.due(state, span, null, Number.POSITIVE_INFINITY);
    const need = all.items.find((i) => i.kind === "need");
    expect(need).toBeDefined();
    // The need comes after more routine starts than the list has room for.
    expect(all.items.filter((i) => i.kind === "place" && i.at < (need?.at ?? 0)).length).toBeGreaterThan(6);
    for (const most of [2, 4, 6, 8, 12]) {
      const cut = due.due(state, span, null, most);
      expect(cut.items.length).toBeLessThanOrEqual(most);
      expect(cut.items.some((i) => i.kind === "need")).toBe(true);
      expect(cut.more === null ? null : cut.items.length + cut.more).toBe(all.items.length);
    }
    // What is listed is in time order, the need among it.
    const six = due.due(state, span, null, 6).items;
    expect(six.map((i) => i.at)).toEqual([...six.map((i) => i.at)].sort((a, b) => a - b));
  });
});
