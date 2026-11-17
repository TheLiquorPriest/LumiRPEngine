// Where people and things stand on grids (DESIGN §7, §12): the POV arriving at a place, stepping
// across a grid, a thing laid down at a cell or picked up from one, who can reach what, and who has
// just stepped into a zone. While the grid system is off a grid is drawn, not walked: from Space 3
// the POV stands on the cell its place is drawn at, and steps set its cell, as they always have.
// With it on, every position change is one `space.pos` event (the cell, and the cell before), so the
// POV's sight (`space.seen`) and zone triggers read whole moves, never half of one.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { areaPlaceAt, cellIndex, doorTerrainsOf, entranceCell, gridOf, standingGrid, type Cell } from "../../../shared/grid";
import { mapSettingsOf } from "../../../shared/maps";
import { MAP_DEFAULTS, type MapConfig } from "../../../shared/map-config";
import type { GridTrigger } from "../../../shared/world";
import { labelOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { isGone, placeOfEntity } from "../../../engine/scope";
import { selectorMatches } from "../../../engine/selector";
import { canSeePlace, knownBySelector } from "../../../engine/visibility";
import { between, sees, sightFrom } from "./grid-measure";
import { groundAt, HOLD_DEPTH, spotData, spotOf, squareOf, standsAt, type GridSpot, type Ground, type GroundSource } from "./grid-model";
import { WHERE_EVENT, whereOf } from "./grid-play";
import { walk, type Walk } from "./grid-path";
import { placePath } from "./map-scope";

/** The event every position change makes while the grid system is on. */
export const POS_EVENT = "space.pos";

function posEvent(entity: EntityId, at: GridSpot | null, from: GridSpot | null): LedgerEvent {
  const data: JsonObject = { entity, at: at ? { ...at } : null, from: from ? { ...from } : null };
  return { type: POS_EVENT, data };
}

/** A cell set without the grid system: the `set` events for whichever of x and y change. */
function setCell(entity: EntityId, fields: JsonObject, cell: Cell): LedgerEvent[] {
  return [...(fields.x !== cell.x ? [{ type: "set" as const, entity, field: "x", value: cell.x }] : []), ...(fields.y !== cell.y ? [{ type: "set" as const, entity, field: "y", value: cell.y }] : [])];
}

/** The words of where something was said to be that `spawn` and `store` once kept as fields of its own. */
const SAID_FIELDS: readonly string[] = ["said_on", "said_in", "said_by"];

/**
 * What a move leaves behind of where someone or something was within its place besides the square:
 * its zone and words (`space.where`), and the words a thing still carries as fields from before. A
 * position is of one place: a move to another, or into a holder, leaves none of it.
 */
function forgetEvents(ctx: ReadContext, entity: EntityId): LedgerEvent[] {
  const fields = own(ctx.state.entities, entity)?.fields ?? {};
  const out: LedgerEvent[] = whereOf(ctx.state, entity) !== null ? [{ type: WHERE_EVENT, data: { entity, zone: null, words: null } }] : [];
  for (const field of SAID_FIELDS) if (typeof fields[field] === "string") out.push({ type: "set", entity, field, value: null });
  return out;
}

/**
 * The cells of a grid that belong to places the POV can't see (DESIGN §7, §12): every zone named
 * after such a place, unless the POV is inside it. The map draws them as nothing, and the POV never
 * steps onto them or walks through them, so a secret room is neither shown nor found on foot.
 */
export function hiddenCells(ctx: ReadContext, grid: { readonly zones: Readonly<Record<string, readonly number[]>> }): Set<number> {
  const { world, state } = ctx;
  const inside = new Set(placePath(world, placeOfEntity(state, world.pov)));
  const out = new Set<number>();
  for (const [zone, cells] of Object.entries(grid.zones)) {
    if (!own(world.places, zone) || inside.has(zone) || canSeePlace(ctx.registry, world, state, world.pov, zone)) continue;
    for (const cell of cells) out.add(cell);
  }
  return out;
}

/**
 * The way `entity` walks across `ground`, the grid it stands on as play stands, from its cell to
 * `to`: the pack's one geometry (eight directions, no corner cut, doors and footprints as they
 * are, the chat's square changes laid over). The POV never walks through a place it can't see.
 * Null when nothing joins the two.
 */
export function walkOn(ctx: ReadContext, ground: Ground, entity: EntityId, from: Cell, to: Cell): Walk | null {
  const hidden = entity === ctx.world.pov ? hiddenCells(ctx, ground.drawn) : undefined;
  return walk(ground.drawn, ground.moving, squareOf(from), squareOf(to), entity, undefined, hidden);
}

/**
 * The squares of the grid of `scope` seen from a cell within a radius, as play stands (the
 * `space.sight` service): the pack's one sight, which the panel's fog and the POV's seen squares
 * (`engine/seen.ts`) read. Doors not open and footprints that block the view shut it; the POV, who
 * looks, never does. A square in the dark (its light, `light.ts`, at the chat's map settings
 * `config`) is not seen. By index.
 */
export function sightFor(source: GroundSource, scope: PlaceId, from: Cell, radius: number, config: Readonly<MapConfig> = MAP_DEFAULTS): number[] {
  const ground = groundAt(source, scope, config);
  return ground ? sightFrom(ground.drawn, ground.moving, squareOf(from), radius, [source.world.pov]).filter((i) => !ground.drawn.dark.has(i)) : [];
}

/**
 * Where someone arriving at a place stands (the `space.arrival` service): nobody has a square on a
 * grid they did not set it on, so whoever changes place stands on no square of the new place until
 * an agent's call or the owner's correction gives one, and a square they had is cleared (§8.2).
 * The one exception is a map that is drawn, not walked (the grid system off): from Space 3 the POV
 * stands on the cell its place is drawn at.
 */
export function arrivalEvents(ctx: ReadContext, entity: EntityId, to: PlaceId): LedgerEvent[] {
  const e = own(ctx.state.entities, entity);
  if (!e) return [];
  const moved = placeOfEntity(ctx.state, entity) !== to;
  const forgotten = moved ? forgetEvents(ctx, entity) : [];
  if (!mapSettingsOf(ctx.world).grid.movement && entity === ctx.world.pov && ctx.levelOf(entity, "space") >= 3) {
    const cell = own(ctx.world.places, to)?.cell;
    if (cell) return [...setCell(entity, e.fields, cell), ...forgotten];
  }
  const had = typeof e.fields.x === "number" || typeof e.fields.y === "number";
  return [...(had && moved ? [posEvent(entity, null, spotOf(ctx.world, ctx.state, entity))] : []), ...forgotten];
}

/**
 * A step to a cell of the grid someone stands on (the `space.step` effect). With the grid system
 * on, crossing into a room's area puts them in that room (at its entrance when it has a grid of its
 * own), and out on open floor in the place the grid draws; walls and blocked cells stop them. Off,
 * the step only sets the cell. The POV never steps onto, or walks through, a place it can't see.
 */
export function stepEvents(ctx: ReadContext, entity: EntityId, to: Cell): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, entity);
  if (!e) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, entity)}` };
  if (isGone(ctx.state, entity)) return { code: "gone", reason: `${labelOf(ctx, entity)} has been removed` };
  const here = placeOfEntity(ctx.state, entity);
  const stand = standingGrid(ctx.world, here);
  const index = stand ? cellIndex(stand.grid, to) : null;
  if (!stand || here === null) return { code: "off_grid", reason: `${labelOf(ctx, entity)} isn't on a map's grid here` };
  if (index === null) return { code: "off_grid", reason: "That spot isn't on this map." };
  const hidden = entity === ctx.world.pov ? hiddenCells(ctx, stand.grid) : new Set<number>();
  if (hidden.has(index)) return { code: "no_way", reason: "There's no way there from here." };
  if (!mapSettingsOf(ctx.world).grid.movement) return setCell(entity, e.fields, to);
  const from = spotOf(ctx.world, ctx.state, entity);
  if (!from || from.scope !== stand.scope) return { code: "off_grid", reason: `${labelOf(ctx, entity)} isn't standing on this map` };
  const ground = groundAt(ctx, here);
  if (!ground || !walkOn(ctx, ground, entity, from, to)) return { code: "no_way", reason: "There's no way there from here." };
  const room = areaPlaceAt(ctx.world, stand.scope, stand.grid, index) ?? stand.scope;
  if (room === here) return [posEvent(entity, { scope: stand.scope, x: to.x, y: to.y }, from)];
  const out: LedgerEvent[] = e.relations.filter((r) => r.type === "in").map((r) => ({ type: "unlink" as const, rel: "in", from: entity, to: r.to }));
  out.push({ type: "set", entity, field: "place", value: room });
  // A room with a grid of its own is a map of its own: it is entered at its entrance, on that grid.
  const inner = room !== stand.scope ? gridOf(ctx.world, room) : undefined;
  const entry = inner ? entranceCell(inner, doorTerrainsOf(ctx.world)) : null;
  if (inner) out.push(posEvent(entity, entry ? { scope: room, ...entry } : null, from));
  else out.push(posEvent(entity, { scope: stand.scope, x: to.x, y: to.y }, from));
  return out;
}

