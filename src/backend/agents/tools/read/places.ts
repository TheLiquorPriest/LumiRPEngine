// The places tools (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): a place read whole, who and what is at a
// place now, and the way from one place to another, each read through the agent's `ToolReadView`:
//
// - `pov` reads the places the player character can see (`canSeePlace`, the resolver's own rule),
//   each path cut at the first place it can't see (`knownPlaceRefs`' rule), with the lore it may
//   read; who and what is at a place only where it stands, as Play's Scene and Place section show
//   it (anywhere else is beyond its knowledge, `TOOL_NOTE.hidden`); a leg of a route through a place
//   it can't see goes by `Somewhere`, never its name.
// - `everyone` reads every place and everyone and everything at one, a restricted place, person or
//   thing and a secret's lore marked in the user's wording.
// - `gm` reads every place, a removed person or thing too, unmarked, with each restricted one's
//   visibility and who besides the GM knows a restricted place.
//
// A place's ways out are the Place section's (`waysOut`: one route away, either way a route runs),
// each timed as Go takes it (`goMinutes`); a route is the space pack's for each way of travelling
// (`routeAt`); the things lying loose at a place are the Place section's (`placeLines`: a thing, not
// carried and not inside another), with the vehicles parked there, which Play tells in a section of
// their own; the lore about a place is Place lore's (`placeLoreLines`: each entry linking it or a
// place holding it, nearest first), World Info included; where each person is is the people tools'
// rule (`whereabouts`).

