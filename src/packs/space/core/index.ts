// Space & travel pack (DESIGN §9.3): places, routes with travel modes (walk, road, off-road, water),
// distances, terrain, grids, positions and tracking. It also owns the base kinds every other pack
// builds on: `thing` (anything with a place and an owner) and `person`, whose fields carry each
// domain's level contract.
//
// Level contract (domain `space`):
//   0  off: no movement rules (moves are free and instant)
//   1  named places: moves need no route and take a nominal 15 minutes
//   2  places plus routes and travel times: walking needs a route (or shared parent)
//   3  grids and positions (`x`, `y` on the grid the place stands on; A* with caps)
//   4  terrain multipliers and weather effects on travel; mode-specific routes
//
// The grid system (`mapSettings.grid.movement`, DESIGN §12) plays Space at 3 at least: walls and
// doors steer the POV across grids, things lie in cells, and cells and zones trigger rules
// (`positions.ts`).

import { FILING_STATUSES } from "../../../shared/finance";
import type { JsonValue } from "../../../shared/json";
import { hasOwn, isRecord } from "../../../shared/json";
import { cellIndex, findPath, gridMinutes, gridOf, SIGHT_MAX, standingGrid, type GridPath } from "../../../shared/grid";
import { mapLint, mapSettingsOf } from "../../../shared/maps";
import type { EntityId, PlaceId, TravelMode } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import type { LintIssue } from "../../../shared/protocol";
import type { GridDef, GridTrigger, KindDef, WorldDoc } from "../../../shared/world";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { GRID_SPACE_FLOOR } from "../../../engine/registry-impl";
import { acts, lifeOf, povLife } from "../../../engine/life";
import { placeOfEntity, placeWithin } from "../../../engine/scope";
import { observeCells } from "../../../engine/seen";
import { canSeeEntity, canSeePlace, HIDDEN_PLACE_NAME, knownBySelector, povPlace } from "../../../engine/visibility";
import type { PackEvent } from "../../../shared/ledger";
import { labelOf, sliceRecord, strOf, own } from "../../../engine/pack-kit";
import { arrivalEvents, entered, layEvents, POS_EVENT, povGround, reach, spotData, spotOf, stepEvents } from "./positions";
import { closedRoutes, goMinutes, nominalRoute, routeAt, type TravelPlan } from "./travel";
import { buildMapView } from "./view";

export type TravelService = (ctx: ReadContext, entity: EntityId, to: PlaceId, mode: TravelMode) => { plan: TravelPlan; events: LedgerEvent[] } | Rejection;
export type RouteQuery = (ctx: ReadContext, from: PlaceId, to: PlaceId, mode: TravelMode) => TravelPlan | null;

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Moves an entity to a place by a mode: the plan (minutes, distance, legs) and the move events. */
    "space.travel": TravelService;
    /** Where someone arriving at a place stands there (`move` effects end with these events). */
    "space.arrival": (ctx: ReadContext, entity: EntityId, to: PlaceId) => LedgerEvent[];
    /** Where a thing lies once it leaves someone's hands: put down at `place` by `by`, or (null) picked up. */
    "space.lay": (ctx: ReadContext, thing: EntityId, place: PlaceId | null, by: EntityId | null) => LedgerEvent[];
  }
  interface QueryMap {
    /** The fastest route for a mode at the current Space level (terrain and weather from level 4). */
    "space.route": RouteQuery;
    /** Whether `to` can be reached from `from` by any one travel mode (always below Space 2). */
    "space.reachable": (ctx: ReadContext, from: PlaceId, to: PlaceId) => boolean;
    /** Whether an event steps someone into a grid trigger's zone or onto its cell (rules, DESIGN §10). */
    "space.entered": (ctx: ReadContext, trigger: GridTrigger, e: LedgerEvent) => boolean;
  }
}

const MODES: readonly TravelMode[] = ["walk", "road", "offroad", "water"];

/** Whether `to` can be reached from `from` by any one travel mode; below Space 2 movement is nominal, so always. */
export function reachable(ctx: ReadContext, from: PlaceId, to: PlaceId): boolean {
  if (from === to || ctx.levelOf(ctx.world.pov, "space") < 2) return true;
  return MODES.some((m) => routeAt(ctx, from, to, m) !== null);
}

