// Vehicles pack (DESIGN §9.3): road, marine and off-road kinds; fuel type, capacity and consumption
// by mode, terrain and load; range; odometer or engine hours; condition; maintenance; status;
// location and home base; owner; assigned-to (a use grant with the gear pack's overdue semantics);
// passengers and cargo as containment; refuel, service and repair through `economy.charge`;
// seeded breakdowns.
//
// Level contract (domain `vehicles`):
//   0  off
//   1  "runs fine": no fuel or wear
//   2  fuel %, location, owner
//   3  specs, consumption, odometer / engine hours, use grants, home base
//   4  maintenance intervals, seeded breakdowns, insurance; marine and off-road specifics

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId, TravelMode } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import type { DataTable, ShippedRevision, TableRow } from "../../../shared/tables";
import { ownersIn } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { matchVehicleClass, saysNew, shortClassName, USED_VEHICLE_AGE_YEARS, vehicleDomainOf, vehicleNameFrom, vehiclesConfigOf, type VehicleDomain, type VehiclePrice, type VehicleSpawn } from "../../../shared/vehicles";
import type { KindDef } from "../../../shared/world";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { bump, labelOf, numOf, objOf, optionalQuery, optionalService, own, rowOf, strOf } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { fieldDef, isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { partyAt, relocate } from "../../../engine/relocate";
import { ownsThrough } from "../../../engine/org";
import { passMemo } from "../../../engine/read-pass";
import { calendarOf, dateAt, formatClock } from "../../../engine/calendar";
import { sentence, thingDescription, thingDetails, thingName } from "../../../engine/thing-words";
import { canSeeEntity, canSeeField, canSeePlace, knows } from "../../../engine/visibility";
import { fieldNoun } from "../../../shared/words";
import { accessOf, owns } from "../../../engine/access";
import { useTier, vehiclesFor } from "./access";
import { siteOf, together } from "../../../engine/presence";
import type { FeedLine } from "../../../engine/registry";
import type { FeedScope } from "../../../shared/world";
import { buildGarageView } from "./view";
import classes from "./tables/modern-us/classes.json";
import factors from "./tables/modern-us/factors.json";
import shipped from "./tables/modern-us/shipped.json";
import type { TravelPart, VehicleTrip } from "../../../shared/travel";
import { travelTuningOf } from "../../../shared/maps";

const TABLES: DataTable[] = [classes, factors] as unknown as DataTable[];
/** Every revision each table has shipped as (the table build's record). */
const SHIPPED = shipped as unknown as Readonly<Record<string, readonly ShippedRevision[]>>;
const KM_TO_MI = 0.621371;

export interface Leg {
  minutes: number;
  distanceKm: number;
  terrain?: string | null;
  mode: TravelMode;
}

export interface TravelOption {
  to: PlaceId;
  label: string;
  mode: TravelMode;
  /** The whole trip: the sum of its parts. */
  minutes: number;
  parts: TravelPart[];
  vehicle: string;
  action: string;
  params: JsonObject;
  disabled?: string;
}

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Fuel, odometer or engine hours, and (level 4, with an rng) breakdowns for one trip. */
    "vehicle.consume": (ctx: ReadContext, vehicle: EntityId, leg: Leg, rng?: Rng) => LedgerEvent[];
    /** A vehicle of a class made in play (a purchase, a make): its fields from the class and the details, where it stands, whose it is and its home base. */
    "vehicles.spawn": (ctx: ReadContext, spec: VehicleSpawn) => { entity: EntityId; events: LedgerEvent[] } | Rejection;
  }
  interface QueryMap {
    /** Whether the vehicle has fuel for the trip (always true below Vehicles level 2). */
    fuel_ok: (ctx: ReadContext, vehicle: EntityId, leg: Leg) => boolean;
    /** Drive, ride or sail options from a place for the POV's vehicles (the map panel). */
    "vehicles.travel_options": (ctx: ReadContext, from: PlaceId) => TravelOption[];
    /** Each insured vehicle's monthly premium, its owner and its name: the economy pays it as a flow linked to the vehicle. */
    "vehicles.insurance": (ctx: ReadContext) => { vehicle: EntityId; owner: EntityId; cents: number; label: string }[];
    /** Each registered vehicle's yearly fee, its owner, its name and the month it renews, where the world registers vehicles (Vehicles 4, `packs.vehicles.config.registration`). */
    "vehicles.registration": (ctx: ReadContext) => { vehicle: EntityId; owner: EntityId; cents: number; label: string; month: number }[];
    /** What each vehicle is worth: its own `value`, else its class's typical used price; the economy counts it in its owners' net worth. */
    "vehicles.values": (ctx: ReadContext) => { vehicle: EntityId; cents: number }[];
    /** The vehicles `who` may drive (the one reader, `vehiclesFor`): owned, a household's or company's, staff's, granted or permitted. */
    "vehicles.for": (ctx: ReadContext, who: EntityId) => EntityId[];
    /** The class words buy (or `cls`, a class row given) and its price (`economy.buy`'s quote, after the catalog): used unless they say new. Null when they name no class. */
    "vehicles.priced": (ctx: ReadContext, words: string, place: PlaceId | null, cls?: string) => VehiclePrice | null;
    /** The class a purchase's main noun phrase names as what it buys (`economy.buy`'s quote, `economy.unpriced`): one whose name ends it, the longest ("flatbed truck", "jet ski", "Cessna 172"). Null when none does ("plane ticket", "car insurance"). */
    "vehicles.named": (ctx: ReadContext, noun: string) => string | null;
  }
}

export const VEHICLE: KindDef = {
  id: "vehicle",
  label: "Vehicle",
  extends: "container",
  pack: "vehicles",
  fields: {
    // What it is, as its author or the GM tells it: the Vehicles section names each one it has.
    make: { type: "text", label: "Make" },
    model: { type: "text", label: "Model" },
    year: { type: "number", label: "Year" },
    colour: { type: "text", label: "Colour" },
    plate: { type: "text", label: "Plate" },
    // Named for the vehicle, so Build doesn't read it as one of the world's own classifications.
    class: { type: "text", label: "Vehicle class" },
    status: { type: "enum", label: "Status", values: ["ok", "needs_service", "broken"], default: "ok", domain: "vehicles", level: 1, bound: { mode: "confirm" } },
    fuel_pct: { type: "number", label: "Fuel %", min: 0, max: 100, domain: "vehicles", level: 2, bound: { mode: "auto" } },
    odometer_mi: { type: "number", label: "Odometer (mi)", min: 0, domain: "vehicles", level: 3, locked: true },
    engine_hours: { type: "number", label: "Engine hours", min: 0, domain: "vehicles", level: 3, locked: true },
    home: { type: "ref", label: "Home base", domain: "vehicles", level: 3 },
    last_service: { type: "number", label: "Last service (mi or h)", min: 0, domain: "vehicles", level: 4 },
    // What it would sell for, when its author or the GM says; else its class's typical used price.
    value: { type: "money", label: "Value", min: 0, domain: "money", level: 3 },
  },
};

