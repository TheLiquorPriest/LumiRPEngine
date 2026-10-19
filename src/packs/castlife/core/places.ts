// Where Cast life sends people: home, work, and the nearest place of a scene type. Shared by the day
// planner, its plans (DESIGN §24.8) and invitations.

import type { EntityId, PlaceId } from "../../../shared/ids";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { placeOfEntity } from "../../../engine/scope";

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
