// The one move path (DESIGN §4.1, §9.4): every writer of where someone is (the `move` effect, the
// reply's moves, driving, routines, schedules, trips, skip plans, GM and ✎ edits) asks here for the
// events of a move, so they all leave the same state: out of whatever holds them (`in`), `place`
// set, and where they then stand (the space pack's arrival cell, from Space 3), with the event
// shapes rules and replay read (`unlink`, `set place`, `space.pos`). A narrated move also leaves its
// old activity behind, and lands by any route or none. The player character's party (people who
// `travels_with` it) comes along when the move says so.

import type { EntityId, PlaceId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import { PARTY_RELATION } from "../shared/party";
import { acts } from "./life";
import { optionalService, own } from "./pack-kit";
import { together } from "./presence";
import type { ReadContext, Rejection } from "./registry";
import { isGone, placeOfEntity } from "./scope";

export interface RelocateOptions {
  /**
   * A narrated move (the reply's, or ✎): it lands whether or not a route joins the places, and its
   * activity rule holds: to another place, their activity becomes `activity`, else `idle`, so what
   * they did where they were stays behind; where they already are, a stated `activity` still applies.
   */
  told?: boolean;
  /** The activity a narrated move states. */
  activity?: string;
  /** The player character's party follows it there (a move the player character makes). */
  party?: boolean;
  /** Someone coming along with another mover (a Go companion, a rider): what they did stays behind. */
  along?: boolean;
  /**
   * People the same read or edit already sent somewhere other than where the player character is
   * (its flat inside the building it stands in): still `together` with it, but the story put them
   * there, so the party doesn't take them along.
   */
  stayed?: ReadonlySet<EntityId>;
}

/**
 * The events that move `who` to `to`, or why it can't happen. `to` must be a place of the world and
 * `who` someone in it: callers check what their own refusal says.
 */
export function relocate(ctx: ReadContext, who: EntityId, to: PlaceId, opts: RelocateOptions = {}): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, who);
  if (!e) return { code: "missing_entity", reason: `no entity ${who}` };
  const from = placeOfEntity(ctx.state, who);
  const next = opts.told ? (from !== to ? (opts.activity ?? "idle") : opts.activity) : opts.along && from !== to ? "idle" : undefined;
  // A move to where they already are still takes them out of what holds them and onto their cell.
  const out = moveEvents(ctx, who, to);
  out.push(...activityEvents(ctx, who, next));
  // The party comes along only on a move that goes somewhere: a "move" to where the player
  // character already is (✎ Place, the GM's Move, a narrated move that stays) leaves them be.
  if (opts.party && who === ctx.world.pov && from !== to) {
    for (const member of partyAt(ctx, from)) {
      if (opts.stayed?.has(member) || placeOfEntity(ctx.state, member) === to) continue;
      out.push(...moveEvents(ctx, member, to), ...activityEvents(ctx, member, "idle"));
    }
  }
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

/** Their activity set to `next`, for someone who has one and isn't doing it already. */
function activityEvents(ctx: ReadContext, who: EntityId, next: string | undefined): LedgerEvent[] {
  const doing = own(ctx.state.entities, who)?.fields.activity;
  return next !== undefined && doing !== undefined && doing !== next ? [{ type: "set", entity: who, field: "activity", value: next }] : [];
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

/**
 * Who the events so far of one read or edit (a Working's) left somewhere other than `here`, by the
 * last place each was given: the people the party mustn't take along from `here`.
 */
export function movedElsewhere(events: readonly LedgerEvent[], here: PlaceId | null): Set<EntityId> {
  const last = new Map<EntityId, unknown>();
  for (const ev of events) if (ev.type === "set" && ev.field === "place") last.set(ev.entity, ev.value);
  return new Set([...last].filter(([, place]) => place !== here).map(([id]) => id));
}