function classRow(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): TableRow | undefined {
  return rowOf(ctx, "vehicles.classes", strOf(own(ctx.state.entities, vehicle)?.fields.class));
}

/** Whether it burns fuel: a known class with a fuel. A trailer, or a vehicle of no class the tables know, has no tank, so it shows no fuel or range. */
function burnsFuel(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): boolean {
  const row = classRow(ctx, vehicle);
  return row !== undefined && strOf(row.fuel_type, "gasoline") !== "none";
}

/**
 * A vehicle's fields its Vehicles line tells its own way, not as `label value`: its class by the
 * table's name for it, its fuel with the range it gives, its status, and its last service as when
 * the next is due.
 */
const TOLD_APART: Readonly<Record<string, true>> = { class: true, fuel_pct: true, status: true, last_service: true };

/**
 * The Vehicles section (DESIGN §6, §6.11, §9.3): what the player character may use, his own; from
 * level 2 his groups' (his family's), with whose they are; from level 3 the ones assigned or lent
 * to him. Each one he may use gets a line with everything the world keeps of it that he may see:
 * where it is and whose, its class, every field its kind defines that it has set, by the kind's
 * labels (make, model, year, colour, plate, odometer or engine hours, condition from level 3, its
 * value), fuel and range and its status from level 2, when its next service is due from level 4,
 * who is aboard and its cargo by name (for one at his site; what a thing in it holds only when the
 * vehicle or the thing is his, or he knows of what it holds), and its description. Then other
 * people's vehicles at his site that he can see, each with whose it is and what anyone sees of it
 * (its class, its fields of no realism domain, its description). The ones he may use away from his
 * site come last, each named with where it is, so a section trimmed to the budget loses those
 * first. Owners are named only as he may know them. In `scene` scope a vehicle here he can't see is
 * added, marked, when its owner is with him and can see it (a secret one never: no one can), its
 * place as the owner may know it; in `gm`, every one at his site, by real name.
 */
