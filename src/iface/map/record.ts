// What the store records of the grid, in today's events: a square taken or left (`space.pos`,
// `packs/space/core/positions.ts`), which writes a person's or a thing's `x` and `y`; and a map or a
// place written whole into the chat's own draft of its world (`engine.world`, `engine/world-draft.ts`,
// the event today's `world_map` tool writes). Today's state has no place for a footprint, for what
// blocks or for a door's state, so a change to those is not among these changes.

import type { EntityId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { WorldDoc } from "../../shared/world";
import { baseWorld } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import { chatDraftOf, DRAFT_EVENT, draftEvent, type DraftEdit } from "../../engine/world-draft";
import { POS_EVENT } from "../../packs/space/core/positions";
import type { ChangeInput } from "../../store/types";
import { cellOf, type Drawn, type Moving, type Square } from "./grid";

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
