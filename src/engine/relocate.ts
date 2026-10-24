// The one move path (DESIGN §4.1, §9.4): every writer of where someone is (the `move` effect, the
// reply's moves, driving, routines, schedules, trips, skip plans, GM and ✎ edits) asks here for the
// events of a move, so they all leave the same state: out of whatever holds them (`in`), `place`
// set, and where they then stand (the space pack's arrival cell, from Space 3), with the event
// shapes rules and replay read (`unlink`, `set place`, `space.pos`). A narrated move also leaves its
// old activity behind, and checks routes while the world's travel simulation is on. The player
// character's party (people who `travels_with` it) comes along when the move says so.

import type { EntityId, PlaceId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import { mapSettingsOf } from "../shared/maps";
import { PARTY_RELATION } from "../shared/party";
import { acts } from "./life";
import { optionalQuery, optionalService, own } from "./pack-kit";
import { together } from "./presence";
import type { ReadContext, Rejection } from "./registry";
import { isGone, placeOfEntity } from "./scope";
import { canSeePlace } from "./visibility";

export interface RelocateOptions {
  /**
   * A narrated move's activity rule: to another place, their activity becomes this ("idle" when the
   * reply gives none), so what they did where they were stays behind. Absent: the activity is the
   * writer's own business.
   */
  activity?: string;
  /** Refuse a move no route reaches, while the world's travel simulation is on (a narrated move). */
  route?: boolean;
  /** The player character's party follows it there (a move the player character makes). */
  party?: boolean;
}

/**
 * The events that move `who` to `to`, or why it can't happen. `to` must be a place of the world and
 * `who` someone in it: callers check what their own refusal says.
 */
export function relocate(ctx: ReadContext, who: EntityId, to: PlaceId, opts: RelocateOptions = {}): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, who);
  if (!e) return { code: "missing_entity", reason: `no entity ${who}` };
  const from = placeOfEntity(ctx.state, who);
  // Moves are story first: only the world's travel simulation makes one across a gap no route spans
  // (off an island with no boat leg back) a move that didn't happen. The reason reaches the player:
  // a place the POV can't see is somewhere.
  if (opts.route && from && from !== to && mapSettingsOf(ctx.world).travelSimulation === true) {
    const reach = optionalQuery(ctx, "space.reachable");
    const named = (id: PlaceId): string => (canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id) ? (own(ctx.world.places, id)?.name ?? id) : "somewhere");
    if (reach && !reach(ctx, from, to)) return { code: "no_route", reason: `There's no way from ${named(from)} to ${named(to)}` };
  }
  const out = moveEvents(ctx, who, to);
  const doing = e.fields.activity;
  if (opts.activity !== undefined && from !== to && doing !== undefined && doing !== opts.activity) out.push({ type: "set", entity: who, field: "activity", value: opts.activity });
  if (opts.party && who === ctx.world.pov) for (const member of partyAt(ctx, from)) if (placeOfEntity(ctx.state, member) !== to) out.push(...moveEvents(ctx, member, to));
  return out;
}

/** The bare move: out of what holds them, the place, and where they stand there. */
function moveEvents(ctx: ReadContext, who: EntityId, to: PlaceId): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const r of own(ctx.state.entities, who)?.relations ?? []) if (r.type === "in") out.push({ type: "unlink", rel: "in", from: who, to: r.to });
  out.push({ type: "set", entity: who, field: "place", value: to });
  // Where the mover stands there is the space pack's (DESIGN §7): from Space 3 the POV stands on
  // the place's cell, and with the grid system on, at a gridded place's entrance.
  out.push(...(optionalService(ctx, "space.arrival")?.(ctx, who, to) ?? []));
  return out;
}

/**
 * The player character's party in its scene: everyone who travels with it, acts, and is with it
 * where it is now. Someone the story already took elsewhere isn't with it, so doesn't follow.
 */
export function partyAt(ctx: ReadContext, here: PlaceId | null): EntityId[] {
  const pov = ctx.world.pov;
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && id !== pov && e.relations.some((r) => r.type === PARTY_RELATION && r.to === pov) && !isGone(ctx.state, id) && acts(ctx.world, ctx.state, id) && together(ctx.world, here, placeOfEntity(ctx.state, id));
    });
}