export function vehicleLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "vehicles");
  if (level === 0) return [];
  const see = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
  const cal = calendarOf(ctx.world);
  // What he may drive, and what it rests on (the one reader): his own from level 1, his household's or company's from 2, what is assigned, lent or permitted from 3.
  const uses = new Map(vehiclesFor(ctx, pov).map((u) => [u.id, u]));
  const here = placeOfEntity(ctx.state, pov);
  const site = siteOf(ctx.world, here);
  const ownerName = (owner: EntityId): string => (see(pov, owner) ? (own(ctx.state.entities, owner)?.name ?? "someone") : "someone");
  const placeText = (place: PlaceId | null): string => (!place ? "at an unknown place" : canSeePlace(ctx.registry, ctx.world, ctx.state, pov, place) ? `at ${own(ctx.world.places, place)?.name ?? place}` : "somewhere");
  // Its class by the table's name for it, under the kind's label for the field ("vehicle class Midsize pickup").
  const classText = (v: EntityId, kind: string): string[] => {
    const name = classRow(ctx, v)?.name;
    if (typeof name !== "string" || name.trim() === "" || !canSeeField(ctx.registry, ctx.world, ctx.state, pov, v, "class")) return [];
    return [`${fieldNoun(fieldDef(ctx.registry, ctx.world, kind, "class")?.label, "class").noun} ${name.trim()}`];
  };
  // What is in a holder, as far as he can see.
  const contents = (holder: EntityId): EntityId[] =>
    Object.keys(ctx.state.entities)
      .sort()
      .filter((id) => !isGone(ctx.state, id) && see(pov, id) && own(ctx.state.entities, id)?.relations.some((r) => r.type === "in" && r.to === holder));
  // A thing in a vehicle by name, with what it holds only where he may look: in his own vehicle or
  // his own thing, or a thing in it he knows of. Another's bag in a car lent to him stays shut, as
  // People and Place never tell what is inside another's things.
  const named = (id: EntityId, depth: number, mine: boolean): string => {
    const open = mine || owns(ctx, pov, id);
    const inner = depth >= 8 ? [] : contents(id).filter((x) => open || knows(ctx.state, pov, x)).map((x) => named(x, depth + 1, mine));
    return `${thingName(ctx, id)}${inner.length > 0 ? ` (holding ${inner.join(", ")})` : ""}`;
  };
  const usable: FeedLine[] = [];
  const away: FeedLine[] = [];
  const others: { v: EntityId; owner: EntityId | null; place: PlaceId | null }[] = [];
  for (const v of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, v);
    if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || isGone(ctx.state, v)) continue;
    const stated = accessOf(ctx.state, v).owners[0]?.party ?? null;
    const u = uses.get(v);
    const owner = u?.owner ?? stated;
    const place = placeOfEntity(ctx.state, v);
    const whose = !u || useTier(u.use) > level ? null : u.mine ? "yours" : u.use.basis === "grant" ? `${owner ? `${ownerName(owner)}'s, ` : ""}${u.use.until !== undefined ? `lent to you until ${formatClock(cal, u.use.until)}` : "assigned to you"}` : `${owner ? ownerName(owner) : "someone"}'s${u.use.basis === "staff" ? ", yours to use at work" : u.use.basis === "permit" ? ", yours to use" : ""}`;
    if (whose === null || !u) {
      // Someone else's: told when it is at his site.
      if (site !== null && siteOf(ctx.world, place) === site) others.push({ v, owner: stated, place });
      continue;
    }
    if (!u.mine && !see(pov, v)) continue;
    const elsewhere = site !== null && siteOf(ctx.world, place) !== site;
    // The narrator hears where it is as the player may: a place the POV can't see is somewhere.
    const head = [placeText(place), ...(level === 1 ? [] : [whose]), ...(elsewhere ? ["away from here"] : [])];
    const parts = classText(v, e.kind);
    if (level === 1) parts.push(e.fields.status === "broken" ? "broken down" : "runs fine");
    else {
      if (burnsFuel(ctx, v)) {
        const range = rangeLeft(ctx, v);
        parts.push(`fuel ${Math.round(numOf(e.fields.fuel_pct, 100))}%${range ? `, about ${Math.round(range.value)} ${range.unit} left` : ""}`);
      }
      if (e.fields.status !== "ok" && e.fields.status !== undefined) parts.push(String(e.fields.status).replace(/_/g, " "));
    }
    // Its wear is told from Vehicles 3, as the Garage shows it.
    parts.push(...thingDetails(ctx, v, (field) => TOLD_APART[field] === true || (field === "condition" && level < 3)));
    const interval = level >= 4 ? serviceInterval(ctx, v) : null;
    if (interval !== null && canSeeField(ctx.registry, ctx.world, ctx.state, pov, v, "last_service")) {
      const unit = domainOf(ctx, v) === "road" ? "mi" : "h";
      const due = Math.round(numOf(e.fields.last_service) + interval).toLocaleString("en-US");
      parts.push(usage(ctx, v) > numOf(e.fields.last_service) + interval ? `service overdue (it was due at ${due} ${unit})` : `next service due at ${due} ${unit}`);
    }
    // Who and what is in it only for one at his site: one away from here he can't see into.
    const inside = elsewhere ? [] : contents(v);
    const aboard = inside.filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person")).map((id) => (id === pov ? "you" : (own(ctx.state.entities, id)?.name ?? id)));
    const cargo = inside.filter((id) => !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person")).map((id) => named(id, 0, owns(ctx, pov, v)));
    const description = thingDescription(ctx, v);
    const text = [
      `${e.name}: ${[head.join(", "), ...parts].join("; ")}.`,
      ...(aboard.length > 0 ? [`Aboard: ${aboard.join(", ")}.`] : []),
      ...(cargo.length > 0 ? [`Cargo: ${cargo.join(", ")}.`] : []),
      ...(description ? [sentence(description)] : []),
    ].join(" ");
    (elsewhere ? away : usable).push({ text, known: "pov" });
  }
  // Other people's vehicles at his site: every one he can see, with whose it is and what anyone sees of it.
  const seen = others
    .filter((o) => see(pov, o.v))
    .map((o): FeedLine => {
      const e = own(ctx.state.entities, o.v);
      const looks = e ? [...classText(o.v, e.kind), ...thingDetails(ctx, o.v, (field, def) => TOLD_APART[field] === true || def.domain !== undefined)] : [];
      const description = thingDescription(ctx, o.v);
      return { text: `${e?.name ?? o.v}: ${[`${placeText(o.place)}, ${o.owner ? `${ownerName(o.owner)}'s` : "no one's you know of"}`, ...looks].join("; ")}.${description ? ` ${sentence(description)}` : ""}`, known: "pov" };
    });
  const lines = [...usable, ...seen, ...away];
  if (scope === "player") return lines;
  for (const o of others.filter((x) => !see(pov, x.v))) {
    const name = own(ctx.state.entities, o.v)?.name ?? o.v;
    const ownerName = o.owner ? (own(ctx.state.entities, o.owner)?.name ?? o.owner) : null;
    // Scene facts are only what someone with him can see by the visibility rules; the rest is the GM's.
    const knower = o.owner !== null && see(pov, o.owner) && see(o.owner, o.v) && together(ctx.world, here, placeOfEntity(ctx.state, o.owner)) ? o.owner : null;
    if (knower && ownerName) {
      const where = o.place && canSeePlace(ctx.registry, ctx.world, ctx.state, knower, o.place) ? `at ${own(ctx.world.places, o.place)?.name ?? o.place}` : "somewhere";
      lines.push({ text: `${name}: ${where}, ${ownerName}'s.`, known: "scene", who: ownerName });
    } else if (scope === "gm") lines.push({ text: `${name}: at ${o.place ? (own(ctx.world.places, o.place)?.name ?? o.place) : "an unknown place"}, ${ownerName ? `${ownerName}'s` : "no one's"}.`, known: "gm" });
  }
  return lines;
}

/** The class domain: road, marine, offroad or air. */
function domainOf(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): VehicleDomain {
  const row = classRow(ctx, vehicle);
  return row ? vehicleDomainOf(row) : vehicleDomainOf({ domain: strOf(own(ctx.state.entities, vehicle)?.fields.domain, "road") });
}

/** The travel modes a vehicle can use: an aircraft flies only over the routes the world authors for the air. */
export function modesOf(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): TravelMode[] {
  const d = domainOf(ctx, vehicle);
  return d === "marine" ? ["water"] : d === "air" ? ["air"] : d === "offroad" ? ["offroad", "road"] : ["road"];
}

function factor(ctx: ReadContext, guide: string, key: string): number {
  return numOf(own(objOf(rowOf(ctx, "vehicles.factors", guide)?.factors), key), 1);
}

/** The terrain factor a leg applies (road guide terms; Vehicles level 4 reads terrain). */
function terrainFactor(ctx: ReadContext, guide: string, terrain: string | null | undefined): number {
  if (!terrain) return 1;
  if (guide === "road") {
    if (/dirt|gravel|trail/.test(terrain)) return factor(ctx, "road", "off_pavement_dirt_gravel");
    if (/sand|mud|snow/.test(terrain)) return factor(ctx, "road", "sand_mud_snow");
    return 1;
  }
  if (guide === "offroad") return /sand|mud|dune/.test(terrain) ? factor(ctx, "offroad", "sand_dunes_deep_mud") : /rock|climb/.test(terrain) ? factor(ctx, "offroad", "technical_climb_rock") : 1;
  if (guide === "marine") return /chop|rough/.test(terrain) ? factor(ctx, "marine", "rough_chop_head_sea") : 1;
  return 1;
}

export interface FuelUse {
  /** Percentage points of the tank or battery the trip uses. */
  pct: number;
  miles: number;
  hours: number;
}

/** Fuel for a leg: distance over mpg (or mi/kWh) on roads, rate × hours on water and trails; × terrain and load factors. */
export function fuelUse(ctx: ReadContext, vehicle: EntityId, leg: Leg): FuelUse {
  const row = classRow(ctx, vehicle);
  const e = own(ctx.state.entities, vehicle);
  const miles = leg.distanceKm * KM_TO_MI;
  const hours = leg.minutes / 60;
  if (!row || !e || strOf(row.fuel_type) === "none") return { pct: 0, miles, hours };
  const guide = strOf(row.factor_guide, domainOf(ctx, vehicle));
  const level = ownerLevel(ctx, vehicle);
  let mult = level >= 4 ? terrainFactor(ctx, guide, leg.terrain) : 1;
  const payload = numOf(row.payload_kg);
  const cargoKg = Object.values(ctx.state.entities).filter((x) => x.relations.some((r) => r.type === "in" && r.to === vehicle)).reduce((a, x) => a + numOf(x.fields.weight_g) / 1000, 0);
  if (level >= 4 && payload > 0 && cargoKg > payload / 2) mult *= guide === "road" ? factor(ctx, "road", "loaded_to_payload") : guide === "marine" ? factor(ctx, "marine", "heavy_load_full_crew") : guide === "air" ? factor(ctx, "air", "max_gross_weight") : factor(ctx, "offroad", "two_up_or_loaded_cargo");
  const consumption = objOf(row.consumption);
  const unit = strOf(row.consumption_unit);
  if (unit === "mpg" || unit === "mi_per_kwh") {
    const rate = numOf(consumption.combined, numOf(consumption.highway, 25));
    const used = rate > 0 ? (miles / rate) * mult : 0;
    const capacity = unit === "mpg" ? numOf(row.tank_capacity_gal, 15) : numOf(row.usable_battery_kwh, 60);
    return { pct: (used / capacity) * 100, miles, hours };
  }
  const perHour = guide === "marine" ? numOf(consumption.cruise_planing, 5) : guide === "air" ? numOf(consumption.cruise, 9) : numOf(consumption.normal_trail, 1.5);
  const capacity = numOf(row.tank_capacity_gal, 10);
  return { pct: ((perHour * hours * mult) / capacity) * 100, miles, hours };
}

/** The realism level a vehicle runs at: its first owner's (an `owner`, or the first of an `owners` list), else the POV's. */
function ownerLevel(ctx: ReadContext, vehicle: EntityId): number {
  const owner = ownersIn(own(ctx.state.entities, vehicle)?.fields ?? {})[0]?.party;
  return ctx.levelOf(owner !== undefined && own(ctx.state.entities, owner) ? owner : ctx.world.pov, "vehicles");
}

/** Maintenance interval in miles (road) or hours (marine, off-road), or null. */
export function serviceInterval(ctx: ReadContext, vehicle: EntityId): number | null {
  const m = objOf(classRow(ctx, vehicle)?.maintenance);
  const v = m.oil_change_interval_miles ?? m.engine_service_interval_hours ?? m.service_interval_hours ?? m.service_interval_miles;
  return typeof v === "number" ? v : null;
}

function usage(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): number {
  const e = own(ctx.state.entities, vehicle);
  return domainOf(ctx, vehicle) === "road" ? numOf(e?.fields.odometer_mi) : numOf(e?.fields.engine_hours);
}

const consume = (ctx: ReadContext, vehicle: EntityId, leg: Leg, rng?: Rng): LedgerEvent[] => {
  const e = own(ctx.state.entities, vehicle);
  const level = ownerLevel(ctx, vehicle);
  if (!e || level < 2) return [];
  const out: LedgerEvent[] = [];
  const use = fuelUse(ctx, vehicle, leg);
  const fuel = numOf(e.fields.fuel_pct, 100);
  const delta = -Math.min(fuel, Math.round(use.pct * 10) / 10);
  if (delta !== 0) out.push(bump(ctx.state, vehicle, "fuel_pct", delta, fuel));
  if (level >= 3) {
    if (domainOf(ctx, vehicle) === "road") {
      if (use.miles > 0) out.push({ type: "add", entity: vehicle, field: "odometer_mi", delta: Math.round(use.miles * 10) / 10 });
    } else if (use.hours > 0) out.push({ type: "add", entity: vehicle, field: "engine_hours", delta: Math.round(use.hours * 100) / 100 });
  }
  if (level >= 4 && rng) {
    const interval = serviceInterval(ctx, vehicle);
    const overdue = interval !== null && usage(ctx, vehicle) - numOf(e.fields.last_service) > interval;
    const condition = numOf(e.fields.condition, 80);
    const units = domainOf(ctx, vehicle) === "road" ? use.miles / 10 : use.hours;
    const p = Math.min(0.5, 0.002 * units * (1 + (100 - condition) / 50) * (overdue ? 2 : 1));
    if (rng.next() < p) {
      out.push({ type: "set", entity: vehicle, field: "status", value: "broken" });
      out.push({ type: ENGINE_EVENTS.signal, data: { class: "incident", text: `${e.name} breaks down.`, entity: vehicle } });
    }
  }
  return out;
};

/**
 * Trips for a vehicle from where its driver is to each of `targets` (DESIGN §9.1): the walk to it
 * when it's parked elsewhere, the drive over every mode it goes by at the world's speeds (its
 * class's first), and the walk from where it's left when it can't reach the place itself. It is
 * left only at a place the player character may know, since the Getting there rows name it,
 * whoever drives, so a trip plans the same wherever it is asked for.
 */
function tripsFor(ctx: ReadContext, vehicle: EntityId, from: PlaceId, targets: readonly PlaceId[]): Map<PlaceId, VehicleTrip> {
  const plan = optionalQuery(ctx, "space.vehicle_trips");
  const at = placeOfEntity(ctx.state, vehicle);
  if (!plan || !at) return new Map();
  const cls = strOf(own(ctx.state.entities, vehicle)?.fields.class);
  const speed = cls === "" ? undefined : own(travelTuningOf(ctx.world).vehicleSpeeds, cls);
  const pov = ctx.world.pov;
  return plan(ctx, { from, at, modes: modesOf(ctx, vehicle), ...(speed !== undefined ? { speed } : {}), canPark: (p) => canSeePlace(ctx.registry, ctx.world, ctx.state, pov, p) }, targets);
}

/** One trip, kept for the read pass: Drive's options ask each one's fuel and minutes, through formulas of their own. */
function tripFor(ctx: ReadContext, vehicle: EntityId, from: PlaceId, to: PlaceId): VehicleTrip | null {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `vehicles.trip\u0000${vehicle}\u0000${from}\u0000${to}`, () => tripsFor(ctx, vehicle, from, [to]).get(to) ?? null);
}