/**
 * Where a thing lies once it leaves someone's hands (the `space.lay` service): put down at `place`
 * by someone the grid system has standing on that place's grid, at their cell; anywhere else, off
 * any grid. The events that say so, none when nothing changes.
 */
export function layEvents(ctx: ReadContext, thing: EntityId, place: PlaceId | null, by: EntityId | null): LedgerEvent[] {
  const e = own(ctx.state.entities, thing);
  if (!e) return [];
  const forgotten = forgetEvents(ctx, thing);
  const spot = by !== null && place !== null && mapSettingsOf(ctx.world).grid.movement ? spotOf(ctx.world, ctx.state, by) : null;
  if (spot && place !== null && standingGrid(ctx.world, place)?.scope === spot.scope) return [posEvent(thing, spot, null), ...forgotten];
  return [...(typeof e.fields.x === "number" || typeof e.fields.y === "number" ? [posEvent(thing, null, null)] : []), ...forgotten];
}

/**
 * Whether `a` can reach `b` (the `reach` formula, DESIGN §11): `b` is `a`, or something `a`
 * carries; or it is where `a` is. While the grid system has both on one grid, that means on `a`'s
 * square or next to it, by the pack's one geometry: not across the pinched corner of a wall or a
 * shut door; otherwise at the same place.
 */
