// The space pack's sections (DESIGN §6, §6.11): Scene's place line and nearby exits, and the Place
// section (the place's description, the things lying here, and a layout digest of the rooms inside
// and the ways out). Each by scope: the POV's knowledge, then, marked, what the people with it know
// or plainly see (`scene`) and everything (`gm`). Place lore comes into the Place section from a
// renderer of source `place_lore` that the lore owner registers on the `place` slot.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { FeedScope } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";
import { accessOf, mayUse, owns } from "../../../engine/access";
import { together } from "../../../engine/presence";
import type { FeedLine, ReadContext } from "../../../engine/registry";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { canSeeEntity, canSeePlace, HIDDEN_PLACE_NAME, povPlace } from "../../../engine/visibility";
import { routeAt } from "./travel";

/** At most this many things lying here are named, the rest counted. */
const THINGS_CAP = 12;

/** At most this many nearby exits, rooms inside or ways out are named. */
const EXITS_CAP = 6;

/** The people with the POV that it can see, by id: whose knowledge the `scene` scope adds. */
function companions(ctx: ReadContext): EntityId[] {
  const pov = ctx.world.pov;
  const here = placeOfEntity(ctx.state, pov);
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && id !== pov && kindIs(ctx.registry, ctx.world, e.kind, "person") && !isGone(ctx.state, id) && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id) && together(ctx.world, here, placeOfEntity(ctx.state, id));
    });
}

