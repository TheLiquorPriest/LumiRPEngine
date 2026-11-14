import { describe, expect, test } from "bun:test";
import { gridMoves } from "../../../src/iface/map/moves";
import type { JsonObject } from "../../../src/shared/json";
import type { MapDoc, WorldDoc } from "../../../src/shared/world";
import { initialStoreState, type FoldEnv } from "../../../src/store/fold";
import type { StoreState } from "../../../src/store/types";
import { testStore } from "../../store/fixtures";
import { INN, registry, worldWith } from "./fixtures";

const ZONED: MapDoc = { id: "market_zoned", scope: "market_square", layout: ["hh...", "hh...", "....."], legend: { h: { zone: "fountain" } }, cellMeters: 1.524 };

/** The inn with Bram standing behind the bar at (4,3). */
function innWorld(): WorldDoc {
  const w = worldWith(INN, ZONED);
  Object.assign(w.entities.bram?.fields ?? {}, { x: 3, y: 2 });
  return w;
}

function stateOf(world: WorldDoc): { env: FoldEnv; state: StoreState; revision: string } {
  const { revision, worlds } = testStore({ world });
  const env: FoldEnv = { registry: registry(), worlds: (r) => worlds.get(r) };
  const state = initialStoreState(env, revision);
  if (!state) throw new Error("no state");
  return { env, state, revision };
}

describe("placing on squares for the everyday operations", () => {
  test("a square given is recorded as today's position event, and applies", () => {
    const world = innWorld();
    const { env, state } = stateOf(world);
    const placed = gridMoves().place({ state, env, who: "wren", place: "common_room", square: [6, 5] });
    expect(placed).toEqual({ events: [{ type: "space.pos", data: { entity: "wren", at: { scope: "common_room", x: 5, y: 4 }, from: null } }] });
    const { s, revision } = testStore({ world });
    s.createChat({ id: "c", revision });
    const turn = s.beginTurn({ chat: "c", kind: "normal" });
    const events = "events" in placed ? placed.events : [];
    const { changes, state: after } = s.addChanges(turn.id, events.map((e: JsonObject) => ({ lane: "engine" as const, op: "space.pos", value: e })));
    expect(changes[0]?.applied).toBe(true);
    expect(after.world.entities.wren?.fields).toMatchObject({ x: 5, y: 4 });
  });

  test("beside someone is the free square nearest them; in a zone, a free square of it", () => {
    const { env, state } = stateOf(innWorld());
    expect(gridMoves().place({ state, env, who: "wren", place: "common_room", near: "bram" })).toEqual({ events: [{ type: "space.pos", data: { entity: "wren", at: { scope: "common_room", x: 2, y: 1 }, from: null } }] });
    const zoned = gridMoves().place({ state, env, who: "tam", place: "market_square", zone: "fountain" });
    const inFountain: unknown[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y]) => ({ events: [{ type: "space.pos", data: { entity: "tam", at: { scope: "market_square", x, y }, from: null } }] }));
    expect(inFountain).toContainEqual(zoned);
  });

  test("a place with no grid, a zone it has not, or a square off it, is said so", () => {
    const { env, state } = stateOf(innWorld());
    expect(gridMoves().place({ state, env, who: "odile", place: "cellar", square: [1, 1] })).toEqual({ problem: "not_applicable", fields: { code: "no_map" } });
    expect(gridMoves().place({ state, env, who: "wren", place: "common_room", zone: "cellar_stairs" })).toEqual({ problem: "not_applicable", fields: { code: "no_zone" } });
    expect(gridMoves().place({ state, env, who: "wren", place: "common_room", square: [13, 1] })).toEqual({ problem: "not_applicable", fields: { code: "off_grid" } });
  });
});
