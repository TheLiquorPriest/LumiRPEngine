// What the store records of the grid. Today's events: a square taken or left (`space.pos`,
// `packs/space/core/positions.ts`), which writes a person's or a thing's `x` and `y`; and a map or a
// place written whole into the chat's own draft of its world (`engine.world`, `engine/world-draft.ts`,
// the event today's `world_map` tool writes), which a grid laid in play is. The space pack's own
// (`packs/space/core/grid-play.ts`): a door opened, shut or locked (`space.door`), a footprint and
// what it blocks (`space.shape`), and squares of a map drawn anew (`space.squares`), kept as that
// change over the map.

import type { EntityId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { MapCellDef, WorldDoc } from "../../shared/world";
import { baseWorld } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import { chatDraftOf, DRAFT_EVENT, draftEvent, type DraftEdit } from "../../engine/world-draft";
import { DOOR_EVENT, SHAPE_EVENT, SQUARES_EVENT } from "../../packs/space/core/grid-play";
import { POS_EVENT } from "../../packs/space/core/positions";
import type { ChangeInput } from "../../store/types";
import { cellOf, type DoorState, type Drawn, type Moving, type Piece, type Square } from "./grid";

/** The change that writes `edit` into the chat's draft of its world: `world` the revision it plays, `state` the chat's state now. */
export function draftChange(world: WorldDoc, state: Readonly<WorldState>, edit: DraftEdit): ChangeInput {
  return { lane: "engine", op: DRAFT_EVENT, value: draftEvent(baseWorld(world), chatDraftOf(state), edit) as unknown as JsonObject };
}

/** The `space.pos` event that puts `id` on a square of the grid of `scope` (null: off it), from where it stood. */
export function positionEvent(grid: Pick<Drawn, "scope">, id: EntityId, at: Square | null, from: Square | null): JsonObject {
  const spot = (s: Square | null): JsonObject | null => (s ? { scope: grid.scope, ...cellOf(s) } : null);
  return { type: POS_EVENT, data: { entity: id, at: spot(at), from: spot(from) } };
}

/** That event as a change to record. */
export function positionChange(grid: Pick<Drawn, "scope">, id: EntityId, at: Square | null, from: Square | null): ChangeInput {
  return { lane: "engine", op: POS_EVENT, value: positionEvent(grid, id, at, from) };
}

/**
 * The changes that record a move from `before` to `after` on one grid: for each one whose own
 * square changed, its new square; for each one that stood on a square and stands on none of its
 * own now (lifted, or laid on something), off the grid. By id.
 */
export function positionChanges(drawn: Drawn, before: Moving, after: Moving): ChangeInput[] {
  const out: ChangeInput[] = [];
  for (const id of [...new Set([...Object.keys(before.pieces), ...Object.keys(after.pieces)])].sort()) {
    const was = before.pieces[id]?.at ?? null;
    const now = after.pieces[id]?.at ?? null;
    if (was?.[0] === now?.[0] && was?.[1] === now?.[1]) continue;
    out.push(positionChange(drawn, id, now, was));
  }
  return out;
}

/** The `space.door` event that opens, shuts or locks the door on a square of the grid of `scope`. */
export function doorEvent(grid: Pick<Drawn, "scope">, at: Square, state: DoorState): JsonObject {
  return { type: DOOR_EVENT, data: { scope: grid.scope, ...cellOf(at), state } };
}

/** The `space.shape` event that gives `id` its footprint and says what it blocks, written whole. */
export function shapeEvent(id: EntityId, shape: Pick<Piece, "size" | "blocks">): JsonObject {
  const [w, h] = shape.size ?? [1, 1];
  return { type: SHAPE_EVENT, data: { entity: id, size: [w, h], way: shape.blocks?.way === true, view: shape.blocks?.view === true } };
}

/** The `space.squares` event that draws squares of a map anew and changes its legend (a symbol given null is taken out). */
export function squaresEvent(map: string, squares: readonly { at: Square; symbol: string }[], legend: Readonly<Record<string, MapCellDef | null>>): JsonObject {
  return { type: SQUARES_EVENT, data: { map, squares: squares.map((s) => ({ ...cellOf(s.at), symbol: s.symbol })), legend: { ...legend } as JsonObject } };
}
