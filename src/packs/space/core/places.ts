// Places made in play (ITEMS-SPEC §6.2), the space pack's: the `space.place` event, which writes one
// whole into the pack's slice or takes it away; the `place_make` change, a fact that puts someone at
// a place the world lacks, made first unless one under the same parent answers, both as one unit;
// and the `space.make_place` effect it applies through. The places themselves, the overlay every
// reader sees them through and the place ops are `engine/places-in-play`.

import { hasOwn, isRecord, safeKey, type JsonObject, type JsonValue } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import { applyEffects } from "../../../engine/effects";
import { labelOf, mutableSlice, own, strOf } from "../../../engine/pack-kit";
import { baseWorld, madePlaceData, madePlacesOf, PLACE_EVENT, placeFactEntity, placeOp, settlePlaceFact } from "../../../engine/places-in-play";
import type { EffectDef, EventTypeDef, ProposalChannelDef, Rejection } from "../../../engine/registry";
import { placeWithin } from "../../../engine/scope";
import { canSeePlace } from "../../../engine/visibility";
import { Working } from "../../../engine/working";

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A made place written whole (`def`) or taken away (`gone`); the world's own places are Build's, never an event's. */
export const placeEventDef: EventTypeDef<PackEvent> = {
  type: PLACE_EVENT,
  validate(e, ctx) {
    const place = strOf(e.data.place);
    if (place === "" || !safeKey(place)) return reject("bad_place", "a place needs an id");
    if (hasOwn(baseWorld(ctx.world).places, place)) return reject("not_made", `${labelOf(ctx, place)} is the world's own place`);
    if (e.data.gone === true) return hasOwn(madePlacesOf(ctx.state), place) ? null : reject("gone", `no place ${labelOf(ctx, place)}`);
    const def = madePlaceData(e.data.def, place);
    if (!def) return reject("bad_place", "that isn't a place");
    if (!own(ctx.world.places, def.parent)) return reject("missing_place", `no place ${labelOf(ctx, def.parent)}`);
    if (def.parent === place || placeWithin(ctx.world, def.parent, place)) return reject("bad_parent", "a place can't be inside itself");
    return null;
  },
  // The record is replaced, never changed in place: its identity is what every played world is kept by.
  apply(e, state) {
    const place = strOf(e.data.place);
    const slice = mutableSlice(state, "space");
    const next: JsonObject = { ...(isRecord(slice.places) ? slice.places : {}) };
    if (e.data.gone === true) delete next[place];
    else if (isRecord(e.data.def)) next[place] = structuredClone(e.data.def);
    slice.places = next;
  },
  // A player's line names a place as the POV may know it: one it can see, else nothing.
  describe(e, ctx, viewer) {
    const place = strOf(e.data.place);
    const def = madePlaceData(e.data.def, place) ?? own(madePlacesOf(ctx.state), place);
    if (viewer !== undefined && (!def || !canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, def.parent))) return "";
    const name = def?.name ?? labelOf(ctx, place);
    if (e.data.gone === true) return `Place removed: ${name}`;
    return def ? `Place: ${name}, in ${labelOf(ctx, def.parent)}` : `Place: ${name}`;
  },
};

/** The proposal as the effect carries it: one string, so no word of the story's reads as a formula or a binding. */
function factOf(raw: JsonValue | undefined): JsonObject | null {
  if (typeof raw !== "string") return null;
  try {
    const p: unknown = JSON.parse(raw);
    return isRecord(p) ? (p as JsonObject) : null;
  } catch {
    return null;
  }
}

/**
 * A place fact applied (`{place, parent, as?, aliases?, description?, why?, entity?, activity?, by?}`):
 * the place made, unless the story found one under its parent, then whoever it puts there moved in,
 * as a told move (the `move` effect, so the party comes along and their activity goes back to idle
 * unless the fact says what they do there). All of it one unit.
 */
export const makePlaceEffect: EffectDef = {
  type: "space.make_place",
  args: ["change"],
  resolve(a, ctx) {
    const p = factOf(a.change);
    if (!p) return reject("bad_proposal", "the change isn't one");
    const w = new Working(ctx.registry, ctx.world, ctx.state);
    const settled = settlePlaceFact(w.ctx, p);
    if (settled.kind === "refused") return settled.rejection;
    let place = settled.kind === "found" ? settled.place : "";
    if (settled.kind === "make") {
      const out = placeOp(w.ctx, settled.op, { by: strOf(p.by) || "story", salt: ctx.rng.seed });
      if ("code" in out) {
        if (out.code !== "exists" || out.exists === undefined) return out;
        place = out.exists;
      } else {
        for (const e of out.events) {
          const failed = w.apply(e);
          if (failed) return failed;
        }
        place = out.made ?? place;
      }
    }
    const who = placeFactEntity(p);
    if (who !== null) {
      const activity = typeof p.activity === "string" && p.activity.trim() !== "" ? p.activity.trim() : null;
      const moved = applyEffects(ctx.registry, w, [{ type: "move", args: { entity: who, to: place, told: true, ...(activity !== null ? { activity } : {}) } }], { bindings: {}, rng: ctx.rng, literal: true });
      const failed = moved.rejected[0];
      if (failed) return failed.rejection;
    }
    if (w.events.length === 0) return reject("no_change", `${labelOf(w.ctx, place)} is there already`);
    return [...w.events];
  },
};

/**
 * A place fact (ITEMS-SPEC §5.2, §6.2): the read's `location` to a place the world lacks, settled
 * (`runtime`), or the Curator's own. It holds while it still lands: its parent is there, and the
 * place is found or can be made (the per-chat cap, a name).
 */
export const placeMakeChannel: ProposalChannelDef = {
  type: "place_make",
  boundField: "ref",
  validate(p, ctx) {
    const settled = settlePlaceFact(ctx, p);
    if (settled.kind === "refused") return settled.rejection;
    const who = placeFactEntity(p);
    if (who !== null && !own(ctx.state.entities, who)) return reject("missing_entity", `no entity ${labelOf(ctx, who)}`);
    if (settled.kind === "found") return who === null ? reject("no_change", `${labelOf(ctx, settled.place)} is there already`) : null;
    const out = placeOp(ctx, settled.op, { by: strOf(p.by) || "story", salt: "check" });
    return "code" in out && out.code !== "exists" ? out : null;
  },
  toEffects: (p) => [{ type: "space.make_place", args: { change: JSON.stringify(p) } }],
};
