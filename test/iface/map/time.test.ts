import { describe, expect, test } from "bun:test";
import { initialState } from "../../../src/engine/world-state";
import { moveTime, NOTHING_MOVES, place, roundsTime, scaleOf } from "../../../src/packs/space/core/grid-model";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { move } from "../../../src/packs/space/core/grid-path";
import { positionChanges } from "../../../src/iface/map/record";
import { clockChange } from "../../../src/iface/map/time";
import type { ChangeInput } from "../../../src/store/types";
import { testStore } from "../../store/fixtures";
import { drawn, INN, registry, TOWN, worldWith } from "./fixtures";

describe("each grid's time step", () => {
  test("a grid laid in play counts rounds of 6 seconds, six squares a round; the town counts minutes", () => {
    expect(drawn(INN).scale.step).toEqual({ per: "round", seconds: 6, squares: 6 });
    expect(drawn(TOWN).scale.step).toEqual({ per: "minute" });
    expect(scaleOf(3).step).toEqual({ per: "round", seconds: 6, squares: 3 });
    expect(scaleOf(1.524, { ...MAP_DEFAULTS, roundSeconds: 10 }).step).toEqual({ per: "round", seconds: 10, squares: 6 });
  });

  test("a move takes whole rounds on a room grid, and today's walking minutes on a coarse one", () => {
    const room = drawn(INN).scale;
    expect(moveTime(room, 5)).toEqual({ seconds: 6, rounds: 1 });
    expect(moveTime(room, 8)).toEqual({ seconds: 12, rounds: 2 });
    expect(moveTime(room, 8, 4)).toEqual({ seconds: 12, rounds: 2 });
    expect(moveTime(room, 9, 4)).toEqual({ seconds: 18, rounds: 3 });
    expect(moveTime(room, 0)).toEqual({ seconds: 0, rounds: 0 });
    const town = drawn(TOWN).scale;
    expect(moveTime(town, 1)).toEqual({ seconds: 60 });
    expect(moveTime(town, 3)).toEqual({ seconds: 180 });
    expect(roundsTime(town, 2)).toBeNull();
  });
});

describe("a fight on the room grid", () => {
  test("moves the clock by seconds, not minutes", () => {
    const world = worldWith(INN);
    const d = drawn(INN);
    const { s, revision } = testStore({ world });
    s.createChat({ id: "c", revision });
    const turn = s.beginTurn({ chat: "c", kind: "normal" });
    const record = (changes: ChangeInput[]) => s.addChanges(turn.id, changes.map((c) => ({ ...c, by: "gm", source: "gm" as const })));
    const start = initialState(world, revision, registry()).clock;

    const opening = place(d, place(d, NOTHING_MOVES, "wren", [2, 5]).moving, "bram", [11, 2]).moving;
    record(positionChanges(d, NOTHING_MOVES, opening));
    // Round one: Wren closes five squares; Bram holds. The round is six seconds.
    const first = move(d, opening, "wren", [7, 5]);
    expect([first.walk?.distance, first.took]).toEqual([5, { seconds: 6, rounds: 1 }]);
    record([...positionChanges(d, opening, first.moving), clockChange(roundsTime(d.scale, 1)?.seconds ?? 0)]);
    // Bram runs nine squares round the table to the hearth side: two rounds.
    const second = move(d, first.moving, "bram", [4, 7]);
    expect(second.took).toEqual({ seconds: 12, rounds: 2 });
    const { changes, state } = record([...positionChanges(d, first.moving, second.moving), clockChange(second.took?.seconds ?? 0)]);
    expect(changes.every((c) => c.applied)).toBe(true);
    expect((state.world.clock - start) * 60).toBeCloseTo(18, 9);
    expect(state.world.entities.bram?.fields).toMatchObject({ x: 3, y: 6 });
  });
});