/** The drive of a trip, as fuel and wear read it. */
function legOf(trip: VehicleTrip): Leg {
  return { minutes: trip.drive.minutes, distanceKm: trip.drive.distanceKm, terrain: trip.drive.legs.find((l) => l.terrain)?.terrain ?? null, mode: trip.drive.mode };
}

/** Where a trip starts: the place given, else where the vehicle is. */
function startOf(ctx: ReadContext, vehicle: EntityId, from: unknown): PlaceId | null {
  return typeof from === "string" && from !== "" ? from : placeOfEntity(ctx.state, vehicle);
}

const fuelOk = (ctx: ReadContext, vehicle: EntityId, leg: Leg): boolean => {
  if (ownerLevel(ctx, vehicle) < 2) return true;
  return numOf(own(ctx.state.entities, vehicle)?.fields.fuel_pct, 100) >= fuelUse(ctx, vehicle, leg).pct;
};

/** Range left in miles (road) or hours (marine, off-road) at the current fuel. */
export function rangeLeft(ctx: ReadContext, vehicle: EntityId): { value: number; unit: "mi" | "h" } | null {
  const row = classRow(ctx, vehicle);
  if (!row) return null;
  const fuel = numOf(own(ctx.state.entities, vehicle)?.fields.fuel_pct, 100);
  const road = domainOf(ctx, vehicle) === "road";
  const probe = fuelUse(ctx, vehicle, road ? { minutes: 60, distanceKm: 100 / KM_TO_MI, mode: "road" } : { minutes: 60, distanceKm: 0, mode: modesOf(ctx, vehicle)[0] ?? "water" });
  if (probe.pct <= 0) return null;
  return { value: Math.round((fuel / probe.pct) * (road ? 100 : 1) * 10) / 10, unit: road ? "mi" : "h" };
}

