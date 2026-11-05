// The space pack's sections (DESIGN §6, §6.11): Scene's place line and nearby exits, and the Place
// section (the place's description, whose place it is when the POV knows them, a layout digest of
// every room inside and every way out, and what is here: the furnishings, the things lying loose and
// what is in the holders the POV may use, ITEMS-SPEC §5.5), with whether the POV is there without
// leave (ORG-SPEC §3.9, §3.15) as a source of its own. Each by scope: the POV's knowledge, then,
// marked, what the people with it know or plainly see (`scene`) and everything (`gm`). Place lore
// comes into the Place section from a renderer of source `place_lore` that the lore owner registers
// on the `place` slot.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { FeedScope } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";
import { accessFor } from "../../../engine/access";
import { placeOwnersOf, withoutLeave } from "../../../engine/entry";
import { together } from "../../../engine/presence";
import { readPass } from "../../../engine/read-pass";
import type { FeedLine, ReadContext } from "../../../engine/registry";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { thingIndex } from "../../../engine/thing-index";
import { contentsOf, holdsOf, presumedAt, sizeOf, whoseOf } from "../../../engine/things";
import { sentence, thingName, thingText, whoseWords } from "../../../engine/thing-words";
import { canSeeEntity, canSeePlace, HIDDEN_PLACE_NAME, povPlace } from "../../../engine/visibility";
import { listWords, possessive } from "../../../shared/words";
import { routeAt } from "./travel";

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
    if (exits.length > 0) lines.push({ text: `Nearby: ${exits.join("; ")}.`, known: "pov" });
    for (const h of hidden) {
      const line = beyond(ctx, scope, `Nearby: ${h.text}.`, (who) => sees(who, h.id));
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** The ways out of a place: the places one route away, either way a route runs. */
export function waysOut(ctx: ReadContext, here: PlaceId): PlaceId[] {
  const out = new Set<PlaceId>();
  for (const r of Object.values(ctx.world.routes)) {
    if (r.from === here) out.add(r.to);
    else if (r.to === here && r.bidirectional) out.add(r.from);
  }
  return [...out].sort();
}

/**
 * The Place section (DESIGN §6.11; ITEMS-SPEC §5.5): the place's description; whose place it is,
 * when the POV knows them all (ORG-SPEC §3.15); a layout digest, every room inside it and every way
 * out; then what is here that the POV can see (only things, an item or a kind built on one, never a
 * business, a bill, a job or a group, and not vehicles, which have
 * their own section): the furnishings and fittings (`In the room`, Furniture and Built-in things,
 * those that are only a name together by whose they are, the rest a line each), every other thing
 * lying loose a line each (`Lying here`), and what is in each holder here the POV may use (`In the
 * fridge`). Each thing is named with whose it is as the POV may know (`whoseWords`: yours, someone
 * else's, a presumed owner told alike; with "yours to use" for one lent to them) and its details
 * as the POV may see them (`thingText`: a count, its kind's fields, its description); a holder's
 * contents say whose only where it isn't the holder's. The layout goes first and the holders'
 * contents last, so a section trimmed to its budget keeps the layout and cuts the contents first.
 * A place the POV can't see (it stands in a secret one) gives its description only in `gm` scope,
 * under its real name. In `scene` and `gm` scopes, a thing here or a way out the POV can't see,
 * marked; in `gm`, also who is next door.
 */
export function placeLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "space") === 0) return [];
  const here = placeOfEntity(ctx.state, pov);
  const place = here ? own(ctx.world.places, here) : undefined;
  if (!here || !place) return [];
  return readPass(() => {
    const seeThing = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
    const seePlace = (who: EntityId, id: PlaceId): boolean => canSeePlace(ctx.registry, ctx.world, ctx.state, who, id);
    const lines: FeedLine[] = [];
    const description = place.fields.description;
    // Told as the POV knows the place: one it can't see is never described on its player lines.
    const shown = povPlace(ctx.registry, ctx.world, ctx.state);
    if (typeof description === "string" && description.trim() !== "") {
      if (shown?.id) lines.push({ text: `${shown.name}: ${description.trim()}`, known: "pov" });
      else if (scope === "gm") lines.push({ text: `${place.name}: ${description.trim()}`, known: "gm" });
    }
    // Whose it is, when the POV knows them all and isn't one of them: never a business by its own name.
    const owners = placeOwnersOf(ctx, here);
    const ownerNames = owners.map((o) => nameOf(ctx, o));
    if (shown?.id && owners.length > 0 && !owners.includes(pov) && owners.every((o) => seeThing(pov, o)) && !(ownerNames.length === 1 && ownerNames[0] === place.name)) lines.push({ text: `${shown.name} is ${possessive(listWords(ownerNames))}.`, known: "pov" });
    const inside = Object.values(ctx.world.places)
      .filter((p) => p.parent === here)
      .map((p) => p.id)
      .sort();
    const insideSeen = inside.filter((id) => seePlace(pov, id));
    if (insideSeen.length > 0) lines.push({ text: `Places inside it: ${insideSeen.map((id) => placeName(ctx, id)).join(", ")}.`, known: "pov" });
    const ways = waysOut(ctx, here);
    const waysSeen = ways.filter((id) => seePlace(pov, id));
    if (waysSeen.length > 0) lines.push({ text: `Ways out from here, to: ${waysSeen.map((id) => placeName(ctx, id)).join(", ")}.`, known: "pov" });
    // Only a thing lies anywhere (an item or a kind built on one): a business, a bill or a job given a place is no object on the floor (DESIGN §6.11). Vehicles have their own section.
    const things = (thingIndex(ctx).loose.get(here) ?? []).filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && !isGone(ctx.state, id) && !kindIs(ctx.registry, ctx.world, e.kind, "vehicle");
    });
    const fixture = (id: EntityId): boolean => {
      const size = sizeOf(ctx, id).size;
      return size === "furniture" || size === "builtin";
    };
    // Whose a thing is, as the POV may know, and that it is theirs to use when someone lent it to them.
    const whose = (id: EntityId): string[] => {
      const words = whoseWords(ctx, id);
      const lent = words !== "yours" && accessFor(ctx, pov, id).use?.basis === "grant";
      return [...(words !== null ? [words] : []), ...(lent ? ["yours to use"] : [])];
    };
    const seen = things.filter((id) => seeThing(pov, id));
    const furnishings = seen.filter(fixture);
    // Furnishings that are only a name go together, by whose they are; one with more to tell has its own line.
    const bare = furnishings.filter((id) => thingText(ctx, id) === thingName(ctx, id));
    const groups = new Map<string, EntityId[]>();
    for (const id of bare) {
      const key = whose(id).join("; ");
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    if (groups.size > 0) lines.push({ text: `In the room: ${[...groups].map(([key, ids]) => `${ids.map((id) => thingName(ctx, id)).join(", ")}${key !== "" ? ` (${key})` : ""}`).join("; ")}.`, known: "pov" });
    for (const id of furnishings.filter((f) => !bare.includes(f))) lines.push({ text: sentence(`In the room: ${thingText(ctx, id, whose(id))}`), known: "pov" });
    for (const id of seen.filter((t) => !fixture(t))) lines.push({ text: sentence(`Lying here: ${thingText(ctx, id, whose(id))}`), known: "pov" });
    // The vehicles parked here the POV can see, by name and whose (the Vehicles section tells the rest of each).
    const parked = (thingIndex(ctx).loose.get(here) ?? []).filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, e.kind, "vehicle") && seeThing(pov, id);
    });
    if (parked.length > 0) lines.push({ text: `Parked here: ${parked.map((id) => thingName(ctx, id, undefined, whose(id))).join(", ")}.`, known: "pov" });
    // What is in each holder here the POV may use (the fridge, a parts bin): its contents by name, whose only where it isn't the holder's.
    const ownersOf = (id: EntityId): string => [...whoseOf(ctx, id).owners].sort().join(" ");
    const holders = seen.filter((id) => holdsOf(ctx, id) !== null && accessFor(ctx, pov, id).use !== null);
    const hiddenInside: { holder: EntityId; id: EntityId }[] = [];
    for (const holder of holders) {
      const contents = contentsOf(ctx.state, holder).filter((id) => own(ctx.state.entities, id)?.kind !== "account" && !isGone(ctx.state, id));
      const shown = contents.filter((id) => seeThing(pov, id));
      for (const id of contents.filter((c) => !seeThing(pov, c))) hiddenInside.push({ holder, id });
      if (shown.length === 0) continue;
      const named = shown.map((id) => {
        const words = ownersOf(id) === ownersOf(holder) ? null : whoseWords(ctx, id);
        return thingName(ctx, id, undefined, words !== null ? [words] : []);
      });
      lines.push({ text: `In ${nameOf(ctx, holder)}: ${named.join(", ")}.`, known: "pov" });
    }
    for (const id of things.filter((t) => !seeThing(pov, t))) {
      const line = beyond(ctx, scope, `${fixture(id) ? "In the room" : "Lying here"}: ${nameOf(ctx, id)}.`, (who) => seeThing(who, id));
      if (line) lines.push(line);
    }
    for (const { holder, id } of hiddenInside) {
      const line = beyond(ctx, scope, `In ${nameOf(ctx, holder)}: ${nameOf(ctx, id)}.`, (who) => seeThing(who, id));
      if (line) lines.push(line);
    }
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
  });
}

/**
 * Whether the POV is where it is without leave (ORG-SPEC §3.9, §3.15): no basis of its own to be
 * there and nobody there who may enter. A home reads as its people's house ("You're in Marcus
 * Delgado's house without leave"), any other place by its name, and a place the POV can't see, or
 * whose owners it doesn't know, says only that it is here without leave.
 */
export function trespassLines(ctx: ReadContext, _scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "space") === 0) return [];
  const here = placeOfEntity(ctx.state, pov);
  if (!here || !own(ctx.world.places, here)) return [];
  return readPass(() => {
    if (!withoutLeave(ctx, pov, here)) return [];
    const shown = povPlace(ctx.registry, ctx.world, ctx.state);
    const owners = placeOwnersOf(ctx, here);
    const known = owners.length > 0 && owners.every((o) => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, o));
    const home = ["household", "property", "residents"].includes(presumedAt(ctx, here).presumed ?? "");
    const where = !shown?.id ? "here" : home && known ? `in ${possessive(listWords(owners.map((o) => nameOf(ctx, o))))} house` : `in ${shown.name}`;
    return [{ text: `You're ${where} without leave.`, known: "pov" }];
  });
}
