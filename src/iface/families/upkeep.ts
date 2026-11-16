// Upkeep (the skill `vehicles`): a vehicle refuelled, and a vehicle serviced or repaired, as the vehicles
// pack records them (`vehicles.upkeep`): the fuel left, the status, the condition and that a service was
// done are the call's, and a payment is made only when a payer is named, for the amount the call gives.
// What the world's tables price the work at is given as data and never charged by code.

import type { JsonObject } from "rp-harness/contract";
import { own } from "../../engine/pack-kit";
import { fuelCents, serviceCents } from "../../packs/vehicles/core";
import { formatMoney } from "../../shared/world";
import { NUMBER, oneOf, TEXT, YES_NO } from "../kit";
import { find, isUnread, minorUnits, named, notAs, numberArg, type OpContext, type Unread } from "../ops";
import { effectChange, notApplicable, type WriteDef, writeTool } from "./run";
import { vehicleNamed } from "./vehicles";

const FAMILY = "vehicles";

const STATUSES = ["ok", "needs_service", "broken"] as const;
const WORK = ["service", "repair"] as const;

/** A number the call gives, when it gives one; the line that says it is not one otherwise. */
function given(o: OpContext, field: string): number | undefined | Unread {
  const said = o.args[field];
  if (said === undefined || said === null) return undefined;
  const n = numberArg(o.args, field);
  return n === undefined ? notAs(o, field, said, "number") : n;
}

/** The payment a call gives: who pays and the amount, both or neither; the line that says what is missing otherwise. */
function payment(o: OpContext): { payer: string; cents: number } | null | Unread {
  const payer = o.args.payer === undefined || o.args.payer === null ? undefined : find(o, "payer", "party");
  if (payer !== undefined && isUnread(payer)) return payer;
  const cost = given(o, "cost");
  if (typeof cost === "object") return cost;
  if (payer === undefined && cost === undefined) return null;
  if (payer === undefined || cost === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: [payer === undefined ? "payer" : "cost"] } };
  return { payer: payer.id, cents: minorUnits(o.reading, cost) };
}

const refuel: WriteDef = {
  name: "vehicle_refuel",
  family: FAMILY,
  lane: "engine",
  properties: { vehicle: TEXT, fuel_pct: NUMBER, payer: TEXT, cost: NUMBER },
  required: ["vehicle", "fuel_pct"],
  example: { vehicle: "Old van", fuel_pct: 100, payer: "bram", cost: 62, source: { from: "prose", message: "m-0701" } },
  run(o) {
    const vehicle = vehicleNamed(o);
    if (isUnread(vehicle)) return vehicle;
    const fuel = given(o, "fuel_pct");
    if (fuel === undefined || typeof fuel === "object") return fuel ?? { line: "needs", fields: { n: o.n, op: o.op, fields: ["fuel_pct"] } };
    const paid = payment(o);
    if (paid !== null && "line" in paid) return paid;
    const w = o.draft.w;
    const before = own(w.state.entities, vehicle.id)?.fields.fuel_pct;
    const from = w.events.length;
    const memo = o.call.lines.line("fuel_memo", { what: o.reading.nameOf(vehicle.id) }) ?? "";
    const args: JsonObject = { vehicle: vehicle.id, fuel_pct: fuel, ...(paid !== null ? { payer: paid.payer, cents: paid.cents, memo, category: "fuel" } : {}) };
    // What the tables price the fuel added at, for the game master who sets the amount.
    const cents = typeof before === "number" && fuel > before ? fuelCents(w.ctx, vehicle.id, fuel - before) : 0;
    const tables: JsonObject = cents > 0 ? { cost_cents: cents, cost: formatMoney(cents, o.reading.doc.currency) } : {};
    o.after((): JsonObject => (Object.keys(tables).length > 0 ? { tables } : {}));
    const refused = effectChange(o, { type: "vehicles.upkeep", args });
    if (refused !== null) return notApplicable(o, refused.code);
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const service: WriteDef = {
  name: "vehicle_service",
  family: FAMILY,
  lane: "engine",
  properties: { vehicle: TEXT, work: oneOf(WORK), status: oneOf(STATUSES), condition: NUMBER, payer: TEXT, cost: NUMBER, serviced: YES_NO },
  required: ["vehicle", "work"],
  example: { vehicle: "Old van", work: "service", status: "ok", payer: "bram", cost: 85, source: { from: "prose", message: "m-0702" } },
  run(o) {
    const vehicle = vehicleNamed(o);
    if (isUnread(vehicle)) return vehicle;
    const work = o.args.work;
    if (!WORK.some((x) => x === work)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "work", value: JSON.stringify(work ?? null), choices: WORK.join(", ") } };
    const status = o.args.status;
    if (status !== undefined && status !== null && !STATUSES.some((x) => x === status)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "status", value: JSON.stringify(status), choices: STATUSES.join(", ") } };
    const condition = given(o, "condition");
    if (typeof condition === "object") return condition;
    const paid = payment(o);
    if (paid !== null && "line" in paid) return paid;
    const w = o.draft.w;
    const from = w.events.length;
    const memo = o.call.lines.line(work === "repair" ? "repair_memo" : "service_memo", { what: o.reading.nameOf(vehicle.id) }) ?? "";
    // A service marks the miles or hours it was done at, when the call says one was done (or the work is a service and says nothing else).
    const serviced = o.args.serviced === undefined || o.args.serviced === null ? work === "service" : o.args.serviced === true;
    const args: JsonObject = { vehicle: vehicle.id, ...(typeof status === "string" ? { status } : {}), ...(condition !== undefined ? { condition } : {}), ...(serviced ? { serviced: true } : {}), ...(paid !== null ? { payer: paid.payer, cents: paid.cents, memo, category: "vehicle_services" } : {}) };
    const price = serviceCents(w.ctx, work === "repair");
    const tables: JsonObject = price > 0 ? { cost_cents: price, cost: formatMoney(price, o.reading.doc.currency) } : {};
    o.after((): JsonObject => (Object.keys(tables).length > 0 ? { tables } : {}));
    const refused = effectChange(o, { type: "vehicles.upkeep", args });
    if (refused !== null) return notApplicable(o, refused.code);
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** The family's tools, as RPH's search finds them. */
export const UPKEEP_TOOLS = [writeTool(refuel), writeTool(service)];