/** What fills a vehicle's tank: a price catalog row, else (aviation gasoline) its class's own price a gallon. */
function fuelProduct(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): { catalog: string | null; perUnit: number; unit: "gal" | "kWh"; capacity: number } {
  const row = classRow(ctx, vehicle);
  const type = strOf(row?.fuel_type, "gasoline");
  if (type === "electricity") return { catalog: "ev_public_l2_kwh", perUnit: 0, unit: "kWh", capacity: numOf(row?.usable_battery_kwh, 60) };
  if (type === "avgas") return { catalog: null, perUnit: numOf(objOf(row?.fuel_cents_per_gal).typical, 700), unit: "gal", capacity: numOf(row?.tank_capacity_gal, 50) };
  const marine = domainOf(ctx, vehicle) === "marine";
  return { catalog: type === "diesel" ? (marine ? "marine_diesel" : "diesel") : marine ? "marine_gasoline" : "gasoline_regular", perUnit: 0, unit: "gal", capacity: numOf(row?.tank_capacity_gal, 15) };
}

/** A plate as a state's DMV issues one ("7KDX219"), the same for the same vehicle id. */
function plateFor(id: string): string {
  const h = hashParts("plate", id);
  const letters = [0, 2, 4].map((i) => String.fromCharCode(65 + (parseInt(h.slice(i, i + 2), 16) % 26))).join("");
  return `${parseInt(h.slice(6, 7), 16) % 9 + 1}${letters}${(parseInt(h.slice(8, 12), 16) % 1000).toString().padStart(3, "0")}`;
}

/**
 * A vehicle of a class made in play (DESIGN §9.3; a purchase's or a make's, ITEMS-SPEC §5.3): named
 * by the spec, else its make and model, else the class; its make, model and year from the details,
 * else the class's and (used) four years back; new, no miles and full condition and tank, used the
 * miles or hours four years give and condition 80 with half a tank (what burns nothing has no tank);
 * a road vehicle plated; owned as given; standing where given (or in a holder); home where given,
 * else at its owner's home, else where it stands.
 */
function spawnVehicle(ctx: ReadContext, spec: VehicleSpawn): { entity: EntityId; events: LedgerEvent[] } | Rejection {
  const row = rowOf(ctx, "vehicles.classes", spec.class);
  if (!row) {
    const some = Object.keys(ctx.tables.get("vehicles.classes")?.rows ?? {}).slice(0, 8);
    return reject("unknown_class", `no vehicle class ${spec.class}${some.length > 0 ? `; classes include ${some.join(", ")}` : ""}`);
  }
  const d = spec.details ?? {};
  const domain = vehicleDomainOf(row);
  const used = spec.new !== true;
  const year = dateAt(calendarOf(ctx.world), ctx.state.clock).year;
  const make = typeof d.make === "string" && d.make.trim() !== "" ? d.make.trim() : strOf(row.make);
  const model = typeof d.model === "string" && d.model.trim() !== "" ? d.model.trim() : strOf(row.model);
  const name = spec.name?.trim() || (make !== "" && model !== "" ? `${make} ${model}` : shortClassName(strOf(row.name, spec.class)));
  const holder = spec.holder && own(ctx.state.entities, spec.holder) ? spec.holder : null;
  const place = holder ? null : (spec.place ?? null);
  // Its id is its salt's, as a made thing's (`madeId`): the same make or purchase checked again after the read's changes and the time they took, or applied from its review card, makes the same vehicle, so the changes that name it still find it.
  let id = `vehicle:${hashParts("vehicle", spec.class, name, spec.owner ?? "", spec.salt ?? "").slice(0, 12)}`;
  for (let n = 2; own(ctx.state.entities, id); n++) id = `vehicle:${hashParts("vehicle", spec.class, name, spec.owner ?? "", spec.salt ?? "", String(n)).slice(0, 12)}`;
  const ownerHome = spec.owner ? own(ctx.state.entities, spec.owner)?.fields.home : undefined;
  const home = spec.home ?? (typeof ownerHome === "string" && own(ctx.world.places, ownerHome) ? ownerHome : place);
  const burns = strOf(row.fuel_type) !== "none";
  const fields: JsonObject = { class: spec.class, status: "ok" };
  if (spec.owner) fields.owner = spec.owner;
  if (make !== "") fields.make = make;
  if (model !== "") fields.model = model;
  fields.year = typeof d.year === "number" && Number.isFinite(d.year) ? Math.round(d.year) : used ? year - USED_VEHICLE_AGE_YEARS : year;
  if (typeof d.colour === "string" && d.colour.trim() !== "") fields.colour = d.colour.trim();
  if (typeof d.plate === "string" && d.plate.trim() !== "") fields.plate = d.plate.trim();
  else if (domain === "road" && burns) fields.plate = plateFor(id);
  if (domain === "road") fields.odometer_mi = typeof d.odometer_mi === "number" ? d.odometer_mi : used ? 12000 * USED_VEHICLE_AGE_YEARS : 10;
  else if (burns) fields.engine_hours = typeof d.engine_hours === "number" ? d.engine_hours : used ? 60 * USED_VEHICLE_AGE_YEARS : 1;
  fields.condition = typeof d.condition === "number" ? d.condition : used ? 80 : 100;
  if (burns) fields.fuel_pct = typeof d.fuel_pct === "number" ? d.fuel_pct : used ? 50 : 100;
  if (typeof d.value === "number" && d.value > 0) fields.value = Math.round(d.value);
  if (home) fields.home = home;
  if (place) fields.place = place;
  Object.assign(fields, spec.fields ?? {});
  return { entity: id, events: [{ type: "spawn", entity: { id, kind: "vehicle", name, tier: "background", fields, relations: holder ? [{ type: "in", to: holder }] : [] } }] };
}

