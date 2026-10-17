// Where people and things stand on grids (DESIGN §7, §12): the POV arriving at a place, stepping
// across a grid, a thing laid down at a cell or picked up from one, who can reach what, and who has
// just stepped into a zone. While the grid system is off a grid is drawn, not walked: from Space 3
// the POV stands on the cell its place is drawn at, and steps set its cell, as they always have.
// With it on, every position change is one `space.pos` event (the cell, and the cell before), so the
// POV's sight (`space.seen`) and zone triggers read whole moves, never half of one.

import type { EntityId, PlaceId } from "../../../shared/ids";
import { isRecord } from "../../../shared/json";
import type { JsonObject } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { arrivalCell, areaPlaceAt, cellIndex, entranceCell, findPath, gridOf, standingGrid, type Cell } from "../../../shared/grid";
import { mapSettingsOf } from "../../../shared/maps";
import type { GridTrigger, WorldDoc } from "../../../shared/world";
import { labelOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { placeOfEntity } from "../../../engine/scope";
import { selectorMatches } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { knownBySelector } from "../../../engine/visibility";

/** The event every position change makes while the grid system is on. */
export const POS_EVENT = "space.pos";

/** A cell on the grid of a place (`scope`, the place whose grid it is). */
export interface GridSpot {
  scope: PlaceId;
  x: number;
  y: number;
}

/** How deep a chain of holders is followed to find where something carried stands. */
const HOLD_DEPTH = 32;

/** A `space.pos` spot as written, or null (off any grid, or not a spot). */
export function spotData(v: unknown): GridSpot | null {
  return isRecord(v) && typeof v.scope === "string" && Number.isInteger(v.x) && Number.isInteger(v.y) ? { scope: v.scope, x: Number(v.x), y: Number(v.y) } : null;
}

/**
 * Where an entity stands on a grid: its own cell on the grid its place stands on; for something
 * carried, its outermost holder's. Null off any grid, or with no cell on it.
 */
export function spotOf(world: WorldDoc, state: Readonly<WorldState>, entity: EntityId): GridSpot | null {
  let id = entity;
  for (let depth = 0; depth < HOLD_DEPTH; depth++) {
    const e = own(state.entities, id);
    if (!e) return null;
    const place = e.fields.place;
    if (typeof place === "string" && place !== "") {
      const stand = standingGrid(world, place);
      const { x, y } = e.fields;
      return stand && typeof x === "number" && typeof y === "number" && cellIndex(stand.grid, { x, y }) !== null ? { scope: stand.scope, x, y } : null;
    }
    const holder = e.relations.find((r) => r.type === "in")?.to;
    if (holder === undefined) return null;
    id = holder;
  }
  return null;
}

function posEvent(entity: EntityId, at: GridSpot | null, from: GridSpot | null): LedgerEvent {
  const data: JsonObject = { entity, at: at ? { ...at } : null, from: from ? { ...from } : null };
  return { type: POS_EVENT, data };
}

/** A cell set without the grid system: the `set` events for whichever of x and y change. */
function setCell(entity: EntityId, fields: JsonObject, cell: Cell): LedgerEvent[] {
  return [...(fields.x !== cell.x ? [{ type: "set" as const, entity, field: "x", value: cell.x }] : []), ...(fields.y !== cell.y ? [{ type: "set" as const, entity, field: "y", value: cell.y }] : [])];
}

/**
 * Where someone arriving at a place stands (the `space.arrival` service): from Space 3, the POV
 * on the cell the place is drawn at; with the grid system on, at a gridded place's entrance or the
 * middle of a room's area too, and off any grid (its cell cleared) when the place has none.
 */
export function arrivalEvents(ctx: ReadContext, entity: EntityId, to: PlaceId): LedgerEvent[] {
  const e = own(ctx.state.entities, entity);
  if (!e || entity !== ctx.world.pov || ctx.levelOf(entity, "space") < 3) return [];
  if (!mapSettingsOf(ctx.world).grid.movement) {
    const cell = own(ctx.world.places, to)?.cell;
    return cell ? setCell(entity, e.fields, cell) : [];
  }
  const from = spotOf(ctx.world, ctx.state, entity);
  const at = arrivalCell(ctx.world, to);
  if (at) return [posEvent(entity, { scope: at.scope, x: at.cell.x, y: at.cell.y }, from)];
  return typeof e.fields.x === "number" || typeof e.fields.y === "number" ? [posEvent(entity, null, from)] : [];
}

/**
 * A step to a cell of the grid someone stands on (the `space.step` effect). With the grid system
 * on, crossing into a room's area puts them in that room (at its entrance when it has a grid of its
 * own), and out on open floor in the place the grid draws; walls and blocked cells stop them. Off,
 * the step only sets the cell.
 */
export function stepEvents(ctx: ReadContext, entity: EntityId, to: Cell): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, entity);
  if (!e) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, entity)}` };
  const here = placeOfEntity(ctx.state, entity);
  const stand = standingGrid(ctx.world, here);
  const index = stand ? cellIndex(stand.grid, to) : null;
  if (!stand || here === null) return { code: "off_grid", reason: `${labelOf(ctx, entity)} isn't on a map's grid here` };
  if (index === null) return { code: "off_grid", reason: "That spot isn't on this map." };
  if (!mapSettingsOf(ctx.world).grid.movement) return setCell(entity, e.fields, to);
  const from = spotOf(ctx.world, ctx.state, entity);
  if (!from || from.scope !== stand.scope) return { code: "off_grid", reason: `${labelOf(ctx, entity)} isn't standing on this map` };
  if (!findPath(stand.grid, from, to)) return { code: "no_way", reason: "There's no way there from here." };
  const room = areaPlaceAt(ctx.world, stand.scope, stand.grid, index) ?? stand.scope;
  if (room === here) return [posEvent(entity, { scope: stand.scope, x: to.x, y: to.y }, from)];
  const out: LedgerEvent[] = e.relations.filter((r) => r.type === "in").map((r) => ({ type: "unlink" as const, rel: "in", from: entity, to: r.to }));
  out.push({ type: "set", entity, field: "place", value: room });
  // A room with a grid of its own is a map of its own: it is entered at its entrance, on that grid.
  const inner = room !== stand.scope ? gridOf(ctx.world, room) : undefined;
  const entry = inner ? entranceCell(inner) : null;
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
  const spot = by !== null && place !== null && mapSettingsOf(ctx.world).grid.movement ? spotOf(ctx.world, ctx.state, by) : null;
  if (spot && place !== null && standingGrid(ctx.world, place)?.scope === spot.scope) return [posEvent(thing, spot, null)];
  return typeof e.fields.x === "number" || typeof e.fields.y === "number" ? [posEvent(thing, null, null)] : [];
}

/**
 * Whether `a` can reach `b` (the `reach` formula, DESIGN §11): `b` is `a`, or something `a`
 * carries; or it is where `a` is. While the grid system has both on one grid, that means on `a`'s
 * cell or one of the eight around it; otherwise at the same place.
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
  if (sa && sb && sa.scope === sb.scope) return Math.max(Math.abs(sa.x - sb.x), Math.abs(sa.y - sb.y)) <= 1;
  return placeOfEntity(state, b) === here;
}

/**
 * Whether a `space.pos` event steps into a grid trigger's zone or onto its cell (the `space.entered`
 * query, DESIGN §10): the new cell is inside it, the one before wasn't (or was on another grid), the
 * grid is the trigger's (`in`), and the one moving is the POV, or matches `who`.
 */
export function entered(ctx: ReadContext, on: GridTrigger, e: LedgerEvent): boolean {
  if (e.type !== POS_EVENT || !("data" in e)) return false;
  const at = spotData(e.data.at);
  const entity = strOf(e.data.entity);
  if (!at || (on.in !== undefined && on.in !== at.scope)) return false;
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
