import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../../src/engine/places-in-play";
import { initialState } from "../../../src/engine/world-state";
import { drawnOf, movingOf, squareAt, standsAt, type Drawn } from "../../../src/packs/space/core/grid-model";
import { layForPlace, layOverSquare, plainRows } from "../../../src/iface/map/lay";
import { between } from "../../../src/packs/space/core/grid-measure";
import { positionChange } from "../../../src/iface/map/record";
import type { WorldDoc } from "../../../src/shared/world";
import type { ChangeInput, ChangeRow } from "../../../src/store/types";
import { testStore } from "../../store/fixtures";
import { registry, TOWN, worldWith } from "./fixtures";

/** The town drawn a block to a square, with Wren and Bram both in the Crooked Kettle, on its square of the town. */
function townWorld(): WorldDoc {
  const w = worldWith(TOWN);
  for (const id of ["wren", "bram"]) Object.assign(w.entities[id]?.fields ?? {}, { place: "crooked_kettle", x: 2, y: 1 });
  return w;
}

function grid(world: WorldDoc, place: string): Drawn {
  const d = drawnOf(world, place);
  if (!d) throw new Error(`${place} has no grid`);
  return d;
}

/** A store over `world` with one chat and an open turn, and a way to record changes in it as the GM. */
function chatOn(world: WorldDoc) {
  const { s, revision } = testStore({ world });
  s.createChat({ id: "c", revision });
  const turn = s.beginTurn({ chat: "c", kind: "normal" });
  const record = (changes: ChangeInput[]) => s.addChanges(turn.id, changes.map((c) => ({ ...c, by: "gm", source: "gm" as const })));
  return { record, start: initialState(world, revision, registry()) };
}

const outcome = (rows: ChangeRow[]) => rows.map((c) => [c.op, c.applied, c.reports]);

