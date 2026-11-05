// What the GM view's roster costs as a world grows (DESIGN §7, `lre.gm.part` `roster`): every entity
// slim, as the GM page's lists read it in place of the whole entries. At 50 entities (Mystery Manor)
// and at 500 (Port Alder grown with people, factions and places), it stays under 400 bytes an
// entity and under 5% of the entities whole, and it is the whole entries made slim.

import { expect, test } from "bun:test";
import { buildGmRoster, buildGmWorldPart } from "../../src/engine/gm-view";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { gmRosterEntry } from "../../src/shared/gm-parts";
import type { WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import { GROWN, grownPortAlder } from "../support/grown-world";

const reg = createRegistry(ALL_PACKS);

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/** `world` with generated people added, at its first place, until it holds `count` entities. */
function holding(world: WorldDoc, count: number): WorldDoc {
  const at = Object.keys(world.places)[0] ?? null;
  for (let i = 0; Object.keys(world.entities).length < count; i++) {
    const id = `sized_person_${i}`;
    world.entities[id] = { id, kind: "character", name: `Sized Person ${i}`, tier: "background", fields: { description: "Someone added for the measurement.", ...(at ? { place: at, home: at } : {}) }, relations: [] };
  }
  return world;
}

/** Port Alder grown (`grownPortAlder`) by as much as `count` entities leave room for. */
function grownTo(count: number): WorldDoc {
  const base = STARTER_WORLDS.modern_slice_of_life?.("pa", "Port Alder");
  if (!base) throw new Error("no Port Alder starter");
  return grownPortAlder("pa", "Port Alder", Math.floor((count - Object.keys(base.entities).length) / (GROWN.people + GROWN.factions)));
}

test.each([
  ["Mystery Manor", 50, () => STARTER_WORLDS.mystery_manor?.("mm", "Mystery Manor")],
  ["Port Alder grown", 500, () => grownTo(500)],
] as const)("%s at %i entities: the roster stays under 400 bytes an entity and 5% of the entities whole", (_name, count, make) => {
  const made = make();
  if (!made) throw new Error("no starter");
  const world = holding(made, count);
  const state = startState(world, reg);
  expect(Object.keys(state.entities)).toHaveLength(count);
  const roster = readPass(() => buildGmRoster(reg, world, state));
  const entities = readPass(() => buildGmWorldPart(reg, world, state, "entities"));
  expect(roster).toEqual(entities.map(gmRosterEntry));
  expect(bytes(roster) / count).toBeLessThan(400);
  expect(bytes(roster)).toBeLessThan(bytes(entities) * 0.05);
});
