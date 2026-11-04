// Port Alder grown large for the view measurements (`test/backend/state-view-perf.test.ts`): the
// shipped starter with generated people, factions whose members act for them, and places on the
// walk from the player character's home. Every added name is generated here; nothing comes from any
// player's world.

import type { WorldDoc } from "../../src/shared/world";
import { STARTER_WORLDS } from "../../src/packs/index";

/** How much is added for each unit of `scale`. */
export const GROWN = { people: 30, factions: 6, places: 6 } as const;

/** Port Alder with `scale` times `GROWN` added: people at the added places, five to a faction, the first of each acting for it by the second's delegation. */
export function grownPortAlder(id: string, name: string, scale: number): WorldDoc {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make(id, name);
  const added: string[] = [];
  let from = "harbor_street_114";
  for (let i = 0; i < GROWN.places * scale; i++) {
    const place = `grown_place_${i}`;
    world.places[place] = { id: place, name: `Grown Place ${i}`, fields: { description: "A place added for the measurements.", tags: ["park"] }, parent: "port_alder", timeZone: "America/New_York", sceneType: "downtime" };
    world.routes[`grown_route_${i}`] = { id: `grown_route_${i}`, from, to: place, modes: { walk: { minutes: 3, distanceKm: 0.2 }, road: { minutes: 1, distanceKm: 0.2 } }, bidirectional: true };
    added.push(place);
    from = place;
  }
  const people: string[] = [];
  for (let i = 0; i < GROWN.people * scale; i++) {
    const person = `grown_person_${i}`;
    const at = added[i % added.length] ?? "port_alder";
    world.entities[person] = { id: person, kind: "character", name: `Grown Person ${i}`, tier: "background", fields: { description: "Someone added for the measurements.", place: at, home: at }, relations: [] };
    people.push(person);
  }
  for (let f = 0; f < GROWN.factions * scale; f++) {
    const faction = `grown_faction_${f}`;
    world.entities[faction] = { id: faction, kind: "faction", name: `Grown Faction ${f}`, tier: "background", fields: {}, relations: [] };
    const members = people.slice(f * 5, f * 5 + 5);
    members.forEach((person, i) => {
      const relations = world.entities[person]?.relations;
      if (!relations) return;
      relations.push({ type: "member_of", to: faction, fields: { role: i === 0 ? "officer" : "member" } });
      const by = members[1];
      if (i === 0 && by !== undefined) relations.push({ type: "acts_for", to: faction, fields: { powers: ["money.view", "assets.use"], by } });
    });
  }
  return world;
}
