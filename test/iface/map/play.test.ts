// What today's maps could not carry, now the space pack's own (plan §8.2): a door's state, a
// footprint and what it blocks, a square that blocks the way and not the view, a grid's time step,
// and squares drawn anew kept as that change. Each is recorded in the store as a turn's change, read
// by the grid's functions, and taken back by a swipe like any other change.

import { describe, expect, test } from "bun:test";
import { playedWorld } from "../../../src/engine/places-in-play";
import { drawnOf, footprint, movingOf, blockersOf, indexOf, type Drawn, type Moving } from "../../../src/iface/map/grid";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import { sees } from "../../../src/iface/map/measure";
import { walk } from "../../../src/iface/map/path";
import { doorEvent, positionEvent, shapeEvent, squaresEvent } from "../../../src/iface/map/record";
import { moveTime } from "../../../src/iface/map/time";
import type { JsonObject } from "../../../src/shared/json";
import { readMap } from "../../../src/shared/maps";
import type { MapDoc, WorldDoc } from "../../../src/shared/world";
import type { StoreState } from "../../../src/store/types";
import { hashOf, testStore } from "../../store/fixtures";
import { CELLAR, OPEN, registry, worldWith } from "./fixtures";

/** A chat on `world` and a way to play a reply whose turn records `events`, or a swipe of one. */
function chatOn(world: WorldDoc) {
  const { s, revision } = testStore({ world });
  s.createChat({ id: "c", revision });
  const play = (message: string, events: JsonObject[], swipe = false) => {
    const t = s.beginTurn({ chat: "c", kind: swipe ? "swipe" : "normal", target: swipe ? message : null });
    const { changes } = events.length > 0 ? s.addChanges(t.id, events.map((e) => ({ lane: "engine" as const, op: String(e.type), value: e, by: "gm", source: "gm" as const }))) : { changes: [] };
    s.tieTurn(t.id, { message, hash: hashOf(`${message} ${swipe}`), date: swipe ? 2 : 1 });
    return { turn: t, changes, state: s.stateAt(t.id).state };
  };
  return { s, play };
}

/** The grid of `place` and who stands on it, as the chat's state has them. */
function layers(world: WorldDoc, state: StoreState, place: string): { drawn: Drawn; moving: Moving } {
  const played = playedWorld(world, state.world);
  const drawn = drawnOf(played, place, MAP_DEFAULTS, state.world);
  if (!drawn) throw new Error(`${place} has no grid`);
  return { drawn, moving: movingOf(registry(), played, state.world, drawn).moving };
}

describe("a door's state", () => {
  test("a locked door shuts the way and the view, and a swipe of the turn that locked it leaves it as drawn", () => {
    const world = worldWith(CELLAR);
    const { play } = chatOn(world);
    const cellar = { scope: "cellar" };
    const locked = play("m1", [positionEvent(cellar, "odile", [2, 3], null), doorEvent(cellar, [5, 3], "locked")]);
    expect(locked.changes.map((c) => [c.op, c.applied])).toEqual([
      ["space.pos", true],
      ["space.door", true],
    ]);
    const now = layers(world, locked.state, "cellar");
    expect(now.moving.doors).toEqual({ "5,3": "locked" });
    expect(walk(now.drawn, now.moving, [2, 3], [8, 3])).toBeNull();
    expect(sees(now.drawn, now.moving, "odile", [8, 3])).toBe(false);

    const swiped = play("m1", [], true);
    const before = layers(world, swiped.state, "cellar");
    expect(before.moving.doors).toEqual({});
    expect(walk(before.drawn, before.moving, [2, 3], [8, 3])?.distance).toBe(6);
    expect(sees(before.drawn, before.moving, [2, 3], [8, 3])).toBe(true);
  });

  test("a door state for a place that is not there, or that is none of the three, does not apply", () => {
    const world = worldWith(CELLAR);
    const { play } = chatOn(world);
    const r = play("m1", [doorEvent({ scope: "nowhere" }, [5, 3], "open"), { type: "space.door", data: { scope: "cellar", x: 4, y: 2, state: "ajar" } }]);
    expect(r.changes.map((c) => [c.applied, c.reports.map((x) => x.code)])).toEqual([
      [false, ["missing_place"]],
      [false, ["bad_state"]],
    ]);
  });
});

