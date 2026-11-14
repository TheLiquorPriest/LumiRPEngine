// The grid's face for the everyday operations (`world_apply`'s `move` and `place`; `GridMoves` in
// `../kit.ts`): someone or something put on a square of the grid it stands on at its place, on the
// free square nearest someone, or on a free square of a zone, as the `space.pos` event that
// records it. A square is taken as the map prints it, [column, row] from 1.

import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { nearestMiddle, standingGrid } from "../../shared/grid";
import { playedWorld } from "../../engine/places-in-play";
import type { GridMoves } from "../kit";
import { blockersOf, drawnOf, footprint, GRID_DEFAULTS, indexOf, lift, movingOf, squareAt, squareOf, standsAt, type Drawn, type GridSettings, type Moving, type Square } from "./grid";
import { between } from "./measure";
import { positionEvent } from "./record";

/** The squares nobody may be put on: what blocks the way, and every footprint on the grid. */
function takenSquares(drawn: Drawn, moving: Moving): Set<number> {
  const taken = new Set(blockersOf(drawn, moving).way);
  for (const id of Object.keys(moving.pieces)) for (const i of footprint(drawn, moving, id)) taken.add(i);
  return taken;
}

/** The free square nearest `near`'s footprint (the lowest such square, row by row, among equals); null when none is free or `near` stands nowhere on the grid. */
function beside(drawn: Drawn, moving: Moving, near: EntityId): Square | null {
  if (standsAt(moving, near) === null) return null;
  const taken = takenSquares(drawn, moving);
  let best: Square | null = null;
  let far = Infinity;
  for (let i = 0; i < drawn.width * drawn.height; i++) {
    if (taken.has(i)) continue;
    const s = squareAt(drawn, i);
    const d = between(drawn, moving, s, near) ?? Infinity;
    if (d < far) {
      far = d;
      best = s;
    }
  }
  return best;
}

/** The free square of a zone nearest its middle; null when the zone has none free. */
function inZone(drawn: Drawn, moving: Moving, zone: string): Square | null {
  const taken = takenSquares(drawn, moving);
  const free = (hasOwn(drawn.zones, zone) ? (drawn.zones[zone] ?? []) : []).filter((i) => !taken.has(i));
  const middle = nearestMiddle(free, drawn.width);
  return middle ? squareOf(middle) : null;
}

/** Placing on squares for the everyday operations, with the grid's settings. */
export function gridMoves(settings: Readonly<GridSettings> = GRID_DEFAULTS): GridMoves {
  return {
    place({ state, env, who, place, square, near, zone }) {
      const doc = env.worlds(state.world.revision);
      if (!doc) return { problem: "not_applicable", fields: { code: "no_world" } };
      const world = playedWorld(doc, state.world);
      const stand = standingGrid(world, place);
      const drawn = stand ? drawnOf(world, stand.scope, settings) : null;
      if (!drawn) return { problem: "not_applicable", fields: { code: "no_map" } };
      const { moving } = movingOf(env.registry, world, state.world, drawn);
      const others = lift(moving, who);
      if (zone !== undefined && !hasOwn(drawn.zones, zone)) return { problem: "not_applicable", fields: { code: "no_zone" } };
      const to = square ?? (near !== undefined ? beside(drawn, others, near) : zone !== undefined ? inZone(drawn, others, zone) : null);
      if (to === null) return { problem: "not_applicable", fields: { code: near !== undefined ? "no_square_beside" : "no_square_free" } };
      if (indexOf(drawn, to) === null) return { problem: "not_applicable", fields: { code: "off_grid" } };
      const from = hasOwn(moving.pieces, who) ? (moving.pieces[who]?.at ?? null) : null;
      return { events: [positionEvent(drawn, who, to, from)] };
    },
  };
}