describe("a room grid over one square of a coarse map", () => {
  test("places people where the coarse map alone could not", () => {
    const world = townWorld();
    const reg = registry();
    // The coarse map alone: the inn is one square of the town, 80 m across, and both stand on it.
    expect(drawnOf(world, "crooked_kettle")).toBeNull();
    const town = grid(world, "thornbury");
    const coarse = movingOf(reg, world, initialState(world, "r", reg), town).moving;
    expect([standsAt(coarse, "wren"), standsAt(coarse, "bram")]).toEqual([
      [3, 2],
      [3, 2],
    ]);
    expect([between(town, coarse, "wren", "bram"), town.scale.metres]).toEqual([0, 80]);
    const apart = [positionChange({ scope: "crooked_kettle" }, "wren", [3, 3], null), positionChange({ scope: "crooked_kettle" }, "bram", [6, 4], null)];
    expect(chatOn(world).record(apart).changes.map((c) => [c.applied, c.reports[0]?.code])).toEqual([
      [false, "off_grid"],
      [false, "off_grid"],
    ]);

    // Laid over the inn's square: the map is the inn's own, and both are taken off the town's square.
    const { record, start } = chatOn(world);
    const laid = layOverSquare(world, start, "thornbury", [3, 2], { id: "kettle_taproom", title: "The taproom", rows: plainRows(8, 6, [[1, 3]]) });
    expect(laid.scope).toBe("crooked_kettle");
    expect(laid.reports).toEqual([]);
    // The town's map draws the inn, so its square opens onto the room grid.
    expect(laid.changes.map((c) => c.op)).toEqual(["engine.world", "space.pos", "space.pos", "engine.world"]);
    expect(laid.opens).toBe("thornbury_streets");
    const { changes, state } = record([...laid.changes, ...apart]);
    expect(outcome(changes)).toEqual(["engine.world", "space.pos", "space.pos", "engine.world", "space.pos", "space.pos"].map((op) => [op, true, []]));
    expect(playedWorld(world, state.world).maps.thornbury_streets?.places?.find((p) => p.id === "crooked_kettle")?.opens).toBe("kettle_taproom");
    const played = playedWorld(world, state.world);
    const inn = grid(played, "crooked_kettle");
    expect([inn.width, inn.height, inn.scale.feet, squareAt(inn, [...inn.doors][0] ?? -1)]).toEqual([8, 6, 5, [1, 3]]);
    const moving = movingOf(reg, played, state.world, inn).moving;
    expect([standsAt(moving, "wren"), standsAt(moving, "bram")]).toEqual([
      [3, 3],
      [6, 4],
    ]);
    expect((between(inn, moving, "wren", "bram") ?? 0) * inn.scale.feet).toBe(15);
    // The town keeps the inn on its square, for travel between places.
    expect(played.places.crooked_kettle?.cell).toEqual({ x: 2, y: 1 });
    expect(drawnOf(played, "thornbury")?.id).toBe("thornbury_streets");
  });

  test("where no place is drawn on the square, one is made there for the grid", () => {
    const world = townWorld();
    const { record, start } = chatOn(world);
    expect(layOverSquare(world, start, "thornbury", [4, 3], { id: "forge_floor", rows: plainRows(5, 4) }).reports).toEqual([{ code: "needs_place", values: { square: [4, 3] } }]);
    const laid = layOverSquare(world, start, "thornbury", [4, 3], { id: "forge_floor", rows: plainRows(5, 4) }, undefined, { id: "smithy", name: "The Smithy", made: true });
    expect(laid.scope).toBe("smithy");
    const { changes, state } = record(laid.changes);
    expect(outcome(changes)).toEqual([
      ["engine.world", true, []],
      ["engine.world", true, []],
    ]);
    const played = playedWorld(world, state.world);
    expect(played.places.smithy).toMatchObject({ parent: "thornbury", cell: { x: 3, y: 2 } });
    expect(grid(played, "smithy").scale.feet).toBe(5);
  });

  test("a square off the coarse map, or a place with no grid to lay over, lays nothing and says so; a place that has its own grid is laid over and told", () => {
    const world = townWorld();
    const start = initialState(world, "r", registry());
    expect(layOverSquare(world, start, "thornbury", [9, 9], { id: "x", rows: plainRows(3, 3) }).reports[0]?.code).toBe("off_grid");
    expect(layOverSquare(world, start, "market_square", [1, 1], { id: "x", rows: plainRows(3, 3) }).reports).toEqual([{ code: "no_grid", values: { place: "market_square" } }]);
    const over = layForPlace(world, start, "thornbury", { id: "x", rows: plainRows(3, 3) });
    expect(over.reports).toEqual([{ code: "has_grid", values: { place: "thornbury", grid: "thornbury_streets" } }]);
    expect(over.changes.length).toBeGreaterThan(0);
  });
});

describe("a grid laid for a place with no map", () => {
  test("is recorded as the chat's own, and people stand on it", () => {
    const world = worldWith();
    const { record, start } = chatOn(world);
    const laid = layForPlace(world, start, "market_square", { id: "market_stalls", rows: plainRows(6, 5, [[3, 1]]) });
    expect(laid.changes.map((c) => c.op)).toEqual(["engine.world"]);
    const { changes, state } = record([...laid.changes, positionChange({ scope: "market_square" }, "tam", [3, 3], null)]);
    expect(outcome(changes)).toEqual([
      ["engine.world", true, []],
      ["space.pos", true, []],
    ]);
    const played = playedWorld(world, state.world);
    const market = grid(played, "market_square");
    expect([[...market.doors].map((i) => squareAt(market, i)), market.scale.step]).toEqual([[[3, 1]], { per: "round", seconds: 6, squares: 6 }]);
    expect(standsAt(movingOf(registry(), played, state.world, market).moving, "tam")).toEqual([3, 3]);
    expect(layForPlace(played, state.world, "market_square", { id: "market_again", rows: plainRows(3, 3) }).reports[0]?.code).toBe("has_grid");
    expect(layForPlace(world, start, "nowhere", { id: "x", rows: plainRows(3, 3) }).reports).toEqual([{ code: "no_place", values: { place: "nowhere" } }]);
  });
});
