// Space & travel pack (DESIGN §9.3): places, routes with travel modes (walk, road, off-road, water),
// distances, terrain, grids, positions and tracking. It also owns the base kinds every other pack
// builds on: `thing` (anything with a place and an owner) and `person`, whose fields carry each
// domain's level contract.
//
// Level contract (domain `space`):
//   0  off: no movement rules (moves are free and instant)
//   1  named places: moves need no route and take a nominal 15 minutes
//   2  places plus routes and travel times: walking needs a route (or shared parent)
//   3  grids and positions (`x`, `y` on the place's grid; A* with caps)
//   4  terrain multipliers and weather effects on travel; mode-specific routes

import type { JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId, TravelMode } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import type { KindDef } from "../../../shared/world";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { placeOfEntity, placeWithin } from "../../../engine/scope";
import type { PackEvent } from "../../../shared/ledger";
import { labelOf, sliceRecord, strOf, own } from "../../../engine/pack-kit";
import { closedRoutes, findPath, gridMinutes, nominalRoute, routeAt, type TravelPlan } from "./travel";
import { buildMapView } from "./view";

export type TravelService = (ctx: ReadContext, entity: EntityId, to: PlaceId, mode: TravelMode) => { plan: TravelPlan; events: LedgerEvent[] } | Rejection;
export type RouteQuery = (ctx: ReadContext, from: PlaceId, to: PlaceId, mode: TravelMode) => TravelPlan | null;

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Moves an entity to a place by a mode: the plan (minutes, distance, legs) and the move events. */
    "space.travel": TravelService;
  }
  interface QueryMap {
    /** The fastest route for a mode at the current Space level (terrain and weather from level 4). */
    "space.route": RouteQuery;
    /** Whether `to` can be reached from `from` by any one travel mode (always below Space 2). */
    "space.reachable": (ctx: ReadContext, from: PlaceId, to: PlaceId) => boolean;
  }
}

const MODES: readonly TravelMode[] = ["walk", "road", "offroad", "water"];

/** Whether `to` can be reached from `from` by any one travel mode; below Space 2 movement is nominal, so always. */
export function reachable(ctx: ReadContext, from: PlaceId, to: PlaceId): boolean {
  if (from === to || ctx.levelOf(ctx.world.pov, "space") < 2) return true;
  return MODES.some((m) => routeAt(ctx, from, to, m) !== null);
}

export const THING: KindDef = {
  id: "thing",
  label: "Thing",
  pack: "space",
  fields: {
    place: { type: "ref", label: "Place", domain: "space", level: 1 },
    x: { type: "number", label: "Grid x", domain: "space", level: 3 },
    y: { type: "number", label: "Grid y", domain: "space", level: 3 },
    owner: { type: "ref", label: "Owner" },
  },
};

export const PERSON: KindDef = {
  id: "person",
  label: "Person",
  extends: "thing",
  pack: "space",
  fields: {
    home: { type: "ref", label: "Home", domain: "space", level: 1 },
    activity: { type: "text", label: "Activity", default: "idle", domain: "castlife", level: 1 },
    activity_until: { type: "number", label: "Activity ends", domain: "castlife", level: 1, locked: true },
    scene: { type: "text", label: "Scene type" },
    wealth: { type: "text", label: "Wealth", domain: "money", level: 1 },
    occupation: { type: "text", label: "Occupation", domain: "money", level: 3, table: "economy.occupations" },
    region: { type: "text", label: "Region", domain: "money", level: 3, table: "economy.regions" },
    employer: { type: "ref", label: "Employer", domain: "money", level: 3 },
    might: { type: "number", label: "Might", min: 3, max: 18, domain: "sheets", level: 1 },
    agility: { type: "number", label: "Agility", min: 3, max: 18, domain: "sheets", level: 1 },
    wits: { type: "number", label: "Wits", min: 3, max: 18, domain: "sheets", level: 1 },
    charm: { type: "number", label: "Charm", min: 3, max: 18, domain: "sheets", level: 1 },
    grit: { type: "number", label: "Grit", min: 3, max: 18, domain: "sheets", level: 1 },
    conditions: { type: "list", label: "Conditions", domain: "sheets", level: 4 },
    needs: { type: "list", label: "Needs", domain: "castlife", level: 4, locked: true },
    appointments: { type: "list", label: "Appointments", domain: "castlife", level: 2 },
    trips: { type: "list", label: "Trips", domain: "castlife", level: 1 },
    chores: { type: "list", label: "Chores", domain: "castlife", level: 3 },
  },
};

function asMode(v: unknown): TravelMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v) ? (v as TravelMode) : "walk";
}


