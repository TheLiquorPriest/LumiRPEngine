// The grid's face for the everyday operations (`world_apply`'s `move` and `place`; `GridMoves` in
// `./ports.ts`): someone or something put on a square of the grid it stands on at its place, on the
// free square nearest someone, or on a free square of a zone, as the `space.pos` event that
// records it, with what the answer says of it in the map's lines: for one that stood on the grid
// before, the way it went and the time that took; and what does not add up where it now stands. A
// square is taken as the map prints it, [column, row] from 1. Where there is no square to give (no
// map, no such zone, no one to stand beside), the zone or the words stay as the position instead.

import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { nearestMiddle, standingGrid } from "../../shared/grid";
import type { WorldDoc } from "../../shared/world";
import { playedWorld } from "../../engine/places-in-play";
import { placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import type { GridFinding, GridMoves, GridPlaced } from "./ports";
import { Lines } from "../texts";
import { MAP_DEFAULTS, type MapConfig } from "../../shared/map-config";
import { blockersOf, drawnOf, footprint, indexOf, lift, movingOf, place as putAt, squareAt, squareOf, standsAt, type Drawn, type Moving, type Square } from "../../packs/space/core/grid-model";
import { whereOf } from "../../packs/space/core/grid-play";
import { move } from "../../packs/space/core/grid-path";
import { between } from "../../packs/space/core/grid-measure";
import { positionEvent } from "./record";
import { farText, nameIn, reportFields, type Say, spotText, timeText, whoIs } from "./words";

/** The squares nobody may be put on: what blocks the way, and every footprint on the grid. */
function takenSquares(drawn: Drawn, moving: Moving): Set<number> {
  const taken = new Set(blockersOf(drawn, moving).way);
  for (const id of Object.keys(moving.pieces)) for (const i of footprint(drawn, moving, id)) taken.add(i);
  return taken;
}

/**
 * The square nearest `near`'s footprint (the lowest such square, row by row, among equals) that is free;
 * with `crowded`, one that is taken by something that does not block the way too (the room is full:
 * the nearest all the same, and the overlap is reported). Null when none is, or `near` stands nowhere
 * on the grid.
 */
export function beside(drawn: Drawn, moving: Moving, near: EntityId, crowded = false): Square | null {
  if (standsAt(moving, near) === null) return null;
  const taken = crowded ? new Set(blockersOf(drawn, moving).way) : takenSquares(drawn, moving);
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

/** The free square of a zone nearest its middle; with `crowded`, the middle of the zone's squares that do not block the way though they are taken. Null when the zone has none. */
export function inZone(drawn: Drawn, moving: Moving, zone: string, crowded = false): Square | null {
  const taken = crowded ? new Set(blockersOf(drawn, moving).way) : takenSquares(drawn, moving);
  const free = (hasOwn(drawn.zones, zone) ? (drawn.zones[zone] ?? []) : []).filter((i) => !taken.has(i));
  const middle = nearestMiddle(free, drawn.width);
  return middle ? squareOf(middle) : null;
}

/** The pieces at `place` that have a zone or words kept as their position, as the answer lists them. */
function softAt(world: WorldDoc, state: Readonly<WorldState>, place: string): string {
  return Object.keys(state.entities)
    .sort()
    .flatMap((id) => {
      const w = whereOf(state, id);
      return w !== null && placeOfEntity(state, id) === place ? [`${nameIn(world, state, id)} [${id}]: ${w.zone ?? w.words}`] : [];
    })
    .join("; ");
}

/**
 * Placing on squares for the everyday operations, with what the answer says of it worded by
 * `lines` (the map's part in force for the chat; with none, nothing is said), and the grid's
 * settings. A square in a wall, or one with no way to it, is applied all the same and reported.
 * Nothing is lost for what the map lacks: with no map, no such zone, no one to stand beside, the
 * zone or the words are kept as the position and the report says what could not be placed; a room
 * with no free square takes it on the nearest all the same. Only a square that does not exist is
 * refused, with what does exist.
 */
export function gridMoves(lines: Lines = Lines.none(), config: Readonly<MapConfig> = MAP_DEFAULTS): GridMoves {
  return {
    place({ state, env, who, place, square, near, zone }) {
      const doc = env.worlds(state.world.revision);
      if (!doc) return { problem: "not_applicable", fields: { code: "no_world" } };
      const world = playedWorld(doc, state.world);
      const say: Say = { lines, world, state: state.world };
      const found = (line: string, values: Record<string, unknown>): GridFinding[] => {
        const fields = reportFields(say, values);
        const words = lines.line(line, fields);
        return words !== undefined && words.trim() !== "" ? [{ line, fields, words }] : [];
      };
      /** A square that does not exist: refused, answered in the map's words with what does exist; with none, by its code. */
      const absent = (line: string, code: string, values: Record<string, unknown>): GridPlaced => {
        const said = lines.line(line, reportFields(say, values));
        return said !== undefined && said.trim() !== "" ? { problem: "on_map", fields: { said } } : { problem: "not_applicable", fields: { code } };
      };
      const stand = standingGrid(world, place);
      const drawn = stand ? drawnOf(world, stand.scope, config, state.world) : null;
      /** No square for it: the zone, or the words beside someone, stay as its position, and the report says what could not be placed. */
      const keep = (line: string): GridPlaced => {
        const kept = near !== undefined ? { words: `near ${nameIn(world, state.world, near)}` } : { zone: zone ?? "" };
        return { kept, reports: found(line, { what: who, place, near, zone, kept: kept.zone ?? kept.words }) };
      };
      if (!drawn) {
        if (square !== undefined) return absent("no_square_no_map", "no_map", { what: who, place, square, soft: softAt(world, state.world, place) });
        return keep("grid_kept_no_map");
      }
      const { moving } = movingOf(env.registry, world, state.world, drawn);
      const others = lift(moving, who);
      if (square !== undefined && indexOf(drawn, square) === null) return absent("no_square_off", "off_grid", { what: who, place, square, width: drawn.width, height: drawn.height, soft: softAt(world, state.world, place), zones: Object.keys(drawn.zones).sort().join(", ") });
      let to: Square | null = square ?? null;
      if (to === null && near !== undefined) {
        if (standsAt(others, near) === null) return keep("grid_kept_nowhere");
        to = beside(drawn, others, near) ?? beside(drawn, others, near, true);
      } else if (to === null && zone !== undefined) {
        if (!hasOwn(drawn.zones, zone)) return keep("grid_kept_no_zone");
        to = inZone(drawn, others, zone) ?? inZone(drawn, others, zone, true);
      }
      if (to === null) return keep(near !== undefined ? "grid_kept_nowhere" : "grid_kept_no_zone");
      const from = hasOwn(moving.pieces, who) ? (moving.pieces[who]?.at ?? null) : null;
      // One that stood on the grid goes there along the cheapest way, which the answer gives with its time.
      const moved = from ? move(drawn, moving, who, to) : null;
      const way = moved?.walk && moved.took && from ? lines.line("way_taken", { what: whoIs(say, who), from: spotText(say, from), to: spotText(say, to), distance: moved.walk.distance, far: farText(lines, drawn, moved.walk.distance), cost: moved.walk.cost, time: timeText(say, moved.took) }) : undefined;
      const reports = (moved ?? putAt(drawn, moving, who, to)).reports.flatMap((r) => found(`grid_${r.code}`, r.values));
      return { events: [positionEvent(drawn, who, to, from)], ...(way !== undefined && way.trim() !== "" ? { said: [way] } : {}), ...(reports.length > 0 ? { reports } : {}), ...(square === undefined ? { filled: true as const } : {}) };
    },
  };
}
