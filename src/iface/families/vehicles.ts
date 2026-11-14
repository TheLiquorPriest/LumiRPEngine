// Vehicles (the skill `vehicles`): the world's vehicle classes and what they cost, as today's
// `vehicles_classes` lists them, and a drive to a place, as the vehicles pack drives one (its route,
// its time on the road, its fuel, the driver and riders arriving with it). A drive today's rules would
// refuse for what it means (no road there, no fuel, a vehicle broken down) is made all the same: the
// vehicle, its driver and its riders are at the place, and the answer reports it.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { LedgerEvent } from "../../shared/ledger";
import { VEHICLE_DOMAINS, vehicleDomainOf, worldHasAir } from "../../shared/vehicles";
import { own, strOf } from "../../engine/pack-kit";
import { relocate } from "../../engine/relocate";
import { oneOf, TEXT, TEXTS } from "../kit";
import { find, isUnread, named, textArg } from "../ops";
import { effectChange, isAlready, notApplicable, readTool, type WriteDef, writeTool } from "./run";
import { textOf } from "../texts";

const FAMILY = "vehicles";

/** Today's refusals of a drive for what it means: made all the same, and reported. */
const DRIVEN_ANYWAY: Readonly<Record<string, true>> = { no_route: true, no_fuel: true, broken: true };

const drive: WriteDef = {
  name: "vehicles_drive",
  family: FAMILY,
  lane: "engine",
  properties: { vehicle: TEXT, to: TEXT, driver: TEXT, riders: TEXTS },
  required: ["vehicle", "to"],
  example: { vehicle: "Old van", to: "The Far Road", driver: "bram", riders: ["odile"], source: { from: "prose", message: "m-0601" } },
  run(o) {
    const vehicle = find(o, "vehicle", "thing");
    if (isUnread(vehicle)) return vehicle;
    const to = find(o, "to", "place");
    if (isUnread(to)) return to;
    const w = o.draft.w;
    let driver = w.world.pov;
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
    const from = w.events.length;
    const refused = effectChange(o, { type: "vehicles.drive", args: { vehicle: vehicle.id, to: to.id, driver, riders } });
    if (refused !== null) {
      if (refused.code === "already_there" || isAlready(refused.code)) o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, vehicle.id) });
      else if (DRIVEN_ANYWAY[refused.code]) {
        // There all the same: the vehicle parked at the place, its driver and riders arrived by the one move path.
        const events: LedgerEvent[] = [{ type: "set", entity: vehicle.id, field: "place", value: to.id }];
        for (const p of [driver, ...riders]) {
          const moved = relocate(w.ctx, p, to.id, p === driver ? {} : { along: true });
          if ("code" in moved) return notApplicable(o, moved.code);
          events.push(...moved);
        }
        const bad = o.draft.applyAll(events);
        if (bad) return notApplicable(o, bad.code);
        o.reply.report("rule_bent", { n: o.n, op: o.op, what: named(o.reading, vehicle.id), where: named(o.reading, to.id), code: refused.code });
      } else return notApplicable(o, refused.code);
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
