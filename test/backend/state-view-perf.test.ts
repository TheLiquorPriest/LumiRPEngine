// What the state view's panels and the GM view cost as a world grows (DESIGN §9.6), on Port Alder
// grown with more people, factions whose members act for them, and places on the walk
// (`grownPortAlder`), at two sizes, the larger with four times the growth of the smaller. Within a
// read pass each answer many parts ask again is worked out once: an organization's delegations and
// places, a party's money, a place's region and sky, a drive's searches and a trip. So the view and
// the GM view grow about as the world does; read again for every person, power and organization,
// the GM's organizations took most of a minute on a large world. Bounds are generous ratios, never
// timings. Then the costs that grow with a world's places and a chat's revisions, by count.

import { expect, test } from "bun:test";
import { buildGmWorld } from "../../src/engine/gm-view";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { PlaceId } from "../../src/shared/ids";
import { startState } from "../packs/support";
import { grownPortAlder } from "../support/grown-world";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
const SMALL = 2;
const LARGE = 8;

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** The median time of `runs` calls of `fn`, after one to warm it. */
function timeOf(fn: () => unknown, runs: number): number {
  fn();
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return median(out);
}

function costs(scale: number): { orgs: number; gm: number; panels: number } {
  const world = grownPortAlder("gw", "Grown", scale);
  const state = startState(world, reg);
  const ctx = reg.context(world, state);
  return {
    orgs: timeOf(() => readPass(() => ctx.query("orgs.gm")(ctx)), 5),
    gm: timeOf(() => readPass(() => buildGmWorld(reg, world, state)), 3),
    panels: timeOf(() => readPass(() => reg.views.map((view) => view.build(ctx, { mapDisplay: null }))), 3),
  };
}

test("the GM view's organizations, the whole GM view and the state view's panels grow about as the world does", () => {
  const small = costs(SMALL);
  const large = costs(LARGE);
  // Four times the growth: each about four times the cost, or less. Who may… read for every person in
  // every organization grew some twenty-five times, and the panels, each place's trips and sky asked
  // again for every destination, six.
  expect(large.orgs).toBeLessThan(small.orgs * 10);
  expect(large.gm).toBeLessThan(small.gm * 10);
  expect(large.panels).toBeLessThan(small.panels * 5);
}, 60_000);

test("a vehicle's trips ask once of each place whether it may be left there, however many destinations", () => {
  const world = grownPortAlder("gw", "Grown", LARGE);
  const ctx = reg.context(world, startState(world, reg));
  const places = Object.keys(world.places);
  const targets = places.filter((p) => p !== "harbor_street_114");
  const asked = new Map<PlaceId, number>();
  const trips = ctx.query("space.vehicle_trips")(ctx, { from: "harbor_street_114", at: "harbor_street_114", modes: ["road"], canPark: (p) => (asked.set(p, (asked.get(p) ?? 0) + 1), true) }, targets);
  expect(trips.size).toBeGreaterThan(0);
  expect(Math.max(...asked.values())).toBe(1);
  expect(asked.size).toBeLessThanOrEqual(places.length);
});

test("a chat played across revisions of its world holds one copy of what the revisions have alike", async () => {
  const played = new Rig({ shipped: true, templates: { grown: (id, name) => grownPortAlder(id, name, SMALL) } });
  const worldId = await played.newWorld("Grown", "grown");
  const first = played.body(await played.send({ type: "lre.world", op: "get", worldId })).revision as string;
  // The next revision changes one person; everything else stays as it was.
  const got = played.body(await played.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const person = (got.draft as { entities: Record<string, { fields: Record<string, unknown> }> }).entities.grown_person_0;
  if (!person) throw new Error("no grown person");
  played.body(await played.send({ type: "lre.editor", op: "put", worldId, base: got.base, collection: "entities", id: "grown_person_0", value: { ...person, fields: { ...person.fields, description: "Changed for the next revision." } } }));
  const second = played.body(await played.send({ type: "lre.world", op: "commit", worldId, base: got.base })).revision as string;
  expect(second).not.toBe(first);

  // After a restart, the two revisions read from storage as a chat's pins are.
  const rig = played.restart();
  const docs = await rig.rt.worlds.getMany(worldId, rig.host.userId, [first, second]);
  const a = docs.get(first);
  const b = docs.get(second);
  if (!a || !b) throw new Error("a revision didn't read");
  expect(b.places).toBe(a.places);
  expect(b.routes).toBe(a.routes);
  expect(b.entities.grown_person_1).toBe(a.entities.grown_person_1);
  expect(b.entities.grown_person_0).not.toBe(a.entities.grown_person_0);
  expect(b.entities.grown_person_0?.fields.description).toBe("Changed for the next revision.");
  expect(a.entities.grown_person_0?.fields.description).toBe("Someone added for the measurements.");
});
