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
import type { DataTable, TableRow } from "../../../shared/tables";
import type { KindDef } from "../../../shared/world";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { bump, labelOf, numOf, objOf, optionalQuery, optionalService, own, rowOf, strOf } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import { canSeePlace } from "../../../engine/visibility";
import { buildGarageView } from "./view";
import classes from "./tables/modern-us/classes.json";
import factors from "./tables/modern-us/factors.json";

const TABLES: DataTable[] = [classes, factors] as unknown as DataTable[];
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
  minutes: number;
  vehicle: string;
  action: string;
  params: JsonObject;
  disabled?: string;
}

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Fuel, odometer or engine hours, and (level 4, with an rng) breakdowns for one trip. */
    "vehicle.consume": (ctx: ReadContext, vehicle: EntityId, leg: Leg, rng?: Rng) => LedgerEvent[];
  }
  interface QueryMap {
    /** Whether the vehicle has fuel for the trip (always true below Vehicles level 2). */
    fuel_ok: (ctx: ReadContext, vehicle: EntityId, leg: Leg) => boolean;
    /** Drive, ride or sail options from a place for the POV's vehicles (the map panel). */
    "vehicles.travel_options": (ctx: ReadContext, from: PlaceId) => TravelOption[];
    /** Each insured vehicle's monthly premium, its owner and its name: the economy pays it as a flow linked to the vehicle. */
    "vehicles.insurance": (ctx: ReadContext) => { vehicle: EntityId; owner: EntityId; cents: number; label: string }[];
    /** What each vehicle is worth: its own `value`, else its class's typical used price; the economy counts it in its owners' net worth. */
    "vehicles.values": (ctx: ReadContext) => { vehicle: EntityId; cents: number }[];
  }
}

