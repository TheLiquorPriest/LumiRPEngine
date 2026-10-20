// Routes on a large world (DESIGN §9.6): the Go palette and the map ask for a route to every place
// they offer, so within one read pass the route graph is built from the world's routes once, however
// many routes are asked for, and every route found is the one found outside a pass.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { paramCandidates } from "../../../src/engine/resolve";
import { ALL_PACKS } from "../../../src/packs/index";
import { findRoute } from "../../../src/packs/space/core/travel";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** Riverton with a metro of `districts` districts in a row, each a street of `perDistrict` places. */
function metro(districts: number, perDistrict: number): WorldDoc {
  const world = modernUsWorld("w", "R");
  world.places.metro = { id: "metro", name: "Metro", parent: "riverton", fields: {} };
  world.routes.r_metro = { id: "r_metro", from: "riverton", to: "d0", bidirectional: true, modes: { walk: { minutes: 20, distanceKm: 2 }, road: { minutes: 6, distanceKm: 2 } } };
  for (let d = 0; d < districts; d++) {
    world.places[`d${d}`] = { id: `d${d}`, name: `District ${d}`, parent: "metro", fields: {} };
    if (d > 0) world.routes[`r_d${d}`] = { id: `r_d${d}`, from: `d${d - 1}`, to: `d${d}`, bidirectional: true, modes: { walk: { minutes: 12, distanceKm: 1 }, road: { minutes: 4, distanceKm: 1 } } };
    for (let p = 0; p < perDistrict; p++) {
      world.places[`d${d}_p${p}`] = { id: `d${d}_p${p}`, name: `Place ${d}-${p}`, parent: `d${d}`, fields: {} };
      if (p > 0) world.routes[`r_d${d}_p${p}`] = { id: `r_d${d}_p${p}`, from: `d${d}_p${p - 1}`, to: `d${d}_p${p}`, bidirectional: true, modes: { walk: { minutes: 3, distanceKm: 0.2 } } };
    }
  }
  return world;
}

/** The world with every read of its routes (a lookup or a listing) counted. */
function counted(world: WorldDoc): { world: WorldDoc; reads: () => number } {
  let reads = 0;
  const routes = new Proxy(world.routes, {
    ownKeys: (target) => {
      reads++;
      return Reflect.ownKeys(target);
    },
    get: (target, key, receiver) => {
      reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { world: { ...world, routes }, reads: () => reads };
}

const targets = (n: number): string[] => Array.from({ length: n }, (_, i) => `d${i % 12}_p${(i * 7) % 20}`);

/** The places Go offers on the metro and `n` more routes asked for, in one read pass, and how many reads of the world's routes they took. */
function offeredAndRouted(n: number): { offered: string[]; reads: number; routes: number } {
  const base = metro(12, 20);
  const { world, reads } = counted(base);
  const state = startState(world);
  const go = reg.actions.get("go");
  if (!go) throw new Error("no go action");
  const offered = readPass(() => {
    const options = paramCandidates(reg, world, state, go, "to");
    for (const to of targets(n)) findRoute(world, "apartment", to, "walk");
    return options;
  });
  return { offered, reads: reads(), routes: Object.keys(base.routes).length };
}

describe("routes on a large world", () => {
  test("one read pass reads each route a few times, however many places it routes to", () => {
    const few = offeredAndRouted(10);
    const many = offeredAndRouted(200);
    expect(few.offered.length).toBeGreaterThan(240);
    expect(many.reads).toBe(few.reads);
    expect(many.reads).toBeLessThanOrEqual(8 * many.routes);
  });
  test("a route found in a pass is the one found outside it", () => {
    const world = metro(12, 20);
    const outside = targets(30).map((to) => findRoute(world, "apartment", to, "walk"));
    const inside = readPass(() => targets(30).map((to) => findRoute(world, "apartment", to, "walk")));
    expect(inside).toEqual(outside);
    expect(outside.every((plan) => plan !== null && plan.minutes > 0)).toBe(true);
  });
});