import { placeChain } from "../../../../engine/lore-pins";
import { own } from "../../../../engine/pack-kit";
import { kindIs, placeOfEntity, placeWithin } from "../../../../engine/scope";
import { waysOut } from "../../../../packs/space/core/feed";
import { placeChildren } from "../../../../packs/space/core/map-scope";
import { goMinutes, routeAt } from "../../../../packs/space/core/travel";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { PlaceId, TravelMode } from "../../../../shared/ids";
import { hasOwn, type JsonObject, type JsonValue } from "../../../../shared/json";
import { TRAVEL_MODES } from "../../../../shared/maps";
import type { ToolReadView, ViewLore, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { type Resolved, resolvePlace } from "../resolve";
import { badValue, needText, objectSchema, placeEnum, text, textArg } from "../schema";
import { beyondPov, byName, loreAbout, pathOf, type PlaceShown, placeShown, whereabouts } from "./people";

interface WayOut {
  place: ViewRef;
  /** How long Go takes there; none when the world's travel simulation finds no way to go. */
  minutes?: number;
}

interface PlaceAnswer {
  place: ViewRef;
  /** The places around it, outermost first. */
  path: ViewRef[];
  description?: string;
  /** Its other fields as the world gives them (its tags, a cash machine, a bank branch, …). */
  fields?: JsonObject;
  inside: ViewRef[];
  waysOut: WayOut[];
  /** Under `gm`: who besides the GM knows a restricted place. */
  knownTo?: string[];
  lore: ViewLore[];
}

interface PresentPerson extends ViewRef {
  place?: PlaceShown;
  doing?: string;
  life?: string;
}

interface LooseThing extends ViewRef {
  kind: string;
}

interface ContentsAnswer {
  place: ViewRef;
  people: PresentPerson[];
  /** The things lying loose at the place itself. */
  things: LooseThing[];
}

interface Leg {
  from: PlaceShown;
  to: PlaceShown;
  minutes: number;
  distanceKm: number;
}

interface Route {
  mode: TravelMode;
  minutes: number;
  distanceKm: number;
  legs: Leg[];
}

interface RouteAnswer {
  from: PlaceShown;
  to: PlaceShown;
  routes: Route[];
  /** The ways of travelling with no route there now. */
  none?: TravelMode[];
}

/** Whether a value names, by its id, someone, something or somewhere the view can't see. */
function namesUnseen(view: ToolReadView, value: JsonValue): boolean {
  if (typeof value === "string") return (hasOwn(view.state.entities, value) && !view.seesEntity(value)) || (hasOwn(view.world.places, value) && !view.seesPlace(value));
  if (Array.isArray(value)) return value.some((v) => namesUnseen(view, v));
  return value !== null && typeof value === "object" && Object.values(value).some((v) => namesUnseen(view, v));
}

/**
 * A place as the view reads it (see the header): under `everyone` a restricted place's description
 * marked as the place is; under `pov` a field naming what the player character can't see left out.
 */
function placeRead(view: ToolReadView, place: ViewRef, lore: ViewLore[]): PlaceAnswer {
  const id = place.id;
  const fields: JsonObject = own(view.world.places, id)?.fields ?? {};
  const description = typeof fields.description === "string" ? fields.description.trim() : "";
  const rest = Object.fromEntries(Object.entries(fields).filter(([field, value]) => field !== "description" && !(view.knowledge === "pov" && namesUnseen(view, value))));
  const kept = view.knowledge === "pov" ? null : view.placeSecrecy(id);
  const inside = [...(placeChildren(view.world).get(id) ?? [])].sort(byName(view)).flatMap((p): ViewRef[] => {
    const ref = view.place(p);
    return ref ? [ref] : [];
  });
  const ways = waysOut(view.ctx, id).flatMap((to): WayOut[] => {
    const ref = view.place(to);
    if (!ref) return [];
    const minutes = goMinutes(view.ctx, id, to);
    return [{ place: ref, ...(minutes !== null ? { minutes } : {}) }];
  });
  return {
    place,
    path: pathOf(view, id),
    ...(description !== "" ? { description: view.mark(description, kept) } : {}),
    ...(Object.keys(rest).length > 0 ? { fields: rest } : {}),
    inside,
    waysOut: ways,
    ...(view.knowledge === "gm" && kept ? { knownTo: [...kept.known] } : {}),
    lore,
  };
}

/**
 * The people at a place or anywhere inside it, by name, each where they are and what they are doing
 * as the view knows it (`whereabouts`); under `pov`, who is with the player character at its very
 * place, as Play's Scene lists them, the player character too.
 */
function peopleAt(view: ToolReadView, place: PlaceId, here: PlaceId | null): PresentPerson[] {
  return Object.keys(view.state.entities)
    .filter((id) => {
      if (!view.isPerson(id) || !view.seesEntity(id)) return false;
      const at = placeOfEntity(view.state, id);
      return view.knowledge === "pov" ? at !== null && at === here : placeWithin(view.world, at, place);
    })
    .sort(byName(view))
    .flatMap((id): PresentPerson[] => {
      const ref = view.entity(id);
      if (!ref) return [];
      const where = whereabouts(view, id);
      return [{ ...ref, place: where.place, doing: where.doing, life: where.life }];
    });
}

/** The things lying loose at the place itself, by name: the Place section's (an item or a kind built on one, not carried and not inside another thing), with the vehicles parked there. */
function looseAt(view: ToolReadView, place: PlaceId): LooseThing[] {
  return Object.keys(view.state.entities)
    .filter((id) => {
      const e = own(view.state.entities, id);
      return !!e && e.fields.place === place && !e.relations.some((r) => r.type === "in") && kindIs(view.registry, view.world, e.kind, "item") && view.seesEntity(id);
    })
    .sort(byName(view))
    .flatMap((id): LooseThing[] => {
      const ref = view.entity(id);
      const kind = own(view.state.entities, id)?.kind;
      return ref && kind !== undefined ? [{ ...ref, kind }] : [];
    });
}

/** Where a route starts: the place `from` names, else where the player character is; the missing-argument note when it is nowhere. */
function startOf(view: ToolReadView, args: JsonObject): Resolved {
  const here = placeOfEntity(view.state, view.pov);
  if (textArg(args, "from") === null && here !== null) return { id: here };
  const said = needText(view, ROUTE, args, "from");
  return typeof said === "string" ? resolvePlace(view, said) : { refused: said };
}

/** A route's distance as a person reads it: to the nearest ten metres, not a float's last digits. */
function km(distance: number): number {
  return Math.round(distance * 100) / 100;
}

const READ = "places_read";
const CONTENTS = "places_contents";
const ROUTE = "places_route";

export const PLACES_TOOLS: readonly ToolDefinition[] = [
  {
    name: READ,
    family: "places",
    tier: "read",
    parameters: (world) => objectSchema({ place: text(placeEnum(world)) }, ["place"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, READ, args, "place");
      if (typeof said !== "string") return said;
      const r = view.read(() => resolvePlace(view, said));
      if ("refused" in r) return r.refused;
      const lore = await loreAbout(view, placeChain(view.world, r.id), (id) => view.placeSecrecy(id));
      return view.read(() => {
        const place = view.place(r.id);
        if (!place) return view.refuse(TOOL_NOTE.noPlace, { name: said });
        return view.answer(placeRead(view, place, lore));
      });
    },
  },
  {
    name: CONTENTS,
    family: "places",
    tier: "read",
    parameters: (world) => objectSchema({ place: text(placeEnum(world)) }, ["place"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, CONTENTS, args, "place");
      if (typeof said !== "string") return said;
      return view.read(() => {
        const r = resolvePlace(view, said);
        if ("refused" in r) return r.refused;
        const place = view.place(r.id);
        if (!place) return view.refuse(TOOL_NOTE.noPlace, { name: said });
        const here = placeOfEntity(view.state, view.pov);
        // Who and what is at a place the player character isn't at or inside is beyond its knowledge; what lies loose at the place itself it sees only standing there.
        if (view.knowledge === "pov" && !placeWithin(view.world, here, r.id)) return beyondPov(view);
        const answer: ContentsAnswer = { place, people: peopleAt(view, r.id, here), things: view.knowledge === "pov" && here !== r.id ? [] : looseAt(view, r.id) };
        return view.answer(answer);
      });
    },
  },
  {
    name: ROUTE,
    family: "places",
    tier: "read",
    parameters: (world) => objectSchema({ to: text(placeEnum(world)), from: text(placeEnum(world)), mode: text(TRAVEL_MODES) }, ["to"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const toSaid = needText(view, ROUTE, args, "to");
      if (typeof toSaid !== "string") return toSaid;
      const modeSaid = textArg(args, "mode");
      return view.read(() => {
        const mode = modeSaid === null ? null : TRAVEL_MODES.find((m) => m === modeSaid);
        if (mode === undefined) return badValue(view, ROUTE, "mode", modeSaid ?? "", TRAVEL_MODES);
        const to = resolvePlace(view, toSaid);
        if ("refused" in to) return to.refused;
        const from = startOf(view, args);
        if ("refused" in from) return from.refused;
        const routes: Route[] = [];
        const none: TravelMode[] = [];
        for (const m of mode !== null ? [mode] : TRAVEL_MODES) {
          const plan = routeAt(view.ctx, from.id, to.id, m);
          if (!plan) {
            none.push(m);
            continue;
          }
          const legs = plan.legs.map((l): Leg => ({ from: placeShown(view, l.from), to: placeShown(view, l.to), minutes: l.minutes, distanceKm: km(l.distanceKm) }));
          routes.push({ mode: plan.mode, minutes: plan.minutes, distanceKm: km(plan.distanceKm), legs });
        }
        const answer: RouteAnswer = { from: placeShown(view, from.id), to: placeShown(view, to.id), routes, ...(none.length > 0 ? { none } : {}) };
        return view.answer(answer);
      });
    },
  },
];