export function reach(ctx: ReadContext, a: EntityId, b: EntityId): boolean {
  const { world, state } = ctx;
  if (!own(state.entities, a) || !own(state.entities, b)) return false;
  if (a === b) return true;
  let holder = own(state.entities, b)?.relations.find((r) => r.type === "in")?.to;
  for (let depth = 0; holder !== undefined && depth < HOLD_DEPTH; depth++) {
    if (holder === a) return true;
    holder = own(state.entities, holder)?.relations.find((r) => r.type === "in")?.to;
  }
  const here = placeOfEntity(state, a);
  if (here === null) return false;
  const sa = mapSettingsOf(world).grid.movement ? spotOf(world, state, a) : null;
  const sb = sa ? spotOf(world, state, b) : null;
  if (sa && sb && sa.scope === sb.scope) {
    const ground = groundAt(ctx, here);
    if (!ground) return false;
    // Each one by its footprint where it stands on the grid; one carried by someone, by that one's square.
    const spot = (id: EntityId, s: GridSpot): EntityId | readonly [number, number] => (standsAt(ground.moving, id) !== null ? id : squareOf(s));
    const [pa, pb] = [spot(a, sa), spot(b, sb)];
    const apart = between(ground.drawn, ground.moving, pa, pb);
    return apart !== null && apart <= 1 && sees(ground.drawn, ground.moving, pa, pb) === true;
  }
  return placeOfEntity(state, b) === here;
}

/**
 * Whether a `space.pos` event steps into a grid trigger's zone or onto its cell (the `space.entered`
 * query, DESIGN §10): the new cell is inside it, the one before wasn't (or was on another grid), the
 * grid is the trigger's (`in`), and the one moving is the POV, or matches `who`; a removed entity
 * fires nothing.
 */
export function entered(ctx: ReadContext, on: GridTrigger, e: LedgerEvent): boolean {
  if (e.type !== POS_EVENT || !("data" in e)) return false;
  const at = spotData(e.data.at);
  const entity = strOf(e.data.entity);
  if (!at || (on.in !== undefined && on.in !== at.scope) || isGone(ctx.state, entity)) return false;
  // A `who` the engine can't read whole fails closed, as a `knownBy` does.
  const who = on.who === undefined ? null : knownBySelector(on.who);
  if (on.who === undefined ? entity !== ctx.world.pov : who === null || !selectorMatches(ctx.registry, ctx.world, ctx.state, who, entity)) return false;
  const grid = gridOf(ctx.world, at.scope);
  if (!grid) return false;
  const inside = (spot: GridSpot | null): boolean => {
    if (!spot || spot.scope !== at.scope) return false;
    if ("cell" in on) return spot.x === on.cell[0] && spot.y === on.cell[1];
    const zone = Object.prototype.hasOwnProperty.call(grid.zones, on.zone) ? grid.zones[on.zone] : undefined;
    return zone?.includes(spot.y * grid.width + spot.x) ?? false;
  };
  return inside(at) && !inside(spotData(e.data.from));
}
