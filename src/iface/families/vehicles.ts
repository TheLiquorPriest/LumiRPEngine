// Vehicles (the skill `vehicles`): the world's vehicle classes and what they cost, as today's
// `vehicles_classes` lists them, and a drive, which records only what the call gives: the vehicle
// stands where the call says (`park`, else `to`), its driver (the call's, else the one recorded
// on the vehicle, else no one) and the riders it names arrive at `to`, and the fuel left, the miles
// or hours are the call's. Where the world's tables would say otherwise (no route, no fuel, a
// vehicle broken down, a driver not aboard) it is recorded all the same and the answer reports it;
// what the tables work the trip out to, and the chance of a breakdown, are given as data.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { VEHICLE_DOMAINS, vehicleDomainOf, worldHasAir } from "../../shared/vehicles";
import { own, strOf } from "../../engine/pack-kit";
import { isGone, kindIs, placeOfEntity } from "../../engine/scope";
import { breakdownChance, driveSums, driverOf, driveTrip, fuelUse, legOf } from "../../packs/vehicles/core";
import { oneOf, TEXT, TEXTS, YES_NO } from "../kit";
import { find, findOptional, isUnread, named, notAs, textArg, type OpContext, type Unread } from "../ops";
import { nearestOf, type Found } from "../reading";
import { textOf } from "../texts";
import { effectChange, notApplicable, readTool, type WriteDef, writeTool } from "./run";

const FAMILY = "vehicles";

/** The vehicle a call names: the line that says it is not a vehicle, with the vehicles nearest the name, when it is something else or nothing at all. */
export function vehicleNamed(o: OpContext): Found | Unread {
  const w = o.draft.w;
  const found = find(o, "vehicle", "thing");
  if (isUnread(found) ? found.line !== "unknown" : kindIs(w.ctx.registry, w.world, own(w.state.entities, found.id)?.kind ?? "", "vehicle")) return found;
  const said = String(o.args.vehicle);
  const vehicles = Object.keys(w.state.entities)
    .sort()
    .filter((id) => kindIs(w.ctx.registry, w.world, own(w.state.entities, id)?.kind ?? "", "vehicle") && !isGone(w.state, id))
    .map((id) => ({ id, name: strOf(own(w.state.entities, id)?.name, id) }));
  const near = nearestOf(said, vehicles.map((v) => v.name), o.call.settings)
    .slice(0, o.call.settings.nearMatches)
    .flatMap((n) => vehicles.filter((v) => v.name === n));
  return { line: "not_a_vehicle", fields: { n: o.n, op: o.op, name: said, vehicles: near.length > 0 ? textOf(near.map((v) => `${v.name} [${v.id}]`)) : "none" }, data: { near: near.map((v) => ({ id: v.id, name: v.name })) } };
}

/** A number a call gives, when it gives one; the line that says it is not one otherwise. */
function numberArg(o: OpContext, field: string): number | undefined | Unread {
  const v = o.args[field];
  if (v === undefined || v === null) return undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : notAs(o, field, v, "number");
}

