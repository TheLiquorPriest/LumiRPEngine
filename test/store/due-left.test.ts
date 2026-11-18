// What fell due and nobody decided: the next world state lists only what no change of the turn answers, says how many of how many
// that is, and what it cuts for room it counts as the list's own, so the count and the list are the same things.

import { describe, expect, test } from "bun:test";
import { timeDue } from "../../src/store/due";
import { worldState } from "../../src/store/world-state";
import { inventedWorld, play, SHIPPED_LAYOUT, testStore } from "./fixtures";

const DAY = 24 * 60;

/** Tam keeps the market from nine to five and the common room after; the vale's weather turns at six and at noon. */
function scheduled() {
  const world = inventedWorld();
  world.schedules = {
    tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }, { start: "17:00", end: "22:00", value: "common_room" }] },
    vale_weather: { id: "vale_weather", target: "weather", recurrence: { every: "day" }, slots: [{ start: "06:00", end: "12:00", value: "rain" }, { start: "12:00", end: "18:00", value: "sun" }] },
  };
  const ts = testStore({ world });
  ts.s.createChat({ id: "c", revision: ts.revision });
  return ts;
}

/** A turn that moves the clock two days on and puts Tam at the market, and the turn after it. */
function twoDaysOn() {
  const ts = scheduled();
  const first = play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
  ts.s.addChanges(first.id, [
    { lane: "engine", op: "clock", value: { type: "clock", minutes: 2 * DAY, cause: "advance" }, by: "player", source: "player" },
    { lane: "engine", op: "set", value: { type: "set", entity: "tam", field: "place", value: "market_square" }, by: "player", source: "player" },
  ]);
  const next = ts.s.beginTurn({ chat: "c", kind: "normal" });
  return { ...ts, next };
}

describe("what fell due and nobody decided", () => {
  test("what a change of the turn answers is not listed, and the section says how many of how many are left", () => {
    const { s, store, next } = twoDaysOn();
    const block = worldState(s, { chat: "c", turn: next.id, layout: SHIPPED_LAYOUT, due: timeDue(store), charsPerToken: 4 });
    const passed = block.sections.passed ?? [];
    // Four of Tam's starts (two a day, in two days) are answered by his move; the weather's four and three needs are not.
    expect(passed[0]).toEqual({ kind: "fell_left", depth: 0, fields: { left: 7, total: 11, one: false } });
    const listed = passed.slice(1);
    expect(listed).toHaveLength(7);
    expect(listed.every((l) => l.kind === "fell_due")).toBe(true);
    expect(listed.some((l) => l.fields.kind === "place")).toBe(false);
    expect(block.text).toContain("7 of the 11 that fell due have no change recorded for them:");
  });

  test("what is cut for room is counted as left with the lines shown, so the lines and the count make the whole of what is left", () => {
    const { s, store, next } = twoDaysOn();
    const layout = `${SHIPPED_LAYOUT.slice(0, SHIPPED_LAYOUT.indexOf("\n---\n") + 5)}{{#passed}}\n{{passed}}\n{{/passed}}\n`;
    for (const budget of [60, 120, 200, 400, 4000]) {
      const block = worldState(s, { chat: "c", turn: next.id, layout, due: timeDue(store), settings: { budget }, charsPerToken: 4 });
      const passed = block.sections.passed ?? [];
      const shown = passed.filter((l) => l.kind === "fell_due").length;
      const cut = passed.filter((l) => l.kind === "left_out").reduce((n, l) => n + Number(l.fields.n), 0);
      expect(shown + cut).toBe(7);
    }
  });

  test("when every one is answered the section has nothing to list", () => {
    const ts = scheduled();
    const first = play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
    ts.s.addChanges(first.id, [
      { lane: "engine", op: "clock", value: { type: "clock", minutes: 60, cause: "advance" }, by: "player", source: "player" },
      { lane: "engine", op: "set", value: { type: "set", entity: "tam", field: "place", value: "market_square" }, by: "player", source: "player" },
    ]);
    const next = ts.s.beginTurn({ chat: "c", kind: "normal" });
    const from = ts.s.stateAt(next.id).state.world.clock - 60;
    // The one thing that fell due in the hour is Tam's start at the market, which his move answers.
    const fell = timeDue(ts.store).due(ts.s.stateAt(next.id).state, { from, to: from + 60 }, null, Number.POSITIVE_INFINITY).items;
    expect(fell.every((d) => d.kind === "place")).toBe(true);
    const block = worldState(ts.s, { chat: "c", turn: next.id, layout: SHIPPED_LAYOUT, due: timeDue(ts.store), charsPerToken: 4 });
    expect(block.sections.passed ?? []).toEqual([]);
  });
});
