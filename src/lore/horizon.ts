// Who and what is on the horizon (plan §6.4), as the lore map's fourth part lists what is bound to it
// (plan §9.2): the player's character first, then each character present, then the places, then
// anything else the horizon names. The horizon is the Author's own list, kept with the scene's record;
// "present" is where the world's records put a person: in a place the horizon names, or in a place
// inside one. Everything here is read from recorded values; nothing is judged from text.

import { isGone, kindIs } from "../engine/scope";
import { hasOwn } from "../shared/json";
import { placesAbove } from "./bindings";
import type { WorldAt } from "./sources";

/** A record on the horizon, by the id a binding names it by. */
export interface HorizonRecord {
  /** Its id in the world's tree: `entity:<id>` or `place:<id>`. */
  ref: string;
  id: string;
  name: string;
  /** The places holding it, nearest first, as refs: an entry pinned to a place is bound to the places inside it. */
  holds: string[];
}

export function horizonRecords(at: WorldAt): HorizonRecord[] {
  // The world as the chat plays it: its own places, and those play made or changed.
  const doc = at.registry.context(at.world, at.state).world;
  const entities = at.state.entities;
  const listed = (at.horizon ?? []).flatMap((h): { kind: "place" | "entity"; id: string }[] => {
    // A horizon entry names a level as the tree does: `place:`, `entity:`, or a bare id, a place before an entity.
    const bare = h.replace(/^(place|entity):/, "");
    if (!h.startsWith("entity:") && hasOwn(doc.places, bare)) return [{ kind: "place", id: bare }];
    if (!h.startsWith("place:") && hasOwn(entities, bare)) return [{ kind: "entity", id: bare }];
    return [];
  });
  const places = listed.flatMap((l) => (l.kind === "place" ? [l.id] : []));
  const out: HorizonRecord[] = [];
  const seen = new Set<string>();
  const entity = (id: string): void => {
    const e = entities[id];
    if (e === undefined || isGone(at.state, id) || seen.has(`entity:${id}`)) return;
    seen.add(`entity:${id}`);
    out.push({ ref: `entity:${id}`, id, name: e.name, holds: [] });
  };
  const isPerson = (id: string): boolean => {
    const e = entities[id];
    return e !== undefined && kindIs(at.registry, doc, e.kind, "person");
  };
  /** Which of the horizon's places a place is, or is inside: its place in the horizon's order, or -1. */
  const horizonPlace = (place: string): number => {
    const walked = new Set<string>();
    for (let p: string | undefined = place; p !== undefined && !walked.has(p); p = hasOwn(doc.places, p) ? doc.places[p]?.parent : undefined) {
      walked.add(p);
      const i = places.indexOf(p);
      if (i >= 0) return i;
    }
    return -1;
  };

  if (hasOwn(entities, doc.pov)) entity(doc.pov);
  const present = Object.keys(entities)
    .flatMap((id) => {
      const place = entities[id]?.fields.place;
      const i = isPerson(id) && typeof place === "string" ? horizonPlace(place) : -1;
      return i < 0 ? [] : [{ id, i, name: entities[id]?.name ?? id }];
    })
    .sort((a, b) => a.i - b.i || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const p of present) entity(p.id);
  for (const l of listed) if (l.kind === "entity" && isPerson(l.id)) entity(l.id);
  for (const p of places) {
    if (seen.has(`place:${p}`)) continue;
    seen.add(`place:${p}`);
    out.push({ ref: `place:${p}`, id: p, name: doc.places[p]?.name ?? p, holds: placesAbove(at, p) });
  }
  for (const l of listed) if (l.kind === "entity") entity(l.id);
  return out;
}
