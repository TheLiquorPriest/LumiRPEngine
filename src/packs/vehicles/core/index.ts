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
import { matchVehicleClass, specWords, vehicleDomainOf, vehiclesConfigOf, vehicleSpecsOf, type VehicleDomain, type VehiclePrice, type VehicleSpawn } from "../../../shared/vehicles";
import type { KindDef } from "../../../shared/world";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { say } from "../../../shared/lines";
import { noteOf } from "../../../engine/notices";
import { bump, labelOf, numOf, objOf, optionalQuery, optionalService, own, rowOf, strOf } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { fieldDef, isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { relocate } from "../../../engine/relocate";
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
    /** A vehicle of a class made in play (a purchase, a make): the class, its name, whose it is, where it stands and what the details give; nothing the call left out is made up. */
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
    /** The class words buy (or `cls`, a class row given) and its price (`economy.buy`'s quote, after the catalog): used unless `fresh` gives it as new. Null when they name no class by its id, name or alias. */
    "vehicles.priced": (ctx: ReadContext, words: string, place: PlaceId | null, cls?: string, fresh?: boolean) => VehiclePrice | null;
    /** The class a purchase's main noun names exactly as what it buys (`economy.buy`'s quote, `economy.unpriced`): one whose id, name or alias it is ("flatbed truck", "jet ski"). Null when it is none ("plane ticket", "car insurance"). */
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
    // Who drives it, as the story or a `store` with driving says: no default puts anyone at the wheel.
    driver: { type: "ref", label: "Driver" },
    status: { type: "enum", label: "Status", values: ["ok", "needs_service", "broken"], default: "ok", domain: "vehicles", level: 1, bound: { mode: "confirm" } },
    fuel_pct: { type: "number", label: "Fuel %", min: 0, max: 100, domain: "vehicles", level: 2, bound: { mode: "auto" } },
    odometer_mi: { type: "number", label: "Odometer (mi)", min: 0, domain: "vehicles", level: 3, locked: true },
    engine_hours: { type: "number", label: "Engine hours", min: 0, domain: "vehicles", level: 3, locked: true },
    home: { type: "ref", label: "Home base", domain: "vehicles", level: 3 },
    last_service: { type: "number", label: "Last service (mi or h)", min: 0, domain: "vehicles", level: 4 },
    // What it would sell for, when its author or the GM says; else its class's typical used price.
    value: { type: "money", label: "Value", min: 0, domain: "money", level: 3 },
    // Free specs, each `{label, value}` ("Engine": "5.0L V8"), as its author, the GM, the owner or the story tells them; no class seeds any.
    specs: { type: "list", label: "Specs ({label, value})" },
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
 * the next is due; and its specs, told only of one near him, `SPECS_TOLD` of them.
 */
const TOLD_APART: Readonly<Record<string, true>> = { class: true, fuel_pct: true, status: true, last_service: true, specs: true };

/** At most this many specs a Vehicles line tells of one vehicle; the agents' reads have them all. */
const SPECS_TOLD = 4;

/**
 * The Vehicles section (DESIGN §6, §6.11, §9.3): what the player character may use, his own; from
 * level 2 his groups' (his family's), with whose they are; from level 3 the ones assigned or lent
 * to him. Each one he may use gets a line with everything the world keeps of it that he may see:
 * where it is and whose, its class, every field its kind defines that it has set, by the kind's
 * labels (make, model, year, colour, plate, odometer or engine hours, condition from level 3, its
 * value), fuel and range and its status from level 2, when its next service is due from level 4,
 * who is aboard and its cargo by name (for one at his site; what a thing in it holds only when the
 * vehicle or the thing is his, or he knows of what it holds), its first few specs (for one at his
 * place or the one he is aboard), and its description. Then other people's vehicles at his site
 * that he can see, each with whose it is and what anyone sees of it (its class, its fields of no
 * realism domain, its first few specs when it is at his place, its description). The ones he may use away from his
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
  const ownerName = (owner: EntityId): string => (see(pov, owner) ? (own(ctx.state.entities, owner)?.name ?? say("vehicle_someone")) : say("vehicle_someone"));
  const placeText = (place: PlaceId | null): string => (!place ? say("vehicle_at_unknown") : canSeePlace(ctx.registry, ctx.world, ctx.state, pov, place) ? say("vehicle_at", { place: own(ctx.world.places, place)?.name ?? place }) : say("vehicle_somewhere"));
  // Its class by the table's name for it, under the kind's label for the field ("vehicle class Midsize pickup").
  const classText = (v: EntityId, kind: string): string[] => {
    const name = classRow(ctx, v)?.name;
    if (typeof name !== "string" || name.trim() === "" || !canSeeField(ctx.registry, ctx.world, ctx.state, pov, v, "class")) return [];
    return [`${fieldNoun(fieldDef(ctx.registry, ctx.world, kind, "class")?.label, "class").noun} ${name.trim()}`];
  };
  // Its first few specs, for one at his place or the one he is aboard: the agents' reads have them all.
  const specsText = (v: EntityId, place: PlaceId | null): string[] => {
    const near = (here !== null && place === here) || own(ctx.state.entities, pov)?.relations.some((r) => r.type === "in" && r.to === v) === true;
    if (!near || !canSeeField(ctx.registry, ctx.world, ctx.state, pov, v, "specs")) return [];
    const specs = vehicleSpecsOf(own(ctx.state.entities, v)?.fields.specs) ?? [];
    if (specs.length === 0) return [];
    const more = specs.length - SPECS_TOLD;
    return [say("vehicle_specs", { specs: specs.slice(0, SPECS_TOLD).map(specWords).join(", "), ...(more > 0 ? { more } : {}) })];
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
    return inner.length > 0 ? say("vehicle_holding", { name: thingName(ctx, id), inner: inner.join(", ") }) : thingName(ctx, id);
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
    const whose = !u || useTier(u.use) > level ? null : u.mine ? say("vehicle_yours") : u.use.basis === "grant" ? say(u.use.until !== undefined ? "vehicle_lent" : "vehicle_assigned", { ...(owner ? { owner: ownerName(owner) } : {}), ...(u.use.until !== undefined ? { until: formatClock(cal, u.use.until) } : {}) }) : say(u.use.basis === "staff" ? "vehicle_staff" : u.use.basis === "permit" ? "vehicle_permit" : "vehicle_of", { owner: owner ? ownerName(owner) : say("vehicle_someone") });
    if (whose === null || !u) {
      // Someone else's: told when it is at his site.
      if (site !== null && siteOf(ctx.world, place) === site) others.push({ v, owner: stated, place });
      continue;
    }
    if (!u.mine && !see(pov, v)) continue;
    const elsewhere = site !== null && siteOf(ctx.world, place) !== site;
    // The narrator hears where it is as the player may: a place the POV can't see is somewhere.
    const head = [placeText(place), ...(level === 1 ? [] : [whose]), ...(elsewhere ? [say("vehicle_away")] : [])];
    const parts = classText(v, e.kind);
    if (level === 1) parts.push(say(e.fields.status === "broken" ? "vehicle_broken" : "vehicle_runs"));
    else {
      if (burnsFuel(ctx, v) && typeof e.fields.fuel_pct === "number") {
        const range = rangeLeft(ctx, v);
        parts.push(say("vehicle_fuel", { pct: Math.round(e.fields.fuel_pct), ...(range ? { range: `${Math.round(range.value)} ${range.unit}` } : {}) }));
      }
      if (e.fields.status !== "ok" && e.fields.status !== undefined) parts.push(String(e.fields.status).replace(/_/g, " "));
    }
    // Its wear is told from Vehicles 3, as the Garage shows it.
    parts.push(...thingDetails(ctx, v, (field) => TOLD_APART[field] === true || (field === "condition" && level < 3)));
    const interval = level >= 4 ? serviceInterval(ctx, v) : null;
    if (interval !== null && canSeeField(ctx.registry, ctx.world, ctx.state, pov, v, "last_service")) {
      const unit = domainOf(ctx, v) === "road" ? "mi" : "h";
      const due = Math.round(numOf(e.fields.last_service) + interval).toLocaleString("en-US");
      parts.push(say(usage(ctx, v) > numOf(e.fields.last_service) + interval ? "vehicle_service_overdue" : "vehicle_service_next", { due, unit }));
    }
    parts.push(...specsText(v, place));
    const driver = driverOf(ctx, v);
    if (driver !== null && see(pov, driver)) parts.push(say("vehicle_driven_by", driver === pov ? { you: true } : { who: ownerName(driver) }));
    // Who and what is in it only for one at his site: one away from here he can't see into.
    const inside = elsewhere ? [] : contents(v);
    const aboard = inside.filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person")).map((id) => (id === pov ? say("vehicle_you") : (own(ctx.state.entities, id)?.name ?? id)));
    const cargo = inside.filter((id) => !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person")).map((id) => named(id, 0, owns(ctx, pov, v)));
    const description = thingDescription(ctx, v);
    const text = [
      say("vehicle_line", { name: e.name, parts: [head.join(", "), ...parts].join("; ") }),
      ...(aboard.length > 0 ? [say("vehicle_aboard", { who: aboard.join(", ") })] : []),
      ...(cargo.length > 0 ? [say("vehicle_cargo", { what: cargo.join(", ") })] : []),
      ...(description ? [sentence(description)] : []),
    ].filter((t) => t !== "").join(" ");
    (elsewhere ? away : usable).push({ text, known: "pov" });
  }
  // Other people's vehicles at his site: every one he can see, with whose it is and what anyone sees of it.
  const seen = others
    .filter((o) => see(pov, o.v))
    .map((o): FeedLine => {
      const e = own(ctx.state.entities, o.v);
      const looks = e ? [...classText(o.v, e.kind), ...thingDetails(ctx, o.v, (field, def) => TOLD_APART[field] === true || def.domain !== undefined), ...specsText(o.v, o.place)] : [];
      const description = thingDescription(ctx, o.v);
      return { text: `${say("vehicle_line", { name: e?.name ?? o.v, parts: [`${placeText(o.place)}, ${o.owner ? say("vehicle_of", { owner: ownerName(o.owner) }) : say("vehicle_owner_unknown")}`, ...looks].join("; ") })}${description ? ` ${sentence(description)}` : ""}`, known: "pov" };
    });
  const lines = [...usable, ...seen, ...away];
  if (scope === "player") return lines;
  for (const o of others.filter((x) => !see(pov, x.v))) {
    const name = own(ctx.state.entities, o.v)?.name ?? o.v;
    const ownerName = o.owner ? (own(ctx.state.entities, o.owner)?.name ?? o.owner) : null;
    // Scene facts are only what someone with him can see by the visibility rules; the rest is the GM's.
    const knower = o.owner !== null && see(pov, o.owner) && see(o.owner, o.v) && together(ctx.world, here, placeOfEntity(ctx.state, o.owner)) ? o.owner : null;
    if (knower && ownerName) {
      const where = o.place && canSeePlace(ctx.registry, ctx.world, ctx.state, knower, o.place) ? say("vehicle_at", { place: own(ctx.world.places, o.place)?.name ?? o.place }) : say("vehicle_somewhere");
      lines.push({ text: say("vehicle_line", { name, parts: `${where}, ${say("vehicle_of", { owner: ownerName })}` }), known: "scene", who: ownerName });
    } else if (scope === "gm") lines.push({ text: say("vehicle_line", { name, parts: `${o.place ? say("vehicle_at", { place: own(ctx.world.places, o.place)?.name ?? o.place }) : say("vehicle_at_unknown")}, ${ownerName ? say("vehicle_of", { owner: ownerName }) : say("vehicle_owner_none")}` }), known: "gm" });
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

/**
 * What the world's tables work a drive out to burn and wear, as changes of what the vehicle has recorded: its fuel left,
 * and its odometer or engine hours. A value nobody recorded is left alone, and no breakdown is drawn.
 */
export function driveSums(ctx: ReadContext, vehicle: EntityId, leg: Leg): LedgerEvent[] {
  const e = own(ctx.state.entities, vehicle);
  if (!e) return [];
  const out: LedgerEvent[] = [];
  const use = fuelUse(ctx, vehicle, leg);
  const fuel = e.fields.fuel_pct;
  if (typeof fuel === "number") {
    const delta = -Math.min(fuel, Math.round(use.pct * 10) / 10);
    if (delta !== 0) out.push(bump(ctx.state, vehicle, "fuel_pct", delta, fuel));
  }
  if (domainOf(ctx, vehicle) === "road") {
    if (typeof e.fields.odometer_mi === "number" && use.miles > 0) out.push({ type: "add", entity: vehicle, field: "odometer_mi", delta: Math.round(use.miles * 10) / 10 });
  } else if (typeof e.fields.engine_hours === "number" && use.hours > 0) out.push({ type: "add", entity: vehicle, field: "engine_hours", delta: Math.round(use.hours * 100) / 100 });
  return out;
}

/** The chance the pack's own arithmetic gives a drive of breaking the vehicle down, for the game master to roll if the story wants it; null without a condition recorded. */
export function breakdownChance(ctx: ReadContext, vehicle: EntityId, leg: Leg): number | null {
  const e = own(ctx.state.entities, vehicle);
  const condition = e?.fields.condition;
  if (!e || typeof condition !== "number") return null;
  const use = fuelUse(ctx, vehicle, leg);
  const interval = serviceInterval(ctx, vehicle);
  const overdue = interval !== null && usage(ctx, vehicle) - numOf(e.fields.last_service) > interval;
  const units = domainOf(ctx, vehicle) === "road" ? use.miles / 10 : use.hours;
  return Math.min(0.5, 0.002 * units * (1 + (100 - condition) / 50) * (overdue ? 2 : 1));
}

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
export function legOf(trip: VehicleTrip): Leg {
  return { minutes: trip.drive.minutes, distanceKm: trip.drive.distanceKm, terrain: trip.drive.legs.find((l) => l.terrain)?.terrain ?? null, mode: trip.drive.mode };
}

/** Where a trip starts: the place given, else where the vehicle is. */
function startOf(ctx: ReadContext, vehicle: EntityId, from: unknown): PlaceId | null {
  return typeof from === "string" && from !== "" ? from : placeOfEntity(ctx.state, vehicle);
}

/** Whether the fuel recorded covers a leg; with none recorded, nothing says it lacks any. */
const fuelOk = (ctx: ReadContext, vehicle: EntityId, leg: Leg): boolean => {
  const fuel = own(ctx.state.entities, vehicle)?.fields.fuel_pct;
  return typeof fuel !== "number" || fuel >= fuelUse(ctx, vehicle, leg).pct;
};

/** Range left in miles (road) or hours (marine, off-road) at the current fuel; null when the fuel left is not recorded. */
export function rangeLeft(ctx: ReadContext, vehicle: EntityId): { value: number; unit: "mi" | "h" } | null {
  const row = classRow(ctx, vehicle);
  const fuel = own(ctx.state.entities, vehicle)?.fields.fuel_pct;
  if (!row || typeof fuel !== "number") return null;
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

/** Who drives: the call's driver, else the one recorded on the vehicle, else no one; a recorded driver who is gone is not used. */
export function driverOf(ctx: Pick<ReadContext, "state">, vehicle: EntityId, said?: JsonValue): EntityId | null {
  const given = strOf(said);
  if (given !== "") return given;
  const recorded = own(ctx.state.entities, vehicle)?.fields.driver;
  return typeof recorded === "string" && own(ctx.state.entities, recorded) !== undefined && !isGone(ctx.state, recorded) ? recorded : null;
}

/** The trip a drive takes: from where the driver is (they walk to the vehicle when it is parked elsewhere), else from where the vehicle stands; null when the world's routes have none. */
export function driveTrip(ctx: ReadContext, vehicle: EntityId, driver: EntityId | null, to: PlaceId): VehicleTrip | null {
  const driverAt = driver !== null ? placeOfEntity(ctx.state, driver) : null;
  const vehicleAt = placeOfEntity(ctx.state, vehicle);
  return (driverAt ? tripFor(ctx, vehicle, driverAt, to) : null) ?? (vehicleAt && vehicleAt !== driverAt ? tripFor(ctx, vehicle, vehicleAt, to) : null);
}

/**
 * The changes that carry a drive's people to `to` through the one move path: the driver and the riders named, none else.
 * One riding inside the vehicle goes with it when it is parked at `to`, so is not moved apart; the rest are moved,
 * a rider as one who comes along.
 */
function movePeople(ctx: ReadContext, vehicle: EntityId, to: PlaceId, parked: PlaceId, driver: EntityId | null, riders: unknown): LedgerEvent[] | Rejection {
  const named = Array.isArray(riders) ? riders.filter((x): x is string => typeof x === "string") : [];
  const out: LedgerEvent[] = [];
  const moved = new Set<string>();
  for (const p of driver !== null ? [driver, ...named] : named) {
    const pe = own(ctx.state.entities, p);
    if (!pe || moved.has(p) || (parked === to && pe.relations.some((x) => x.type === "in" && x.to === vehicle))) continue;
    moved.add(p);
    // A rider comes along: what they were doing stays behind, as for a Go companion.
    const events = relocate(ctx, p, to, p === driver ? {} : { along: true });
    if ("code" in events) return events;
    out.push(...events);
  }
  return out;
}

/**
 * A vehicle of a class made in play (DESIGN §9.3; a purchase's or a make's, ITEMS-SPEC §5.3): it records the
 * class, the name (the spec's, else the class's as the table has it), the owner, where it stands (or the holder
 * it is in) and what the details and fields the call gives say, and nothing else. Its make and model are its class's
 * and are read from the class; no year, miles or hours, condition, fuel, plate, status or home is made up.
 */
function spawnVehicle(ctx: ReadContext, spec: VehicleSpawn): { entity: EntityId; events: LedgerEvent[] } | Rejection {
  const row = rowOf(ctx, "vehicles.classes", spec.class);
  if (!row) {
    const classes = Object.keys(ctx.tables.get("vehicles.classes")?.rows ?? {});
    return { code: "unknown_class", reason: say("why_no_vehicle_class_class", { class: spec.class }), choices: classes, said: spec.class };
  }
  const d = spec.details ?? {};
  const name = spec.name?.trim() || strOf(row.name, spec.class);
  const holder = spec.holder && own(ctx.state.entities, spec.holder) ? spec.holder : null;
  const place = holder ? null : (spec.place ?? null);
  // Its id is its salt's, as a made thing's (`madeId`): the same make or purchase checked again after the read's changes and the time they took, or applied from its review card, makes the same vehicle, so the changes that name it still find it.
  let id = `vehicle:${hashParts("vehicle", spec.class, name, spec.owner ?? "", spec.salt ?? "").slice(0, 12)}`;
  for (let n = 2; own(ctx.state.entities, id); n++) id = `vehicle:${hashParts("vehicle", spec.class, name, spec.owner ?? "", spec.salt ?? "", String(n)).slice(0, 12)}`;
  const fields: JsonObject = { class: spec.class };
  if (spec.owner) fields.owner = spec.owner;
  for (const key of ["make", "model", "colour", "plate"] as const) if (typeof d[key] === "string" && d[key].trim() !== "") fields[key] = d[key].trim();
  for (const key of ["year", "odometer_mi", "engine_hours", "condition", "fuel_pct"] as const) if (typeof d[key] === "number" && Number.isFinite(d[key])) fields[key] = key === "year" ? Math.round(d[key]) : d[key];
  if (typeof d.value === "number" && d.value > 0) fields.value = Math.round(d.value);
  const specs = vehicleSpecsOf(d.specs) ?? [];
  if (specs.length > 0) fields.specs = specs.map((s) => ({ label: s.label, value: s.value }));
  if (spec.home) fields.home = spec.home;
  if (place) fields.place = place;
  Object.assign(fields, spec.fields ?? {});
  return { entity: id, events: [{ type: "spawn", entity: { id, kind: "vehicle", name, tier: "background", fields, relations: holder ? [{ type: "in", to: holder }] : [] } }] };
}

/** What a class named by its id, its name or an alias (`vehicles.named` reads a noun that way) buys (DESIGN §9.5): used unless the call gives it as new, at the class's typical price of that kind. */
function pricedVehicle(ctx: ReadContext, words: string, given?: string, fresh?: boolean): VehiclePrice | null {
  const table = ctx.tables.get("vehicles.classes");
  const cls = given !== undefined && own(table?.rows ?? {}, given) ? given : matchVehicleClass(words, table);
  const row = cls ? own(table?.rows ?? {}, cls) : undefined;
  if (!cls || !row) return null;
  const isNew = fresh === true;
  const raw = objOf(isNew ? row.price_new_cents : row.price_used_cents);
  const band = { min: Math.round(numOf(raw.min)), typical: Math.round(numOf(raw.typical)), max: Math.round(numOf(raw.max)) };
  if (!(band.typical > 0)) return null;
  return { class: cls, name: strOf(row.name, cls), new: isNew, band, cents: band.typical };
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

/** What the world's tables price filling `pct` points of a vehicle's tank at, in cents: a figure for the game master, who sets the amount. */
export function fuelCents(ctx: ReadContext, vehicle: EntityId, pct: number): number {
  const product = fuelProduct(ctx, vehicle);
  const qty = Math.round((pct / 100) * product.capacity * 100) / 100;
  return product.catalog !== null ? priceOf(ctx, product.catalog, qty) : Math.round(product.perUnit * qty);
}

/** What the world's tables price a service (or, with `repair`, a repair) at, in cents: a figure for the game master, who sets the amount. */
export function serviceCents(ctx: ReadContext, repair: boolean): number {
  return repair ? priceOf(ctx, "tow_hookup", 1) + priceOf(ctx, "diagnostic_fee", 1) + priceOf(ctx, "brake_pads_axle", 1) : priceOf(ctx, "oil_change_synthetic", 1);
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
        const named = /^(your|my|the|a|an)\s/i.test(e.name) ? e.name.charAt(0).toLowerCase() + e.name.slice(1) : say("trip_the_vehicle", { name: e.name });
        for (const [to, trip] of tripsFor(ctx, v, from, targets)) {
          // Left short of the place, a trip is worth offering only when it beats walking there.
          const direct = walk ? walk(ctx, from, to, "walk") : null;
          if (trip.park !== to && direct && trip.minutes >= direct.minutes) continue;
          const leg = legOf(trip);
          const why = e.fields.status === "broken" ? say("trip_broken_down") : !fuelOk(ctx, v, leg) ? say("trip_not_enough_fuel") : undefined;
          const sail = trip.drive.mode === "water";
          const fly = trip.drive.mode === "air";
          const parts: TravelPart[] = [];
          if (trip.fetch) parts.push({ kind: "fetch", minutes: trip.fetch.minutes, words: at === home ? say("trip_fetch_at_home") : say("trip_fetch_at", { place: placeName(at) }) });
          if (trip.startMinutes > 0) parts.push({ kind: "start", minutes: trip.startMinutes, words: say("trip_start") });
          if (trip.drive.minutes > 0) parts.push({ kind: "drive", minutes: trip.drive.minutes, words: say(fly ? "trip_flying" : sail ? "trip_sailing" : "trip_driving") });
          if (trip.parkMinutes > 0) parts.push({ kind: "park", minutes: trip.parkMinutes, words: say(fly ? "trip_park_air" : sail ? "trip_park_water" : "trip_park") });
          if (trip.walk && trip.walk.minutes > 0) parts.push({ kind: "walk", minutes: trip.walk.minutes, words: say("trip_on_foot_from", { place: placeName(trip.park) }) });
          out.push({ to, label: say(fly ? "trip_fly" : sail ? "trip_sail" : "trip_drive", { vehicle: named, place: placeName(to) }), mode: trip.drive.mode, minutes: trip.minutes, parts, vehicle: e.name, action: "drive", params: { vehicle: v, to }, ...(why ? { disabled: why } : {}) });
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
    // The tank as recorded: null where nobody recorded it, which is no figure (a rule's `fuel_pct(v) >= 90` does not hold of it).
    r.formula("fuel_pct", (ctx, vehicle) => {
      const fuel = own(ctx.state.entities, String(vehicle ?? ""))?.fields.fuel_pct;
      return typeof fuel === "number" ? fuel : null;
    });
    r.formula("burns_fuel", (ctx, vehicle) => burnsFuel(ctx, String(vehicle ?? "")));

    r.effect({
      type: "vehicles.drive",
      args: ["vehicle", "to", "driver?", "riders?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const to = strOf(args.to);
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", say("why_no_vehicle_v", { v: labelOf(ctx, v) }));
        if (e.fields.status === "broken") return reject("broken", say("why_name_has_broken_down", { name: e.name }));
        // The driver is the call's, else the vehicle's recorded one, else no one.
        const driver = driverOf(ctx, v, args.driver);
        // The trip starts where the driver is: they walk to the vehicle when it's parked elsewhere.
        // An effect tells what happened, so a driver too far to fetch it (a rule's "the tow truck
        // takes you there") still rides it from where it stands.
        // Driving a vehicle to where it already is would only take it away to park and walk back.
        if (placeOfEntity(ctx.state, v) === to) return reject("already_there", say("why_name_is_at_to_already_walk_there", { name: e.name, to: labelOf(ctx, to) }));
        const trip = driveTrip(ctx, v, driver, to);
        if (!trip) return reject("no_route", say("why_no_route_for_name_to_to", { name: e.name, to: labelOf(ctx, to) }));
        const leg = legOf(trip);
        if (!fuelOk(ctx, v, leg)) return reject("no_fuel", say("why_name_doesnt_have_the_fuel", { name: e.name }));
        const out: LedgerEvent[] = [...driveSums(ctx, v, leg), { type: "set", entity: v, field: "place", value: trip.park }];
        if (driver !== null) out.push({ type: "set", entity: v, field: "driver", value: driver });
        // The driver and the riders the call names arrive too, through the one move path. Whoever
        // rides inside the vehicle goes with it, unless it's left short of the place: then the
        // driver and the riders get out and walk the rest. No one else rides: a party goes only when named.
        const moved = movePeople(ctx, v, to, trip.park, driver, args.riders);
        if ("code" in moved) return moved;
        return [...out, ...moved];
      },
    });
    // The game master's drive: the vehicle stands where the call says (`park`, else `to`), its driver and the riders named arrive at
    // `to`, and only what the call gives is burnt or worn. No route, fuel or breakdown is asked.
    r.effect({
      type: "vehicles.take",
      args: ["vehicle", "to", "driver?", "riders?", "park?", "fuel_pct?", "miles?", "hours?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const to = strOf(args.to);
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", say("why_no_vehicle_v", { v: labelOf(ctx, v) }));
        const park = strOf(args.park) || to;
        const driver = driverOf(ctx, v, args.driver);
        const out: LedgerEvent[] = [{ type: "set", entity: v, field: "place", value: park }];
        if (driver !== null) out.push({ type: "set", entity: v, field: "driver", value: driver });
        if (typeof args.fuel_pct === "number") out.push({ type: "set", entity: v, field: "fuel_pct", value: args.fuel_pct });
        // The miles or hours of the drive are added to the odometer or the engine's hours where one is recorded.
        if (typeof args.miles === "number" && typeof e.fields.odometer_mi === "number") out.push({ type: "add", entity: v, field: "odometer_mi", delta: args.miles });
        if (typeof args.hours === "number" && typeof e.fields.engine_hours === "number") out.push({ type: "add", entity: v, field: "engine_hours", delta: args.hours });
        const moved = movePeople(ctx, v, to, park, driver, args.riders);
        if ("code" in moved) return moved;
        return [...out, ...moved];
      },
    });
    r.effect({
      type: "vehicles.refuel",
      args: ["vehicle", "payer?", "pct?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const payer = strOf(args.payer) || ctx.world.pov;
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", say("why_no_vehicle_v", { v: labelOf(ctx, v) }));
        if (ownerLevel(ctx, v) < 2) return [];
        // The fill is what the recorded tank lacks (or the amount asked, if less). With no level recorded it is the amount asked, else a full tank: only a full tank is then a level to record.
        const recorded = typeof e.fields.fuel_pct === "number" ? e.fields.fuel_pct : null;
        const asked = typeof args.pct === "number" ? args.pct : null;
        const wanted = recorded !== null ? Math.min(100 - recorded, asked ?? 100 - recorded) : Math.min(100, asked ?? 100);
        if (wanted <= 0) return reject("full", say("why_name_is_full", { name: e.name }));
        const product = fuelProduct(ctx, v);
        const qty = Math.round(((wanted / 100) * product.capacity) * 100) / 100;
        const cents = product.catalog !== null ? priceOf(ctx, product.catalog, qty) : Math.round(product.perUnit * qty);
        const paid = charge(ctx, payer, cents, say("memo_fuel_for", { name: e.name, qty, unit: product.unit }), "fuel");
        if (!Array.isArray(paid)) return paid;
        if (recorded !== null) return [...paid, bump(ctx.state, v, "fuel_pct", wanted, recorded)];
        return asked === null ? [...paid, { type: "set", entity: v, field: "fuel_pct", value: 100 }] : paid;
      },
    });
    r.effect({
      type: "vehicles.service",
      args: ["vehicle", "payer?", "repair?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const payer = strOf(args.payer) || ctx.world.pov;
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", say("why_no_vehicle_v", { v: labelOf(ctx, v) }));
        const repair = args.repair === true;
        // Marine and off-road engines have no catalog service row; the oil-change row stands in.
        const cents = repair ? priceOf(ctx, "tow_hookup", 1) + priceOf(ctx, "diagnostic_fee", 1) + priceOf(ctx, "brake_pads_axle", 1) : priceOf(ctx, "oil_change_synthetic", 1);
        const paid = charge(ctx, payer, cents, `${repair ? "Repair" : "Service"}: ${e.name}`, "vehicle_services");
        if (!Array.isArray(paid)) return paid;
        const out: LedgerEvent[] = [...paid, { type: "set", entity: v, field: "status", value: "ok" }];
        // A service marks the miles or hours it was done at, where they are recorded.
        if (ownerLevel(ctx, v) >= 4 && (typeof e.fields.odometer_mi === "number" || typeof e.fields.engine_hours === "number")) out.push({ type: "set", entity: v, field: "last_service", value: usage(ctx, v) });
        const condition = e.fields.condition;
        if (typeof condition === "number" && condition < 90) out.push(bump(ctx.state, v, "condition", Math.min(15, 90 - condition), condition));
        return out;
      },
    });
    // The game master's upkeep: it records what the call gives (the fuel left, the status, the condition, that a service was done, a payment) and nothing else.
    r.effect({
      type: "vehicles.upkeep",
      args: ["vehicle", "fuel_pct?", "status?", "condition?", "serviced?", "payer?", "cents?", "memo?", "category?"],
      resolve(args, ctx) {
        const v = strOf(args.vehicle);
        const e = own(ctx.state.entities, v);
        if (!e) return reject("missing_entity", say("why_no_vehicle_v", { v: labelOf(ctx, v) }));
        const out: LedgerEvent[] = [];
        const payer = strOf(args.payer);
        const cents = Math.round(numOf(args.cents));
        if (payer !== "" && cents > 0) {
          const paid = charge(ctx, payer, cents, strOf(args.memo), strOf(args.category, "vehicle_services"));
          if (!Array.isArray(paid)) return paid;
          out.push(...paid);
        }
        if (typeof args.fuel_pct === "number") out.push({ type: "set", entity: v, field: "fuel_pct", value: args.fuel_pct });
        if (typeof args.status === "string" && args.status !== "") out.push({ type: "set", entity: v, field: "status", value: args.status });
        if (typeof args.condition === "number") out.push({ type: "set", entity: v, field: "condition", value: args.condition });
        // A service marks the miles or hours it was done at, where they are recorded.
        if (args.serviced === true && (typeof e.fields.odometer_mi === "number" || typeof e.fields.engine_hours === "number")) out.push({ type: "set", entity: v, field: "last_service", value: usage(ctx, v) });
        return out;
      },
    });

    r.action({
      id: "drive",
      pack: "vehicles",
      params: { vehicle: { type: "ref", ref: "vehicle" }, to: { type: "ref", ref: "place" } },
      // A vehicle parked elsewhere is fetched on foot, within the world's travel tuning: the trip from here says whether it can go.
      // Who may drive it is the access resolver's (ITEMS-SPEC §3.4 `may_use`), as the Vehicles section tells it usable.
      requires: ["may_use(self, vehicle)", "vehicle.status != 'broken'", "place(vehicle) != to", "drive_minutes(vehicle, to, here) > 0", "fuel_ok(vehicle, to, here)"],
      outcomes: { default: [{ type: "vehicles.drive", args: { vehicle: "vehicle", to: "=to", driver: "self" } }] },
      duration: "drive_minutes(vehicle, to, here)",
      activity: { type: "travel", until: "clock + drive_minutes(vehicle, to, here)" },
      lexicon: ["drive to", "drive over to", "take the truck", "take the car", "sail to", "ride to", "fly to", "fly the plane to"],
      observable: "drives off",
    });
    r.action({ id: "refuel", pack: "vehicles", params: { vehicle: { type: "ref", ref: "vehicle" } }, requires: ["place(vehicle) == here", "burns_fuel(vehicle)", "fuel_pct(vehicle) < 100"], outcomes: { default: [{ type: "vehicles.refuel", args: { vehicle: "vehicle", payer: "self" } }] }, duration: "10", lexicon: ["refuel", "fill up", "gas up", "charge the car"], observable: "fills up the tank" });
    r.action({ id: "service_vehicle", pack: "vehicles", params: { vehicle: { type: "ref", ref: "vehicle" } }, requires: ["place(vehicle) == here"], outcomes: { default: [{ type: "vehicles.service", args: { vehicle: "vehicle", payer: "self" } }] }, duration: "60", lexicon: ["service", "oil change", "tune up"], observable: "gets the vehicle serviced" });
    r.action({ id: "repair_vehicle", pack: "vehicles", params: { vehicle: { type: "ref", ref: "vehicle" } }, requires: ["place(vehicle) == here", "vehicle.status != 'ok'"], outcomes: { default: [{ type: "vehicles.service", args: { vehicle: "vehicle", payer: "self", repair: true } }] }, duration: "180", lexicon: ["repair", "fix the truck", "fix the car", "get it towed"], observable: "gets the vehicle repaired" });

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
            out.push(...noteOf("vehicle_service_due", { name: e.name }, { entity: v }));
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
        if (premium > 0) out.push({ vehicle: v, owner, cents: premium, label: say("flow_label_insurance", { name: e.name }) });
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
        if (fee > 0) out.push({ vehicle: v, owner, cents: fee, label: say("flow_label_registration", { name: e.name }), month: (parseInt(hashParts("registration", v).slice(0, 4), 16) % 12) + 1 });
      }
      return out;
    });
    r.query("vehicles.for", (ctx, who) => vehiclesFor(ctx, who).map((u) => u.id));
    r.query("vehicles.priced", (ctx, words, _place, cls, fresh) => pricedVehicle(ctx, words, cls, fresh));
    r.query("vehicles.named", (ctx, noun) => matchVehicleClass(noun, ctx.tables.get("vehicles.classes")));
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
          if (typeof cls !== "string" || (table && !own(table.rows, cls))) issues.push({ severity: "warning" as const, code: "vehicles.classes", message: say("lint_name_has_no_known_vehicle_class_fuel", { name: e.name }), path: `entities.${e.id}.fields.class` });
        }
        return issues;
      },
    });
  },
};

export default vehiclesPack;
