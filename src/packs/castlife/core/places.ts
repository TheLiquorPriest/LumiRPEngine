// Where Cast life sends people: home, work, their bed, and the nearest place of a scene type. Shared by
// the day planner, its plans (DESIGN §24.8) and invitations.

import type { EntityId, PlaceId } from "../../../shared/ids";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { isGone, placeOfEntity } from "../../../engine/scope";

/**
 * Where someone's bed is (DESIGN §8): the place their `bed` field names, or where the bed it names
 * (an item) is; null without one, or when it is nowhere.
 */
export function bedPlace(ctx: ReadContext, who: EntityId): PlaceId | null {
  const bed = own(ctx.state.entities, who)?.fields.bed;
  if (typeof bed !== "string" || bed === "") return null;
  if (own(ctx.world.places, bed)) return bed;
  return own(ctx.state.entities, bed) && !isGone(ctx.state, bed) ? placeOfEntity(ctx.state, bed) : null;
}

export function homeOf(ctx: ReadContext, who: EntityId): PlaceId | null {
  const h = own(ctx.state.entities, who)?.fields.home;
  return typeof h === "string" ? h : null;
}

export function workPlace(ctx: ReadContext, who: EntityId): PlaceId | null {
  const employer = own(ctx.state.entities, who)?.fields.employer;
  if (typeof employer !== "string") return null;
  if (own(ctx.world.places, employer)) return employer;
  return placeOfEntity(ctx.state, employer);
}

/** A place of a scene type: one beside `near` (under the same parent) first, else any that isn't secret. */
export function placeOfType(ctx: ReadContext, sceneType: string, near: PlaceId | null): PlaceId | null {
  const ids = Object.keys(ctx.world.places).sort();
  const parent = near ? own(ctx.world.places, near)?.parent : undefined;
  return ids.find((id) => own(ctx.world.places, id)?.sceneType === sceneType && own(ctx.world.places, id)?.parent === parent) ?? ids.find((id) => own(ctx.world.places, id)?.sceneType === sceneType && own(ctx.world.places, id)?.visibility !== "secret") ?? null;
}