/** A walk on the grid the POV stands on at `place`, from its cell to (x, y), never through a place it can't see; null when it has no cell there or nothing joins the two. */
function gridWalk(ctx: ReadContext, place: PlaceId, x: number, y: number): { grid: GridDef; path: GridPath } | null {
  const stand = standingGrid(ctx.world, place);
  const fields = own(ctx.state.entities, ctx.world.pov)?.fields;
  if (!stand || typeof fields?.x !== "number" || typeof fields.y !== "number") return null;
  const path = findPath(povGround(ctx, stand.grid), { x: fields.x, y: fields.y }, { x, y });
  return path ? { grid: stand.grid, path } : null;
}

/** The map settings as the engine reads them (DESIGN §12), and the grid system's rule triggers (§10). */
function gridLint(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, message: string): void => void issues.push({ severity: "error", path, code: "space.grid", message });
  const raw: unknown = world.mapSettings;
  const grid = isRecord(raw) ? raw.grid : undefined;
  if (raw !== undefined && !isRecord(raw)) err("mapSettings", "Map settings are an object: display, the grid system's movement and sightRadius, and travelSimulation.");
  else if (isRecord(raw)) {
    if (raw.display !== undefined && raw.display !== "knowledge" && raw.display !== "fog") err("mapSettings.display", 'The map shows "knowledge" (what the POV knows) or "fog".');
    if (grid !== undefined && !isRecord(grid)) err("mapSettings.grid", "The grid system's settings are an object: movement and sightRadius.");
    if (isRecord(grid) && grid.movement !== undefined && typeof grid.movement !== "boolean") err("mapSettings.grid.movement", "Grid movement is on (true) or off (false).");
    const radius = isRecord(grid) ? grid.sightRadius : undefined;
    if (radius !== undefined && (typeof radius !== "number" || !Number.isInteger(radius) || radius < 0 || radius > SIGHT_MAX)) err("mapSettings.grid.sightRadius", `The sight radius is a whole number of cells from 0 to ${SIGHT_MAX}.`);
    if (raw.travelSimulation !== undefined && typeof raw.travelSimulation !== "boolean") err("mapSettings.travelSimulation", "The travel simulation is on (true) or off (false).");
  }
  const movement = mapSettingsOf(world).grid.movement;
  if (movement && world.realism.levels.space < GRID_SPACE_FLOOR) issues.push({ severity: "info", path: "mapSettings.grid.movement", code: "level_floor", message: `The realism defaults put space at ${world.realism.levels.space}; the grid system plays it at ${GRID_SPACE_FLOOR}, for positions.` });
  for (const [id, rule] of Object.entries(world.rules)) {
    const on: unknown = rule.on;
    if (!isRecord(on) || !("zone" in on || "cell" in on)) continue;
    const path = `rules.${id}.on`;
    const scope = on.in;
    const onGrid = typeof scope === "string" ? gridOf(world, scope) : undefined;
    if (scope !== undefined && !onGrid) err(path, `"${String(scope)}" isn't a place with a grid.`);
    if ("cell" in on) {
      const cell = on.cell;
      if (scope === undefined) err(path, "A cell trigger names the place whose grid the cell is on, as `in`.");
      if (!Array.isArray(cell) || cell.length !== 2 || !cell.every((n) => Number.isInteger(n))) err(path, "A cell is [x, y], two whole numbers.");
      else if (onGrid && cellIndex(onGrid, { x: Number(cell[0]), y: Number(cell[1]) }) === null) err(path, `[${cell.join(", ")}] isn't on ${String(scope)}'s grid.`);
    } else if (typeof on.zone !== "string" || !(onGrid ? [onGrid] : Object.values(world.grids)).some((g) => hasOwn(g.zones, String(on.zone)))) {
      err(path, `No grid${onGrid ? ` of ${String(scope)}` : ""} has a zone "${String(on.zone)}".`);
    }
    if (on.who !== undefined && knownBySelector(on.who) === null) err(`${path}.who`, "`who` is a selector the engine can read whole, with at least one constraint (kind, tier, class, memberOf, tag or ids).");
    if (!movement) issues.push({ severity: "warning", path, code: "space.grid", message: "With the grid system off nobody steps across a grid, so this rule never fires." });
  }
  return issues;
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
    pay_prefs: { type: "list", label: "Pays with, in order ({use, min?, max?, categories?, except?})", domain: "money", level: 3 },
    filing_status: { type: "enum", label: "Tax filing status", values: [...FILING_STATUSES], domain: "money", level: 4 },
    local_tax: { type: "bool", label: "Pays local income tax", domain: "money", level: 4 },
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
    birthday: { type: "date", label: "Birthday (MM-DD or YYYY-MM-DD)", domain: "castlife", level: 3 },
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
    r.service("space.arrival", arrivalEvents);
    r.service("space.lay", layEvents);
    r.query("space.route", routeAt);
    r.query("space.reachable", reachable);
    r.query("space.entered", entered);

    // A position on a grid while the grid system is on (`positions.ts`): the cell (null: off any
    // grid) and the one before, written whole, so the POV's sight and zone triggers read whole moves.
    r.event<PackEvent>({
      type: POS_EVENT,
      validate: (e, ctx) => {
        const entity = strOf(e.data.entity);
        if (!own(ctx.state.entities, entity)) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, entity)}` };
        if (e.data.at === null) return null;
        const at = spotData(e.data.at);
        const stand = standingGrid(ctx.world, placeOfEntity(ctx.state, entity));
        return at && stand && stand.scope === at.scope && cellIndex(stand.grid, at) !== null ? null : { code: "off_grid", reason: `${labelOf(ctx, entity)} isn't on that map` };
      },
      apply: (e, state, ctx) => {
        const entity = strOf(e.data.entity);
        const thing = own(state.entities, entity);
        if (!thing) return;
        const at = spotData(e.data.at);
        if (at) Object.assign(thing.fields, { x: at.x, y: at.y });
        else {
          delete thing.fields.x;
          delete thing.fields.y;
        }
        if (entity === ctx.world.pov) observeCells(state, ctx.world);
      },
      // A cell set in play is play's: an Upgrade keeps it over the revision's (the touched record).
      touches: (e) => [{ entity: strOf(e.data.entity), field: "x" }, { entity: strOf(e.data.entity), field: "y" }],
      // Steps are told by the action and the place they reach, never as coordinates.
      describe: () => "",
    });
    r.effect({
      type: "space.step",
      args: ["x", "y", "entity?"],
      resolve: (a, ctx) => (typeof a.x === "number" && typeof a.y === "number" ? stepEvents(ctx, strOf(a.entity) || ctx.world.pov, { x: Math.round(a.x), y: Math.round(a.y) }) : { code: "bad_args", reason: "a step needs x and y" }),
    });

    // Opening and closing routes (a ferry stops running, a secret passage is found).
    r.event<PackEvent>({
      type: "space.route",
      validate: (e, ctx) => (own(ctx.world.routes, strOf(e.data.route)) && typeof e.data.open === "boolean" ? null : { code: "bad_route", reason: `no route ${labelOf(ctx, strOf(e.data.route))}` }),
      apply: (e, state) => {
        sliceRecord(state, "space", "routes")[strOf(e.data.route)] = e.data.open === true;
      },
      describe: (e, ctx, viewer) => {
        const r = own(ctx.world.routes, strOf(e.data.route));
        const verb = e.data.open === true ? "opens" : "closes";
        if (!r) return `A route ${verb}`;
        // A player's line never names an end its POV can't see: that end is somewhere, and a way
        // with no end it can see is just a way. The GM's and the author's lines name both.
        const shown = (id: string): boolean => viewer === undefined || canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, id);
        const end = (id: string): string => (shown(id) ? (own(ctx.world.places, id)?.name ?? id) : "somewhere");
        return shown(r.from) || shown(r.to) ? `The way from ${end(r.from)} to ${end(r.to)} ${verb}` : `A way ${verb}`;
      },
    });
    r.effect({ type: "space.set_route", args: ["route", "open?"], resolve: (a) => [{ type: "space.route", data: { route: strOf(a.route), open: a.open !== false } }] });
    r.formula("route_open", (ctx, route) => !closedRoutes(ctx).has(String(route ?? "")));

    r.formula("travel_minutes", (ctx, from, to, mode) => routeAt(ctx, String(from ?? ""), String(to ?? ""), asMode(mode))?.minutes ?? 0);
    r.formula("distance_km", (ctx, from, to, mode) => routeAt(ctx, String(from ?? ""), String(to ?? ""), asMode(mode))?.distanceKm ?? 0);
    r.formula("route_exists", (ctx, from, to, mode) => routeAt(ctx, String(from ?? ""), String(to ?? ""), asMode(mode)) !== null);
    // Go's time and whether it can go at all (`goMinutes`): story first it always can; the world's
    // travel simulation needs a walk. One formula for both, so the catalog names no route need.
    r.formula("go_minutes", (ctx, from, to) => goMinutes(ctx, String(from ?? ""), String(to ?? "")) ?? 0);
    r.formula("can_go", (ctx, from, to) => goMinutes(ctx, String(from ?? ""), String(to ?? "")) !== null);
    r.formula("within", (ctx, place, ancestor) => placeWithin(ctx.world, String(place ?? ""), String(ancestor ?? "")));
    // Walking on the grid the POV stands on at `place`: its own, or the one it is drawn on.
    r.formula("grid_minutes", (ctx, place, x, y) => {
      const path = gridWalk(ctx, String(place ?? ""), Number(x ?? 0), Number(y ?? 0));
      return path ? gridMinutes(path.grid, path.path) : 0;
    });
    r.formula("grid_reachable", (ctx, place, x, y) => gridWalk(ctx, String(place ?? ""), Number(x ?? 0), Number(y ?? 0)) !== null);
    // Things in cells (DESIGN §11): `reach(self, item)` holds on or next to the item's cell while the
    // grid system tracks both, else at the same place; `on_grid(item)` while it lies in a cell itself.
    r.formula("reach", (ctx, a, b) => reach(ctx, String(a ?? ""), String(b ?? "")));
    r.formula("on_grid", (ctx, thing) => {
      const e = own(ctx.state.entities, String(thing ?? ""));
      return mapSettingsOf(ctx.world).grid.movement && typeof e?.fields.place === "string" && spotOf(ctx.world, ctx.state, String(thing ?? "")) !== null;
    });

    r.action({
      id: "go",
      label: "Go to",
      description: "Go to another place: a room, a building, a street, another part of town.",
      pack: "space",
      params: { to: { type: "ref", ref: "place", label: "Place" } },
      // Story first: the walk, else any mode's route, else a nominal move. The world's travel
      // simulation brings back the walk it once needed (`can_go`).
      requires: ["to != here", "can_go(here, to)"],
      outcomes: { default: [{ type: "move", args: { entity: "self", to: "=to" } }] },
      duration: "go_minutes(here, to)",
      activity: { type: "travel", until: "clock + (level.space < 2 ? 15 : go_minutes(here, to))" },
      lexicon: ["go to", "walk to", "head to", "head over to", "leave for"],
      observable: "leaves",
    });
    r.action({
      id: "step",
      label: "Move on the map",
      description: "Walk to a square of the grid you stand on.",
      pack: "space",
      params: { x: { type: "number" }, y: { type: "number" } },
      requires: ["level.space >= 3", "grid_reachable(here, x, y)"],
      outcomes: { default: [{ type: "space.step", args: { entity: "self", x: "=x", y: "=y" } }] },
      duration: "grid_minutes(here, x, y)",
      lexicon: ["walk over to", "cross to", "move to"],
      observable: "moves across the area",
    });

    r.renderer({
      slot: "scene",
      // A section's `include` picks it by this name (DESIGN §6.11).
      source: "location",
      render(ctx) {
        const level = ctx.levelOf(ctx.world.pov, "space");
        if (level === 0) return [];
        const here = placeOfEntity(ctx.state, ctx.world.pov);
        const place = here ? own(ctx.world.places, here) : undefined;
        if (!place) return [];
        // The narrator hears where the POV is as every player surface names it (`povPlace`), and of
        // the place around it only when the POV can see that too.
        const sees = (id: PlaceId): boolean => canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
        const parent = place.parent && sees(place.parent) ? own(ctx.world.places, place.parent)?.name : undefined;
        const lines = [`Place: ${povPlace(ctx.registry, ctx.world, ctx.state)?.name ?? HIDDEN_PLACE_NAME}${parent ? ` (in ${parent})` : ""}.`];
        if (level >= 2) {
          const exits: string[] = [];
          for (const id of Object.keys(ctx.world.places).sort()) {
            // The narrator hears only of exits to places the POV knows (a hidden one stays hidden).
            if (id === here || !canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id)) continue;
            const plan = routeAt(ctx, here as string, id, "walk");
            if (plan && plan.legs.length === 1) exits.push(`${own(ctx.world.places, id)?.name ?? id} ${plan.minutes} min on foot`);
          }
          if (exits.length > 0) lines.push(`Nearby: ${exits.slice(0, 6).join("; ")}.`);
        }
        return lines;
      },
    });

    r.view({ panel: "space.map", build: (ctx, prefs) => buildMapView(ctx, prefs.mapDisplay) as unknown as JsonValue });

    r.proposal({
      type: "location",
      boundField: "ref",
      validate(p, ctx) {
        const entity = typeof p.entity === "string" ? p.entity : ctx.world.pov;
        const place = typeof p.place === "string" ? p.place : "";
        if (!own(ctx.state.entities, entity)) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, entity)}` };
        if (!own(ctx.world.places, place)) return { code: "missing_place", reason: `no place ${labelOf(ctx, place)}` };
        // Someone who doesn't act walks nowhere: the body stays where it lies. What the POV knows decides
        // how a move is refused, so the refusal never tells of a change it hasn't learned of: a body it
        // knows of is declined as that body, even one since brought back out of its sight (a revival it
        // hasn't seen still reads as death, DESIGN §8); someone it takes to act who doesn't is refused
        // unseen (dropped as a change that changed nothing), as no living person's move is refused. Only
        // the log says why (`gm`).
        const name = labelOf(ctx, entity);
        const truth = lifeOf(ctx.state, entity);
        const stopped = !acts(ctx.world, ctx.state, entity);
        const known = povLife(ctx.world, ctx.state, entity);
        if (known && !known.acts && canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, entity)) {
          return { code: "not_moved", reason: `${name} ${known.reads}; that move didn't happen`, gm: stopped ? `${name} is ${truth} and doesn't act` : `${name} is ${truth}, which the POV hasn't learned; it takes them as ${known.id}` };
        }
        if (stopped) return { code: "not_moved", reason: "that move didn't happen", gm: `${name} is ${truth} and doesn't act`, unseen: true };
        const from = placeOfEntity(ctx.state, entity);
        // Moves are story first: a narrated move lands whether or not a route joins the two places.
        // Only the world's travel simulation makes one across a gap no route spans (off an island with
        // no boat leg back) a move that didn't happen. The reason reaches the player: a place the POV
        // can't see is somewhere.
        const named = (id: PlaceId): string => (canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id) ? (own(ctx.world.places, id)?.name ?? id) : "somewhere");
        if (from && mapSettingsOf(ctx.world).travelSimulation && !reachable(ctx, from, place)) return { code: "no_route", reason: `There's no way from ${named(from)} to ${named(place)}` };
        return null;
      },
      toEffects: (p, ctx) => {
        const entity = typeof p.entity === "string" ? p.entity : ctx.world.pov;
        const to = typeof p.place === "string" ? p.place : "";
        const move = { type: "move", args: { entity, to } };
        // A told move to another place doesn't carry over what they were doing where they were (the
        // shift their routine or the planner gave them): their activity goes back to idle, unless the
        // proposal says what they do there.
        const doing = own(ctx.state.entities, entity)?.fields.activity;
        if (to === placeOfEntity(ctx.state, entity) || doing === undefined) return [move];
        const next = typeof p.activity === "string" && p.activity.trim() !== "" ? p.activity.trim() : "idle";
        return next === doing ? [move] : [move, { type: "set", args: { entity, field: "activity", value: next } }];
      },
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
    // Maps (`lre-map-v1`): shape, scope, layout and legend, places new to the world, links.
    r.lint({ code: "space.maps", check: mapLint });
    // Map settings and the grid system's triggers.
    r.lint({ code: "space.grid", check: gridLint });
  },
};

export default spacePack;
