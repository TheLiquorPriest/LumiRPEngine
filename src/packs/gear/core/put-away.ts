// The put-away process (ITEMS-SPEC §4.3, `gear.put_away`): off screen, a thing an NPC owns, or their
// household does, left lying loose away from where it is kept goes back there once the story has
// left it alone for the world's hours and the player character can't see it (`putAway`, Build →
// Packs → gear). How long it has been left alone is read from what the state keeps: the latest of
// the player character's last visit to where it lies (`space.seen`, a visit to a place inside it
// counting), the last change of who has it (`got.at`) and the chat's start. Never the player
// character's own things, nor a household's they belong to; never one someone may use by a grant
// (lent, held for its owner, assigned), one lost, gone or in two places at once; only what a person
// can carry (`fitsOn`), so never a furnishing, a part or a vehicle. Each goes back by an item op, on
// what the ones before it left, recorded as the process's. Pure.

import { ownersIn } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import { gotOf, thingsConfigOf, type Spot } from "../../../shared/things";
import { orgTypeOf, ownsThrough } from "../../../engine/org";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { rulesetFloor } from "../../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { placeVisit } from "../../../engine/seen";
import { applyItemOp } from "../../../engine/thing-ops";
import { thingIndex } from "../../../engine/thing-index";
import { restOf } from "../../../engine/things";
import { Working } from "../../../engine/working";
import { minutesBetween } from "../../../engine/world-state";
import { fitsOn, grants } from "./model";

/** What a put-away move says it was for (`got.why` where one is written). */
const WHY = "Put away";

/**
 * The events of every thing the put-away process takes back to its rest at the end of a slot
 * (`end`), in place and id order, each move on what the ones before it left; none while the
 * process is off, or the world's Gear level is under the one it runs from.
 */
export function putAwayEvents(ctx: ReadContext, end: number): LedgerEvent[] {
  const config = thingsConfigOf(ctx.world).putAway;
  if (!config.on || rulesetFloor(ctx.world, "gear", ctx.state.realism.levels.gear ?? 0) < config.minLevel) return [];
  const pov = ctx.world.pov;
  const here = placeOfEntity(ctx.state, pov);
  const started = minutesBetween(ctx.world.calendar.epoch, ctx.world.start.at);
  const left = end - config.hours * 60;
  const granted = new Set(grants(ctx.state).map((g) => g.thing));
  const person = (id: EntityId): boolean => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person");
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  for (const [place, ids] of [...thingIndex(ctx).loose].sort(([a], [b]) => a.localeCompare(b))) {
    // In the player character's sight: what lies where they are.
    if (place === here) continue;
    const seen = placeVisit(ctx.state, place)?.last ?? Number.NEGATIVE_INFINITY;
    for (const id of ids) {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id) || e.fields.lost === true || granted.has(id) || !fitsOn(ctx, id)) continue;
      const owners = [...new Set(ownersIn(e.fields).map((o) => o.party))];
      if (owners.length === 0 || owners.some((o) => ownsThrough(ctx, pov, o))) continue;
      const npc = owners.find((o) => person(o));
      if (npc === undefined && !owners.some((o) => orgTypeOf(ctx, o) === "household")) continue;
      // Left alone long enough: since it was last seen there, last changed hands, or the chat began.
      if (Math.max(started, seen, gotOf(e.fields.got)?.at ?? Number.NEGATIVE_INFINITY) > left) continue;
      const { rest } = restOf(ctx, id);
      const to: Spot | null = rest === "owner" ? (npc !== undefined ? { in: npc } : null) : rest;
      if (to === null || ("place" in to && to.place === place)) continue;
      const mark = w.mark();
      const done = applyItemOp(w, { do: "move", item: id, to, why: WHY }, { by: npc ?? owners[0] ?? pov, confirmed: false, gm: false, salt: `put_away:${id}:${end}`, viewer: pov });
      if ("code" in done) w.restore(mark);
    }
  }
  return [...w.events];
}
