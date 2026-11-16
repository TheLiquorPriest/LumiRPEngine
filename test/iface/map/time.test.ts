import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { moveTime, roundsTime, scaleOf } from "../../../src/packs/space/core/grid-model";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { asHarnessPasses } from "../../story/rig";
import { rig, wordsFromFiles } from "../rig";
import { drawn, INN, TOWN, worldWith } from "./fixtures";

const SRC = { from: "prose", message: "m-4" };

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
  test("moves the clock by seconds, not minutes, through pass_time", async () => {
    const t = await rig({}, worldWith(INN));
    const clock = (): number => t.s.stateAt(t.turn.id).state.world.clock;
    const play = async (operation: JsonObject): Promise<ToolResult> => {
      const r = await t.call("world_apply", asHarnessPasses(t.tools.get("world_apply") as HostTool, { operations: [operation] }));
      wordsFromFiles(r);
      return r;
    };
    const start = clock();
    // Five rounds of the common room's grid, six seconds each.
    const rounds = await play({ op: "pass_time", rounds: 5, at: "The Common Room", source: SRC });
    expect(rounds.error).toBeUndefined();
    expect((clock() - start) * 60).toBe(30);
    // The map of a town counts walking minutes, not rounds: rounds cannot be read there, and the clock stays where it was.
    const none = await play({ op: "pass_time", rounds: 5, at: "The Far Road", source: SRC });
    expect(none.error).toBe(true);
    expect((clock() - start) * 60).toBe(30);
  });
});