/** What words buy (DESIGN §9.5): the class they name, used unless they say new, at the class's typical price of that kind. */
function pricedVehicle(ctx: ReadContext, words: string, given?: string): VehiclePrice | null {
  const table = ctx.tables.get("vehicles.classes");
  const cls = given !== undefined && own(table?.rows ?? {}, given) ? given : matchVehicleClass(words, table);
  const row = cls ? own(table?.rows ?? {}, cls) : undefined;
  if (!cls || !row) return null;
  const fresh = saysNew(words);
  const raw = objOf(fresh ? row.price_new_cents : row.price_used_cents);
  const band = { min: Math.round(numOf(raw.min)), typical: Math.round(numOf(raw.typical)), max: Math.round(numOf(raw.max)) };
  if (!(band.typical > 0)) return null;
  return { class: cls, name: vehicleNameFrom(words, strOf(row.name, cls)), new: fresh, band, cents: band.typical };
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** Charges through the economy pack when it is loaded; free otherwise. */
function charge(ctx: ReadContext, payer: EntityId, cents: number, memo: string, category: string, recurring = false): LedgerEvent[] | Rejection {
  const svc = optionalService(ctx, "economy.charge");
  if (!svc || cents <= 0) return [];
  return svc(ctx, payer, cents, memo, { category, ...(recurring ? { method: "account" as const } : {}) });
}

function priceOf(ctx: ReadContext, catalog: string, qty: number): number {
  const price = optionalQuery(ctx, "economy.price");
  const p = price ? price(ctx, { catalog, qty }) : null;
  const row = rowOf(ctx, "economy.catalog", catalog);
  return p ? p.cents : Math.round(numOf(objOf(row?.price_cents).typical) * qty);
}

export const vehiclesPack: PackDef = {
  id: "vehicles",
  label: "Vehicles",
  version: 1,
  domain: "vehicles",
  requires: ["space", "gear", "economy"],
  register(r) {
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t, shipped: SHIPPED[t.id] ?? [] });
    r.kind(VEHICLE);
    r.service("vehicle.consume", consume);
    r.query("fuel_ok", fuelOk);
    r.query("vehicles.travel_options", (ctx, from) => {
      const out: TravelOption[] = [];
      const pov = ctx.world.pov;
      const walk = optionalQuery(ctx, "space.route");
      const targets = Object.keys(ctx.world.places)
        .sort()
        .filter((to) => to !== from);
      const placeName = (p: PlaceId): string => own(ctx.world.places, p)?.name ?? p;
      const home = own(ctx.state.entities, pov)?.fields.home;
      for (const v of vehiclesFor(ctx, pov).map((u) => u.id)) {
        const e = own(ctx.state.entities, v);
        if (!e) continue;
        const at = placeOfEntity(ctx.state, v);
        // One parked elsewhere is offered where the player character may know it is: the row says where.
        if (!at || (at !== from && !canSeePlace(ctx.registry, ctx.world, ctx.state, pov, at))) continue;
        const named = /^(your|my|the|a|an)\s/i.test(e.name) ? e.name.charAt(0).toLowerCase() + e.name.slice(1) : `the ${e.name}`;
        for (const [to, trip] of tripsFor(ctx, v, from, targets)) {
          // Left short of the place, a trip is worth offering only when it beats walking there.
          const direct = walk ? walk(ctx, from, to, "walk") : null;
          if (trip.park !== to && direct && trip.minutes >= direct.minutes) continue;
          const leg = legOf(trip);
          const why = e.fields.status === "broken" ? "broken down" : !fuelOk(ctx, v, leg) ? "not enough fuel" : undefined;
          const sail = trip.drive.mode === "water";
          const fly = trip.drive.mode === "air";
          const parts: TravelPart[] = [];
          if (trip.fetch) parts.push({ kind: "fetch", minutes: trip.fetch.minutes, words: `to reach it ${at === home ? "at home" : `at ${placeName(at)}`}` });
          if (trip.startMinutes > 0) parts.push({ kind: "start", minutes: trip.startMinutes, words: "to get going" });
          if (trip.drive.minutes > 0) parts.push({ kind: "drive", minutes: trip.drive.minutes, words: fly ? "flying" : sail ? "sailing" : "driving" });
          if (trip.parkMinutes > 0) parts.push({ kind: "park", minutes: trip.parkMinutes, words: fly ? "to land and tie down" : sail ? "to tie up" : "to park" });
          if (trip.walk && trip.walk.minutes > 0) parts.push({ kind: "walk", minutes: trip.walk.minutes, words: `on foot from ${placeName(trip.park)}` });
          out.push({ to, label: `${fly ? "Fly" : sail ? "Sail" : "Drive"} ${named} to ${placeName(to)}`, mode: trip.drive.mode, minutes: trip.minutes, parts, vehicle: e.name, action: "drive", params: { vehicle: v, to }, ...(why ? { disabled: why } : {}) });
        }
      }
      return out;
    });
    // `from`, where the trip starts (the driver's place: the drive action passes `here`), defaults
    // to where the vehicle is.
    r.formula("fuel_ok", (ctx, vehicle, to, from) => {
      const v = String(vehicle ?? "");
      const start = startOf(ctx, v, from);
      const trip = start ? tripFor(ctx, v, start, String(to ?? "")) : null;
      return trip !== null && fuelOk(ctx, v, legOf(trip));
    });
    r.formula("drive_minutes", (ctx, vehicle, to, from) => {
      const v = String(vehicle ?? "");
      const start = startOf(ctx, v, from);
      return (start ? tripFor(ctx, v, start, String(to ?? "")) : null)?.minutes ?? 0;
    });
    r.formula("fuel_pct", (ctx, vehicle) => numOf(own(ctx.state.entities, String(vehicle ?? ""))?.fields.fuel_pct, 100));

    r.effect({
      type: "vehicles.drive",
      args: ["vehicle", "to", "driver?", "riders?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const to = strOf(args.to);
        const driver = strOf(args.driver) || ctx.world.pov;
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", `no vehicle ${labelOf(ctx, v)}`);
        if (e.fields.status === "broken") return reject("broken", `${e.name} has broken down`);
        // The trip starts where the driver is: they walk to the vehicle when it's parked elsewhere.
        // An effect tells what happened, so a driver too far to fetch it (a rule's "the tow truck
        // takes you there") still rides it from where it stands.
        const driverAt = placeOfEntity(ctx.state, driver);
        const vehicleAt = placeOfEntity(ctx.state, v);
        // Driving a vehicle to where it already is would only take it away to park and walk back.
        if (vehicleAt === to) return reject("already_there", `${e.name} is at ${labelOf(ctx, to)} already: walk there`);
        const trip = (driverAt ? tripFor(ctx, v, driverAt, to) : null) ?? (vehicleAt && vehicleAt !== driverAt ? tripFor(ctx, v, vehicleAt, to) : null);
        if (!trip) return reject("no_route", `no route for ${e.name} to ${labelOf(ctx, to)}`);
        const leg = legOf(trip);
        if (!fuelOk(ctx, v, leg)) return reject("no_fuel", `${e.name} doesn't have the fuel`);
        const out: LedgerEvent[] = [...consume(ctx, v, leg, ctx.rng), { type: "set", entity: v, field: "place", value: trip.park }];
        // The driver and anyone riding along (people at the same place named in `riders`, and the
        // player character's party when it drives) arrive too, through the one move path. Whoever
        // rides inside the vehicle goes with it, unless it's left short of the place: then the
        // driver and the riders get out and walk the rest.
        const leftShort = trip.park !== to;
        const named = Array.isArray(args.riders) ? args.riders.filter((x): x is string => typeof x === "string") : [];
        const riders = driver === ctx.world.pov ? [...named, ...partyAt(ctx, placeOfEntity(ctx.state, driver))] : named;
        const moved = new Set<string>();
        for (const p of [driver, ...riders]) {
          const pe = own(ctx.state.entities, p);
          if (!pe || moved.has(p) || (!leftShort && pe.relations.some((x) => x.type === "in" && x.to === v))) continue;
          moved.add(p);
          // A rider comes along: what they were doing stays behind, as for a Go companion.
          const events = relocate(ctx, p, to, p === driver ? {} : { along: true });
          if ("code" in events) return events;
          out.push(...events);
        }
        return out;
      },
    });
    r.effect({
      type: "vehicles.refuel",
      args: ["vehicle", "payer?", "pct?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const payer = strOf(args.payer) || ctx.world.pov;
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", `no vehicle ${labelOf(ctx, v)}`);
        if (ownerLevel(ctx, v) < 2) return [];
        const fuel = numOf(e.fields.fuel_pct, 100);
        const wanted = Math.min(100 - fuel, numOf(args.pct, 100 - fuel));
        if (wanted <= 0) return reject("full", `${e.name} is full`);
        const product = fuelProduct(ctx, v);
        const qty = Math.round(((wanted / 100) * product.capacity) * 100) / 100;
        const cents = product.catalog !== null ? priceOf(ctx, product.catalog, qty) : Math.round(product.perUnit * qty);
        const paid = charge(ctx, payer, cents, `Fuel for ${e.name} (${qty} ${product.unit})`, "fuel");
        if (!Array.isArray(paid)) return paid;
        return [...paid, bump(ctx.state, v, "fuel_pct", wanted, fuel)];
      },
    });
    r.effect({
      type: "vehicles.service",
      args: ["vehicle", "payer?", "repair?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const payer = strOf(args.payer) || ctx.world.pov;
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", `no vehicle ${labelOf(ctx, v)}`);
        const repair = args.repair === true;
        // Marine and off-road engines have no catalog service row; the oil-change row stands in.
        const cents = repair ? priceOf(ctx, "tow_hookup", 1) + priceOf(ctx, "diagnostic_fee", 1) + priceOf(ctx, "brake_pads_axle", 1) : priceOf(ctx, "oil_change_synthetic", 1);
        const paid = charge(ctx, payer, cents, `${repair ? "Repair" : "Service"}: ${e.name}`, "vehicle_services");
        if (!Array.isArray(paid)) return paid;
        const out: LedgerEvent[] = [...paid, { type: "set", entity: v, field: "status", value: "ok" }];
        if (ownerLevel(ctx, v) >= 4) out.push({ type: "set", entity: v, field: "last_service", value: usage(ctx, v) });
        const condition = numOf(e.fields.condition, 80);
        if (condition < 90) out.push(bump(ctx.state, v, "condition", Math.min(15, 90 - condition), condition));
        return out;
      },
    });

    r.action({
      id: "drive",
      label: "Drive",
      description: "Drive, ride, sail or fly a vehicle you own or may use to another place.",
      pack: "vehicles",
      params: { vehicle: { type: "ref", ref: "vehicle" }, to: { type: "ref", ref: "place", label: "Destination" } },
      // A vehicle parked elsewhere is fetched on foot, within the world's travel tuning: the trip from here says whether it can go.
      // Who may drive it is the access resolver's (ITEMS-SPEC §3.4 `may_use`), as the Vehicles section tells it usable.
      requires: ["may_use(self, vehicle)", "vehicle.status != 'broken'", "place(vehicle) != to", "drive_minutes(vehicle, to, here) > 0", "fuel_ok(vehicle, to, here)"],
      outcomes: { default: [{ type: "vehicles.drive", args: { vehicle: "vehicle", to: "=to", driver: "self" } }] },
      duration: "drive_minutes(vehicle, to, here)",
      activity: { type: "travel", until: "clock + drive_minutes(vehicle, to, here)" },
      lexicon: ["drive to", "drive over to", "take the truck", "take the car", "sail to", "ride to", "fly to", "fly the plane to"],
      observable: "drives off",
    });
    r.action({ id: "refuel", label: "Refuel", description: "Fill up a vehicle's tank, or charge it.", pack: "vehicles", params: { vehicle: { type: "ref", ref: "vehicle" } }, requires: ["place(vehicle) == here", "fuel_pct(vehicle) < 100"], outcomes: { default: [{ type: "vehicles.refuel", args: { vehicle: "vehicle", payer: "self" } }] }, duration: "10", lexicon: ["refuel", "fill up", "gas up", "charge the car"], observable: "fills up the tank" });
    r.action({ id: "service_vehicle", label: "Service", description: "Have a vehicle serviced: an oil change, a tune-up.", pack: "vehicles", params: { vehicle: { type: "ref", ref: "vehicle" } }, requires: ["place(vehicle) == here"], outcomes: { default: [{ type: "vehicles.service", args: { vehicle: "vehicle", payer: "self" } }] }, duration: "60", lexicon: ["service", "oil change", "tune up"], observable: "gets the vehicle serviced" });
    r.action({ id: "repair_vehicle", label: "Repair", description: "Have a damaged or broken-down vehicle repaired.", pack: "vehicles", params: { vehicle: { type: "ref", ref: "vehicle" } }, requires: ["place(vehicle) == here", "vehicle.status != 'ok'"], outcomes: { default: [{ type: "vehicles.service", args: { vehicle: "vehicle", payer: "self", repair: true } }] }, duration: "180", lexicon: ["repair", "fix the truck", "fix the car", "get it towed"], observable: "gets the vehicle repaired" });

    r.process({
      id: "vehicles.upkeep",
      domain: "vehicles",
      minLevel: 4,
      step(slot, ctx) {
        const out: LedgerEvent[] = [];
        for (const v of Object.keys(ctx.state.entities).sort()) {
          const e = own(ctx.state.entities, v);
          if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || ownerLevel(ctx, v) < 4) continue;
          const interval = serviceInterval(ctx, v);
          if (interval !== null && e.fields.status === "ok" && usage(ctx, v) - numOf(e.fields.last_service) > interval) {
            out.push({ type: "set", entity: v, field: "status", value: "needs_service" });
            out.push({ type: ENGINE_EVENTS.note, data: { text: `${e.name} is due for service.`, entity: v } });
          }
        }
        return out;
      },
    });
    // Insurance (DESIGN §25.5): each vehicle's class premium a month, which the economy pays as a
    // flow linked to the vehicle; an insurance flow the author links to it, or one its owner pays
    // that's linked to nothing, insures it instead.
    r.query("vehicles.insurance", (ctx) => {
      const out: { vehicle: EntityId; owner: EntityId; cents: number; label: string }[] = [];
      for (const v of Object.keys(ctx.state.entities).sort()) {
        const e = own(ctx.state.entities, v);
        // Its first owner pays: an `owner`, or the first of an `owners` list.
        const owner = e ? (ownersIn(e.fields)[0]?.party ?? null) : null;
        if (!e || !owner || !own(ctx.state.entities, owner) || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || ownerLevel(ctx, v) < 4) continue;
        const premium = Math.round(numOf(classRow(ctx, v)?.insurance_full_cents_per_month));
        if (premium > 0) out.push({ vehicle: v, owner, cents: premium, label: `Insurance: ${e.name}` });
      }
      return out;
    });
    // Registration (DESIGN §25.5): each owned vehicle's class fee a year, which the economy pays as a
    // flow linked to the vehicle, in a month of its own; only at Vehicles 4, and only where the
    // world's vehicles config turns registration on.
    r.query("vehicles.registration", (ctx) => {
      const out: { vehicle: EntityId; owner: EntityId; cents: number; label: string; month: number }[] = [];
      if (!vehiclesConfigOf(ctx.world).registration) return out;
      for (const v of Object.keys(ctx.state.entities).sort()) {
        const e = own(ctx.state.entities, v);
        const owner = e ? (ownersIn(e.fields)[0]?.party ?? null) : null;
        if (!e || !owner || !own(ctx.state.entities, owner) || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || isGone(ctx.state, v) || ownerLevel(ctx, v) < 4) continue;
        const fee = Math.round(numOf(objOf(classRow(ctx, v)?.registration_cents_per_year).typical));
        if (fee > 0) out.push({ vehicle: v, owner, cents: fee, label: `Registration: ${e.name}`, month: (parseInt(hashParts("registration", v).slice(0, 4), 16) % 12) + 1 });
      }
      return out;
    });
    r.query("vehicles.for", (ctx, who) => vehiclesFor(ctx, who).map((u) => u.id));
    r.query("vehicles.priced", (ctx, words, _place, cls) => pricedVehicle(ctx, words, cls));
    r.query("vehicles.named", (ctx, noun) => matchVehicleClass(noun, ctx.tables.get("vehicles.classes"), { ending: true }));
    r.service("vehicles.spawn", spawnVehicle);
    r.query("vehicles.values", (ctx) => {
      const out: { vehicle: EntityId; cents: number }[] = [];
      for (const v of Object.keys(ctx.state.entities).sort()) {
        const e = own(ctx.state.entities, v);
        if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle")) continue;
        const cents = Math.round(typeof e.fields.value === "number" && Number.isFinite(e.fields.value) ? e.fields.value : numOf(objOf(classRow(ctx, v)?.price_used_cents).typical));
        if (cents > 0) out.push({ vehicle: v, cents });
      }
      return out;
    });

    r.materializer({
      domain: "vehicles",
      version: 1,
      materialize(entity, ctx, rng) {
        const e = own(ctx.state.entities, entity);
        if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || ownerLevel(ctx, entity) < 2) return [];
        const out: LedgerEvent[] = [];
        // "Runs fine" at level 1 means a usable tank: detail lands inside it.
        if (typeof e.fields.fuel_pct !== "number" && burnsFuel(ctx, entity)) out.push({ type: "set", entity, field: "fuel_pct", value: rng.int(40, 90) });
        if (ownerLevel(ctx, entity) >= 3) {
          if (domainOf(ctx, entity) === "road" && typeof e.fields.odometer_mi !== "number") out.push({ type: "set", entity, field: "odometer_mi", value: rng.int(15000, 120000) });
          if (domainOf(ctx, entity) !== "road" && typeof e.fields.engine_hours !== "number") out.push({ type: "set", entity, field: "engine_hours", value: rng.int(50, 900) });
          if (typeof e.fields.condition !== "number") out.push({ type: "set", entity, field: "condition", value: rng.int(60, 95) });
        }
        return out;
      },
    });

    r.renderer({ slot: "vehicles", label: "Vehicles your character can use, and others nearby", render: (ctx) => vehicleLines(ctx, "player").map((l) => l.text), feed: vehicleLines });
    r.view({ panel: "vehicles.garage", build: (ctx) => buildGarageView(ctx) as unknown as JsonValue });

    r.lint({
      code: "vehicles.classes",
      check(world) {
        const table = world.tables["vehicles.classes"];
        const issues = [];
        for (const e of Object.values(world.entities)) {
          if (e.kind !== "vehicle") continue;
          const cls = e.fields.class;
          if (typeof cls !== "string" || (table && !own(table.rows, cls))) issues.push({ severity: "warning" as const, code: "vehicles.classes", message: `${e.name} has no known vehicle class; fuel and range can't be computed.`, path: `entities.${e.id}.fields.class` });
        }
        return issues;
      },
    });
  },
};

export default vehiclesPack;