const travel: TravelService = (ctx, entity, to, mode) => {
  const e = own(ctx.state.entities, entity);
  if (!e) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, entity)}` };
  if (!own(ctx.world.places, to)) return { code: "missing_place", reason: `no place ${labelOf(ctx, to)}` };
  const from = placeOfEntity(ctx.state, entity);
  const plan = from ? routeAt(ctx, from, to, mode) : nominalRoute(ctx, to, to, mode);
  if (!plan) return { code: "no_route", reason: `no ${mode} route to ${labelOf(ctx, to)}` };
  const events: LedgerEvent[] = [];
  for (const r of e.relations) if (r.type === "in") events.push({ type: "unlink", rel: "in", from: entity, to: r.to });
  events.push({ type: "set", entity, field: "place", value: to });
  return { plan, events };
};

export const spacePack: PackDef = {
  id: "space",
  label: "Space & travel",
  version: 1,
  domain: "space",
  requires: ["calendar"],
  register(r) {
    r.kind(THING);
    r.kind(PERSON);
    r.relation({ id: "in", label: "In", from: "*", to: "*", cardinality: "many_one", symmetric: false, fields: {}, pack: "space" });

    r.service("space.travel", travel);
    r.query("space.route", routeAt);
    r.query("space.reachable", reachable);

    // Opening and closing routes (a ferry stops running, a secret passage is found).
    r.event<PackEvent>({
      type: "space.route",
      validate: (e, ctx) => (own(ctx.world.routes, strOf(e.data.route)) && typeof e.data.open === "boolean" ? null : { code: "bad_route", reason: `no route ${labelOf(ctx, strOf(e.data.route))}` }),
      apply: (e, state) => {
        sliceRecord(state, "space", "routes")[strOf(e.data.route)] = e.data.open === true;
      },
      describe: (e, ctx) => {
        const r = own(ctx.world.routes, strOf(e.data.route));
        const way = r ? `The way from ${own(ctx.world.places, r.from)?.name ?? r.from} to ${own(ctx.world.places, r.to)?.name ?? r.to}` : "A route";
        return `${way} ${e.data.open === true ? "opens" : "closes"}`;
      },
    });
    r.effect({ type: "space.set_route", resolve: (a) => [{ type: "space.route", data: { route: strOf(a.route), open: a.open !== false } }] });
    r.formula("route_open", (ctx, route) => !closedRoutes(ctx).has(String(route ?? "")));

    r.formula("travel_minutes", (ctx, from, to, mode) => routeAt(ctx, String(from ?? ""), String(to ?? ""), asMode(mode))?.minutes ?? 0);
    r.formula("distance_km", (ctx, from, to, mode) => routeAt(ctx, String(from ?? ""), String(to ?? ""), asMode(mode))?.distanceKm ?? 0);
    r.formula("route_exists", (ctx, from, to, mode) => routeAt(ctx, String(from ?? ""), String(to ?? ""), asMode(mode)) !== null);
    r.formula("within", (ctx, place, ancestor) => placeWithin(ctx.world, String(place ?? ""), String(ancestor ?? "")));
    r.formula("grid_minutes", (ctx, place, x, y) => {
      const gridId = own(ctx.world.places, String(place ?? ""))?.grid ?? "";
      const grid = own(ctx.world.grids, gridId);
      const self = own(ctx.state.entities, ctx.world.pov);
      if (!grid || !self) return 0;
      const path = findPath(grid, { x: Number(self.fields.x ?? 0), y: Number(self.fields.y ?? 0) }, { x: Number(x ?? 0), y: Number(y ?? 0) });
      return path ? gridMinutes(grid, path) : 0;
    });
    r.formula("grid_reachable", (ctx, place, x, y) => {
      const gridId = own(ctx.world.places, String(place ?? ""))?.grid ?? "";
      const grid = own(ctx.world.grids, gridId);
      const self = own(ctx.state.entities, ctx.world.pov);
      if (!grid || !self) return false;
      return findPath(grid, { x: Number(self.fields.x ?? 0), y: Number(self.fields.y ?? 0) }, { x: Number(x ?? 0), y: Number(y ?? 0) }) !== null;
    });

    r.action({
      id: "go",
      label: "Go to",
      pack: "space",
      params: { to: { type: "ref", ref: "place", label: "Place" } },
      requires: ["to != here", "level.space < 2 or route_exists(here, to, 'walk')"],
      outcomes: { default: [{ type: "move", args: { entity: "self", to: "=to" } }] },
      duration: "level.space < 2 ? (level.space < 1 ? 0 : 15) : travel_minutes(here, to, 'walk')",
      activity: { type: "travel", until: "clock + (level.space < 2 ? 15 : travel_minutes(here, to, 'walk'))" },
      lexicon: ["go to", "walk to", "head to", "head over to", "leave for"],
      observable: "leaves",
    });
    r.action({
      id: "step",
      label: "Move on the map",
      pack: "space",
      params: { x: { type: "number" }, y: { type: "number" } },
      requires: ["level.space >= 3", "grid_reachable(here, x, y)"],
      outcomes: { default: [{ type: "set", args: { entity: "self", field: "x", value: "=x" } }, { type: "set", args: { entity: "self", field: "y", value: "=y" } }] },
      duration: "grid_minutes(here, x, y)",
      lexicon: ["walk over to", "cross to", "move to"],
      observable: "moves across the area",
    });

    r.renderer({
      slot: "scene",
      render(ctx) {
        const level = ctx.levelOf(ctx.world.pov, "space");
        if (level === 0) return [];
        const here = placeOfEntity(ctx.state, ctx.world.pov);
        const place = here ? own(ctx.world.places, here) : undefined;
        if (!place) return [];
        const parent = place.parent ? own(ctx.world.places, place.parent)?.name : undefined;
        const lines = [`Place: ${place.name}${parent ? ` (in ${parent})` : ""}.`];
        if (level >= 2) {
          const exits: string[] = [];
          for (const id of Object.keys(ctx.world.places).sort()) {
            if (id === here) continue;
            const plan = routeAt(ctx, here as string, id, "walk");
            if (plan && plan.legs.length === 1) exits.push(`${own(ctx.world.places, id)?.name ?? id} ${plan.minutes} min on foot`);
          }
          if (exits.length > 0) lines.push(`Nearby: ${exits.slice(0, 6).join("; ")}.`);
        }
        return lines;
      },
    });

    r.view({ panel: "space.map", build: (ctx) => buildMapView(ctx) as unknown as JsonValue });

    r.proposal({
      type: "location",
      boundField: "ref",
      validate(p, ctx) {
        const entity = typeof p.entity === "string" ? p.entity : ctx.world.pov;
        const place = typeof p.place === "string" ? p.place : "";
        if (!own(ctx.state.entities, entity)) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, entity)}` };
        if (!own(ctx.world.places, place)) return { code: "missing_place", reason: `no place ${labelOf(ctx, place)}` };
        const from = placeOfEntity(ctx.state, entity);
        // A narrated move across a gap no route spans (off an island with no boat leg back) didn't happen.
        if (from && !reachable(ctx, from, place)) return { code: "declined", reason: `There's no way from ${own(ctx.world.places, from)?.name ?? from} to ${own(ctx.world.places, place)?.name ?? place}.` };
        return null;
      },
      toEffects: (p, ctx) => [{ type: "move", args: { entity: typeof p.entity === "string" ? p.entity : ctx.world.pov, to: typeof p.place === "string" ? p.place : "" } }],
    });

    r.lint({
      code: "space.references",
      check(world) {
        const issues = [];
        for (const [id, rt] of Object.entries(world.routes)) {
          for (const p of [rt.from, rt.to]) if (!own(world.places, p)) issues.push({ severity: "error" as const, code: "space.references", message: `Route ${id} names an unknown place ${p}.`, path: `routes.${id}` });
          if (Object.keys(rt.modes).length === 0) issues.push({ severity: "warning" as const, code: "space.references", message: `Route ${id} has no travel modes.`, path: `routes.${id}` });
        }
        for (const [id, p] of Object.entries(world.places)) {
          if (p.parent && !own(world.places, p.parent)) issues.push({ severity: "error" as const, code: "space.references", message: `Place ${id} has an unknown parent ${p.parent}.`, path: `places.${id}` });
          let cur = p.parent;
          for (let guard = 0; cur && guard < 64; guard++) {
            if (cur === id) {
              issues.push({ severity: "error" as const, code: "space.references", message: `Place ${id} is its own ancestor.`, path: `places.${id}` });
              break;
            }
            cur = own(world.places, cur)?.parent;
          }
          if (p.grid && !own(world.grids, p.grid)) issues.push({ severity: "error" as const, code: "space.references", message: `Place ${id} names an unknown grid ${p.grid}.`, path: `places.${id}` });
        }
        for (const [id, g] of Object.entries(world.grids)) {
          if (g.terrain.length !== g.width * g.height) issues.push({ severity: "error" as const, code: "space.references", message: `Grid ${id} has ${g.terrain.length} terrain cells for ${g.width}×${g.height}.`, path: `grids.${id}` });
        }
        return issues;
      },
    });
  },
};

export default spacePack;