export const VEHICLE: KindDef = {
  id: "vehicle",
  label: "Vehicle",
  extends: "container",
  pack: "vehicles",
  fields: {
    // Named for the vehicle, so Build doesn't read it as one of the world's own classifications.
    class: { type: "text", label: "Vehicle class" },
    status: { type: "enum", label: "Status", values: ["ok", "needs_service", "broken"], default: "ok", domain: "vehicles", level: 1, bound: { mode: "confirm" } },
    fuel_pct: { type: "number", label: "Fuel %", min: 0, max: 100, domain: "vehicles", level: 2, bound: { mode: "auto", maxDelta: 30 } },
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

/** The class domain: road, marine or offroad. */
function domainOf(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): "road" | "marine" | "offroad" {
  const d = strOf(classRow(ctx, vehicle)?.domain, strOf(own(ctx.state.entities, vehicle)?.fields.domain, "road"));
  return d === "marine" || d === "offroad" ? d : "road";
}

/** The travel modes a vehicle can use. */
export function modesOf(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): TravelMode[] {
  const d = domainOf(ctx, vehicle);
  return d === "marine" ? ["water"] : d === "offroad" ? ["offroad", "road"] : ["road"];
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
  if (!row || !e) return { pct: 0, miles, hours };
  const guide = strOf(row.factor_guide, domainOf(ctx, vehicle));
  const level = ctx.levelOf(e.fields.owner && typeof e.fields.owner === "string" ? e.fields.owner : ctx.world.pov, "vehicles");
  let mult = level >= 4 ? terrainFactor(ctx, guide, leg.terrain) : 1;
  const payload = numOf(row.payload_kg);
  const cargoKg = Object.values(ctx.state.entities).filter((x) => x.relations.some((r) => r.type === "in" && r.to === vehicle)).reduce((a, x) => a + numOf(x.fields.weight_g) / 1000, 0);
  if (level >= 4 && payload > 0 && cargoKg > payload / 2) mult *= guide === "road" ? factor(ctx, "road", "loaded_to_payload") : guide === "marine" ? factor(ctx, "marine", "heavy_load_full_crew") : factor(ctx, "offroad", "two_up_or_loaded_cargo");
  const consumption = objOf(row.consumption);
  const unit = strOf(row.consumption_unit);
  if (unit === "mpg" || unit === "mi_per_kwh") {
    const rate = numOf(consumption.combined, numOf(consumption.highway, 25));
    const used = rate > 0 ? (miles / rate) * mult : 0;
    const capacity = unit === "mpg" ? numOf(row.tank_capacity_gal, 15) : numOf(row.usable_battery_kwh, 60);
    return { pct: (used / capacity) * 100, miles, hours };
  }
  const perHour = guide === "marine" ? numOf(consumption.cruise_planing, 5) : numOf(consumption.normal_trail, 1.5);
  const capacity = numOf(row.tank_capacity_gal, 10);
  return { pct: ((perHour * hours * mult) / capacity) * 100, miles, hours };
}

function ownerLevel(ctx: ReadContext, vehicle: EntityId): number {
  const owner = own(ctx.state.entities, vehicle)?.fields.owner;
  return ctx.levelOf(typeof owner === "string" && own(ctx.state.entities, owner) ? owner : ctx.world.pov, "vehicles");
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

function legFor(ctx: ReadContext, vehicle: EntityId, from: PlaceId, to: PlaceId): Leg | null {
  const route = optionalQuery(ctx, "space.route");
  for (const mode of modesOf(ctx, vehicle)) {
    const plan = route ? route(ctx, from, to, mode) : null;
    if (plan) return { minutes: plan.minutes, distanceKm: plan.distanceKm, terrain: plan.legs.find((l) => l.terrain)?.terrain ?? null, mode };
  }
  return null;
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

function fuelProduct(ctx: Pick<ReadContext, "tables" | "state">, vehicle: EntityId): { catalog: string; unit: "gal" | "kWh"; capacity: number } {
  const row = classRow(ctx, vehicle);
  const type = strOf(row?.fuel_type, "gasoline");
  if (type === "electricity") return { catalog: "ev_public_l2_kwh", unit: "kWh", capacity: numOf(row?.usable_battery_kwh, 60) };
  const marine = domainOf(ctx, vehicle) === "marine";
  return { catalog: type === "diesel" ? (marine ? "marine_diesel" : "diesel") : marine ? "marine_gasoline" : "gasoline_regular", unit: "gal", capacity: numOf(row?.tank_capacity_gal, 15) };
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
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t });
    r.kind(VEHICLE);
    r.service("vehicle.consume", consume);
    r.query("fuel_ok", fuelOk);
    r.query("vehicles.travel_options", (ctx, from) => {
      const out: TravelOption[] = [];
      const pov = ctx.world.pov;
      for (const v of Object.keys(ctx.state.entities).sort()) {
        const e = own(ctx.state.entities, v);
        if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle")) continue;
        const mine = e.fields.owner === pov || own(ctx.state.entities, pov)?.relations.some((x) => x.type === "uses" && x.to === v);
        if (!mine || placeOfEntity(ctx.state, v) !== from) continue;
        for (const to of Object.keys(ctx.world.places).sort()) {
          if (to === from) continue;
          const leg = legFor(ctx, v, from, to);
          if (!leg || leg.mode === "walk") continue;
          const why = e.fields.status === "broken" ? "broken down" : !fuelOk(ctx, v, leg) ? "not enough fuel" : undefined;
          const named = /^(your|my|the|a|an)\s/i.test(e.name) ? e.name.charAt(0).toLowerCase() + e.name.slice(1) : `the ${e.name}`;
          out.push({ to, label: `${leg.mode === "water" ? "Sail" : "Drive"} ${named} to ${own(ctx.world.places, to)?.name ?? to}`, mode: leg.mode, minutes: leg.minutes, vehicle: e.name, action: "drive", params: { vehicle: v, to }, ...(why ? { disabled: why } : {}) });
        }
      }
      return out;
    });
    r.formula("fuel_ok", (ctx, vehicle, to) => {
      const v = String(vehicle ?? "");
      const from = placeOfEntity(ctx.state, v);
      const leg = from ? legFor(ctx, v, from, String(to ?? "")) : null;
      return leg !== null && fuelOk(ctx, v, leg);
    });
    r.formula("drive_minutes", (ctx, vehicle, to) => {
      const v = String(vehicle ?? "");
      const from = placeOfEntity(ctx.state, v);
      return (from ? legFor(ctx, v, from, String(to ?? "")) : null)?.minutes ?? 0;
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
        const from = placeOfEntity(ctx.state, v);
        const leg = from ? legFor(ctx, v, from, to) : null;
        if (!leg) return reject("no_route", `no route for ${e.name} to ${labelOf(ctx, to)}`);
        if (!fuelOk(ctx, v, leg)) return reject("no_fuel", `${e.name} doesn't have the fuel`);
        const out: LedgerEvent[] = [...consume(ctx, v, leg, ctx.rng), { type: "set", entity: v, field: "place", value: to }];
        // The driver and anyone riding along (people at the same place named in `riders`) arrive too.
        const riders = Array.isArray(args.riders) ? args.riders.filter((x): x is string => typeof x === "string") : [];
        for (const p of [driver, ...riders]) {
          const pe = own(ctx.state.entities, p);
          if (!pe || pe.relations.some((x) => x.type === "in" && x.to === v)) continue;
          for (const rel of pe.relations) if (rel.type === "in") out.push({ type: "unlink", rel: "in", from: p, to: rel.to });
          out.push({ type: "set", entity: p, field: "place", value: to });
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
        const cents = priceOf(ctx, product.catalog, qty);
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
      description: "Drive, ride or sail a vehicle you own or may use to another place.",
      pack: "vehicles",
      params: { vehicle: { type: "ref", ref: "vehicle" }, to: { type: "ref", ref: "place", label: "Destination" } },
      requires: ["place(vehicle) == here", "vehicle.owner == self or has_rel(self, 'uses', vehicle)", "vehicle.status != 'broken'", "drive_minutes(vehicle, to) > 0", "fuel_ok(vehicle, to)"],
      outcomes: { default: [{ type: "vehicles.drive", args: { vehicle: "vehicle", to: "=to", driver: "self" } }] },
      duration: "drive_minutes(vehicle, to)",
      activity: { type: "travel", until: "clock + drive_minutes(vehicle, to)" },
      lexicon: ["drive to", "drive over to", "take the truck", "take the car", "sail to", "ride to"],
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
        const owner = typeof e?.fields.owner === "string" ? e.fields.owner : null;
        if (!e || !owner || !own(ctx.state.entities, owner) || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || ownerLevel(ctx, v) < 4) continue;
        const premium = Math.round(numOf(classRow(ctx, v)?.insurance_full_cents_per_month));
        if (premium > 0) out.push({ vehicle: v, owner, cents: premium, label: `Insurance: ${e.name}` });
      }
      return out;
    });
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
        if (typeof e.fields.fuel_pct !== "number") out.push({ type: "set", entity, field: "fuel_pct", value: rng.int(40, 90) });
        if (ownerLevel(ctx, entity) >= 3) {
          if (domainOf(ctx, entity) === "road" && typeof e.fields.odometer_mi !== "number") out.push({ type: "set", entity, field: "odometer_mi", value: rng.int(15000, 120000) });
          if (domainOf(ctx, entity) !== "road" && typeof e.fields.engine_hours !== "number") out.push({ type: "set", entity, field: "engine_hours", value: rng.int(50, 900) });
          if (typeof e.fields.condition !== "number") out.push({ type: "set", entity, field: "condition", value: rng.int(60, 95) });
        }
        return out;
      },
    });

    r.renderer({
      slot: "vehicles",
      render(ctx) {
        const pov = ctx.world.pov;
        const level = ctx.levelOf(pov, "vehicles");
        if (level === 0) return [];
        const lines: string[] = [];
        for (const v of Object.keys(ctx.state.entities).sort()) {
          const e = own(ctx.state.entities, v);
          if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || e.fields.owner !== pov) continue;
          const place = placeOfEntity(ctx.state, v);
          // The narrator hears where it is as the player may: a place the POV can't see is somewhere.
          const where = !place ? "at an unknown place" : canSeePlace(ctx.registry, ctx.world, ctx.state, pov, place) ? `at ${own(ctx.world.places, place)?.name ?? place}` : "somewhere";
          const parts = [`${e.name}: ${where}`];
          if (level === 1) parts.push(e.fields.status === "broken" ? "broken down" : "runs fine");
          else {
            const range = rangeLeft(ctx, v);
            parts.push(`fuel ${Math.round(numOf(e.fields.fuel_pct, 100))}%${range ? ` (~${Math.round(range.value)} ${range.unit})` : ""}`);
            if (e.fields.status !== "ok" && e.fields.status !== undefined) parts.push(String(e.fields.status).replace(/_/g, " "));
          }
          lines.push(`${parts.join(", ")}.`);
        }
        return lines;
      },
    });
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