const nameOf = (ctx: ReadContext, id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
const placeName = (ctx: ReadContext, id: PlaceId): string => own(ctx.world.places, id)?.name ?? id;

/**
 * Whose knowledge a fact the POV doesn't have is in a scope: the people with it who have it
 * (`scene`), else no one's there (`gm`, only in the GM scope); null when the scope leaves it out.
 */
function beyond(ctx: ReadContext, scope: FeedScope, text: string, knows: (who: EntityId) => boolean): FeedLine | null {
  if (scope === "player") return null;
  const who = companions(ctx).filter(knows);
  if (who.length > 0) return { text, known: "scene", who: who.map((id) => nameOf(ctx, id)).join(", ") };
  return scope === "gm" ? { text, known: "gm" } : null;
}

/** Scene's place lines: where the POV is (in what, when it can see that), and from Space 2 the places a short walk away. */
export function sceneLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "space");
  if (level === 0) return [];
  const here = placeOfEntity(ctx.state, pov);
  const place = here ? own(ctx.world.places, here) : undefined;
  if (!here || !place) return [];
  // The narrator hears where the POV is as every player surface names it (`povPlace`), and of
  // the place around it only when the POV can see that too.
  const sees = (who: EntityId, id: PlaceId): boolean => canSeePlace(ctx.registry, ctx.world, ctx.state, who, id);
  const parent = place.parent && sees(pov, place.parent) ? placeName(ctx, place.parent) : undefined;
  const lines: FeedLine[] = [{ text: `Place: ${povPlace(ctx.registry, ctx.world, ctx.state)?.name ?? HIDDEN_PLACE_NAME}${parent ? ` (in ${parent})` : ""}.`, known: "pov" }];
  if (place.parent && !parent) {
    const outer = place.parent;
    const line = beyond(ctx, scope, `This place is in ${placeName(ctx, outer)}.`, (who) => sees(who, outer));
    if (line) lines.push(line);
  }
  if (level >= 2) {
    const exits: string[] = [];
    const hidden: { id: PlaceId; text: string }[] = [];
    for (const id of Object.keys(ctx.world.places).sort()) {
      if (id === here) continue;
      const plan = routeAt(ctx, here, id, "walk");
      if (!plan || plan.legs.length !== 1) continue;
      const text = `${placeName(ctx, id)} ${plan.minutes} min on foot`;
      // The narrator hears only of exits to places the POV knows, unless the scope asks for more.
      if (sees(pov, id)) exits.push(text);
      else hidden.push({ id, text });
    }
    if (exits.length > 0) lines.push({ text: `Nearby: ${exits.slice(0, EXITS_CAP).join("; ")}.`, known: "pov" });
    for (const h of hidden) {
      const line = beyond(ctx, scope, `Nearby: ${h.text}.`, (who) => sees(who, h.id));
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** The ways out of a place: the places one route away, either way a route runs. */
function waysOut(ctx: ReadContext, here: PlaceId): PlaceId[] {
  const out = new Set<PlaceId>();
  for (const r of Object.values(ctx.world.routes)) {
    if (r.from === here) out.add(r.to);
    else if (r.to === here && r.bidirectional) out.add(r.from);
  }
  return [...out].sort();
}

/**
 * The Place section: the place's description; the things lying here the POV can see (only things,
 * an item or a kind built on one, never a business, a bill, a job or a group, and not vehicles,
 * which have their own section, nor anything inside something else), each
 * with whose it is as the POV may know (`engine/access`): its own, another's, or lent to it to use;
 * and a layout digest, the rooms inside it and the ways out. A place the POV can't see (it stands
 * in a secret one) gives its description only in `gm` scope, under its real name. In `scene` and
 * `gm` scopes, a thing here or a way out the POV can't see, marked; in `gm`, also who is next door.
 */
export function placeLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "space") === 0) return [];
  const here = placeOfEntity(ctx.state, pov);
  const place = here ? own(ctx.world.places, here) : undefined;
  if (!here || !place) return [];
  const seeThing = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
  const seePlace = (who: EntityId, id: PlaceId): boolean => canSeePlace(ctx.registry, ctx.world, ctx.state, who, id);
  const lines: FeedLine[] = [];
  const description = place.fields.description;
  if (typeof description === "string" && description.trim() !== "") {
    // Told as the POV knows the place: one it can't see is never described on its player lines.
    const shown = povPlace(ctx.registry, ctx.world, ctx.state);
    if (shown?.id) lines.push({ text: `${shown.name}: ${description.trim()}`, known: "pov" });
    else if (scope === "gm") lines.push({ text: `${place.name}: ${description.trim()}`, known: "gm" });
  }
  const things = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id) || e.fields.place !== here || e.relations.some((r) => r.type === "in")) return false;
      // Only a thing lies anywhere (an item or a kind built on one): a business, a bill or a job given a place is no object on the floor (DESIGN §6.11). Vehicles have their own section.
      return kindIs(ctx.registry, ctx.world, e.kind, "item") && !kindIs(ctx.registry, ctx.world, e.kind, "vehicle");
    });
  const seen = things.filter((id) => seeThing(pov, id));
  // Whose a thing is, as the POV may know: its own, one it may use by a grant, or another's it can see.
  const whose = (id: EntityId): string => {
    if (owns(ctx.state, pov, id)) return " (yours)";
    if (mayUse(ctx.state, pov, id)) return " (yours to use)";
    const owner = accessOf(ctx.state, id).owners.map((o) => o.party).find((p) => seeThing(pov, p));
    return owner ? ` (${nameOf(ctx, owner)}'s)` : "";
  };
  if (seen.length > 0) lines.push({ text: `Lying here: ${seen.slice(0, THINGS_CAP).map((id) => `${nameOf(ctx, id)}${whose(id)}`).join(", ")}${seen.length > THINGS_CAP ? `, and ${seen.length - THINGS_CAP} more` : ""}.`, known: "pov" });
  for (const id of things.filter((t) => !seeThing(pov, t))) {
    const line = beyond(ctx, scope, `Lying here: ${nameOf(ctx, id)}.`, (who) => seeThing(who, id));
    if (line) lines.push(line);
  }
  const inside = Object.values(ctx.world.places)
    .filter((p) => p.parent === here)
    .map((p) => p.id)
    .sort();
  const insideSeen = inside.filter((id) => seePlace(pov, id));
  if (insideSeen.length > 0) lines.push({ text: `Places inside it: ${insideSeen.slice(0, EXITS_CAP).map((id) => placeName(ctx, id)).join(", ")}.`, known: "pov" });
  const ways = waysOut(ctx, here);
  const waysSeen = ways.filter((id) => seePlace(pov, id));
  if (waysSeen.length > 0) lines.push({ text: `Ways out from here, to: ${waysSeen.slice(0, EXITS_CAP).map((id) => placeName(ctx, id)).join(", ")}.`, known: "pov" });
  for (const id of [...inside, ...ways].filter((p) => !seePlace(pov, p))) {
    const line = beyond(ctx, scope, `A way from here leads to ${placeName(ctx, id)}.`, (who) => seePlace(who, id));
    if (line) lines.push(line);
  }
  if (scope === "gm") {
    // Who is in the rooms next door: nothing the POV or anyone with it can see from here.
    for (const id of [...inside, ...ways]) {
      const there = Object.keys(ctx.state.entities)
        .sort()
        .filter((p) => {
          const e = own(ctx.state.entities, p);
          return !!e && p !== pov && kindIs(ctx.registry, ctx.world, e.kind, "person") && !isGone(ctx.state, p) && placeOfEntity(ctx.state, p) === id;
        });
      if (there.length > 0) lines.push({ text: `${inside.includes(id) ? `In ${placeName(ctx, id)}, inside this place` : `At ${placeName(ctx, id)}, one of the ways out`}: ${there.map((p) => nameOf(ctx, p)).join(", ")}.`, known: "gm" });
    }
  }
  return lines;
}
