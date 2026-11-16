// A clock he paused for the scene is moved as an agent gives it, and the move is said; the pause stays as he set it.

import { describe, expect, test } from "bun:test";
import { rig, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-9" };

async function paused() {
  const t = await rig({}, "blank");
  await t.writes.run(() => t.s.addChanges(t.turn.id, [{ lane: "engine", op: "store.marker", value: { kind: "time", control: "pause", scope: { all: true }, to: true }, by: "player", source: "player" }]));
  expect(t.s.stateAt(t.turn.id).state.world.time.paused).toBe(true);
  return t;
}

describe("a clock moved while it is paused", () => {
  test("pass_time of two hours moves it two hours, reports clock_paused, and the pause still holds; with no pause, no report", async () => {
    const t = await paused();
    const before = t.s.stateAt(t.turn.id).state.world.clock;
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", for: "two hours", source: SRC }] });
    expect(r.error).toBeUndefined();
    expect(t.s.stateAt(t.turn.id).state.world.clock).toBe(before + 120);
    expect(r.reports).toEqual(["Operation 1 (pass_time): the clock was paused for this scene, and it was moved as given; the pause still holds."]);
    expect(t.s.stateAt(t.turn.id).state.world.time.paused).toBe(true);
    wordsFromFiles(r);
    const free = await rig({}, "blank");
    const moved = await free.call("world_apply", { operations: [{ op: "pass_time", for: "two hours", source: SRC }] });
    expect(moved.reports).toBeUndefined();
  });

  test("set of the world's clock while paused likewise", async () => {
    const t = await paused();
    const before = t.s.stateAt(t.turn.id).state.world.clock;
    const r = await t.call("world_apply", { operations: [{ op: "set", at: "world", key: "time", add: 30, source: SRC }] });
    expect(r.error).toBeUndefined();
    expect(t.s.stateAt(t.turn.id).state.world.clock).toBe(before + 30);
    expect(r.reports).toEqual([expect.stringContaining("the clock was paused for this scene")]);
  });
});