const drive: WriteDef = {
  name: "vehicles_drive",
  family: FAMILY,
  lane: "engine",
  properties: { vehicle: TEXT, to: TEXT, driver: TEXT, riders: TEXTS, park: TEXT, fuel_pct: { type: "number" }, miles: { type: "number" }, hours: { type: "number" }, sums: YES_NO },
  required: ["vehicle", "to"],
  example: { vehicle: "Old van", to: "The Far Road", driver: "bram", riders: ["odile"], fuel_pct: 60, source: { from: "prose", message: "m-0601" } },
  run(o) {
    const w = o.draft.w;
    const vehicle = vehicleNamed(o);
    if (isUnread(vehicle)) return vehicle;
    const to = find(o, "to", "place");
    if (isUnread(to)) return to;
    const park = findOptional(o, "park", "place");
    if (park !== undefined && isUnread(park)) return park;
    let driver: string | null = driverOf(w.ctx, vehicle.id);
    if (textArg(o.args, "driver") !== undefined) {
      const found = find(o, "driver", "person");
      if (isUnread(found)) return found;
      driver = found.id;
    }
    const riders: string[] = [];
    for (const said of Array.isArray(o.args.riders) ? o.args.riders : []) {
      const rider = find(o, "riders", "person", false, said);
      if (isUnread(rider)) return rider;
      riders.push(rider.id);
    }
    const given: Record<string, number> = {};
    for (const field of ["fuel_pct", "miles", "hours"]) {
      const n = numberArg(o, field);
      if (typeof n === "object") return n;
      if (n !== undefined) given[field] = n;
    }
    // What the world's rules would say of this drive: told, never held back.
    const e = own(w.state.entities, vehicle.id);
    const recorded = e?.fields.driver;
    const trip = driveTrip(w.ctx, vehicle.id, driver, to.id);
    const leg = trip ? legOf(trip) : null;
    const use = leg ? fuelUse(w.ctx, vehicle.id, leg) : null;
    const fuel = e?.fields.fuel_pct;
    const what = named(o.reading, vehicle.id);
    if (textArg(o.args, "driver") === undefined && typeof recorded === "string" && driver === null) o.reply.report("driver_gone", { n: o.n, op: o.op, who: recorded, what });
    if (e?.fields.status === "broken") o.reply.report("broken", { n: o.n, op: o.op, what });
    if (trip === null) o.reply.report("no_route", { n: o.n, op: o.op, what, where: named(o.reading, to.id) });
    else if (trip.park !== to.id) o.reply.report("route_short", { n: o.n, op: o.op, what, where: named(o.reading, trip.park), to: named(o.reading, to.id) });
    if (use !== null && typeof fuel === "number" && fuel < use.pct) o.reply.report("no_fuel", { n: o.n, op: o.op, what });
    if (driver !== null && !(own(w.state.entities, driver)?.relations.some((r) => r.type === "in" && r.to === vehicle.id) ?? false) && placeOfEntity(w.state, driver) !== placeOfEntity(w.state, vehicle.id)) o.reply.report("driver_not_aboard", { n: o.n, op: o.op, who: named(o.reading, driver), what });
    if (given.miles !== undefined && typeof e?.fields.odometer_mi !== "number") o.reply.report("not_recorded", { n: o.n, op: o.op, what, field: "odometer_mi" });
    if (given.hours !== undefined && typeof e?.fields.engine_hours !== "number") o.reply.report("not_recorded", { n: o.n, op: o.op, what, field: "engine_hours" });
    // The tables' figures for the trip and the breakdown's chance, as data for the game master (who rolls it if the story wants it).
    const tables: JsonObject = {};
    if (leg !== null && use !== null) {
      tables.fuel_pct_used = Math.round(use.pct * 10) / 10;
      tables.miles = Math.round(use.miles * 10) / 10;
      tables.hours = Math.round(use.hours * 100) / 100;
      const chance = breakdownChance(w.ctx, vehicle.id, leg);
      if (chance !== null) tables.breakdown_chance = Math.round(chance * 1000) / 1000;
    }
    o.after((): JsonObject => (Object.keys(tables).length > 0 ? { tables } : {}));
    const from = w.events.length;
    const args: JsonObject = { vehicle: vehicle.id, to: to.id, riders, ...given };
    if (driver !== null) args.driver = driver;
    if (park !== undefined) args.park = park.id;
    const refused = effectChange(o, { type: "vehicles.take", args });
    if (refused !== null) return notApplicable(o, refused.code);
    // With sums, what the tables work out for the trip and the call did not give is recorded, as filled in from the world, in changes of its own.
    if (o.args.sums === true && leg !== null) {
      const filled = driveSums(w.ctx, vehicle.id, leg).filter((ev) => !("field" in ev) || (given[ev.field] === undefined && !(ev.field === "odometer_mi" && given.miles !== undefined) && !(ev.field === "engine_hours" && given.hours !== undefined)));
      const bad = o.draft.fillWith(filled);
      if (bad) return notApplicable(o, bad.code);
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A price band of a class's row, when it has one. */
function band(v: JsonValue | undefined): JsonObject | undefined {
  return isRecord(v) && typeof v.min === "number" && typeof v.typical === "number" && typeof v.max === "number" ? { min: v.min, typical: v.typical, max: v.max } : undefined;
}

const classes = readTool({
  name: "vehicles_classes",
  family: FAMILY,
  properties: { domain: oneOf(VEHICLE_DOMAINS), search: TEXT },
  required: [],
  example: { domain: "road", search: "van" },
  read(r, args, reply) {
    const domain = textArg(args, "domain");
    if (domain !== undefined && !VEHICLE_DOMAINS.some((d) => d === domain)) return { line: "unreadable", fields: { field: "domain", value: JSON.stringify(args.domain), choices: textOf(VEHICLE_DOMAINS) } };
    const search = (textArg(args, "search") ?? "").toLowerCase();
    const air = worldHasAir(r.world);
    const rows = r.ctx.tables.get("vehicles.classes")?.rows ?? {};
    const out = Object.entries(rows).flatMap(([id, row]): JsonObject[] => {
      const d = vehicleDomainOf(row);
      const name = strOf(row.name, id);
      const aliases = Array.isArray(row.aliases) ? row.aliases.filter((a): a is string => typeof a === "string") : [];
      if ((d === "air" && !air) || (domain !== undefined && d !== domain) || (search !== "" && ![id, name, ...aliases].some((x) => x.toLowerCase().includes(search)))) return [];
      const used = band(own(row, "price_used_cents"));
      const fresh = band(own(row, "price_new_cents"));
      return [{ id, name, domain: d, ...(typeof row.make === "string" ? { make: row.make } : {}), ...(typeof row.model === "string" ? { model: row.model } : {}), ...(aliases.length > 0 ? { also: aliases } : {}), ...(used ? { used } : {}), ...(fresh ? { new: fresh } : {}) }];
    });
    reply.data({ classes: out, air });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const VEHICLE_TOOLS = [classes, writeTool(drive)];
