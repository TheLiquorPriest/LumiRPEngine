// What is lit (plan §8.2, "what moves": where each is, which doors are open, what is lit). Light is
// the state of a place, kept as the place's typed field `light`, lit or dark: for a place as a whole
// and for each room drawn on its grid (a place in its own right), written by `world_apply`'s `set` as
// any place's field is, and so tied to the turn and carried by an Upgrade as the chat's draft carries
// a place's field. A room takes its house's light unless it has its own; a place with none recorded
// anywhere above it reads as the settings say (`map.lightUnset`). Nothing computes light from lamps:
// sight says whether a target stands lit or dark and leaves the ruling to the one who rules.

import type { PlaceId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import { LIGHTS, MAP_DEFAULTS, type Light, type MapConfig } from "../../../shared/map-config";
import type { WorldDoc } from "../../../shared/world";

/** The field of a place that holds its light. */
export const LIGHT_FIELD = "light";

/** A light as a place's field gives it: the word lit or dark (or yes or no for it), however it is written; null for anything else. */
export function lightRead(raw: unknown): Light | null {
  if (raw === true) return "lit";
  if (raw === false) return "dark";
  if (typeof raw !== "string") return null;
  const word = raw.trim().toLowerCase();
  return (LIGHTS as readonly string[]).includes(word) ? (word as Light) : null;
}

/** The places above `place`, the nearest first. */
function above(places: WorldDoc["places"], place: PlaceId): PlaceId[] {
  const out: PlaceId[] = [];
  let up = hasOwn(places, place) ? places[place]?.parent : undefined;
  while (up !== undefined && out.length < 64) {
    out.push(up);
    up = hasOwn(places, up) ? places[up]?.parent : undefined;
  }
  return out;
}

/** The light a place records for itself, or that of the nearest place above it that records one; null where none does. */
function recorded(places: WorldDoc["places"], place: PlaceId): Light | null {
  for (const id of [place, ...above(places, place)]) {
    const fields = hasOwn(places, id) ? places[id]?.fields : undefined;
    const own = fields !== undefined && hasOwn(fields, LIGHT_FIELD) ? lightRead(fields[LIGHT_FIELD]) : null;
    if (own !== null) return own;
  }
  return null;
}

/** The light of a place as the world plays it: its own, else its house's, else what a place with none reads as. */
export function lightOf(world: Pick<WorldDoc, "places">, place: PlaceId, config: Readonly<MapConfig> = MAP_DEFAULTS): Light {
  return recorded(world.places, place) ?? config.lightUnset;
}

/** Where a place's light is out on a grid: the place, and the squares (by index) it is dark on that no room inside it has a light of its own for. */
export interface DarkArea {
  place: PlaceId;
  /** The squares, by index, in order. */
  squares: readonly number[];
  /** That it is the whole grid. */
  whole: boolean;
}

/**
 * What is dark on the grid of `scope`, which is `width` by `height`: each square reads the light of
 * the room drawn over it (a zone named after a place inside `scope`; where rooms lie inside rooms,
 * the innermost), and the squares no room is drawn over, that of `scope`. The squares in the dark,
 * by index, and the places whose dark they are, each with its squares.
 */
export function darkOn(world: Pick<WorldDoc, "places">, scope: PlaceId, zones: Readonly<Record<string, readonly number[]>>, width: number, height: number, config: Readonly<MapConfig> = MAP_DEFAULTS): { dark: ReadonlySet<number>; areas: DarkArea[] } {
  const total = width * height;
  const rooms = Object.keys(zones)
    .filter((id) => id !== scope && hasOwn(world.places, id))
    .map((id) => ({ id, depth: above(world.places, id).length, inside: above(world.places, id).includes(scope) }))
    .filter((r) => r.inside)
    .sort((a, b) => a.depth - b.depth);
  // The place whose light each square reads: the grid's own, then each room over it, the deepest last.
  const owner: PlaceId[] = new Array<PlaceId>(total).fill(scope);
  for (const room of rooms) for (const i of zones[room.id] ?? []) if (i >= 0 && i < total) owner[i] = room.id;
  const dark = new Set<number>();
  const bySquare = new Map<PlaceId, number[]>();
  const light = new Map<PlaceId, Light>();
  for (let i = 0; i < total; i++) {
    const id = owner[i] ?? scope;
    let read = light.get(id);
    if (read === undefined) light.set(id, (read = lightOf(world, id, config)));
    if (read !== "dark") continue;
    dark.add(i);
    const held = bySquare.get(id);
    if (held) held.push(i);
    else bySquare.set(id, [i]);
  }
  const areas = [...bySquare].map(([place, squares]) => ({ place, squares, whole: squares.length === total }));
  return { dark, areas };
}