describe("a footprint and what it blocks", () => {
  test("a cart two squares by one blocks the way and not the view, and moves with its square", () => {
    const world = worldWith(OPEN);
    world.entities.cart = { id: "cart", kind: "item", name: "Hand cart", tier: "background", fields: { place: "market_square" }, relations: [] } as WorldDoc["entities"][string];
    const { play } = chatOn(world);
    const r = play("m1", [positionEvent({ scope: "market_square" }, "cart", [2, 3], null), shapeEvent("cart", { size: [2, 1], blocks: { way: true } })]);
    const { drawn, moving } = layers(world, r.state, "market_square");
    expect(moving.pieces.cart).toEqual({ at: [2, 3], size: [2, 1], blocks: { way: true, view: false } });
    expect(footprint(drawn, moving, "cart").map((i) => i - (indexOf(drawn, [2, 3]) ?? 0))).toEqual([0, 1]);
    const blockers = blockersOf(drawn, moving);
    expect([blockers.way.size, blockers.view.size]).toEqual([2, 0]);
    expect(sees(drawn, moving, [1, 3], [5, 3])).toBe(true);
    expect(walk(drawn, moving, [1, 3], [5, 3])?.squares.some(([, row]) => row !== 3)).toBe(true);
    // One square that blocks nothing takes the footprint away.
    const back = play("m2", [shapeEvent("cart", {})]);
    expect(layers(world, back.state, "market_square").moving.pieces.cart).toEqual({ at: [2, 3] });
  });
});

/** A bar: nobody walks through it, and the view passes over it. */
const BAR_CELL = { terrain: "bar", blocked: true, seeThrough: true };

describe("what a map draws that today's could not", () => {
  test("a bar marked see-through blocks the way and not the view, and the format takes it", () => {
    const tap: MapDoc = { id: "tap_room", scope: "common_room", layout: ["#####", "#...#", "#bbb#", "#...#", "#####"], legend: { b: BAR_CELL }, cellMeters: 1.524 };
    expect(readMap(tap).problems).toEqual([]);
    const drawn = drawnOf(worldWith(tap), "common_room");
    if (!drawn) throw new Error("the tap room has no grid");
    expect(drawn.seeThrough.size).toBe(3);
    expect(sees(drawn, { pieces: {}, doors: {} }, [3, 2], [3, 4])).toBe(true);
    expect(walk(drawn, { pieces: {}, doors: {} }, [3, 2], [3, 4])).toBeNull();
    expect(readMap({ ...tap, legend: { b: { place: "kitchen", seeThrough: true } } }).problems.length).toBeGreaterThan(0);
  });

  test("a grid's own time step is the one it counts in, and the format takes it", () => {
    const step = { per: "round", seconds: 10, squares: 3 };
    const slow: MapDoc = Object.assign({ ...OPEN, id: "market_slow" }, { step });
    expect(readMap(slow).problems).toEqual([]);
    const drawn = drawnOf(worldWith(slow), "market_square");
    expect(drawn?.scale.step).toEqual({ per: "round", seconds: 10, squares: 3 });
    expect(drawn ? moveTime(drawn.scale, 7) : null).toEqual({ seconds: 30, rounds: 3 });
    expect(readMap(Object.assign({ ...slow }, { step: { per: "round", seconds: 0, squares: 3 } })).problems.length).toBeGreaterThan(0);
  });
});

describe("squares drawn anew", () => {
  test("a bar drawn across a room, kept as that change, lets the view over it and not the way", () => {
    const world = worldWith(OPEN);
    const { play } = chatOn(world);
    const across: [number, number][] = [
      [1, 3],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
    ];
    const r = play("m1", [squaresEvent("market_floor", across.map((at) => ({ at, symbol: "b" })), { b: BAR_CELL })]);
    expect(r.changes.map((c) => [c.op, c.applied])).toEqual([["space.squares", true]]);
    const { drawn, moving } = layers(world, r.state, "market_square");
    expect(drawn.seeThrough.size).toBe(5);
    expect(sees(drawn, moving, [3, 1], [3, 5])).toBe(true);
    expect(walk(drawn, moving, [3, 1], [3, 5])).toBeNull();
    expect(drawnOf(world, "market_square")?.blocked.size).toBe(0);
    // A legend the format cannot read is not applied.
    const bad = play("m2", [squaresEvent("market_floor", [{ at: [1, 1], symbol: "q" }], { q: { place: "nowhere at all" } })]);
    expect(bad.changes.map((c) => [c.applied, c.reports.map((x) => x.code)])).toEqual([[false, ["bad_legend"]]]);
  });
});
